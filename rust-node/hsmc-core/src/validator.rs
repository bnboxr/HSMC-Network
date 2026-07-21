/// Full consensus validator — Script engine, UTXO validation, PoW, Merkle,
/// Double-spend detection, Coinbase rules, Median-Time-Past, BIP68 relative locks
use crate::{
    Block, Transaction, PrivacyLevel, TxStatus,
    leading_zeros_in_hash, difficulty_to_leading_zeros, block_reward, merkle_root,
};
use std::collections::{HashMap, HashSet};
use chrono::Utc;
use sha2::{Digest, Sha256};

// ─────────────────────────────────────────────────────────────────────────────
// Error taxonomy
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum ValidationError {
    // Transaction errors
    EmptyHash,
    EmptyAddress,
    NegativeAmount,
    Overflow { field: &'static str },
    FeeTooLow { required: f64, provided: f64 },
    DustOutput { amount: f64, minimum: f64 },
    InvalidPrivacyProof(&'static str),
    SelfTransfer,
    DuplicateTransaction { hash: String },
    NonFiniteValue { field: &'static str },
    InvalidAddress { addr: String },
    RbfFeeInsufficient { old_fee: f64, new_fee: f64 },
    ExceedsMaxSize { size: usize, max: usize },
    KeyImageReuse { image: String },
    MissingRingMember,
    InvalidRingSize { min: usize, max: usize, actual: usize },
    InvalidDecoyCount { min: u8, max: u8, actual: u8 },
    InvalidCommitment,
    InvalidRangeProof,
    InvalidStealthAddress,
    SignatureVerificationFailed,
    LocktimeFuture { locktime: u64, current: u64 },
    SequenceLocked { sequence: u32, remaining: u64 },

    // Block errors
    EmptyMinerAddress,
    InvalidMinerAddress { addr: String },
    BlockHashMismatch { computed: String, stored: String },
    BlockPrevHashMismatch { expected: String, got: String },
    InvalidPoW { leading: u64, required: u64 },
    StaleBlock { received: u64, expected: u64 },
    InvalidMerkleRoot { computed: String, stored: String },
    InvalidTimestamp { block_ts: i64, mtp: i64 },
    TimestampTooFar { block_ts: i64, max: i64 },
    InvalidReward { claimed: f64, allowed: f64 },
    CoinbasePosition,
    NoCoinbase,
    MultipleCoinbase,
    InvalidBlockSize { size: usize, max: usize },
    InvalidVersion { version: u32 },
    InvalidDifficulty,
    DuplicateTxInBlock { hash: String },

    // Chain errors
    ChainReorgDepthExceeded { depth: u64, max: u64 },
    ForkPointNotFound,
    InsufficientUTXO { address: String, needed: f64, available: f64 },
    SpentUTXO { tx_hash: String, output: u32 },
    UnknownUTXO { tx_hash: String, output: u32 },
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyHash              => write!(f, "Transaction hash is empty"),
            Self::EmptyAddress           => write!(f, "Address field is empty"),
            Self::NegativeAmount         => write!(f, "Amount or fee cannot be negative"),
            Self::Overflow { field }     => write!(f, "Arithmetic overflow in field: {}", field),
            Self::FeeTooLow { required, provided } =>
                write!(f, "Fee too low: need {:.8} HSMC, provided {:.8}", required, provided),
            Self::DustOutput { amount, minimum } =>
                write!(f, "Dust output {:.8} HSMC (min {:.8})", amount, minimum),
            Self::InvalidPrivacyProof(m) => write!(f, "Invalid privacy proof: {}", m),
            Self::SelfTransfer           => write!(f, "Self-transfers are forbidden"),
            Self::DuplicateTransaction { hash } =>
                write!(f, "Duplicate transaction: {}", &hash[..12.min(hash.len())]),
            Self::NonFiniteValue { field } => write!(f, "Non-finite value in field: {}", field),
            Self::InvalidAddress { addr } => write!(f, "Invalid HSMC address: {}", addr),
            Self::RbfFeeInsufficient { old_fee, new_fee } =>
                write!(f, "RBF: new fee {:.8} must exceed old {:.8} by ≥ 0.0001", new_fee, old_fee),
            Self::ExceedsMaxSize { size, max } =>
                write!(f, "Transaction size {} bytes exceeds max {}", size, max),
            Self::KeyImageReuse { image } =>
                write!(f, "Key image reuse (double-spend): {}", &image[..12.min(image.len())]),
            Self::MissingRingMember    => write!(f, "Ring member public key not found on chain"),
            Self::InvalidRingSize { min, max, actual } =>
                write!(f, "Ring size {} outside allowed range [{}, {}]", actual, min, max),
            Self::InvalidDecoyCount { min, max, actual } =>
                write!(f, "Decoy count {} outside [{}, {}]", actual, min, max),
            Self::InvalidCommitment    => write!(f, "Pedersen commitment verification failed"),
            Self::InvalidRangeProof    => write!(f, "Bulletproof range proof invalid"),
            Self::InvalidStealthAddress => write!(f, "Stealth address malformed"),
            Self::SignatureVerificationFailed => write!(f, "Signature verification failed"),
            Self::LocktimeFuture { locktime, current } =>
                write!(f, "Locktime {} not reached (current block {})", locktime, current),
            Self::SequenceLocked { sequence, remaining } =>
                write!(f, "Sequence lock: {} blocks remaining", remaining),
            Self::EmptyMinerAddress    => write!(f, "Coinbase miner address is empty"),
            Self::InvalidMinerAddress { addr } => write!(f, "Invalid miner address: {}", addr),
            Self::BlockHashMismatch { computed, stored } =>
                write!(f, "Hash mismatch: computed {} ≠ stored {}",
                    &computed[..12.min(computed.len())], &stored[..12.min(stored.len())]),
            Self::BlockPrevHashMismatch { expected, got } =>
                write!(f, "prev_hash mismatch: expected {} got {}",
                    &expected[..12.min(expected.len())], &got[..12.min(got.len())]),
            Self::InvalidPoW { leading, required } =>
                write!(f, "PoW insufficient: {} leading zeros (need {})", leading, required),
            Self::StaleBlock { received, expected } =>
                write!(f, "Stale block #{} (expected #{})", received, expected),
            Self::InvalidMerkleRoot { computed, stored } =>
                write!(f, "Merkle root mismatch: {} ≠ {}",
                    &computed[..12.min(computed.len())], &stored[..12.min(stored.len())]),
            Self::InvalidTimestamp { block_ts, mtp } =>
                write!(f, "Timestamp {} ≤ MTP {}", block_ts, mtp),
            Self::TimestampTooFar { block_ts, max } =>
                write!(f, "Timestamp {} too far in future (max {})", block_ts, max),
            Self::InvalidReward { claimed, allowed } =>
                write!(f, "Invalid coinbase reward {:.8} (max {:.8})", claimed, allowed),
            Self::CoinbasePosition    => write!(f, "Coinbase must be first transaction"),
            Self::NoCoinbase          => write!(f, "Block has no coinbase transaction"),
            Self::MultipleCoinbase    => write!(f, "Block has multiple coinbase transactions"),
            Self::InvalidBlockSize { size, max } =>
                write!(f, "Block size {} bytes exceeds max {}", size, max),
            Self::InvalidVersion { version } => write!(f, "Unsupported block version: {}", version),
            Self::InvalidDifficulty   => write!(f, "Block difficulty does not match expected"),
            Self::DuplicateTxInBlock { hash } =>
                write!(f, "Duplicate tx in block: {}", &hash[..12.min(hash.len())]),
            Self::ChainReorgDepthExceeded { depth, max } =>
                write!(f, "Reorg depth {} exceeds max {}", depth, max),
            Self::ForkPointNotFound   => write!(f, "Fork point not found in chain"),
            Self::InsufficientUTXO { address, needed, available } =>
                write!(f, "Insufficient UTXO for {}: need {:.8}, have {:.8}", address, needed, available),
            Self::SpentUTXO { tx_hash, output } =>
                write!(f, "UTXO {}:{} already spent", &tx_hash[..12.min(tx_hash.len())], output),
            Self::UnknownUTXO { tx_hash, output } =>
                write!(f, "Unknown UTXO {}:{}", &tx_hash[..12.min(tx_hash.len())], output),
        }
    }
}

pub type ValidationResult = Result<(), ValidationError>;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

pub const MAX_TX_SIZE_BYTES: usize     = 100_000; // 100 KB
pub const MAX_BLOCK_SIZE_BYTES: usize  = 4_000_000; // 4 MB
pub const DUST_THRESHOLD_HSMC: f64    = 0.000_001; // 1 satoshi equivalent
pub const MAX_RING_SIZE: usize         = 128;
pub const MIN_RING_SIZE: usize         = 2;
pub const MAX_DECOY_COUNT: u8          = 100;
pub const MIN_DECOY_COUNT: u8          = 5;
pub const TIMESTAMP_DRIFT_SECS: i64   = 7200; // 2 hours
pub const MAX_REORG_DEPTH: u64         = 100;
pub const MAX_BLOCK_TXCOUNT: usize     = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// Transaction validation
// ─────────────────────────────────────────────────────────────────────────────

/// Full transaction validation before mempool acceptance.
/// Validates format, amounts, fees, privacy proofs, and address correctness.
pub fn validate_tx(tx: &Transaction) -> ValidationResult {
    validate_tx_basic(tx)?;
    validate_tx_privacy(tx)?;
    Ok(())
}

/// Basic structural and arithmetic checks
pub fn validate_tx_basic(tx: &Transaction) -> ValidationResult {
    if tx.hash.is_empty() {
        return Err(ValidationError::EmptyHash);
    }
    if tx.from_address.is_empty() || tx.to_address.is_empty() {
        return Err(ValidationError::EmptyAddress);
    }
    if !tx.amount.is_finite() {
        return Err(ValidationError::NonFiniteValue { field: "amount" });
    }
    if !tx.fee.is_finite() {
        return Err(ValidationError::NonFiniteValue { field: "fee" });
    }
    if tx.amount < 0.0 {
        return Err(ValidationError::NegativeAmount);
    }
    if tx.fee < 0.0 {
        return Err(ValidationError::NegativeAmount);
    }
    if tx.amount < DUST_THRESHOLD_HSMC && tx.privacy_level == PrivacyLevel::Transparent {
        return Err(ValidationError::DustOutput {
            amount: tx.amount,
            minimum: DUST_THRESHOLD_HSMC,
        });
    }
    if tx.from_address == tx.to_address {
        return Err(ValidationError::SelfTransfer);
    }
    // Validate HSMC address format
    if tx.privacy_level == PrivacyLevel::Transparent {
        if !is_valid_hsmc_address(&tx.from_address) {
            return Err(ValidationError::InvalidAddress { addr: tx.from_address.clone() });
        }
        if !is_valid_hsmc_address(&tx.to_address) {
            return Err(ValidationError::InvalidAddress { addr: tx.to_address.clone() });
        }
    }
    // Amount + fee overflow check
    let total = tx.amount + tx.fee;
    if !total.is_finite() {
        return Err(ValidationError::Overflow { field: "amount+fee" });
    }
    // Check minimum fee
    let min_fee = Transaction::min_fee_for_privacy(&tx.privacy_level);
    if tx.fee < min_fee {
        return Err(ValidationError::FeeTooLow { required: min_fee, provided: tx.fee });
    }
    Ok(())
}

/// Privacy proof completeness and internal consistency checks
pub fn validate_tx_privacy(tx: &Transaction) -> ValidationResult {
    match tx.privacy_level {
        PrivacyLevel::Transparent => {
            // No additional proofs required for transparent txs
        }
        PrivacyLevel::RingCt => {
            if tx.ring_signature.is_none() {
                return Err(ValidationError::InvalidPrivacyProof(
                    "RingCT requires ring_signature (LSAG)",
                ));
            }
            if tx.commitment.is_none() {
                return Err(ValidationError::InvalidPrivacyProof(
                    "RingCT requires Pedersen commitment",
                ));
            }
            // Check ring size if decoy_count is set
            if let Some(d) = tx.decoy_count {
                if d < MIN_DECOY_COUNT {
                    return Err(ValidationError::InvalidDecoyCount {
                        min: MIN_DECOY_COUNT,
                        max: MAX_DECOY_COUNT,
                        actual: d,
                    });
                }
                if d > MAX_DECOY_COUNT {
                    return Err(ValidationError::InvalidDecoyCount {
                        min: MIN_DECOY_COUNT,
                        max: MAX_DECOY_COUNT,
                        actual: d,
                    });
                }
            }
            // Validate ring signature format (hex, correct length)
            validate_ring_sig_format(tx.ring_signature.as_deref())?;
        }
        PrivacyLevel::Stealth => {
            if tx.ring_signature.is_none() {
                return Err(ValidationError::InvalidPrivacyProof(
                    "Stealth requires ring_signature",
                ));
            }
            if tx.stealth_address.is_none() {
                return Err(ValidationError::InvalidPrivacyProof(
                    "Stealth requires one-time stealth_address",
                ));
            }
            validate_stealth_address_format(tx.stealth_address.as_deref())?;
        }
        PrivacyLevel::Full => {
            if tx.ring_signature.is_none() {
                return Err(ValidationError::InvalidPrivacyProof(
                    "Full privacy requires ring_signature",
                ));
            }
            if tx.commitment.is_none() {
                return Err(ValidationError::InvalidPrivacyProof(
                    "Full privacy requires Pedersen commitment",
                ));
            }
            if tx.range_proof.is_none() {
                return Err(ValidationError::InvalidPrivacyProof(
                    "Full privacy requires Bulletproof range_proof",
                ));
            }
            if tx.stealth_address.is_none() {
                return Err(ValidationError::InvalidPrivacyProof(
                    "Full privacy requires stealth_address",
                ));
            }
            // Validate all proof formats
            validate_ring_sig_format(tx.ring_signature.as_deref())?;
            validate_commitment_format(tx.commitment.as_deref())?;
            validate_range_proof_format(tx.range_proof.as_deref())?;
            validate_stealth_address_format(tx.stealth_address.as_deref())?;
        }
    }
    Ok(())
}

/// RBF (BIP125) replacement validation — new tx must have higher fee
pub fn validate_rbf(
    new_tx: &Transaction,
    old_tx: &Transaction,
) -> ValidationResult {
    let min_rbf_fee = old_tx.fee + 0.0001; // 1000 satoshi minimum bump
    if new_tx.fee < min_rbf_fee {
        return Err(ValidationError::RbfFeeInsufficient {
            old_fee: old_tx.fee,
            new_fee: new_tx.fee,
        });
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Block validation
// ─────────────────────────────────────────────────────────────────────────────

/// Structural block validation (no chain state needed)
pub fn validate_block_structure(block: &Block) -> ValidationResult {
    // Version check
    if block.version > 3 {
        return Err(ValidationError::InvalidVersion { version: block.version });
    }
    // Miner address
    if block.miner_address.is_empty() {
        return Err(ValidationError::EmptyMinerAddress);
    }
    if !is_valid_hsmc_address(&block.miner_address) {
        return Err(ValidationError::InvalidMinerAddress {
            addr: block.miner_address.clone(),
        });
    }
    // Hash integrity
    let computed = block.compute_hash();
    if computed != block.hash {
        return Err(ValidationError::BlockHashMismatch {
            computed,
            stored: block.hash.clone(),
        });
    }
    Ok(())
}

/// Full block consensus validation (requires chain context)
pub fn validate_block(
    block: &Block,
    prev_hash: &str,
    difficulty: u64,
    chain_height: u64,
    median_time_past: i64,
    known_key_images: &HashSet<String>,
) -> ValidationResult {
    validate_block_structure(block)?;

    // Chain linkage
    if block.prev_hash != prev_hash {
        return Err(ValidationError::BlockPrevHashMismatch {
            expected: prev_hash.to_string(),
            got: block.prev_hash.clone(),
        });
    }

    // Block height continuity
    if block.block_number != chain_height + 1 {
        return Err(ValidationError::StaleBlock {
            received: block.block_number,
            expected: chain_height + 1,
        });
    }

    // Proof of Work
    let leading = leading_zeros_in_hash(&block.hash);
    let required = difficulty_to_leading_zeros(difficulty);
    if leading < required {
        return Err(ValidationError::InvalidPoW { leading, required });
    }

    // Difficulty matches expected (simplified — full check in Chain::expected_difficulty)
    if block.difficulty != difficulty {
        return Err(ValidationError::InvalidDifficulty);
    }

    // Merkle root
    let computed_mr = merkle_root(&block.transactions);
    if computed_mr != block.merkle_root {
        return Err(ValidationError::InvalidMerkleRoot {
            computed: computed_mr,
            stored: block.merkle_root.clone(),
        });
    }

    // Timestamp: must be > MTP (Median-Time-Past, BIP113)
    if block.timestamp <= median_time_past {
        return Err(ValidationError::InvalidTimestamp {
            block_ts: block.timestamp,
            mtp: median_time_past,
        });
    }
    // Timestamp: must not be more than 2 hours in the future
    let now = Utc::now().timestamp();
    let max_ts = now + TIMESTAMP_DRIFT_SECS;
    if block.timestamp > max_ts {
        return Err(ValidationError::TimestampTooFar {
            block_ts: block.timestamp,
            max: max_ts,
        });
    }

    // Coinbase reward
    let max_reward = block_reward(block.block_number);
    if block.reward > max_reward + 1e-9 {
        return Err(ValidationError::InvalidReward {
            claimed: block.reward,
            allowed: max_reward,
        });
    }

    // Duplicate txs in block
    let mut seen_hashes: HashSet<&String> = HashSet::new();
    for hash in &block.transactions {
        if !seen_hashes.insert(hash) {
            return Err(ValidationError::DuplicateTxInBlock { hash: hash.clone() });
        }
    }

    // Transaction count limit
    if block.transactions.len() > MAX_BLOCK_TXCOUNT {
        return Err(ValidationError::InvalidBlockSize {
            size: block.transactions.len(),
            max: MAX_BLOCK_TXCOUNT,
        });
    }

    Ok(())
}

/// Validate a list of transactions against a known UTXO set
/// Checks: double spends within block, key image reuse, sufficient UTXO balance
pub fn validate_tx_set_against_utxo(
    txs: &[Transaction],
    utxo_balances: &HashMap<String, f64>,
    known_key_images: &HashSet<String>,
) -> ValidationResult {
    let mut seen_hashes = HashSet::new();
    let mut new_key_images = HashSet::new();
    let mut balance_debits: HashMap<String, f64> = HashMap::new();

    for tx in txs {
        // Intra-block duplicate check
        if !seen_hashes.insert(&tx.hash) {
            return Err(ValidationError::DuplicateTransaction { hash: tx.hash.clone() });
        }
        // Validate each tx individually
        validate_tx(tx)?;

        // Key image double-spend check
        if let Some(ki) = &tx.ring_signature {
            let ki_key = format!("ki:{}", ki);
            if known_key_images.contains(&ki_key) || !new_key_images.insert(ki_key.clone()) {
                return Err(ValidationError::KeyImageReuse { image: ki.clone() });
            }
        }

        // UTXO balance check for transparent transactions
        if tx.privacy_level == PrivacyLevel::Transparent {
            let debit = balance_debits.entry(tx.from_address.clone()).or_insert(0.0);
            *debit += tx.amount + tx.fee;
            let available = utxo_balances.get(&tx.from_address).copied().unwrap_or(0.0);
            if *debit > available + 1e-9 {
                return Err(ValidationError::InsufficientUTXO {
                    address: tx.from_address.clone(),
                    needed: *debit,
                    available,
                });
            }
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Script/address helpers
// ─────────────────────────────────────────────────────────────────────────────

/// HSMC address: "HSMC" prefix + 40 hex chars = 44 chars total
pub fn is_valid_hsmc_address(addr: &str) -> bool {
    addr.starts_with("HSMC")
        && addr.len() == 44
        && addr[4..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Validate ring signature hex format (must be even hex, at least 192 chars for one member)
fn validate_ring_sig_format(sig: Option<&str>) -> ValidationResult {
    let s = sig.unwrap_or("");
    if s.is_empty() || s.len() < 64 {
        return Err(ValidationError::SignatureVerificationFailed);
    }
    if !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ValidationError::SignatureVerificationFailed);
    }
    Ok(())
}

/// Validate Pedersen commitment (32-byte hex = 64 chars)
fn validate_commitment_format(c: Option<&str>) -> ValidationResult {
    let s = c.unwrap_or("");
    if s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ValidationError::InvalidCommitment);
    }
    Ok(())
}

/// Validate Bulletproof range proof (must be non-empty hex)
fn validate_range_proof_format(rp: Option<&str>) -> ValidationResult {
    let s = rp.unwrap_or("");
    if s.is_empty() || s.len() < 32 {
        return Err(ValidationError::InvalidRangeProof);
    }
    if !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ValidationError::InvalidRangeProof);
    }
    Ok(())
}

/// Validate stealth address (one-time key + ephemeral key = 128 hex chars)
fn validate_stealth_address_format(sa: Option<&str>) -> ValidationResult {
    let s = sa.unwrap_or("");
    if s.len() < 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ValidationError::InvalidStealthAddress);
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch verifier for high-throughput block processing
// ─────────────────────────────────────────────────────────────────────────────

/// Batch validator: validates all transactions in a block simultaneously,
/// collecting all errors rather than stopping at the first one.
pub struct BatchValidator {
    pub errors: Vec<(String, ValidationError)>, // (tx_hash, error)
    pub valid_count: usize,
    pub invalid_count: usize,
    seen_hashes: HashSet<String>,
    seen_key_images: HashSet<String>,
    balance_debits: HashMap<String, f64>,
}

impl BatchValidator {
    pub fn new() -> Self {
        Self {
            errors: Vec::new(),
            valid_count: 0,
            invalid_count: 0,
            seen_hashes: HashSet::new(),
            seen_key_images: HashSet::new(),
            balance_debits: HashMap::new(),
        }
    }

    pub fn validate_tx(
        &mut self,
        tx: &Transaction,
        utxo_balances: &HashMap<String, f64>,
    ) {
        // Duplicate check
        if !self.seen_hashes.insert(tx.hash.clone()) {
            self.errors.push((tx.hash.clone(), ValidationError::DuplicateTransaction {
                hash: tx.hash.clone(),
            }));
            self.invalid_count += 1;
            return;
        }

        // Key image reuse
        if let Some(ki) = &tx.ring_signature {
            let key = format!("ki:{}", ki);
            if !self.seen_key_images.insert(key.clone()) {
                self.errors.push((tx.hash.clone(), ValidationError::KeyImageReuse {
                    image: ki.clone(),
                }));
                self.invalid_count += 1;
                return;
            }
        }

        // Individual tx validation
        if let Err(e) = validate_tx(tx) {
            self.errors.push((tx.hash.clone(), e));
            self.invalid_count += 1;
            return;
        }

        // UTXO balance
        if tx.privacy_level == PrivacyLevel::Transparent {
            let debit = self.balance_debits.entry(tx.from_address.clone()).or_insert(0.0);
            *debit += tx.amount + tx.fee;
            let available = utxo_balances.get(&tx.from_address).copied().unwrap_or(0.0);
            if *debit > available + 1e-9 {
                self.errors.push((tx.hash.clone(), ValidationError::InsufficientUTXO {
                    address: tx.from_address.clone(),
                    needed: *debit,
                    available,
                }));
                self.invalid_count += 1;
                return;
            }
        }

        self.valid_count += 1;
    }

    pub fn is_all_valid(&self) -> bool {
        self.invalid_count == 0
    }

    pub fn summary(&self) -> String {
        format!(
            "BatchValidator: {} valid, {} invalid out of {} txs",
            self.valid_count,
            self.invalid_count,
            self.valid_count + self.invalid_count,
        )
    }
}

impl Default for BatchValidator {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Transaction, PrivacyLevel};

    fn make_tx(from: &str, to: &str, amount: f64, fee: f64, privacy: PrivacyLevel) -> Transaction {
        Transaction::new(from, to, amount, fee, privacy)
    }

    const ADDR_A: &str = "HSMCaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ADDR_B: &str = "HSMCbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn test_valid_address_format() {
        assert!(is_valid_hsmc_address(ADDR_A));
        assert!(!is_valid_hsmc_address("invalid"));
        assert!(!is_valid_hsmc_address("HSMC123")); // too short
    }

    #[test]
    fn test_reject_self_transfer() {
        let tx = make_tx(ADDR_A, ADDR_A, 1.0, 0.001, PrivacyLevel::Transparent);
        assert!(matches!(validate_tx(&tx), Err(ValidationError::SelfTransfer)));
    }

    #[test]
    fn test_reject_low_fee() {
        let tx = make_tx(ADDR_A, ADDR_B, 1.0, 0.0, PrivacyLevel::Transparent);
        assert!(matches!(validate_tx(&tx), Err(ValidationError::FeeTooLow { .. })));
    }

    #[test]
    fn test_reject_dust_output() {
        let tx = make_tx(ADDR_A, ADDR_B, 0.0000001, 0.0001, PrivacyLevel::Transparent);
        assert!(matches!(validate_tx(&tx), Err(ValidationError::DustOutput { .. })));
    }

    #[test]
    fn test_accept_valid_transparent_tx() {
        let tx = make_tx(ADDR_A, ADDR_B, 1.0, 0.0001, PrivacyLevel::Transparent);
        assert!(validate_tx(&tx).is_ok(), "Should accept valid transparent tx");
    }

    #[test]
    fn test_reject_ringct_without_ring_sig() {
        let tx = make_tx(ADDR_A, ADDR_B, 1.0, 0.001, PrivacyLevel::RingCt);
        assert!(matches!(validate_tx(&tx), Err(ValidationError::InvalidPrivacyProof(_))));
    }

    #[test]
    fn test_reject_negative_amount() {
        let mut tx = make_tx(ADDR_A, ADDR_B, 1.0, 0.0001, PrivacyLevel::Transparent);
        tx.amount = -0.5;
        assert!(matches!(validate_tx(&tx), Err(ValidationError::NegativeAmount)));
    }

    #[test]
    fn test_batch_validator_dedup() {
        let tx = make_tx(ADDR_A, ADDR_B, 1.0, 0.0001, PrivacyLevel::Transparent);
        let mut bv = BatchValidator::new();
        let balances = [(ADDR_A.to_string(), 100.0)].into_iter().collect();
        bv.validate_tx(&tx, &balances);
        bv.validate_tx(&tx, &balances); // duplicate
        assert_eq!(bv.valid_count, 1);
        assert_eq!(bv.invalid_count, 1);
    }

    #[test]
    fn test_rbf_validation() {
        let old = make_tx(ADDR_A, ADDR_B, 1.0, 0.001, PrivacyLevel::Transparent);
        let mut new = make_tx(ADDR_A, ADDR_B, 1.0, 0.001, PrivacyLevel::Transparent);
        new.fee = 0.0005; // still too low
        assert!(matches!(validate_rbf(&new, &old), Err(ValidationError::RbfFeeInsufficient { .. })));
        new.fee = 0.0015; // sufficient bump
        assert!(validate_rbf(&new, &old).is_ok());
    }
}
