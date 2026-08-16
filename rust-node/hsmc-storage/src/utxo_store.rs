/// UTXO set storage — RocksDB-backed, indexed by (txid:vout) and address
use std::sync::Arc;
use rocksdb::{DB, WriteBatch, IteratorMode};
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use tracing::warn;
use hsmc_core::Transaction;
use crate::{CF_UTXOS, CF_UTXOS_BY_ADDR, CF_KEY_IMAGES};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredUtxo {
    pub txid:           String,
    pub vout:           u32,
    pub address:        String,
    pub amount:         u64,
    pub script_pubkey:  String,
    pub block_height:   u64,
    pub coinbase:       bool,
    pub commitment:     Option<String>,  // Pedersen commitment
    pub confidential:   bool,
}

pub struct UtxoStore {
    db: Arc<DB>,
}

impl UtxoStore {
    pub fn new(db: Arc<DB>) -> Self { Self { db } }

    fn utxo_key(txid: &str, vout: u32) -> Vec<u8> {
        format!("{}:{}", txid, vout).into_bytes()
    }

    fn addr_key(address: &str, txid: &str, vout: u32) -> Vec<u8> {
        format!("{}:{}:{}", address, txid, vout).into_bytes()
    }

    pub fn put(&self, utxo: &StoredUtxo) -> Result<()> {
        let cf_utxos = self.db.cf_handle(CF_UTXOS)
            .ok_or_else(|| anyhow!("CF_UTXOS not found"))?;
        let cf_addr = self.db.cf_handle(CF_UTXOS_BY_ADDR)
            .ok_or_else(|| anyhow!("CF_UTXOS_BY_ADDR not found"))?;

        let key = Self::utxo_key(&utxo.txid, utxo.vout);
        let val = bincode::serialize(utxo)?;
        let addr_key = Self::addr_key(&utxo.address, &utxo.txid, utxo.vout);

        let mut batch = WriteBatch::default();
        batch.put_cf(cf_utxos, &key, &val);
        batch.put_cf(cf_addr, &addr_key, &key);
        self.db.write(batch)?;
        Ok(())
    }

    pub fn remove(&self, txid: &str, vout: u32) -> Result<Option<StoredUtxo>> {
        let cf_utxos = self.db.cf_handle(CF_UTXOS)
            .ok_or_else(|| anyhow!("CF_UTXOS not found"))?;
        let cf_addr = self.db.cf_handle(CF_UTXOS_BY_ADDR)
            .ok_or_else(|| anyhow!("CF_UTXOS_BY_ADDR not found"))?;

        let key = Self::utxo_key(txid, vout);
        let existing = self.db.get_cf(cf_utxos, &key)?
            .and_then(|v| bincode::deserialize::<StoredUtxo>(&v).ok());

        if let Some(ref utxo) = existing {
            let mut batch = WriteBatch::default();
            batch.delete_cf(cf_utxos, &key);
            batch.delete_cf(cf_addr, &Self::addr_key(&utxo.address, txid, vout));
            self.db.write(batch)?;
        }
        Ok(existing)
    }

    pub fn get(&self, txid: &str, vout: u32) -> Result<Option<StoredUtxo>> {
        let cf = self.db.cf_handle(CF_UTXOS)
            .ok_or_else(|| anyhow!("CF_UTXOS not found"))?;
        let key = Self::utxo_key(txid, vout);
        Ok(self.db.get_cf(cf, &key)?
            .and_then(|v| bincode::deserialize(&v).ok()))
    }

    pub fn get_by_address(&self, address: &str) -> Result<Vec<StoredUtxo>> {
        let cf_addr = self.db.cf_handle(CF_UTXOS_BY_ADDR)
            .ok_or_else(|| anyhow!("CF_UTXOS_BY_ADDR not found"))?;
        let cf_utxos = self.db.cf_handle(CF_UTXOS)
            .ok_or_else(|| anyhow!("CF_UTXOS not found"))?;

        let prefix = format!("{}:", address).into_bytes();
        let iter = self.db.prefix_iterator_cf(cf_addr, &prefix);
        let mut results = Vec::new();

        for item in iter {
            let (_, utxo_key) = item?;
            if let Some(utxo_bytes) = self.db.get_cf(cf_utxos, &utxo_key)? {
                if let Ok(utxo) = bincode::deserialize::<StoredUtxo>(&utxo_bytes) {
                    results.push(utxo);
                }
            }
        }
        Ok(results)
    }

    pub fn balance_of(&self, address: &str) -> Result<u64> {
        Ok(self.get_by_address(address)?.iter().map(|u| u.amount).sum())
    }

    /// Record a spent key image (for ring sig double-spend prevention)
    pub fn add_key_image(&self, key_image: &str) -> Result<()> {
        let cf = self.db.cf_handle(CF_KEY_IMAGES)
            .ok_or_else(|| anyhow!("CF_KEY_IMAGES not found"))?;
        self.db.put_cf(cf, key_image.as_bytes(), b"1")?;
        Ok(())
    }

    pub fn is_key_image_spent(&self, key_image: &str) -> Result<bool> {
        let cf = self.db.cf_handle(CF_KEY_IMAGES)
            .ok_or_else(|| anyhow!("CF_KEY_IMAGES not found"))?;
        Ok(self.db.get_cf(cf, key_image.as_bytes())?.is_some())
    }

    /// Total number of unspent outputs in the UTXO set
    pub fn count(&self) -> Result<u64> {
        let cf = self.db.cf_handle(CF_UTXOS)
            .ok_or_else(|| anyhow!("CF_UTXOS not found"))?;
        Ok(self.db.iterator_cf(cf, IteratorMode::Start).count() as u64)
    }

    /// Apply a confirmed transaction to the UTXO set: spend the referenced
    /// inputs (recording their key images to prevent double-spends) and
    /// register each output as a new unspent entry at the given block height.
    pub fn apply_transaction(&self, tx: &Transaction, block_height: u64) -> Result<()> {
        for input in &tx.inputs {
            let _ = self.remove(&input.prev_tx_hash, input.output_index)?;
            if let Some(key_image) = &input.key_image {
                self.add_key_image(key_image)?;
            }
        }
        for (vout, output) in tx.outputs.iter().enumerate() {
            self.put(&StoredUtxo {
                txid:          tx.hash.clone(),
                vout:          vout as u32,
                address:       output.address.clone(),
                amount:        output.amount as u64,
                script_pubkey: output.lock_script.clone(),
                block_height,
                coinbase:      tx.payload.is_coinbase(),
                commitment:    output.commitment.clone(),
                confidential:  output.commitment.is_some(),
            })?;
        }
        Ok(())
    }
}
