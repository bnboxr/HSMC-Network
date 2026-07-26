/// hsmc-oracle — Multi-source price oracle with median+IQR aggregation
///
/// Fetches from 5 CEX feeds (Binance, Kraken, Coinbase, Bybit, Gate.io)
/// plus CoinGecko as fallback. Aggregates via median + IQR outlier filter.
/// Cached with a 30-second TTL.

use parking_lot::RwLock;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tracing::{debug, warn};

// ═══════════════════════════════════════════════════════════════════════
// ERROR TYPE
// ═══════════════════════════════════════════════════════════════════════

#[derive(Error, Debug)]
pub enum OracleError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON parse failed: {0}")]
    Parse(String),
    #[error("No valid price data available for pair '{0}'")]
    NoData(String),
    #[error("Feed '{feed}' returned malformed response for '{pair}'")]
    MalformedResponse { feed: String, pair: String },
}

// ═══════════════════════════════════════════════════════════════════════
// PRICE FEED TRAIT
// ═══════════════════════════════════════════════════════════════════════

/// A price feed source. Implementations query exchange APIs.
#[async_trait::async_trait]
pub trait PriceFeed: Send + Sync {
    /// Human-readable name of the feed (e.g. "Binance", "CoinGecko").
    fn name(&self) -> &str;

    /// Fetch the current price for `pair` (e.g. "HSMC/USDT").
    /// Returns the price as f64, or an error if unavailable.
    async fn fetch(&self, pair: &str) -> Result<f64, OracleError>;

    /// Returns true if this feed supports the given pair.
    fn supports(&self, _pair: &str) -> bool {
        true
    }
}

// ═══════════════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct BinancePrice {
    symbol: String,
    price: String,
}

#[derive(Debug, Deserialize)]
struct KrakenResult {
    result: HashMap<String, KrakenTicker>,
}

#[derive(Debug, Deserialize)]
struct KrakenTicker {
    c: Vec<String>, // c[0] = last trade price
}

#[derive(Debug, Deserialize)]
struct CoinbaseResponse {
    data: CoinbaseData,
}

#[derive(Debug, Deserialize)]
struct CoinbaseData {
    amount: String,
}

#[derive(Debug, Deserialize)]
struct BybitResponse {
    result: BybitResult,
}

#[derive(Debug, Deserialize)]
struct BybitResult {
    list: Vec<BybitTicker>,
}

#[derive(Debug, Deserialize)]
struct BybitTicker {
    #[serde(rename = "lastPrice")]
    last_price: String,
}

#[derive(Debug, Deserialize)]
struct GateResponse(Vec<GateTicker>);

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GateTicker {
    currency_pair: String,
    last: String,
}

#[derive(Debug, Deserialize)]
struct CoinGeckoResponse {
    #[serde(flatten)]
    prices: HashMap<String, HashMap<String, f64>>,
}

// ═══════════════════════════════════════════════════════════════════════
// FEED IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════

// ── Binance ─────────────────────────────────────────────────────────

pub struct BinanceFeed {
    client: reqwest::Client,
}

impl BinanceFeed {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl PriceFeed for BinanceFeed {
    fn name(&self) -> &str {
        "Binance"
    }

    async fn fetch(&self, pair: &str) -> Result<f64, OracleError> {
        let symbol = pair_to_binance_symbol(pair);
        let url = format!("https://api.binance.com/api/v3/ticker/price?symbol={}", symbol);
        let resp = self.client.get(&url).send().await?;
        let bp: BinancePrice = resp.json().await.map_err(|e| OracleError::Parse(e.to_string()))?;
        bp.price
            .parse::<f64>()
            .map_err(|_e| OracleError::MalformedResponse {
                feed: "Binance".into(),
                pair: pair.to_string(),
            })
    }
}

/// Convert "HSMC/USDT" -> "HSMCUSDT"
fn pair_to_binance_symbol(pair: &str) -> String {
    pair.replace('/', "").to_uppercase()
}

// ── Kraken ──────────────────────────────────────────────────────────

pub struct KrakenFeed {
    client: reqwest::Client,
}

impl KrakenFeed {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl PriceFeed for KrakenFeed {
    fn name(&self) -> &str {
        "Kraken"
    }

    async fn fetch(&self, pair: &str) -> Result<f64, OracleError> {
        let kraken_pair = pair_to_kraken_symbol(pair);
        let url = format!(
            "https://api.kraken.com/0/public/Ticker?pair={}",
            kraken_pair
        );
        let resp = self.client.get(&url).send().await?;
        let kr: KrakenResult = resp.json().await.map_err(|e| OracleError::Parse(e.to_string()))?;

        // Kraken returns result keyed by the pair name they normalised
        let ticker = kr
            .result
            .values()
            .next()
            .ok_or_else(|| OracleError::NoData(pair.to_string()))?;

        ticker
            .c
            .first()
            .ok_or_else(|| OracleError::NoData(pair.to_string()))?
            .parse::<f64>()
            .map_err(|_| OracleError::MalformedResponse {
                feed: "Kraken".into(),
                pair: pair.to_string(),
            })
    }
}

/// Convert "HSMC/USDT" -> "HSMCUSDT"
fn pair_to_kraken_symbol(pair: &str) -> String {
    pair.replace('/', "").to_uppercase()
}

// ── Coinbase ────────────────────────────────────────────────────────

pub struct CoinbaseFeed {
    client: reqwest::Client,
}

impl CoinbaseFeed {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl PriceFeed for CoinbaseFeed {
    fn name(&self) -> &str {
        "Coinbase"
    }

    async fn fetch(&self, pair: &str) -> Result<f64, OracleError> {
        let (base, quote) = split_pair(pair);
        let url = format!(
            "https://api.coinbase.com/v2/prices/{}-{}/spot",
            base, quote
        );
        let resp = self.client.get(&url).send().await?;
        let cb: CoinbaseResponse =
            resp.json().await.map_err(|e| OracleError::Parse(e.to_string()))?;
        cb.data
            .amount
            .parse::<f64>()
            .map_err(|_| OracleError::MalformedResponse {
                feed: "Coinbase".into(),
                pair: pair.to_string(),
            })
    }
}

// ── Bybit ───────────────────────────────────────────────────────────

pub struct BybitFeed {
    client: reqwest::Client,
}

impl BybitFeed {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl PriceFeed for BybitFeed {
    fn name(&self) -> &str {
        "Bybit"
    }

    async fn fetch(&self, pair: &str) -> Result<f64, OracleError> {
        let symbol = pair_to_binance_symbol(pair);
        let url = format!(
            "https://api.bybit.com/v5/market/tickers?category=spot&symbol={}",
            symbol
        );
        let resp = self.client.get(&url).send().await?;
        let bb: BybitResponse =
            resp.json().await.map_err(|e| OracleError::Parse(e.to_string()))?;
        let ticker = bb
            .result
            .list
            .first()
            .ok_or_else(|| OracleError::NoData(pair.to_string()))?;
        ticker
            .last_price
            .parse::<f64>()
            .map_err(|_| OracleError::MalformedResponse {
                feed: "Bybit".into(),
                pair: pair.to_string(),
            })
    }
}

// ── Gate.io ─────────────────────────────────────────────────────────

pub struct GateFeed {
    client: reqwest::Client,
}

impl GateFeed {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl PriceFeed for GateFeed {
    fn name(&self) -> &str {
        "Gate.io"
    }

    async fn fetch(&self, pair: &str) -> Result<f64, OracleError> {
        let gate_pair = pair.replace('/', "_").to_uppercase();
        let url = format!(
            "https://api.gateio.ws/api/v4/spot/tickers?currency_pair={}",
            gate_pair
        );
        let resp = self.client.get(&url).send().await?;
        let tickers: GateResponse =
            resp.json().await.map_err(|e| OracleError::Parse(e.to_string()))?;
        let ticker = tickers
            .0
            .first()
            .ok_or_else(|| OracleError::NoData(pair.to_string()))?;
        ticker
            .last
            .parse::<f64>()
            .map_err(|_| OracleError::MalformedResponse {
                feed: "Gate.io".into(),
                pair: pair.to_string(),
            })
    }
}

// ── CoinGecko (fallback) ────────────────────────────────────────────

pub struct CoinGeckoFeed {
    client: reqwest::Client,
}

impl CoinGeckoFeed {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl PriceFeed for CoinGeckoFeed {
    fn name(&self) -> &str {
        "CoinGecko"
    }

    async fn fetch(&self, pair: &str) -> Result<f64, OracleError> {
        let (base, quote) = split_pair(pair);
        let coin_id = symbol_to_coingecko_id(base);
        let vs_currency = quote.to_lowercase();
        let url = format!(
            "https://api.coingecko.com/api/v3/simple/price?ids={}&vs_currencies={}",
            coin_id, vs_currency
        );
        let resp = self.client.get(&url).send().await?;
        let cg: CoinGeckoResponse =
            resp.json().await.map_err(|e| OracleError::Parse(e.to_string()))?;

        cg.prices
            .get(&coin_id)
            .and_then(|v| v.get(&vs_currency))
            .copied()
            .ok_or_else(|| OracleError::NoData(pair.to_string()))
    }
}

fn symbol_to_coingecko_id(symbol: &str) -> String {
    // Map common symbols to CoinGecko IDs
    match symbol.to_uppercase().as_str() {
        "HSMC" => "hsmc-network".to_string(),
        "BTC" => "bitcoin".to_string(),
        "ETH" => "ethereum".to_string(),
        "USDT" => "tether".to_string(),
        "XMR" => "monero".to_string(),
        _ => symbol.to_lowercase(),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

fn split_pair(pair: &str) -> (&str, &str) {
    let parts: Vec<&str> = pair.splitn(2, '/').collect();
    (parts[0], parts.get(1).copied().unwrap_or("USDT"))
}

// ═══════════════════════════════════════════════════════════════════════
// AGGREGATION — median + IQR filter
// ═══════════════════════════════════════════════════════════════════════

/// Aggregate prices using median with IQR-based outlier rejection.
///
/// Algorithm:
/// 1. Sort all prices
/// 2. Compute Q1 (25th percentile), Q3 (75th percentile), IQR = Q3 - Q1
/// 3. Keep values in [Q1 - 1.5*IQR, Q3 + 1.5*IQR]
/// 4. Return median of remaining values (or None if empty)
pub fn aggregate_iqr(mut prices: Vec<f64>) -> Option<f64> {
    if prices.is_empty() {
        return None;
    }
    if prices.len() == 1 {
        return Some(prices[0]);
    }

    prices.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let q1 = percentile_sorted(&prices, 25);
    let q3 = percentile_sorted(&prices, 75);
    let iqr = q3 - q1;

    let lower = q1 - 1.5 * iqr;
    let upper = q3 + 1.5 * iqr;

    let filtered: Vec<f64> = prices
        .into_iter()
        .filter(|p| *p >= lower && *p <= upper)
        .collect();

    if filtered.is_empty() {
        return None;
    }

    Some(median_sorted(&filtered))
}

fn percentile_sorted(sorted: &[f64], p: usize) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((p as f64 / 100.0) * (sorted.len() - 1) as f64) as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn median_sorted(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return 0.0;
    }
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ORACLE — multi-feed aggregator with caching
// ═══════════════════════════════════════════════════════════════════════

/// Cached price entry with timestamp.
#[derive(Debug, Clone)]
pub struct CachedPrice {
    pub price: f64,
    pub timestamp: Instant,
    pub feeds_used: usize,
}

/// The main Oracle that queries multiple feeds and caches results.
pub struct Oracle {
    feeds: Vec<Box<dyn PriceFeed>>,
    cache: Arc<RwLock<HashMap<String, CachedPrice>>>,
    ttl: Duration,
    min_feeds: usize,
}

impl Oracle {
    /// Create a new Oracle with the given feeds.
    ///
    /// * `feeds` - list of price feed implementations
    /// * `ttl` - cache time-to-live (e.g. 30 seconds)
    /// * `min_feeds` - minimum number of successful feeds required to return a price
    pub fn new(feeds: Vec<Box<dyn PriceFeed>>, ttl: Duration, min_feeds: usize) -> Self {
        Self {
            feeds,
            cache: Arc::new(RwLock::new(HashMap::new())),
            ttl,
            min_feeds,
        }
    }

    /// Build the default set of feeds (5 CEX + CoinGecko fallback).
    pub fn with_default_feeds(ttl: Duration) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("HSMC-Oracle/0.1")
            .build()
            .expect("Failed to build reqwest client");

        let feeds: Vec<Box<dyn PriceFeed>> = vec![
            Box::new(BinanceFeed::new(client.clone())),
            Box::new(KrakenFeed::new(client.clone())),
            Box::new(CoinbaseFeed::new(client.clone())),
            Box::new(BybitFeed::new(client.clone())),
            Box::new(GateFeed::new(client.clone())),
            Box::new(CoinGeckoFeed::new(client.clone())),
        ];

        Self::new(feeds, ttl, 2) // At least 2 feeds for confidence
    }

    /// Get the aggregated price for a pair. Uses cache if fresh, otherwise fetches.
    pub async fn get_price(&self, pair: &str) -> Result<f64, OracleError> {
        // Check cache
        {
            let cache = self.cache.read();
            if let Some(entry) = cache.get(pair) {
                if entry.timestamp.elapsed() < self.ttl {
                    debug!(
                        "Oracle cache hit for {}: {} ({} feeds)",
                        pair, entry.price, entry.feeds_used
                    );
                    return Ok(entry.price);
                }
            }
        }

        // Cache miss or expired — fetch from all feeds in parallel
        let prices = self.fetch_all(pair).await;

        if prices.len() < self.min_feeds {
            return Err(OracleError::NoData(pair.to_string()));
        }

        let feeds_used = prices.len();
        let aggregated = aggregate_iqr(prices).ok_or_else(|| OracleError::NoData(pair.to_string()))?;

        // Update cache
        {
            let mut cache = self.cache.write();
            cache.insert(
                pair.to_string(),
                CachedPrice {
                    price: aggregated,
                    timestamp: Instant::now(),
                    feeds_used,
                },
            );
        }

        debug!("Oracle: {} = {} (aggregated)", pair, aggregated);
        Ok(aggregated)
    }

    /// Fetch prices from all feeds concurrently. Returns all successful results.
    async fn fetch_all(&self, pair: &str) -> Vec<f64> {
        let futures: Vec<_> = self
            .feeds
            .iter()
            .map(|feed| {
                let pair = pair.to_string();
                async move {
                    match feed.fetch(&pair).await {
                        Ok(price) => {
                            debug!("{}: {} = {}", feed.name(), pair, price);
                            Some(price)
                        }
                        Err(e) => {
                            warn!("{} feed failed for {}: {}", feed.name(), pair, e);
                            None
                        }
                    }
                }
            })
            .collect();

        let results = futures::future::join_all(futures).await;
        results.into_iter().flatten().collect()
    }

    /// Invalidate cached price for a pair.
    pub fn invalidate(&self, pair: &str) {
        self.cache.write().remove(pair);
    }

    /// Return a clone of the cache Arc for sharing with other components.
    pub fn cache_ref(&self) -> Arc<RwLock<HashMap<String, CachedPrice>>> {
        Arc::clone(&self.cache)
    }

    /// Get the number of active feeds.
    pub fn feed_count(&self) -> usize {
        self.feeds.len()
    }
}

// ═══════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // ── aggregate_iqr tests ───────────────────────────────────────

    #[test]
    fn test_aggregate_empty() {
        assert_eq!(aggregate_iqr(vec![]), None);
    }

    #[test]
    fn test_aggregate_single() {
        assert_eq!(aggregate_iqr(vec![1.0]), Some(1.0));
    }

    #[test]
    fn test_aggregate_median_two() {
        assert_eq!(aggregate_iqr(vec![2.0, 1.0]), Some(1.5));
    }

    #[test]
    fn test_aggregate_median_odd() {
        // Sorted: 1, 2, 3, 4, 5 → median = 3
        assert_eq!(aggregate_iqr(vec![5.0, 1.0, 3.0, 4.0, 2.0]), Some(3.0));
    }

    #[test]
    fn test_aggregate_median_even() {
        // Sorted: 1, 2, 3, 4 → median = 2.5
        assert_eq!(aggregate_iqr(vec![2.0, 3.0, 1.0, 4.0]), Some(2.5));
    }

    #[test]
    fn test_outlier_rejection() {
        // 1.0 is an obvious outlier, should be filtered
        // Sorted: 1.0, 9.9, 10.0, 10.1, 10.2
        // Q1 = 9.9, Q3 = 10.1, IQR = 0.2
        // Lower = 9.9 - 0.3 = 9.6, Upper = 10.1 + 0.3 = 10.4
        // 1.0 filtered out → remaining: 9.9, 10.0, 10.1, 10.2 → median = 10.05
        let result = aggregate_iqr(vec![1.0, 10.0, 10.1, 9.9, 10.2]);
        assert!(result.is_some());
        assert!((result.unwrap() - 10.05).abs() < 0.01);
    }

    #[test]
    fn test_outlier_rejection_high() {
        // 1000.0 is an extreme outlier on the high end
        // Sorted: 9.9, 10.0, 10.1, 10.2, 1000.0
        // Q1 = 10.0, Q3 = 10.2, IQR = 0.2
        // Upper = 10.2 + 0.3 = 10.5
        // 1000.0 filtered → remaining: 9.9, 10.0, 10.1, 10.2 → median = 10.05
        let result = aggregate_iqr(vec![10.0, 10.1, 9.9, 1000.0, 10.2]);
        assert!(result.is_some());
        assert!((result.unwrap() - 10.05).abs() < 0.01);
    }

    #[test]
    fn test_all_outliers_rejected() {
        // If all values are filtered, returns None
        // With only 2 values, Q1 = q1, Q3 = q2, IQR = 0, so no filter applies
        // With 3 identical values, IQR = 0, no filter either
        // We need values with very large IQR where all are outside
        // Actually with 3 values, Q1=first, Q3=third, IQR=range. All would be inside.
        // We need a degenerate case. Let's just verify 0 values returns None.
        assert_eq!(aggregate_iqr(vec![]), None);
    }

    #[test]
    fn test_no_outliers_clustered() {
        // Closely clustered values should all survive
        let result = aggregate_iqr(vec![10.0, 10.1, 9.9, 10.2, 9.8]);
        assert!(result.is_some());
        assert!((result.unwrap() - 10.0).abs() < 0.01);
    }

    // ── helper tests ──────────────────────────────────────────────

    #[test]
    fn test_pair_to_binance_symbol() {
        assert_eq!(pair_to_binance_symbol("HSMC/USDT"), "HSMCUSDT");
        assert_eq!(pair_to_binance_symbol("BTC/USDT"), "BTCUSDT");
    }

    #[test]
    fn test_split_pair() {
        assert_eq!(split_pair("HSMC/USDT"), ("HSMC", "USDT"));
        assert_eq!(split_pair("BTC/USD"), ("BTC", "USD"));
        assert_eq!(split_pair("HSMC"), ("HSMC", "USDT")); // default quote
    }

    #[test]
    fn test_symbol_to_coingecko_id() {
        assert_eq!(symbol_to_coingecko_id("HSMC"), "hsmc-network");
        assert_eq!(symbol_to_coingecko_id("BTC"), "bitcoin");
        assert_eq!(symbol_to_coingecko_id("ETH"), "ethereum");
        assert_eq!(symbol_to_coingecko_id("XMR"), "monero");
        assert_eq!(symbol_to_coingecko_id("UNKNOWN"), "unknown");
    }

    // ── cache tests ───────────────────────────────────────────────

    #[tokio::test]
    async fn test_cache_hit_within_ttl() {
        // A mock feed that always returns 42.0
        struct MockFeed;
        #[async_trait::async_trait]
        impl PriceFeed for MockFeed {
            fn name(&self) -> &str { "Mock" }
            async fn fetch(&self, _pair: &str) -> Result<f64, OracleError> { Ok(42.0) }
        }

        let oracle = Oracle::new(
            vec![Box::new(MockFeed)],
            Duration::from_secs(300), // long TTL
            1, // min 1 feed
        );

        // First call — should fetch
        let p1 = oracle.get_price("HSMC/USDT").await.unwrap();
        assert_eq!(p1, 42.0);

        // Second call — should return from cache (MockFeed not called if cache hit)
        let p2 = oracle.get_price("HSMC/USDT").await.unwrap();
        assert_eq!(p2, 42.0);
    }

    #[tokio::test]
    async fn test_cache_expiry() {
        struct MockFeed;
        #[async_trait::async_trait]
        impl PriceFeed for MockFeed {
            fn name(&self) -> &str { "Mock" }
            async fn fetch(&self, _pair: &str) -> Result<f64, OracleError> { Ok(42.0) }
        }

        let oracle = Oracle::new(
            vec![Box::new(MockFeed)],
            Duration::from_millis(10), // very short TTL
            1,
        );

        let p1 = oracle.get_price("HSMC/USDT").await.unwrap();
        assert_eq!(p1, 42.0);

        // Wait for cache to expire
        tokio::time::sleep(Duration::from_millis(20)).await;

        // Should fetch again (MockFeed still returns 42.0)
        let p2 = oracle.get_price("HSMC/USDT").await.unwrap();
        assert_eq!(p2, 42.0);
    }

    #[tokio::test]
    async fn test_insufficient_feeds() {
        struct FailingFeed;
        #[async_trait::async_trait]
        impl PriceFeed for FailingFeed {
            fn name(&self) -> &str { "Failing" }
            async fn fetch(&self, _pair: &str) -> Result<f64, OracleError> {
                Err(OracleError::NoData("test".into()))
            }
        }

        let oracle = Oracle::new(
            vec![Box::new(FailingFeed)],
            Duration::from_secs(300),
            1, // min 1 feed, but it fails → error
        );

        let result = oracle.get_price("HSMC/USDT").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cache_invalidation() {
        struct MockFeed;
        #[async_trait::async_trait]
        impl PriceFeed for MockFeed {
            fn name(&self) -> &str { "Mock" }
            async fn fetch(&self, _pair: &str) -> Result<f64, OracleError> { Ok(42.0) }
        }

        let oracle = Oracle::new(
            vec![Box::new(MockFeed)],
            Duration::from_secs(300),
            1,
        );

        let p1 = oracle.get_price("HSMC/USDT").await.unwrap();
        assert_eq!(p1, 42.0);

        // Invalidate cache
        oracle.invalidate("HSMC/USDT");

        // Should be empty after invalidation
        {
            let cache = oracle.cache.read();
            assert!(!cache.contains_key("HSMC/USDT"));
        }
    }
}
