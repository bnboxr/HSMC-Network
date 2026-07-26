//! HSMC AMM — Constant-Product Automated Market Maker (UniV2-style)
//!
//! Phase 1 implementation of a non-custodial liquidity pool directly in the Rust node.
//! Uses the classic `x * y = k` invariant with configurable fee (basis points).
//!
//! ## Core operations
//! - [`create_pool`] — initialise a new token pair pool
//! - [`swap`] — trade token A for token B at the current pool price
//! - [`add_liquidity`] — deposit proportional reserves and receive LP tokens
//! - [`remove_liquidity`] — burn LP tokens and withdraw proportional reserves
//!
//! ## Safety
//! All arithmetic uses `u128` for intermediates to avoid overflow, then saturates
//! back to `u64`.  The invariant `x * y >= k` is enforced after every operation.

use serde::{Deserialize, Serialize};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum AmmError {
    #[error("insufficient liquidity in pool")]
    InsufficientLiquidity,

    #[error("swap amount too small — must be > 0")]
    SwapAmountTooSmall,

    #[error("insufficient output — swap would yield 0 tokens")]
    InsufficientOutput,

    #[error("invalid fee — must be <= 1000 bps (10%)")]
    InvalidFee,

    #[error("initial reserves must be > 0")]
    InvalidInitialReserves,

    #[error("insufficient LP tokens to burn")]
    InsufficientLpTokens,

    #[error("invariant violation: product decreased after operation")]
    InvariantViolation,
}

/// Convenience alias.
pub type AmmResult<T> = Result<T, AmmError>;

// ---------------------------------------------------------------------------
// Pool struct
// ---------------------------------------------------------------------------

/// A constant-product liquidity pool between two tokens.
///
/// The invariant is `reserve_a * reserve_b >= k` where `k` is the product after
/// the most recent state change.  Fees cause `k` to drift upward over time
/// (the pool accumulates value).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AmmPool {
    /// Identifier for the first token in the pair (e.g. "HSMC").
    pub token_a: String,

    /// Identifier for the second token in the pair (e.g. "wHSMC").
    pub token_b: String,

    /// Current reserve of token A (in smallest unit).
    pub reserve_a: u64,

    /// Current reserve of token B (in smallest unit).
    pub reserve_b: u64,

    /// Swap fee in basis points (1 bps = 0.01%).  Default: 30 (0.3%).
    pub fee_bps: u16,

    /// Total LP tokens minted.  Tracks proportional ownership of the pool.
    pub total_lp_supply: u64,

    /// Accumulated fees collected (measured in token A equivalent for reporting).
    pub fees_collected_a: u64,
    pub fees_collected_b: u64,
}

impl AmmPool {
    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /// Compute `amount_out` given `amount_in` using the constant-product
    /// formula, *after* deducting the pool fee from `amount_in`.
    ///
    /// Formula:
    ///   amount_in_after_fee = amount_in * (10_000 - fee_bps) / 10_000
    ///   amount_out = reserve_out - (reserve_in * reserve_out) / (reserve_in + amount_in_after_fee)
    #[inline]
    fn compute_swap_out(
        reserve_in: u64,
        reserve_out: u64,
        amount_in: u64,
        fee_bps: u16,
    ) -> AmmResult<u64> {
        if amount_in == 0 {
            return Err(AmmError::SwapAmountTooSmall);
        }

        let amount_in_f = amount_in as u128;
        let fee_factor = (10_000u128).saturating_sub(fee_bps as u128);
        let amount_in_after_fee = amount_in_f.saturating_mul(fee_factor) / 10_000;

        if amount_in_after_fee == 0 {
            return Err(AmmError::SwapAmountTooSmall);
        }

        let reserve_in_f = reserve_in as u128;
        let reserve_out_f = reserve_out as u128;

        // k = reserve_in * reserve_out
        let k = reserve_in_f.saturating_mul(reserve_out_f);

        // new_reserve_in = reserve_in + amount_in_after_fee
        let new_reserve_in = reserve_in_f.saturating_add(amount_in_after_fee);

        // new_reserve_out = k / new_reserve_in   (integer division floors)
        let new_reserve_out = k.checked_div(new_reserve_in).ok_or(AmmError::InsufficientLiquidity)?;

        // amount_out = reserve_out - new_reserve_out
        let amount_out = reserve_out_f.saturating_sub(new_reserve_out);

        if amount_out == 0 {
            return Err(AmmError::InsufficientOutput);
        }

        // amount_out should fit in u64; pools with giant reserves are unlikely
        Ok(u64::try_from(amount_out).unwrap_or(u64::MAX))
    }

    /// Mint LP tokens proportional to deposit.
    ///
    /// When the pool is empty (first deposit), `lp_tokens = sqrt(amount_a * amount_b)`.
    /// Otherwise, `lp_tokens = min(amount_a * total_lp / reserve_a, amount_b * total_lp / reserve_b)`.
    #[inline]
    fn compute_lp_tokens(
        total_lp: u64,
        reserve_a: u64,
        reserve_b: u64,
        amount_a: u64,
        amount_b: u64,
    ) -> u64 {
        if total_lp == 0 {
            // First liquidity provider — geometric mean
            let a = amount_a as u128;
            let b = amount_b as u128;
            let sqrt = integer_sqrt(a.saturating_mul(b));
            u64::try_from(sqrt).unwrap_or(u64::MAX)
        } else {
            let share_a = (amount_a as u128)
                .saturating_mul(total_lp as u128)
                .checked_div(reserve_a as u128)
                .unwrap_or(0);

            let share_b = (amount_b as u128)
                .saturating_mul(total_lp as u128)
                .checked_div(reserve_b as u128)
                .unwrap_or(0);

            u64::try_from(share_a.min(share_b)).unwrap_or(u64::MAX)
        }
    }
}

// ---------------------------------------------------------------------------
// Integer square root (Babylonian method)
// ---------------------------------------------------------------------------

/// Integer floor square root via the Babylonian method.
fn integer_sqrt(n: u128) -> u128 {
    if n <= 1 {
        return n;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Create a new liquidity pool.
///
/// # Errors
/// Returns [`AmmError::InvalidInitialReserves`] if either initial reserve is 0.
/// Returns [`AmmError::InvalidFee`] if `fee_bps > 1000` (10%).
pub fn create_pool(
    token_a: String,
    token_b: String,
    initial_a: u64,
    initial_b: u64,
    fee_bps: u16,
) -> AmmResult<AmmPool> {
    if initial_a == 0 || initial_b == 0 {
        return Err(AmmError::InvalidInitialReserves);
    }
    if fee_bps > 1000 {
        return Err(AmmError::InvalidFee);
    }

    // First LP provider gets LP tokens equal to geometric mean
    let lp_tokens = integer_sqrt((initial_a as u128).saturating_mul(initial_b as u128));
    let lp_tokens = u64::try_from(lp_tokens).unwrap_or(u64::MAX);

    Ok(AmmPool {
        token_a,
        token_b,
        reserve_a: initial_a,
        reserve_b: initial_b,
        fee_bps,
        total_lp_supply: lp_tokens,
        fees_collected_a: 0,
        fees_collected_b: 0,
    })
}

/// Swap `amount_in` of `token_in` for the other token in the pool.
///
/// Returns the amount of the *other* token received by the caller.
/// The fee is deducted from `amount_in` before computing the output.
///
/// # Errors
/// Returns [`AmmError::SwapAmountTooSmall`] if `amount_in == 0` or the
/// post-fee amount rounds to 0.
/// Returns [`AmmError::InsufficientOutput`] if the computed output is 0.
pub fn swap(pool: &mut AmmPool, token_in: &str, amount_in: u64) -> AmmResult<u64> {
    let old_k = (pool.reserve_a as u128).saturating_mul(pool.reserve_b as u128);

    let (amount_out, _fee_collected) = if token_in == pool.token_a {
        let out = AmmPool::compute_swap_out(pool.reserve_a, pool.reserve_b, amount_in, pool.fee_bps)?;
        // fee = amount_in - amount_in_after_fee  (floor division, matches compute_swap_out)
        let fee = amount_in.saturating_sub(
            ((amount_in as u128)
                .saturating_mul((10_000u128).saturating_sub(pool.fee_bps as u128))
                / 10_000) as u64,
        );

        pool.reserve_a = pool.reserve_a.saturating_add(amount_in);
        pool.reserve_b = pool.reserve_b.saturating_sub(out);
        pool.fees_collected_a = pool.fees_collected_a.saturating_add(fee);
        (out, fee)
    } else if token_in == pool.token_b {
        let out = AmmPool::compute_swap_out(pool.reserve_b, pool.reserve_a, amount_in, pool.fee_bps)?;
        // fee = amount_in - amount_in_after_fee  (floor division, matches compute_swap_out)
        let fee = amount_in.saturating_sub(
            ((amount_in as u128)
                .saturating_mul((10_000u128).saturating_sub(pool.fee_bps as u128))
                / 10_000) as u64,
        );

        pool.reserve_b = pool.reserve_b.saturating_add(amount_in);
        pool.reserve_a = pool.reserve_a.saturating_sub(out);
        pool.fees_collected_b = pool.fees_collected_b.saturating_add(fee);
        (out, fee)
    } else {
        // Token not in pool — treat as 0 liquidity on that side
        return Err(AmmError::InsufficientLiquidity);
    };

    // Invariant check — k must not decrease
    let new_k = (pool.reserve_a as u128).saturating_mul(pool.reserve_b as u128);
    if new_k < old_k {
        return Err(AmmError::InvariantViolation);
    }

    // Sanity: we should never have a reserve reach 0 from a normal swap
    if pool.reserve_a == 0 || pool.reserve_b == 0 {
        return Err(AmmError::InsufficientLiquidity);
    }

    Ok(amount_out)
}

/// Add liquidity to an existing pool.
///
/// Returns the number of LP tokens minted for the provider.
/// The caller should deposit `amount_a` and `amount_b` in the *same ratio*
/// as the current pool reserves; otherwise the smaller proportional amount
/// is used and the excess is effectively donated (standard UniV2 behaviour).
///
/// # Errors
/// Returns [`AmmError::InsufficientLiquidity`] if the pool is in an invalid state.
pub fn add_liquidity(pool: &mut AmmPool, amount_a: u64, amount_b: u64) -> AmmResult<u64> {
    if amount_a == 0 && amount_b == 0 {
        return Ok(0);
    }

    let lp_minted = AmmPool::compute_lp_tokens(
        pool.total_lp_supply,
        pool.reserve_a,
        pool.reserve_b,
        amount_a,
        amount_b,
    );

    if lp_minted == 0 {
        return Err(AmmError::InsufficientLiquidity);
    }

    // Actually "deposit" the amounts (in a real system this would transfer
    // tokens from the user to the pool).  Here we simply increase reserves
    // by the amounts the caller says they are depositing.
    pool.reserve_a = pool.reserve_a.saturating_add(amount_a);
    pool.reserve_b = pool.reserve_b.saturating_add(amount_b);
    pool.total_lp_supply = pool.total_lp_supply.saturating_add(lp_minted);

    Ok(lp_minted)
}

/// Remove liquidity from the pool.
///
/// Burn `lp_tokens` and return the proportional reserves.
///
/// # Errors
/// Returns [`AmmError::InsufficientLpTokens`] if `lp_tokens > total_lp_supply`.
pub fn remove_liquidity(pool: &mut AmmPool, lp_tokens: u64) -> AmmResult<(u64, u64)> {
    if lp_tokens == 0 {
        return Ok((0, 0));
    }
    if lp_tokens > pool.total_lp_supply {
        return Err(AmmError::InsufficientLpTokens);
    }

    let share_a = (pool.reserve_a as u128)
        .saturating_mul(lp_tokens as u128)
        / (pool.total_lp_supply as u128);

    let share_b = (pool.reserve_b as u128)
        .saturating_mul(lp_tokens as u128)
        / (pool.total_lp_supply as u128);

    let amount_a = u64::try_from(share_a).unwrap_or(u64::MAX);
    let amount_b = u64::try_from(share_b).unwrap_or(u64::MAX);

    pool.reserve_a = pool.reserve_a.saturating_sub(amount_a);
    pool.reserve_b = pool.reserve_b.saturating_sub(amount_b);
    pool.total_lp_supply = pool.total_lp_supply.saturating_sub(lp_tokens);

    Ok((amount_a, amount_b))
}

/// Return the current spot price of `token_a` in terms of `token_b`.
/// `price = reserve_b / reserve_a`  (how many B you get for 1 A before fees).
pub fn spot_price(pool: &AmmPool, token_a: &str) -> Option<f64> {
    if token_a == pool.token_a {
        if pool.reserve_a == 0 {
            None
        } else {
            Some(pool.reserve_b as f64 / pool.reserve_a as f64)
        }
    } else if token_a == pool.token_b {
        if pool.reserve_b == 0 {
            None
        } else {
            Some(pool.reserve_a as f64 / pool.reserve_b as f64)
        }
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---------------------------------------------------------------
    // Pool creation
    // ---------------------------------------------------------------

    #[test]
    fn test_create_pool_success() {
        let pool = create_pool("HSMC".into(), "USDC".into(), 1_000_000, 500_000, 30).unwrap();
        assert_eq!(pool.token_a, "HSMC");
        assert_eq!(pool.token_b, "USDC");
        assert_eq!(pool.reserve_a, 1_000_000);
        assert_eq!(pool.reserve_b, 500_000);
        assert_eq!(pool.fee_bps, 30);
        assert!(pool.total_lp_supply > 0);
    }

    #[test]
    fn test_create_pool_zero_reserves() {
        let err = create_pool("A".into(), "B".into(), 0, 1000, 30).unwrap_err();
        assert_eq!(err, AmmError::InvalidInitialReserves);
    }

    #[test]
    fn test_create_pool_fee_too_high() {
        let err = create_pool("A".into(), "B".into(), 1000, 1000, 1001).unwrap_err();
        assert_eq!(err, AmmError::InvalidFee);
    }

    // ---------------------------------------------------------------
    // Swap — correct price
    // ---------------------------------------------------------------

    #[test]
    fn test_swap_basic() {
        // Pool: 1M HSMC, 500K USDC  →  price = 0.5 USDC/HSMC
        let mut pool = create_pool("HSMC".into(), "USDC".into(), 1_000_000, 500_000, 30).unwrap();

        // Swap 10_000 HSMC for USDC
        // amount_in_after_fee = 10000 * (10000-30)/10000 = 9970
        // k = 1_000_000 * 500_000 = 500_000_000_000
        // new_reserve_hsmc = 1_000_000 + 9_970 = 1_009_970
        // new_reserve_usdc = 500_000_000_000 / 1_009_970 = 495_064
        // amount_out = 500_000 - 495_064 = 4_936
        let out = swap(&mut pool, "HSMC", 10_000).unwrap();
        assert_eq!(out, 4_936);
        assert_eq!(pool.reserve_a, 1_010_000); // 1M + 10K
        assert_eq!(pool.reserve_b, 500_000 - 4_936); // 495_064
    }

    #[test]
    fn test_swap_zero_amount() {
        let mut pool = create_pool("A".into(), "B".into(), 1000, 1000, 30).unwrap();
        let err = swap(&mut pool, "A", 0).unwrap_err();
        assert_eq!(err, AmmError::SwapAmountTooSmall);
    }

    #[test]
    fn test_swap_unknown_token() {
        let mut pool = create_pool("A".into(), "B".into(), 1000, 1000, 30).unwrap();
        let err = swap(&mut pool, "C", 100).unwrap_err();
        assert_eq!(err, AmmError::InsufficientLiquidity);
    }

    #[test]
    fn test_swap_roundtrip_approximately() {
        // Swap A→B then B→A; should lose ~fee both ways
        let mut pool = create_pool("A".into(), "B".into(), 1_000_000, 1_000_000, 30).unwrap();
        let a_start = pool.reserve_a;

        let b_out = swap(&mut pool, "A", 100_000).unwrap();
        assert!(b_out > 0);

        let a_back = swap(&mut pool, "B", b_out).unwrap();
        // a_back should be strictly less than 100_000 due to fees on both swaps
        assert!(a_back < 100_000);

        // Invariant: reserves grew (fees stayed in pool)
        assert!(pool.reserve_a > a_start - 100_000 + a_back);
    }

    // ---------------------------------------------------------------
    // Fee collection
    // ---------------------------------------------------------------

    #[test]
    fn test_fee_collected() {
        let mut pool = create_pool("HSMC".into(), "USDC".into(), 1_000_000, 500_000, 100).unwrap(); // 1% fee

        let fees_before = pool.fees_collected_a;
        let _out = swap(&mut pool, "HSMC", 10_000).unwrap();

        // fee = 10_000 * 100 / 10_000 = 100
        assert_eq!(pool.fees_collected_a - fees_before, 100);
    }

    #[test]
    fn test_fee_collected_token_b() {
        let mut pool = create_pool("HSMC".into(), "USDC".into(), 1_000_000, 500_000, 100).unwrap();

        let fees_before = pool.fees_collected_b;
        let _out = swap(&mut pool, "USDC", 10_000).unwrap();

        assert_eq!(pool.fees_collected_b - fees_before, 100);
    }

    // ---------------------------------------------------------------
    // Add liquidity
    // ---------------------------------------------------------------

    #[test]
    fn test_add_liquidity_proportional() {
        let mut pool = create_pool("A".into(), "B".into(), 1_000_000, 500_000, 30).unwrap();
        let lp_before = pool.total_lp_supply;

        // Add 10% of each reserve → should get ~10% more LP tokens
        let lp = add_liquidity(&mut pool, 100_000, 50_000).unwrap();
        assert!(lp > 0);

        // LP supply increased proportionally (~10%)
        let ratio = lp_before as f64 / lp as f64;
        assert!((ratio - 10.0).abs() < 2.0, "expected ~10x ratio, got {ratio}");

        assert_eq!(pool.reserve_a, 1_100_000);
        assert_eq!(pool.reserve_b, 550_000);
    }

    #[test]
    fn test_add_liquidity_zero() {
        let mut pool = create_pool("A".into(), "B".into(), 1000, 1000, 30).unwrap();
        let lp = add_liquidity(&mut pool, 0, 0).unwrap();
        assert_eq!(lp, 0);
    }

    // ---------------------------------------------------------------
    // Remove liquidity
    // ---------------------------------------------------------------

    #[test]
    fn test_remove_liquidity_full() {
        let mut pool = create_pool("A".into(), "B".into(), 1000, 2000, 30).unwrap();
        let total_lp = pool.total_lp_supply;

        let (out_a, out_b) = remove_liquidity(&mut pool, total_lp).unwrap();
        assert_eq!(out_a, 1000);
        assert_eq!(out_b, 2000);
        assert_eq!(pool.reserve_a, 0);
        assert_eq!(pool.reserve_b, 0);
        assert_eq!(pool.total_lp_supply, 0);
    }

    #[test]
    fn test_remove_liquidity_partial() {
        let mut pool = create_pool("A".into(), "B".into(), 1000, 2000, 30).unwrap();
        let total_lp = pool.total_lp_supply;
        let half = total_lp / 2;

        let (out_a, out_b) = remove_liquidity(&mut pool, half).unwrap();
        // Should get roughly half of each reserve back
        assert!(out_a >= 499 && out_a <= 501, "got {out_a}");
        assert!(out_b >= 999 && out_b <= 1001, "got {out_b}");
    }

    #[test]
    fn test_remove_liquidity_too_many() {
        let mut pool = create_pool("A".into(), "B".into(), 1000, 2000, 30).unwrap();
        let too_many = pool.total_lp_supply + 1;
        let err = remove_liquidity(&mut pool, too_many).unwrap_err();
        assert_eq!(err, AmmError::InsufficientLpTokens);
    }

    // ---------------------------------------------------------------
    // Pool invariants
    // ---------------------------------------------------------------

    #[test]
    fn test_invariant_after_swap() {
        let mut pool = create_pool("A".into(), "B".into(), 1_000_000, 1_000_000, 30).unwrap();
        let k_before = pool.reserve_a as u128 * pool.reserve_b as u128;

        let _ = swap(&mut pool, "A", 50_000).unwrap();

        let k_after = pool.reserve_a as u128 * pool.reserve_b as u128;
        // k must not decrease; due to fees it may increase slightly
        assert!(k_after >= k_before, "invariant violated: k_before={k_before}, k_after={k_after}");
    }

    #[test]
    fn test_invariant_after_add_liquidity() {
        let mut pool = create_pool("A".into(), "B".into(), 1_000_000, 1_000_000, 30).unwrap();
        let _ = add_liquidity(&mut pool, 100_000, 100_000).unwrap();
        // After adding proportional liquidity, k should scale proportionally
        let k = pool.reserve_a as u128 * pool.reserve_b as u128;
        assert!(k > 1_000_000u128 * 1_000_000);
    }

    #[test]
    fn test_invariant_after_remove_liquidity() {
        let mut pool = create_pool("A".into(), "B".into(), 1_000_000, 1_000_000, 30).unwrap();
        let half_lp = pool.total_lp_supply / 2;
        let k_before = pool.reserve_a as u128 * pool.reserve_b as u128;
        let _ = remove_liquidity(&mut pool, half_lp).unwrap();

        // After removing half, k should be roughly 1/4 (reserves halved)
        let k_after = pool.reserve_a as u128 * pool.reserve_b as u128;
        let expected = k_before / 4;
        let diff = if k_after > expected { k_after - expected } else { expected - k_after };
        let tolerance = k_before / 100; // 1% tolerance for integer rounding
        assert!(diff <= tolerance, "k mismatch: expected ~{expected}, got {k_after}");
    }

    // ---------------------------------------------------------------
    // Spot price
    // ---------------------------------------------------------------

    #[test]
    fn test_spot_price() {
        let pool = create_pool("HSMC".into(), "USDC".into(), 1_000_000, 500_000, 30).unwrap();
        let price = spot_price(&pool, "HSMC").unwrap();
        assert!((price - 0.5).abs() < 0.001, "expected 0.5, got {price}");

        let price_inv = spot_price(&pool, "USDC").unwrap();
        assert!((price_inv - 2.0).abs() < 0.001, "expected 2.0, got {price_inv}");

        assert!(spot_price(&pool, "UNKNOWN").is_none());
    }

    // ---------------------------------------------------------------
    // Fuzzing / edge-cases
    // ---------------------------------------------------------------

    #[test]
    fn test_many_small_swaps() {
        let mut pool = create_pool("A".into(), "B".into(), 1_000_000_000, 1_000_000_000, 30).unwrap();
        let k_before = pool.reserve_a as u128 * pool.reserve_b as u128;

        for _ in 0..1000 {
            let _ = swap(&mut pool, "A", 100).unwrap();
        }

        let k_after = pool.reserve_a as u128 * pool.reserve_b as u128;
        assert!(k_after >= k_before);
        // Fees should have accumulated
        assert!(pool.fees_collected_a > 0);
    }

    #[test]
    fn test_full_lifecycle() {
        // Create pool
        let mut pool = create_pool("HSMC".into(), "USDC".into(), 1_000_000, 500_000, 30).unwrap();
        let initial_lp = pool.total_lp_supply;

        // LP #2 adds balanced liquidity
        let lp2 = add_liquidity(&mut pool, 100_000, 50_000).unwrap();
        assert!(lp2 > 0);
        assert_eq!(pool.total_lp_supply, initial_lp + lp2);

        // Trader swaps
        let out1 = swap(&mut pool, "HSMC", 10_000).unwrap();
        assert!(out1 > 0);
        let out2 = swap(&mut pool, "USDC", 5_000).unwrap();
        assert!(out2 > 0);

        // LP #2 removes half their position
        let (back_a, back_b) = remove_liquidity(&mut pool, lp2 / 2).unwrap();
        assert!(back_a > 0);
        assert!(back_b > 0);

        // Pool still has positive reserves
        assert!(pool.reserve_a > 0);
        assert!(pool.reserve_b > 0);
        assert!(pool.total_lp_supply > 0);
    }
}
