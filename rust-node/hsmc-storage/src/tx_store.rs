/// TxStore — full transaction persistence with block index and address index
use std::sync::Arc;
use anyhow::{anyhow, Result};
use rocksdb::{DB, WriteBatch};
use hsmc_core::Transaction;
use tracing::debug;
use crate::{CF_TXS, CF_TXS_BY_BLOCK};

pub struct TxStore { db: Arc<DB> }

impl TxStore {
    pub fn new(db: Arc<DB>) -> Self { Self { db } }

    pub fn put(&self, tx: &Transaction, block_number: Option<u64>) -> Result<()> {
        let cf_tx = self.db.cf_handle(CF_TXS).ok_or_else(|| anyhow!("CF_TXS missing"))?;
        let cf_bl = self.db.cf_handle(CF_TXS_BY_BLOCK).ok_or_else(|| anyhow!("CF_TXS_BY_BLOCK missing"))?;
        let value = serde_json::to_vec(tx)?;
        let mut batch = WriteBatch::default();
        batch.put_cf(cf_tx, tx.hash.as_bytes(), &value);
        if let Some(bn) = block_number {
            let mut key = Vec::with_capacity(8 + tx.hash.len());
            key.extend_from_slice(&bn.to_be_bytes());
            key.extend_from_slice(tx.hash.as_bytes());
            batch.put_cf(cf_bl, &key, tx.hash.as_bytes());
        }
        self.db.write(batch)?;
        debug!(hash = &tx.hash[..12], block = ?block_number, "TX persisted");
        Ok(())
    }

    pub fn put_block_txs(&self, txs: &[Transaction], block_number: u64) -> Result<()> {
        for tx in txs { self.put(tx, Some(block_number))?; }
        Ok(())
    }

    pub fn get(&self, hash: &str) -> Result<Option<Transaction>> {
        let cf = self.db.cf_handle(CF_TXS).ok_or_else(|| anyhow!("CF_TXS missing"))?;
        match self.db.get_cf(cf, hash.as_bytes())? {
            Some(b) => Ok(Some(serde_json::from_slice(&b)?)),
            None => Ok(None),
        }
    }

    pub fn get_tx_hashes_for_block(&self, block_number: u64) -> Result<Vec<String>> {
        let cf = self.db.cf_handle(CF_TXS_BY_BLOCK).ok_or_else(|| anyhow!("CF missing"))?;
        let prefix = block_number.to_be_bytes();
        let iter = self.db.prefix_iterator_cf(cf, prefix);
        let mut hashes = Vec::new();
        for item in iter {
            let (key, value) = item?;
            if key.len() < 8 || &key[..8] != prefix.as_ref() { break; }
            if let Ok(h) = String::from_utf8(value.to_vec()) { hashes.push(h); }
        }
        Ok(hashes)
    }

    pub fn get_txs_for_block(&self, block_number: u64) -> Result<Vec<Transaction>> {
        let hashes = self.get_tx_hashes_for_block(block_number)?;
        let mut txs = Vec::new();
        for hash in hashes {
            if let Some(tx) = self.get(&hash)? { txs.push(tx); }
        }
        Ok(txs)
    }

    pub fn remove(&self, hash: &str) -> Result<()> {
        let cf = self.db.cf_handle(CF_TXS).ok_or_else(|| anyhow!("CF_TXS missing"))?;
        self.db.delete_cf(cf, hash.as_bytes())?;
        Ok(())
    }
}
