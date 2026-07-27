/// Axum HTTP/JSON-RPC server — production router with ALL endpoints
use axum::{
    routing::{get, post},
    Router,
};
use tower_http::cors::{CorsLayer, Any};
use std::sync::Arc;
use tokio::sync::RwLock;
use hsmc_core::{Chain, Mempool, governance::GovernanceState, state::StakingState};
use hsmc_p2p::PeerRegistry;
use hsmc_starks::ShieldedPool;
use tracing::info;
use crate::handlers::*;
use crate::bridge::*;

pub struct AppState {
    pub chain:      Arc<RwLock<Chain>>,
    pub mempool:    Arc<RwLock<Mempool>>,
    pub peers:      Arc<PeerRegistry>,
    pub governance: Arc<RwLock<GovernanceState>>,
    pub staking:    Arc<RwLock<StakingState>>,
    pub bridge:     Arc<RwLock<BridgeState>>,
    pub oracle:     Arc<hsmc_oracle::Oracle>,
    pub shielded:   Arc<RwLock<ShieldedPool>>,
    pub chain_id:   u64,
    pub network:    String,
}

pub async fn start_rpc_server(
    chain:      Arc<RwLock<Chain>>,
    mempool:    Arc<RwLock<Mempool>>,
    peers:      Arc<PeerRegistry>,
    governance: Arc<RwLock<GovernanceState>>,
    staking:    Arc<RwLock<StakingState>>,
    shielded:   Arc<RwLock<ShieldedPool>>,
    port:       u16,
) -> anyhow::Result<()> {
    let state = Arc::new(AppState {
        chain,
        mempool,
        peers,
        governance,
        staking,
        oracle: Arc::new(hsmc_oracle::Oracle::with_default_feeds(std::time::Duration::from_secs(30))),
        bridge: Arc::new(RwLock::new(BridgeState::default())),
        shielded,
        chain_id: 8888,
        network: "mainnet".into(),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // ── Health & info ─────────────────────────────────────────
        .route("/health",                  get(health))
        .route("/info",                    get(node_info))
        // ── Chain data ────────────────────────────────────────────
        .route("/block/latest",            get(get_latest_block))
        .route("/block/:number",           get(get_block))
        .route("/block/hash/:hash",        get(get_block_by_hash))
        .route("/blocks",                  get(get_blocks))
        // ── Transactions ──────────────────────────────────────────
        .route("/tx/submit",               post(submit_tx))
        .route("/tx/broadcast",            post(broadcast_tx))
        .route("/tx/:hash",                get(get_tx))
        .route("/address/:address/txs",    get(get_address_txs))
        // ── UTXO ──────────────────────────────────────────────────
        .route("/utxo/:address",           get(get_utxo_set))
        .route("/utxo/proof/:hash/:vout",  get(get_utxo_proof))
        // ── Mempool ───────────────────────────────────────────────
        .route("/mempool",                 get(get_mempool))
        // ── Mining ────────────────────────────────────────────────
        .route("/mining/info",             get(mining_info))
        .route("/mining/submit",           post(submit_block))
        // ── Stats & supply ────────────────────────────────────────
        .route("/stats",                   get(get_stats))
        .route("/supply",                  get(get_supply))
        // ── Fee estimation (EIP-1559 analog) ──────────────────────
        .route("/fee/estimate",            get(fee_estimate))
        // ── P2P peers ─────────────────────────────────────────────
        .route("/peers",                   get(get_peers))
        // ── Governance ────────────────────────────────────────────
        .route("/governance/proposals",    get(get_proposals))
        .route("/governance/propose",      post(create_proposal))
        .route("/governance/vote/:id",     post(cast_vote))
        .route("/governance/execute/:id",  post(execute_proposal))
        // ── Staking ───────────────────────────────────────────────
        .route("/staking/pools",           get(get_staking_pools))
        .route("/staking/stake",           post(stake))
        .route("/staking/unstake",         post(unstake))
        .route("/staking/claim",           post(claim_rewards))
        // ── Bridge ────────────────────────────────────────────────
        .route("/bridge/lock",             post(bridge_lock))
        .route("/bridge/status/:lock_id",  get(bridge_status))
        .route("/bridge/stats",            get(bridge_stats))
        .route("/bridge/verify-proof",     post(verify_mint_proof))
        .route("/bridge/relay-queue",      get(get_relay_queue))
        // ── Crypto (privacy transaction building) ────────────────
        .route("/crypto/stealth/generate", post(generate_stealth_output))
        .route("/crypto/ring-sign",        post(generate_ring_signature))
        .route("/crypto/commitment",       post(generate_commitment))
        .route("/crypto/range-proof",      post(generate_range_proof))
        // ── Oracle (multi-source price feed) ─────────────────────
        .route("/oracle/price/:pair",      get(oracle_price))
        // ── Shielded Pool (zk-STARK privacy pool) ─────────────
        .route("/shielded/deposit",          post(shielded_deposit))
        .route("/shielded/withdraw",         post(shielded_withdraw))
        .route("/shielded/verify",           post(shielded_verify))
        .route("/shielded/state",            get(shielded_pool_state))
        .route("/shielded/nullifier-check",  post(shielded_nullifier_check))
        .layer(cors)
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    info!("╔══════════════════════════════════════════════════════════╗");
    info!("║  HSMC RPC Node v0.3.0 — http://{}               ║", addr);
    info!("╠══════════════════════════════════════════════════════════╣");
    info!("║  Chain │ Tx │ UTXO │ Mempool │ Mining │ Stats │ Supply  ║");
    info!("║  Governance (propose/vote) │ Staking (stake/unstake)     ║");
    info!("║  Fee EIP-1559 │ Peers │ Bridge (BSC/ETH/MATIC/SOL/XMR)  ║");
    info!("╚══════════════════════════════════════════════════════════╝");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
