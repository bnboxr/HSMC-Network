/// BlockStore — full RocksDB persistence with atomic writes, UTXO index, reorg support
use std::sync::Arc;
use anyhow::{anyhow, Result};
use rocksdb::{DB, WriteBatch, IteratorMode};
use hsmc_core::{Block, Chain};
use tracing::{debug, info, warn};
use crate::{CF_BLOCKS, CF_BLOCKS_BY_HASH, CF_META};

pub struct BlockStore { db: Arc<DB> }

impl BlockStore {
    pub fn new(db: Arc<DB>) -> Self { Self { db } }

    pub fn put(&self, block: &Block) -> Result<()> {
        let cf_b  = self.db.cf_handle(CF_BLOCKS).ok_or_else(|| anyhow!("CF_BLOCKS missing"))?;
        let cf_h  = self.db.cf_handle(CF_BLOCKS_BY_HASH).ok_or_else(|| anyhow!("CF_BLOCKS_BY_HASH missing"))?;
        let cf_m  = self.db.cf_handle(CF_META).ok_or_else(|| anyhow!("CF_META missing"))?;
        let key   = block.block_number.to_be_bytes();
        let value = serde_json::to_vec(block)?;
        let mut batch = WriteBatch::default();
        batch.put_cf(cf_b, &key, &value);
        batch.put_cf(cf_h, block.hash.as_bytes(), &key);
        // Update tip
        if self.tip_number()?.map(|t| block.block_number >= t).unwrap_or(true) {
            batch.put_cf(cf_m, b"tip", &key);
        }
        // Store block count in meta
        let count = self.count()? + 1;
        batch.put_cf(cf_m, b"count", &count.to_be_bytes());
        self.db.write(batch)?;
        debug!(block = block.block_number, hash = &block.hash[..12], "Block persisted");
        Ok(())
    }

    pub fn get_by_number(&self, number: u64) -> Result<Option<Block>> {
        let cf = self.db.cf_handle(CF_BLOCKS).ok_or_else(|| anyhow!("CF_BLOCKS missing"))?;
        match self.db.get_cf(cf, &number.to_be_bytes())? {
            Some(b) => Ok(Some(serde_json::from_slice(&b)?)),
            None => Ok(None),
        }
    }

    pub fn get_by_hash(&self, hash: &str) -> Result<Option<Block>> {
        let cf_h = self.db.cf_handle(CF_BLOCKS_BY_HASH).ok_or_else(|| anyhow!("CF missing"))?;
        match self.db.get_cf(cf_h, hash.as_bytes())? {
            Some(num_b) => {
                let num = u64::from_be_bytes(num_b.as_slice().try_into().map_err(|_| anyhow!("bad key"))?);
                self.get_by_number(num)
            }
            None => Ok(None),
        }
    }

    pub fn tip_number(&self) -> Result<Option<u64>> {
        let cf = self.db.cf_handle(CF_META).ok_or_else(|| anyhow!("CF_META missing"))?;
        match self.db.get_cf(cf, b"tip")? {
            Some(b) => Ok(Some(u64::from_be_bytes(b.as_slice().try_into().map_err(|_| anyhow!("bad tip"))?))),
            None => Ok(None),
        }
    }

    pub fn count(&self) -> Result<u64> {
        let cf = self.db.cf_handle(CF_META).ok_or_else(|| anyhow!("CF_META missing"))?;
        match self.db.get_cf(cf, b"count")? {
            Some(b) => Ok(u64::from_be_bytes(b.as_slice().try_into().unwrap_or([0u8;8]))),
            None => Ok(0),
        }
    }

    pub fn load_chain(&self, chain: &mut Chain) -> Result<(usize, u64)> {
        let cf = self.db.cf_handle(CF_BLOCKS).ok_or_else(|| anyhow!("CF_BLOCKS missing"))?;
        let iter = self.db.iterator_cf(cf, IteratorMode::Start);
        let mut blocks = Vec::new();
        for item in iter {
            let (_, value) = item?;
            let block: Block = serde_json::from_slice(&value)?;
            if block.block_number != 0 {
                blocks.push(block);
            }
        }

        // Never restore headers alone. Replaying each persisted block through the
        // consensus state machine reconstructs UTXOs, replay/double-spend indices,
        // hash indices, difficulty, and reorg undo data from accepted block bodies.
        let mut rebuilt = Chain::new();
        for block in &blocks {
            rebuilt.add_block(block.clone()).map_err(|e| anyhow!(
                "persisted block #{} failed consensus replay: {}", block.block_number, e
            ))?;
        }
        let count = blocks.len();
        let tip = rebuilt.height();
        *chain = rebuilt;
        info!(loaded = count, tip, "Chain restored and consensus state rebuilt from RocksDB");
        Ok((count, tip))
    }

    /// Delete a block (for reorg rollback)
    pub fn delete(&self, block_number: u64, hash: &str) -> Result<()> {
        let cf_b = self.db.cf_handle(CF_BLOCKS).ok_or_else(|| anyhow!("CF_BLOCKS missing"))?;
        let cf_h = self.db.cf_handle(CF_BLOCKS_BY_HASH).ok_or_else(|| anyhow!("CF missing"))?;
        let mut batch = WriteBatch::default();
        batch.delete_cf(cf_b, &block_number.to_be_bytes());
        batch.delete_cf(cf_h, hash.as_bytes());
        self.db.write(batch)?;
        Ok(())
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use hsmc_core::{difficulty_to_leading_zeros, leading_zeros_in_hash, Block, MIN_DIFFICULTY};
    use std::sync::Arc;

    fn mine_block(mut block: Block) -> Block {
        for nonce in 0..u64::MAX {
            block.nonce = nonce;
            let hash = block.compute_hash();
            if leading_zeros_in_hash(&hash) >= difficulty_to_leading_zeros(block.difficulty) {
                block.hash = hash;
                return block;
            }
        }
        unreachable!("nonce space exhausted")
    }

    #[test]
    fn restart_rebuilds_consensus_utxo_state_from_persisted_blocks() {
        let path = std::env::temp_dir().join(format!(
            "hsmc-block-store-rebuild-{}-{}", std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let (coinbase_hash, reward, block_hash) = {
            let db = Arc::new(crate::open_db(&path).expect("open database"));
            let store = BlockStore::new(db);
            let mut chain = Chain::new();
            chain.difficulty = MIN_DIFFICULTY;
            let block = mine_block(Block::new(
                1, chain.tip().hash.clone(), "HSMC_restart_test_miner".into(),
                MIN_DIFFICULTY, vec![],
            ));
            let coinbase_hash = block.transactions[0].clone();
            let reward = block.reward;
            let block_hash = block.hash.clone();
            chain.add_block(block.clone()).expect("accept source block");
            store.put(&block).expect("persist source block");
            (coinbase_hash, reward, block_hash)
        };

        let db = Arc::new(crate::open_db(&path).expect("reopen database"));
        let store = BlockStore::new(db);
        let mut restarted = Chain::new();
        assert_eq!(store.load_chain(&mut restarted).expect("rebuild chain"), (1, 1));
        assert_eq!(restarted.height(), 1);
        assert!(restarted.hash_index.contains_key(&block_hash));
        assert_eq!(
            restarted.utxo_set.get(&coinbase_hash, 0)
                .expect("persisted coinbase rebuilt into UTXO set").amount,
            reward
        );
        drop(store);
        let _ = std::fs::remove_dir_all(path);
    }
}
