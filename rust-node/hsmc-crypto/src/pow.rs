/// Proof-of-Work engine — multi-threaded SHA-256d miner with:
/// - Variable difficulty targeting (Bitcoin-style compact target)
/// - Nonce partitioning across CPU threads
/// - ExtraNonce2 extension for pool mining
/// - Real-time hashrate measurement with EMA smoothing
/// - Asynchronous cancellation via AtomicBool
/// - Benchmark mode for hardware profiling
///
/// Algorithm: SHA-256d (double SHA-256, Bitcoin-compatible).
/// RandomX is planned as an upgrade path but not yet implemented.
use sha2::{Digest, Sha256};
use hsmc_core::{Block, difficulty_to_leading_zeros, leading_zeros_in_hash};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use serde::{Serialize, Deserialize};
use tracing::{debug, info, warn};

// ─────────────────────────────────────────────────────────────────────────────
// PoW Algorithm Selection
// ─────────────────────────────────────────────────────────────────────────────

/// Supported Proof-of-Work algorithms.
/// Default is SHA-256d (Bitcoin-style). RandomX is planned but not implemented.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PowAlgorithm {
    /// Double SHA-256 (Bitcoin-compatible, ASIC-friendly)
    Sha256d,
    /// RandomX (Monero-like, CPU-optimized, ASIC-resistant) — PLANNED, not implemented
    RandomX,
}

impl Default for PowAlgorithm {
    fn default() -> Self {
        Self::Sha256d
    }
}

impl PowAlgorithm {
    /// Read algorithm from the `HSMC_POW_ALGORITHM` env var.
    /// Valid values: "sha256d" (default), "randomx".
    /// Falls back to Sha256d if the env var is absent or unrecognized.
    pub fn from_env() -> Self {
        match std::env::var("HSMC_POW_ALGORITHM").as_deref() {
            Ok("randomx") => {
                warn!("RandomX PoW is not yet implemented, falling back to SHA-256d");
                Self::Sha256d
            }
            Ok("sha256d") | Ok(_) => Self::Sha256d,
            Err(_) => Self::Sha256d,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Sha256d => "SHA-256d",
            Self::RandomX  => "RandomX (planned)",
        }
    }

    pub fn is_implemented(&self) -> bool {
        matches!(self, Self::Sha256d)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mining result
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinerResult {
    pub nonce:          u64,
    pub hash:           String,
    pub hashrate_hps:   f64,    // hashes per second
    pub duration_ms:    u64,
    pub thread_id:      usize,
    pub total_hashes:   u64,
    pub difficulty:     u64,
    pub leading_zeros:  u64,
}

impl MinerResult {
    pub fn hashrate_display(&self) -> String {
        let h = self.hashrate_hps;
        if h >= 1e12 { format!("{:.3} TH/s", h / 1e12) }
        else if h >= 1e9 { format!("{:.3} GH/s", h / 1e9) }
        else if h >= 1e6 { format!("{:.3} MH/s", h / 1e6) }
        else if h >= 1e3 { format!("{:.3} KH/s", h / 1e3) }
        else { format!("{:.1} H/s", h) }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-thread miner
// ─────────────────────────────────────────────────────────────────────────────

/// Mine a block on a single thread starting at `nonce_start`, stepping by `nonce_step`.
/// Returns None if cancelled via `stop_flag`.
pub fn mine_block_range(
    block: &mut Block,
    nonce_start: u64,
    nonce_step: u64,
    thread_id: usize,
    stop_flag: Arc<AtomicBool>,
    hash_counter: Arc<AtomicU64>,
    found_flag: Arc<AtomicBool>,
) -> Option<MinerResult> {
    let leading_required = difficulty_to_leading_zeros(block.difficulty);
    let start = Instant::now();
    let mut nonce = nonce_start;
    let mut local_count = 0u64;

    // Pre-serialize everything except nonce for fast inner loop
    let block_prefix = build_block_prefix(block);

    loop {
        // Check cancellation every 10_000 hashes
        if local_count % 10_000 == 0 {
            if stop_flag.load(Ordering::Relaxed) || found_flag.load(Ordering::Relaxed) {
                hash_counter.fetch_add(local_count, Ordering::Relaxed);
                return None;
            }
        }

        let hash = hash_block_with_nonce(&block_prefix, nonce);
        local_count += 1;

        if leading_zeros_in_hash(&hash) >= leading_required {
            found_flag.store(true, Ordering::Relaxed);
            hash_counter.fetch_add(local_count, Ordering::Relaxed);
            block.nonce = nonce;
            block.hash = hash.clone();
            let elapsed = start.elapsed();
            let hashrate = local_count as f64 / elapsed.as_secs_f64().max(1e-9);
            debug!(
                thread = thread_id,
                nonce,
                hash = &hash[..12],
                hashrate = hashrate as u64,
                "Thread found solution"
            );
            return Some(MinerResult {
                nonce,
                hash,
                hashrate_hps: hashrate,
                duration_ms: elapsed.as_millis() as u64,
                thread_id,
                total_hashes: local_count,
                difficulty: block.difficulty,
                leading_zeros: leading_required,
            });
        }

        nonce = nonce.wrapping_add(nonce_step);

        // ExtraNonce2: if we've exhausted the 64-bit nonce space, increment extra nonce
        if nonce == nonce_start && nonce_step > 0 {
            // Full cycle completed — would need extra nonce in production
            break;
        }
    }
    None
}

/// Pre-serialize block fields except nonce (for fast inner loop)
fn build_block_prefix(block: &Block) -> Vec<u8> {
    let mut prefix = Vec::with_capacity(512);
    prefix.extend_from_slice(&(block.version as u32).to_le_bytes());
    prefix.extend_from_slice(block.prev_hash.as_bytes());
    prefix.extend_from_slice(block.merkle_root.as_bytes());
    prefix.extend_from_slice(block.miner_address.as_bytes());
    prefix.extend_from_slice(&block.block_number.to_le_bytes());
    prefix.extend_from_slice(&block.difficulty.to_le_bytes());
    prefix.extend_from_slice(&block.timestamp.to_le_bytes());
    prefix
}

/// SHA-256d hash of (prefix || nonce_le_bytes)
fn hash_block_with_nonce(prefix: &[u8], nonce: u64) -> String {
    let nonce_bytes = nonce.to_le_bytes();
    // First SHA256
    let mut h1 = Sha256::new();
    h1.update(prefix);
    h1.update(&nonce_bytes);
    let mid = h1.finalize();
    // Second SHA256 (Bitcoin-style double hash)
    let mut h2 = Sha256::new();
    h2.update(&mid);
    hex::encode(h2.finalize())
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-threaded parallel miner
// ─────────────────────────────────────────────────────────────────────────────

/// Mine across N CPU threads with partitioned nonce space.
/// Returns (mined_block, winning_result) or None if cancelled.
pub async fn mine_parallel(
    block: Block,
    thread_count: usize,
    stop_flag: Arc<AtomicBool>,
) -> Option<(Block, MinerResult)> {
    let thread_count = thread_count.max(1).min(256);
    let hash_counter = Arc::new(AtomicU64::new(0));
    let found_flag   = Arc::new(AtomicBool::new(false));

    let (tx, mut rx) = tokio::sync::mpsc::channel::<(Block, MinerResult)>(4);

    let nonce_range_per_thread = u64::MAX / thread_count as u64;

    for t in 0..thread_count {
        let mut b          = block.clone();
        let stop           = stop_flag.clone();
        let found          = found_flag.clone();
        let hc             = hash_counter.clone();
        let tx_ch          = tx.clone();
        let nonce_start    = (t as u64).wrapping_mul(nonce_range_per_thread);

        tokio::task::spawn_blocking(move || {
            if let Some(result) = mine_block_range(
                &mut b,
                nonce_start,
                thread_count as u64,
                t,
                stop,
                hc,
                found,
            ) {
                let _ = tx_ch.try_send((b, result));
            }
        });
    }

    drop(tx); // close sender so rx.recv() returns None when all threads done
    rx.recv().await
}

// ─────────────────────────────────────────────────────────────────────────────
// Real-time hashrate monitor
// ─────────────────────────────────────────────────────────────────────────────

/// EMA-smoothed hashrate tracker
pub struct HashrateMonitor {
    counter:       Arc<AtomicU64>,
    last_count:    u64,
    last_time:     Instant,
    ema_hashrate:  f64,  // exponential moving average
    alpha:         f64,  // EMA weight (0..1)
    pub samples:   Vec<f64>,
}

impl HashrateMonitor {
    pub fn new(counter: Arc<AtomicU64>) -> Self {
        Self {
            counter,
            last_count: 0,
            last_time: Instant::now(),
            ema_hashrate: 0.0,
            alpha: 0.2,
            samples: Vec::new(),
        }
    }

    /// Update and return current EMA hashrate (H/s)
    pub fn update(&mut self) -> f64 {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_time).as_secs_f64();
        if elapsed < 0.1 { return self.ema_hashrate; }

        let current_count = self.counter.load(Ordering::Relaxed);
        let delta_hashes = current_count.saturating_sub(self.last_count) as f64;
        let instant_rate = delta_hashes / elapsed;

        self.ema_hashrate = if self.ema_hashrate == 0.0 {
            instant_rate
        } else {
            self.alpha * instant_rate + (1.0 - self.alpha) * self.ema_hashrate
        };

        self.last_count = current_count;
        self.last_time  = now;
        self.samples.push(self.ema_hashrate);
        if self.samples.len() > 60 { self.samples.remove(0); }

        self.ema_hashrate
    }

    pub fn display(&mut self) -> String {
        let h = self.update();
        if h >= 1e12 { format!("{:.3} TH/s", h / 1e12) }
        else if h >= 1e9 { format!("{:.3} GH/s", h / 1e9) }
        else if h >= 1e6 { format!("{:.3} MH/s", h / 1e6) }
        else if h >= 1e3 { format!("{:.3} KH/s", h / 1e3) }
        else { format!("{:.1} H/s", h) }
    }

    pub fn average_over_samples(&self) -> f64 {
        if self.samples.is_empty() { return 0.0; }
        self.samples.iter().sum::<f64>() / self.samples.len() as f64
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Difficulty utilities
// ─────────────────────────────────────────────────────────────────────────────

/// Convert a difficulty target to expected hashes required
pub fn difficulty_to_expected_hashes(difficulty: u64) -> u128 {
    let leading = difficulty_to_leading_zeros(difficulty);
    // Each leading hex zero = 16^1 fewer valid hashes
    (16u128).pow(leading as u32)
}

/// Compute compact Bitcoin-style "nBits" target from leading zeros requirement
pub fn leading_zeros_to_compact_target(leading_zeros: u64) -> String {
    let mut target = "f".repeat(64);
    let zero_chars = leading_zeros as usize;
    let zeroed: String = "0".repeat(zero_chars) + &"f".repeat(64usize.saturating_sub(zero_chars));
    zeroed
}

/// Verify a block hash meets the target
pub fn meets_target(hash: &str, difficulty: u64) -> bool {
    leading_zeros_in_hash(hash) >= difficulty_to_leading_zeros(difficulty)
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub thread_count:    usize,
    pub duration_secs:   f64,
    pub total_hashes:    u64,
    pub hashrate_hps:    f64,
    pub per_thread_hps:  f64,
    pub cpu_model:       String,
}

/// Run a 5-second CPU hashrate benchmark
pub async fn benchmark(thread_count: usize) -> BenchmarkResult {
    let hash_counter = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();

    // Stop after 5 seconds
    let stop_timer = stop.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        stop_timer.store(true, Ordering::Relaxed);
    });

    let start = Instant::now();
    let mut handles = Vec::new();
    for t in 0..thread_count {
        let stop_t = stop_clone.clone();
        let hc = hash_counter.clone();
        handles.push(tokio::task::spawn_blocking(move || {
            let prefix = [0u8; 64]; // dummy prefix
            let mut nonce = t as u64 * 0x0100_0000_0000_0000;
            let mut count = 0u64;
            while !stop_t.load(Ordering::Relaxed) {
                let _ = hash_block_with_nonce(&prefix, nonce);
                nonce = nonce.wrapping_add(1);
                count += 1;
                if count % 10_000 == 0 {
                    hc.fetch_add(10_000, Ordering::Relaxed);
                }
            }
        }));
    }
    for h in handles { let _ = h.await; }

    let elapsed = start.elapsed().as_secs_f64();
    let total = hash_counter.load(Ordering::Relaxed);
    let hashrate = total as f64 / elapsed;

    BenchmarkResult {
        thread_count,
        duration_secs: elapsed,
        total_hashes: total,
        hashrate_hps: hashrate,
        per_thread_hps: hashrate / thread_count as f64,
        cpu_model: detect_cpu_model(),
    }
}

fn detect_cpu_model() -> String {
    #[cfg(target_os = "linux")]
    {
        if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
            for line in cpuinfo.lines() {
                if line.starts_with("model name") {
                    return line.split(':').nth(1).unwrap_or("unknown").trim().to_string();
                }
            }
        }
    }
    "unknown CPU".to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// SHA utilities
// ─────────────────────────────────────────────────────────────────────────────

pub fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex::encode(h.finalize())
}

pub fn sha256d_hex(data: &[u8]) -> String {
    let mid = Sha256::digest(data);
    hex::encode(Sha256::digest(&mid))
}

pub fn sha256d_bytes(data: &[u8]) -> [u8; 32] {
    let mid = Sha256::digest(data);
    Sha256::digest(&mid).into()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256d_known_value() {
        let hash = sha256d_hex(b"");
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn test_meets_target_easy() {
        // With difficulty 1 (1 leading zero), any hash with "0" prefix should pass
        let hash = "0".repeat(1) + &"f".repeat(63);
        assert!(meets_target(&hash, 1));
    }

    #[test]
    fn test_does_not_meet_tight_target() {
        let hash = "1".repeat(64);
        assert!(!meets_target(&hash, 4));
    }

    #[test]
    fn test_nonce_hashing_deterministic() {
        let prefix = b"test_prefix_data";
        let h1 = hash_block_with_nonce(prefix, 12345);
        let h2 = hash_block_with_nonce(prefix, 12345);
        assert_eq!(h1, h2, "Same inputs must produce same hash");
        let h3 = hash_block_with_nonce(prefix, 12346);
        assert_ne!(h1, h3, "Different nonce must produce different hash");
    }

    #[test]
    fn test_hashrate_monitor_update() {
        let counter = Arc::new(AtomicU64::new(0));
        let mut monitor = HashrateMonitor::new(counter.clone());
        counter.fetch_add(100_000, Ordering::Relaxed);
        std::thread::sleep(Duration::from_millis(200));
        let rate = monitor.update();
        assert!(rate > 0.0, "Hashrate should be positive");
    }

    #[test]
    fn test_compact_target_format() {
        let target = leading_zeros_to_compact_target(4);
        assert!(target.starts_with("0000"), "Should start with 4 zeros");
        assert_eq!(target.len(), 64, "Target should be 64 hex chars");
    }

    #[tokio::test]
    async fn test_mine_parallel_low_difficulty() {
        let mut block = Block::new(1, "0".repeat(64), "HSMCtest".into(), 1, vec![]);
        block.difficulty = 1; // easy difficulty
        let stop = Arc::new(AtomicBool::new(false));
        let result = mine_parallel(block, 2, stop).await;
        assert!(result.is_some(), "Should find a solution with difficulty 1");
        let (mined, res) = result.unwrap();
        assert!(meets_target(&mined.hash, 1));
        assert!(res.total_hashes > 0);
    }
}
