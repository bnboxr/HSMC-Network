/// ============================================================================
/// HSMC Hybrid PoS Consensus — Validator Management & Proposer Selection
/// ============================================================================
/// Implements the Proof-of-Stake layer for HSMC's hybrid PoW+PoS consensus:
///   - Validator registry with stake tracking
///   - Weighted proposer selection (deterministic, stake-proportional)
///   - Unbonding period enforcement (~28 days in blocks)
///   - Slashing for double-sign and inactivity
///   - Reward distribution tracking
///
/// Integration with PoW:
///   After a PoW block is mined, a PoS validator is selected (via `select_proposer`)
///   to co-sign the block. Block rewards are split 50/50 between miner and validator.
///   The validator's signature on the block header provides finality guarantees.
/// ============================================================================

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tracing::{info, warn, debug};
use ed25519_dalek::{SigningKey, VerifyingKey, Signature as Ed25519Signature, Signer, Verifier};
use rand::rngs::OsRng;
use rand::RngCore;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Minimum stake to become a validator (in atomic units: 1 HSMC = 10^8)
pub const MIN_VALIDATOR_STAKE: u64 = 10_000 * 100_000_000; // 10,000 HSMC

/// Unbonding period in blocks (~28 days at 2 min/block = 20,160 blocks)
pub const UNBONDING_PERIOD_BLOCKS: u64 = 20_160;

/// Maximum commission rate a validator can charge (50% = 5000 bps)
pub const MAX_COMMISSION_BPS: u16 = 5000;

/// Maximum number of active validators in the set
pub const MAX_VALIDATORS: usize = 128;

/// Slashing penalty for double-sign (% of stake, e.g. 5 = 5%)
pub const DOUBLE_SIGN_SLASH_PERCENT: u8 = 5;

/// Slashing penalty for severe inactivity (% of stake)
pub const INACTIVITY_SLASH_PERCENT: u8 = 1;

/// Jail duration in blocks (~1 day at 2 min/block)
pub const JAIL_DURATION_BLOCKS: u64 = 720;

/// Fraction of block reward going to the PoS validator (remainder goes to PoW miner)
pub const POS_REWARD_SHARE: f64 = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Validator
// ─────────────────────────────────────────────────────────────────────────────

/// A single validator in the PoS consensus set.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Validator {
    /// HSMC address of the validator
    pub address: String,
    /// Total stake (self-bonded + delegated) in atomic units
    pub stake: u64,
    /// Self-bonded amount (cannot be withdrawn below MIN_VALIDATOR_STAKE)
    pub self_bond: u64,
    /// Public key used for block signing (hex-encoded)
    pub public_key: String,
    /// Commission rate in basis points (e.g. 500 = 5%)
    pub commission_rate_bps: u16,
    /// Last block height this validator signed
    pub last_block: u64,
    /// Cumulative blocks signed (uptime tracker)
    pub blocks_signed: u64,
    /// Cumulative blocks missed
    pub blocks_missed: u64,
    /// Current validator status
    pub status: ValidatorStatus,
    /// Delegate addresses and their stake amounts
    pub delegators: HashMap<String, u64>,
    /// Pending unbonding entries: (address, amount, unlock_height)
    pub unbonding_queue: Vec<UnbondingEntry>,
    /// Accumulated rewards not yet claimed
    pub rewards_accumulated: u64,
    /// Penalty points (for graduated slashing)
    pub penalty_points: u32,
    /// Block height until which validator is jailed (None = not jailed)
    pub jailed_until: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ValidatorStatus {
    /// Actively signing blocks
    Active,
    /// Registered but not in the active set
    Inactive,
    /// Temporarily removed from the active set (slashing or inactivity)
    Jailed,
    /// Permanently removed (severe slashing)
    Tombstoned,
    /// In unbonding period
    Unbonding,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UnbondingEntry {
    pub delegator_address: String,
    pub amount: u64,
    pub unlock_height: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// ValidatorSet
// ─────────────────────────────────────────────────────────────────────────────

/// The complete set of PoS validators with management operations.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ValidatorSet {
    /// All registered validators keyed by address
    pub validators: HashMap<String, Validator>,
    /// Total staked across all validators (active + inactive)
    pub total_stake: u64,
    /// Total active stake (only Active validators)
    pub active_stake: u64,
    /// Current epoch number
    pub epoch: u64,
    /// Validator addresses ordered by stake (cached for proposer selection)
    #[serde(skip)]
    active_order: Vec<String>,
    /// Whether active_order cache is dirty
    #[serde(skip)]
    cache_dirty: bool,
}

impl ValidatorSet {
    /// Create a new empty validator set.
    pub fn new() -> Self {
        Self {
            validators: HashMap::new(),
            total_stake: 0,
            active_stake: 0,
            epoch: 0,
            active_order: Vec::new(),
            cache_dirty: false,
        }
    }

    // ── Counts ────────────────────────────────────────────────────────────

    pub fn len(&self) -> usize {
        self.validators.len()
    }

    pub fn is_empty(&self) -> bool {
        self.validators.is_empty()
    }

    pub fn active_count(&self) -> usize {
        self.validators
            .values()
            .filter(|v| v.status == ValidatorStatus::Active)
            .count()
    }

    // ── Staking ───────────────────────────────────────────────────────────

    /// Stake tokens to become a validator or increase existing stake.
    pub fn stake(
        &mut self,
        address: String,
        amount: u64,
        public_key: String,
        commission_rate_bps: u16,
    ) -> Result<(), PosError> {
        if amount == 0 {
            return Err(PosError::ZeroStake);
        }
        if commission_rate_bps > MAX_COMMISSION_BPS {
            return Err(PosError::CommissionTooHigh {
                rate: commission_rate_bps,
                max: MAX_COMMISSION_BPS,
            });
        }

        if let Some(validator) = self.validators.get_mut(&address) {
            if validator.status == ValidatorStatus::Tombstoned {
                return Err(PosError::ValidatorTombstoned { address });
            }
            validator.stake += amount;
            validator.self_bond += amount;
            self.total_stake += amount;
            if validator.status == ValidatorStatus::Active {
                self.active_stake += amount;
            }
            self.cache_dirty = true;
            info!(
                "🥩 Stake increased: {} +{} atomic units (total: {})",
                &address[..12.min(address.len())],
                amount,
                validator.stake
            );
        } else {
            if amount < MIN_VALIDATOR_STAKE {
                return Err(PosError::InsufficientStake {
                    required: MIN_VALIDATOR_STAKE,
                    provided: amount,
                });
            }
            if public_key.is_empty() {
                return Err(PosError::MissingPublicKey);
            }
            if self.len() >= MAX_VALIDATORS {
                return Err(PosError::ValidatorSetFull { max: MAX_VALIDATORS });
            }

            let validator = Validator {
                address: address.clone(),
                stake: amount,
                self_bond: amount,
                public_key,
                commission_rate_bps,
                last_block: 0,
                blocks_signed: 0,
                blocks_missed: 0,
                status: ValidatorStatus::Active,
                delegators: HashMap::new(),
                unbonding_queue: Vec::new(),
                rewards_accumulated: 0,
                penalty_points: 0,
                jailed_until: None,
            };

            self.validators.insert(address.clone(), validator);
            self.total_stake += amount;
            self.active_stake += amount;
            self.cache_dirty = true;
            info!(
                "🥩 New validator: {} with {} atomic units",
                &address[..12.min(address.len())],
                amount
            );
        }
        Ok(())
    }

    /// Delegate stake to an existing validator.
    pub fn delegate(
        &mut self,
        delegator_address: String,
        validator_address: String,
        amount: u64,
    ) -> Result<(), PosError> {
        if amount == 0 {
            return Err(PosError::ZeroStake);
        }
        let validator = self
            .validators
            .get_mut(&validator_address)
            .ok_or_else(|| PosError::ValidatorNotFound {
                address: validator_address.clone(),
            })?;
        if validator.status == ValidatorStatus::Tombstoned {
            return Err(PosError::ValidatorTombstoned {
                address: validator_address,
            });
        }
        validator.stake += amount;
        *validator
            .delegators
            .entry(delegator_address.clone())
            .or_insert(0) += amount;
        self.total_stake += amount;
        if validator.status == ValidatorStatus::Active {
            self.active_stake += amount;
        }
        self.cache_dirty = true;
        debug!(
            "Delegate: {} → {} (+{} units)",
            &delegator_address[..12.min(delegator_address.len())],
            &validator_address[..12.min(validator_address.len())],
            amount
        );
        Ok(())
    }

    // ── Unstaking & Unbonding ─────────────────────────────────────────────

    /// Initiate unstaking. If remaining self-bond would fall below MIN_VALIDATOR_STAKE,
    /// the entire stake enters unbonding. Tokens locked for UNBONDING_PERIOD_BLOCKS.
    pub fn unstake(
        &mut self,
        address: &str,
        amount: u64,
        current_height: u64,
    ) -> Result<(), PosError> {
        let validator = self
            .validators
            .get_mut(address)
            .ok_or_else(|| PosError::ValidatorNotFound {
                address: address.to_string(),
            })?;
        if validator.status == ValidatorStatus::Unbonding {
            return Err(PosError::AlreadyUnbonding {
                address: address.to_string(),
            });
        }
        if amount == 0 {
            return Err(PosError::ZeroStake);
        }
        if amount > validator.self_bond {
            return Err(PosError::InsufficientBond {
                available: validator.self_bond,
                requested: amount,
            });
        }

        let unlock_height = current_height + UNBONDING_PERIOD_BLOCKS;
        let remaining_bond = validator.self_bond.saturating_sub(amount);

        if remaining_bond > 0 && remaining_bond < MIN_VALIDATOR_STAKE {
            // Full unbonding
            let full_amount = validator.self_bond;
            validator.unbonding_queue.push(UnbondingEntry {
                delegator_address: address.to_string(),
                amount: full_amount,
                unlock_height,
            });
            validator.self_bond = 0;
            validator.stake = validator.stake.saturating_sub(full_amount);
            validator.status = ValidatorStatus::Unbonding;
            self.total_stake = self.total_stake.saturating_sub(full_amount);
            self.active_stake = self.active_stake.saturating_sub(full_amount);
            self.cache_dirty = true;
            info!(
                "🔓 Validator {} entering full unbonding ({} units)",
                &address[..12.min(address.len())],
                full_amount
            );
        } else {
            validator.unbonding_queue.push(UnbondingEntry {
                delegator_address: address.to_string(),
                amount,
                unlock_height,
            });
            validator.self_bond -= amount;
            validator.stake -= amount;
            self.total_stake = self.total_stake.saturating_sub(amount);
            if validator.status == ValidatorStatus::Active {
                self.active_stake = self.active_stake.saturating_sub(amount);
            }
            self.cache_dirty = true;
            info!(
                "🔓 Validator {} unbonding {} units (unlock at #{})",
                &address[..12.min(address.len())],
                amount,
                unlock_height
            );
        }
        Ok(())
    }

    /// Process completed unbonding periods. Returns released (address, amount) pairs.
    pub fn process_unbonding(&mut self, current_height: u64) -> Vec<(String, u64)> {
        let mut released = Vec::new();
        let addresses: Vec<String> = self.validators.keys().cloned().collect();
        for addr in addresses {
            let mut to_remove = false;
            if let Some(validator) = self.validators.get_mut(&addr) {
                let mut i = 0;
                while i < validator.unbonding_queue.len() {
                    if validator.unbonding_queue[i].unlock_height <= current_height {
                        let entry = validator.unbonding_queue.remove(i);
                        released.push((entry.delegator_address.clone(), entry.amount));
                    } else {
                        i += 1;
                    }
                }
                if validator.unbonding_queue.is_empty()
                    && validator.status == ValidatorStatus::Unbonding
                {
                    to_remove = true;
                }
            }
            if to_remove {
                self.validators.remove(&addr);
                info!(
                    "🗑️  Validator {} fully unbonded and removed",
                    &addr[..12.min(addr.len())]
                );
            }
        }
        self.cache_dirty = !released.is_empty();
        released
    }

    // ── Proposer Selection ────────────────────────────────────────────────

    /// Select a proposer deterministically from the active validator set
    /// based on a seed (e.g., previous block hash + current height).
    /// Selection is stake-weighted. Returns validator address or None.
    pub fn select_proposer(&mut self, seed: &[u8]) -> Option<String> {
        if self.active_stake == 0 {
            return None;
        }
        if self.cache_dirty || self.active_order.is_empty() {
            self.rebuild_active_cache();
        }
        let hash = Sha256::digest(seed);
        let random_value = u64::from_be_bytes([
            hash[0], hash[1], hash[2], hash[3],
            hash[4], hash[5], hash[6], hash[7],
        ]);
        let point = random_value % self.active_stake;

        let mut cumulative: u64 = 0;
        for addr in &self.active_order {
            if let Some(v) = self.validators.get(addr) {
                cumulative += v.stake;
                if cumulative > point {
                    return Some(addr.clone());
                }
            }
        }
        self.active_order.last().cloned()
    }

    fn rebuild_active_cache(&mut self) {
        let mut active: Vec<&Validator> = self
            .validators
            .values()
            .filter(|v| v.status == ValidatorStatus::Active)
            .collect();
        active.sort_by(|a, b| b.stake.cmp(&a.stake));
        self.active_order = active.into_iter().map(|v| v.address.clone()).collect();
        self.cache_dirty = false;
    }

    /// Get a reference to a validator.
    pub fn get(&self, address: &str) -> Option<&Validator> {
        self.validators.get(address)
    }

    /// Check if a validator is active.
    pub fn is_active(&self, address: &str) -> bool {
        self.validators
            .get(address)
            .map(|v| v.status == ValidatorStatus::Active)
            .unwrap_or(false)
    }

    /// Record that a validator signed a block at the given height.
    pub fn record_block_signed(&mut self, address: &str, block_height: u64) {
        if let Some(v) = self.validators.get_mut(address) {
            v.last_block = block_height;
            v.blocks_signed += 1;
        }
    }

    /// Record that a validator missed their slot.
    pub fn record_block_missed(&mut self, address: &str, _block_height: u64) {
        if let Some(v) = self.validators.get_mut(address) {
            v.blocks_missed += 1;
        }
    }

    // ── Slashing ──────────────────────────────────────────────────────────

    /// Slash for double-signing: 5% penalty, jailed.
    pub fn slash_double_sign(
        &mut self,
        address: &str,
        current_height: u64,
    ) -> Result<u64, PosError> {
        let slashed = self.slash_validator_internal(
            address,
            DOUBLE_SIGN_SLASH_PERCENT,
            current_height + JAIL_DURATION_BLOCKS,
            true,
        )?;
        warn!(
            "⚡ DOUBLE-SIGN SLASH: {} slashed {} units (5%)",
            &address[..12.min(address.len())],
            slashed
        );
        Ok(slashed)
    }

    /// Slash for inactivity: 1% penalty, jailed.
    pub fn slash_inactivity(
        &mut self,
        address: &str,
        current_height: u64,
    ) -> Result<u64, PosError> {
        let slashed = self.slash_validator_internal(
            address,
            INACTIVITY_SLASH_PERCENT,
            current_height + JAIL_DURATION_BLOCKS,
            false,
        )?;
        warn!(
            "💤 INACTIVITY SLASH: {} slashed {} units (1%)",
            &address[..12.min(address.len())],
            slashed
        );
        Ok(slashed)
    }

    /// Check all active validators and slash those below uptime threshold.
    pub fn slash_inactive_validators(
        &mut self,
        current_height: u64,
        window_blocks: u64,
        min_signed: u64,
    ) -> u64 {
        let mut slashed_count = 0u64;
        let addresses: Vec<String> = self
            .validators
            .iter()
            .filter(|(_, v)| v.status == ValidatorStatus::Active)
            .map(|(a, _)| a.clone())
            .collect();
        for addr in addresses {
            if let Some(v) = self.validators.get(&addr) {
                let total = v.blocks_signed + v.blocks_missed;
                let relevant = total.min(window_blocks);
                let signed_in_window =
                    if relevant > 0 {
                        (v.blocks_signed as f64 * (window_blocks as f64 / relevant as f64)) as u64
                    } else {
                        0
                    };
                if signed_in_window < min_signed {
                    let _ = self.slash_inactivity(&addr, current_height);
                    slashed_count += 1;
                }
            }
        }
        slashed_count
    }

    fn slash_validator_internal(
        &mut self,
        address: &str,
        slash_percent: u8,
        jailed_until: u64,
        is_double_sign: bool,
    ) -> Result<u64, PosError> {
        let validator = self
            .validators
            .get_mut(address)
            .ok_or_else(|| PosError::ValidatorNotFound {
                address: address.to_string(),
            })?;
        let slash_amount =
            (validator.stake as u128 * slash_percent as u128 / 100) as u64;
        validator.stake = validator.stake.saturating_sub(slash_amount);
        validator.penalty_points += if is_double_sign { 100 } else { 10 };
        validator.status = ValidatorStatus::Jailed;
        validator.jailed_until = Some(jailed_until);
        self.total_stake = self.total_stake.saturating_sub(slash_amount);
        self.active_stake = self.active_stake.saturating_sub(slash_amount);
        self.cache_dirty = true;
        Ok(slash_amount)
    }

    // ── Jail Management ───────────────────────────────────────────────────

    /// Release jailed validators whose jail period has expired.
    pub fn release_expired_jails(&mut self, current_height: u64) -> u64 {
        let mut released = 0u64;
        let addresses: Vec<String> = self
            .validators
            .iter()
            .filter(|(_, v)| v.status == ValidatorStatus::Jailed)
            .map(|(a, _)| a.clone())
            .collect();
        for addr in addresses {
            if let Some(v) = self.validators.get_mut(&addr) {
                if let Some(until) = v.jailed_until {
                    if current_height >= until {
                        v.status = ValidatorStatus::Active;
                        v.jailed_until = None;
                        v.penalty_points = v.penalty_points.saturating_sub(5);
                        self.active_stake += v.stake;
                        self.cache_dirty = true;
                        released += 1;
                        info!("🔓 Validator {} released from jail",
                            &addr[..12.min(addr.len())]);
                    }
                }
            }
        }
        released
    }

    // ── Reward Distribution ───────────────────────────────────────────────

    /// Distribute PoS block rewards with commission split.
    pub fn distribute_reward(
        &mut self,
        validator_address: &str,
        reward_amount: u64,
        block_height: u64,
    ) -> Result<(), PosError> {
        let validator = self
            .validators
            .get_mut(validator_address)
            .ok_or_else(|| PosError::ValidatorNotFound {
                address: validator_address.to_string(),
            })?;
        if reward_amount == 0 {
            return Ok(());
        }
        let commission =
            (reward_amount as u128 * validator.commission_rate_bps as u128 / 10_000) as u64;
        let remaining = reward_amount - commission;
        validator.rewards_accumulated += commission + remaining;
        validator.last_block = block_height;
        validator.blocks_signed += 1;
        debug!(
            "💰 Reward to {}: {} units (commission: {}, stakers: {})",
            &validator_address[..12.min(validator_address.len())],
            reward_amount, commission, remaining
        );
        Ok(())
    }

    /// Claim accumulated rewards.
    pub fn claim_rewards(&mut self, address: &str) -> Result<u64, PosError> {
        let validator = self
            .validators
            .get_mut(address)
            .ok_or_else(|| PosError::ValidatorNotFound {
                address: address.to_string(),
            })?;
        let rewards = validator.rewards_accumulated;
        validator.rewards_accumulated = 0;
        Ok(rewards)
    }

    // ── Epoch ─────────────────────────────────────────────────────────────

    pub fn advance_epoch(&mut self, current_height: u64) {
        self.epoch += 1;
        self.release_expired_jails(current_height);
        self.cache_dirty = true;
        debug!("📅 Advanced to epoch {}", self.epoch);
    }

    // ── Snapshots ─────────────────────────────────────────────────────────

    pub fn to_snapshot(&self) -> PosSnapshot {
        PosSnapshot {
            validators: self.validators.clone(),
            total_stake: self.total_stake,
            active_stake: self.active_stake,
            epoch: self.epoch,
        }
    }

    pub fn load_snapshot(&mut self, snap: PosSnapshot) {
        self.validators = snap.validators;
        self.total_stake = snap.total_stake;
        self.active_stake = snap.active_stake;
        self.epoch = snap.epoch;
        self.cache_dirty = true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PosError
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PosError {
    ZeroStake,
    InsufficientStake { required: u64, provided: u64 },
    InsufficientBond { available: u64, requested: u64 },
    CommissionTooHigh { rate: u16, max: u16 },
    MissingPublicKey,
    ValidatorNotFound { address: String },
    ValidatorTombstoned { address: String },
    ValidatorSetFull { max: usize },
    AlreadyUnbonding { address: String },
    DelegatorNotFound { address: String, validator: String },
}

impl std::fmt::Display for PosError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ZeroStake => write!(f, "Stake amount cannot be zero"),
            Self::InsufficientStake { required, provided } => write!(
                f, "Insufficient stake: {} required, {} provided", required, provided),
            Self::InsufficientBond { available, requested } => write!(
                f, "Insufficient bond: {} available, {} requested", available, requested),
            Self::CommissionTooHigh { rate, max } => write!(
                f, "Commission too high: {} bps (max {})", rate, max),
            Self::MissingPublicKey => write!(f, "Public key required for new validator"),
            Self::ValidatorNotFound { address } => write!(f, "Validator not found: {}", address),
            Self::ValidatorTombstoned { address } => write!(f, "Validator tombstoned: {}", address),
            Self::ValidatorSetFull { max } => write!(f, "Validator set full (max {})", max),
            Self::AlreadyUnbonding { address } => write!(f, "Already unbonding: {}", address),
            Self::DelegatorNotFound { address, validator } => write!(
                f, "Delegator {} not found for validator {}", address, validator),
        }
    }
}

impl std::error::Error for PosError {}

// ─────────────────────────────────────────────────────────────────────────────
// Reward Split Utilities
// ─────────────────────────────────────────────────────────────────────────────

/// Compute the PoS validator reward portion from a total block reward.
pub fn pos_validator_reward(total_block_reward: u64) -> u64 {
    (total_block_reward as f64 * POS_REWARD_SHARE) as u64
}

/// Compute the PoW miner reward portion from a total block reward.
pub fn pow_miner_reward(total_block_reward: u64) -> u64 {
    total_block_reward - pos_validator_reward(total_block_reward)
}

// ─────────────────────────────────────────────────────────────────────────────
// ValidatorKey
// ─────────────────────────────────────────────────────────────────────────────

/// Ed25519 keypair for validator block signing.
/// Uses RFC 8032 Ed25519 — 32-byte secret key, 32-byte public key, 64-byte signatures.
#[derive(Clone)]
pub struct ValidatorKey {
    pub signing_key: SigningKey,
}

impl ValidatorKey {
    /// Generate a new random Ed25519 keypair using OS CSPRNG.
    pub fn generate() -> Self {
        let mut rng = OsRng;
        // ed25519-dalek 2.x removed `SigningKey::generate`; derive a random
        // 32-byte seed from the CSPRNG and build the key from it instead.
        let mut seed = [0u8; 32];
        rng.fill_bytes(&mut seed);
        Self {
            signing_key: SigningKey::from_bytes(&seed),
        }
    }

    /// Reconstruct from 32-byte seed bytes.
    pub fn from_bytes(bytes: &[u8; 32]) -> Option<Self> {
        Some(Self {
            signing_key: SigningKey::from_bytes(bytes),
        })
    }

    /// Get the raw 32-byte secret key.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }

    /// Get the 32-byte public key (verifying key).
    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }
}

impl std::fmt::Debug for ValidatorKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ValidatorKey")
            .field("public_key", &hex::encode(self.public_key_bytes()))
            .finish()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ValidatorSignature
// ─────────────────────────────────────────────────────────────────────────────

/// A validator's Ed25519 signature over a block header.
/// Signs `(validator_address || block_hash || block_height)`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ValidatorSignature {
    pub validator_address: String,
    /// 32-byte Ed25519 public key (verifying key).
    pub public_key: [u8; 32],
    /// 64-byte Ed25519 signature.
    pub signature: Vec<u8>,
    pub block_height: u64,
    pub block_hash: String,
}

impl ValidatorSignature {
    /// Create a new Ed25519 validator signature.
    /// Signs the message `address || block_hash || height_le`.
    pub fn sign(
        validator_address: String,
        key: &ValidatorKey,
        block_hash: String,
        block_height: u64,
    ) -> Self {
        let mut message = Vec::with_capacity(
            validator_address.len() + block_hash.len() + 8,
        );
        message.extend_from_slice(validator_address.as_bytes());
        message.extend_from_slice(block_hash.as_bytes());
        message.extend_from_slice(&block_height.to_le_bytes());

        let sig: Ed25519Signature = key.signing_key.sign(&message);
        let public_key = key.public_key_bytes();

        Self {
            validator_address,
            public_key,
            signature: sig.to_bytes().to_vec(),
            block_height,
            block_hash,
        }
    }

    /// Verify the Ed25519 signature against the embedded public key and message.
    /// Returns true only if all of: address matches, public key is valid,
    /// signature is valid for `(address || block_hash || height)`.
    pub fn verify(&self, expected_validator_address: &str) -> bool {
        if expected_validator_address != self.validator_address {
            return false;
        }

        let verifying_key = match VerifyingKey::from_bytes(&self.public_key) {
            Ok(vk) => vk,
            Err(_) => return false,
        };

        let sig = match Ed25519Signature::from_slice(&self.signature) {
            Ok(s) => s,
            Err(_) => return false,
        };

        let mut message = Vec::with_capacity(
            self.validator_address.len() + self.block_hash.len() + 8,
        );
        message.extend_from_slice(self.validator_address.as_bytes());
        message.extend_from_slice(self.block_hash.as_bytes());
        message.extend_from_slice(&self.block_height.to_le_bytes());

        verifying_key.verify(&message, &sig).is_ok()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PosSnapshot
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosSnapshot {
    pub validators: HashMap<String, Validator>,
    pub total_stake: u64,
    pub active_stake: u64,
    pub epoch: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn a(s: &str) -> String {
        format!("HSMC_{}_0000000000000000000000000000000", s)
    }

    fn register(vs: &mut ValidatorSet, name: &str, stake: u64) {
        vs.stake(a(name), stake, format!("pk_{}", name), 500).unwrap();
    }

    // ── Stake ────────────────────────────────────────────────────────────

    #[test]
    fn test_stake_new_validator() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        assert_eq!(vs.len(), 1);
        assert_eq!(vs.active_count(), 1);
    }

    #[test]
    fn test_stake_insufficient() {
        let mut vs = ValidatorSet::new();
        let res = vs.stake(a("val1"), MIN_VALIDATOR_STAKE - 1, "pk".into(), 500);
        assert!(matches!(res, Err(PosError::InsufficientStake { .. })));
    }

    #[test]
    fn test_stake_top_up() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        vs.stake(a("val1"), 1000 * 100_000_000, String::new(), 500).unwrap();
        assert_eq!(vs.total_stake, MIN_VALIDATOR_STAKE + 1000 * 100_000_000);
    }

    // ── Unstake ──────────────────────────────────────────────────────────

    #[test]
    fn test_unstake_partial() {
        let mut vs = ValidatorSet::new();
        let total = MIN_VALIDATOR_STAKE + 5000 * 100_000_000;
        register(&mut vs, "val1", total);
        vs.unstake(&a("val1"), 5000 * 100_000_000, 100).unwrap();
        let v = vs.get(&a("val1")).unwrap();
        assert_eq!(v.status, ValidatorStatus::Active);
        assert_eq!(v.self_bond, MIN_VALIDATOR_STAKE);
    }

    #[test]
    fn test_unstake_full_below_minimum() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        vs.unstake(&a("val1"), 1 * 100_000_000, 100).unwrap();
        let v = vs.get(&a("val1")).unwrap();
        assert_eq!(v.status, ValidatorStatus::Unbonding);
    }

    #[test]
    fn test_unbonding_processed() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        vs.unstake(&a("val1"), 1 * 100_000_000, 100).unwrap();

        // Still locked
        let r = vs.process_unbonding(100);
        assert!(r.is_empty());
        assert!(vs.get(&a("val1")).is_some());

        // Expired
        let r = vs.process_unbonding(100 + UNBONDING_PERIOD_BLOCKS);
        assert!(!r.is_empty());
        assert!(vs.get(&a("val1")).is_none());
    }

    // ── Proposer Selection ────────────────────────────────────────────────

    #[test]
    fn test_select_proposer_empty() {
        let mut vs = ValidatorSet::new();
        assert_eq!(vs.select_proposer(b"seed"), None);
    }

    #[test]
    fn test_select_proposer_single() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        assert_eq!(vs.select_proposer(b"seed"), Some(a("val1")));
    }

    #[test]
    fn test_select_proposer_deterministic() {
        let mut vs = ValidatorSet::new();
        for i in 1..=5 {
            register(&mut vs, &format!("val{}", i), MIN_VALIDATOR_STAKE * i as u64);
        }
        let s1 = vs.select_proposer(b"fixed_seed");
        let s2 = vs.select_proposer(b"fixed_seed");
        assert_eq!(s1, s2);
    }

    #[test]
    fn test_select_proposer_always_finds_active() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        register(&mut vs, "val2", MIN_VALIDATOR_STAKE * 2);
        let selected = vs.select_proposer(b"any_seed");
        assert!(selected.is_some());
        let sel = selected.unwrap();
        assert!(sel == a("val1") || sel == a("val2"));
    }

    // ── Slashing ──────────────────────────────────────────────────────────

    #[test]
    fn test_double_sign_slash() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE * 10);
        let slashed = vs.slash_double_sign(&a("val1"), 1000).unwrap();
        assert!(slashed > 0);
        let v = vs.get(&a("val1")).unwrap();
        assert_eq!(v.status, ValidatorStatus::Jailed);
        assert_eq!(v.penalty_points, 100);
    }

    #[test]
    fn test_inactivity_slash() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE * 10);
        let slashed = vs.slash_inactivity(&a("val1"), 1000).unwrap();
        assert!(slashed > 0);
        let v = vs.get(&a("val1")).unwrap();
        assert_eq!(v.status, ValidatorStatus::Jailed);
        assert_eq!(v.penalty_points, 10);
    }

    #[test]
    fn test_slash_nonexistent() {
        let mut vs = ValidatorSet::new();
        let res = vs.slash_double_sign(&a("ghost"), 100);
        assert!(matches!(res, Err(PosError::ValidatorNotFound { .. })));
    }

    // ── Jail release ──────────────────────────────────────────────────────

    #[test]
    fn test_jail_release() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        vs.slash_double_sign(&a("val1"), 100).unwrap();
        assert_eq!(vs.get(&a("val1")).unwrap().status, ValidatorStatus::Jailed);
        let released = vs.release_expired_jails(100 + JAIL_DURATION_BLOCKS);
        assert_eq!(released, 1);
        assert_eq!(vs.get(&a("val1")).unwrap().status, ValidatorStatus::Active);
    }

    // ── Reward distribution ───────────────────────────────────────────────

    #[test]
    fn test_reward_split_utilities() {
        let total = 50 * 100_000_000; // 50 HSMC
        let pos = pos_validator_reward(total);
        let pow = pow_miner_reward(total);
        assert_eq!(pos + pow, total);
        assert_eq!(pos, 25 * 100_000_000);
        assert_eq!(pow, 25 * 100_000_000);
    }

    #[test]
    fn test_distribute_reward() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        vs.distribute_reward(&a("val1"), 50 * 100_000_000, 100).unwrap();
        let v = vs.get(&a("val1")).unwrap();
        assert_eq!(v.rewards_accumulated, 50 * 100_000_000);
        assert_eq!(v.last_block, 100);
        assert_eq!(v.blocks_signed, 1);
    }

    #[test]
    fn test_claim_rewards() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        vs.distribute_reward(&a("val1"), 100 * 100_000_000, 100).unwrap();
        let claimed = vs.claim_rewards(&a("val1")).unwrap();
        assert_eq!(claimed, 100 * 100_000_000);
        assert_eq!(vs.get(&a("val1")).unwrap().rewards_accumulated, 0);
    }

    // ── Delegation ────────────────────────────────────────────────────────

    #[test]
    fn test_delegate() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        vs.delegate(a("del1"), a("val1"), 5000 * 100_000_000).unwrap();
        let v = vs.get(&a("val1")).unwrap();
        assert_eq!(v.delegators.get(&a("del1")), Some(&(5000 * 100_000_000)));
        assert_eq!(v.stake, MIN_VALIDATOR_STAKE + 5000 * 100_000_000);
    }

    // ── ValidatorSignature ────────────────────────────────────────────────

    #[test]
    fn test_signature_sign_and_verify() {
        let key = ValidatorKey::generate();
        let sig = ValidatorSignature::sign(
            a("val1"), &key, "blockhash123".into(), 42,
        );
        assert!(sig.verify(&a("val1")));
    }

    #[test]
    fn test_signature_rejects_wrong_address() {
        let key = ValidatorKey::generate();
        let sig = ValidatorSignature::sign(
            a("val1"), &key, "blockhash123".into(), 42,
        );
        assert!(!sig.verify(&a("val2")));
    }

    #[test]
    fn test_signature_tamper_resistant() {
        let key = ValidatorKey::generate();
        let mut sig = ValidatorSignature::sign(
            a("val1"), &key, "blockhash123".into(), 42,
        );
        sig.block_hash = "tampered".into();
        assert!(!sig.verify(&a("val1")));
    }

    #[test]
    fn test_signature_rejects_wrong_key() {
        let key1 = ValidatorKey::generate();
        let key2 = ValidatorKey::generate();
        let mut sig = ValidatorSignature::sign(
            a("val1"), &key1, "blockhash123".into(), 42,
        );
        // Replace the public key with key2's — should fail
        sig.public_key = key2.public_key_bytes();
        assert!(!sig.verify(&a("val1")));
    }

    #[test]
    fn test_signature_rejects_corrupted_signature() {
        let key = ValidatorKey::generate();
        let mut sig = ValidatorSignature::sign(
            a("val1"), &key, "blockhash123".into(), 42,
        );
        // Flip a byte in the signature
        sig.signature[0] ^= 0xFF;
        assert!(!sig.verify(&a("val1")));
    }

    #[test]
    fn test_validator_key_roundtrip() {
        let key = ValidatorKey::generate();
        let bytes = key.to_bytes();
        let restored = ValidatorKey::from_bytes(&bytes).unwrap();
        assert_eq!(key.public_key_bytes(), restored.public_key_bytes());
    }

    // ── Snapshot round-trip ───────────────────────────────────────────────

    #[test]
    fn test_snapshot_roundtrip() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        register(&mut vs, "val2", MIN_VALIDATOR_STAKE * 2);
        let snap = vs.to_snapshot();

        let mut vs2 = ValidatorSet::new();
        vs2.load_snapshot(snap);
        assert_eq!(vs2.len(), 2);
        assert_eq!(vs2.total_stake, vs.total_stake);
        assert_eq!(vs2.active_stake, vs.active_stake);
    }

    // ── Inactive validator slashing scan ──────────────────────────────────

    #[test]
    fn test_slash_inactive_validators() {
        let mut vs = ValidatorSet::new();
        register(&mut vs, "val1", MIN_VALIDATOR_STAKE);
        // Force many missed blocks
        if let Some(v) = vs.validators.get_mut(&a("val1")) {
            v.blocks_missed = 1000;
            v.blocks_signed = 0;
        }
        let slashed = vs.slash_inactive_validators(1000, 1000, 500);
        assert_eq!(slashed, 1);
    }
}
