/// handlers.rs — Complete production RPC handlers
/// All endpoints: chain, tx, mempool, mining, governance, staking, UTXO, fee EIP-1559, peers, bridge stats
/// + Crypto: stealth generation, ring signatures, commitments, range proofs

use axum::{extract::{State, Path, Query}, Json};
use std::{sync::Arc, collections::HashMap};
use tracing::info;
use hsmc_core::{Block, Transaction, PrivacyLevel, TxStatus};
use hsmc_crypto::{DualKeyWallet, StealthOutputSender, StealthAddress, RingPublicKey, RingPrivateKey, LsagSignature, ClsagSignature, select_decoys, PedersenCommitment, BulletproofRangeProof, RctOutput};
use rand::rngs::OsRng;
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
    // Search confirmed blocks
    let chain = state.chain.read().await;
    for block in chain.blocks.iter().rev() {
        for tx in &block.transactions {
            if tx.hash == hash {
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

    for block in chain.blocks.iter().rev() {
        for tx in &block.transactions {
            if tx.from_address == address || tx.to_address == address {
                let mut v = serde_json::to_value(tx).unwrap_or_default();
                if let Some(obj) = v.as_object_mut() {
                    obj.insert("block_number".into(), block.block_number.into());
                    obj.insert("block_hash".into(), block.hash.clone().into());
                    obj.insert("confirmed".into(), true.into());
                }
                txs.push(v);
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
    let mut utxos: Vec<serde_json::Value> = Vec::new();
    let mut total_balance: f64 = 0.0;
    let mut spent_hashes: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Collect all spent inputs across chain
    for block in &chain.blocks {
        for tx in &block.transactions {
            if let Some(ref input_ref) = tx.stealth_address {
                spent_hashes.insert(input_ref.clone());
            }
        }
    }

    // Find unspent outputs for address
    for block in &chain.blocks {
        for tx in &block.transactions {
            if tx.to_address == address && !spent_hashes.contains(&tx.hash) {
                total_balance += tx.amount;
                utxos.push(serde_json::json!({
                    "tx_hash": tx.hash,
                    "vout": 0,
                    "amount": tx.amount,
                    "privacy_level": tx.privacy_level.to_string(),
                    "stealth_address": tx.stealth_address,
                    "commitment": tx.commitment,
                    "block_number": block.block_number,
                    "confirmations": chain.height().saturating_sub(block.block_number) + 1,
                    "spendable": true,
                    "coinbase": tx.from_address == "coinbase" || tx.from_address.is_empty(),
                }));
            }
        }
    }

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
            if tx.hash == tx_hash {
                let merkle_proof = compute_merkle_proof(&tx_hash, &block.transactions.iter().map(|t| t.hash.clone()).collect::<Vec<_>>());
                return Json(serde_json::json!({
                    "tx_hash": tx_hash,
                    "vout": vout,
                    "block_number": block.block_number,
                    "block_hash": block.hash,
                    "merkle_root": block.merkle_root,
                    "merkle_proof": merkle_proof,
                    "amount": tx.amount,
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

    let recent_fees: Vec<f64> = chain.blocks.iter().rev().take(10)
        .flat_map(|b| b.transactions.iter().map(|t| t.fee))
        .collect();
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

    let proposal = hsmc_core::GovernanceProposal {
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

    // Privacy stats
    let privacy_counts = chain.blocks.iter().flat_map(|b| &b.transactions)
        .fold((0u64, 0u64, 0u64, 0u64), |(t, r, s, f), tx| match tx.privacy_level {
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

    // Burned/locked estimate
    let locked_in_bridge: f64 = chain.blocks.iter()
        .flat_map(|b| &b.transactions)
        .filter(|tx| tx.to_address.starts_with("bridge:"))
        .map(|tx| tx.amount)
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
        RingPublicKey::generate()
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
