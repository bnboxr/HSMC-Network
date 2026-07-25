/// Advanced fee market implementation
/// EIP-1559-style base fee + priority fee, with privacy surcharges for RingCT txs
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

// ─── Constants ────────────────────────────────────────────────────────────────

/// Minimum fee in satoshis per virtual byte
pub const MIN_FEE_RATE_SAT_VB: u64 = 1_000;
/// Default target bytes per block (used for base fee adjustment)
pub const TARGET_BLOCK_BYTES: u64 = 2_000_000; // 2 MB
/// Maximum block size
pub const MAX_BLOCK_BYTES: u64 = 4_000_000; // 4 MB
/// Base fee change denominator (max 12.5% change per block)
pub const BASE_FEE_MAX_CHANGE_DENOM: u64 = 8;
/// Ring signature surcharge multiplier (privacy costs more)
pub const RING_SURCHARGE_BPS: u64 = 5000; // 50% extra
/// Confidential tx surcharge
pub const CONFIDENTIAL_SURCHARGE_BPS: u64 = 7500; // 75% extra
/// Bulletproof surcharge (heavy computation)
pub const BULLETPROOF_SURCHARGE_BPS: u64 = 10000; // 100% extra

// ─── Fee estimator ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeEstimate {
    /// Base fee in sat/vbyte (protocol-determined)
    pub base_fee_rate: u64,
    /// Suggested priority fee in sat/vbyte for fast confirmation (< 1 block)
    pub priority_fee_fast: u64,
    /// Suggested priority fee for standard (~3 blocks)
    pub priority_fee_standard: u64,
    /// Suggested priority fee for economical (~10 blocks)
    pub priority_fee_economy: u64,
    /// Total recommended fee for a 250-vbyte standard tx (fast)
    pub recommended_fee_fast: u64,
    /// Total recommended fee for a 250-vbyte standard tx (standard)
    pub recommended_fee_standard: u64,
    /// Current mempool congestion 0.0–1.0
    pub congestion: f64,
    /// Minimum acceptable fee
    pub minimum_fee: u64,
}

#[derive(Debug, Clone)]
pub struct FeeMarket {
    /// Sliding window of recent block sizes (last 100 blocks)
    block_size_history: VecDeque<u64>,
    /// Current EIP-1559-style base fee in sat/vbyte
    pub base_fee_rate: u64,
    /// Recent mempool fee rate histogram
    pub fee_histogram: Vec<(u64, u64)>, // (fee_rate_sat_vb, tx_count)
    /// Total pending mempool bytes
    pub pending_bytes: u64,
}

impl FeeMarket {
    pub fn new() -> Self {
        Self {
            block_size_history: VecDeque::with_capacity(100),
            base_fee_rate: MIN_FEE_RATE_SAT_VB,
            fee_histogram: Vec::new(),
            pending_bytes: 0,
        }
    }

    /// Called after each block is added; adjusts base fee EIP-1559 style
    pub fn on_block_added(&mut self, block_bytes: u64) {
        if self.block_size_history.len() >= 100 {
            self.block_size_history.pop_front();
        }
        self.block_size_history.push_back(block_bytes);
        self.adjust_base_fee(block_bytes);
    }

    /// EIP-1559 base fee adjustment
    fn adjust_base_fee(&mut self, block_bytes: u64) {
        let target = TARGET_BLOCK_BYTES;
        if block_bytes == target {
            return; // No change
        }

        let current = self.base_fee_rate;
        let new_fee = if block_bytes > target {
            // Block above target → increase fee
            let delta = current * (block_bytes - target) / (target * BASE_FEE_MAX_CHANGE_DENOM);
            current + delta.max(1)
        } else {
            // Block below target → decrease fee
            let delta = current * (target - block_bytes) / (target * BASE_FEE_MAX_CHANGE_DENOM);
            current.saturating_sub(delta)
        };

        self.base_fee_rate = new_fee.max(MIN_FEE_RATE_SAT_VB);
    }

    /// Update fee histogram from mempool data
    pub fn update_histogram(&mut self, fee_rates: &[(u64, u64)]) {
        self.fee_histogram = fee_rates.to_vec();
        self.pending_bytes = fee_rates.iter().map(|(_, bytes)| bytes).sum();
    }

    /// Calculate congestion factor 0.0–1.0
    pub fn congestion_factor(&self) -> f64 {
        if self.pending_bytes == 0 { return 0.0; }
        (self.pending_bytes as f64 / (MAX_BLOCK_BYTES * 3) as f64).min(1.0)
    }

    /// Generate a comprehensive fee estimate
    pub fn estimate(&self) -> FeeEstimate {
        let base = self.base_fee_rate;
        let congestion = self.congestion_factor();

        // Priority fees based on congestion
        let priority_fast = (base as f64 * (1.0 + congestion * 2.0)) as u64;
        let priority_standard = (base as f64 * (1.0 + congestion)) as u64;
        let priority_economy = base / 2;

        let std_vbytes = 250u64; // typical tx
        FeeEstimate {
            base_fee_rate: base,
            priority_fee_fast: priority_fast,
            priority_fee_standard: priority_standard,
            priority_fee_economy: priority_economy,
            recommended_fee_fast: (base + priority_fast) * std_vbytes,
            recommended_fee_standard: (base + priority_standard) * std_vbytes,
            congestion,
            minimum_fee: MIN_FEE_RATE_SAT_VB * std_vbytes,
        }
    }

    /// Calculate fee for a specific transaction with privacy surcharges
    pub fn calculate_tx_fee(
        &self,
        vbytes: u64,
        privacy_level: TxPrivacyLevel,
        priority: FeePriority,
    ) -> u64 {
        let base_rate = self.base_fee_rate;
        let priority_rate = match priority {
            FeePriority::Fast => (base_rate as f64 * (1.0 + self.congestion_factor() * 2.0)) as u64,
            FeePriority::Standard => (base_rate as f64 * (1.0 + self.congestion_factor())) as u64,
            FeePriority::Economy => base_rate / 2,
            FeePriority::Custom(rate) => rate,
        };

        let total_rate = base_rate + priority_rate;

        // Apply privacy surcharge
        let surcharge_bps = match privacy_level {
            TxPrivacyLevel::Transparent => 0,
            TxPrivacyLevel::RingSig => RING_SURCHARGE_BPS,
            TxPrivacyLevel::Confidential => CONFIDENTIAL_SURCHARGE_BPS,
            TxPrivacyLevel::FullPrivacy => BULLETPROOF_SURCHARGE_BPS,
        };

        let base_fee = total_rate * vbytes;
        let surcharge = base_fee * surcharge_bps / 10_000;
        (base_fee + surcharge).max(MIN_FEE_RATE_SAT_VB * vbytes)
    }

    /// Average block utilization over last N blocks
    pub fn avg_utilization(&self, n: usize) -> f64 {
        let recent: Vec<_> = self.block_size_history.iter().rev().take(n).collect();
        if recent.is_empty() { return 0.0; }
        let total: u64 = recent.iter().copied().sum();
        total as f64 / (MAX_BLOCK_BYTES * recent.len() as u64) as f64
    }

    /// Get base fee in satoshis (for metrics / external consumers)
    pub fn base_fee_satoshis(&self) -> u64 {
        self.base_fee_rate
    }

    /// Adjust base fee based on gas used vs target (EIP-1559 style)
    /// Called by the fee market updater background task
    pub fn adjust_base_fee_public(&mut self, gas_used: u64, target_gas: u64) {
        if target_gas == 0 { return; }
        let current = self.base_fee_rate;
        let new_fee = if gas_used > target_gas {
            let delta = current * (gas_used - target_gas) / (target_gas * BASE_FEE_MAX_CHANGE_DENOM);
            current + delta.max(1)
        } else {
            let delta = current * (target_gas - gas_used) / (target_gas * BASE_FEE_MAX_CHANGE_DENOM);
            current.saturating_sub(delta)
        };
        self.base_fee_rate = new_fee.max(MIN_FEE_RATE_SAT_VB);
    }
}

impl Default for FeeMarket {
    fn default() -> Self { Self::new() }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum TxPrivacyLevel {
    Transparent,
    RingSig,
    Confidential,
    FullPrivacy,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum FeePriority {
    Fast,
    Standard,
    Economy,
    Custom(u64),
}

// ─── Fee validation ────────────────────────────────────────────────────────────

/// Validate that a transaction fee is sufficient
pub fn validate_fee(fee_sat: u64, vbytes: u64, min_rate: u64, privacy: TxPrivacyLevel) -> bool {
    if vbytes == 0 { return false; }
    let required_rate = min_rate;
    let surcharge_bps = match privacy {
        TxPrivacyLevel::Transparent => 0,
        TxPrivacyLevel::RingSig => RING_SURCHARGE_BPS,
        TxPrivacyLevel::Confidential => CONFIDENTIAL_SURCHARGE_BPS,
        TxPrivacyLevel::FullPrivacy => BULLETPROOF_SURCHARGE_BPS,
    };
    let min_fee = required_rate * vbytes * (10_000 + surcharge_bps) / 10_000;
    fee_sat >= min_fee
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base_fee_increases_on_full_block() {
        let mut market = FeeMarket::new();
        let initial = market.base_fee_rate;
        market.on_block_added(MAX_BLOCK_BYTES); // Full block
        assert!(market.base_fee_rate > initial);
    }

    #[test]
    fn test_base_fee_decreases_on_empty_block() {
        let mut market = FeeMarket::new();
        market.base_fee_rate = 5_000;
        market.on_block_added(0);
        assert!(market.base_fee_rate < 5_000);
        assert!(market.base_fee_rate >= MIN_FEE_RATE_SAT_VB);
    }

    #[test]
    fn test_privacy_surcharge() {
        let market = FeeMarket::new();
        let base_fee = market.calculate_tx_fee(250, TxPrivacyLevel::Transparent, FeePriority::Standard);
        let ring_fee = market.calculate_tx_fee(250, TxPrivacyLevel::RingSig, FeePriority::Standard);
        let full_fee = market.calculate_tx_fee(250, TxPrivacyLevel::FullPrivacy, FeePriority::Standard);
        assert!(ring_fee > base_fee);
        assert!(full_fee > ring_fee);
    }
}
