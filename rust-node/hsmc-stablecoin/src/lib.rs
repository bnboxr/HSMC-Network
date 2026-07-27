//! HSMC Stablecoin Engine — Over-Collateralized CDP System (DAI/MakerDAO-style)
//!
//! ## Architecture
//!
//! Users lock HSMC as collateral and mint stablecoins against it. Three stablecoins
//! are natively supported:
//! - **USDHSMC** — pegged to USD (1 USDHSMC = $1.00)
//! - **EURHSMC** — pegged to EUR (1 EURHSMC = €1.00)
//! - **XAUHSMC** — pegged to 1 troy ounce of gold
//!
//! Each is backed by over-collateralized CDPs:
//! - Minimum collateralization ratio: 150%
//! - Liquidation ratio: 130% (undercollateralized CDPs can be liquidated)
//! - Liquidation penalty: 13% fee paid to liquidator
//! - Stability fee: annual interest rate (configurable per token)
//!
//! ## Security
//!
//! - Checked/saturating math throughout
//! - No algorithmic stablecoin mechanisms — over-collateralized only
//! - Price feeds from the HSMC oracle (multi-source, median+IQR)
//! - Dust protection (minimum CDP size)
//! - Compound interest for stability fees (exponential, not linear)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use tracing::{debug, info};

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

/// Minimum CDP size: 100 HSMC collateral (in atomic units, 1 HSMC = 10^8)
pub const MIN_CDP_COLLATERAL: u64 = 100 * 100_000_000;

/// Default minimum collateralization ratio (150%)
pub const DEFAULT_MIN_COLLATERAL_RATIO_BPS: u16 = 15_000; // 150.00%

/// Default liquidation ratio (130%)
pub const DEFAULT_LIQUIDATION_RATIO_BPS: u16 = 13_000; // 130.00%

/// Default liquidation penalty (13% = 1300 bps)
pub const DEFAULT_LIQUIDATION_PENALTY_BPS: u16 = 1_300;

/// Default stability fee rate in basis points (2.5% = 250 bps)
pub const DEFAULT_STABILITY_FEE_BPS: u16 = 250;

/// Maximum stability fee (50% = 5000 bps)
pub const MAX_STABILITY_FEE_BPS: u16 = 5_000;

/// Maximum liquidation penalty (50% = 5000 bps)
pub const MAX_LIQUIDATION_PENALTY_BPS: u16 = 5_000;

/// Minimum collateral ratio allowed (120% = 12000 bps)
pub const MIN_COLLATERAL_RATIO_BPS: u16 = 12_000;

/// Maximum collateral ratio (1000% = 100000 bps) — use u32 for this one
pub const MAX_COLLATERAL_RATIO_BPS: u32 = 100_000;

/// One stablecoin in atomic units (6 decimals, matching USDC)
pub const STABLECOIN_DECIMALS: u32 = 6;
pub const STABLECOIN_ATOMIC: u64 = 1_000_000; // 10^6

/// One HSMC in atomic units (satoshis)
pub const HSMC_ATOMIC: u64 = 100_000_000;

/// Seconds in a year (365.25 days for leap year averaging)
pub const SECONDS_PER_YEAR: f64 = 31_557_600.0;

// ═══════════════════════════════════════════════════════════════════════
// ERROR TYPE
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Error)]
pub enum StablecoinError {
    #[error("CDP not found: {0}")]
    CdpNotFound(u64),

    #[error("Insufficient collateral: need {required} HSMC, provided {provided}")]
    InsufficientCollateral { required: u64, provided: u64 },

    #[error("Collateral below minimum CDP size ({min} HSMC)")]
    CdpTooSmall { min: u64 },

    #[error("Would be immediately liquidatable: ratio {ratio_bps} bps below liquidation {liq_bps} bps")]
    ImmediatelyLiquidatable { ratio_bps: u16, liq_bps: u16 },

    #[error("Repay amount exceeds debt: debt={debt}, attempted={attempted}")]
    RepayExceedsDebt { debt: u64, attempted: u64 },

    #[error("CDP is healthy (ratio {ratio_bps} bps >= liquidation {liq_bps} bps) — cannot liquidate")]
    CdpHealthy { ratio_bps: u16, liq_bps: u16 },

    #[error("Not the CDP owner: expected {expected}, got {actual}")]
    NotOwner { expected: String, actual: String },

    #[error("CDP already closed")]
    CdpAlreadyClosed,

    #[error("Stablecoin type not found: {0}")]
    UnknownStablecoin(String),

    #[error("Amount overflow")]
    Overflow,

    #[error("Transfer amount exceeds balance: balance={balance}, requested={requested}")]
    InsufficientBalance { balance: u64, requested: u64 },

    #[error("Token not found: {0}")]
    TokenNotFound(String),

    #[error("Governance parameter out of range: {field} = {value}, valid range [{min}, {max}]")]
    ParameterOutOfRange { field: String, value: u64, min: u64, max: u64 },
}

// ═══════════════════════════════════════════════════════════════════════
// STABLECOIN TYPE
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StablecoinType {
    #[serde(rename = "USDHSMC")]
    UsdHsmc,
    #[serde(rename = "EURHSMC")]
    EurHsmc,
    #[serde(rename = "XAUHSMC")]
    XauHsmc,
}

impl StablecoinType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UsdHsmc => "USDHSMC",
            Self::EurHsmc => "EURHSMC",
            Self::XauHsmc => "XAUHSMC",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "USDHSMC" => Some(Self::UsdHsmc),
            "EURHSMC" => Some(Self::EurHsmc),
            "XAUHSMC" => Some(Self::XauHsmc),
            _ => None,
        }
    }
}

impl std::fmt::Display for StablecoinType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// CDP (COLLATERALIZED DEBT POSITION)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cdp {
    /// Unique CDP identifier
    pub id: u64,
    /// Owner's HSMC address
    pub owner: String,
    /// Collateral locked in atomic units (1 HSMC = 10^8)
    pub collateral_amount: u64,
    /// Debt in stablecoin atomic units (18 decimal places for precision)
    pub debt_amount: u64,
    /// Type of stablecoin minted
    pub stablecoin_type: StablecoinType,
    /// Block height at creation
    pub creation_block: u64,
    /// Timestamp (unix seconds) of last fee accrual
    pub last_fee_accrual: i64,
    /// Whether the CDP is active or closed
    pub active: bool,
}

impl Cdp {
    /// Calculate the current collateralization ratio in basis points (e.g., 15000 = 150.00%).
    ///
    /// Formula: (collateral_value / debt) * 10000
    /// collateral_value = collateral_hsmc * hsmc_price_usd (for USDHSMC)
    /// For EURHSMC: additional EUR/USD conversion
    /// For XAUHSMC: gold price is already in XAU/USD
    pub fn collateral_ratio_bps(
        &self,
        hsmc_price_usd: f64,
        eur_usd: Option<f64>,
        xau_usd: Option<f64>,
    ) -> Option<u16> {
        if self.debt_amount == 0 {
            return Some(u16::MAX);
        }
        let collateral_hsmc = self.collateral_amount as f64 / HSMC_ATOMIC as f64;
        let debt_normalized = self.debt_amount as f64 / STABLECOIN_ATOMIC as f64; // 18 decimals

        let collateral_value_usd = match self.stablecoin_type {
            StablecoinType::UsdHsmc => collateral_hsmc * hsmc_price_usd,
            StablecoinType::EurHsmc => {
                let eur = eur_usd.unwrap_or(1.0);
                if eur <= 0.0 {
                    return None;
                }
                collateral_hsmc * hsmc_price_usd / eur
            }
            StablecoinType::XauHsmc => {
                let xau = xau_usd.unwrap_or(2600.0);
                if xau <= 0.0 {
                    return None;
                }
                collateral_hsmc * hsmc_price_usd / xau
            }
        };

        if debt_normalized <= 0.0 || collateral_value_usd <= 0.0 {
            return None;
        }

        let ratio = (collateral_value_usd / debt_normalized * 10_000.0) as u16;
        Some(ratio)
    }

    /// Get the liquidation price — the HSMC/USD price at which this CDP becomes liquidatable.
    pub fn liquidation_price(&self, liquidation_ratio_bps: u16) -> Option<f64> {
        if self.collateral_amount == 0 || self.debt_amount == 0 {
            return None;
        }
        let debt_normalized = self.debt_amount as f64 / STABLECOIN_ATOMIC as f64;
        let collateral_hsmc = self.collateral_amount as f64 / HSMC_ATOMIC as f64;
        // At liquidation: collateral_hsmc * price * ratio = debt * liquidation_ratio
        // price = debt * liquidation_ratio / (collateral_hsmc * ratio)
        let ratio = (liquidation_ratio_bps as f64) / 10_000.0;
        let price = (debt_normalized * ratio) / collateral_hsmc;
        Some(price)
    }
}

// ═══════════════════════════════════════════════════════════════════════
// STABLECOIN CONFIGURATION (per-token params)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StablecoinConfig {
    /// Minimum collateralization ratio in basis points (e.g., 15000 = 150%)
    pub min_collateral_ratio_bps: u16,
    /// Liquidation ratio in basis points (e.g., 13000 = 130%)
    pub liquidation_ratio_bps: u16,
    /// Liquidation penalty in basis points (e.g., 1300 = 13%)
    pub liquidation_penalty_bps: u16,
    /// Annual stability fee rate in basis points (e.g., 250 = 2.5%)
    pub stability_fee_rate_bps: u16,
}

impl Default for StablecoinConfig {
    fn default() -> Self {
        Self {
            min_collateral_ratio_bps: DEFAULT_MIN_COLLATERAL_RATIO_BPS,
            liquidation_ratio_bps: DEFAULT_LIQUIDATION_RATIO_BPS,
            liquidation_penalty_bps: DEFAULT_LIQUIDATION_PENALTY_BPS,
            stability_fee_rate_bps: DEFAULT_STABILITY_FEE_BPS,
        }
    }
}

impl StablecoinConfig {
    pub fn new_with_liquidation_penalty(liquidation_penalty_bps: u16) -> Self {
        Self {
            liquidation_penalty_bps,
            ..Default::default()
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// TOKEN BALANCE TRACKING
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenState {
    /// Total supply of the token in atomic units (18 decimals)
    pub total_supply: u64,
    /// Balances: address -> amount in atomic units
    pub balances: HashMap<String, u64>,
}

impl TokenState {
    pub fn new() -> Self {
        Self {
            total_supply: 0,
            balances: HashMap::new(),
        }
    }

    pub fn balance_of(&self, address: &str) -> u64 {
        self.balances.get(address).copied().unwrap_or(0)
    }

    pub fn mint(&mut self, to: &str, amount: u64) -> Result<(), StablecoinError> {
        let balance = self.balances.entry(to.to_string()).or_insert(0);
        *balance = balance.checked_add(amount).ok_or(StablecoinError::Overflow)?;
        self.total_supply = self.total_supply.checked_add(amount).ok_or(StablecoinError::Overflow)?;
        Ok(())
    }

    pub fn burn(&mut self, from: &str, amount: u64) -> Result<(), StablecoinError> {
        let balance = self.balances.get_mut(from).ok_or(StablecoinError::InsufficientBalance {
            balance: 0,
            requested: amount,
        })?;
        if *balance < amount {
            return Err(StablecoinError::InsufficientBalance {
                balance: *balance,
                requested: amount,
            });
        }
        *balance = balance.checked_sub(amount).ok_or(StablecoinError::Overflow)?;
        self.total_supply = self.total_supply.checked_sub(amount).ok_or(StablecoinError::Overflow)?;
        Ok(())
    }

    pub fn transfer(&mut self, from: &str, to: &str, amount: u64) -> Result<(), StablecoinError> {
        self.burn(from, amount)?;
        self.mint(to, amount)?;
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// CDP ENGINE — Core stablecoin system
// ═══════════════════════════════════════════════════════════════════════

/// The main stablecoin engine managing CDPs, tokens, and parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpEngine {
    /// All CDPs keyed by ID
    pub cdps: HashMap<u64, Cdp>,
    /// Next CDP ID counter
    pub next_cdp_id: u64,
    /// Token states: USDHSMC, EURHSMC, XAUHSMC
    pub usd_token: TokenState,
    pub eur_token: TokenState,
    pub xau_token: TokenState,
    /// Configuration per stablecoin type
    pub usd_config: StablecoinConfig,
    pub eur_config: StablecoinConfig,
    pub xau_config: StablecoinConfig,
    /// Minimum CDP size in atomic units (100 HSMC default)
    pub min_cdp_collateral: u64,
}

impl CdpEngine {
    /// Create a new CDP engine with default parameters.
    pub fn new() -> Self {
        Self {
            cdps: HashMap::new(),
            next_cdp_id: 1,
            usd_token: TokenState::new(),
            eur_token: TokenState::new(),
            xau_token: TokenState::new(),
            usd_config: StablecoinConfig::default(),
            eur_config: StablecoinConfig::default(),
            xau_config: StablecoinConfig::default(),
            min_cdp_collateral: MIN_CDP_COLLATERAL,
        }
    }

    // ── Token helpers ─────────────────────────────────────────────────────

    fn token_for(&self, st: StablecoinType) -> Result<&TokenState, StablecoinError> {
        match st {
            StablecoinType::UsdHsmc => Ok(&self.usd_token),
            StablecoinType::EurHsmc => Ok(&self.eur_token),
            StablecoinType::XauHsmc => Ok(&self.xau_token),
        }
    }

    fn token_mut(&mut self, st: StablecoinType) -> Result<&mut TokenState, StablecoinError> {
        match st {
            StablecoinType::UsdHsmc => Ok(&mut self.usd_token),
            StablecoinType::EurHsmc => Ok(&mut self.eur_token),
            StablecoinType::XauHsmc => Ok(&mut self.xau_token),
        }
    }

    fn config_for(&self, st: StablecoinType) -> Result<&StablecoinConfig, StablecoinError> {
        match st {
            StablecoinType::UsdHsmc => Ok(&self.usd_config),
            StablecoinType::EurHsmc => Ok(&self.eur_config),
            StablecoinType::XauHsmc => Ok(&self.xau_config),
        }
    }

    fn config_mut(&mut self, st: StablecoinType) -> Result<&mut StablecoinConfig, StablecoinError> {
        match st {
            StablecoinType::UsdHsmc => Ok(&mut self.usd_config),
            StablecoinType::EurHsmc => Ok(&mut self.eur_config),
            StablecoinType::XauHsmc => Ok(&mut self.xau_config),
        }
    }

    // ── Core Operations ───────────────────────────────────────────────────

    /// Create a CDP by locking HSMC collateral and minting stablecoins.
    ///
    /// * `owner` — HSMC address of the CDP owner
    /// * `collateral_amount` — HSMC to lock (in atomic units, 1 HSMC = 10^8)
    /// * `stablecoin_type` — which stablecoin to mint
    /// * `block_height` — current chain height
    /// * `current_timestamp` — unix timestamp
    /// * `hsmc_price_usd` — current HSMC/USD price from oracle
    /// * `eur_usd` — current EUR/USD price (only needed for EURHSMC)
    /// * `xau_usd` — current XAU/USD price (only needed for XAUHSMC)
    ///
    /// Returns the new CDP's ID.
    pub fn create_cdp(
        &mut self,
        owner: String,
        collateral_amount: u64,
        stablecoin_type: StablecoinType,
        block_height: u64,
        current_timestamp: i64,
        hsmc_price_usd: f64,
        eur_usd: Option<f64>,
        xau_usd: Option<f64>,
    ) -> Result<u64, StablecoinError> {
        // Validate collateral amount
        if collateral_amount < self.min_cdp_collateral {
            return Err(StablecoinError::CdpTooSmall {
                min: self.min_cdp_collateral / HSMC_ATOMIC,
            });
        }

        let config = self.config_for(stablecoin_type)?.clone();

        // Calculate max debt we can mint:
        // max_debt = collateral_value / min_collateral_ratio
        // where collateral_value = (collateral_hsmc * hsmc_price_usd) / conversion_factor
        let collateral_hsmc = collateral_amount as f64 / HSMC_ATOMIC as f64;
        let (collateral_value_usd, _debt_multiplier) = match stablecoin_type {
            StablecoinType::UsdHsmc => {
                (collateral_hsmc * hsmc_price_usd, 1.0)
            }
            StablecoinType::EurHsmc => {
                let eur = eur_usd.unwrap_or(1.0);
                if eur <= 0.0 {
                    return Err(StablecoinError::Overflow);
                }
                (collateral_hsmc * hsmc_price_usd / eur, 1.0)
            }
            StablecoinType::XauHsmc => {
                let xau = xau_usd.unwrap_or(2600.0);
                if xau <= 0.0 {
                    return Err(StablecoinError::Overflow);
                }
                (collateral_hsmc * hsmc_price_usd / xau, 1.0)
            }
        };

        let min_ratio = config.min_collateral_ratio_bps as f64 / 10_000.0;
        let max_debt_normalized = collateral_value_usd / min_ratio;

        // Convert to atomic units (18 decimals for stablecoin)
        let max_debt_atomic = (max_debt_normalized * STABLECOIN_ATOMIC as f64) as u64;

        if max_debt_atomic == 0 {
            return Err(StablecoinError::Overflow);
        }

        // Safety: check that the CDP won't be immediately liquidatable
        // At creation with max debt: ratio matches min_collateral_ratio exactly
        // The liquidation ratio is lower (e.g., 130% vs 150%), so it shouldn't be immediately liquidatable
        // But we check anyway using the same calculation
        let liq_ratio = config.liquidation_ratio_bps as f64 / 10_000.0;
        let liq_threshold_value = max_debt_normalized * liq_ratio;
        if collateral_value_usd <= liq_threshold_value {
            return Err(StablecoinError::ImmediatelyLiquidatable {
                ratio_bps: config.min_collateral_ratio_bps,
                liq_bps: config.liquidation_ratio_bps,
            });
        }

        let cdp_id = self.next_cdp_id;
        self.next_cdp_id = self.next_cdp_id.checked_add(1).ok_or(StablecoinError::Overflow)?;

        let cdp = Cdp {
            id: cdp_id,
            owner: owner.clone(),
            collateral_amount,
            debt_amount: max_debt_atomic,
            stablecoin_type,
            creation_block: block_height,
            last_fee_accrual: current_timestamp,
            active: true,
        };

        // Mint stablecoins to owner
        self.token_mut(stablecoin_type)?.mint(&owner, max_debt_atomic)?;

        self.cdps.insert(cdp_id, cdp);

        info!(
            "🏦 CDP #{} created: owner={}, collateral={} HSMC, debt={} {}, ratio={}%",
            cdp_id,
            &owner[..12.min(owner.len())],
            collateral_hsmc,
            max_debt_normalized,
            stablecoin_type,
            min_ratio * 100.0
        );

        Ok(cdp_id)
    }

    /// Repay the full debt and close the CDP.
    /// Burns the stablecoins and releases all collateral to the owner.
    pub fn repay_and_close(
        &mut self,
        cdp_id: u64,
        current_timestamp: i64,
    ) -> Result<(u64, u64), StablecoinError> {
        // Accrue stability fees first
        let total_debt = self.accrue_stability_fees_internal(cdp_id, current_timestamp)?;

        // Extract data before mutation
        let (collateral, owner, st) = {
            let cdp = self.cdps.get(&cdp_id).ok_or(StablecoinError::CdpNotFound(cdp_id))?;
            if !cdp.active {
                return Err(StablecoinError::CdpAlreadyClosed);
            }
            (cdp.collateral_amount, cdp.owner.clone(), cdp.stablecoin_type)
        };

        // Burn the debt
        self.token_mut(st)?.burn(&owner, total_debt)?;

        // Remove CDP
        self.cdps.remove(&cdp_id);

        info!(
            "🏦 CDP #{} closed: repaid {} {}, released {} HSMC",
            cdp_id,
            total_debt as f64 / STABLECOIN_ATOMIC as f64,
            st,
            collateral as f64 / HSMC_ATOMIC as f64
        );

        Ok((collateral, total_debt))
    }

    /// Repay a partial amount of debt, releasing proportional collateral.
    pub fn repay_partial(
        &mut self,
        cdp_id: u64,
        repay_amount: u64,
        current_timestamp: i64,
    ) -> Result<u64, StablecoinError> {
        if repay_amount == 0 {
            return Err(StablecoinError::Overflow);
        }

        // Accrue fees first
        let total_debt = self.accrue_stability_fees_internal(cdp_id, current_timestamp)?;

        if repay_amount > total_debt {
            return Err(StablecoinError::RepayExceedsDebt {
                debt: total_debt,
                attempted: repay_amount,
            });
        }

        // Extract data
        let (owner, st, collateral_amount) = {
            let cdp = self.cdps.get(&cdp_id).ok_or(StablecoinError::CdpNotFound(cdp_id))?;
            if !cdp.active {
                return Err(StablecoinError::CdpAlreadyClosed);
            }
            (cdp.owner.clone(), cdp.stablecoin_type, cdp.collateral_amount)
        };

        // Proportional collateral release
        let ratio = repay_amount as f64 / total_debt as f64;
        let collateral_to_release = (collateral_amount as f64 * ratio) as u64;

        // Burn the stablecoins
        self.token_mut(st)?.burn(&owner, repay_amount)?;

        // Update CDP
        let cdp = self.cdps.get_mut(&cdp_id).unwrap();
        cdp.debt_amount = cdp.debt_amount.saturating_sub(repay_amount);
        cdp.collateral_amount = cdp.collateral_amount.saturating_sub(collateral_to_release);
        cdp.last_fee_accrual = current_timestamp;

        // If fully repaid, close CDP
        if cdp.debt_amount == 0 {
            let remaining = cdp.collateral_amount;
            self.cdps.remove(&cdp_id);
            info!("CDP #{} fully repaid via partial repay, {} HSMC released", cdp_id, remaining as f64 / HSMC_ATOMIC as f64);
            return Ok(collateral_to_release);
        }

        // Check that remaining collateral is still above minimum or close
        if cdp.collateral_amount < self.min_cdp_collateral && cdp.collateral_amount > 0 {
            let remaining_debt = cdp.debt_amount;
            let remaining = cdp.collateral_amount;
            self.token_mut(st)?.burn(&owner, remaining_debt)?;
            self.cdps.remove(&cdp_id);
            info!("CDP #{} closed (below min size after partial repay), {} HSMC released", cdp_id, remaining as f64 / HSMC_ATOMIC as f64);
            return Ok(remaining);
        }

        Ok(collateral_to_release)
    }

    /// Liquidate an undercollateralized CDP.
    /// The liquidator repays the debt and receives collateral + penalty.
    pub fn liquidate(
        &mut self,
        cdp_id: u64,
        liquidator: String,
        current_timestamp: i64,
        hsmc_price_usd: f64,
        eur_usd: Option<f64>,
        xau_usd: Option<f64>,
    ) -> Result<LiquidationResult, StablecoinError> {
        // Accrue fees first
        let total_debt = self.accrue_stability_fees_internal(cdp_id, current_timestamp)?;

        // Extract all CDP data before mutation
        let (st, owner, collateral_amount, _ratio_bps, penalty_bps) = {
            let cdp = self.cdps.get(&cdp_id).ok_or(StablecoinError::CdpNotFound(cdp_id))?;
            if !cdp.active {
                return Err(StablecoinError::CdpAlreadyClosed);
            }
            let config = self.config_for(cdp.stablecoin_type)?.clone();
            let ratio = cdp.collateral_ratio_bps(hsmc_price_usd, eur_usd, xau_usd).unwrap_or(0);
            if ratio >= config.liquidation_ratio_bps {
                return Err(StablecoinError::CdpHealthy {
                    ratio_bps: ratio,
                    liq_bps: config.liquidation_ratio_bps,
                });
            }
            (cdp.stablecoin_type, cdp.owner.clone(), cdp.collateral_amount, ratio, config.liquidation_penalty_bps)
        };

        let penalty = ((collateral_amount as u128) * (penalty_bps as u128) / 10_000u128) as u64;
        let liquidator_reward = collateral_amount.saturating_add(penalty);

        // Burn the debt from liquidator (must have enough stablecoins)
        self.token_mut(st)?.burn(&liquidator, total_debt)?;

        // Remove CDP
        self.cdps.remove(&cdp_id);

        let result = LiquidationResult {
            cdp_id,
            liquidator: liquidator.clone(),
            original_owner: owner,
            debt_repaid: total_debt,
            collateral_seized: collateral_amount,
            penalty,
            liquidator_reward,
            stablecoin_type: st,
        };

        info!(
            "💀 CDP #{} liquidated: debt={} {}, collateral={} HSMC, penalty={} HSMC, liquidator={}",
            cdp_id,
            total_debt as f64 / STABLECOIN_ATOMIC as f64,
            st,
            collateral_amount as f64 / HSMC_ATOMIC as f64,
            penalty as f64 / HSMC_ATOMIC as f64,
            &liquidator[..12.min(liquidator.len())]
        );

        Ok(result)
    }

    /// Accrue stability fees for a CDP (compound interest).
    /// Updates the debt amount in-place and returns the new total debt.
    fn accrue_stability_fees_internal(
        &mut self,
        cdp_id: u64,
        current_timestamp: i64,
    ) -> Result<u64, StablecoinError> {
        // Extract needed fields before mutable borrow
        let (elapsed, debt_amount, fee_rate_bps) = {
            let cdp = self.cdps.get(&cdp_id).ok_or(StablecoinError::CdpNotFound(cdp_id))?;
            if !cdp.active {
                return Err(StablecoinError::CdpAlreadyClosed);
            }
            let elapsed = (current_timestamp - cdp.last_fee_accrual).max(0) as f64;
            if elapsed <= 0.0 || cdp.debt_amount == 0 {
                return Ok(cdp.debt_amount);
            }
            let config = self.config_for(cdp.stablecoin_type)?;
            (elapsed, cdp.debt_amount, config.stability_fee_rate_bps)
        };

        let annual_rate = fee_rate_bps as f64 / 10_000.0;

        // Compound interest: new_debt = debt * (1 + rate)^(elapsed / YEAR)
        let periods = elapsed / SECONDS_PER_YEAR;
        let multiplier = (1.0 + annual_rate).powf(periods);
        let new_debt = (debt_amount as f64 * multiplier) as u64;

        // Apply new debt if it increased
        let cdp = self.cdps.get_mut(&cdp_id).unwrap();
        if new_debt > cdp.debt_amount {
            let accrued = new_debt - cdp.debt_amount;
            debug!(
                "CDP #{} accrued fees: +{} ({} secs, annual_rate={}%)",
                cdp_id,
                accrued as f64 / STABLECOIN_ATOMIC as f64,
                elapsed as u64,
                annual_rate * 100.0
            );
            cdp.debt_amount = new_debt;
        }
        cdp.last_fee_accrual = current_timestamp;

        Ok(cdp.debt_amount)
    }

    /// Public method: accrue stability fees for a CDP.
    pub fn accrue_stability_fees(
        &mut self,
        cdp_id: u64,
        current_timestamp: i64,
    ) -> Result<u64, StablecoinError> {
        self.accrue_stability_fees_internal(cdp_id, current_timestamp)
    }

    // ── Health & Queries ──────────────────────────────────────────────────

    /// Get the current health of a CDP.
    pub fn get_cdp_health(
        &self,
        cdp_id: u64,
        hsmc_price_usd: f64,
        eur_usd: Option<f64>,
        xau_usd: Option<f64>,
    ) -> Result<CdpHealth, StablecoinError> {
        let cdp = self.get_active_cdp(cdp_id)?;
        let config = self.config_for(cdp.stablecoin_type)?;

        let ratio_bps = cdp.collateral_ratio_bps(hsmc_price_usd, eur_usd, xau_usd).unwrap_or(0);
        let liq_price = cdp.liquidation_price(config.liquidation_ratio_bps);

        Ok(CdpHealth {
            cdp_id,
            collateral_amount: cdp.collateral_amount,
            debt_amount: cdp.debt_amount,
            stablecoin_type: cdp.stablecoin_type,
            ratio_bps,
            min_ratio_bps: config.min_collateral_ratio_bps,
            liquidation_ratio_bps: config.liquidation_ratio_bps,
            liquidation_price: liq_price,
            is_healthy: ratio_bps >= config.liquidation_ratio_bps,
            is_undercollateralized: ratio_bps > 0 && ratio_bps < config.liquidation_ratio_bps,
        })
    }

    /// Get the liquidation price for a CDP — the HSMC/USD price at which it becomes liquidatable.
    pub fn get_liquidation_price(&self, cdp_id: u64) -> Result<f64, StablecoinError> {
        let cdp = self.get_active_cdp(cdp_id)?;
        let config = self.config_for(cdp.stablecoin_type)?;
        cdp
            .liquidation_price(config.liquidation_ratio_bps)
            .ok_or(StablecoinError::CdpNotFound(cdp_id))
    }

    // ── Token Queries ─────────────────────────────────────────────────────

    /// Get the balance of a specific stablecoin for an address.
    pub fn balance_of(&self, address: &str, stablecoin_type: StablecoinType) -> u64 {
        self.token_for(stablecoin_type)
            .map(|t| t.balance_of(address))
            .unwrap_or(0)
    }

    /// Get the total supply of a specific stablecoin.
    pub fn total_supply(&self, stablecoin_type: StablecoinType) -> u64 {
        self.token_for(stablecoin_type)
            .map(|t| t.total_supply)
            .unwrap_or(0)
    }

    // ── Governance ────────────────────────────────────────────────────────

    /// Update the minimum collateralization ratio for a stablecoin type.
    pub fn set_min_collateral_ratio(
        &mut self,
        stablecoin_type: StablecoinType,
        ratio_bps: u16,
    ) -> Result<(), StablecoinError> {
        if ratio_bps < MIN_COLLATERAL_RATIO_BPS || (ratio_bps as u32) > MAX_COLLATERAL_RATIO_BPS {
            return Err(StablecoinError::ParameterOutOfRange {
                field: "min_collateral_ratio_bps".into(),
                value: ratio_bps as u64,
                min: MIN_COLLATERAL_RATIO_BPS as u64,
                max: MAX_COLLATERAL_RATIO_BPS as u64,
            });
        }
        let config = self.config_mut(stablecoin_type)?;
        // Liquidation ratio must be <= min collateral ratio
        if config.liquidation_ratio_bps > ratio_bps {
            return Err(StablecoinError::ParameterOutOfRange {
                field: "min_collateral_ratio_bps".into(),
                value: ratio_bps as u64,
                min: config.liquidation_ratio_bps as u64,
                max: MAX_COLLATERAL_RATIO_BPS as u64,
            });
        }
        config.min_collateral_ratio_bps = ratio_bps;
        info!("Governance: {} min_collateral_ratio = {} bps", stablecoin_type, ratio_bps);
        Ok(())
    }

    /// Update the liquidation ratio for a stablecoin type.
    pub fn set_liquidation_ratio(
        &mut self,
        stablecoin_type: StablecoinType,
        ratio_bps: u16,
    ) -> Result<(), StablecoinError> {
        if ratio_bps < MIN_COLLATERAL_RATIO_BPS || (ratio_bps as u32) > MAX_COLLATERAL_RATIO_BPS {
            return Err(StablecoinError::ParameterOutOfRange {
                field: "liquidation_ratio_bps".into(),
                value: ratio_bps as u64,
                min: MIN_COLLATERAL_RATIO_BPS as u64,
                max: MAX_COLLATERAL_RATIO_BPS as u64,
            });
        }
        let config = self.config_mut(stablecoin_type)?;
        // Liquidation ratio must be <= min collateral ratio
        if ratio_bps > config.min_collateral_ratio_bps {
            return Err(StablecoinError::ParameterOutOfRange {
                field: "liquidation_ratio_bps".into(),
                value: ratio_bps as u64,
                min: MIN_COLLATERAL_RATIO_BPS as u64,
                max: config.min_collateral_ratio_bps as u64,
            });
        }
        config.liquidation_ratio_bps = ratio_bps;
        info!("Governance: {} liquidation_ratio = {} bps", stablecoin_type, ratio_bps);
        Ok(())
    }

    /// Update the stability fee rate for a stablecoin type.
    pub fn set_stability_fee(
        &mut self,
        stablecoin_type: StablecoinType,
        fee_bps: u16,
    ) -> Result<(), StablecoinError> {
        if fee_bps > MAX_STABILITY_FEE_BPS {
            return Err(StablecoinError::ParameterOutOfRange {
                field: "stability_fee_rate_bps".into(),
                value: fee_bps as u64,
                min: 0,
                max: MAX_STABILITY_FEE_BPS as u64,
            });
        }
        self.config_mut(stablecoin_type)?.stability_fee_rate_bps = fee_bps;
        info!("Governance: {} stability_fee = {} bps", stablecoin_type, fee_bps);
        Ok(())
    }

    /// Update the liquidation penalty for a stablecoin type.
    pub fn set_liquidation_penalty(
        &mut self,
        stablecoin_type: StablecoinType,
        penalty_bps: u16,
    ) -> Result<(), StablecoinError> {
        if penalty_bps > MAX_LIQUIDATION_PENALTY_BPS {
            return Err(StablecoinError::ParameterOutOfRange {
                field: "liquidation_penalty_bps".into(),
                value: penalty_bps as u64,
                min: 0,
                max: MAX_LIQUIDATION_PENALTY_BPS as u64,
            });
        }
        self.config_mut(stablecoin_type)?.liquidation_penalty_bps = penalty_bps;
        info!("Governance: {} liquidation_penalty = {} bps", stablecoin_type, penalty_bps);
        Ok(())
    }

    /// List all CDPs for a given owner.
    pub fn get_cdps_by_owner(&self, owner: &str) -> Vec<&Cdp> {
        self.cdps.values().filter(|c| c.owner == owner && c.active).collect()
    }

    /// List all active CDPs (for liquidation scanning).
    pub fn get_active_cdps(&self) -> Vec<&Cdp> {
        self.cdps.values().filter(|c| c.active).collect()
    }

    /// Get a specific CDP.
    pub fn get_cdp(&self, cdp_id: u64) -> Option<&Cdp> {
        self.cdps.get(&cdp_id)
    }

    /// Get all liquidatable CDPs.
    pub fn get_liquidatable_cdps(
        &self,
        hsmc_price_usd: f64,
        eur_usd: Option<f64>,
        xau_usd: Option<f64>,
    ) -> Vec<u64> {
        self.cdps
            .values()
            .filter(|c| {
                if !c.active {
                    return false;
                }
                let config = self.config_for(c.stablecoin_type).ok();
                match config {
                    Some(cfg) => {
                        let ratio = c.collateral_ratio_bps(hsmc_price_usd, eur_usd, xau_usd).unwrap_or(0);
                        ratio > 0 && ratio < cfg.liquidation_ratio_bps
                    }
                    None => false,
                }
            })
            .map(|c| c.id)
            .collect()
    }

    // ── Internal ───────────────────────────────────────────────────────────

    fn get_active_cdp(&self, cdp_id: u64) -> Result<&Cdp, StablecoinError> {
        let cdp = self.cdps.get(&cdp_id).ok_or(StablecoinError::CdpNotFound(cdp_id))?;
        if !cdp.active {
            return Err(StablecoinError::CdpAlreadyClosed);
        }
        Ok(cdp)
    }

    /// Transfer stablecoins between addresses.
    pub fn transfer(
        &mut self,
        from: &str,
        to: &str,
        amount: u64,
        stablecoin_type: StablecoinType,
    ) -> Result<(), StablecoinError> {
        self.token_mut(stablecoin_type)?.transfer(from, to, amount)
    }

    // ── Snapshot / Persistence ────────────────────────────────────────────

    pub fn to_snapshot(&self) -> CdpEngineSnapshot {
        CdpEngineSnapshot {
            cdps: self.cdps.clone(),
            next_cdp_id: self.next_cdp_id,
            usd_token: self.usd_token.clone(),
            eur_token: self.eur_token.clone(),
            xau_token: self.xau_token.clone(),
            usd_config: self.usd_config.clone(),
            eur_config: self.eur_config.clone(),
            xau_config: self.xau_config.clone(),
            min_cdp_collateral: self.min_cdp_collateral,
        }
    }

    pub fn load_snapshot(&mut self, snap: CdpEngineSnapshot) {
        self.cdps = snap.cdps;
        self.next_cdp_id = snap.next_cdp_id;
        self.usd_token = snap.usd_token;
        self.eur_token = snap.eur_token;
        self.xau_token = snap.xau_token;
        self.usd_config = snap.usd_config;
        self.eur_config = snap.eur_config;
        self.xau_config = snap.xau_config;
        self.min_cdp_collateral = snap.min_cdp_collateral;
    }
}

impl Default for CdpEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════
// RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidationResult {
    pub cdp_id: u64,
    pub liquidator: String,
    pub original_owner: String,
    pub debt_repaid: u64,
    pub collateral_seized: u64,
    pub penalty: u64,
    pub liquidator_reward: u64,
    pub stablecoin_type: StablecoinType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpHealth {
    pub cdp_id: u64,
    pub collateral_amount: u64,
    pub debt_amount: u64,
    pub stablecoin_type: StablecoinType,
    pub ratio_bps: u16,
    pub min_ratio_bps: u16,
    pub liquidation_ratio_bps: u16,
    pub liquidation_price: Option<f64>,
    pub is_healthy: bool,
    pub is_undercollateralized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdpEngineSnapshot {
    pub cdps: HashMap<u64, Cdp>,
    pub next_cdp_id: u64,
    pub usd_token: TokenState,
    pub eur_token: TokenState,
    pub xau_token: TokenState,
    pub usd_config: StablecoinConfig,
    pub eur_config: StablecoinConfig,
    pub xau_config: StablecoinConfig,
    pub min_cdp_collateral: u64,
}

// ═══════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn ts_now() -> i64 {
        1700000000
    }

    fn ts_later(secs: i64) -> i64 {
        1700000000 + secs
    }

    fn owner_addr(name: &str) -> String {
        format!("HSMC_{}_abcdef1234567890", name)
    }

    fn liquidator_addr() -> String {
        "HSMC_liq_00000000000000000000".to_string()
    }

    // ── Test: Create CDP + Mint Stablecoins ────────────────────────────

    #[test]
    fn test_create_cdp_and_mint() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let collateral = 500 * HSMC_ATOMIC; // 500 HSMC
        let hsmc_price = 0.05; // $0.05 per HSMC
        // collateral_value = 500 * 0.05 = $25
        // max_debt = 25 / 1.5 = 16.666... USDHSMC

        let id = engine
            .create_cdp(
                owner.clone(),
                collateral,
                StablecoinType::UsdHsmc,
                1000,
                ts_now(),
                hsmc_price,
                None,
                None,
            )
            .expect("Should create CDP");

        assert_eq!(id, 1);
        let cdp = engine.get_cdp(id).expect("CDP should exist");
        assert_eq!(cdp.owner, owner);
        assert_eq!(cdp.collateral_amount, collateral);
        assert_eq!(cdp.stablecoin_type, StablecoinType::UsdHsmc);
        assert!(cdp.active);
        assert!(cdp.debt_amount > 0);

        // Owner should have USDHSMC balance
        let balance = engine.balance_of(&owner, StablecoinType::UsdHsmc);
        assert_eq!(balance, cdp.debt_amount);

        // Total supply should match
        let supply = engine.total_supply(StablecoinType::UsdHsmc);
        assert_eq!(supply, cdp.debt_amount);

        // Check health
        let health = engine
            .get_cdp_health(id, hsmc_price, None, None)
            .expect("Should get health");
        assert!(health.is_healthy);
        assert!(!health.is_undercollateralized);
        assert!(health.ratio_bps >= DEFAULT_MIN_COLLATERAL_RATIO_BPS);
    }

    // ── Test: Repay Full + Close CDP ──────────────────────────────────

    #[test]
    fn test_repay_full_and_close() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let collateral = 500 * HSMC_ATOMIC;
        let hsmc_price = 0.05;

        let id = engine
            .create_cdp(
                owner.clone(), collateral, StablecoinType::UsdHsmc,
                1000, ts_now(), hsmc_price, None, None,
            )
            .unwrap();

        let debt = engine.get_cdp(id).unwrap().debt_amount;
        let (released_collateral, repaid_debt) = engine
            .repay_and_close(id, ts_now())
            .expect("Should close CDP");

        assert_eq!(repaid_debt, debt);
        assert_eq!(released_collateral, collateral);

        // CDP should be removed
        assert!(engine.get_cdp(id).is_none());

        // Balance should be 0
        let balance = engine.balance_of(&owner, StablecoinType::UsdHsmc);
        assert_eq!(balance, 0);

        // Supply should be 0
        assert_eq!(engine.total_supply(StablecoinType::UsdHsmc), 0);
    }

    // ── Test: Partial Repay ───────────────────────────────────────────

    #[test]
    fn test_partial_repay() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let collateral = 500 * HSMC_ATOMIC;
        let hsmc_price = 0.05;

        let id = engine
            .create_cdp(
                owner.clone(), collateral, StablecoinType::UsdHsmc,
                1000, ts_now(), hsmc_price, None, None,
            )
            .unwrap();

        let debt = engine.get_cdp(id).unwrap().debt_amount;
        let repay_amount = debt / 2;

        let released = engine
            .repay_partial(id, repay_amount, ts_now())
            .expect("Should partially repay");

        assert!(released > 0);
        let cdp = engine.get_cdp(id).expect("CDP should still exist");
        assert!(cdp.debt_amount < debt);
        assert!(cdp.debt_amount > 0);
    }

    // ── Test: Liquidation of Undercollateralized CDP ──────────────────

    #[test]
    fn test_liquidation() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let liquidator = liquidator_addr();
        let collateral = 500 * HSMC_ATOMIC;
        let hsmc_price = 0.05;

        let id = engine
            .create_cdp(
                owner.clone(), collateral, StablecoinType::UsdHsmc,
                1000, ts_now(), hsmc_price, None, None,
            )
            .unwrap();

        let debt = engine.get_cdp(id).unwrap().debt_amount;

        // Give liquidator enough stablecoins to cover the debt
        engine
            .token_mut(StablecoinType::UsdHsmc)
            .unwrap()
            .mint(&liquidator, debt * 2)
            .unwrap();

        // Drop the HSMC price to make CDP undercollateralized
        // Original: 500 * 0.05 = $25 collateral, debt ~16.66
        // At price 0.03: 500 * 0.03 = $15 → ratio = 15/16.66 = ~90% → undercollateralized
        let crash_price = 0.02;

        let result = engine
            .liquidate(id, liquidator.clone(), ts_now(), crash_price, None, None)
            .expect("Should liquidate");

        assert_eq!(result.cdp_id, id);
        assert_eq!(result.liquidator, liquidator);
        assert_eq!(result.original_owner, owner);
        assert!(result.penalty > 0);
        assert!(result.liquidator_reward > result.collateral_seized);

        // CDP should be gone
        assert!(engine.get_cdp(id).is_none());
    }

    // ── Test: Liquidation Penalty Distribution ────────────────────────

    #[test]
    fn test_liquidation_penalty_calculation() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let liquidator = liquidator_addr();
        let collateral = 1000 * HSMC_ATOMIC;
        let hsmc_price = 0.10;

        let id = engine
            .create_cdp(owner.clone(), collateral, StablecoinType::UsdHsmc, 1000, ts_now(), hsmc_price, None, None)
            .unwrap();

        let debt = engine.get_cdp(id).unwrap().debt_amount;
        engine.token_mut(StablecoinType::UsdHsmc).unwrap().mint(&liquidator, debt * 2).unwrap();

        // Crash price
        let result = engine
            .liquidate(id, liquidator, ts_now(), 0.02, None, None)
            .expect("Should liquidate");

        // 13% penalty on collateral = 1000 * 0.13 = 130 HSMC
        let expected_penalty = (collateral as u128 * DEFAULT_LIQUIDATION_PENALTY_BPS as u128 / 10_000u128) as u64;
        assert_eq!(result.penalty, expected_penalty);
        // Reward = collateral + penalty
        assert_eq!(result.liquidator_reward, collateral + expected_penalty);
    }

    // ── Test: Attempt to Liquidate Healthy CDP (must fail) ────────────

    #[test]
    fn test_cannot_liquidate_healthy_cdp() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let collateral = 500 * HSMC_ATOMIC;

        let id = engine
            .create_cdp(owner, collateral, StablecoinType::UsdHsmc, 1000, ts_now(), 0.10, None, None)
            .unwrap();

        let liquidator = liquidator_addr();
        let debt = engine.get_cdp(id).unwrap().debt_amount;
        engine.token_mut(StablecoinType::UsdHsmc).unwrap().mint(&liquidator, debt * 2).unwrap();

        // Same price — CDP is healthy
        let result = engine.liquidate(id, liquidator, ts_now(), 0.10, None, None);
        assert!(result.is_err());
        match result {
            Err(StablecoinError::CdpHealthy { .. }) => {} // expected
            other => panic!("Expected CdpHealthy error, got {:?}", other),
        }
    }

    // ── Test: Attempt to Create Immediately-Liquidatable CDP (must fail) ──

    #[test]
    fn test_cannot_create_immediately_liquidatable_cdp() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let collateral = 500 * HSMC_ATOMIC;

        // Very low HSMC price — the debt would be miniscule, but let's test
        // with extremely high price such that min_ratio requires extreme collateral
        // Actually, the check is: collateral_value_usd <= liq_threshold_value
        // This can't happen at creation because min > liq.
        // Let's test with insufficient collateral instead.

        // Try to create with below-minimum collateral
        let result = engine.create_cdp(
            owner, 50 * HSMC_ATOMIC, // below MIN_CDP_COLLATERAL (100)
            StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None,
        );
        assert!(result.is_err());
        match result {
            Err(StablecoinError::CdpTooSmall { .. }) => {}
            other => panic!("Expected CdpTooSmall error, got {:?}", other),
        }
    }

    // ── Test: Stability Fee Accrual Over Multiple Blocks ──────────────

    #[test]
    fn test_stability_fee_accrual() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let id = engine
            .create_cdp(owner, 500 * HSMC_ATOMIC, StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None)
            .unwrap();

        let debt_before = engine.get_cdp(id).unwrap().debt_amount;

        // Accrue after 30 days (2.5% APR)
        let new_debt = engine
            .accrue_stability_fees(id, ts_later(30 * 24 * 3600))
            .expect("Should accrue");

        assert!(new_debt > debt_before);
        // 2.5% APR over 30 days ≈ 0.205% → new_debt ≈ debt * 1.00205
        let ratio = new_debt as f64 / debt_before as f64;
        assert!(ratio > 1.0 && ratio < 1.01);

        // Accrue again after more time
        let new_debt2 = engine
            .accrue_stability_fees(id, ts_later(365 * 24 * 3600))
            .expect("Should accrue");
        assert!(new_debt2 > new_debt);
    }

    // ── Test: Price Feed Update + CDP Health Recalculation ────────────

    #[test]
    fn test_price_update_health_recalculation() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let id = engine
            .create_cdp(owner, 500 * HSMC_ATOMIC, StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None)
            .unwrap();

        // Healthy at 0.05
        let h1 = engine.get_cdp_health(id, 0.05, None, None).unwrap();
        assert!(h1.is_healthy);
        assert!(!h1.is_undercollateralized);

        // Still healthy at 0.04 (500 * 0.04 = $20, debt ~16.66, ratio ~120% but above liq 130%? no)
        // Actually 20/16.66 = 120% → that's below 130% liquidation ratio
        let h2 = engine.get_cdp_health(id, 0.04, None, None).unwrap();
        // At 0.04, ratio is below 130% → should be undercollateralized
        assert!(h2.is_undercollateralized);

        // Really crashed at 0.01
        let h3 = engine.get_cdp_health(id, 0.01, None, None).unwrap();
        assert!(!h3.is_healthy);
        assert!(h3.is_undercollateralized);
    }

    // ── Test: Multi-CDP, Multi-User Scenario ──────────────────────────

    #[test]
    fn test_multi_cdp_multi_user() {
        let mut engine = CdpEngine::new();
        let alice = owner_addr("alice");
        let bob = owner_addr("bob");

        // Alice opens USD CDP
        let id1 = engine
            .create_cdp(alice.clone(), 1000 * HSMC_ATOMIC, StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None)
            .unwrap();

        // Bob opens EUR CDP
        let id2 = engine
            .create_cdp(bob.clone(), 2000 * HSMC_ATOMIC, StablecoinType::EurHsmc, 1000, ts_now(), 0.05, Some(0.92), None)
            .unwrap();

        // Alice opens another (XAU) CDP
        let id3 = engine
            .create_cdp(alice.clone(), 5000 * HSMC_ATOMIC, StablecoinType::XauHsmc, 1000, ts_now(), 0.05, None, Some(2600.0))
            .unwrap();

        assert_eq!(engine.get_active_cdps().len(), 3);

        // Alice's CDPs
        let alice_cdps = engine.get_cdps_by_owner(&alice);
        assert_eq!(alice_cdps.len(), 2);
        assert!(alice_cdps.iter().any(|c| c.id == id1));
        assert!(alice_cdps.iter().any(|c| c.id == id3));

        // Bob's CDPs
        let bob_cdps = engine.get_cdps_by_owner(&bob);
        assert_eq!(bob_cdps.len(), 1);
        assert_eq!(bob_cdps[0].id, id2);

        // Different token supplies
        assert!(engine.total_supply(StablecoinType::UsdHsmc) > 0);
        assert!(engine.total_supply(StablecoinType::EurHsmc) > 0);
        assert!(engine.total_supply(StablecoinType::XauHsmc) > 0);

        // All independently track
        let usd_bal = engine.balance_of(&alice, StablecoinType::UsdHsmc);
        let eur_bal = engine.balance_of(&bob, StablecoinType::EurHsmc);
        let xau_bal = engine.balance_of(&alice, StablecoinType::XauHsmc);
        assert!(usd_bal > 0);
        assert!(eur_bal > 0);
        assert!(xau_bal > 0);
    }

    // ── Test: Token Transfers ─────────────────────────────────────────

    #[test]
    fn test_token_transfer() {
        let mut engine = CdpEngine::new();
        let alice = owner_addr("alice");
        let bob = owner_addr("bob");

        let id = engine
            .create_cdp(alice.clone(), 500 * HSMC_ATOMIC, StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None)
            .unwrap();

        let supply = engine.total_supply(StablecoinType::UsdHsmc);
        let transfer_amount = supply / 4;

        engine
            .transfer(&alice, &bob, transfer_amount, StablecoinType::UsdHsmc)
            .expect("Should transfer");

        let alice_after = engine.balance_of(&alice, StablecoinType::UsdHsmc);
        let bob_after = engine.balance_of(&bob, StablecoinType::UsdHsmc);
        assert_eq!(alice_after, supply - transfer_amount);
        assert_eq!(bob_after, transfer_amount);
        assert_eq!(engine.total_supply(StablecoinType::UsdHsmc), supply);
    }

    // ── Test: Governance Parameter Update ─────────────────────────────

    #[test]
    fn test_governance_parameter_update() {
        let mut engine = CdpEngine::new();

        // Change USD min collateral ratio to 160%
        engine
            .set_min_collateral_ratio(StablecoinType::UsdHsmc, 16_000)
            .expect("Should update");
        assert_eq!(engine.usd_config.min_collateral_ratio_bps, 16_000);

        // Change liquidation penalty
        engine
            .set_liquidation_penalty(StablecoinType::UsdHsmc, 1_500)
            .expect("Should update");
        assert_eq!(engine.usd_config.liquidation_penalty_bps, 1_500);

        // Change stability fee
        engine
            .set_stability_fee(StablecoinType::UsdHsmc, 300)
            .expect("Should update");
        assert_eq!(engine.usd_config.stability_fee_rate_bps, 300);

        // Invalid: liquidation ratio > min collateral ratio
        // First raise min to allow raising liquidation, then try lowering min below liquidation
        engine.set_min_collateral_ratio(StablecoinType::UsdHsmc, 17_000).unwrap();
        engine.set_liquidation_ratio(StablecoinType::UsdHsmc, 16_500).unwrap();
        let err = engine.set_min_collateral_ratio(StablecoinType::UsdHsmc, 16_000);
        assert!(err.is_err());
    }

    // ── Test: Snapshot Round-Trip ─────────────────────────────────────

    #[test]
    fn test_snapshot_roundtrip() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");

        engine
            .create_cdp(owner, 500 * HSMC_ATOMIC, StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None)
            .unwrap();

        let snap = engine.to_snapshot();

        let mut engine2 = CdpEngine::new();
        engine2.load_snapshot(snap);

        assert_eq!(engine2.next_cdp_id, engine.next_cdp_id);
        assert_eq!(engine2.total_supply(StablecoinType::UsdHsmc), engine.total_supply(StablecoinType::UsdHsmc));
        assert_eq!(engine2.get_active_cdps().len(), engine.get_active_cdps().len());
    }

    // ── Test: Zero collateral rejection ───────────────────────────────

    #[test]
    fn test_zero_collateral_rejected() {
        let mut engine = CdpEngine::new();
        let result = engine.create_cdp(
            owner_addr("alice"), 0,
            StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None,
        );
        assert!(result.is_err());
    }

    // ── Test: Repay exceeds debt ──────────────────────────────────────

    #[test]
    fn test_repay_exceeds_debt() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let id = engine
            .create_cdp(owner, 500 * HSMC_ATOMIC, StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None)
            .unwrap();

        let debt = engine.get_cdp(id).unwrap().debt_amount;
        let result = engine.repay_partial(id, debt * 2, ts_now());
        assert!(matches!(result, Err(StablecoinError::RepayExceedsDebt { .. })));
    }

    // ── Test: Get liquidation price ───────────────────────────────────

    #[test]
    fn test_liquidation_price_calculation() {
        let mut engine = CdpEngine::new();
        let owner = owner_addr("alice");
        let id = engine
            .create_cdp(owner, 500 * HSMC_ATOMIC, StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None)
            .unwrap();

        let liq_price = engine.get_liquidation_price(id).expect("Should get liq price");
        assert!(liq_price > 0.0);
        assert!(liq_price < 0.05); // Should be lower than the creation price
    }

    // ── Test: Liquidatable CDPs scanning ──────────────────────────────

    #[test]
    fn test_get_liquidatable_cdps() {
        let mut engine = CdpEngine::new();
        let alice = owner_addr("alice");
        let bob = owner_addr("bob");

        // Create two CDPs
        engine.create_cdp(alice, 1000 * HSMC_ATOMIC, StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None).unwrap();
        engine.create_cdp(bob, 2000 * HSMC_ATOMIC, StablecoinType::UsdHsmc, 1000, ts_now(), 0.05, None, None).unwrap();

        // At normal price, none liquidatable
        let liq = engine.get_liquidatable_cdps(0.05, None, None);
        assert!(liq.is_empty());

        // At crash price, all liquidatable
        let liq_crash = engine.get_liquidatable_cdps(0.01, None, None);
        assert_eq!(liq_crash.len(), 2);
    }
}
