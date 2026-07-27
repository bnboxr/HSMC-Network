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

// ═══════════════════════════════════════════════════════════════════
// VM (WASM Smart Contract Engine)
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct VmDeployRequest {
    pub deployer_address: String,
    pub bytecode_hex:     String,
    pub name:             Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VmCallRequest {
    pub contract_address: String,
    pub caller_address:   String,
    pub function_name:    String,
    pub args_hex:         Option<String>,
    pub gas_limit:        Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct VmGasEstimateRequest {
    pub contract_address: String,
    pub function_name:    String,
    pub args_hex:         Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VmListContractsQuery {
    pub owner: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VmContractStateQuery {
    pub key_hex: String,
}

// ═══════════════════════════════════════════════════════════════════
// ROLLUP (L2 ZK Sovereign Rollup)
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct RollupSubmitBatchRequest {
    pub l1_block_number: u64,
    pub transactions: Vec<RollupTxRequest>,
}

#[derive(Debug, Deserialize)]
pub struct RollupTxRequest {
    pub from: String,
    pub to: String,
    pub amount: u64,
    pub fee: u64,
    pub nonce: u64,
    pub data_hex: Option<String>,
    pub signature_hex: String,
}

#[derive(Debug, Deserialize)]
pub struct RollupDepositRequest {
    pub l1_address: String,
    pub l2_address: String,
    pub amount: u64,
    pub l1_block: u64,
}

#[derive(Debug, Deserialize)]
pub struct RollupWithdrawRequest {
    pub l2_address: String,
    pub l1_address: String,
    pub amount: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RollupBatchResponse {
    pub batch_id: u64,
    pub l1_block_number: u64,
    pub tx_count: usize,
    pub pre_state_root: String,
    pub post_state_root: String,
    pub txs_data_hash: String,
    pub has_proof: bool,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RollupAccountResponse {
    pub address: String,
    pub nonce: u64,
    pub balance: u64,
    pub contract_code_hash: String,
    pub storage_root: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BridgeStateResponse {
    pub deposits_count: usize,
    pub withdrawals_count: usize,
    pub pending_withdrawals: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShardInfoResponse {
    pub shard_id: u64,
    pub state_root: String,
    pub latest_block: u64,
    pub account_count: u64,
    pub total_value_locked: u64,
}

#[derive(Debug, Deserialize)]
pub struct RollupL2StateQuery {
    pub address: String,
}
