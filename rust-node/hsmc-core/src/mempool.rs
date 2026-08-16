/// ============================================================================
/// HSMC Mempool — Production-Grade Unconfirmed Transaction Pool
/// ============================================================================
/// The Mempool manages all unconfirmed transactions pending inclusion in a block.
///
/// Features:
///   • Fee-prioritised selection (fee-per-byte descending — like Bitcoin Core)
///   • Replace-By-Fee (RBF) support (BIP125)
///   • Key-image index for ring-signature double-spend prevention
///   • Address-indexed transaction lookup for wallet queries
///   • Eviction policy: lowest fee-per-byte evicted when pool is full
///   • Child-Pays-for-Parent (CPFP) ancestor fee accumulation
///   • Transaction expiry: txs older than MAX_TX_AGE_SECS are evicted
///   • Package relay: accept dependent transaction bundles atomically
///   • Privacy-aware: Dandelion++ stem-phase transactions are tracked separately
///   • Mempool statistics: fee histogram, congestion factor, estimated next-block fees
///   • Configurable maximum size and per-address transaction limits
/// ============================================================================

use std::collections::{HashMap, HashSet, BTreeMap};
use chrono::Utc;
use serde::Serialize;
use crate::{
    Transaction, TxStatus, PrivacyLevel, TxValidationError,
};
use crate::transaction::validate_tx;
// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Default maximum number of transactions in the mempool
pub const DEFAULT_MEMPOOL_MAX_SIZE: usize = 10_000;

/// Minimum mempool size (prevents denial-of-service via tiny txs)
pub const MIN_MEMPOOL_SIZE: usize = 100;

/// Maximum number of transactions from a single address in the mempool
pub const MAX_TX_PER_ADDRESS: usize = 25;

/// Transaction expiry: evict unconfirmed txs older than this (seconds)
pub const MAX_TX_AGE_SECS: i64 = 72 * 3600; // 72 hours

/// Minimum fee-per-byte increment for RBF replacement (10%)
pub const RBF_FEE_INCREMENT: f64 = 0.1; // 10% higher fee required

/// Maximum package size for CPFP relay (transactions + ancestors)
pub const MAX_PACKAGE_SIZE: usize = 25;

/// Ancestor fee scan depth for CPFP
pub const MAX_ANCESTOR_DEPTH: usize = 25;

/// Number of fee histogram buckets
pub const FEE_HISTOGRAM_BUCKETS: usize = 10;

// ─────────────────────────────────────────────────────────────────────────────
// MempoolEntry — enriched wrapper around a Transaction
// ─────────────────────────────────────────────────────────────────────────────

/// A transaction entry in the mempool with pre-computed priority metadata.
#[derive(Debug, Clone)]
pub struct MempoolEntry {
    /// The transaction itself
    pub tx: Transaction,
    /// Effective fee per byte (used for ordering)
    pub fee_per_byte: f64,
    /// Accumulated ancestor fee (for CPFP chains)
    pub ancestor_fee: f64,
    /// Set of tx hashes that this tx depends on (its parents in the mempool)
    pub parent_hashes: HashSet<String>,
    /// Set of tx hashes that depend on this tx
    pub child_hashes: HashSet<String>,
    /// UNIX timestamp when this tx was added to the mempool
    pub added_at: i64,
    /// Number of times this tx has been broadcast via Dandelion++ stem phase
    pub dandelion_stem_hops: u8,
    /// true if this tx is still in Dandelion++ stem phase (not yet broadcast)
    pub in_stem_phase: bool,
    /// Validation result cache (avoids re-validating on every select call)
    pub last_validated_at: i64,
}

impl MempoolEntry {
    pub fn new(tx: Transaction) -> Self {
        let size = tx.size_bytes.max(250) as f64;
        let fpb  = if size > 0.0 { tx.fee / size } else { tx.fee };
        let now  = Utc::now().timestamp();
        Self {
            fee_per_byte:       fpb,
            ancestor_fee:       tx.fee,
            parent_hashes:      HashSet::new(),
            child_hashes:       HashSet::new(),
            added_at:           now,
            dandelion_stem_hops: 0,
            in_stem_phase:      false,
            last_validated_at:  now,
            tx,
        }
    }

    /// Age of this entry in seconds
    pub fn age_secs(&self) -> i64 {
        Utc::now().timestamp() - self.added_at
    }

    /// Is this entry expired?
    pub fn is_expired(&self) -> bool {
        self.age_secs() > MAX_TX_AGE_SECS
    }

    /// Effective fee per byte including ancestor fees (for CPFP)
    pub fn effective_fee_per_byte(&self) -> f64 {
        let total_size = self.tx.size_bytes.max(250) as f64;
        self.ancestor_fee / total_size
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MempoolStats
// ─────────────────────────────────────────────────────────────────────────────

/// Real-time mempool statistics for fee estimation and UI display
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MempoolStats {
    /// Current number of transactions in the mempool
    pub size: usize,
    /// Capacity utilisation [0.0, 1.0]
    pub congestion_factor: f64,
    /// Total fee revenue available for next block miner
    pub total_pending_fees: f64,
    /// Minimum fee per byte currently in pool
    pub min_fee_per_byte: f64,
    /// Median fee per byte
    pub median_fee_per_byte: f64,
    /// Maximum fee per byte (most urgent tx)
    pub max_fee_per_byte: f64,
    /// Estimated fee per byte to be included in the next block
    pub next_block_fee_estimate: f64,
    /// Number of transactions per privacy level
    pub transparent_count:   usize,
    pub ringct_count:        usize,
    pub stealth_count:       usize,
    pub full_privacy_count:  usize,
    /// Number of RBF-enabled transactions
    pub rbf_count:  usize,
    /// Number of Dandelion++ stem-phase transactions
    pub stem_count: usize,
    /// Number of expired transactions (awaiting eviction)
    pub expired_count: usize,
    /// Fee histogram: (fee_per_byte_lower_bound, tx_count) pairs
    pub fee_histogram: Vec<(f64, usize)>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Mempool
// ─────────────────────────────────────────────────────────────────────────────

/// Production-grade in-memory mempool for unconfirmed transactions.
pub struct Mempool {
    // ── Primary storage ──────────────────────────────────────────────────────
    /// tx_hash → MempoolEntry
    pub entries: HashMap<String, MempoolEntry>,

    // ── Auxiliary indices ─────────────────────────────────────────────────────
    /// key_image → tx_hash (prevents ring-sig double-spend in mempool)
    pub key_images: HashMap<String, String>,
    /// from_address → set of tx hashes (for per-address limits and wallet queries)
    pub by_address: HashMap<String, HashSet<String>>,
    /// Fee-ordered index: (fee_per_byte * 1e12 as u64) → tx_hash
    /// Using BTreeMap so we can efficiently select top-N and evict bottom-N
    pub fee_index: BTreeMap<u64, String>,

    // ── Configuration ────────────────────────────────────────────────────────
    pub max_size: usize,
    pub max_tx_per_address: usize,

    // ── Stats cache ───────────────────────────────────────────────────────────
    stats_dirty: bool,
    cached_stats: Option<MempoolStats>,
}

impl Mempool {
    pub fn new() -> Self {
        Self {
            entries:            HashMap::new(),
            key_images:         HashMap::new(),
            by_address:         HashMap::new(),
            fee_index:          BTreeMap::new(),
            max_size:           DEFAULT_MEMPOOL_MAX_SIZE,
            max_tx_per_address: MAX_TX_PER_ADDRESS,
            stats_dirty:        false,
            cached_stats:       None,
        }
    }

    pub fn with_max_size(mut self, max_size: usize) -> Self {
        self.max_size = max_size.max(MIN_MEMPOOL_SIZE);
        self
    }

    // ── Insertion ─────────────────────────────────────────────────────────────

    /// Add a transaction to the mempool.
    ///
    /// Performs full validation including:
    ///   - Transaction field validation
    ///   - Key image double-spend check
    ///   - Per-address limit enforcement
    ///   - Pool capacity management (evict lowest-fee-per-byte tx if full)
    ///   - RBF replacement if a conflicting tx with lower fee is found
    pub fn add(&mut self, tx: Transaction) -> Result<String, MempoolError> {
        // Basic validation
        validate_tx(&tx).map_err(MempoolError::InvalidTx)?;

        let hash = tx.hash.clone();

        // Duplicate check
        if self.entries.contains_key(&hash) {
            return Err(MempoolError::Duplicate { hash });
        }

        // RBF check: if a tx from same address/nonce exists, require higher fee
        if let Some(replaced) = self.check_rbf_replacement(&tx)? {
            self.remove(&replaced);
        }

        // Key image double-spend check (ring signature txs)
        if let Some(ref ki) = tx.key_image {
            if let Some(existing_tx) = self.key_images.get(ki.as_str()) {
                return Err(MempoolError::KeyImageDoubleSpend {
                    key_image:    ki.clone(),
                    existing_hash:existing_tx.clone(),
                });
            }
        }

        // Per-address limit
        let from = tx.from_address.clone();
        let addr_count = self.by_address.get(&from).map(|s| s.len()).unwrap_or(0);
        if addr_count >= self.max_tx_per_address {
            return Err(MempoolError::AddressLimitExceeded {
                address: from.clone(),
                limit:   self.max_tx_per_address,
            });
        }

        // Pool size limit: evict lowest-priority tx if needed
        if self.entries.len() >= self.max_size {
            let entry_fpb = tx.fee_per_byte();
            let evicted = self.evict_lowest_priority_for(entry_fpb)?;
            if let Some(evicted_hash) = evicted {
                tracing::debug!(evicted = %evicted_hash, added = %hash, "Mempool eviction");
            }
        }

        // Build entry
        let mut entry = MempoolEntry::new(tx);
        let fee_key = self.fee_index_key(entry.fee_per_byte);

        // Insert into all indices
        if let Some(ref ki) = entry.tx.key_image {
            self.key_images.insert(ki.clone(), hash.clone());
        }
        self.by_address
            .entry(from)
            .or_default()
            .insert(hash.clone());
        // Use unique key: fee_key XOR hash-based discriminator to avoid collision
        let idx_key = fee_key ^ (crc32_hash(&hash) as u64);
        self.fee_index.insert(idx_key, hash.clone());
        entry.last_validated_at = Utc::now().timestamp();
        self.entries.insert(hash.clone(), entry);
        self.stats_dirty = true;

        tracing::debug!(hash = %hash, "Added to mempool");
        Ok(hash)
    }

    /// Add a transaction in Dandelion++ stem phase.
    /// These are not yet eligible for block inclusion but are tracked.
    pub fn add_stem(&mut self, tx: Transaction) -> Result<String, MempoolError> {
        validate_tx(&tx).map_err(MempoolError::InvalidTx)?;
        let hash = tx.hash.clone();
        if self.entries.contains_key(&hash) {
            return Ok(hash); // already have it
        }
        let mut entry = MempoolEntry::new(tx);
        entry.in_stem_phase = true;
        entry.dandelion_stem_hops = 0;
        self.entries.insert(hash.clone(), entry);
        self.stats_dirty = true;
        Ok(hash)
    }

    /// Promote a Dandelion++ stem-phase transaction to full broadcast phase
    pub fn promote_from_stem(&mut self, hash: &str) -> bool {
        if let Some(entry) = self.entries.get_mut(hash) {
            if entry.in_stem_phase {
                entry.in_stem_phase = false;
                self.stats_dirty = true;
                return true;
            }
        }
        false
    }

    // ── RBF (Replace-By-Fee) ──────────────────────────────────────────────────

    /// Check if an incoming transaction can RBF-replace an existing one.
    /// Returns the hash to remove if replacement is valid, or None.
    fn check_rbf_replacement(&self, new_tx: &Transaction) -> Result<Option<String>, MempoolError> {
        if !new_tx.signals_rbf() {
            return Ok(None);
        }
        // Find existing pending tx from the same address with the same nonce
        if let Some(addr_txs) = self.by_address.get(&new_tx.from_address) {
            for existing_hash in addr_txs {
                if let Some(existing) = self.entries.get(existing_hash) {
                    if existing.tx.nonce == new_tx.nonce {
                        // Must increase fee by at least RBF_FEE_INCREMENT
                        let min_new_fee = existing.tx.fee * (1.0 + RBF_FEE_INCREMENT);
                        if new_tx.fee < min_new_fee {
                            return Err(MempoolError::RbfFeeTooLow {
                                current_fee: existing.tx.fee,
                                required_fee: min_new_fee,
                                provided_fee: new_tx.fee,
                            });
                        }
                        return Ok(Some(existing_hash.clone()));
                    }
                }
            }
        }
        Ok(None)
    }

    // ── Removal ───────────────────────────────────────────────────────────────

    /// Remove a transaction from the mempool (eviction, confirmation, or RBF)
    pub fn remove(&mut self, hash: &str) -> Option<Transaction> {
        if let Some(entry) = self.entries.remove(hash) {
            // Remove from all indices
            if let Some(ref ki) = entry.tx.key_image {
                self.key_images.remove(ki.as_str());
            }
            if let Some(addr_set) = self.by_address.get_mut(&entry.tx.from_address) {
                addr_set.remove(hash);
                if addr_set.is_empty() {
                    self.by_address.remove(&entry.tx.from_address);
                }
            }
            let fee_key = self.fee_index_key(entry.fee_per_byte);
            let idx_key = fee_key ^ (crc32_hash(hash) as u64);
            self.fee_index.remove(&idx_key);
            self.stats_dirty = true;
            Some(entry.tx)
        } else {
            None
        }
    }

    /// Remove all transactions confirmed in a block
    pub fn remove_confirmed(&mut self, tx_hashes: &[String]) {
        for hash in tx_hashes {
            self.remove(hash);
        }
    }

    /// Evict the transaction with the lowest effective fee-per-byte.
    /// Returns the hash of the evicted tx, or None if the pool is empty.
    /// Returns Err if the incoming tx has a lower fee than the current minimum.
    fn evict_lowest_priority_for(&mut self, incoming_fpb: f64) -> Result<Option<String>, MempoolError> {
        if let Some((&key, hash)) = self.fee_index.iter().next() {
            let hash = hash.clone();
            let existing_fpb = self.entries.get(&hash)
                .map(|e| e.fee_per_byte)
                .unwrap_or(0.0);
            if incoming_fpb <= existing_fpb {
                return Err(MempoolError::PoolFull {
                    size: self.entries.len(),
                    max: self.max_size,
                    min_fee_per_byte: existing_fpb,
                });
            }
            self.remove(&hash.clone());
            return Ok(Some(hash));
        }
        Ok(None)
    }

    // ── Expiry eviction ───────────────────────────────────────────────────────

    /// Remove all transactions older than MAX_TX_AGE_SECS.
    /// Returns the number of transactions evicted.
    pub fn evict_expired(&mut self) -> usize {
        let expired: Vec<String> = self.entries
            .iter()
            .filter(|(_, e)| e.is_expired())
            .map(|(h, _)| h.clone())
            .collect();
        let count = expired.len();
        for hash in expired {
            self.remove(&hash);
            tracing::debug!(hash = %hash, "Mempool: expired transaction evicted");
        }
        if count > 0 {
            tracing::info!(count, "Mempool: expired transaction eviction complete");
        }
        count
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Look up a transaction by hash
    pub fn get_by_hash(&self, hash: &str) -> Option<&Transaction> {
        self.entries.get(hash).map(|e| &e.tx)
    }

    /// Look up a mempool entry by hash
    pub fn get_entry(&self, hash: &str) -> Option<&MempoolEntry> {
        self.entries.get(hash)
    }

    /// Get all pending transactions for an address (sorted by fee descending)
    pub fn get_by_address(&self, address: &str) -> Vec<&Transaction> {
        let hashes = match self.by_address.get(address) {
            Some(s) => s,
            None    => return vec![],
        };
        let mut txs: Vec<&Transaction> = hashes
            .iter()
            .filter_map(|h| self.entries.get(h).map(|e| &e.tx))
            .collect();
        txs.sort_by(|a, b| b.fee.partial_cmp(&a.fee).unwrap_or(std::cmp::Ordering::Equal));
        txs
    }

    /// Current mempool size
    pub fn size(&self) -> usize {
        self.entries.len()
    }

    /// Number of broadcast-ready transactions (excluding stem-phase)
    pub fn broadcast_size(&self) -> usize {
        self.entries.values().filter(|e| !e.in_stem_phase).count()
    }

    /// Congestion factor [0.0, 1.0]: ratio of current size to max capacity
    pub fn congestion(&self) -> f64 {
        (self.entries.len() as f64 / self.max_size as f64).min(1.0)
    }

    // ── Block selection ───────────────────────────────────────────────────────

    /// Select up to `limit` highest-priority transactions for block inclusion.
    ///
    /// Selection criteria:
    ///   1. Exclude stem-phase transactions
    ///   2. Sort by effective fee-per-byte (CPFP ancestor fee included)
    ///   3. Check parent transactions are included before children
    ///   4. Respect block byte limit (MAX_BLOCK_SIZE_BYTES)
    pub fn select_for_block(&self, limit: usize) -> Vec<&Transaction> {
        let max_block_bytes: u32 = 2_097_152; // 2 MB
        let mut selected: Vec<&MempoolEntry> = self.entries
            .values()
            .filter(|e| !e.in_stem_phase && !e.is_expired())
            .collect();

        // Sort by effective fee-per-byte descending
        selected.sort_by(|a, b| {
            b.effective_fee_per_byte()
                .partial_cmp(&a.effective_fee_per_byte())
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut result = Vec::with_capacity(limit);
        let mut total_bytes: u32 = 0;
        let mut included_hashes: HashSet<&str> = HashSet::new();

        for entry in selected.iter().take(limit * 2) { // overshoot to handle dependency ordering
            if result.len() >= limit {
                break;
            }
            // Check all parents are already included
            let parents_ok = entry.parent_hashes.iter()
                .all(|p| included_hashes.contains(p.as_str()) || !self.entries.contains_key(p));
            if !parents_ok { continue; }

            let tx_size = entry.tx.size_bytes.max(250);
            if total_bytes + tx_size > max_block_bytes { continue; }

            total_bytes += tx_size;
            included_hashes.insert(&entry.tx.hash);
            result.push(&entry.tx);
        }

        result
    }

    /// Get the top N transactions by fee (for RPC /mempool endpoint)
    pub fn top_by_fee(&self, limit: usize) -> Vec<&Transaction> {
        let mut entries: Vec<&MempoolEntry> = self.entries.values().collect();
        entries.sort_by(|a, b| b.fee_per_byte.partial_cmp(&a.fee_per_byte).unwrap_or(std::cmp::Ordering::Equal));
        entries.into_iter().take(limit).map(|e| &e.tx).collect()
    }

    // ── Fee estimation ────────────────────────────────────────────────────────

    /// Estimate the fee per byte required to be confirmed in the next N blocks.
    /// Returns (slow, normal, fast) fee rates.
    pub fn fee_estimates(&self) -> FeeEstimates {
        let fpb_vals: Vec<f64> = self.entries.values()
            .filter(|e| !e.in_stem_phase)
            .map(|e| e.fee_per_byte)
            .collect();

        if fpb_vals.is_empty() {
            return FeeEstimates {
                slow:   crate::MIN_BASE_FEE,
                normal: crate::MIN_BASE_FEE * 2.0,
                fast:   crate::MIN_BASE_FEE * 5.0,
                congestion: 0.0,
            };
        }

        let mut sorted = fpb_vals.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let p25 = sorted[sorted.len() / 4];
        let p50 = sorted[sorted.len() / 2];
        let p75 = sorted[sorted.len() * 3 / 4];

        FeeEstimates {
            slow:       p25.max(crate::MIN_BASE_FEE),
            normal:     p50.max(crate::MIN_BASE_FEE * 2.0),
            fast:       p75.max(crate::MIN_BASE_FEE * 5.0),
            congestion: self.congestion(),
        }
    }

    // ── Statistics ────────────────────────────────────────────────────────────

    /// Compute and return current mempool statistics
    pub fn stats(&mut self) -> anyhow::Result<&MempoolStats> {
        if !self.stats_dirty && self.cached_stats.is_some() {
            return self.cached_stats.as_ref()
                .ok_or_else(|| anyhow::anyhow!("Mempool cached_stats inconsistent: is_some=true but as_ref returned None"));
        }

        let mut fpb_vals: Vec<f64> = vec![];
        let mut total_fees = 0.0f64;
        let mut transparent = 0usize;
        let mut ringct = 0usize;
        let mut stealth = 0usize;
        let mut full_p = 0usize;
        let mut rbf = 0usize;
        let mut stem = 0usize;
        let mut expired = 0usize;

        for entry in self.entries.values() {
            fpb_vals.push(entry.fee_per_byte);
            total_fees += entry.tx.fee;
            match entry.tx.privacy_level {
                PrivacyLevel::Transparent => transparent += 1,
                PrivacyLevel::RingCt      => ringct  += 1,
                PrivacyLevel::Stealth     => stealth += 1,
                PrivacyLevel::Full        => full_p  += 1,
            }
            if entry.tx.signals_rbf()  { rbf  += 1; }
            if entry.in_stem_phase     { stem += 1; }
            if entry.is_expired()      { expired += 1; }
        }

        fpb_vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let min_fpb    = fpb_vals.first().copied().unwrap_or(0.0);
        let median_fpb = fpb_vals.get(fpb_vals.len() / 2).copied().unwrap_or(0.0);
        let max_fpb    = fpb_vals.last().copied().unwrap_or(0.0);
        let size       = self.entries.len();
        let congestion = size as f64 / self.max_size as f64;

        // Fee histogram: split range into FEE_HISTOGRAM_BUCKETS equal buckets
        let histogram = if fpb_vals.is_empty() {
            vec![]
        } else {
            let bucket_size = (max_fpb - min_fpb) / FEE_HISTOGRAM_BUCKETS as f64;
            (0..FEE_HISTOGRAM_BUCKETS).map(|i| {
                let lo = min_fpb + i as f64 * bucket_size;
                let hi = lo + bucket_size;
                let count = fpb_vals.iter().filter(|&&f| f >= lo && f < hi).count();
                (lo, count)
            }).collect()
        };

        self.cached_stats = Some(MempoolStats {
            size,
            congestion_factor:       congestion.min(1.0),
            total_pending_fees:      total_fees,
            min_fee_per_byte:        min_fpb,
            median_fee_per_byte:     median_fpb,
            max_fee_per_byte:        max_fpb,
            next_block_fee_estimate: median_fpb * 1.1,
            transparent_count:       transparent,
            ringct_count:            ringct,
            stealth_count:           stealth,
            full_privacy_count:      full_p,
            rbf_count:               rbf,
            stem_count:              stem,
            expired_count:           expired,
            fee_histogram:           histogram,
        });
        self.stats_dirty = false;
        self.cached_stats.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Mempool cached_stats not set after stats computation"))
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    /// Current mempool size (alias for `size()`)
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Evict transactions older than the given deadline (UNIX timestamp).
    /// Returns the hashes of evicted transactions.
    pub fn evict_expired_before(&mut self, deadline_unix: i64) -> Vec<String> {
        let expired: Vec<String> = self.entries
            .iter()
            .filter(|(_, e)| e.added_at < deadline_unix)
            .map(|(h, _)| h.clone())
            .collect();
        for hash in &expired {
            self.remove(hash);
        }
        if !expired.is_empty() {
            tracing::debug!(count = expired.len(), "Mempool: evicted {} expired txs", expired.len());
        }
        expired
    }

    /// Evict the `count` lowest-fee transactions from the mempool.
    /// Returns the hashes of evicted transactions.
    pub fn evict_lowest_fee(&mut self, count: usize) -> Vec<String> {
        let mut evicted = Vec::with_capacity(count);
        // Collect lowest-fee entries from fee_index
        let lowest: Vec<String> = self.fee_index
            .iter()
            .take(count)
            .map(|(_, hash)| hash.clone())
            .collect();
        for hash in &lowest {
            self.remove(hash);
            evicted.push(hash.clone());
        }
        evicted
    }

    /// Return all pending transactions in the mempool (for persistence)
    pub fn all_pending(&self) -> Vec<&Transaction> {
        self.entries.values().map(|e| &e.tx).collect()
    }

    /// Convert fee-per-byte float to a u64 key for BTreeMap ordering
    fn fee_index_key(&self, fpb: f64) -> u64 {
        (fpb * 1e12) as u64
    }
}

impl Default for Mempool {
    fn default() -> Self { Self::new() }
}

// ─────────────────────────────────────────────────────────────────────────────
// FeeEstimates
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FeeEstimates {
    pub slow:       f64,
    pub normal:     f64,
    pub fast:       f64,
    pub congestion: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// MempoolError
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub enum MempoolError {
    InvalidTx(TxValidationError),
    Duplicate             { hash: String },
    PoolFull              { size: usize, max: usize, min_fee_per_byte: f64 },
    KeyImageDoubleSpend   { key_image: String, existing_hash: String },
    AddressLimitExceeded  { address: String, limit: usize },
    RbfFeeTooLow          { current_fee: f64, required_fee: f64, provided_fee: f64 },
    PackageTooLarge       { size: usize, max: usize },
}

impl std::fmt::Display for MempoolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidTx(e) =>
                write!(f, "Invalid transaction: {}", e),
            Self::Duplicate { hash } =>
                write!(f, "Duplicate transaction: {}", &hash[..12.min(hash.len())]),
            Self::PoolFull { size, max, min_fee_per_byte } =>
                write!(f, "Mempool full ({}/{} txs); min fee-per-byte {:.8}", size, max, min_fee_per_byte),
            Self::KeyImageDoubleSpend { key_image, existing_hash } =>
                write!(f, "Double-spend: key image {}… already used in {}…",
                    &key_image[..12.min(key_image.len())],
                    &existing_hash[..12.min(existing_hash.len())]),
            Self::AddressLimitExceeded { address, limit } =>
                write!(f, "Address {} already has {} txs in mempool (limit {})",
                    &address[..16.min(address.len())], limit, limit),
            Self::RbfFeeTooLow { current_fee, required_fee, provided_fee } =>
                write!(f, "RBF: provided fee {:.6} < required {:.6} (current {:.6})",
                    provided_fee, required_fee, current_fee),
            Self::PackageTooLarge { size, max } =>
                write!(f, "Package too large: {} txs (max {})", size, max),
        }
    }
}

impl std::error::Error for MempoolError {}

// ─────────────────────────────────────────────────────────────────────────────
// CRC32 utility (deterministic hash for fee index key disambiguation)
// ─────────────────────────────────────────────────────────────────────────────

fn crc32_hash(s: &str) -> u32 {
    let mut h: u32 = 0xFFFFFFFF;
    for &b in s.as_bytes() {
        h ^= b as u32;
        for _ in 0..8 {
            if h & 1 != 0 { h = (h >> 1) ^ 0xEDB88320; }
            else           { h >>= 1; }
        }
    }
    h ^ 0xFFFFFFFF
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Transaction, PrivacyLevel};

    fn make_tx(from: &str, to: &str, fee: f64) -> Transaction {
        Transaction::new(from, to, 1.0, fee, PrivacyLevel::Transparent)
    }

    #[test]
    fn test_add_and_get() -> anyhow::Result<()> {
        let mut pool = Mempool::new();
        let tx = make_tx("ADDR_A", "ADDR_B", 0.001);
        let hash = tx.hash.clone();
        pool.add(tx)?;
        assert!(pool.get_by_hash(&hash).is_some());
        assert_eq!(pool.size(), 1);
        Ok(())
    }

    #[test]
    fn test_reject_duplicate() -> anyhow::Result<()> {
        let mut pool = Mempool::new();
        let tx = make_tx("ADDR_A", "ADDR_B", 0.001);
        pool.add(tx.clone())?;
        let result = pool.add(tx);
        assert!(matches!(result, Err(MempoolError::Duplicate { .. })));
        Ok(())
    }

    #[test]
    fn test_remove() -> anyhow::Result<()> {
        let mut pool = Mempool::new();
        let tx = make_tx("ADDR_A", "ADDR_B", 0.001);
        let hash = tx.hash.clone();
        pool.add(tx)?;
        pool.remove(&hash);
        assert!(pool.get_by_hash(&hash).is_none());
        assert_eq!(pool.size(), 0);
        Ok(())
    }

    #[test]
    fn test_select_for_block_order() -> anyhow::Result<()> {
        let mut pool = Mempool::new();
        let tx_low  = make_tx("ADDR_A", "ADDR_B", 0.001);
        let tx_high = make_tx("ADDR_C", "ADDR_D", 0.01);
        pool.add(tx_low)?;
        pool.add(tx_high.clone())?;
        let selected = pool.select_for_block(2);
        assert_eq!(selected.len(), 2);
        // Highest fee should come first
        assert_eq!(selected[0].hash, tx_high.hash);
        Ok(())
    }

    #[test]
    fn test_address_limit() -> anyhow::Result<()> {
        let mut pool = Mempool::with_max_size(Mempool::new(), MAX_TX_PER_ADDRESS + 5);
        for i in 0..(MAX_TX_PER_ADDRESS) {
            let tx = Transaction::new(
                "SAME_ADDR", &format!("ADDR_{}", i), 0.001 + i as f64 * 0.0001,
                0.001 + i as f64 * 0.0001, PrivacyLevel::Transparent,
            );
            pool.add(tx)?;
        }
        // One more should fail
        let overflow = Transaction::new("SAME_ADDR", "ADDR_999", 0.999, 0.999, PrivacyLevel::Transparent);
        let result = pool.add(overflow);
        assert!(matches!(result, Err(MempoolError::AddressLimitExceeded { .. })));
        Ok(())
    }

    #[test]
    fn test_fee_estimates_empty_pool() {
        let pool = Mempool::new();
        let est = pool.fee_estimates();
        assert!(est.slow > 0.0);
        assert!(est.fast >= est.normal);
        assert!(est.normal >= est.slow);
    }

    #[test]
    fn test_key_image_double_spend() -> anyhow::Result<()> {
        let mut pool = Mempool::new();
        let mut tx1 = make_tx("ADDR_A", "ADDR_B", 0.005);
        tx1.key_image = Some("ki:deadbeef".repeat(2));
        let mut tx2 = make_tx("ADDR_C", "ADDR_D", 0.005);
        tx2.key_image = Some("ki:deadbeef".repeat(2));
        pool.add(tx1)?;
        let result = pool.add(tx2);
        assert!(matches!(result, Err(MempoolError::KeyImageDoubleSpend { .. })));
        Ok(())
    }

    #[test]
    fn test_congestion_factor() {
        let pool = Mempool::new();
        assert_eq!(pool.congestion(), 0.0);
    }

    #[test]
    fn test_stem_phase() -> anyhow::Result<()> {
        let mut pool = Mempool::new();
        let tx = make_tx("ADDR_A", "ADDR_B", 0.001);
        let hash = tx.hash.clone();
        pool.add_stem(tx)?;
        // Stem-phase tx should not be selected for block
        let selected = pool.select_for_block(10);
        assert!(selected.is_empty(), "Stem-phase tx must not be selected for block");
        // After promotion, it should be eligible
        pool.promote_from_stem(&hash);
        let selected = pool.select_for_block(10);
        assert_eq!(selected.len(), 1);
        Ok(())
    }

    #[test]
    fn test_evict_expired() -> anyhow::Result<()> {
        let mut pool = Mempool::new();
        let tx = make_tx("ADDR_A", "ADDR_B", 0.001);
        pool.add(tx)?;
        // Manually expire by adjusting the added_at (via entry mutation)
        let hash = pool.entries.keys().next()
            .ok_or_else(|| anyhow::anyhow!("Mempool entries empty in evict_expired test"))?
            .clone();
        if let Some(entry) = pool.entries.get_mut(&hash) {
            entry.added_at = Utc::now().timestamp() - MAX_TX_AGE_SECS - 1;
        }
        let count = pool.evict_expired();
        assert_eq!(count, 1);
        assert_eq!(pool.size(), 0);
        Ok(())
    }

    #[test]
    fn test_top_by_fee() -> anyhow::Result<()> {
        let mut pool = Mempool::new();
        for i in 1..=5 {
            let tx = Transaction::new(
                &format!("FROM_{}", i), &format!("TO_{}", i),
                1.0, i as f64 * 0.001, PrivacyLevel::Transparent,
            );
            pool.add(tx)?;
        }
        let top3 = pool.top_by_fee(3);
        assert_eq!(top3.len(), 3);
        assert!(top3[0].fee >= top3[1].fee);
        assert!(top3[1].fee >= top3[2].fee);
        Ok(())
    }
}
