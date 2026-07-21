/// MempoolStore — durable pending transaction persistence across node restarts
use std::sync::Arc;
use anyhow::Result;
use rocksdb::{DB, IteratorMode};
use tracing::{debug, warn};
use hsmc_core::Transaction;
use crate::CF_TXS;

const MEMPOOL_PREFIX: &[u8] = b"mempool:";

pub struct MempoolStore { db: Arc<DB> }

impl MempoolStore {
    pub fn new(db: Arc<DB>) -> Self { Self { db } }

    pub fn put(&self, tx: &Transaction) -> Result<()> {
        let cf = self.db.cf_handle(CF_TXS).ok_or_else(|| anyhow::anyhow!("CF_TXS missing"))?;
        let mut key = MEMPOOL_PREFIX.to_vec();
        key.extend_from_slice(tx.hash.as_bytes());
        self.db.put_cf(&cf, &key, serde_json::to_vec(tx)?)?;
        debug!(hash = &tx.hash[..12], "MempoolStore: persisted");
        Ok(())
    }

    pub fn remove(&self, hash: &str) -> Result<()> {
        let cf = self.db.cf_handle(CF_TXS).ok_or_else(|| anyhow::anyhow!("CF_TXS missing"))?;
        let mut key = MEMPOOL_PREFIX.to_vec();
        key.extend_from_slice(hash.as_bytes());
        self.db.delete_cf(&cf, &key)?;
        Ok(())
    }

    pub fn load_all(&self) -> Result<Vec<Transaction>> {
        let cf = self.db.cf_handle(CF_TXS).ok_or_else(|| anyhow::anyhow!("CF_TXS missing"))?;
        let iter = self.db.iterator_cf(&cf, IteratorMode::From(MEMPOOL_PREFIX, rocksdb::Direction::Forward));
        let mut txs = Vec::new();
        for item in iter {
            let (key, value) = item?;
            if !key.starts_with(MEMPOOL_PREFIX) { break; }
            match serde_json::from_slice::<Transaction>(&value) {
                Ok(tx) => txs.push(tx),
                Err(e) => warn!("MempoolStore: bad tx: {}", e),
            }
        }
        Ok(txs)
    }

    pub fn count(&self) -> usize { self.load_all().map(|v| v.len()).unwrap_or(0) }
}
