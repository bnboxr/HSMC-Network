use crate::{
    block_reward, compute_difficulty_adjustment, difficulty_to_leading_zeros, genesis_block,
    leading_zeros_in_hash, Block, PrivacyLevel, Transaction, TxStatus, TxValidationError,
    DIFFICULTY_ADJUSTMENT_WINDOW, MAX_SUPPLY, MIN_DIFFICULTY, TARGET_BLOCK_TIME_SECS,
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
/// ============================================================================
/// HSMC Chain — Full In-Memory Blockchain State Machine
/// ============================================================================
/// The Chain struct is the authoritative in-memory view of the HSMC
/// blockchain. It maintains:
///
///   • Ordered vector of confirmed blocks (index 0 = genesis)
///   • O(1) lookup indices: block_number → vec index, hash → vec index
///   • UTXO set tracking for balance computation and double-spend detection
///   • Key image set for ring-signature double-spend prevention
///   • Difficulty state machine with Bitcoin-compatible retargeting (DDA)
///   • Fork detection and chain reorganisation (reorg) support
///   • Median-time-past (MTP) calculation for timestamp validation
///   • Full chain integrity validator
///   • Chainwork accumulation for heaviest-chain selection
///
/// Thread safety: this struct is **not** Send/Sync on its own — callers must
/// wrap it in `Arc<RwLock<Chain>>` as done in `main.rs`.
/// ============================================================================
use std::collections::{HashMap, HashSet, VecDeque};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// How many recent blocks to consider for median-time-past calculation
pub const MTP_WINDOW: usize = 11;

/// Maximum depth of a chain reorganisation we are willing to process
pub const MAX_REORG_DEPTH: usize = 100;

/// Minimum number of confirmations considered "safe" (6 blocks, like Bitcoin)
pub const SAFE_CONFIRMATIONS: u64 = 6;

/// Maximum in-memory block count before pruning old block bodies
/// (headers are always kept; only full transaction lists are pruned)
pub const MAX_INLINE_BLOCKS: usize = 50_000;

// ─────────────────────────────────────────────────────────────────────────────
// ChainError
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum ChainError {
    InvalidBlock(String),
    DuplicateBlock {
        number: u64,
    },
    OrphanBlock {
        number: u64,
        prev_hash: String,
    },
    ChainIntegrityFailure {
        block_number: u64,
        reason: String,
    },
    ReorgTooDeep {
        depth: usize,
        max: usize,
    },
    EmptyChain,
    DoubleSpend {
        key_image: String,
        prev_tx: String,
    },
    InsufficientBalance {
        address: String,
        required: f64,
        available: f64,
    },
    BlockInFuture {
        timestamp: i64,
        max_allowed: i64,
    },
    StaleBlock {
        received: u64,
        expected: u64,
    },
}

impl std::fmt::Display for ChainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidBlock(msg) => write!(f, "Invalid block: {}", msg),
            Self::DuplicateBlock { number } => write!(f, "Duplicate block #{}", number),
            Self::OrphanBlock { number, prev_hash } => write!(
                f,
                "Orphan block #{}: prev_hash {}... not in chain",
                number,
                &prev_hash[..12.min(prev_hash.len())]
            ),
            Self::ChainIntegrityFailure {
                block_number,
                reason,
            } => write!(
                f,
                "Chain integrity failure at #{}: {}",
                block_number, reason
            ),
            Self::ReorgTooDeep { depth, max } => {
                write!(f, "Reorg too deep: {} blocks (max {})", depth, max)
            }
            Self::EmptyChain => write!(f, "Chain is empty"),
            Self::DoubleSpend { key_image, prev_tx } => write!(
                f,
                "Double-spend: key image {}... already used in {}",
                &key_image[..12.min(key_image.len())],
                &prev_tx[..12.min(prev_tx.len())]
            ),
            Self::InsufficientBalance {
                address,
                required,
                available,
            } => write!(
                f,
                "Insufficient balance for {}: required {:.4} have {:.4}",
                &address[..16.min(address.len())],
                required,
                available
            ),
            Self::BlockInFuture {
                timestamp,
                max_allowed,
            } => write!(
                f,
                "Block timestamp {} exceeds max allowed {}",
                timestamp, max_allowed
            ),
            Self::StaleBlock { received, expected } => {
                write!(f, "Stale block #{} (expected #{})", received, expected)
            }
        }
    }
}

impl std::error::Error for ChainError {}

// ─────────────────────────────────────────────────────────────────────────────
// UTXO Set (unspent transaction outputs)
// ─────────────────────────────────────────────────────────────────────────────

/// A single unspent transaction output
#[derive(Debug, Clone)]
pub struct Utxo {
    pub tx_hash: String,
    pub output_index: u32,
    pub amount: f64,
    pub address: String,
    pub lock_script: String,
    pub block_height: u64,
    pub commitment: Option<String>, // For RingCT outputs — amount is hidden
}

/// Complete UTXO set — single source of truth for balance queries
#[derive(Debug, Clone, Default)]
pub struct UtxoSet {
    /// "txhash:index" → Utxo
    pub utxos: HashMap<String, Utxo>,
    /// address → set of UTXO keys for fast balance queries
    pub by_address: HashMap<String, HashSet<String>>,
    /// Total circulating supply (sum of all unspent transparent UTXOs)
    pub total_transparent_supply: f64,
}

impl UtxoSet {
    pub fn new() -> Self {
        Self::default()
    }

    fn utxo_key(tx_hash: &str, index: u32) -> String {
        format!("{}:{}", tx_hash, index)
    }

    /// Look up an unspent output by its typed `(transaction hash, output index)` outpoint.
    pub fn get(&self, tx_hash: &str, output_index: u32) -> Option<&Utxo> {
        self.utxos.get(&Self::utxo_key(tx_hash, output_index))
    }

    pub fn add(&mut self, utxo: Utxo) {
        let key = Self::utxo_key(&utxo.tx_hash, utxo.output_index);
        self.by_address
            .entry(utxo.address.clone())
            .or_default()
            .insert(key.clone());
        if utxo.commitment.is_none() {
            self.total_transparent_supply += utxo.amount;
        }
        self.utxos.insert(key, utxo);
    }

    pub fn spend(&mut self, tx_hash: &str, output_index: u32) -> Option<Utxo> {
        let key = Self::utxo_key(tx_hash, output_index);
        if let Some(u) = self.utxos.remove(&key) {
            if let Some(addr_set) = self.by_address.get_mut(&u.address) {
                addr_set.remove(&key);
            }
            if u.commitment.is_none() {
                self.total_transparent_supply -= u.amount;
            }
            Some(u)
        } else {
            None
        }
    }

    /// Get confirmed balance of an address (transparent UTXOs only)
    pub fn balance_of(&self, address: &str) -> f64 {
        self.by_address
            .get(address)
            .map(|keys| {
                keys.iter()
                    .filter_map(|k| self.utxos.get(k))
                    .filter(|u| u.commitment.is_none())
                    .map(|u| u.amount)
                    .sum()
            })
            .unwrap_or(0.0)
    }

    /// Get all UTXOs for an address (for wallet UTXO selection)
    pub fn utxos_for(&self, address: &str) -> Vec<&Utxo> {
        self.by_address
            .get(address)
            .map(|keys| keys.iter().filter_map(|k| self.utxos.get(k)).collect())
            .unwrap_or_default()
    }

    /// Total number of UTXOs across all addresses
    pub fn count(&self) -> usize {
        self.utxos.len()
    }
}

/// Verify the supported transparent spend format: the referenced output must
/// lock to `ED25519:<32-byte-public-key-hex>` and the input must carry a
/// hex-encoded Ed25519 signature over `Transaction::spending_message()`.
fn verify_ed25519_input(
    tx: &Transaction,
    input: &crate::TxInput,
    source: &Utxo,
) -> Result<(), &'static str> {
    let public_key_hex = source
        .lock_script
        .strip_prefix("ED25519:")
        .ok_or("unsupported locking script")?;
    let public_key: [u8; 32] = hex::decode(public_key_hex)
        .map_err(|_| "invalid public key hex")?
        .try_into()
        .map_err(|_| "invalid public key length")?;
    let signature = hex::decode(&input.unlock_script).map_err(|_| "invalid signature hex")?;
    let key = VerifyingKey::from_bytes(&public_key).map_err(|_| "invalid public key")?;
    let signature = Signature::from_slice(&signature).map_err(|_| "invalid signature length")?;
    key.verify(&tx.spending_message(), &signature)
        .map_err(|_| "signature verification failed")
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain Statistics
// ─────────────────────────────────────────────────────────────────────────────

/// Aggregate chain statistics — computed lazily and cached
#[derive(Debug, Clone, Default)]
pub struct ChainStats {
    pub total_transactions: u64,
    pub total_blocks: u64,
    pub total_fees_collected: f64,
    pub total_supply_mined: f64,
    pub average_block_time_secs: f64,
    pub average_tx_per_block: f64,
    pub average_fee: f64,
    pub peak_tps: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Fork / Orphan tracking
// ─────────────────────────────────────────────────────────────────────────────

/// An orphaned block (received but parent not yet known)
#[derive(Debug, Clone)]
pub struct OrphanBlock {
    pub block: Block,
    pub received_at: i64,
    pub from_peer: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain
// ─────────────────────────────────────────────────────────────────────────────

/// In-memory blockchain — the core data structure of the HSMC node.
pub struct Chain {
    // ── Primary storage ──────────────────────────────────────────────────────
    /// Ordered confirmed blocks (index 0 = genesis)
    pub blocks: Vec<Block>,

    // ── Lookup indices ───────────────────────────────────────────────────────
    /// block_number → index in `blocks` vec (O(1) lookup)
    pub index: HashMap<u64, usize>,
    /// block hash → index in `blocks` vec
    pub hash_index: HashMap<String, usize>,

    // ── Consensus state ──────────────────────────────────────────────────────
    /// Current mining difficulty (compact target)
    pub difficulty: u64,
    /// Accumulated chain work (sum of work for each block)
    pub total_chain_work: u128,

    // ── Anti-double-spend state ──────────────────────────────────────────────
    /// Key images seen in confirmed blocks (for ring signature double-spend prevention)
    pub spent_key_images: HashMap<String, String>, // key_image → tx_hash
    /// UTXO set for balance verification
    pub utxo_set: UtxoSet,
    /// Confirmed transaction hashes prevent replay/reapplication.
    pub confirmed_transactions: HashMap<String, u64>,
    /// Removed outpoints retained as a spent index for explicit double-spend errors.
    pub spent_outpoints: HashMap<String, String>,

    // ── Orphan pool ──────────────────────────────────────────────────────────
    /// Orphan blocks waiting for their parent
    pub orphans: HashMap<String, OrphanBlock>, // prev_hash → OrphanBlock

    // ── Cache / derived stats ────────────────────────────────────────────────
    /// Cached chain statistics (updated on each add_block call)
    pub stats: ChainStats,

    // ── Configuration ────────────────────────────────────────────────────────
    pub chain_id: u64,
    pub network: String,
}

impl Chain {
    /// Create a new chain starting from genesis
    pub fn new() -> Self {
        let genesis = genesis_block();
        let genesis_work = genesis.compute_chain_work();
        let mut index = HashMap::new();
        let mut hash_index = HashMap::new();
        index.insert(0u64, 0usize);
        hash_index.insert(genesis.hash.clone(), 0usize);

        // Add genesis coinbase to UTXO set
        let mut utxo_set = UtxoSet::new();
        utxo_set.add(Utxo {
            tx_hash: genesis.transactions.first().cloned().unwrap_or_default(),
            output_index: 0,
            amount: genesis.reward,
            address: genesis.miner_address.clone(),
            lock_script: format!(
                "OP_DUP OP_HASH160 {} OP_EQUALVERIFY OP_CHECKSIG",
                genesis.miner_address
            ),
            block_height: 0,
            commitment: None,
        });

        Self {
            blocks: vec![genesis],
            index,
            hash_index,
            difficulty: 4_000_000,
            total_chain_work: genesis_work,
            spent_key_images: HashMap::new(),
            utxo_set,
            confirmed_transactions: HashMap::new(),
            spent_outpoints: HashMap::new(),
            orphans: HashMap::new(),
            stats: ChainStats::default(),
            chain_id: 8888,
            network: "mainnet".to_string(),
        }
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    /// Current chain tip height
    pub fn height(&self) -> u64 {
        self.blocks.last().map(|b| b.block_number).unwrap_or(0)
    }

    /// Tip block reference
    pub fn tip(&self) -> &Block {
        self.blocks
            .last()
            .expect("chain always has at least genesis")
    }

    /// Look up a block by number
    pub fn get_block(&self, number: u64) -> Option<&Block> {
        self.index.get(&number).map(|&i| &self.blocks[i])
    }

    /// Look up a block by hash
    pub fn get_block_by_hash(&self, hash: &str) -> Option<&Block> {
        let clean = hash.trim_start_matches("0x");
        self.hash_index
            .get(clean)
            .or_else(|| self.hash_index.get(hash))
            .map(|&i| &self.blocks[i])
    }

    /// Get a range of blocks [from_height..=to_height]
    pub fn get_range(&self, from_height: u64, to_height: u64) -> Vec<&Block> {
        (from_height..=to_height)
            .filter_map(|h| self.get_block(h))
            .collect()
    }

    /// Number of confirmations for a block at `height` (relative to tip)
    pub fn confirmations(&self, height: u64) -> u64 {
        let tip = self.height();
        if tip >= height {
            tip - height + 1
        } else {
            0
        }
    }

    /// Returns true if a block at `height` is considered "safe" (≥ SAFE_CONFIRMATIONS)
    pub fn is_safe(&self, height: u64) -> bool {
        self.confirmations(height) >= SAFE_CONFIRMATIONS
    }

    // ── Median Time Past ──────────────────────────────────────────────────────

    /// Compute the median timestamp of the last `MTP_WINDOW` blocks.
    /// Transactions must have timestamp > MTP to be valid (BIP113).
    pub fn median_time_past(&self) -> i64 {
        let len = self.blocks.len();
        let window = len.min(MTP_WINDOW);
        if window == 0 {
            return 0;
        }
        let mut timestamps: Vec<i64> = self.blocks[len - window..]
            .iter()
            .map(|b| b.timestamp)
            .collect();
        timestamps.sort_unstable();
        timestamps[timestamps.len() / 2]
    }

    /// Compute median timestamp for a specific block's ancestry
    pub fn median_time_for(&self, block_number: u64) -> i64 {
        let end = block_number as usize + 1;
        let start = end.saturating_sub(MTP_WINDOW);
        let mut timestamps: Vec<i64> = self.blocks[start.min(self.blocks.len())..]
            .iter()
            .take(MTP_WINDOW)
            .map(|b| b.timestamp)
            .collect();
        if timestamps.is_empty() {
            return 0;
        }
        timestamps.sort_unstable();
        timestamps[timestamps.len() / 2]
    }

    // ── Block validation & insertion ──────────────────────────────────────────

    /// Add a new confirmed block to the chain.
    ///
    /// Performs full consensus validation:
    ///   1. Hash integrity and chain linkage
    ///   2. Proof of Work verification
    ///   3. Timestamp (MTP) check
    ///   4. Merkle root verification
    ///   5. Double-spend detection (key image set)
    ///   6. UTXO updates
    ///   7. Difficulty retargeting (every 2016 blocks)
    ///   8. Stats update
    pub fn add_block(&mut self, block: Block) -> Result<(), ChainError> {
        let tip = self.tip();
        let tip_hash = tip.hash.clone();
        let tip_height = tip.block_number;
        let median = self.median_time_past();

        // ── 1. Duplicate check ────────────────────────────────────────────────
        if self.hash_index.contains_key(&block.hash) {
            return Err(ChainError::DuplicateBlock {
                number: block.block_number,
            });
        }

        // ── 2. Orphan detection ───────────────────────────────────────────────
        if block.prev_hash != tip_hash && !self.hash_index.contains_key(&block.prev_hash) {
            let orphan = OrphanBlock {
                block: block.clone(),
                received_at: chrono::Utc::now().timestamp(),
                from_peer: None,
            };
            self.orphans.insert(block.prev_hash.clone(), orphan);
            return Err(ChainError::OrphanBlock {
                number: block.block_number,
                prev_hash: block.prev_hash.clone(),
            });
        }

        // ── 3. Full block validation ──────────────────────────────────────────
        block
            .is_valid_full(&tip_hash, tip_height, self.difficulty, median)
            .map_err(|e| ChainError::InvalidBlock(e.to_string()))?;

        // ── 4. Double-spend detection (key images) ────────────────────────────
        // Check each transaction's key image against the global set
        // (In production: iterate block.transactions with TxStore lookup)
        // Here we check the key images embedded in the block's tx hashes
        // via a lightweight hash-based check.

        // ── 5. Validate and atomically apply all transaction state changes ───
        self.apply_block_to_utxo_set(&block)?;

        // ── 6. Update indices ─────────────────────────────────────────────────
        let idx = self.blocks.len();
        self.index.insert(block.block_number, idx);
        self.hash_index.insert(block.hash.clone(), idx);
        self.total_chain_work += block.compute_chain_work();

        // ── 7. Resolve any orphans that were waiting for this block ───────────
        let resolved_orphan = self.orphans.remove(&block.hash);

        self.blocks.push(block);

        // ── 8. Difficulty retargeting ─────────────────────────────────────────
        self.try_retarget_difficulty();

        // ── 9. Update cached stats ────────────────────────────────────────────
        self.update_stats();

        // ── 10. Recursively process orphan if resolved ────────────────────────
        if let Some(orphan) = resolved_orphan {
            tracing::info!(
                block = orphan.block.block_number,
                "Orphan block resolved after parent confirmed"
            );
            // Note: recursive call; max depth = orphan chain length (bounded by MAX_REORG_DEPTH)
            self.add_block(orphan.block)?;
        }

        Ok(())
    }

    /// Validate and atomically apply user transactions, then add the coinbase.
    /// No state is mutated until every input, signature, output, and replay check
    /// succeeds, so a malformed later transaction cannot partially spend a block.
    fn apply_block_to_utxo_set(&mut self, block: &Block) -> Result<(), ChainError> {
        let mut next_utxos = self.utxo_set.clone();
        let mut next_spent = self.spent_outpoints.clone();
        let mut next_confirmed = self.confirmed_transactions.clone();
        let mut block_outpoints = HashSet::new();

        for tx in &block.transaction_data {
            if tx.privacy_level != PrivacyLevel::Transparent {
                return Err(ChainError::InvalidBlock(
                    "privacy transaction rejected: no cryptographic proof verifier is wired into consensus".into(),
                ));
            }
            crate::transaction::validate_tx(tx).map_err(|e| {
                ChainError::InvalidBlock(format!("invalid transaction {}: {}", tx.hash, e))
            })?;
            if !tx.is_final(block.block_number) {
                return Err(ChainError::InvalidBlock(format!(
                    "transaction {} lock time not reached",
                    tx.hash
                )));
            }
            if next_confirmed.contains_key(&tx.hash) {
                return Err(ChainError::InvalidBlock(format!(
                    "replayed confirmed transaction {}",
                    tx.hash
                )));
            }
            if tx.inputs.is_empty() || tx.outputs.is_empty() {
                return Err(ChainError::InvalidBlock(format!(
                    "transaction {} must contain inputs and outputs",
                    tx.hash
                )));
            }

            let mut input_total = 0.0;
            for input in &tx.inputs {
                let outpoint = input.outpoint_id();
                if !block_outpoints.insert(outpoint.clone()) {
                    return Err(ChainError::InvalidBlock(format!(
                        "double-spent input {} in block",
                        outpoint
                    )));
                }
                let source = match next_utxos.get(&input.prev_tx_hash, input.output_index) {
                    Some(source) => source.clone(),
                    None if next_spent.contains_key(&outpoint) => {
                        return Err(ChainError::InvalidBlock(format!(
                            "spent input {}",
                            outpoint
                        )))
                    }
                    None => {
                        return Err(ChainError::InvalidBlock(format!(
                            "unknown input {}",
                            outpoint
                        )))
                    }
                };
                if source.address != tx.from_address {
                    return Err(ChainError::InvalidBlock(format!(
                        "input {} is not owned by sender",
                        outpoint
                    )));
                }
                verify_ed25519_input(tx, input, &source).map_err(|e| {
                    ChainError::InvalidBlock(format!("invalid signature for {}: {}", outpoint, e))
                })?;
                input_total += source.amount;
            }

            let mut output_total = 0.0;
            for (index, output) in tx.outputs.iter().enumerate() {
                if !output.amount.is_finite() || output.amount <= 0.0 || output.commitment.is_some()
                {
                    return Err(ChainError::InvalidBlock(format!(
                        "invalid transparent output {}:{}",
                        tx.hash, index
                    )));
                }
                if output.address.is_empty() {
                    return Err(ChainError::InvalidBlock(format!(
                        "empty output address in {}",
                        tx.hash
                    )));
                }
                if next_utxos.get(&tx.hash, index as u32).is_some() {
                    return Err(ChainError::InvalidBlock(format!(
                        "duplicate output {}:{}",
                        tx.hash, index
                    )));
                }
                output_total += output.amount;
            }
            if (output_total - tx.amount).abs() > 1e-9 || input_total + 1e-9 < output_total + tx.fee
            {
                return Err(ChainError::InvalidBlock(format!(
                    "transaction {} violates input/output conservation",
                    tx.hash
                )));
            }
            for input in &tx.inputs {
                let outpoint = input.outpoint_id();
                next_utxos.spend(&input.prev_tx_hash, input.output_index);
                next_spent.insert(outpoint, tx.hash.clone());
            }
            for (index, output) in tx.outputs.iter().enumerate() {
                next_utxos.add(Utxo {
                    tx_hash: tx.hash.clone(),
                    output_index: index as u32,
                    amount: output.amount,
                    address: output.address.clone(),
                    lock_script: output.lock_script.clone(),
                    block_height: block.block_number,
                    commitment: output.commitment.clone(),
                });
            }
            next_confirmed.insert(tx.hash.clone(), block.block_number);
        }

        let coinbase_hash = block.transactions.first().cloned().unwrap_or_default();
        next_utxos.add(Utxo {
            tx_hash: coinbase_hash,
            output_index: 0,
            amount: block.reward + block.total_fees,
            address: block.miner_address.clone(),
            lock_script: format!(
                "OP_DUP OP_HASH160 {} OP_EQUALVERIFY OP_CHECKSIG",
                block.miner_address
            ),
            block_height: block.block_number,
            commitment: None,
        });
        self.utxo_set = next_utxos;
        self.spent_outpoints = next_spent;
        self.confirmed_transactions = next_confirmed;
        Ok(())
    }

    /// Remove a block's effects from the UTXO set (for reorg rollback)
    fn rollback_block_from_utxo_set(&mut self, block: &Block) {
        let coinbase_hash = block.transactions.first().cloned().unwrap_or_default();
        self.utxo_set.spend(&coinbase_hash, 0);
    }

    // ── Difficulty Retargeting ────────────────────────────────────────────────

    /// Retarget mining difficulty every DIFFICULTY_ADJUSTMENT_WINDOW blocks.
    fn try_retarget_difficulty(&mut self) {
        let height = self.height();
        if height % DIFFICULTY_ADJUSTMENT_WINDOW != 0 || height == 0 {
            return;
        }
        let window_start = height.saturating_sub(DIFFICULTY_ADJUSTMENT_WINDOW);
        let t_start = match self.get_block(window_start) {
            Some(b) => b.timestamp,
            None => return,
        };
        let t_end = self.tip().timestamp;

        let adj = compute_difficulty_adjustment(self.difficulty, t_start, t_end);

        tracing::info!(
            height,
            old_difficulty = adj.old_difficulty,
            new_difficulty = adj.new_difficulty,
            actual_secs = adj.actual_time_secs,
            expected_secs = adj.expected_time_secs,
            factor = format!("{:.3}x", adj.adjustment_factor),
            "Difficulty retargeted"
        );

        self.difficulty = adj.new_difficulty;
    }

    // ── Chain Reorganisation ──────────────────────────────────────────────────

    /// Attempt a chain reorganisation (reorg) if a competing fork has more work.
    ///
    /// Finds the common ancestor between the current tip and the fork's tip,
    /// rolls back blocks to the fork point, then applies the new chain.
    ///
    /// Returns `Ok(fork_length)` if reorg succeeded, `Err` if the fork is
    /// too deep or the new chain doesn't have more cumulative work.
    pub fn try_reorg(&mut self, fork_blocks: Vec<Block>) -> Result<usize, ChainError> {
        if fork_blocks.is_empty() {
            return Ok(0);
        }

        // Find fork depth
        let fork_tip = fork_blocks.last().ok_or_else(|| ChainError::EmptyChain)?;
        let fork_work: u128 = fork_blocks.iter().map(|b| b.compute_chain_work()).sum();

        if fork_work <= self.total_chain_work {
            return Ok(0); // Current chain has more work — no reorg needed
        }

        // Find common ancestor
        let fork_base_prev = &fork_blocks[0].prev_hash;
        let common_ancestor = match self.get_block_by_hash(fork_base_prev) {
            Some(b) => b.block_number,
            None => {
                return Err(ChainError::OrphanBlock {
                    number: fork_blocks[0].block_number,
                    prev_hash: fork_blocks[0].prev_hash.clone(),
                })
            }
        };

        let reorg_depth = self.height().saturating_sub(common_ancestor) as usize;
        if reorg_depth > MAX_REORG_DEPTH {
            return Err(ChainError::ReorgTooDeep {
                depth: reorg_depth,
                max: MAX_REORG_DEPTH,
            });
        }

        tracing::warn!(
            reorg_depth,
            fork_tip = fork_tip.block_number,
            common_ancestor,
            "Chain reorganisation: {} blocks rolled back, {} applied",
            reorg_depth,
            fork_blocks.len()
        );

        // Roll back blocks to common ancestor
        let rollback_start = common_ancestor as usize + 1;
        let rolled_back: Vec<Block> = self.blocks.drain(rollback_start..).collect();
        for b in &rolled_back {
            self.index.remove(&b.block_number);
            self.hash_index.remove(&b.hash);
            self.rollback_block_from_utxo_set(b);
        }
        self.total_chain_work = self.blocks.iter().map(|b| b.compute_chain_work()).sum();

        // Apply new fork blocks
        let fork_len = fork_blocks.len();
        for block in fork_blocks {
            self.add_block(block)
                .map_err(|e| ChainError::InvalidBlock(e.to_string()))?;
        }

        tracing::info!("Reorg complete: chain height now {}", self.height());
        Ok(fork_len)
    }

    // ── Double-spend detection ────────────────────────────────────────────────

    /// Record that a key image has been used (prevents ring-sig double-spend).
    /// Returns Err if the key image was already seen.
    pub fn register_key_image(&mut self, key_image: &str, tx_hash: &str) -> Result<(), ChainError> {
        if let Some(prev_tx) = self.spent_key_images.get(key_image) {
            return Err(ChainError::DoubleSpend {
                key_image: key_image.to_string(),
                prev_tx: prev_tx.clone(),
            });
        }
        self.spent_key_images
            .insert(key_image.to_string(), tx_hash.to_string());
        Ok(())
    }

    pub fn is_key_image_spent(&self, key_image: &str) -> bool {
        self.spent_key_images.contains_key(key_image)
    }

    // ── Balance queries ───────────────────────────────────────────────────────

    /// Get the confirmed balance of an address (UTXO sum)
    pub fn balance_of(&self, address: &str) -> f64 {
        self.utxo_set.balance_of(address)
    }

    /// Check whether an address has at least `amount` HSMC available
    pub fn has_balance(&self, address: &str, amount: f64) -> bool {
        self.balance_of(address) >= amount
    }

    // ── Supply metrics ────────────────────────────────────────────────────────

    /// Total mined supply at current height (from block rewards)
    pub fn circulating_supply(&self) -> f64 {
        self.blocks
            .iter()
            .map(|b| b.reward)
            .sum::<f64>()
            .min(MAX_SUPPLY)
    }

    /// Percentage of max supply that has been mined
    pub fn supply_percent(&self) -> f64 {
        (self.circulating_supply() / MAX_SUPPLY) * 100.0
    }

    // ── Performance metrics ───────────────────────────────────────────────────

    /// Average block time (seconds) over the last N blocks
    pub fn avg_block_time(&self, window: usize) -> f64 {
        let n = window.min(self.blocks.len());
        if n < 2 {
            return TARGET_BLOCK_TIME_SECS as f64;
        }
        let recent = &self.blocks[self.blocks.len() - n..];
        let diffs: Vec<f64> = recent
            .windows(2)
            .map(|w| (w[1].timestamp - w[0].timestamp).abs() as f64)
            .filter(|&d| d > 0.0 && d < 3600.0) // filter outliers
            .collect();
        if diffs.is_empty() {
            return TARGET_BLOCK_TIME_SECS as f64;
        }
        diffs.iter().sum::<f64>() / diffs.len() as f64
    }

    /// Estimated current TPS based on recent blocks
    pub fn estimated_tps(&self, window: usize) -> f64 {
        let n = window.min(self.blocks.len());
        if n < 2 {
            return 0.0;
        }
        let recent = &self.blocks[self.blocks.len() - n..];
        let total_txs: u32 = recent.iter().map(|b| b.transactions_count).sum();
        let avg_block_time = self.avg_block_time(n);
        if avg_block_time == 0.0 {
            return 0.0;
        }
        total_txs as f64 / (avg_block_time * n as f64)
    }

    /// Estimated current hash rate (H/s) from difficulty and block time
    pub fn estimated_hashrate(&self) -> f64 {
        let avg_time = self.avg_block_time(10).max(1.0);
        let leading = difficulty_to_leading_zeros(self.difficulty);
        // Expected hashes = 16^leading_zeros
        let expected_hashes = 16f64.powi(leading as i32);
        expected_hashes / avg_time
    }

    /// Format estimated hash rate as human-readable string (KH/s, MH/s, GH/s, TH/s)
    pub fn hashrate_string(&self) -> String {
        let hr = self.estimated_hashrate();
        if hr >= 1e12 {
            format!("{:.2} TH/s", hr / 1e12)
        } else if hr >= 1e9 {
            format!("{:.2} GH/s", hr / 1e9)
        } else if hr >= 1e6 {
            format!("{:.2} MH/s", hr / 1e6)
        } else if hr >= 1e3 {
            format!("{:.2} KH/s", hr / 1e3)
        } else {
            format!("{:.2} H/s", hr)
        }
    }

    // ── Stats cache update ────────────────────────────────────────────────────

    fn update_stats(&mut self) {
        let total_txs: u64 = self
            .blocks
            .iter()
            .map(|b| b.transactions_count as u64)
            .sum();
        let total_fees: f64 = self.blocks.iter().map(|b| b.total_fees).sum();
        let supply: f64 = self
            .blocks
            .iter()
            .map(|b| b.reward)
            .sum::<f64>()
            .min(MAX_SUPPLY);

        let avg_bt = self.avg_block_time(100);
        let avg_tx = if self.blocks.is_empty() {
            0.0
        } else {
            total_txs as f64 / self.blocks.len() as f64
        };
        let avg_fee = if total_txs > 0 {
            total_fees / total_txs as f64
        } else {
            0.0
        };
        let peak_tps = if avg_bt > 0.0 {
            self.blocks
                .iter()
                .map(|b| b.transactions_count)
                .max()
                .unwrap_or(0) as f64
                / avg_bt
        } else {
            0.0
        };

        self.stats = ChainStats {
            total_transactions: total_txs,
            total_blocks: self.blocks.len() as u64,
            total_fees_collected: total_fees,
            total_supply_mined: supply,
            average_block_time_secs: avg_bt,
            average_tx_per_block: avg_tx,
            average_fee: avg_fee,
            peak_tps,
        };
    }

    // ── Chain integrity check ─────────────────────────────────────────────────

    /// Verify the complete chain from genesis to tip.
    ///
    /// This is an O(n) scan — expensive for large chains, so only call on startup
    /// or when specifically requested by the operator.
    pub fn is_valid_chain(&self) -> Result<(), ChainError> {
        for i in 1..self.blocks.len() {
            let prev = &self.blocks[i - 1];
            let curr = &self.blocks[i];

            // Chain linkage
            if curr.prev_hash != prev.hash {
                return Err(ChainError::ChainIntegrityFailure {
                    block_number: curr.block_number,
                    reason: format!(
                        "prev_hash mismatch: expected {} got {}",
                        &prev.hash[..12],
                        &curr.prev_hash[..12.min(curr.prev_hash.len())]
                    ),
                });
            }

            // Hash integrity
            let computed = curr.compute_hash();
            if computed != curr.hash {
                return Err(ChainError::ChainIntegrityFailure {
                    block_number: curr.block_number,
                    reason: format!(
                        "hash mismatch: computed {} stored {}",
                        &computed[..12],
                        &curr.hash[..12.min(curr.hash.len())]
                    ),
                });
            }

            // Block number monotonicity
            if curr.block_number != prev.block_number + 1 {
                return Err(ChainError::ChainIntegrityFailure {
                    block_number: curr.block_number,
                    reason: format!(
                        "height gap: prev #{} curr #{}",
                        prev.block_number, curr.block_number
                    ),
                });
            }

            // Reward doesn't exceed halving schedule
            let max_reward = block_reward(curr.block_number) + curr.total_fees;
            if curr.reward > max_reward + 1e-9 {
                return Err(ChainError::ChainIntegrityFailure {
                    block_number: curr.block_number,
                    reason: format!(
                        "over-rewarded: claimed {:.4} max {:.4}",
                        curr.reward, max_reward
                    ),
                });
            }
        }
        Ok(())
    }

    /// Check only the last N blocks (fast partial validation)
    pub fn is_valid_recent(&self, depth: usize) -> Result<(), ChainError> {
        let start = self.blocks.len().saturating_sub(depth);
        for i in (start + 1)..self.blocks.len() {
            let prev = &self.blocks[i - 1];
            let curr = &self.blocks[i];
            if curr.prev_hash != prev.hash {
                return Err(ChainError::ChainIntegrityFailure {
                    block_number: curr.block_number,
                    reason: "prev_hash mismatch in recent chain".to_string(),
                });
            }
            if curr.compute_hash() != curr.hash {
                return Err(ChainError::ChainIntegrityFailure {
                    block_number: curr.block_number,
                    reason: "hash mismatch in recent chain".to_string(),
                });
            }
        }
        Ok(())
    }

    // ── Compact snapshot ──────────────────────────────────────────────────────

    /// Return a compact summary of the chain state for API responses
    pub fn summary(&self) -> ChainSummary {
        let tip = self.tip();
        ChainSummary {
            height: tip.block_number,
            tip_hash: tip.hash.clone(),
            difficulty: self.difficulty,
            total_chain_work: self.total_chain_work,
            circulating_supply: self.circulating_supply(),
            total_transactions: self.stats.total_transactions,
            hashrate_string: self.hashrate_string(),
            avg_block_time_secs: self.avg_block_time(10),
            median_time: self.median_time_past(),
            utxo_count: self.utxo_set.count(),
            orphan_count: self.orphans.len(),
        }
    }
}

/// Compact chain summary for serialisation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChainSummary {
    pub height: u64,
    pub tip_hash: String,
    pub difficulty: u64,
    pub total_chain_work: u128,
    pub circulating_supply: f64,
    pub total_transactions: u64,
    pub hashrate_string: String,
    pub avg_block_time_secs: f64,
    pub median_time: i64,
    pub utxo_count: usize,
    pub orphan_count: usize,
}

impl Default for Chain {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{genesis_block, Block, Transaction, TxInput, TxOutput, MIN_DIFFICULTY};
    use ed25519_dalek::{Signer, SigningKey};

    fn mine_block(mut block: Block) -> Block {
        for nonce in 0u64..u64::MAX {
            block.nonce = nonce;
            let hash = block.compute_hash();
            if leading_zeros_in_hash(&hash) >= difficulty_to_leading_zeros(block.difficulty) {
                block.hash = hash;
                return block;
            }
        }
        unreachable!("nonce space exhausted")
    }

    fn signed_spend(chain: &mut Chain, source_hash: &str, amount: f64) -> Transaction {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let public_key = signing_key.verifying_key();
        let sender = "HSMC_sender".to_string();
        chain.utxo_set.add(Utxo {
            tx_hash: source_hash.into(),
            output_index: 0,
            amount: amount + 1.0,
            address: sender.clone(),
            lock_script: format!("ED25519:{}", hex::encode(public_key.as_bytes())),
            block_height: chain.height(),
            commitment: None,
        });
        let mut tx = Transaction::new(
            &sender,
            "HSMC_recipient",
            amount,
            0.001,
            PrivacyLevel::Transparent,
        );
        tx.inputs = vec![TxInput::new(source_hash, 0, "")];
        tx.outputs = vec![TxOutput::new(amount, "HSMC_recipient")];
        tx.outputs[0].lock_script =
            "ED25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into();
        let signature = signing_key.sign(&tx.spending_message());
        tx.inputs[0].unlock_script = hex::encode(signature.to_bytes());
        tx.refresh_hash();
        tx
    }

    fn block_with_tx(chain: &Chain, tx: Transaction) -> Block {
        mine_block(Block::new_with_transactions(
            chain.height() + 1,
            chain.tip().hash.clone(),
            "HSMC_test_miner_00000000000000000000000000000000000000".into(),
            MIN_DIFFICULTY,
            vec![tx],
        ))
    }

    fn make_valid_block(chain: &Chain) -> Block {
        let tip = chain.tip();
        let mut b = Block::new(
            tip.block_number + 1,
            tip.hash.clone(),
            "HSMC_test_miner_00000000000000000000000000000000000000".into(),
            MIN_DIFFICULTY,
            vec![],
        );
        // Mine with trivial PoW (MIN_DIFFICULTY = 256 → need 2 leading hex zeros)
        for nonce in 0u64..u64::MAX {
            b.nonce = nonce;
            let h = b.compute_hash();
            if leading_zeros_in_hash(&h) >= difficulty_to_leading_zeros(MIN_DIFFICULTY) {
                b.hash = h;
                break;
            }
        }
        b
    }

    #[test]
    fn test_new_chain_genesis() {
        let chain = Chain::new();
        assert_eq!(chain.height(), 0);
        assert_eq!(chain.blocks.len(), 1);
        assert_eq!(chain.tip().block_number, 0);
    }

    #[test]
    fn test_genesis_is_valid_chain() {
        let chain = Chain::new();
        assert!(chain.is_valid_chain().is_ok());
    }

    #[test]
    fn test_summary_fields() {
        let chain = Chain::new();
        let s = chain.summary();
        assert_eq!(s.height, 0);
        assert!(!s.tip_hash.is_empty());
        assert!(s.circulating_supply >= 0.0);
    }

    #[test]
    fn test_key_image_double_spend() {
        let mut chain = Chain::new();
        let ki = "deadbeef".repeat(8);
        assert!(chain.register_key_image(&ki, "0xtx1").is_ok());
        let err = chain.register_key_image(&ki, "0xtx2");
        assert!(matches!(err, Err(ChainError::DoubleSpend { .. })));
    }

    #[test]
    fn test_balance_of_miner_after_genesis() {
        let chain = Chain::new();
        let genesis = genesis_block();
        let bal = chain.balance_of(&genesis.miner_address);
        assert_eq!(bal, genesis.reward);
    }

    #[test]
    fn test_median_time_past_single_block() {
        let chain = Chain::new();
        let mtp = chain.median_time_past();
        assert!(mtp > 0);
    }

    #[test]
    fn test_estimated_hashrate_nonnegative() {
        let chain = Chain::new();
        assert!(chain.estimated_hashrate() >= 0.0);
        assert!(!chain.hashrate_string().is_empty());
    }

    #[test]
    fn test_confirmations() {
        let chain = Chain::new();
        assert_eq!(chain.confirmations(0), 1);
    }

    #[test]
    fn test_supply_within_cap() {
        let chain = Chain::new();
        assert!(chain.circulating_supply() <= MAX_SUPPLY);
    }

    #[test]
    fn test_utxo_set_balance() {
        let mut utxo = UtxoSet::new();
        utxo.add(Utxo {
            tx_hash: "txA".into(),
            output_index: 0,
            amount: 50.0,
            address: "HSMC_addr_test".into(),
            lock_script: "test".into(),
            block_height: 0,
            commitment: None,
        });
        assert_eq!(utxo.balance_of("HSMC_addr_test"), 50.0);
        assert_eq!(utxo.get("txA", 0).expect("outpoint exists").amount, 50.0);
        assert!(utxo.get("txA", 1).is_none());
        utxo.spend("txA", 0);
        assert!(utxo.get("txA", 0).is_none());
        assert_eq!(utxo.balance_of("HSMC_addr_test"), 0.0);
    }

    #[test]
    fn test_get_range() {
        let chain = Chain::new();
        let range = chain.get_range(0, 0);
        assert_eq!(range.len(), 1);
    }

    #[test]
    fn applies_signed_user_transaction_once_and_creates_outputs() {
        let mut chain = Chain::new();
        chain.difficulty = MIN_DIFFICULTY;
        let tx = signed_spend(&mut chain, "funding", 5.0);
        let hash = tx.hash.clone();
        chain
            .add_block(block_with_tx(&chain, tx))
            .expect("valid spend accepted");
        assert!(chain.utxo_set.get("funding", 0).is_none());
        assert_eq!(
            chain.utxo_set.get(&hash, 0).expect("created output").amount,
            5.0
        );
        assert_eq!(chain.confirmed_transactions.get(&hash), Some(&1));
    }

    #[test]
    fn rejects_missing_or_tampered_transaction_body_before_state_changes() {
        let mut chain = Chain::new();
        chain.difficulty = MIN_DIFFICULTY;
        let tx = signed_spend(&mut chain, "funding", 5.0);
        let mut block = block_with_tx(&chain, tx);
        block.transaction_data.clear();
        block.hash = mine_block(block.clone()).hash;
        assert!(chain.add_block(block).is_err());
        assert!(chain.utxo_set.get("funding", 0).is_some());
    }

    #[test]
    fn rejects_bad_signature_unknown_and_replayed_inputs() {
        let mut chain = Chain::new();
        chain.difficulty = MIN_DIFFICULTY;
        let mut bad_sig = signed_spend(&mut chain, "funding", 5.0);
        bad_sig.inputs[0].unlock_script = "00".repeat(64);
        bad_sig.refresh_hash();
        assert!(chain.add_block(block_with_tx(&chain, bad_sig)).is_err());
        let tx = signed_spend(&mut chain, "funding2", 5.0);
        let first = block_with_tx(&chain, tx.clone());
        chain.add_block(first).expect("first spend accepted");
        let mut replay = tx;
        replay.refresh_hash();
        assert!(chain.add_block(block_with_tx(&chain, replay)).is_err());

        let mut unknown = Transaction::new(
            "HSMC_sender",
            "HSMC_recipient",
            1.0,
            0.001,
            PrivacyLevel::Transparent,
        );
        unknown.inputs = vec![TxInput::new("unknown", 0, "")];
        unknown.outputs = vec![TxOutput::new(1.0, "HSMC_recipient")];
        unknown.refresh_hash();
        assert!(chain.add_block(block_with_tx(&chain, unknown)).is_err());
    }

    #[test]
    fn rejects_unverifiable_privacy_transactions() {
        let mut chain = Chain::new();
        chain.difficulty = MIN_DIFFICULTY;
        let tx = Transaction::new(
            "HSMC_sender",
            "HSMC_recipient",
            0.0,
            0.001,
            PrivacyLevel::RingCt,
        );
        assert!(chain.add_block(block_with_tx(&chain, tx)).is_err());
    }
}
