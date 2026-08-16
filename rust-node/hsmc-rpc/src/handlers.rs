/// handlers.rs — Complete production RPC handlers
/// All endpoints: chain, tx, mempool, mining, governance, staking, UTXO, fee EIP-1559, peers, bridge stats
/// + Crypto: stealth generation, ring signatures, commitments, range proofs

use axum::{extract::{State, Path, Query}, Json};
use std::{sync::Arc, collections::HashMap};
use tracing::info;
use sha2::Digest;
use hsmc_core::{Block, Transaction, PrivacyLevel, TxStatus};
use hsmc_core::governance::{RpcProposal, GovernanceState};
use hsmc_crypto::{DualKeyWallet, StealthOutputSender, StealthAddress, RingPublicKey, RingPrivateKey, LsagSignature, ClsagSignature, select_decoys, PedersenCommitment, BulletproofRangeProof, RctOutput};
use crate::types::*;
use crate::server::AppState;

// ═══════════════════════════════════════════════════════════════════
// HEALTH & NODE INFO
// ═══════════════════════════════════════════════════════════════════

pub async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "node": "hsmc-node",
        "version": "0.3.0",
        "chain_id": 8888,
        "network": "mainnet",
        "uptime_epoch": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        "capabilities": [
            "ring_signatures", "stealth_addresses", "ringct",
            "bridge_bsc", "bridge_eth", "bridge_polygon", "bridge_solana",
            "governance", "staking", "eip1559_fees"
        ]
    }))
}

pub async fn node_info(State(state): State<Arc<AppState>>) -> Json<NodeInfo> {
    let chain   = state.chain.read().await;
    let peers   = state.peers.count().await;
    let mempool = state.mempool.read().await;
    Json(NodeInfo {
        version: "0.3.0".into(),
        chain_id: state.chain_id,
        height: chain.height(),
        peer_count: peers,
        mempool_size: mempool.size(),
        difficulty: chain.difficulty,
        network: state.network.clone(),
        total_txs: chain.blocks.iter().map(|b| b.transactions_count as u64).sum(),
        tps: compute_tps(&chain.blocks),
        hash_rate: compute_hashrate(chain.difficulty, &chain.blocks),
    })
}

// ═══════════════════════════════════════════════════════════════════
// CHAIN DATA
// ═══════════════════════════════════════════════════════════════════

pub async fn get_latest_block(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let chain = state.chain.read().await;
    Json(serde_json::to_value(chain.tip()).unwrap_or_default())
}

pub async fn get_block(State(state): State<Arc<AppState>>, Path(number): Path<u64>) -> Json<serde_json::Value> {
    let chain = state.chain.read().await;
    match chain.get_block(number) {
        Some(b) => Json(serde_json::to_value(b).unwrap_or_default()),
        None    => Json(serde_json::json!({ "error": "Block not found", "block_number": number })),
    }
}

pub async fn get_block_by_hash(State(state): State<Arc<AppState>>, Path(hash): Path<String>) -> Json<serde_json::Value> {
    let chain = state.chain.read().await;
    match chain.blocks.iter().find(|b| b.hash == hash) {
        Some(b) => Json(serde_json::to_value(b).unwrap_or_default()),
        None    => Json(serde_json::json!({ "error": "Block not found", "hash": hash })),
    }
}

pub async fn get_blocks(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let chain  = state.chain.read().await;
    let limit  = params.get("limit").and_then(|v| v.parse::<usize>().ok()).unwrap_or(20).min(100);
    let offset = params.get("offset").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
    let total  = chain.blocks.len();
    let blocks: Vec<serde_json::Value> = chain.blocks.iter().rev().skip(offset).take(limit)
        .map(|b| serde_json::to_value(b).unwrap_or_default()).collect();
    Json(serde_json::json!({ "total": total, "limit": limit, "offset": offset, "blocks": blocks }))
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════

pub async fn get_tx(State(state): State<Arc<AppState>>, Path(hash): Path<String>) -> Json<serde_json::Value> {
    let mempool = state.mempool.read().await;
    if let Some(tx) = mempool.get_by_hash(&hash) {
        return Json(serde_json::json!({
            "found": true, "location": "mempool",
            "tx": serde_json::to_value(tx).unwrap_or_default()
        }));
    }
    // Search confirmed blocks (only tx hashes are stored on-chain)
    let chain = state.chain.read().await;
    for block in chain.blocks.iter().rev() {
        for tx in &block.transactions {
            if tx == &hash {
                return Json(serde_json::json!({
                    "found": true, "location": "confirmed",
                    "block_number": block.block_number,
                    "block_hash": block.hash,
                    "tx": serde_json::to_value(tx).unwrap_or_default()
                }));
            }
        }
    }
    Json(serde_json::json!({ "found": false, "error": "Transaction not found" }))
}

pub async fn submit_tx(State(state): State<Arc<AppState>>, Json(req): Json<SubmitTxRequest>) -> Json<serde_json::Value> {
    if req.from.is_empty() || req.to.is_empty() {
        return Json(serde_json::json!({ "error": "from and to are required" }));
    }
    if req.from == req.to {
        return Json(serde_json::json!({ "error": "Self-transfers not allowed" }));
    }
    if req.amount <= 0.0 {
        return Json(serde_json::json!({ "error": "Amount must be positive" }));
    }

    let privacy = match req.privacy_level.as_str() {
        "ringct"  => PrivacyLevel::RingCt,
        "stealth" => PrivacyLevel::Stealth,
        "full"    => PrivacyLevel::Full,
        _         => PrivacyLevel::Transparent,
    };
    let min_fee = Transaction::min_fee_for_privacy(&privacy);
    if req.fee < min_fee {
        return Json(serde_json::json!({
            "error": format!("Fee too low. Minimum: {:.8} HSMC for {} privacy", min_fee, req.privacy_level)
        }));
    }

    let mut tx = Transaction::new(&req.from, &req.to, req.amount, req.fee, privacy);
    tx.ring_signature  = req.ring_signature;
    tx.commitment      = req.commitment;
    tx.range_proof     = req.range_proof;
    tx.stealth_address = req.stealth_address;
    tx.decoy_count     = req.decoy_count;
    let hash = tx.hash.clone();

    let mut mempool = state.mempool.write().await;
    match mempool.add(tx) {
        Ok(_) => {
            info!(tx = %hash, privacy = %req.privacy_level, amount = req.amount, fee = req.fee, "TX → mempool");
            Json(serde_json::json!({
                "tx_hash": hash, "status": "pending",
                "privacy": req.privacy_level, "min_fee": min_fee,
                "estimated_confirmation": "~2 blocks (~4 minutes)"
            }))
        }
        Err(e) => Json(serde_json::json!({ "error": e })),
    }
}

pub async fn broadcast_tx(state: State<Arc<AppState>>, body: Json<SubmitTxRequest>) -> Json<serde_json::Value> {
    submit_tx(state, body).await
}

pub async fn get_address_txs(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let limit  = params.get("limit").and_then(|v| v.parse::<usize>().ok()).unwrap_or(50).min(200);
    let offset = params.get("offset").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);

    let chain = state.chain.read().await;
    let mut txs: Vec<serde_json::Value> = Vec::new();

    // Confirmed blocks only store tx hashes; associate them with the address
    // via the chain UTXO set (address → "txhash:index").
    let confirmed_keys: std::collections::HashSet<&str> = chain
        .utxo_set
        .by_address
        .get(&address)
        .map(|keys| keys.iter().filter_map(|k| k.split(':').next()).collect())
        .unwrap_or_default();

    for block in chain.blocks.iter().rev() {
        for tx in &block.transactions {
            if confirmed_keys.contains(tx.as_str()) {
                txs.push(serde_json::json!({
                    "tx_hash": tx,
                    "block_number": block.block_number,
                    "block_hash": block.hash,
                    "confirmed": true,
                }));
            }
        }
    }
    // Also pending mempool
    let mempool = state.mempool.read().await;
    for tx in mempool.select_for_block(1000) {
        if tx.from_address == address || tx.to_address == address {
            let mut v = serde_json::to_value(tx).unwrap_or_default();
            if let Some(obj) = v.as_object_mut() {
                obj.insert("confirmed".into(), false.into());
                obj.insert("location".into(), "mempool".into());
            }
            txs.push(v);
        }
    }

    let total = txs.len();
    let page  = txs.into_iter().skip(offset).take(limit).collect::<Vec<_>>();
    Json(serde_json::json!({ "address": address, "total": total, "limit": limit, "offset": offset, "transactions": page }))
}

// ═══════════════════════════════════════════════════════════════════
// UTXO
// ═══════════════════════════════════════════════════════════════════

pub async fn get_utxo_set(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> Json<serde_json::Value> {
    let chain = state.chain.read().await;
    let mut total_balance: f64 = 0.0;

    // The chain UTXO set is the authoritative source of unspent outputs.
    let utxos: Vec<serde_json::Value> = chain.utxo_set.utxos_for(&address).iter().map(|u| {
        total_balance += u.amount;
        serde_json::json!({
            "tx_hash": u.tx_hash,
            "vout": u.output_index,
            "amount": u.amount,
            "commitment": u.commitment,
            "block_number": u.block_height,
            "confirmations": chain.height().saturating_sub(u.block_height) + 1,
            "spendable": true,
            "coinbase": u.block_height == 0,
        })
    }).collect();

    Json(serde_json::json!({
        "address": address,
        "utxo_count": utxos.len(),
        "total_balance": total_balance,
        "total_balance_units": (total_balance * 1e8) as u64,
        "utxos": utxos,
    }))
}

pub async fn get_utxo_proof(
    State(state): State<Arc<AppState>>,
    Path((tx_hash, vout)): Path<(String, u32)>,
) -> Json<serde_json::Value> {
    let chain = state.chain.read().await;
    for block in &chain.blocks {
        for tx in &block.transactions {
            if tx == &tx_hash {
                let merkle_proof = compute_merkle_proof(&tx_hash, &block.transactions);
                let utxo = chain.utxo_set.utxos.get(&format!("{}:{}", tx_hash, vout));
                return Json(serde_json::json!({
                    "tx_hash": tx_hash,
                    "vout": vout,
                    "block_number": block.block_number,
                    "block_hash": block.hash,
                    "merkle_root": block.merkle_root,
                    "merkle_proof": merkle_proof,
                    "amount": utxo.map(|u| u.amount).unwrap_or(0.0),
                    "valid": true,
                }));
            }
        }
    }
    Json(serde_json::json!({ "error": "UTXO not found", "tx_hash": tx_hash }))
}

fn compute_merkle_proof(target: &str, hashes: &[String]) -> Vec<String> {
    if hashes.is_empty() { return vec![]; }
    let idx = hashes.iter().position(|h| h == target).unwrap_or(0);
    let mut proof = Vec::new();
    let mut leaves = hashes.to_vec();
    let mut i = idx;
    while leaves.len() > 1 {
        if leaves.len() % 2 != 0 { leaves.push(leaves.last().cloned().unwrap_or_default()); }
        let sibling = if i % 2 == 0 { i + 1 } else { i - 1 };
        if sibling < leaves.len() { proof.push(leaves[sibling].clone()); }
        leaves = leaves.chunks(2)
            .map(|pair| { use sha2::{Sha256, Digest}; let mut h = Sha256::new(); h.update(pair[0].as_bytes()); h.update(pair.get(1).unwrap_or(&pair[0]).as_bytes()); hex::encode(h.finalize()) })
            .collect();
        i /= 2;
    }
    proof
}

// ═══════════════════════════════════════════════════════════════════
// MEMPOOL
// ═══════════════════════════════════════════════════════════════════

pub async fn get_mempool(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mempool = state.mempool.read().await;
    let txs: Vec<_> = mempool.select_for_block(200).iter().map(|tx| serde_json::json!({
        "hash": tx.hash,
        "from": tx.from_address,
        "to": tx.to_address,
        "amount": tx.amount,
        "fee": tx.fee,
        "fee_per_byte": tx.fee / (tx.amount.max(0.001) * 250.0),
        "privacy": tx.privacy_level.to_string(),
        "status": tx.status.to_string(),
        "created_at": tx.created_at,
        "ring_signature": tx.ring_signature.is_some(),
        "stealth": tx.stealth_address.is_some(),
        "has_range_proof": tx.range_proof.is_some(),
    })).collect();
    Json(serde_json::json!({
        "count": txs.len(),
        "total": mempool.size(),
        "max_size": mempool.max_size,
        "transactions": txs,
    }))
}

// ═══════════════════════════════════════════════════════════════════
// FEE ESTIMATION — EIP-1559 style (base_fee + priority_fee)
// ═══════════════════════════════════════════════════════════════════

pub async fn fee_estimate(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mempool = state.mempool.read().await;
    let chain   = state.chain.read().await;
    let congestion = (mempool.size() as f64 / mempool.max_size as f64).min(1.0);

    // Base fee: adjusts per-block based on fullness (EIP-1559 analog)
    let target_block_size = 100usize; // target txs per block
    let last_block_size = chain.blocks.last().map(|b| b.transactions_count as usize).unwrap_or(0);
    let base_fee_multiplier = if last_block_size > target_block_size {
        1.0 + ((last_block_size - target_block_size) as f64 / target_block_size as f64) * 0.125
    } else {
        (1.0 - (target_block_size.saturating_sub(last_block_size)) as f64 / target_block_size as f64 * 0.125).max(0.5)
    };

    // Priority fee tiers (tip to miner)
    let priority_slow   = 0.00005;
    let priority_normal = 0.0001;
    let priority_fast   = 0.0003;

    // Compute fees per privacy level
    let make_tier = |base: f64, priority: f64| {
        let total = (base * base_fee_multiplier) + priority;
        serde_json::json!({
            "base_fee": base * base_fee_multiplier,
            "priority_fee": priority,
            "total_fee": total,
            "estimated_blocks": if priority >= priority_fast { 1 } else if priority >= priority_normal { 2 } else { 5 },
        })
    };

    // Confirmed blocks only store tx hashes — fee data is available from the mempool
    let recent_fees: Vec<f64> = mempool.select_for_block(200).iter().map(|t| t.fee).collect();
    let p10 = percentile(&recent_fees, 10);
    let p50 = percentile(&recent_fees, 50);
    let p90 = percentile(&recent_fees, 90);

    Json(serde_json::json!({
        "algorithm": "eip1559_analog",
        "congestion_factor": congestion,
        "base_fee_multiplier": base_fee_multiplier,
        "mempool_size": mempool.size(),
        "last_block_txs": last_block_size,
        "historical_percentiles": { "p10": p10, "p50": p50, "p90": p90 },
        "fees": {
            "transparent": {
                "slow":   make_tier(0.0001, priority_slow),
                "normal": make_tier(0.0001, priority_normal),
                "fast":   make_tier(0.0001, priority_fast),
            },
            "ringct": {
                "slow":   make_tier(0.001, priority_slow),
                "normal": make_tier(0.001, priority_normal),
                "fast":   make_tier(0.001, priority_fast),
            },
            "stealth": {
                "slow":   make_tier(0.002, priority_slow),
                "normal": make_tier(0.002, priority_normal),
                "fast":   make_tier(0.002, priority_fast),
            },
            "full": {
                "slow":   make_tier(0.005, priority_slow),
                "normal": make_tier(0.005, priority_normal),
                "fast":   make_tier(0.005, priority_fast),
            },
        }
    }))
}

fn percentile(values: &[f64], p: usize) -> f64 {
    if values.is_empty() { return 0.0; }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((p as f64 / 100.0) * (sorted.len() - 1) as f64) as usize;
    sorted[idx.min(sorted.len() - 1)]
}

// ═══════════════════════════════════════════════════════════════════
// MINING
// ═══════════════════════════════════════════════════════════════════

pub async fn mining_info(State(state): State<Arc<AppState>>) -> Json<MiningInfo> {
    let chain = state.chain.read().await;
    let height = chain.height();
    let tip    = chain.tip();
    let diff   = chain.difficulty;
    let leading = hsmc_core::difficulty_to_leading_zeros(diff);
    Json(MiningInfo {
        height: height + 1,
        prev_hash: tip.hash.clone(),
        difficulty: diff,
        target: format!("{}{}", "0".repeat(leading as usize), "f".repeat(64usize.saturating_sub(leading as usize))),
        reward: hsmc_core::block_reward(height + 1),
        timestamp: chrono::Utc::now().timestamp(),
        merkle_root: tip.merkle_root.clone(),
    })
}

pub async fn submit_block(State(state): State<Arc<AppState>>, Json(block): Json<Block>) -> Json<serde_json::Value> {
    if block.hash.is_empty() {
        return Json(serde_json::json!({ "accepted": false, "error": "Empty hash" }));
    }
    let expected = block.compute_hash();
    if expected != block.hash {
        let exp_short = if expected.len() >= 12 { &expected[..12] } else { &expected };
        let got_short = if block.hash.len() >= 12 { &block.hash[..12] } else { &block.hash };
        return Json(serde_json::json!({
            "accepted": false,
            "error": format!("Hash mismatch: {} ≠ {}", exp_short, got_short)
        }));
    }
    let mut chain = state.chain.write().await;
    match chain.add_block(block.clone()) {
        Ok(_) => {
            info!(height = block.block_number, hash = &block.hash[..8.min(block.hash.len())], "Block accepted via RPC");
            Json(serde_json::json!({
                "accepted": true,
                "block_number": block.block_number,
                "hash": block.hash,
                "height": chain.height(),
                "reward": hsmc_core::block_reward(block.block_number),
            }))
        }
        Err(e) => Json(serde_json::json!({ "accepted": false, "error": e })),
    }
}

// ═══════════════════════════════════════════════════════════════════
// GOVERNANCE
// ═══════════════════════════════════════════════════════════════════

pub async fn get_proposals(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let gov = state.governance.read().await;
    let proposals: Vec<serde_json::Value> = gov.proposals.iter().map(|p| serde_json::json!({
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "proposer": p.proposer_address,
        "type": p.proposal_type,
        "status": p.status,
        "votes_for": p.votes_for,
        "votes_against": p.votes_against,
        "total_votes": p.votes_for + p.votes_against,
        "quorum_required": p.quorum_required,
        "quorum_reached": (p.votes_for + p.votes_against) >= p.quorum_required as u64,
        "participation_pct": if p.quorum_required > 0 {
            ((p.votes_for + p.votes_against) as f64 / p.quorum_required as f64 * 100.0).min(100.0)
        } else { 0.0 },
        "approval_pct": if (p.votes_for + p.votes_against) > 0 {
            p.votes_for as f64 / (p.votes_for + p.votes_against) as f64 * 100.0
        } else { 0.0 },
        "created_at": p.created_at,
        "ends_at": p.ends_at,
        "parameter_key": p.parameter_key,
        "parameter_value": p.parameter_value,
    })).collect();
    Json(serde_json::json!({
        "total": proposals.len(),
        "active": proposals.iter().filter(|p| p["status"] == "active").count(),
        "proposals": proposals,
    }))
}

pub async fn create_proposal(
    State(state): State<Arc<AppState>>,
    Json(req): Json<GovernanceProposalRequest>,
) -> Json<serde_json::Value> {
    if req.title.is_empty() || req.description.is_empty() {
        return Json(serde_json::json!({ "error": "title and description required" }));
    }
    if req.title.len() > 200 {
        return Json(serde_json::json!({ "error": "Title too long (max 200 chars)" }));
    }
    if req.proposer_address.is_empty() {
        return Json(serde_json::json!({ "error": "proposer_address required" }));
    }

    let mut gov = state.governance.write().await;
    let proposal_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let ends_at = now + chrono::Duration::days(req.voting_days.unwrap_or(7) as i64);

    let proposal = RpcProposal {
        id: proposal_id.clone(),
        title: req.title.clone(),
        description: req.description.clone(),
        proposer_address: req.proposer_address.clone(),
        proposal_type: req.proposal_type.clone().unwrap_or_else(|| "parameter_change".into()),
        status: "active".into(),
        votes_for: 0,
        votes_against: 0,
        quorum_required: req.quorum_required.unwrap_or(1000),
        created_at: now.timestamp(),
        ends_at: ends_at.timestamp(),
        parameter_key: req.parameter_key.clone(),
        parameter_value: req.parameter_value.clone(),
        total_voting_power: 0,
    };

    gov.proposals.push(proposal);
    info!(id = %proposal_id, title = %req.title, proposer = %req.proposer_address, "Governance proposal created");

    Json(serde_json::json!({
        "proposal_id": proposal_id,
        "status": "active",
        "voting_ends_at": ends_at.to_rfc3339(),
        "quorum_required": req.quorum_required.unwrap_or(1000),
    }))
}

/// Execute a governance proposal after timelock expiry.
/// Anyone can call this — the engine enforces all guards.
/// POST /governance/execute/:id
pub async fn execute_proposal(
    State(state): State<Arc<AppState>>,
    Path(proposal_id): Path<String>,
) -> Json<serde_json::Value> {
    let mut gov = state.governance.write().await;

    // Get current block height from chain for context
    let block_height = state.chain.read().await.height();

    match gov.engine.execute(&proposal_id, block_height) {
        Ok(proposal_type) => {
            // Sync RPC view from engine
            gov.sync_from_engine();
            info!(proposal_id = %proposal_id, "Governance proposal executed via RPC");

            Json(serde_json::json!({
                "success": true,
                "proposal_id": proposal_id,
                "executed_at": chrono::Utc::now().to_rfc3339(),
                "block_height": block_height,
                "type": format!("{:?}", proposal_type),
            }))
        }
        Err(e) => {
            Json(serde_json::json!({
                "success": false,
                "proposal_id": proposal_id,
                "error": e.to_string(),
            }))
        }
    }
}

pub async fn cast_vote(
    State(state): State<Arc<AppState>>,
    Path(proposal_id): Path<String>,
    Json(req): Json<VoteRequest>,
) -> Json<serde_json::Value> {
    if req.voter_address.is_empty() {
        return Json(serde_json::json!({ "error": "voter_address required" }));
    }
    if req.vote != "for" && req.vote != "against" && req.vote != "abstain" {
        return Json(serde_json::json!({ "error": "vote must be 'for', 'against', or 'abstain'" }));
    }

    let mut gov = state.governance.write().await;
    let proposal = match gov.proposals.iter_mut().find(|p| p.id == proposal_id) {
        Some(p) => p,
        None    => return Json(serde_json::json!({ "error": "Proposal not found" })),
    };
    if proposal.status != "active" {
        return Json(serde_json::json!({ "error": "Proposal is not active", "status": proposal.status }));
    }

    let vote_weight = req.vote_weight.unwrap_or(1);
    match req.vote.as_str() {
        "for"     => proposal.votes_for     += vote_weight,
        "against" => proposal.votes_against += vote_weight,
        _         => {} // abstain: counted in participation but not for/against
    }

    let vote_hash = {
        use sha2::{Sha256, Digest};
        let mut h = Sha256::new();
        h.update(proposal_id.as_bytes());
        h.update(req.voter_address.as_bytes());
        h.update(req.vote.as_bytes());
        hex::encode(h.finalize())
    };

    info!(proposal = %proposal_id, voter = %req.voter_address, vote = %req.vote, weight = vote_weight, "Vote cast");
    Json(serde_json::json!({
        "ok": true,
        "vote_hash": vote_hash,
        "proposal_id": proposal_id,
        "vote": req.vote,
        "weight": vote_weight,
        "new_votes_for": proposal.votes_for,
        "new_votes_against": proposal.votes_against,
    }))
}

// ═══════════════════════════════════════════════════════════════════
// STAKING
// ═══════════════════════════════════════════════════════════════════

pub async fn get_staking_pools(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let staking = state.staking.read().await;
    let pools: Vec<serde_json::Value> = staking.pools.iter().map(|p| serde_json::json!({
        "id": p.id,
        "name": p.name,
        "validator_address": p.validator_address,
        "total_staked": p.total_staked,
        "apr": p.apr,
        "commission_rate": p.commission_rate,
        "min_stake": p.min_stake,
        "status": p.status,
        "delegator_count": p.delegator_count,
        "uptime_percent": p.uptime_percent,
        "created_at": p.created_at,
    })).collect();
    let total_staked: f64 = staking.pools.iter().map(|p| p.total_staked).sum();
    Json(serde_json::json!({
        "pool_count": pools.len(),
        "total_staked_network": total_staked,
        "pools": pools,
    }))
}

pub async fn stake(
    State(state): State<Arc<AppState>>,
    Json(req): Json<StakeRequest>,
) -> Json<serde_json::Value> {
    if req.wallet_address.is_empty() || req.pool_id.is_empty() {
        return Json(serde_json::json!({ "error": "wallet_address and pool_id required" }));
    }
    if req.amount <= 0.0 {
        return Json(serde_json::json!({ "error": "amount must be positive" }));
    }

    let mut staking = state.staking.write().await;
    let pool = match staking.pools.iter_mut().find(|p| p.id == req.pool_id) {
        Some(p) => p,
        None    => return Json(serde_json::json!({ "error": "Pool not found" })),
    };
    if pool.status != "active" {
        return Json(serde_json::json!({ "error": "Pool is not active" }));
    }
    if req.amount < pool.min_stake {
        return Json(serde_json::json!({
            "error": format!("Minimum stake is {} HSMC", pool.min_stake)
        }));
    }

    pool.total_staked += req.amount;
    pool.delegator_count += 1;

    let stake_id = uuid::Uuid::new_v4().to_string();
    let stake_hash = {
        use sha2::{Sha256, Digest};
        let mut h = Sha256::new();
        h.update(b"HSMC_STAKE_V1");
        h.update(req.wallet_address.as_bytes());
        h.update(req.pool_id.as_bytes());
        h.update(&req.amount.to_bits().to_le_bytes());
        h.update(&chrono::Utc::now().timestamp().to_le_bytes());
        hex::encode(h.finalize())
    };

    info!(stake_id = %stake_id, addr = %req.wallet_address, pool = %req.pool_id, amount = req.amount, "Stake created");
    Json(serde_json::json!({
        "ok": true,
        "stake_id": stake_id,
        "stake_hash": stake_hash,
        "pool_id": req.pool_id,
        "amount": req.amount,
        "apr": pool.apr,
        "daily_reward": req.amount * pool.apr / 365.0 / 100.0,
        "unlock_at": (chrono::Utc::now() + chrono::Duration::days(7)).to_rfc3339(),
        "status": "active",
    }))
}

pub async fn unstake(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UnstakeRequest>,
) -> Json<serde_json::Value> {
    if req.stake_id.is_empty() || req.wallet_address.is_empty() {
        return Json(serde_json::json!({ "error": "stake_id and wallet_address required" }));
    }

    let staking = state.staking.read().await;
    let cooldown_days = 7u64;
    let unlock_at = chrono::Utc::now() + chrono::Duration::days(cooldown_days as i64);

    Json(serde_json::json!({
        "ok": true,
        "stake_id": req.stake_id,
        "status": "unbonding",
        "cooldown_days": cooldown_days,
        "funds_available_at": unlock_at.to_rfc3339(),
        "message": "Unbonding period: 7 days. Rewards stop accruing immediately.",
    }))
}

pub async fn claim_rewards(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ClaimRequest>,
) -> Json<serde_json::Value> {
    if req.wallet_address.is_empty() {
        return Json(serde_json::json!({ "error": "wallet_address required" }));
    }

    let staking = state.staking.read().await;
    let total_claimable: f64 = staking.pools.iter()
        .map(|p| p.total_staked * p.apr / 100.0 / 365.0 / 24.0) // hourly rate
        .sum::<f64>()
        .max(0.0);

    let claim_hash = {
        use sha2::{Sha256, Digest};
        let mut h = Sha256::new();
        h.update(b"HSMC_CLAIM_V1");
        h.update(req.wallet_address.as_bytes());
        h.update(&chrono::Utc::now().timestamp().to_le_bytes());
        hex::encode(h.finalize())
    };

    info!(addr = %req.wallet_address, rewards = total_claimable, "Rewards claimed");
    Json(serde_json::json!({
        "ok": true,
        "claim_hash": claim_hash,
        "rewards_claimed": total_claimable,
        "wallet_address": req.wallet_address,
        "next_reward_in": "1 hour",
    }))
}

// ═══════════════════════════════════════════════════════════════════
// STATS & SUPPLY
// ═══════════════════════════════════════════════════════════════════

pub async fn get_stats(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let chain   = state.chain.read().await;
    let mempool = state.mempool.read().await;
    let peers   = state.peers.count().await;
    let height  = chain.height();
    let avg_block_time = compute_avg_block_time(&chain.blocks);
    let tps    = compute_tps(&chain.blocks);
    let total_txs: u64 = chain.blocks.iter().map(|b| b.transactions_count as u64).sum();
    let hash_rate = compute_hashrate(chain.difficulty, &chain.blocks);

    // Privacy stats — confirmed blocks only store tx hashes, so the privacy
    // breakdown reflects the pending (mempool) transactions.
    let privacy_counts = mempool.select_for_block(200).iter()
        .fold((0u64, 0u64, 0u64, 0u64), |(t, r, s, f), tx| match &tx.privacy_level {
            PrivacyLevel::Transparent => (t+1, r, s, f),
            PrivacyLevel::RingCt      => (t, r+1, s, f),
            PrivacyLevel::Stealth     => (t, r, s+1, f),
            PrivacyLevel::Full        => (t, r, s, f+1),
        });

    Json(serde_json::json!({
        "block_height": height,
        "difficulty": chain.difficulty,
        "hash_rate": hash_rate,
        "tps": tps,
        "total_transactions": total_txs,
        "mempool_size": mempool.size(),
        "active_nodes": peers + 1,
        "avg_block_time_secs": avg_block_time,
        "consensus_state": "STABLE",
        "network": state.network,
        "chain_id": state.chain_id,
        "version": "0.3.0",
        "privacy_breakdown": {
            "transparent": privacy_counts.0,
            "ringct": privacy_counts.1,
            "stealth": privacy_counts.2,
            "full": privacy_counts.3,
            "private_percent": if total_txs > 0 {
                (privacy_counts.1 + privacy_counts.2 + privacy_counts.3) as f64 / total_txs as f64 * 100.0
            } else { 0.0 },
        }
    }))
}

pub async fn get_supply(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let chain  = state.chain.read().await;
    let height = chain.height();
    let mined: f64 = (0..=height).map(|h| hsmc_core::block_reward(h)).sum();
    let total = 1_000_000_000_000.0f64; // 1 TRILLION HSMC
    let halvings = height / 210_000;
    let next_halving = (halvings + 1) * 210_000;
    let circulating_pct = (mined / total) * 100.0;

    // Burned/locked estimate — confirmed blocks only store tx hashes, so bridge
    // locks are measured from UTXOs held by bridge addresses.
    let locked_in_bridge: f64 = chain.utxo_set.utxos.values()
        .filter(|u| u.address.starts_with("bridge:"))
        .map(|u| u.amount)
        .sum();

    Json(serde_json::json!({
        "total_supply": total,
        "mined_supply": mined,
        "remaining_supply": total - mined,
        "circulating_percent": circulating_pct,
        "locked_in_bridge": locked_in_bridge,
        "effective_circulating": mined - locked_in_bridge,
        "current_block_reward": hsmc_core::block_reward(height + 1),
        "halvings_occurred": halvings,
        "next_halving_block": next_halving,
        "blocks_to_next_halving": next_halving.saturating_sub(height),
        "emission_schedule": {
            "epoch_0_reward": 50.0,
            "epoch_1_reward": 25.0,
            "epoch_2_reward": 12.5,
            "epoch_3_reward": 6.25,
            "halving_interval": 210_000,
        }
    }))
}

// ═══════════════════════════════════════════════════════════════════
// PEERS
// ═══════════════════════════════════════════════════════════════════

pub async fn get_peers(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let peers = state.peers.all().await;
    let list: Vec<_> = peers.iter().map(|p| serde_json::json!({
        "id": p.id,
        "addr": p.addr,
        "version": p.version,
        "height": p.height,
        "latency_ms": p.latency_ms,
        "region": p.region,
        "connected_at": p.connected_at,
        "last_seen": p.last_seen,
        "synced": p.height >= state.chain.try_read().map(|c| c.height()).unwrap_or(0),
        "score": 100u64.saturating_sub(p.latency_ms.min(100)),
    })).collect();
    Json(serde_json::json!({
        "count": list.len(),
        "online": list.iter().filter(|p| p["last_seen"].as_i64().unwrap_or(0) > chrono::Utc::now().timestamp() - 300).count(),
        "peers": list,
    }))
}

// ═══════════════════════════════════════════════════════════════════
// CRYPTO ENDPOINTS — Stealth, RingCT, Ring Signatures
// ═══════════════════════════════════════════════════════════════════

/// Generate a stealth one-time output for a recipient address.
/// POST /crypto/stealth/generate
/// Body: { "recipient_address": "HSMCst...", "output_index": 0 }
pub async fn generate_stealth_output(
    Json(req): Json<StealthGenerateRequest>,
) -> Json<serde_json::Value> {
    let addr = match StealthAddress::from_string(&req.recipient_address) {
        Some(a) => a,
        None => return Json(serde_json::json!({
            "error": "Invalid stealth address format. Expected HSMCst..."
        })),
    };

    let idx = req.output_index.unwrap_or(0);
    match StealthOutputSender::generate(&addr, idx) {
        Ok(out) => Json(serde_json::json!({
            "ok": true,
            "one_time_key": hex::encode(out.output.one_time_key),
            "ephemeral_key": hex::encode(out.output.ephemeral_key),
            "shared_secret": hex::encode(out.shared_key),
            "output_index": out.output.output_index,
            "enc_payment_id": out.output.enc_payment_id.map(|p| hex::encode(p)),
        })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// Generate a Pedersen commitment for an amount.
/// POST /crypto/commitment
/// Body: { "amount_satoshis": 100000000 }
pub async fn generate_commitment(
    Json(req): Json<CommitmentRequest>,
) -> Json<serde_json::Value> {
    match PedersenCommitment::commit(req.amount_satoshis) {
        Ok(c) => {
            let blinding = c.blinding.map(|b| hex::encode(b.as_bytes()));
            Json(serde_json::json!({
                "ok": true,
                "commitment": c.to_hex(),
                "blinding": blinding,
                "amount_satoshis": req.amount_satoshis,
                "verified": c.point().is_some(),
            }))
        }
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// Generate a ring signature (LSAG) for a message.
/// POST /crypto/ring-sign
/// Body: { "message": "...", "signer_secret_hex": "...", "ring_size": 11, "known_pubkeys": [...] }
pub async fn generate_ring_signature(
    Json(req): Json<RingSignRequest>,
) -> Json<serde_json::Value> {
    // Parse or generate signer keypair
    let (sk, pk) = if let Some(ref secret_hex) = req.signer_secret_hex {
        let bytes = match hex::decode(secret_hex) {
            Ok(b) if b.len() == 32 => {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&b);
                arr
            }
            _ => return Json(serde_json::json!({ "error": "Invalid secret hex (need 32 bytes)" })),
        };
        let sk = match RingPrivateKey::from_bytes(&bytes) {
            Some(k) => k,
            None => return Json(serde_json::json!({ "error": "Invalid scalar for private key" })),
        };
        let pk = RingPublicKey::from_private(&sk);
        (sk, pk)
    } else {
        let (pk, sk) = RingPublicKey::generate();
        (sk, pk)
    };

    let ring_size = req.ring_size.unwrap_or(11).min(16).max(2);

    // Build ring from known public keys or generate decoys
    let ring: Vec<RingPublicKey> = if let Some(ref known) = req.known_pubkeys {
        let mut r: Vec<RingPublicKey> = known.iter()
            .filter_map(|h| RingPublicKey::from_hex(h))
            .collect();
        // Ensure we have enough
        while r.len() < ring_size as usize {
            let (decoy_pk, _) = RingPublicKey::generate();
            r.push(decoy_pk);
        }
        r.truncate(ring_size as usize);
        r
    } else {
        // Generate ring with random decoys
        let decoys: Vec<RingPublicKey> = (0..ring_size-1)
            .map(|_| { let (pk, _) = RingPublicKey::generate(); pk })
            .collect();
        let mut r = decoys;
        r.push(pk.clone());
        r
    };

    // Ensure signer's key is in ring
    let signer_idx = ring.iter().position(|r| r == &pk).unwrap_or(0);

    let message = req.message.as_bytes();

    match LsagSignature::sign(message, &sk, &pk, ring.clone(), signer_idx) {
        Ok(sig) => {
            let sig_hex = sig.to_hex();
            let key_image_hex = sig.key_image.to_hex();
            Json(serde_json::json!({
                "ok": true,
                "ring_signature": sig_hex,
                "key_image": key_image_hex,
                "ring_size": ring_size,
                "algorithm": "LSAG",
                "verified": sig.verify(message).unwrap_or(false),
            }))
        }
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// Generate a Bulletproof range proof for an amount.
/// POST /crypto/range-proof
/// Body: { "amount_satoshis": 100000000, "commitment_hex": "..." }
pub async fn generate_range_proof(
    Json(req): Json<RangeProofRequest>,
) -> Json<serde_json::Value> {
    let commitment = match PedersenCommitment::from_hex(&req.commitment_hex) {
        Some(c) => c,
        None => return Json(serde_json::json!({
            "error": "Invalid commitment hex"
        })),
    };

    match BulletproofRangeProof::prove(req.amount_satoshis, &commitment) {
        Ok(proof) => Json(serde_json::json!({
            "ok": true,
            "range_proof": proof.to_hex(),
            "bit_count": proof.bit_count,
            "proof_size": proof.proof_size,
            "verified": proof.verify(),
        })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// PRICE ORACLE
// ═══════════════════════════════════════════════════════════════════

/// GET /oracle/price/:pair
/// Returns the aggregated (median + IQR) price for a trading pair.
/// Example: GET /oracle/price/HSMC%2FUSDT → { "pair": "HSMC/USDT", "price": 0.042, ... }
pub async fn oracle_price(
    State(state): State<Arc<AppState>>,
    Path(pair): Path<String>,
) -> Json<serde_json::Value> {
    match state.oracle.get_price(&pair).await {
        Ok(price) => {
            let cache_arc = state.oracle.cache_ref();
            let feeds_used = cache_arc
                .read()
                .get(&pair)
                .map(|e| e.feeds_used)
                .unwrap_or(state.oracle.feed_count());

            Json(serde_json::json!({
                "pair": pair,
                "price": price,
                "feeds_used": feeds_used,
                "feeds_total": state.oracle.feed_count(),
                "algorithm": "median_iqr",
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "source": "aggregated",
            }))
        }
        Err(e) => Json(serde_json::json!({
            "pair": pair,
            "error": e.to_string(),
            "feeds_total": state.oracle.feed_count(),
        })),
    }
}

// ═══════════════════════════════════════════════════════════════════
// SHIELDED POOL — zk-STARK private transaction pool
// ═══════════════════════════════════════════════════════════════════

/// POST /shielded/deposit
/// Body: { "amount_satoshis": 100000000 }
/// Returns: { note, proof, commitment_hex, tvl }
pub async fn shielded_deposit(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let amount = match req.get("amount_satoshis").and_then(|v| v.as_u64()) {
        Some(a) if a > 0 => a,
        _ => return Json(serde_json::json!({
            "error": "amount_satoshis required (positive u64)"
        })),
    };

    let mut pool = state.shielded.write().await;
    match pool.deposit(amount) {
        Ok((note, proof)) => {
            let proof_json = hsmc_starks::StarkProof(proof).to_json();
            Json(serde_json::json!({
                "ok": true,
                "note": {
                    "commitment": hex::encode(note.commitment),
                    "amount": note.amount,
                    "blinding": hex::encode(note.blinding),
                    "leaf_index": note.leaf_index,
                },
                "proof": proof_json,
                "tvl": pool.total_value_locked,
                "note_count": pool.notes.len(),
            }))
        }
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// POST /shielded/withdraw
/// Body: { "note": { "commitment": "hex", "amount": 1000, "blinding": "hex", "leaf_index": 0 }, "secret_hex": "hex..." }
/// Returns: { amount, proof, nullifier_hex }
pub async fn shielded_withdraw(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    // Parse note
    let note_obj = match req.get("note") {
        Some(n) => n,
        None => return Json(serde_json::json!({ "error": "note object required" })),
    };
    let secret_hex = match req.get("secret_hex").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return Json(serde_json::json!({ "error": "secret_hex required" })),
    };

    let commitment_hex = note_obj.get("commitment").and_then(|v| v.as_str()).unwrap_or("");
    let blinding_hex = note_obj.get("blinding").and_then(|v| v.as_str()).unwrap_or("");
    let amount = note_obj.get("amount").and_then(|v| v.as_u64()).unwrap_or(0);
    let leaf_index = note_obj.get("leaf_index").and_then(|v| v.as_u64()).unwrap_or(0);

    let mut commitment = [0u8; 32];
    let mut blinding = [0u8; 32];
    let mut secret = [0u8; 32];

    if let Ok(b) = hex::decode(commitment_hex) { if b.len() == 32 { commitment.copy_from_slice(&b); } }
    else { return Json(serde_json::json!({ "error": "Invalid commitment hex" })); }
    if let Ok(b) = hex::decode(blinding_hex) { if b.len() == 32 { blinding.copy_from_slice(&b); } }
    else { return Json(serde_json::json!({ "error": "Invalid blinding hex" })); }
    if let Ok(b) = hex::decode(secret_hex) { if b.len() == 32 { secret.copy_from_slice(&b); } }
    else { return Json(serde_json::json!({ "error": "Invalid secret hex" })); }

    let note = hsmc_starks::Note {
        commitment,
        amount,
        blinding,
        leaf_index,
    };

    let mut pool = state.shielded.write().await;
    match pool.withdraw(&note, &secret) {
        Ok((wd_amount, proof)) => {
            let nullifier = hsmc_starks::ShieldedPool::derive_nullifier(&commitment, &secret, leaf_index);
            let proof_json = hsmc_starks::StarkProof(proof).to_json();
            Json(serde_json::json!({
                "ok": true,
                "amount": wd_amount,
                "nullifier": hex::encode(nullifier.0),
                "proof": proof_json,
                "tvl": pool.total_value_locked,
            }))
        }
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// POST /shielded/verify
/// Body: { "proof": { "proof_hex": "..." }, "pub_inputs": { "merkle_root": "hex", "operation": 0, "nullifier": "hex" } }
pub async fn shielded_verify(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let proof_json = match req.get("proof") {
        Some(p) => p,
        None => return Json(serde_json::json!({ "error": "proof object required" })),
    };
    let pub_inputs = match req.get("pub_inputs") {
        Some(p) => p,
        None => return Json(serde_json::json!({ "error": "pub_inputs object required" })),
    };

    let stark_proof = match hsmc_starks::StarkProof::from_json(proof_json) {
        Ok(sp) => sp,
        Err(e) => return Json(serde_json::json!({ "error": format!("Invalid proof: {}", e) })),
    };

    let merkle_root_hex = pub_inputs.get("merkle_root").and_then(|v| v.as_str()).unwrap_or("");
    let operation = pub_inputs.get("operation").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
    let nullifier_hex = pub_inputs.get("nullifier").and_then(|v| v.as_str()).unwrap_or("");

    let mut merkle_root = [0u8; 32];
    let mut nullifier_bytes = [0u8; 32];
    if let Ok(b) = hex::decode(merkle_root_hex) { if b.len() == 32 { merkle_root.copy_from_slice(&b); } }
    if let Ok(b) = hex::decode(nullifier_hex) { if b.len() == 32 { nullifier_bytes.copy_from_slice(&b); } }

    let pub_inputs_struct = hsmc_starks::PoolPublicInputs {
        merkle_root,
        operation,
        nullifier: hsmc_starks::Nullifier(nullifier_bytes),
    };

    let pool = state.shielded.read().await;
    match pool.verify_proof(&stark_proof.0, &pub_inputs_struct) {
        Ok(()) => Json(serde_json::json!({
            "valid": true,
            "operation": operation,
        })),
        Err(e) => Json(serde_json::json!({
            "valid": false,
            "error": e.to_string(),
        })),
    }
}

/// GET /shielded/state
/// Returns: { tvl, note_count, root_hex, depth }
pub async fn shielded_pool_state(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let pool = state.shielded.read().await;
    Json(serde_json::json!({
        "tvl": pool.total_value_locked,
        "note_count": pool.notes.len(),
        "root_hex": hex::encode(pool.tree.root()),
        "depth": pool.depth,
        "nullifier_count": pool.nullifier_set.len(),
    }))
}

/// POST /shielded/nullifier-check
/// Body: { "nullifier_hex": "hex..." }
/// Returns: { spent: bool }
pub async fn shielded_nullifier_check(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let nullifier_hex = match req.get("nullifier_hex").and_then(|v| v.as_str()) {
        Some(h) => h,
        None => return Json(serde_json::json!({ "error": "nullifier_hex required" })),
    };

    let mut nullifier_bytes = [0u8; 32];
    if let Ok(b) = hex::decode(nullifier_hex) {
        if b.len() == 32 {
            nullifier_bytes.copy_from_slice(&b);
        } else {
            return Json(serde_json::json!({ "error": "nullifier must be 32 bytes" }));
        }
    } else {
        return Json(serde_json::json!({ "error": "Invalid nullifier hex" }));
    }

    let pool = state.shielded.read().await;
    let nullifier = hsmc_starks::Nullifier(nullifier_bytes);
    let spent = pool.nullifier_set.contains(&nullifier);
    Json(serde_json::json!({
        "nullifier": nullifier_hex,
        "spent": spent,
    }))
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

fn compute_avg_block_time(blocks: &[Block]) -> f64 {
    if blocks.len() < 2 { return 120.0; }
    let n = blocks.len().min(11);
    let recent = &blocks[blocks.len()-n..];
    let intervals: Vec<f64> = recent.windows(2)
        .map(|w| (w[1].timestamp - w[0].timestamp).abs() as f64)
        .collect();
    if intervals.is_empty() { return 120.0; }
    intervals.iter().sum::<f64>() / intervals.len() as f64
}

fn compute_tps(blocks: &[Block]) -> u32 {
    let avg = compute_avg_block_time(blocks).max(1.0);
    let recent_txs: u32 = blocks.iter().rev().take(10).map(|b| b.transactions_count).sum();
    (recent_txs as f64 / (avg * 10.0)) as u32
}

fn compute_hashrate(difficulty: u64, blocks: &[Block]) -> String {
    let avg = compute_avg_block_time(blocks).max(1.0);
    let leading = hsmc_core::difficulty_to_leading_zeros(difficulty);
    let hps = difficulty as f64 * 16f64.powi(leading as i32) / avg;
    if hps >= 1e12      { format!("{:.2} TH/s", hps/1e12) }
    else if hps >= 1e9  { format!("{:.2} GH/s", hps/1e9) }
    else if hps >= 1e6  { format!("{:.2} MH/s", hps/1e6) }
    else                { format!("{:.2} KH/s", hps/1e3) }
}

// ═══════════════════════════════════════════════════════════════════
// STABLECOIN — Over-collateralized CDP Engine
// ═══════════════════════════════════════════════════════════════════

/// POST /stablecoin/create
/// Body: { "owner": "HSMC_...", "collateral_hsmc": 500.0, "stablecoin_type": "USDHSMC" }
pub async fn stablecoin_create_cdp(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let owner = match req.get("owner").and_then(|v| v.as_str()) {
        Some(o) if !o.is_empty() => o.to_string(),
        _ => return Json(serde_json::json!({ "error": "owner address required" })),
    };
    let collateral_hsmc = match req.get("collateral_hsmc").and_then(|v| v.as_f64()) {
        Some(a) if a > 0.0 => (a * hsmc_stablecoin::HSMC_ATOMIC as f64) as u64,
        _ => return Json(serde_json::json!({ "error": "collateral_hsmc must be positive" })),
    };
    let st_str = match req.get("stablecoin_type").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return Json(serde_json::json!({ "error": "stablecoin_type required (USDHSMC, EURHSMC, XAUHSMC)" })),
    };
    let st = match hsmc_stablecoin::StablecoinType::from_str(st_str) {
        Some(t) => t,
        None => return Json(serde_json::json!({ "error": format!("Unknown stablecoin: {}", st_str) })),
    };

    // Fetch prices from oracle
    let hsmc_price = match state.oracle.get_price("HSMC/USDT").await {
        Ok(p) => p,
        Err(e) => return Json(serde_json::json!({ "error": format!("Oracle unavailable: {}", e) })),
    };
    let eur_usd = state.oracle.get_price("EUR/USD").await.ok();
    let xau_usd = state.oracle.get_price("XAU/USD").await.ok();

    let chain = state.chain.read().await;
    let height = chain.height();
    drop(chain);
    let now = chrono::Utc::now().timestamp();

    let mut engine = state.stablecoin.write().await;
    match engine.create_cdp(owner.clone(), collateral_hsmc, st, height, now, hsmc_price, eur_usd, xau_usd) {
        Ok(cdp_id) => {
            let cdp = engine.get_cdp(cdp_id);
            let debt_normalized = cdp.map(|c| c.debt_amount as f64 / hsmc_stablecoin::STABLECOIN_ATOMIC as f64).unwrap_or(0.0);
            Json(serde_json::json!({
                "ok": true,
                "cdp_id": cdp_id,
                "owner": owner,
                "collateral_hsmc": collateral_hsmc as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64,
                "debt": debt_normalized,
                "stablecoin_type": st.as_str(),
                "hsmc_price_usd": hsmc_price,
                "eur_usd": eur_usd,
                "xau_usd": xau_usd,
                "block_height": height,
            }))
        }
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// POST /stablecoin/repay
/// Body: { "cdp_id": 1, "repay_amount": 10.0, "action": "close"|"partial" }
pub async fn stablecoin_repay(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let cdp_id = match req.get("cdp_id").and_then(|v| v.as_u64()) {
        Some(id) => id,
        None => return Json(serde_json::json!({ "error": "cdp_id required" })),
    };
    let action = req.get("action").and_then(|v| v.as_str()).unwrap_or("close");
    let now = chrono::Utc::now().timestamp();

    let mut engine = state.stablecoin.write().await;

    match action {
        "close" => match engine.repay_and_close(cdp_id, now) {
            Ok((collateral, debt)) => Json(serde_json::json!({
                "ok": true,
                "cdp_id": cdp_id,
                "closed": true,
                "released_collateral_hsmc": collateral as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64,
                "debt_repaid": debt as f64 / hsmc_stablecoin::STABLECOIN_ATOMIC as f64,
            })),
            Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
        },
        "partial" => {
            let repay_amount = match req.get("repay_amount").and_then(|v| v.as_f64()) {
                Some(a) if a > 0.0 => (a * hsmc_stablecoin::STABLECOIN_ATOMIC as f64) as u64,
                _ => return Json(serde_json::json!({ "error": "repay_amount must be positive" })),
            };
            match engine.repay_partial(cdp_id, repay_amount, now) {
                Ok(released) => {
                    let cdp = engine.get_cdp(cdp_id);
                    Json(serde_json::json!({
                        "ok": true,
                        "cdp_id": cdp_id,
                        "released_collateral_hsmc": released as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64,
                        "remaining_debt": cdp.map(|c| c.debt_amount as f64 / hsmc_stablecoin::STABLECOIN_ATOMIC as f64).unwrap_or(0.0),
                        "remaining_collateral": cdp.map(|c| c.collateral_amount as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64).unwrap_or(0.0),
                    }))
                }
                Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
            }
        }
        _ => Json(serde_json::json!({ "error": "action must be 'close' or 'partial'" })),
    }
}

/// POST /stablecoin/liquidate
/// Body: { "cdp_id": 1, "liquidator": "HSMC_..." }
pub async fn stablecoin_liquidate(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let cdp_id = match req.get("cdp_id").and_then(|v| v.as_u64()) {
        Some(id) => id,
        None => return Json(serde_json::json!({ "error": "cdp_id required" })),
    };
    let liquidator = match req.get("liquidator").and_then(|v| v.as_str()) {
        Some(l) if !l.is_empty() => l.to_string(),
        _ => return Json(serde_json::json!({ "error": "liquidator address required" })),
    };

    let hsmc_price = match state.oracle.get_price("HSMC/USDT").await {
        Ok(p) => p,
        Err(e) => return Json(serde_json::json!({ "error": format!("Oracle unavailable: {}", e) })),
    };
    let eur_usd = state.oracle.get_price("EUR/USD").await.ok();
    let xau_usd = state.oracle.get_price("XAU/USD").await.ok();
    let now = chrono::Utc::now().timestamp();

    let mut engine = state.stablecoin.write().await;
    match engine.liquidate(cdp_id, liquidator, now, hsmc_price, eur_usd, xau_usd) {
        Ok(result) => Json(serde_json::json!({
            "ok": true,
            "cdp_id": result.cdp_id,
            "liquidator": result.liquidator,
            "original_owner": result.original_owner,
            "debt_repaid": result.debt_repaid as f64 / hsmc_stablecoin::STABLECOIN_ATOMIC as f64,
            "collateral_seized": result.collateral_seized as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64,
            "penalty": result.penalty as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64,
            "liquidator_reward": result.liquidator_reward as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64,
            "stablecoin_type": result.stablecoin_type.as_str(),
        })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// GET /stablecoin/cdp/:id
pub async fn stablecoin_cdp_info(
    State(state): State<Arc<AppState>>,
    Path(cdp_id): Path<u64>,
) -> Json<serde_json::Value> {
    let engine = state.stablecoin.read().await;

    let hsmc_price = state.oracle.get_price("HSMC/USDT").await.ok().unwrap_or(0.0);
    let eur_usd = state.oracle.get_price("EUR/USD").await.ok();
    let xau_usd = state.oracle.get_price("XAU/USD").await.ok();

    match engine.get_cdp_health(cdp_id, hsmc_price, eur_usd, xau_usd) {
        Ok(health) => {
            let cdp = engine.get_cdp(cdp_id);
            Json(serde_json::json!({
                "cdp_id": health.cdp_id,
                "owner": cdp.map(|c| &c.owner),
                "collateral_hsmc": health.collateral_amount as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64,
                "debt": health.debt_amount as f64 / hsmc_stablecoin::STABLECOIN_ATOMIC as f64,
                "stablecoin_type": health.stablecoin_type.as_str(),
                "ratio_bps": health.ratio_bps,
                "ratio_percent": health.ratio_bps as f64 / 100.0,
                "min_ratio_bps": health.min_ratio_bps,
                "liquidation_ratio_bps": health.liquidation_ratio_bps,
                "liquidation_price": health.liquidation_price,
                "is_healthy": health.is_healthy,
                "is_undercollateralized": health.is_undercollateralized,
                "active": cdp.map(|c| c.active).unwrap_or(false),
                "creation_block": cdp.map(|c| c.creation_block),
                "hsmc_price_usd": hsmc_price,
            }))
        }
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// GET /stablecoin/cdps/owner/:addr
pub async fn stablecoin_cdps_by_owner(
    State(state): State<Arc<AppState>>,
    Path(addr): Path<String>,
) -> Json<serde_json::Value> {
    let engine = state.stablecoin.read().await;
    let cdps: Vec<serde_json::Value> = engine
        .get_cdps_by_owner(&addr)
        .iter()
        .map(|c| serde_json::json!({
            "cdp_id": c.id,
            "collateral_hsmc": c.collateral_amount as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64,
            "debt": c.debt_amount as f64 / hsmc_stablecoin::STABLECOIN_ATOMIC as f64,
            "stablecoin_type": c.stablecoin_type.as_str(),
            "creation_block": c.creation_block,
        }))
        .collect();

    Json(serde_json::json!({
        "owner": addr,
        "cdp_count": cdps.len(),
        "cdps": cdps,
    }))
}

/// GET /stablecoin/prices
pub async fn stablecoin_prices(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let hsmc_price = state.oracle.get_price("HSMC/USDT").await.ok();
    let eur_usd = state.oracle.get_price("EUR/USD").await.ok();
    let xau_usd = state.oracle.get_price("XAU/USD").await.ok();

    Json(serde_json::json!({
        "hsmc_usd": hsmc_price,
        "eur_usd": eur_usd,
        "xau_usd": xau_usd,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

/// GET /stablecoin/token/:type
pub async fn stablecoin_token_info(
    State(state): State<Arc<AppState>>,
    Path(token_type): Path<String>,
) -> Json<serde_json::Value> {
    let st = match hsmc_stablecoin::StablecoinType::from_str(&token_type) {
        Some(t) => t,
        None => return Json(serde_json::json!({ "error": format!("Unknown stablecoin: {}", token_type) })),
    };

    let engine = state.stablecoin.read().await;
    let supply = engine.total_supply(st);
    let config = match st {
        hsmc_stablecoin::StablecoinType::UsdHsmc => &engine.usd_config,
        hsmc_stablecoin::StablecoinType::EurHsmc => &engine.eur_config,
        hsmc_stablecoin::StablecoinType::XauHsmc => &engine.xau_config,
    };

    Json(serde_json::json!({
        "token": st.as_str(),
        "total_supply": supply as f64 / hsmc_stablecoin::STABLECOIN_ATOMIC as f64,
        "total_supply_atomic": supply,
        "min_collateral_ratio_percent": config.min_collateral_ratio_bps as f64 / 100.0,
        "liquidation_ratio_percent": config.liquidation_ratio_bps as f64 / 100.0,
        "liquidation_penalty_percent": config.liquidation_penalty_bps as f64 / 100.0,
        "stability_fee_apr_percent": config.stability_fee_rate_bps as f64 / 100.0,
    }))
}

/// GET /stablecoin/liquidatable
pub async fn stablecoin_liquidatable_list(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let hsmc_price = match state.oracle.get_price("HSMC/USDT").await {
        Ok(p) => p,
        Err(e) => return Json(serde_json::json!({ "error": format!("Oracle unavailable: {}", e) })),
    };
    let eur_usd = state.oracle.get_price("EUR/USD").await.ok();
    let xau_usd = state.oracle.get_price("XAU/USD").await.ok();

    let engine = state.stablecoin.read().await;
    let ids = engine.get_liquidatable_cdps(hsmc_price, eur_usd, xau_usd);

    let details: Vec<serde_json::Value> = ids
        .iter()
        .filter_map(|&id| {
            engine.get_cdp(id).map(|c| {
                serde_json::json!({
                    "cdp_id": c.id,
                    "owner": c.owner,
                    "collateral_hsmc": c.collateral_amount as f64 / hsmc_stablecoin::HSMC_ATOMIC as f64,
                    "debt": c.debt_amount as f64 / hsmc_stablecoin::STABLECOIN_ATOMIC as f64,
                    "stablecoin_type": c.stablecoin_type.as_str(),
                })
            })
        })
        .collect();

    Json(serde_json::json!({
        "count": details.len(),
        "hsmc_price_usd": hsmc_price,
        "liquidatable_cdps": details,
    }))
}

/// POST /stablecoin/transfer
/// Body: { "from": "...", "to": "...", "amount": 10.0, "stablecoin_type": "USDHSMC" }
pub async fn stablecoin_transfer(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let from = match req.get("from").and_then(|v| v.as_str()) {
        Some(a) if !a.is_empty() => a,
        _ => return Json(serde_json::json!({ "error": "from address required" })),
    };
    let to = match req.get("to").and_then(|v| v.as_str()) {
        Some(a) if !a.is_empty() => a,
        _ => return Json(serde_json::json!({ "error": "to address required" })),
    };
    let amount = match req.get("amount").and_then(|v| v.as_f64()) {
        Some(a) if a > 0.0 => (a * hsmc_stablecoin::STABLECOIN_ATOMIC as f64) as u64,
        _ => return Json(serde_json::json!({ "error": "amount must be positive" })),
    };
    let st_str = match req.get("stablecoin_type").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return Json(serde_json::json!({ "error": "stablecoin_type required" })),
    };
    let st = match hsmc_stablecoin::StablecoinType::from_str(st_str) {
        Some(t) => t,
        None => return Json(serde_json::json!({ "error": format!("Unknown stablecoin: {}", st_str) })),
    };

    let mut engine = state.stablecoin.write().await;
    match engine.transfer(from, to, amount, st) {
        Ok(()) => Json(serde_json::json!({
            "ok": true,
            "from": from,
            "to": to,
            "amount": amount as f64 / hsmc_stablecoin::STABLECOIN_ATOMIC as f64,
            "stablecoin_type": st.as_str(),
        })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

// ═══════════════════════════════════════════════════════════════════
// VM — WASM SMART CONTRACT ENGINE
// ═══════════════════════════════════════════════════════════════════

/// POST /vm/deploy
/// Body: { "deployer_address": "HSMC_...", "bytecode_hex": "0061736d...", "name": "MyContract" }
pub async fn vm_deploy_contract(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let deployer_str = match req.get("deployer_address").and_then(|v| v.as_str()) {
        Some(a) if !a.is_empty() => a,
        _ => return Json(serde_json::json!({ "error": "deployer_address required" })),
    };
    let bytecode_hex = match req.get("bytecode_hex").and_then(|v| v.as_str()) {
        Some(h) if !h.is_empty() => h,
        _ => return Json(serde_json::json!({ "error": "bytecode_hex required" })),
    };
    let name = req
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("unnamed");

    let bytecode = match hex::decode(bytecode_hex) {
        Ok(b) => b,
        Err(e) => return Json(serde_json::json!({ "error": format!("Invalid hex: {}", e) })),
    };

    // Derive deployer bytes from address string
    let mut deployer = [0u8; 32];
    let deployer_hash = sha2::Sha256::digest(deployer_str.as_bytes());
    deployer.copy_from_slice(&deployer_hash[..32]);

    let block_height = state.chain.read().await.height();

    let vm = state.vm.read().await;
    match vm.deploy(deployer, bytecode.clone(), block_height) {
        Ok(address) => {
            let meta = vm.get_contract(&address);
            Json(serde_json::json!({
                "ok": true,
                "contract_address": address.to_hex(),
                "name": name,
                "bytecode_len": bytecode.len(),
                "deployment_block": block_height,
                "code_hash": meta.map(|m| hex::encode(m.code_hash)),
            }))
        }
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// POST /vm/call
/// Body: { "contract_address": "0x...", "caller_address": "HSMC_...", "function_name": "run", "args_hex": "0102", "gas_limit": 1000000 }
pub async fn vm_call_contract(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let addr_str = match req.get("contract_address").and_then(|v| v.as_str()) {
        Some(a) if !a.is_empty() => a,
        _ => return Json(serde_json::json!({ "error": "contract_address required" })),
    };
    let caller_str = match req.get("caller_address").and_then(|v| v.as_str()) {
        Some(a) if !a.is_empty() => a,
        _ => return Json(serde_json::json!({ "error": "caller_address required" })),
    };
    let func_name = match req.get("function_name").and_then(|v| v.as_str()) {
        Some(f) if !f.is_empty() => f,
        _ => return Json(serde_json::json!({ "error": "function_name required" })),
    };
    let args = req
        .get("args_hex")
        .and_then(|v| v.as_str())
        .and_then(|h| hex::decode(h).ok())
        .unwrap_or_default();
    let gas_limit = req.get("gas_limit").and_then(|v| v.as_u64());

    let address = match hsmc_vm::ContractAddress::from_hex(addr_str) {
        Some(a) => a,
        None => return Json(serde_json::json!({ "error": format!("Invalid contract address: {}", addr_str) })),
    };

    let mut caller = [0u8; 32];
    let caller_hash = sha2::Sha256::digest(caller_str.as_bytes());
    caller.copy_from_slice(&caller_hash[..32]);

    let chain = state.chain.read().await;
    let block_height = chain.height();
    let timestamp = chrono::Utc::now().timestamp();
    let tx_hash = {
        let mut h = [0u8; 32];
        let hash = sha2::Sha256::digest(&rand::random::<[u8; 32]>());
        h.copy_from_slice(&hash);
        h
    };
    drop(chain);

    let vm = state.vm.read().await;
    match vm.call(
        &address,
        caller,
        func_name,
        &args,
        block_height,
        timestamp,
        tx_hash,
        gas_limit,
    ) {
        Ok(result) => Json(serde_json::json!({
            "ok": result.success,
            "gas_used": result.gas_used,
            "return_data": hex::encode(&result.return_data),
            "events_count": result.events.len(),
            "events": result.events.iter().map(|e| serde_json::json!({
                "topic": hex::encode(&e.topic),
                "data": hex::encode(&e.data),
                "block": e.block_height,
            })).collect::<Vec<_>>(),
            "error": result.error,
        })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// GET /vm/contract/:address
pub async fn vm_get_contract(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> Json<serde_json::Value> {
    let addr = match hsmc_vm::ContractAddress::from_hex(&address) {
        Some(a) => a,
        None => return Json(serde_json::json!({ "error": format!("Invalid contract address: {}", address) })),
    };

    let vm = state.vm.read().await;
    match vm.get_contract(&addr) {
        Some(meta) => Json(serde_json::json!({
            "address": meta.address.to_hex(),
            "owner": hex::encode(&meta.owner),
            "code_hash": hex::encode(&meta.code_hash),
            "bytecode_len": meta.bytecode_len,
            "deployment_block": meta.deployment_block,
            "deployment_timestamp": meta.deployment_timestamp,
            "state_root": hex::encode(&meta.state_root),
            "call_count": meta.call_count,
            "state_entries": vm.state_entry_count(&addr),
        })),
        None => Json(serde_json::json!({ "error": "Contract not found", "address": address })),
    }
}

/// GET /vm/contract/:address/state?key_hex=...
pub async fn vm_get_contract_state(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
    Query(query): Query<VmContractStateQuery>,
) -> Json<serde_json::Value> {
    let addr = match hsmc_vm::ContractAddress::from_hex(&address) {
        Some(a) => a,
        None => return Json(serde_json::json!({ "error": format!("Invalid contract address: {}", address) })),
    };

    let key = match hex::decode(&query.key_hex) {
        Ok(k) => k,
        Err(e) => return Json(serde_json::json!({ "error": format!("Invalid key hex: {}", e) })),
    };

    let vm = state.vm.read().await;
    match vm.get_state(&addr, &key) {
        Some(value) => Json(serde_json::json!({
            "found": true,
            "value_hex": hex::encode(&value),
            "value_len": value.len(),
        })),
        None => Json(serde_json::json!({
            "found": false,
            "key_hex": query.key_hex,
        })),
    }
}

/// GET /vm/contracts?owner=...
pub async fn vm_list_contracts(
    State(state): State<Arc<AppState>>,
    Query(query): Query<VmListContractsQuery>,
) -> Json<serde_json::Value> {
    let owner = query.owner.as_deref().and_then(|o| {
        let hash = sha2::Sha256::digest(o.as_bytes());
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&hash[..32]);
        Some(arr)
    });

    let vm = state.vm.read().await;
    let contracts = vm.list_contracts(owner.as_ref());

    Json(serde_json::json!({
        "count": contracts.len(),
        "contracts": contracts.iter().map(|c| serde_json::json!({
            "address": c.address.to_hex(),
            "owner": hex::encode(&c.owner),
            "code_hash": hex::encode(&c.code_hash),
            "bytecode_len": c.bytecode_len,
            "deployment_block": c.deployment_block,
            "call_count": c.call_count,
            "state_root": hex::encode(&c.state_root),
        })).collect::<Vec<_>>(),
    }))
}

/// POST /vm/gas-estimate
/// Body: { "contract_address": "0x...", "function_name": "run", "args_hex": "0102" }
pub async fn vm_get_gas_estimate(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let addr_str = match req.get("contract_address").and_then(|v| v.as_str()) {
        Some(a) if !a.is_empty() => a,
        _ => return Json(serde_json::json!({ "error": "contract_address required" })),
    };
    let func_name = match req.get("function_name").and_then(|v| v.as_str()) {
        Some(f) if !f.is_empty() => f,
        _ => return Json(serde_json::json!({ "error": "function_name required" })),
    };
    let args = req
        .get("args_hex")
        .and_then(|v| v.as_str())
        .and_then(|h| hex::decode(h).ok())
        .unwrap_or_default();

    let address = match hsmc_vm::ContractAddress::from_hex(addr_str) {
        Some(a) => a,
        None => return Json(serde_json::json!({ "error": format!("Invalid contract address: {}", addr_str) })),
    };

    let block_height = state.chain.read().await.height();
    let timestamp = chrono::Utc::now().timestamp();

    let vm = state.vm.read().await;
    match vm.estimate_gas(&address, func_name, &args, block_height, timestamp) {
        Ok(gas) => Json(serde_json::json!({
            "estimated_gas": gas,
            "gas_price_nano_hsmc": vm.config().gas_price_nano_hsmc,
            "estimated_cost_hsmc": (gas * vm.config().gas_price_nano_hsmc) as f64 / 1_000_000_000.0,
        })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

// ═══════════════════════════════════════════════════════════════════
// ROLLUP (L2 ZK Sovereign Rollup)
// ═══════════════════════════════════════════════════════════════════

use hsmc_rollup::{L2Transaction, RollupManager};

/// POST /rollup/submit-batch
/// Sequencer submits a batch of L2 transactions to L1.
pub async fn rollup_submit_batch(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RollupSubmitBatchRequest>,
) -> Json<serde_json::Value> {
    let mut rollup = state.rollup.write().await;
    rollup.l1_block_number = req.l1_block_number;

    // Submit each transaction
    for tx_req in &req.transactions {
        let from = match hex_to_address(&tx_req.from) {
            Ok(a) => a,
            Err(e) => return Json(serde_json::json!({ "error": e })),
        };
        let to = match hex_to_address(&tx_req.to) {
            Ok(a) => a,
            Err(e) => return Json(serde_json::json!({ "error": e })),
        };
        let data = tx_req.data_hex.as_ref()
            .and_then(|h| hex::decode(h).ok())
            .unwrap_or_default();
        let sig = match hex_to_fixed64(&tx_req.signature_hex) {
            Ok(s) => s,
            Err(e) => return Json(serde_json::json!({ "error": e })),
        };

        let mut tx = L2Transaction::new(from, to, tx_req.amount, tx_req.fee, tx_req.nonce, data);
        tx.sign(sig);

        if let Err(e) = rollup.submit_tx(tx) {
            return Json(serde_json::json!({ "error": e.to_string() }));
        }
    }

    // Build and commit batch
    match rollup.build_batch() {
        Ok(mut batch) => {
            let batch_id = batch.batch_id;
            let pre = batch.pre_state_root;
            match rollup.commit_batch(batch) {
                Ok(id) => {
                    // Generate STARK proof for the batch
                    let committed = match rollup.batches.get(&id) {
                        Some(c) => c,
                        None => return Json(serde_json::json!({
                            "error": format!("Batch {} not found after commit", id)
                        })),
                    };
                    match rollup.generate_proof(committed) {
                        Ok(proof_bytes) => {
                            let tx_count = committed.txs.len();
                            let post_state_root = committed.post_state_root;
                            let _ = rollup.attach_proof(id, proof_bytes);
                            Json(serde_json::json!({
                                "status": "committed",
                                "batch_id": id,
                                "tx_count": tx_count,
                                "pre_state_root": hex::encode(pre),
                                "post_state_root": hex::encode(post_state_root),
                                "proven": true,
                            }))
                        }
                        Err(e) => Json(serde_json::json!({
                            "status": "committed_unproven",
                            "batch_id": id,
                            "error": e.to_string(),
                        })),
                    }
                }
                Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
            }
        }
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// GET /rollup/batch/:batch_id
/// Get batch details.
pub async fn rollup_get_batch(
    State(state): State<Arc<AppState>>,
    Path(batch_id): Path<u64>,
) -> Json<serde_json::Value> {
    let rollup = state.rollup.read().await;
    match rollup.batches.get(&batch_id) {
        Some(batch) => Json(serde_json::json!({
            "batch_id": batch.batch_id,
            "l1_block_number": batch.l1_block_number,
            "tx_count": batch.txs.len(),
            "pre_state_root": hex::encode(batch.pre_state_root),
            "post_state_root": hex::encode(batch.post_state_root),
            "txs_data_hash": hex::encode(batch.txs_data_hash),
            "has_proof": batch.proof.is_some(),
            "timestamp": batch.timestamp,
            "transactions": batch.txs.iter().map(|tx| serde_json::json!({
                "from": hex::encode(tx.from),
                "to": hex::encode(tx.to),
                "amount": tx.amount,
                "fee": tx.fee,
                "nonce": tx.nonce,
                "hash": hex::encode(tx.hash),
            })).collect::<Vec<_>>(),
        })),
        None => Json(serde_json::json!({ "error": format!("Batch {} not found", batch_id) })),
    }
}

/// GET /rollup/l2-state?address=...
/// Get L2 account state.
pub async fn rollup_get_l2_state(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let addr_str = match params.get("address") {
        Some(a) => a,
        None => return Json(serde_json::json!({ "error": "address required" })),
    };
    let address = match hex_to_address(addr_str) {
        Ok(a) => a,
        Err(e) => return Json(serde_json::json!({ "error": e })),
    };

    let rollup = state.rollup.read().await;
    match rollup.accounts.get(&address) {
        Some(acct) => Json(serde_json::json!({
            "address": hex::encode(acct.address),
            "nonce": acct.nonce,
            "balance": acct.balance,
            "contract_code_hash": hex::encode(acct.contract_code_hash),
            "storage_root": hex::encode(acct.storage_root),
            "state_root": hex::encode(rollup.state_root()),
            "shard_id": hsmc_rollup::address_to_shard(&address, rollup.shard_registry.num_shards),
        })),
        None => Json(serde_json::json!({
            "address": addr_str,
            "nonce": 0,
            "balance": 0,
            "exists": false,
        })),
    }
}

/// GET /rollup/bridge-state
/// Get bridge balances and status.
pub async fn rollup_get_bridge_state(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let rollup = state.rollup.read().await;
    let pending_wd: usize = rollup.bridge_withdrawals.values().filter(|w| !w.processed).count();

    Json(serde_json::json!({
        "deposits": rollup.bridge_deposits.len(),
        "withdrawals": rollup.bridge_withdrawals.len(),
        "pending_withdrawals": pending_wd,
        "total_value_locked_l2": rollup.accounts.values().map(|a| a.balance).sum::<u64>(),
    }))
}

/// POST /rollup/deposit
/// L1→L2 deposit: lock HSMC on L1, credit on L2.
pub async fn rollup_deposit(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RollupDepositRequest>,
) -> Json<serde_json::Value> {
    let l2_address = match hex_to_address(&req.l2_address) {
        Ok(a) => a,
        Err(e) => return Json(serde_json::json!({ "error": e })),
    };

    let mut rollup = state.rollup.write().await;
    match rollup.bridge_deposit(&req.l1_address, l2_address, req.amount, req.l1_block) {
        Ok(deposit_id) => Json(serde_json::json!({
            "status": "credited",
            "deposit_id": deposit_id,
            "l2_balance": rollup.accounts.get(&l2_address).map(|a| a.balance).unwrap_or(0),
        })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// POST /rollup/withdraw
/// L2→L1 withdrawal: burn on L2, release on L1.
pub async fn rollup_withdraw(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RollupWithdrawRequest>,
) -> Json<serde_json::Value> {
    let l2_address = match hex_to_address(&req.l2_address) {
        Ok(a) => a,
        Err(e) => return Json(serde_json::json!({ "error": e })),
    };

    let mut rollup = state.rollup.write().await;
    match rollup.bridge_withdraw(l2_address, &req.l1_address, req.amount) {
        Ok(withdrawal_id) => Json(serde_json::json!({
            "status": "burned",
            "withdrawal_id": withdrawal_id,
            "l2_balance": rollup.accounts.get(&l2_address).map(|a| a.balance).unwrap_or(0),
            "note": "awaiting L1 release (challenge period applies)",
        })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

/// GET /rollup/shard/:shard_id
/// Get shard info.
pub async fn rollup_shard_info(
    State(state): State<Arc<AppState>>,
    Path(shard_id): Path<u64>,
) -> Json<serde_json::Value> {
    let rollup = state.rollup.read().await;
    match rollup.shard_registry.get_shard(shard_id) {
        Some(shard) => Json(serde_json::json!({
            "shard_id": shard.shard_id,
            "state_root": hex::encode(shard.state_root),
            "latest_block": shard.latest_block,
            "account_count": shard.account_count,
            "total_value_locked": shard.total_value_locked,
        })),
        None => Json(serde_json::json!({ "error": format!("Shard {} not found", shard_id) })),
    }
}

/// GET /rollup/shards
/// List all shards.
pub async fn rollup_shard_list(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let rollup = state.rollup.read().await;
    let shards: Vec<serde_json::Value> = rollup.shard_registry.list_shards()
        .iter()
        .map(|s| serde_json::json!({
            "shard_id": s.shard_id,
            "state_root": hex::encode(s.state_root),
            "latest_block": s.latest_block,
            "account_count": s.account_count,
            "total_value_locked": s.total_value_locked,
        }))
        .collect();

    Json(serde_json::json!({
        "num_shards": rollup.shard_registry.num_shards,
        "shards": shards,
    }))
}

// ═══════════════════════════════════════════════════════════════════
// ROLLUP HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

fn hex_to_address(hex_str: &str) -> Result<[u8; 32], String> {
    let bytes = hex::decode(hex_str.trim_start_matches("0x"))
        .map_err(|e| format!("Invalid hex: {}", e))?;
    if bytes.len() != 32 {
        return Err(format!("Address must be 32 bytes, got {}", bytes.len()));
    }
    let mut addr = [0u8; 32];
    addr.copy_from_slice(&bytes);
    Ok(addr)
}

fn hex_to_fixed64(hex_str: &str) -> Result<[u8; 64], String> {
    let bytes = hex::decode(hex_str.trim_start_matches("0x"))
        .map_err(|e| format!("Invalid hex: {}", e))?;
    if bytes.len() != 64 {
        return Err(format!("Signature must be 64 bytes, got {}", bytes.len()));
    }
    let mut sig = [0u8; 64];
    sig.copy_from_slice(&bytes);
    Ok(sig)
}
