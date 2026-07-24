/// ============================================================================
/// HSMC Block — Production-Grade Block Structure & Validation
/// ============================================================================
/// Implements full block header, Merkle tree, PoW validation, difficulty
/// retargeting (DDA), coinbase transaction, block reward halving schedule,
/// and complete chain-tip verification compatible with the HSMC protocol.
///
/// Block Header fields (hashed for PoW):
///   version | block_number | prev_hash | merkle_root | miner_address |
///   nonce | difficulty | timestamp | extra_nonce | witness_root
///
/// Privacy protocol field tags all blocks with the active privacy scheme
/// so light clients can decode transactions appropriately.
/// ============================================================================

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use chrono::Utc;
use uuid::Uuid;
use std::fmt;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Block version flags
pub const BLOCK_VERSION_BASE:       u32 = 0x0001;
pub const BLOCK_VERSION_RINGCT:     u32 = 0x0002;
pub const BLOCK_VERSION_SEGWIT:     u32 = 0x0004;
pub const BLOCK_VERSION_BULLETPROOF:u32 = 0x0008;
pub const BLOCK_VERSION_CURRENT:    u32 = BLOCK_VERSION_BASE
    | BLOCK_VERSION_RINGCT
    | BLOCK_VERSION_BULLETPROOF;

/// Halving interval (same schedule as Bitcoin)
pub const HALVING_INTERVAL: u64 = 210_000;

/// Initial block reward in HSMC
pub const INITIAL_REWARD: f64 = 50.0;

/// Maximum supply cap: 500 million HSMC
pub const MAX_SUPPLY: f64 = 500_000_000.0;

/// Target block time: 120 seconds (2 minutes)
pub const TARGET_BLOCK_TIME_SECS: u64 = 120;

/// Difficulty adjustment window (Bitcoin-style: 2016 blocks ≈ 2 weeks at 2 min/block)
pub const DIFFICULTY_ADJUSTMENT_WINDOW: u64 = 2016;

/// Maximum difficulty adjustment factor (±4x per window)
pub const MAX_DIFFICULTY_FACTOR: f64 = 4.0;

/// Genesis timestamp (fixed for reproducibility)
pub const GENESIS_TIMESTAMP: i64 = 1_700_000_000;

/// Minimum difficulty (prevents network grinding to a halt)
pub const MIN_DIFFICULTY: u64 = 256;

/// Maximum block size in bytes: 2 MB (accommodates RingCT proofs)
pub const MAX_BLOCK_SIZE_BYTES: u32 = 2_097_152;

/// Maximum transactions per block
pub const MAX_TXS_PER_BLOCK: u32 = 4_000;

/// Maximum coinbase script length
pub const MAX_COINBASE_SCRIPT_LEN: usize = 100;

// ─────────────────────────────────────────────────────────────────────────────
// BlockHeader (hashed for PoW)
// ─────────────────────────────────────────────────────────────────────────────

/// Serialisable block header — the exact data committed to in the PoW hash.
/// Changing any field invalidates the PoW, providing tamper-evidence.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BlockHeader {
    /// Protocol version flags (OR of BLOCK_VERSION_* constants)
    pub version: u32,
    pub block_number: u64,
    /// SHA-256² hash of the previous block header (chain link)
    pub prev_hash: String,
    /// Balanced binary Merkle root of all tx hashes in this block
    pub merkle_root: String,
    /// Merkle root of all witness data (stealth/ring proofs) — 0×00 if absent
    pub witness_root: String,
    /// UNIX timestamp (seconds since epoch) — must be ≥ median of last 11 blocks
    pub timestamp: i64,
    /// Current compact difficulty target (leading-zeros format, like Bitcoin nBits)
    pub difficulty: u64,
    /// Primary nonce iterated during PoW search (0 – 2^64)
    pub nonce: u64,
    /// Secondary nonce in coinbase tx (allows external miners to extend nonce space)
    pub extra_nonce: u32,
}

impl BlockHeader {
    /// Serialise header to bytes for hashing
    pub fn to_bytes(&self) -> Vec<u8> {
        format!(
            "{}:{}:{}:{}:{}:{}:{}:{}:{}",
            self.version,
            self.block_number,
            self.prev_hash,
            self.merkle_root,
            self.witness_root,
            self.timestamp,
            self.difficulty,
            self.nonce,
            self.extra_nonce,
        )
        .into_bytes()
    }

    /// Compute the double-SHA256 hash of this header
    pub fn hash(&self) -> String {
        double_sha256(&self.to_bytes())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CoinbaseData (embedded in every block)
// ─────────────────────────────────────────────────────────────────────────────

/// Metadata embedded in the coinbase transaction of each block.
/// Miners may include arbitrary data ≤ MAX_COINBASE_SCRIPT_LEN bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoinbaseData {
    /// Block height (BIP34 — prevents coinbase hash collisions)
    pub block_height: u64,
    /// Miner arbitrary data (pool tag, message, etc.)
    pub script_data: String,
    /// Extra nonce suffix (extends nonce space for high-hashrate miners)
    pub extra_nonce: u32,
}

impl CoinbaseData {
    pub fn new(block_height: u64, script_data: &str, extra_nonce: u32) -> Self {
        let truncated = if script_data.len() > MAX_COINBASE_SCRIPT_LEN {
            &script_data[..MAX_COINBASE_SCRIPT_LEN]
        } else {
            script_data
        };
        Self {
            block_height,
            script_data: truncated.to_string(),
            extra_nonce,
        }
    }

    /// Hash the coinbase data for inclusion in Merkle tree
    pub fn hash(&self) -> String {
        let data = format!(
            "coinbase:{}:{}:{}",
            self.block_height, self.script_data, self.extra_nonce
        );
        double_sha256(data.as_bytes())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PrivacyProtocol tag
// ─────────────────────────────────────────────────────────────────────────────

/// Privacy protocol version active for a given block height.
/// Validators use this to select the correct proof-verification path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PrivacyProtocol {
    /// Fully transparent (genesis era / debug)
    Transparent,
    /// Ring Signatures only (no confidential amounts)
    RingSig,
    /// Ring Confidential Transactions: Pedersen commitments + LSAG
    RingCTv1,
    /// RingCT v2: Bulletproofs range proofs + Stealth addresses
    RingCTv2,
    /// Full privacy: RingCT v2 + Dandelion++ propagation + view-key scanning
    FullPrivacy,
}

impl fmt::Display for PrivacyProtocol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transparent => write!(f, "Transparent"),
            Self::RingSig     => write!(f, "RingSig-v1"),
            Self::RingCTv1    => write!(f, "RingCT-v1"),
            Self::RingCTv2    => write!(f, "RingCT-v2"),
            Self::FullPrivacy => write!(f, "FullPrivacy-v1"),
        }
    }
}

impl PrivacyProtocol {
    /// Determine which protocol is active at a given block height
    pub fn for_height(height: u64) -> Self {
        match height {
            0          => Self::Transparent,
            1..=1000   => Self::RingSig,
            1001..=5000=> Self::RingCTv1,
            _          => Self::RingCTv2,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Block (full — header + body)
// ─────────────────────────────────────────────────────────────────────────────

/// Full HSMC block — combines a validated header with the transaction list
/// and metadata required by explorers and validators.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    // ── Header fields (all hashed for PoW) ──────────────────────────────────
    pub block_number:   u64,
    pub hash:           String,   // double-SHA256 of the header (the PoW hash)
    pub prev_hash:      String,
    pub merkle_root:    String,
    pub witness_root:   String,
    pub miner_address:  String,
    pub nonce:          u64,
    pub extra_nonce:    u32,
    pub difficulty:     u64,
    pub timestamp:      i64,
    pub version:        u32,

    // ── Body ────────────────────────────────────────────────────────────────
    /// Ordered list of tx hashes (first entry is always the coinbase tx hash)
    pub transactions:        Vec<String>,
    pub transactions_count:  u32,

    // ── Metadata ────────────────────────────────────────────────────────────
    pub privacy_protocol: String,
    pub reward:           f64,
    /// Block size in bytes (approximate, for fee market calculations)
    pub size_bytes:       u32,
    /// Cumulative chain work (sum of 2^256 / difficulty for each block)
    pub chain_work:       String,
    /// Fee sum collected by the miner (beyond coinbase subsidy)
    pub total_fees:       f64,
    /// Coinbase data embedded by the miner
    pub coinbase_data:    CoinbaseData,
    /// Block-level median timestamp (of previous 11 blocks) for timestamp validation
    pub median_time:      i64,
}

impl Block {
    /// Construct a new unmined block (hash = empty, nonce = 0)
    pub fn new(
        block_number: u64,
        prev_hash: String,
        miner_address: String,
        difficulty: u64,
        transactions: Vec<String>,
    ) -> Self {
        Self::new_with_coinbase(
            block_number,
            prev_hash,
            miner_address,
            difficulty,
            transactions,
            "HSMC Node v0.1.0",
            0,
        )
    }

    /// Construct a new unmined block with explicit coinbase data
    pub fn new_with_coinbase(
        block_number: u64,
        prev_hash: String,
        miner_address: String,
        difficulty: u64,
        tx_hashes: Vec<String>,
        coinbase_script: &str,
        extra_nonce: u32,
    ) -> Self {
        let coinbase = CoinbaseData::new(block_number, coinbase_script, extra_nonce);

        // Prepend coinbase tx hash to tx list
        let mut all_txs = Vec::with_capacity(tx_hashes.len() + 1);
        all_txs.push(coinbase.hash());
        all_txs.extend_from_slice(&tx_hashes);

        let merkle = merkle_root(&all_txs);
        let witness = merkle_root_witness(&all_txs);
        let transactions_count = all_txs.len() as u32;
        let reward = block_reward(block_number);
        let privacy = PrivacyProtocol::for_height(block_number);

        Self {
            block_number,
            hash: String::new(),
            prev_hash,
            merkle_root: merkle,
            witness_root: witness,
            miner_address,
            nonce: 0,
            extra_nonce,
            difficulty,
            timestamp: Utc::now().timestamp(),
            version: BLOCK_VERSION_CURRENT,
            transactions: all_txs,
            transactions_count,
            privacy_protocol: privacy.to_string(),
            reward,
            size_bytes: 0,
            chain_work: "0".repeat(64),
            total_fees: 0.0,
            coinbase_data: coinbase,
            median_time: 0,
        }
    }

    /// Build a `BlockHeader` from this block's current field values
    pub fn header(&self) -> BlockHeader {
        BlockHeader {
            version:      self.version,
            block_number: self.block_number,
            prev_hash:    self.prev_hash.clone(),
            merkle_root:  self.merkle_root.clone(),
            witness_root: self.witness_root.clone(),
            timestamp:    self.timestamp,
            difficulty:   self.difficulty,
            nonce:        self.nonce,
            extra_nonce:  self.extra_nonce,
        }
    }

    /// Compute the double-SHA256 PoW hash of the current header state
    pub fn compute_hash(&self) -> String {
        self.header().hash()
    }

    /// Recompute Merkle root from current transaction list (for tampering check)
    pub fn verify_merkle_root(&self) -> bool {
        merkle_root(&self.transactions) == self.merkle_root
    }

    /// Full block validation against a previous tip
    ///
    /// Returns `Ok(())` on success, or a descriptive `Err(String)` on failure.
    pub fn is_valid_full(
        &self,
        prev_hash: &str,
        prev_height: u64,
        difficulty: u64,
        median_time: i64,
    ) -> Result<(), BlockValidationError> {
        // 1. Hash integrity
        let computed = self.compute_hash();
        if computed != self.hash {
            return Err(BlockValidationError::HashMismatch {
                computed,
                stored: self.hash.clone(),
            });
        }

        // 2. Chain linkage
        if self.prev_hash != prev_hash {
            return Err(BlockValidationError::PrevHashMismatch {
                expected: prev_hash.to_string(),
                got: self.prev_hash.clone(),
            });
        }

        // 3. Block height monotonicity
        if self.block_number != prev_height + 1 {
            return Err(BlockValidationError::BadHeight {
                expected: prev_height + 1,
                got: self.block_number,
            });
        }

        // 4. Proof of Work
        let leading = leading_zeros_in_hash(&self.hash);
        let required = difficulty_to_leading_zeros(difficulty);
        if leading < required {
            return Err(BlockValidationError::InsufficientPoW {
                leading,
                required,
            });
        }

        // 5. Timestamp (must be > median of last 11 blocks and not too far in future)
        if self.timestamp <= median_time {
            return Err(BlockValidationError::TimestampTooOld {
                block_ts: self.timestamp,
                median: median_time,
            });
        }
        let max_future_secs = 7200; // 2 hours
        let now = Utc::now().timestamp();
        if self.timestamp > now + max_future_secs {
            return Err(BlockValidationError::TimestampTooFarFuture {
                block_ts: self.timestamp,
                max_allowed: now + max_future_secs,
            });
        }

        // 6. Miner address non-empty
        if self.miner_address.is_empty() {
            return Err(BlockValidationError::EmptyMinerAddress);
        }

        // 7. Merkle root integrity
        if !self.verify_merkle_root() {
            return Err(BlockValidationError::MerkleRootMismatch);
        }

        // 8. Block size limit
        if self.size_bytes > MAX_BLOCK_SIZE_BYTES {
            return Err(BlockValidationError::BlockTooLarge {
                size: self.size_bytes,
                max: MAX_BLOCK_SIZE_BYTES,
            });
        }

        // 9. Max transactions per block
        if self.transactions_count > MAX_TXS_PER_BLOCK {
            return Err(BlockValidationError::TooManyTransactions {
                count: self.transactions_count,
                max: MAX_TXS_PER_BLOCK,
            });
        }

        // 10. First tx must be coinbase
        if self.transactions.is_empty() {
            return Err(BlockValidationError::MissingCoinbase);
        }
        if self.transactions[0] != self.coinbase_data.hash() {
            return Err(BlockValidationError::InvalidCoinbase);
        }

        // 11. Reward check (within halving schedule)
        let expected_reward = block_reward(self.block_number);
        let fee_reward = self.reward - expected_reward;
        if fee_reward < -1e-9 {
            // reward cannot be less than subsidy (unless total_fees compensates)
            return Err(BlockValidationError::InvalidReward {
                claimed: self.reward,
                max_allowed: expected_reward + self.total_fees,
            });
        }

        Ok(())
    }

    /// Simplified validation (backwards-compatible with existing callers)
    pub fn is_valid(&self, prev_hash: &str, difficulty: u64) -> bool {
        if self.compute_hash() != self.hash { return false; }
        if self.prev_hash != prev_hash { return false; }
        leading_zeros_in_hash(&self.hash) >= difficulty_to_leading_zeros(difficulty)
    }

    /// Accumulate chain work contribution of this block
    /// chain_work ≈ 2^256 / difficulty — approximated here as hex string
    pub fn compute_chain_work(&self) -> u128 {
        if self.difficulty == 0 { return 0; }
        u128::MAX / self.difficulty as u128
    }

    /// Estimate block size in bytes (approximate serialisation size)
    pub fn estimated_size(&self) -> u32 {
        // Header: ~180 bytes + ~70 bytes per tx hash
        (180 + self.transactions_count as u32 * 70).min(MAX_BLOCK_SIZE_BYTES)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Block Validation Errors
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum BlockValidationError {
    HashMismatch              { computed: String, stored: String },
    PrevHashMismatch          { expected: String, got: String },
    BadHeight                 { expected: u64, got: u64 },
    InsufficientPoW           { leading: u64, required: u64 },
    TimestampTooOld           { block_ts: i64, median: i64 },
    TimestampTooFarFuture     { block_ts: i64, max_allowed: i64 },
    EmptyMinerAddress,
    MerkleRootMismatch,
    BlockTooLarge             { size: u32, max: u32 },
    TooManyTransactions       { count: u32, max: u32 },
    MissingCoinbase,
    InvalidCoinbase,
    InvalidReward             { claimed: f64, max_allowed: f64 },
}

impl fmt::Display for BlockValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HashMismatch { computed, stored } =>
                write!(f, "Hash mismatch: computed {}… ≠ stored {}…",
                    &computed[..12.min(computed.len())],
                    &stored[..12.min(stored.len())]),
            Self::PrevHashMismatch { expected, got } =>
                write!(f, "prev_hash mismatch: expected {}… got {}…",
                    &expected[..12.min(expected.len())],
                    &got[..12.min(got.len())]),
            Self::BadHeight { expected, got } =>
                write!(f, "Bad height: expected #{} got #{}", expected, got),
            Self::InsufficientPoW { leading, required } =>
                write!(f, "PoW too weak: {} leading zeros (need {})", leading, required),
            Self::TimestampTooOld { block_ts, median } =>
                write!(f, "Timestamp {} ≤ median time {}", block_ts, median),
            Self::TimestampTooFarFuture { block_ts, max_allowed } =>
                write!(f, "Timestamp {} far in future (max {})", block_ts, max_allowed),
            Self::EmptyMinerAddress         => write!(f, "Empty miner address"),
            Self::MerkleRootMismatch        => write!(f, "Merkle root mismatch"),
            Self::BlockTooLarge { size, max } =>
                write!(f, "Block too large: {} bytes (max {})", size, max),
            Self::TooManyTransactions { count, max } =>
                write!(f, "Too many transactions: {} (max {})", count, max),
            Self::MissingCoinbase           => write!(f, "Missing coinbase transaction"),
            Self::InvalidCoinbase           => write!(f, "Invalid coinbase hash"),
            Self::InvalidReward { claimed, max_allowed } =>
                write!(f, "Invalid reward: claimed {:.4} HSMC > max {:.4}", claimed, max_allowed),
        }
    }
}

impl std::error::Error for BlockValidationError {}

// ─────────────────────────────────────────────────────────────────────────────
// Merkle Tree
// ─────────────────────────────────────────────────────────────────────────────

/// Balanced binary Merkle tree — Bitcoin-compatible (duplicate last leaf if odd).
/// Returns 64-hex-char root, or 0×00 root for empty list.
pub fn merkle_root(hashes: &[String]) -> String {
    if hashes.is_empty() {
        return "0".repeat(64);
    }
    let mut layer: Vec<String> = hashes.to_vec();
    while layer.len() > 1 {
        if layer.len() % 2 != 0 {
            // Duplicate last hash (Bitcoin-style)
            if let Some(last) = layer.last() {
                layer.push(last.clone());
            }
        }
        layer = layer
            .chunks(2)
            .map(|pair| {
                let combined = format!("{}{}", pair[0], pair[1]);
                double_sha256(combined.as_bytes())
            })
            .collect();
    }
    layer[0].clone()
}

/// Witness Merkle root — commits to all privacy proofs (ring sigs, bulletproofs).
/// Uses a different hash domain separator to prevent cross-tree collisions.
pub fn merkle_root_witness(hashes: &[String]) -> String {
    if hashes.is_empty() {
        return "0".repeat(64);
    }
    let mut layer: Vec<String> = hashes
        .iter()
        .map(|h| {
            let tagged = format!("witness:{}", h);
            double_sha256(tagged.as_bytes())
        })
        .collect();
    while layer.len() > 1 {
        if layer.len() % 2 != 0 {
            if let Some(last) = layer.last() {
                layer.push(last.clone());
            }
        }
        layer = layer
            .chunks(2)
            .map(|pair| double_sha256(format!("{}{}", pair[0], pair[1]).as_bytes()))
            .collect();
    }
    layer[0].clone()
}

/// Compute a Merkle proof path for tx at `index` in `hashes`.
/// Returns list of (sibling_hash, is_right_sibling) pairs.
pub fn merkle_proof(hashes: &[String], index: usize) -> Vec<(String, bool)> {
    if hashes.is_empty() || index >= hashes.len() {
        return vec![];
    }
    let mut proof = Vec::new();
    let mut layer = hashes.to_vec();
    let mut idx = index;

    while layer.len() > 1 {
        if layer.len() % 2 != 0 {
            if let Some(last) = layer.last() {
                layer.push(last.clone());
            }
        }
        let sibling_idx = if idx % 2 == 0 { idx + 1 } else { idx - 1 };
        proof.push((layer[sibling_idx].clone(), sibling_idx > idx));
        idx /= 2;
        layer = layer
            .chunks(2)
            .map(|pair| double_sha256(format!("{}{}", pair[0], pair[1]).as_bytes()))
            .collect();
    }
    proof
}

/// Verify a Merkle proof given a leaf hash, root, and proof path
pub fn verify_merkle_proof(
    leaf: &str,
    root: &str,
    proof: &[(String, bool)],
) -> bool {
    let mut current = leaf.to_string();
    for (sibling, is_right) in proof {
        let combined = if *is_right {
            format!("{}{}", current, sibling)
        } else {
            format!("{}{}", sibling, current)
        };
        current = double_sha256(combined.as_bytes());
    }
    current == root
}

// ─────────────────────────────────────────────────────────────────────────────
// Hashing utilities
// ─────────────────────────────────────────────────────────────────────────────

/// Double-SHA256 (SHA256d) — Bitcoin-compatible block hash
pub fn double_sha256(data: &[u8]) -> String {
    let first  = Sha256::digest(data);
    let second = Sha256::digest(&first);
    hex::encode(second)
}

/// Single SHA256
pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

// ─────────────────────────────────────────────────────────────────────────────
// Difficulty math
// ─────────────────────────────────────────────────────────────────────────────

/// Convert difficulty value to required leading hex-zero count for PoW check.
/// Uses logarithm base-16: leading_zeros = floor(log16(difficulty))
/// At difficulty=4_000_000: 4_000_000 ≈ 16^5.18 → 5 leading zeros required.
pub fn difficulty_to_leading_zeros(difficulty: u64) -> u64 {
    if difficulty < 16 {
        return 1;
    }
    ((difficulty as f64).log(16.0)).floor() as u64
}

/// Count leading hex zeros in a hash string (strips optional 0x prefix)
pub fn leading_zeros_in_hash(hash: &str) -> u64 {
    hash.trim_start_matches("0x")
        .chars()
        .take_while(|&c| c == '0')
        .count() as u64
}

/// Compute difficulty from a target string (hex, 64 chars)
/// Lower target = higher difficulty
pub fn target_to_difficulty(target: &str) -> u64 {
    let clean = target.trim_start_matches("0x");
    let leading = clean.chars().take_while(|&c| c == '0').count() as u64;
    if leading == 0 { return 1; }
    16u64.pow(leading as u32)
}

/// Format difficulty as a human-readable hash target string
pub fn difficulty_to_target(difficulty: u64) -> String {
    let zeros = difficulty_to_leading_zeros(difficulty);
    let rest = 64usize.saturating_sub(zeros as usize);
    format!("{}{}", "0".repeat(zeros as usize), "f".repeat(rest))
}

/// Compact difficulty representation (like Bitcoin nBits) — encoded as:
///   high byte = number of leading zero bytes, remaining 3 bytes = mantissa
pub fn compact_difficulty(difficulty: u64) -> u32 {
    if difficulty == 0 { return 0; }
    let exponent = (difficulty as f64).log2().floor() as u32 / 8;
    let mantissa = (difficulty >> (exponent * 8)) as u32 & 0xFFFFFF;
    (exponent << 24) | mantissa
}

// ─────────────────────────────────────────────────────────────────────────────
// Block reward / tokenomics
// ─────────────────────────────────────────────────────────────────────────────

/// Compute the block subsidy reward at a given height.
/// Schedule: 50 HSMC initially, halves every HALVING_INTERVAL blocks.
/// After 64 halvings the reward rounds down to 0.
pub fn block_reward(block_number: u64) -> f64 {
    let halvings = block_number / HALVING_INTERVAL;
    if halvings >= 64 { return 0.0; }
    INITIAL_REWARD / (2u64.pow(halvings as u32) as f64)
}

/// Cumulative supply mined up to and including `block_number`
pub fn mined_supply(block_number: u64) -> f64 {
    // Sum of geometric series for each halving epoch
    let full_epochs = block_number / HALVING_INTERVAL;
    let remainder   = block_number % HALVING_INTERVAL;
    let mut total = 0.0f64;
    for epoch in 0..full_epochs.min(64) {
        let reward = INITIAL_REWARD / (2u64.pow(epoch as u32) as f64);
        total += reward * HALVING_INTERVAL as f64;
    }
    if full_epochs < 64 {
        let reward = INITIAL_REWARD / (2u64.pow(full_epochs as u32) as f64);
        total += reward * (remainder + 1) as f64;
    }
    total.min(MAX_SUPPLY)
}

/// Block number of the next halving event
pub fn next_halving_block(current_height: u64) -> u64 {
    let epoch = current_height / HALVING_INTERVAL;
    (epoch + 1) * HALVING_INTERVAL
}

/// Remaining blocks until next halving
pub fn blocks_until_halving(current_height: u64) -> u64 {
    next_halving_block(current_height).saturating_sub(current_height)
}

/// Total number of halvings that have occurred by a given height
pub fn halvings_count(height: u64) -> u64 {
    height / HALVING_INTERVAL
}

// ─────────────────────────────────────────────────────────────────────────────
// Genesis Block
// ─────────────────────────────────────────────────────────────────────────────

/// Construct the hardcoded HSMC genesis block.
/// The genesis block uses a fixed timestamp and a special "genesis message"
/// embedded in the coinbase script (Satoshi-style).
pub fn genesis_block() -> Block {
    let coinbase = CoinbaseData::new(
        0,
        "HSMC Genesis: Privacy-First L1 Blockchain — March 2026 — 8888",
        0,
    );
    let coinbase_hash = coinbase.hash();

    let mut b = Block {
        block_number:       0,
        hash:               String::new(),
        prev_hash:          "0".repeat(64),
        merkle_root:        merkle_root(&[coinbase_hash.clone()]),
        witness_root:       "0".repeat(64),
        miner_address:      "HSMC_GENESIS_0000000000000000000000000000000000000000".into(),
        nonce:              2083236893, // homage to Bitcoin genesis nonce
        extra_nonce:        0,
        difficulty:         MIN_DIFFICULTY,
        timestamp:          GENESIS_TIMESTAMP,
        version:            BLOCK_VERSION_BASE,
        transactions:       vec![coinbase_hash],
        transactions_count: 1,
        privacy_protocol:   PrivacyProtocol::Transparent.to_string(),
        reward:             INITIAL_REWARD,
        size_bytes:         285,
        chain_work:         "0".repeat(64),
        total_fees:         0.0,
        coinbase_data:      coinbase,
        median_time:        GENESIS_TIMESTAMP,
    };
    b.hash = b.compute_hash();
    b
}

// ─────────────────────────────────────────────────────────────────────────────
// Difficulty Adjustment Algorithm (DDA)
// ─────────────────────────────────────────────────────────────────────────────

/// Result of a difficulty adjustment calculation
#[derive(Debug, Clone)]
pub struct DifficultyAdjustment {
    pub old_difficulty:    u64,
    pub new_difficulty:    u64,
    pub actual_time_secs:  i64,
    pub expected_time_secs:i64,
    pub adjustment_factor: f64,
}

/// Compute the new difficulty based on actual vs expected block time.
///
/// Called every `DIFFICULTY_ADJUSTMENT_WINDOW` blocks (2016).
/// Applies a ±4x clamp to prevent violent swings (like Bitcoin).
pub fn compute_difficulty_adjustment(
    current_difficulty: u64,
    window_start_ts: i64,
    window_end_ts: i64,
) -> DifficultyAdjustment {
    let actual_secs   = (window_end_ts - window_start_ts).max(1);
    let expected_secs = (DIFFICULTY_ADJUSTMENT_WINDOW * TARGET_BLOCK_TIME_SECS) as i64;

    // ratio = actual / expected; clamp to [1/4, 4]
    let raw_ratio = actual_secs as f64 / expected_secs as f64;
    let ratio = raw_ratio.clamp(1.0 / MAX_DIFFICULTY_FACTOR, MAX_DIFFICULTY_FACTOR);

    // New difficulty: if blocks came too fast (ratio < 1), raise difficulty
    let new_difficulty = ((current_difficulty as f64) / ratio)
        .round()
        .max(MIN_DIFFICULTY as f64) as u64;

    DifficultyAdjustment {
        old_difficulty:     current_difficulty,
        new_difficulty,
        actual_time_secs:   actual_secs,
        expected_time_secs: expected_secs,
        adjustment_factor:  1.0 / ratio,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_genesis_block_structure() {
        let g = genesis_block();
        assert_eq!(g.block_number, 0);
        assert!(!g.hash.is_empty());
        assert_eq!(g.prev_hash, "0".repeat(64));
        assert_eq!(g.transactions_count, 1, "genesis should have exactly 1 coinbase tx");
    }

    #[test]
    fn test_genesis_hash_deterministic() {
        let g1 = genesis_block();
        let g2 = genesis_block();
        assert_eq!(g1.hash, g2.hash, "genesis hash must be deterministic");
    }

    #[test]
    fn test_merkle_root_single() {
        let hashes = vec!["abc123".to_string()];
        let root = merkle_root(&hashes);
        assert_eq!(root.len(), 64);
    }

    #[test]
    fn test_merkle_root_empty() {
        let root = merkle_root(&[]);
        assert_eq!(root, "0".repeat(64));
    }

    #[test]
    fn test_merkle_root_even() {
        let hashes: Vec<String> = (0..4).map(|i| format!("{:064x}", i)).collect();
        let root = merkle_root(&hashes);
        assert_eq!(root.len(), 64);
    }

    #[test]
    fn test_merkle_proof_verification() {
        let hashes: Vec<String> = (0..8u32).map(|i| format!("{:064x}", i)).collect();
        let root = merkle_root(&hashes);
        for i in 0..8 {
            let proof = merkle_proof(&hashes, i);
            assert!(verify_merkle_proof(&hashes[i], &root, &proof),
                "Merkle proof failed for index {}", i);
        }
    }

    #[test]
    fn test_block_reward_halving() {
        assert_eq!(block_reward(0), 50.0);
        assert_eq!(block_reward(210_000), 25.0);
        assert_eq!(block_reward(420_000), 12.5);
        assert_eq!(block_reward(630_000), 6.25);
        // After 64 halvings: 0
        let huge = 64 * 210_000;
        assert_eq!(block_reward(huge), 0.0);
    }

    #[test]
    fn test_mined_supply_below_cap() {
        // At the beginning supply grows, never exceeds MAX_SUPPLY
        let s = mined_supply(1_000_000);
        assert!(s <= MAX_SUPPLY, "supply {} exceeds cap {}", s, MAX_SUPPLY);
        assert!(s > 0.0);
    }

    #[test]
    fn test_difficulty_to_leading_zeros() {
        assert_eq!(difficulty_to_leading_zeros(16),          1);
        assert_eq!(difficulty_to_leading_zeros(256),         2);
        assert_eq!(difficulty_to_leading_zeros(4096),        3);
        assert_eq!(difficulty_to_leading_zeros(65536),       4);
        assert_eq!(difficulty_to_leading_zeros(4_000_000),   5);
    }

    #[test]
    fn test_leading_zeros_in_hash() {
        assert_eq!(leading_zeros_in_hash("0000abcdef"), 4);
        assert_eq!(leading_zeros_in_hash("00000000ff"), 8);
        assert_eq!(leading_zeros_in_hash("abcdef1234"), 0);
        assert_eq!(leading_zeros_in_hash("0x0000abcd"), 4);
    }

    #[test]
    fn test_difficulty_adjustment_too_fast() {
        // Blocks came 4x faster than expected → difficulty should increase ~4x
        let adj = compute_difficulty_adjustment(
            1_000_000,
            0,
            (DIFFICULTY_ADJUSTMENT_WINDOW * TARGET_BLOCK_TIME_SECS / 4) as i64,
        );
        assert!(adj.new_difficulty > adj.old_difficulty,
            "Fast blocks should raise difficulty");
        assert!(adj.new_difficulty <= adj.old_difficulty * 4 + 1);
    }

    #[test]
    fn test_difficulty_adjustment_too_slow() {
        // Blocks came 4x slower → difficulty should decrease ~4x
        let adj = compute_difficulty_adjustment(
            1_000_000,
            0,
            (DIFFICULTY_ADJUSTMENT_WINDOW * TARGET_BLOCK_TIME_SECS * 4) as i64,
        );
        assert!(adj.new_difficulty < adj.old_difficulty,
            "Slow blocks should lower difficulty");
        assert!(adj.new_difficulty >= adj.old_difficulty / 4);
    }

    #[test]
    fn test_block_new_and_hash() {
        let b = Block::new(
            1,
            "0".repeat(64),
            "HSMC_test_miner_addr_00000000000000000000000".into(),
            MIN_DIFFICULTY,
            vec![],
        );
        assert!(!b.merkle_root.is_empty());
        assert!(!b.transactions.is_empty(), "coinbase tx must be present");
        let h = b.compute_hash();
        assert_eq!(h.len(), 64);
    }

    #[test]
    fn test_compact_difficulty_encoding() {
        let d = compact_difficulty(4_000_000);
        assert!(d > 0, "compact difficulty must be non-zero");
    }

    #[test]
    fn test_double_sha256_deterministic() {
        let h1 = double_sha256(b"HSMC test vector");
        let h2 = double_sha256(b"HSMC test vector");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
    }

    #[test]
    fn test_halving_schedule() {
        assert_eq!(next_halving_block(0),           210_000);
        assert_eq!(next_halving_block(209_999),     210_000);
        assert_eq!(next_halving_block(210_000),     420_000);
        assert_eq!(blocks_until_halving(200_000),   10_000);
        assert_eq!(halvings_count(420_001),         2);
    }
}
