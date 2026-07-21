/// HSMC Node v2.0 — Full Production Orchestration
///
/// Services launched:
///   ├── RPC HTTP server          (port 8080)   — full API surface
///   ├── Stratum V2 mining server (port 3333)   — multi-miner WebSocket
///   ├── Metrics HTTP server      (port 9090)   — Prometheus-compatible
///   ├── P2P sync service                       — background peer sync
///   ├── Block producer                         — parallel PoW CPU miner
///   ├── Governance engine                      — on-chain proposal lifecycle
///   ├── Staking registry                       — validator rewards & unbonding
///   ├── EIP-1559 fee market                    — base-fee auto-adjustment
///   ├── UTXO set manager                       — dual-indexed spend/balance
///   └── Graceful shutdown                      — SIGINT / SIGTERM

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{RwLock, Mutex, broadcast};
use tokio::time::sleep;
use tracing::{info, warn, error, debug};
use tracing_subscriber::EnvFilter;
use anyhow::Result;

use hsmc_core::{
    Chain, Mempool,
    governance::{GovernanceEngine, ProposalStatus},
    fee::FeeMarket,
    state::StakingRegistry,
};
use hsmc_p2p::{PeerRegistry, SyncService};
use hsmc_rpc::server::start_rpc_server;
use hsmc_stratum::StratumServer;
use hsmc_storage::{open_db, BlockStore, TxStore, MempoolStore, StateStore, UtxoStore};

// ── Metrics counters (atomic, lock-free) ─────────────────────────────────────

/// Global node metrics — updated atomically throughout runtime
pub struct NodeMetrics {
    pub blocks_mined:       AtomicU64,
    pub txs_processed:      AtomicU64,
    pub shares_submitted:   AtomicU64,
    pub peer_count:         AtomicU64,
    pub mempool_size:       AtomicU64,
    pub chain_height:       AtomicU64,
    pub total_hashrate_khs: AtomicU64,   // KH/s ×10 (1 decimal via integer)
    pub governance_active:  AtomicU64,
    pub staking_total:      AtomicU64,   // in atomic units (HSMC × 10^8)
    pub utxo_count:         AtomicU64,
    pub uptime_secs:        AtomicU64,
    pub base_fee_satoshis:  AtomicU64,
    pub rejected_txs:       AtomicU64,
    pub fork_depth:         AtomicU64,
}

impl NodeMetrics {
    pub const fn new() -> Self {
        Self {
            blocks_mined:       AtomicU64::new(0),
            txs_processed:      AtomicU64::new(0),
            shares_submitted:   AtomicU64::new(0),
            peer_count:         AtomicU64::new(0),
            mempool_size:       AtomicU64::new(0),
            chain_height:       AtomicU64::new(0),
            total_hashrate_khs: AtomicU64::new(0),
            governance_active:  AtomicU64::new(0),
            staking_total:      AtomicU64::new(0),
            utxo_count:         AtomicU64::new(0),
            uptime_secs:        AtomicU64::new(0),
            base_fee_satoshis:  AtomicU64::new(1000),
            rejected_txs:       AtomicU64::new(0),
            fork_depth:         AtomicU64::new(0),
        }
    }

    /// Render Prometheus-compatible text exposition format
    pub fn to_prometheus(&self) -> String {
        let mut out = String::with_capacity(2048);
        macro_rules! gauge {
            ($name:literal, $help:literal, $val:expr) => {
                out.push_str(&format!(
                    "# HELP hsmc_{} {}\n# TYPE hsmc_{} gauge\nhsmc_{} {}\n",
                    $name, $help, $name, $name, $val
                ));
            };
        }
        gauge!("chain_height",       "Current chain tip block number",         self.chain_height.load(Ordering::Relaxed));
        gauge!("mempool_size",        "Pending transactions in mempool",        self.mempool_size.load(Ordering::Relaxed));
        gauge!("peer_count",          "Connected P2P peers",                   self.peer_count.load(Ordering::Relaxed));
        gauge!("blocks_mined_total",  "Blocks mined since node start",         self.blocks_mined.load(Ordering::Relaxed));
        gauge!("txs_processed_total", "Transactions processed since start",    self.txs_processed.load(Ordering::Relaxed));
        gauge!("shares_submitted",    "Mining shares submitted by workers",    self.shares_submitted.load(Ordering::Relaxed));
        gauge!("hashrate_khs",        "Current node hashrate in KH/s (×10)",  self.total_hashrate_khs.load(Ordering::Relaxed));
        gauge!("governance_active",   "Active on-chain governance proposals",  self.governance_active.load(Ordering::Relaxed));
        gauge!("staking_total_units", "Total staked HSMC in atomic units",     self.staking_total.load(Ordering::Relaxed));
        gauge!("utxo_count",          "Size of the UTXO set",                  self.utxo_count.load(Ordering::Relaxed));
        gauge!("uptime_seconds",      "Node uptime in seconds",                self.uptime_secs.load(Ordering::Relaxed));
        gauge!("base_fee_satoshis",   "EIP-1559 base fee in satoshis",         self.base_fee_satoshis.load(Ordering::Relaxed));
        gauge!("rejected_txs_total",  "Rejected/invalid transactions",         self.rejected_txs.load(Ordering::Relaxed));
        gauge!("fork_depth",          "Longest detected fork depth",           self.fork_depth.load(Ordering::Relaxed));
        out
    }
}

static METRICS: NodeMetrics = NodeMetrics::new();

// ── Config ───────────────────────────────────────────────────────────────────

struct NodeConfig {
    data_dir:      String,
    rpc_port:      u16,
    stratum_port:  u16,
    metrics_port:  u16,
    miner_address: String,
    chain_id:      u64,
    network:       String,
    log_level:     String,
    max_peers:     usize,
    block_time_ms: u64,   // target block time
    max_mempool:   usize, // max pending txs
}

impl NodeConfig {
    fn from_env() -> Self {
        Self {
            data_dir:      env_str("HSMC_DATA_DIR",    "./hsmc-data"),
            rpc_port:      env_u16("RPC_PORT",         8080),
            stratum_port:  env_u16("STRATUM_PORT",     3333),
            metrics_port:  env_u16("METRICS_PORT",     9090),
            miner_address: env_str("MINER_ADDRESS",    "HSMC_NODE_MINER_000000000000000000000000000000000000000"),
            chain_id:      env_u64("CHAIN_ID",         8888),
            network:       env_str("HSMC_NETWORK",     "mainnet"),
            log_level:     env_str("RUST_LOG",         "info"),
            max_peers:     env_usize("MAX_PEERS",      64),
            block_time_ms: env_u64("BLOCK_TIME_MS",    60_000),
            max_mempool:   env_usize("MAX_MEMPOOL",    10_000),
        }
    }
}

fn env_str(k: &str, default: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| default.to_string())
}
fn env_u16(k: &str, default: u16) -> u16 {
    std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}
fn env_u64(k: &str, default: u64) -> u64 {
    std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}
fn env_usize(k: &str, default: usize) -> usize {
    std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

// ── Shared application state ──────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub chain:      Arc<RwLock<Chain>>,
    pub mempool:    Arc<RwLock<Mempool>>,
    pub peers:      Arc<PeerRegistry>,
    pub governance: Arc<RwLock<GovernanceEngine>>,
    pub fee_market: Arc<RwLock<FeeMarket>>,
    pub staking:    Arc<RwLock<StakingRegistry>>,
    pub metrics:    &'static NodeMetrics,
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    let cfg = NodeConfig::from_env();

    // ── Logging ──────────────────────────────────────────────────────────────
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(&cfg.log_level))
        )
        .with_target(false)
        .compact()
        .init();

    print_banner(&cfg);

    // ── Graceful-shutdown channel ─────────────────────────────────────────────
    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    let shutdown_flag = Arc::new(AtomicBool::new(false));
    install_signal_handlers(shutdown_tx.clone(), shutdown_flag.clone()).await;

    // ── Open RocksDB ──────────────────────────────────────────────────────────
    info!("📦 Opening RocksDB at {}", cfg.data_dir);
    let db           = Arc::new(open_db(&cfg.data_dir)?);
    let block_store  = Arc::new(BlockStore::new(db.clone()));
    let tx_store     = Arc::new(TxStore::new(db.clone()));
    let mempool_store= Arc::new(MempoolStore::new(db.clone()));
    let state_store  = Arc::new(StateStore::new(db.clone()));
    let utxo_store   = Arc::new(UtxoStore::new(db.clone()));
    info!("✅ RocksDB opened successfully");

    // ── In-memory shared state ────────────────────────────────────────────────
    let chain      = Arc::new(RwLock::new(Chain::new()));
    let mempool    = Arc::new(RwLock::new(Mempool::new()));
    let governance = Arc::new(RwLock::new(GovernanceEngine::new()));
    let fee_market = Arc::new(RwLock::new(FeeMarket::new()));
    let staking    = Arc::new(RwLock::new(StakingRegistry::new()));
    let peers      = Arc::new(PeerRegistry::new());

    let app = AppState {
        chain:      chain.clone(),
        mempool:    mempool.clone(),
        peers:      peers.clone(),
        governance: governance.clone(),
        fee_market: fee_market.clone(),
        staking:    staking.clone(),
        metrics:    &METRICS,
    };

    // ── Restore chain from RocksDB ────────────────────────────────────────────
    restore_chain(&chain, &block_store).await;

    // ── Restore mempool from RocksDB ─────────────────────────────────────────
    restore_mempool(&mempool, &mempool_store).await;

    // ── Restore UTXO set from disk ────────────────────────────────────────────
    restore_utxo_set(&utxo_store).await;

    // ── Restore governance state ──────────────────────────────────────────────
    restore_governance(&governance, &state_store).await;

    // ── Restore staking registry ──────────────────────────────────────────────
    restore_staking(&staking, &state_store).await;

    // ── Spawn background services ─────────────────────────────────────────────
    let node_start = Instant::now();

    spawn_uptime_ticker(node_start);
    spawn_metrics_updater(app.clone(), cfg.block_time_ms);
    spawn_p2p_sync(peers.clone(), chain.clone(), cfg.max_peers, shutdown_flag.clone());
    spawn_governance_processor(governance.clone(), state_store.clone(), shutdown_flag.clone());
    spawn_staking_reward_distributor(staking.clone(), chain.clone(), state_store.clone(), shutdown_flag.clone());
    spawn_fee_market_updater(fee_market.clone(), mempool.clone(), shutdown_flag.clone());
    spawn_mempool_cleanup(mempool.clone(), mempool_store.clone(), cfg.max_mempool, shutdown_flag.clone());
    spawn_block_producer(
        chain.clone(), mempool.clone(), mempool_store.clone(),
        block_store.clone(), tx_store.clone(), utxo_store.clone(),
        cfg.miner_address.clone(), cfg.block_time_ms, shutdown_flag.clone(),
    );

    // ── Stratum V2 server ─────────────────────────────────────────────────────
    {
        let stratum      = StratumServer::new(chain.clone(), mempool.clone());
        let stratum_port = cfg.stratum_port;
        let mut rx       = shutdown_tx.subscribe();
        tokio::spawn(async move {
            tokio::select! {
                res = stratum.run(stratum_port) => {
                    if let Err(e) = res { error!("Stratum server error: {}", e); }
                }
                _ = rx.recv() => { info!("Stratum server shutting down"); }
            }
        });
    }

    // ── Metrics HTTP server ───────────────────────────────────────────────────
    {
        let metrics_port = cfg.metrics_port;
        let mut rx       = shutdown_tx.subscribe();
        tokio::spawn(async move {
            tokio::select! {
                res = run_metrics_server(metrics_port) => {
                    if let Err(e) = res { error!("Metrics server error: {}", e); }
                }
                _ = rx.recv() => { info!("Metrics server shutting down"); }
            }
        });
    }

    // ── RPC HTTP server (blocking — main task) ────────────────────────────────
    info!("🚀 RPC server starting on port {}", cfg.rpc_port);
    let rpc_chain   = chain.clone();
    let rpc_mempool = mempool.clone();
    let rpc_peers   = peers.clone();
    let rpc_port    = cfg.rpc_port;
    let mut rx      = shutdown_tx.subscribe();
    tokio::select! {
        res = start_rpc_server(rpc_chain, rpc_mempool, rpc_peers, rpc_port) => {
            if let Err(e) = res { error!("RPC server error: {}", e); }
        }
        _ = rx.recv() => { info!("RPC server shutting down"); }
    }

    // ── Flush RocksDB before exit ─────────────────────────────────────────────
    info!("💾 Flushing state to RocksDB...");
    flush_state(&chain, &mempool, &staking, &governance,
                &block_store, &mempool_store, &state_store).await;
    info!("✅ Node shutdown complete");
    Ok(())
}

// ── Signal handler ────────────────────────────────────────────────────────────

async fn install_signal_handlers(tx: broadcast::Sender<()>, flag: Arc<AtomicBool>) {
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sigint  = signal(SignalKind::interrupt()).expect("SIGINT handler");
            let mut sigterm = signal(SignalKind::terminate()).expect("SIGTERM handler");
            tokio::select! {
                _ = sigint.recv()  => { info!("🛑 SIGINT received — initiating graceful shutdown"); }
                _ = sigterm.recv() => { info!("🛑 SIGTERM received — initiating graceful shutdown"); }
            }
        }
        #[cfg(not(unix))]
        {
            tokio::signal::ctrl_c().await.expect("ctrl-c handler");
            info!("🛑 Ctrl+C received — initiating graceful shutdown");
        }
        flag.store(true, Ordering::SeqCst);
        let _ = tx.send(());
    });
}

// ── Restoration routines ──────────────────────────────────────────────────────

async fn restore_chain(chain: &Arc<RwLock<Chain>>, block_store: &Arc<BlockStore>) {
    let mut c = chain.write().await;
    match block_store.load_chain(&mut c) {
        Ok((loaded, tip)) if loaded > 0 => {
            METRICS.chain_height.store(tip as u64, Ordering::Relaxed);
            info!("🔗 Chain restored: {} blocks, tip #{}", loaded, tip);
        }
        Ok(_)  => info!("🔗 No persisted blocks — starting from genesis"),
        Err(e) => warn!("⚠️  Chain restore failed ({}), starting fresh", e),
    }
}

async fn restore_mempool(mempool: &Arc<RwLock<Mempool>>, store: &Arc<MempoolStore>) {
    let mut m = mempool.write().await;
    match store.load_all() {
        Ok(pending) => {
            let count = pending.len();
            for tx in pending { let _ = m.add(tx); }
            if count > 0 {
                METRICS.mempool_size.store(count as u64, Ordering::Relaxed);
                info!("📋 Mempool restored: {} pending transactions", count);
            } else {
                info!("📋 Mempool empty");
            }
        }
        Err(e) => warn!("⚠️  Mempool restore failed: {}", e),
    }
}

async fn restore_utxo_set(utxo_store: &Arc<UtxoStore>) {
    match utxo_store.count() {
        Ok(n) => {
            METRICS.utxo_count.store(n as u64, Ordering::Relaxed);
            info!("💰 UTXO set: {} unspent outputs", n);
        }
        Err(e) => warn!("⚠️  UTXO count failed: {}", e),
    }
}

async fn restore_governance(gov: &Arc<RwLock<GovernanceEngine>>, state: &Arc<StateStore>) {
    let mut g = gov.write().await;
    match state.load_governance() {
        Ok(Some(snap)) => {
            g.load_snapshot(snap);
            let active = g.active_proposals().len();
            METRICS.governance_active.store(active as u64, Ordering::Relaxed);
            info!("🗳️  Governance restored: {} active proposals", active);
        }
        Ok(None) => info!("🗳️  Governance: no prior state found"),
        Err(e)   => warn!("⚠️  Governance restore failed: {}", e),
    }
}

async fn restore_staking(staking: &Arc<RwLock<StakingRegistry>>, state: &Arc<StateStore>) {
    let mut s = staking.write().await;
    match state.load_staking() {
        Ok(Some(snap)) => {
            s.load_snapshot(snap);
            let total = s.total_staked();
            METRICS.staking_total.store(total, Ordering::Relaxed);
            info!("🥩 Staking restored: {} atomic units staked", total);
        }
        Ok(None) => info!("🥩 Staking registry: no prior state"),
        Err(e)   => warn!("⚠️  Staking restore failed: {}", e),
    }
}

// ── Uptime ticker ─────────────────────────────────────────────────────────────

fn spawn_uptime_ticker(start: Instant) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            METRICS.uptime_secs.store(start.elapsed().as_secs(), Ordering::Relaxed);
        }
    });
}

// ── Metrics aggregator ────────────────────────────────────────────────────────

fn spawn_metrics_updater(app: AppState, block_time_ms: u64) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            // Chain height
            let height = app.chain.read().await.height();
            METRICS.chain_height.store(height as u64, Ordering::Relaxed);
            // Mempool
            let mp_size = app.mempool.read().await.len();
            METRICS.mempool_size.store(mp_size as u64, Ordering::Relaxed);
            // Peers
            let peer_count = app.peers.count();
            METRICS.peer_count.store(peer_count as u64, Ordering::Relaxed);
            // Governance
            let active_props = app.governance.read().await.active_proposals().len();
            METRICS.governance_active.store(active_props as u64, Ordering::Relaxed);
            // Staking
            let total_staked = app.staking.read().await.total_staked();
            METRICS.staking_total.store(total_staked, Ordering::Relaxed);
            // Fee market base fee
            let base_fee = app.fee_market.read().await.base_fee_satoshis();
            METRICS.base_fee_satoshis.store(base_fee, Ordering::Relaxed);
        }
    });
}

// ── P2P sync service ──────────────────────────────────────────────────────────

fn spawn_p2p_sync(
    peers: Arc<PeerRegistry>,
    chain: Arc<RwLock<Chain>>,
    _max_peers: usize,
    shutdown: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        let sync = SyncService::new(peers);
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            if shutdown.load(Ordering::Relaxed) { break; }
            interval.tick().await;

            let local_height = chain.read().await.height();
            let behind = sync.blocks_behind(local_height).await;
            if behind > 0 {
                info!(behind, local_height, "🔄 Syncing blocks from peers");
                sync.sync_from(local_height, local_height + behind.min(500)).await;
            }
        }
    });
}

// ── Governance processor ──────────────────────────────────────────────────────

fn spawn_governance_processor(
    governance: Arc<RwLock<GovernanceEngine>>,
    state_store: Arc<StateStore>,
    shutdown: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            if shutdown.load(Ordering::Relaxed) { break; }
            interval.tick().await;

            let now = unix_now();
            let mut g = governance.write().await;

            // Finalize expired proposals
            let finalized = g.finalize_expired(now);
            if !finalized.is_empty() {
                for (id, status) in &finalized {
                    match status {
                        ProposalStatus::Passed  => info!("✅ Governance proposal {} PASSED", id),
                        ProposalStatus::Rejected=> info!("❌ Governance proposal {} REJECTED", id),
                        ProposalStatus::Expired => info!("⏰ Governance proposal {} EXPIRED", id),
                        _ => {}
                    }
                }
            }

            // Process enacted proposals (parameter changes, treasury payments)
            let enacted = g.enact_passed_proposals();
            if !enacted.is_empty() {
                info!("📜 Enacted {} governance proposal(s)", enacted.len());
            }

            // Persist governance snapshot
            if let Ok(snap) = g.to_snapshot() {
                if let Err(e) = state_store.save_governance(&snap) {
                    warn!("⚠️  Governance persist failed: {}", e);
                }
            }

            let active = g.active_proposals().len();
            METRICS.governance_active.store(active as u64, Ordering::Relaxed);
        }
        info!("Governance processor stopped");
    });
}

// ── Staking reward distributor ────────────────────────────────────────────────

fn spawn_staking_reward_distributor(
    staking: Arc<RwLock<StakingRegistry>>,
    chain: Arc<RwLock<Chain>>,
    state_store: Arc<StateStore>,
    shutdown: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        // Distribute rewards every 600 seconds (~10 block epochs at 60s block time)
        let mut interval = tokio::time::interval(Duration::from_secs(600));
        loop {
            if shutdown.load(Ordering::Relaxed) { break; }
            interval.tick().await;

            let block_height = chain.read().await.height();
            let now          = unix_now();
            let mut s        = staking.write().await;

            // Calculate epoch rewards based on chain height and total staked
            let total_staked    = s.total_staked();
            let annual_rate_bps = 1200u64; // 12% APR in basis points
            // per-second rate: annual_rate / (365 * 24 * 3600) / 10000
            let epoch_secs = 600u64;
            let reward_units = (total_staked * annual_rate_bps * epoch_secs)
                / (365 * 24 * 3600 * 10_000);

            if reward_units > 0 {
                let distributed = s.distribute_rewards(reward_units, block_height, now);
                if distributed > 0 {
                    debug!("🥩 Staking rewards distributed: {} units across {} validators",
                           reward_units, distributed);
                }
            }

            // Process unbonding completions
            let unbonded = s.process_unbonding(now);
            if unbonded > 0 {
                info!("🔓 {} validator(s) completed unbonding", unbonded);
            }

            // Slash inactive validators (missed > 50% of last 1000 blocks)
            let slashed = s.slash_inactive(block_height, 1000, 500);
            if slashed > 0 {
                warn!("⚡ Slashed {} inactive validator(s)", slashed);
            }

            METRICS.staking_total.store(s.total_staked(), Ordering::Relaxed);

            // Persist
            if let Ok(snap) = s.to_snapshot() {
                if let Err(e) = state_store.save_staking(&snap) {
                    warn!("⚠️  Staking persist failed: {}", e);
                }
            }
        }
        info!("Staking distributor stopped");
    });
}

// ── EIP-1559 fee market updater ───────────────────────────────────────────────

fn spawn_fee_market_updater(
    fee_market: Arc<RwLock<FeeMarket>>,
    mempool: Arc<RwLock<Mempool>>,
    shutdown: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(12)); // per-block
        let target_gas_per_block = 15_000_000u64;

        loop {
            if shutdown.load(Ordering::Relaxed) { break; }
            interval.tick().await;

            let gas_used = {
                let mp = mempool.read().await;
                let selected = mp.select_for_block(500);
                selected.iter().map(|tx| tx.gas_limit.unwrap_or(21_000)).sum::<u64>()
            };

            let mut fm = fee_market.write().await;
            fm.adjust_base_fee(gas_used, target_gas_per_block);
            let base_fee = fm.base_fee_satoshis();
            METRICS.base_fee_satoshis.store(base_fee, Ordering::Relaxed);
            debug!("⛽ Fee market: base_fee={} sat, gas_used={}", base_fee, gas_used);
        }
    });
}

// ── Mempool cleanup ───────────────────────────────────────────────────────────

fn spawn_mempool_cleanup(
    mempool: Arc<RwLock<Mempool>>,
    store: Arc<MempoolStore>,
    max_size: usize,
    shutdown: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(120));
        loop {
            if shutdown.load(Ordering::Relaxed) { break; }
            interval.tick().await;

            let now = unix_now();
            let mut m = mempool.write().await;

            // Evict transactions older than 24 hours
            let expired = m.evict_expired(now - 86_400);
            for hash in &expired {
                let _ = store.remove(hash);
            }
            if !expired.is_empty() {
                debug!("🗑️  Evicted {} expired mempool transactions", expired.len());
            }

            // Enforce max mempool size (evict lowest-fee txs)
            if m.len() > max_size {
                let over = m.len() - max_size;
                let evicted = m.evict_lowest_fee(over);
                for hash in &evicted {
                    let _ = store.remove(hash);
                }
                debug!("🗑️  Evicted {} low-fee txs (mempool cap)", evicted.len());
            }

            METRICS.mempool_size.store(m.len() as u64, Ordering::Relaxed);
        }
    });
}

// ── Block producer (parallel PoW CPU miner) ───────────────────────────────────

fn spawn_block_producer(
    chain: Arc<RwLock<Chain>>,
    mempool: Arc<RwLock<Mempool>>,
    mempool_store: Arc<MempoolStore>,
    block_store: Arc<BlockStore>,
    tx_store: Arc<TxStore>,
    utxo_store: Arc<UtxoStore>,
    miner_address: String,
    _target_block_time_ms: u64,
    shutdown: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        use std::sync::atomic::AtomicBool;
        let thread_count = num_cpus_available();
        info!("⛏️  Block producer started ({} CPU threads)", thread_count);

        loop {
            if shutdown.load(Ordering::Relaxed) { break; }

            // Build block template
            let (block_number, prev_hash, difficulty) = {
                let c = chain.read().await;
                let tip = c.tip();
                (tip.block_number + 1, tip.hash.clone(), c.difficulty)
            };

            let tx_hashes: Vec<String> = {
                let m = mempool.read().await;
                m.select_for_block(500).iter().map(|tx| tx.hash.clone()).collect()
            };

            // Build coinbase with reward + fee sum
            let block_reward = mining_reward(block_number);
            let fee_sum: u64  = {
                let m = mempool.read().await;
                m.select_for_block(500)
                    .iter()
                    .map(|tx| tx.fee)
                    .sum()
            };

            let block = hsmc_core::Block::new(
                block_number,
                prev_hash,
                miner_address.clone(),
                difficulty,
                tx_hashes.clone(),
            );

            let stop = Arc::new(AtomicBool::new(false));
            let stop_clone = stop.clone();

            // Mine in parallel threads
            let mine_start = Instant::now();
            match hsmc_crypto::mine_parallel(block, thread_count, stop_clone).await {
                Some((mined_block, result)) => {
                    let duration_ms = mine_start.elapsed().as_millis();
                    let hashrate_khs = result.hashrate / 1000.0;

                    info!(
                        "⛏️  Block #{} mined — hash={}…  {:.1} KH/s  {:.1}s  reward={:.4} HSMC",
                        mined_block.block_number,
                        &mined_block.hash[..14],
                        hashrate_khs,
                        duration_ms as f64 / 1000.0,
                        (block_reward + fee_sum) as f64 / 1e8,
                    );

                    // Persist block to RocksDB
                    if let Err(e) = block_store.put(&mined_block) {
                        error!("❌ BlockStore::put failed: {}", e);
                        continue;
                    }

                    // Persist transactions
                    {
                        let m = mempool.read().await;
                        for hash in &tx_hashes {
                            if let Some(tx) = m.get_by_hash(hash) {
                                if let Err(e) = tx_store.put(&tx, Some(mined_block.block_number)) {
                                    warn!("TxStore::put failed for {}: {}", &hash[..12], e);
                                }
                                // Update UTXO set
                                if let Err(e) = utxo_store.apply_transaction(&tx, mined_block.block_number) {
                                    warn!("UtxoStore::apply failed for {}: {}", &hash[..12], e);
                                }
                            }
                        }
                    }

                    // Commit to in-memory chain
                    {
                        let mut c = chain.write().await;
                        if let Err(e) = c.add_block(mined_block.clone()) {
                            warn!("Chain::add_block failed: {}", e);
                            METRICS.rejected_txs.fetch_add(1, Ordering::Relaxed);
                        } else {
                            METRICS.blocks_mined.fetch_add(1, Ordering::Relaxed);
                            METRICS.chain_height.store(mined_block.block_number as u64, Ordering::Relaxed);
                            METRICS.txs_processed.fetch_add(tx_hashes.len() as u64, Ordering::Relaxed);
                            METRICS.total_hashrate_khs.store((hashrate_khs * 10.0) as u64, Ordering::Relaxed);
                        }
                    }

                    // Evict mined txs from mempool
                    {
                        let mut m = mempool.write().await;
                        for hash in &tx_hashes {
                            m.remove(hash);
                            let _ = mempool_store.remove(hash);
                        }
                        METRICS.mempool_size.store(m.len() as u64, Ordering::Relaxed);
                    }

                    // Update UTXO count metric
                    if let Ok(n) = utxo_store.count() {
                        METRICS.utxo_count.store(n as u64, Ordering::Relaxed);
                    }
                }
                None => {
                    if !shutdown.load(Ordering::Relaxed) {
                        warn!("⚠️  Mining interrupted (shutdown or difficulty spike)");
                    }
                }
            }

            // Brief pause to allow other tasks CPU time
            sleep(Duration::from_millis(50)).await;
        }
        info!("Block producer stopped");
    });
}

// ── Metrics HTTP server ───────────────────────────────────────────────────────

async fn run_metrics_server(port: u16) -> Result<()> {
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let addr     = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await?;
    info!("📊 Metrics server on http://{}/metrics", addr);

    loop {
        let (mut socket, _) = listener.accept().await?;
        tokio::spawn(async move {
            let mut buf = [0u8; 256];
            let _ = socket.read(&mut buf).await;

            let body = METRICS.to_prometheus();
            let resp = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: text/plain; version=0.0.4; charset=utf-8\r\n\
                 Content-Length: {}\r\n\
                 Connection: close\r\n\
                 \r\n{}",
                body.len(), body
            );
            let _ = socket.write_all(resp.as_bytes()).await;
        });
    }
}

// ── Flush state on shutdown ───────────────────────────────────────────────────

async fn flush_state(
    chain: &Arc<RwLock<Chain>>,
    mempool: &Arc<RwLock<Mempool>>,
    staking: &Arc<RwLock<StakingRegistry>>,
    governance: &Arc<RwLock<GovernanceEngine>>,
    block_store: &Arc<BlockStore>,
    mempool_store: &Arc<MempoolStore>,
    state_store: &Arc<StateStore>,
) {
    // Persist latest chain tip metadata
    {
        let c = chain.read().await;
        let tip = c.tip();
        if let Err(e) = block_store.save_tip_metadata(tip.block_number, &tip.hash) {
            warn!("Flush: block tip metadata failed: {}", e);
        }
    }

    // Persist pending mempool transactions
    {
        let m = mempool.read().await;
        let pending = m.all_pending();
        let mut saved = 0usize;
        for tx in pending {
            if mempool_store.put(&tx).is_ok() { saved += 1; }
        }
        info!("  ✓ Mempool: {} transactions persisted", saved);
    }

    // Persist staking snapshot
    if let Ok(snap) = staking.read().await.to_snapshot() {
        if let Err(e) = state_store.save_staking(&snap) {
            warn!("Flush: staking snapshot failed: {}", e);
        } else {
            info!("  ✓ Staking registry persisted");
        }
    }

    // Persist governance snapshot
    if let Ok(snap) = governance.read().await.to_snapshot() {
        if let Err(e) = state_store.save_governance(&snap) {
            warn!("Flush: governance snapshot failed: {}", e);
        } else {
            info!("  ✓ Governance state persisted");
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Block subsidy with halving every 210,000 blocks (in satoshis, 8 decimals)
fn mining_reward(block_number: u64) -> u64 {
    let halvings = block_number / 210_000;
    if halvings >= 64 { return 0; }
    let base: u64 = 50 * 100_000_000; // 50 HSMC in satoshis
    base >> halvings
}

fn num_cpus_available() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(16) // cap at 16 for server sanity
}

fn print_banner(cfg: &NodeConfig) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    info!("╔══════════════════════════════════════════════════════════╗");
    info!("║       HSMC Node v2.0 — Production Edition         ║");
    info!("╠══════════════════════════════════════════════════════════╣");
    info!("║  Chain ID  : {:5}  │  Network : {:10}              ║", cfg.chain_id, cfg.network);
    info!("║  RPC port  : {:5}  │  Stratum : :{:5}  Metrics: :{:5} ║",
          cfg.rpc_port, cfg.stratum_port, cfg.metrics_port);
    info!("║  Data dir  : {:<45} ║", cfg.data_dir);
    info!("║  Miner     : {:<45} ║", &cfg.miner_address[..cfg.miner_address.len().min(45)]);
    info!("║  CPUs      : {:<4}   │  Timestamp: {}              ║", num_cpus_available(), ts);
    info!("╠══════════════════════════════════════════════════════════╣");
    info!("║  Services  : RPC · Stratum · P2P · Miner · Governance   ║");
    info!("║              Staking · FeeMarket · UTXO · Metrics       ║");
    info!("╚══════════════════════════════════════════════════════════╝");
}
