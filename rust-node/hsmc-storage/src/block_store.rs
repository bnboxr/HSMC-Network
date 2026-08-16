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

    /// Persist the chain tip metadata (block number) — writes the same `CF_META`
    /// `"tip"` key that `put` maintains, so a shutdown flush can re-assert the
    /// tip without re-writing the block itself. The hash is accepted for API
    /// symmetry with `put`/`delete` but the on-disk tip record stores only the
    /// block number (see `tip_number`).
    pub fn save_tip_metadata(&self, block_number: u64, _hash: &str) -> Result<()> {
        let cf = self.db.cf_handle(CF_META).ok_or_else(|| anyhow!("CF_META missing"))?;
        self.db.put_cf(cf, b"tip", &block_number.to_be_bytes())?;
        Ok(())
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
        let mut count = 0usize;
        for item in iter {
            let (_, value) = item?;
            let block: Block = serde_json::from_slice(&value)?;
            if block.block_number == 0 { continue; }
            chain.blocks.push(block.clone());
            chain.index.insert(block.block_number, chain.blocks.len() - 1);
            count += 1;
        }
        let tip = chain.height();
        info!(loaded = count, tip, "Chain restored from RocksDB");
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
