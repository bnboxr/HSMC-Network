/// Chain state snapshot — complete serializable state for checkpointing and sync
/// Includes UTXO set, governance state, fee market, staking registry
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sha2::{Digest, Sha256};

// ─── Staking Registry ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakeEntry {
    pub address: String,
    pub amount: u64,
    pub locked_until_height: u64,
    pub delegated_to: Option<String>, // validator address
    pub rewards_accumulated: u64,
    pub last_reward_height: u64,
    pub penalty_points: u32,          // for slashing
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatorInfo {
    pub address: String,
    pub public_key: String,
    pub commission_rate_bps: u16,  // basis points
    pub total_delegated: u64,
    pub self_bond: u64,
    pub status: ValidatorStatus,
    pub uptime_blocks: u64,
    pub missed_blocks: u64,
    pub jailed_until_height: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ValidatorStatus {
    Active,
    Inactive,
    Jailed,
    Tombstoned, // permanently slashed
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StakingRegistry {
    pub stakes: HashMap<String, StakeEntry>,
    pub validators: HashMap<String, ValidatorInfo>,
    pub total_staked: u64,
    pub epoch: u64,
    pub reward_pool: u64,
    pub annual_reward_rate_bps: u16, // e.g., 1200 = 12%
}

impl StakingRegistry {
    pub fn new() -> Self {
        Self {
            annual_reward_rate_bps: 1200, // 12% APR default
            ..Default::default()
        }
    }

    /// Stake tokens for an address
    pub fn stake(
        &mut self,
        address: String,
        amount: u64,
        current_height: u64,
        lock_period_blocks: u64,
        validator: Option<String>,
    ) -> Result<(), String> {
        if amount < 100_000_000 {
            return Err("Minimum stake: 1 HSMC".into());
        }

        let entry = self.stakes.entry(address.clone()).or_insert(StakeEntry {
            address: address.clone(),
            amount: 0,
            locked_until_height: current_height + lock_period_blocks,
            delegated_to: validator.clone(),
            rewards_accumulated: 0,
            last_reward_height: current_height,
            penalty_points: 0,
        });

        entry.amount += amount;
        entry.locked_until_height = (current_height + lock_period_blocks).max(entry.locked_until_height);
        if validator.is_some() { entry.delegated_to = validator.clone(); }

        self.total_staked += amount;

        // Update validator delegation
        if let Some(val_addr) = validator {
            if let Some(v) = self.validators.get_mut(&val_addr) {
                v.total_delegated += amount;
            }
        }

        Ok(())
    }

    /// Unstake tokens (subject to lock period)
    pub fn unstake(
        &mut self,
        address: &str,
        amount: u64,
        current_height: u64,
    ) -> Result<(), String> {
        let entry = self.stakes.get_mut(address)
            .ok_or_else(|| "No stake found".to_string())?;

        if current_height < entry.locked_until_height {
            return Err(format!(
                "Tokens locked until height {}. Current: {}",
                entry.locked_until_height, current_height
            ));
        }

        if amount > entry.amount {
            return Err(format!("Insufficient staked balance: have {}, unstake {}", entry.amount, amount));
        }

        // Update validator
        if let Some(val_addr) = entry.delegated_to.clone() {
            if let Some(v) = self.validators.get_mut(&val_addr) {
                v.total_delegated = v.total_delegated.saturating_sub(amount);
            }
        }

        entry.amount -= amount;
        self.total_staked = self.total_staked.saturating_sub(amount);

        if entry.amount == 0 {
            self.stakes.remove(address);
        }

        Ok(())
    }

    /// Distribute block rewards to all stakers proportionally
    pub fn distribute_block_reward(
        &mut self,
        block_reward: u64,
        current_height: u64,
        treasury_bps: u64,
    ) {
        if self.total_staked == 0 { return; }

        let treasury_cut = block_reward * treasury_bps / 10_000;
        let staker_reward = block_reward - treasury_cut;
        self.reward_pool += treasury_cut;

        let addresses: Vec<String> = self.stakes.keys().cloned().collect();
        for addr in addresses {
            if let Some(entry) = self.stakes.get_mut(&addr) {
                let share = staker_reward * entry.amount / self.total_staked;
                entry.rewards_accumulated += share;
                entry.last_reward_height = current_height;
            }
        }
    }

    /// Claim accumulated staking rewards
    pub fn claim_rewards(&mut self, address: &str) -> Result<u64, String> {
        let entry = self.stakes.get_mut(address)
            .ok_or_else(|| "No stake found".to_string())?;
        let rewards = entry.rewards_accumulated;
        entry.rewards_accumulated = 0;
        Ok(rewards)
    }

    /// Slash a validator for misbehavior
    pub fn slash_validator(
        &mut self,
        validator_addr: &str,
        slash_percent: u8,
        jail_until_height: u64,
    ) -> Result<u64, String> {
        let v = self.validators.get_mut(validator_addr)
            .ok_or_else(|| "Validator not found".to_string())?;

        let slash_amount = v.total_delegated * slash_percent as u64 / 100;
        v.total_delegated = v.total_delegated.saturating_sub(slash_amount);
        v.status = ValidatorStatus::Jailed;
        v.jailed_until_height = Some(jail_until_height);

        self.total_staked = self.total_staked.saturating_sub(slash_amount);
        Ok(slash_amount)
    }

    /// Register a new validator
    pub fn register_validator(
        &mut self,
        address: String,
        public_key: String,
        commission_rate_bps: u16,
        self_bond: u64,
    ) -> Result<(), String> {
        if commission_rate_bps > 5000 {
            return Err("Commission rate too high (max 50%)".into());
        }
        if self_bond < 10_000 * 100_000_000 {
            return Err("Minimum self-bond: 10,000 HSMC".into());
        }

        self.validators.insert(address.clone(), ValidatorInfo {
            address,
            public_key,
            commission_rate_bps,
            total_delegated: self_bond,
            self_bond,
            status: ValidatorStatus::Active,
            uptime_blocks: 0,
            missed_blocks: 0,
            jailed_until_height: None,
        });
        Ok(())
    }
}

// ─── State Checkpoint ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateCheckpoint {
    pub block_height: u64,
    pub block_hash: String,
    pub state_root: String,    // Merkle root of entire state
    pub utxo_count: u64,
    pub total_supply: u64,
    pub total_staked: u64,
    pub active_validators: u64,
    pub treasury_balance: u64,
    pub created_at: i64,
}

impl StateCheckpoint {
    /// Compute a state root from all state components
    pub fn compute_state_root(
        utxo_root: &str,
        staking_root: &str,
        governance_root: &str,
        fee_state: u64,
    ) -> String {
        let mut h = Sha256::new();
        h.update(b"HSMC_STATE_ROOT_V1");
        h.update(utxo_root.as_bytes());
        h.update(staking_root.as_bytes());
        h.update(governance_root.as_bytes());
        h.update(&fee_state.to_le_bytes());
        format!("0x{}", hex::encode(h.finalize()))
    }
}

// ─── Treasury ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Treasury {
    pub balance: u64,
    pub total_collected: u64,
    pub total_spent: u64,
    pub spending_history: Vec<TreasurySpend>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreasurySpend {
    pub proposal_id: String,
    pub recipient: String,
    pub amount: u64,
    pub purpose: String,
    pub block_height: u64,
    pub tx_hash: String,
}

impl Treasury {
    pub fn deposit(&mut self, amount: u64) {
        self.balance += amount;
        self.total_collected += amount;
    }

    pub fn spend(
        &mut self,
        proposal_id: String,
        recipient: String,
        amount: u64,
        purpose: String,
        block_height: u64,
        tx_hash: String,
    ) -> Result<(), String> {
        if amount > self.balance {
            return Err(format!("Insufficient treasury balance: {} < {}", self.balance, amount));
        }
        self.balance -= amount;
        self.total_spent += amount;
        self.spending_history.push(TreasurySpend {
            proposal_id, recipient, amount, purpose, block_height, tx_hash,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_staking_lifecycle() -> anyhow::Result<()> {
        let mut reg = StakingRegistry::new();
        let addr = "0xstaker1".to_string();

        reg.stake(addr.clone(), 500 * 100_000_000, 100, 100, None)?;
        assert_eq!(reg.total_staked, 500 * 100_000_000);

        // Distribute reward
        reg.distribute_block_reward(50 * 100_000_000, 101, 200);
        let rewards = reg.stakes[&addr].rewards_accumulated;
        assert!(rewards > 0);

        // Can't unstake during lock
        let result = reg.unstake(&addr, 100 * 100_000_000, 150);
        assert!(result.is_err());

        // Can unstake after lock
        reg.unstake(&addr, 100 * 100_000_000, 201)?;
        assert_eq!(reg.total_staked, 400 * 100_000_000);
        Ok(())
    }

    #[test]
    fn test_validator_slashing() -> anyhow::Result<()> {
        let mut reg = StakingRegistry::new();
        reg.register_validator(
            "0xval1".into(), "pubkey".into(), 500, 10_000 * 100_000_000
        )?;
        reg.validators.get_mut("0xval1")
            .ok_or_else(|| anyhow::anyhow!("Validator 0xval1 not found after registration"))?
            .total_delegated = 100_000 * 100_000_000;
        reg.total_staked = 100_000 * 100_000_000;

        let slashed = reg.slash_validator("0xval1", 5, 1000)?;
        assert_eq!(slashed, 5_000 * 100_000_000);
        assert_eq!(reg.validators["0xval1"].status, ValidatorStatus::Jailed);
        Ok(())
    }
}
