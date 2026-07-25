/// State store — chain metadata, checkpoints, governance state
use std::sync::Arc;
use rocksdb::DB;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use crate::CF_STATE;

const KEY_CHAIN_HEIGHT: &[u8] = b"chain_height";
const KEY_CHAIN_TIP_HASH: &[u8] = b"chain_tip_hash";
const KEY_TOTAL_SUPPLY: &[u8] = b"total_supply";
const KEY_TOTAL_STAKED: &[u8] = b"total_staked";
const KEY_TREASURY_BALANCE: &[u8] = b"treasury_balance";
const KEY_LAST_DIFFICULTY: &[u8] = b"last_difficulty";
const KEY_LAST_CHECKPOINT: &[u8] = b"last_checkpoint";
const KEY_GOVERNANCE_SNAPSHOT: &str = "governance_snapshot";
const KEY_STAKING_SNAPSHOT: &str = "staking_snapshot";

pub struct StateStore { db: Arc<DB> }

impl StateStore {
    pub fn new(db: Arc<DB>) -> Self { Self { db } }

    fn cf(&self) -> Result<&rocksdb::ColumnFamily> {
        self.db.cf_handle(CF_STATE).ok_or_else(|| anyhow!("CF_STATE not found"))
    }

    pub fn set_u64(&self, key: &[u8], value: u64) -> Result<()> {
        self.db.put_cf(self.cf()?, key, &value.to_le_bytes())?;
        Ok(())
    }

    pub fn get_u64(&self, key: &[u8]) -> Result<u64> {
        Ok(self.db.get_cf(self.cf()?, key)?
            .and_then(|v| v.try_into().ok().map(u64::from_le_bytes))
            .unwrap_or(0))
    }

    pub fn set_str(&self, key: &[u8], value: &str) -> Result<()> {
        self.db.put_cf(self.cf()?, key, value.as_bytes())?;
        Ok(())
    }

    pub fn get_str(&self, key: &[u8]) -> Result<String> {
        Ok(self.db.get_cf(self.cf()?, key)?
            .and_then(|v| String::from_utf8(v).ok())
            .unwrap_or_default())
    }

    pub fn set_chain_height(&self, h: u64) -> Result<()> { self.set_u64(KEY_CHAIN_HEIGHT, h) }
    pub fn get_chain_height(&self) -> Result<u64> { self.get_u64(KEY_CHAIN_HEIGHT) }
    pub fn set_tip_hash(&self, h: &str) -> Result<()> { self.set_str(KEY_CHAIN_TIP_HASH, h) }
    pub fn get_tip_hash(&self) -> Result<String> { self.get_str(KEY_CHAIN_TIP_HASH) }
    pub fn set_total_supply(&self, s: u64) -> Result<()> { self.set_u64(KEY_TOTAL_SUPPLY, s) }
    pub fn get_total_supply(&self) -> Result<u64> { self.get_u64(KEY_TOTAL_SUPPLY) }
    pub fn set_total_staked(&self, s: u64) -> Result<()> { self.set_u64(KEY_TOTAL_STAKED, s) }
    pub fn get_total_staked(&self) -> Result<u64> { self.get_u64(KEY_TOTAL_STAKED) }
    pub fn set_difficulty(&self, d: u64) -> Result<()> { self.set_u64(KEY_LAST_DIFFICULTY, d) }
    pub fn get_difficulty(&self) -> Result<u64> { self.get_u64(KEY_LAST_DIFFICULTY) }
    pub fn set_treasury(&self, b: u64) -> Result<()> { self.set_u64(KEY_TREASURY_BALANCE, b) }
    pub fn get_treasury(&self) -> Result<u64> { self.get_u64(KEY_TREASURY_BALANCE) }

    pub fn set_json<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let json = serde_json::to_vec(value)?;
        self.db.put_cf(self.cf()?, key.as_bytes(), &json)?;
        Ok(())
    }

    pub fn get_json<T: for<'de> Deserialize<'de>>(&self, key: &str) -> Result<Option<T>> {
        Ok(self.db.get_cf(self.cf()?, key.as_bytes())?
            .and_then(|v| serde_json::from_slice(&v).ok()))
    }

    /// Save governance snapshot to RocksDB
    pub fn save_governance<T: Serialize>(&self, snapshot: &T) -> Result<()> {
        self.set_json(KEY_GOVERNANCE_SNAPSHOT, snapshot)
    }

    /// Load governance snapshot from RocksDB
    pub fn load_governance<T: for<'de> Deserialize<'de>>(&self) -> Result<Option<T>> {
        self.get_json(KEY_GOVERNANCE_SNAPSHOT)
    }

    /// Save staking snapshot to RocksDB
    pub fn save_staking<T: Serialize>(&self, snapshot: &T) -> Result<()> {
        self.set_json(KEY_STAKING_SNAPSHOT, snapshot)
    }

    /// Load staking snapshot from RocksDB
    pub fn load_staking<T: for<'de> Deserialize<'de>>(&self) -> Result<Option<T>> {
        self.get_json(KEY_STAKING_SNAPSHOT)
    }
}
