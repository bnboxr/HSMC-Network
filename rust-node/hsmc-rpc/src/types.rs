use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════
// NODE / CHAIN
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Serialize, Deserialize)]
pub struct NodeInfo {
    pub version:      String,
    pub chain_id:     u64,
    pub height:       u64,
    pub peer_count:   usize,
    pub mempool_size: usize,
    pub difficulty:   u64,
    pub network:      String,
    pub total_txs:    u64,
    pub tps:          u32,
    pub hash_rate:    String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MiningInfo {
    pub height:      u64,
    pub prev_hash:   String,
    pub difficulty:  u64,
    pub target:      String,
    pub reward:      f64,
    pub timestamp:   i64,
    pub merkle_root: String,
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct SubmitTxRequest {
    pub from:            String,
    pub to:              String,
    pub amount:          f64,
    pub fee:             f64,
    pub privacy_level:   String,
    pub ring_signature:  Option<String>,
    pub commitment:      Option<String>,
    pub range_proof:     Option<String>,
    pub stealth_address: Option<String>,
    pub decoy_count:     Option<u8>,
    pub memo:            Option<String>,
    pub nonce:           Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════
// PEERS
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id:    String,
    pub address:    String,
    pub height:     u64,
    pub latency_ms: u64,
    pub version:    String,
    pub region:     String,
}

// ═══════════════════════════════════════════════════════════════════
// GOVERNANCE
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct GovernanceProposalRequest {
    pub title:            String,
    pub description:      String,
    pub proposer_address: String,
    pub proposal_type:    Option<String>,
    pub parameter_key:    Option<String>,
    pub parameter_value:  Option<String>,
    pub quorum_required:  Option<u64>,
    pub voting_days:      Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct VoteRequest {
    pub voter_address: String,
    /// "for" | "against" | "abstain"
    pub vote:          String,
    pub vote_weight:   Option<u64>,
    pub signature:     Option<String>,
}

// ═══════════════════════════════════════════════════════════════════
// STAKING
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct StakeRequest {
    pub wallet_address: String,
    pub pool_id:        String,
    pub amount:         f64,
    pub signature:      Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UnstakeRequest {
    pub stake_id:       String,
    pub wallet_address: String,
    pub signature:      Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ClaimRequest {
    pub wallet_address: String,
    pub pool_id:        Option<String>,
    pub signature:      Option<String>,
}

// ═══════════════════════════════════════════════════════════════════
// CRYPTO ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct StealthGenerateRequest {
    pub recipient_address: String,
    pub output_index:      Option<u32>,
    pub payment_id:        Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CommitmentRequest {
    pub amount_satoshis: u64,
}

#[derive(Debug, Deserialize)]
pub struct RingSignRequest {
    pub message:          String,
    pub signer_secret_hex: Option<String>,
    pub ring_size:        Option<usize>,
    pub known_pubkeys:    Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct RangeProofRequest {
    pub amount_satoshis: u64,
    pub commitment_hex:  String,
}
