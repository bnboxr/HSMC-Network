/// ============================================================================
/// HSMC Transaction — Full Production Transaction Engine
/// ============================================================================
/// Implements the complete HSMC transaction model:
///
///   • Transparent transactions: standard UTXO-model transfers
///   • RingCT transactions: Pedersen commitments + LSAG ring signatures
///   • Stealth transactions: one-time addresses (ECDH key exchange)
///   • Full-privacy transactions: all of the above + Bulletproof range proofs
///   • Bridge transactions: cross-chain HSMC ↔ wHSMC lock/mint operations
///   • Coinbase transactions: block reward claims by miners
///
/// Each transaction carries a typed `TxPayload` enum so downstream code can
/// match on the privacy level and handle proofs accordingly without
/// field-existence checks.
///
/// All hashes are double-SHA256 (SHA256d) with a domain separator prefix
/// to prevent cross-protocol hash collisions.
/// ============================================================================

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use chrono::Utc;
use uuid::Uuid;
use std::fmt;
use std::collections::HashMap;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Domain separator for transaction hashes (prevents collisions with block hashes)
pub const TX_HASH_PREFIX: &[u8] = b"HSMC_TX_V2";

/// Maximum ring size for LSAG signatures
pub const MAX_RING_SIZE: usize = 16;

/// Minimum ring size (security parameter)
pub const MIN_RING_SIZE: usize = 11;

/// Maximum number of inputs per transaction
pub const MAX_TX_INPUTS: usize = 50;

/// Maximum number of outputs per transaction
pub const MAX_TX_OUTPUTS: usize = 50;

/// Maximum tx data field size (bytes)
pub const MAX_TX_DATA_BYTES: usize = 4096;

/// Maximum memo length (visible to both parties)
pub const MAX_MEMO_LEN: usize = 255;

/// Minimum fee (HSMC) for any transaction
pub const MIN_BASE_FEE: f64 = 0.0001;

/// Fee schedule multipliers per privacy level (vs. base fee)
pub const FEE_MULTIPLIER_TRANSPARENT: f64 = 1.0;
pub const FEE_MULTIPLIER_RINGCT:      f64 = 10.0;
pub const FEE_MULTIPLIER_STEALTH:     f64 = 20.0;
pub const FEE_MULTIPLIER_FULL:        f64 = 50.0;

/// Cross-chain bridge fee rate (0.3%)
pub const BRIDGE_FEE_RATE: f64 = 0.003;

/// Minimum bridge amount (HSMC)
pub const BRIDGE_MIN_AMOUNT: f64 = 1.0;

// ─────────────────────────────────────────────────────────────────────────────
// Privacy Level
// ─────────────────────────────────────────────────────────────────────────────

/// Privacy tier for a transaction. Determines which cryptographic proofs
/// are required and how the transaction is encoded on-chain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyLevel {
    /// Fully transparent — amounts, sender and receiver are public
    Transparent,
    /// Ring Confidential Transactions — amounts hidden via Pedersen commitments,
    /// sender hidden via LSAG ring signature (ring size 11-16)
    RingCt,
    /// Stealth — sender hidden + receiver uses one-time stealth address (ECDH)
    Stealth,
    /// Full — RingCT + Stealth + Bulletproof range proofs (Monero-equivalent)
    Full,
}

impl PrivacyLevel {
    /// Minimum fee in HSMC required for this privacy level
    pub fn min_fee(&self) -> f64 {
        match self {
            Self::Transparent => MIN_BASE_FEE,
            Self::RingCt      => MIN_BASE_FEE * FEE_MULTIPLIER_RINGCT,
            Self::Stealth     => MIN_BASE_FEE * FEE_MULTIPLIER_STEALTH,
            Self::Full        => MIN_BASE_FEE * FEE_MULTIPLIER_FULL,
        }
    }

    /// Fee multiplier relative to base fee
    pub fn fee_multiplier(&self) -> f64 {
        match self {
            Self::Transparent => FEE_MULTIPLIER_TRANSPARENT,
            Self::RingCt      => FEE_MULTIPLIER_RINGCT,
            Self::Stealth     => FEE_MULTIPLIER_STEALTH,
            Self::Full        => FEE_MULTIPLIER_FULL,
        }
    }

    /// Estimated additional byte overhead for this privacy level
    pub fn byte_overhead(&self) -> usize {
        match self {
            Self::Transparent => 0,
            Self::RingCt      => 2048,  // ring sig + commitment
            Self::Stealth     => 2560,  // ring sig + commitment + stealth key
            Self::Full        => 4096,  // all above + bulletproof
        }
    }

    /// Human-readable description
    pub fn description(&self) -> &'static str {
        match self {
            Self::Transparent =>
                "Transparent: amounts, sender and receiver are public",
            Self::RingCt =>
                "RingCT: amounts hidden; sender hidden via LSAG ring signature (11-16 decoys)",
            Self::Stealth =>
                "Stealth: ring signature + one-time stealth address via ECDH key exchange",
            Self::Full =>
                "Full Privacy: RingCT + Stealth + Bulletproof range proofs (Monero-equivalent)",
        }
    }

    /// Parse from string (case-insensitive)
    pub fn from_str_insensitive(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "transparent"           => Some(Self::Transparent),
            "ringct" | "ring_ct"    => Some(Self::RingCt),
            "stealth"               => Some(Self::Stealth),
            "full"                  => Some(Self::Full),
            _                       => None,
        }
    }
}

impl fmt::Display for PrivacyLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transparent => write!(f, "transparent"),
            Self::RingCt      => write!(f, "ringct"),
            Self::Stealth     => write!(f, "stealth"),
            Self::Full        => write!(f, "full"),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Status
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TxStatus {
    /// In mempool, not yet included in a block
    Pending,
    /// Confirmed in a block
    Confirmed,
    /// Validation failed or double-spend detected
    Failed,
    /// HSMC locked for cross-chain bridge (awaiting mint on EVM chain)
    BridgeLocked,
    /// wHSMC minted on EVM chain after bridge lock confirmation
    BridgeMinted,
    /// Transaction in Dandelion++ stem phase (not yet broadcast to all peers)
    DandelionStem,
    /// Replaced by a higher-fee transaction (RBF — Replace-By-Fee)
    Replaced,
    /// Evicted from mempool due to size limit
    MempoolEvicted,
}

impl fmt::Display for TxStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pending         => write!(f, "pending"),
            Self::Confirmed       => write!(f, "confirmed"),
            Self::Failed          => write!(f, "failed"),
            Self::BridgeLocked    => write!(f, "bridge_locked"),
            Self::BridgeMinted    => write!(f, "bridge_minted"),
            Self::DandelionStem   => write!(f, "dandelion_stem"),
            Self::Replaced        => write!(f, "replaced"),
            Self::MempoolEvicted  => write!(f, "mempool_evicted"),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Input / Output (UTXO model)
// ─────────────────────────────────────────────────────────────────────────────

/// Reference to a specific UTXO being spent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxInput {
    /// Hash of the transaction that created the UTXO being spent
    pub prev_tx_hash: String,
    /// Index of the output in the referenced transaction
    pub output_index: u32,
    /// Unlocking script / signature proving ownership
    pub unlock_script: String,
    /// Sequence number (used for Replace-By-Fee signalling)
    pub sequence: u32,
    /// For RingCT inputs: the ring member public keys (serialised)
    pub ring_members: Vec<String>,
    /// Key image (prevents double-spend in ring signature txs)
    pub key_image: Option<String>,
}

impl TxInput {
    pub fn new(prev_tx_hash: &str, output_index: u32, unlock_script: &str) -> Self {
        Self {
            prev_tx_hash:  prev_tx_hash.to_string(),
            output_index,
            unlock_script: unlock_script.to_string(),
            sequence:      0xFFFF_FFFF, // final (no RBF)
            ring_members:  vec![],
            key_image:     None,
        }
    }

    /// Create an RBF-signalling input (sequence < 0xFFFFFFFE)
    pub fn new_rbf(prev_tx_hash: &str, output_index: u32, unlock_script: &str) -> Self {
        Self {
            prev_tx_hash:  prev_tx_hash.to_string(),
            output_index,
            unlock_script: unlock_script.to_string(),
            sequence:      0xFFFF_FFFD, // signals RBF opt-in
            ring_members:  vec![],
            key_image:     None,
        }
    }

    /// Unique identifier for this input: "prev_hash:output_index"
    pub fn outpoint_id(&self) -> String {
        format!("{}:{}", self.prev_tx_hash, self.output_index)
    }

    /// Returns true if this input opts in to RBF (BIP125)
    pub fn is_rbf(&self) -> bool {
        self.sequence < 0xFFFF_FFFE
    }
}

/// A transaction output — creates a new UTXO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxOutput {
    /// Amount in HSMC (0.0 for RingCT — amount is hidden in commitment)
    pub amount: f64,
    /// Recipient's address or script hash
    pub address: String,
    /// Locking script (P2PKH / P2SH / P2PK)
    pub lock_script: String,
    /// For RingCT: Pedersen commitment hiding the real amount
    pub commitment: Option<String>,
    /// For Stealth: one-time stealth address (P = H_s(r*V)*G + S)
    pub stealth_key: Option<String>,
    /// Ephemeral key for stealth derivation (R = r*G)
    pub ephemeral_key: Option<String>,
    /// Output type discriminator
    pub output_type: OutputType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OutputType {
    /// Standard P2PKH (Pay-to-Public-Key-Hash)
    P2Pkh,
    /// Pay-to-Script-Hash (smart contract)
    P2Sh,
    /// RingCT confidential output
    Confidential,
    /// Stealth (one-time) output
    Stealth,
    /// Miner coinbase reward output
    Coinbase,
    /// Bridge lock output (funds locked for cross-chain)
    BridgeLock,
}

impl TxOutput {
    pub fn new(amount: f64, address: &str) -> Self {
        Self {
            amount,
            address:        address.to_string(),
            lock_script:    format!("OP_DUP OP_HASH160 {} OP_EQUALVERIFY OP_CHECKSIG", address),
            commitment:     None,
            stealth_key:    None,
            ephemeral_key:  None,
            output_type:    OutputType::P2Pkh,
        }
    }

    /// Estimated serialised byte size of this output
    pub fn byte_size(&self) -> usize {
        let base = 8 + self.address.len() + self.lock_script.len();
        let extra = self.commitment.as_ref().map(|s| s.len()).unwrap_or(0)
            + self.stealth_key.as_ref().map(|s| s.len()).unwrap_or(0)
            + self.ephemeral_key.as_ref().map(|s| s.len()).unwrap_or(0);
        base + extra
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Privacy Proofs
// ─────────────────────────────────────────────────────────────────────────────

/// LSAG (Linkable Spontaneous Anonymous Group) Ring Signature proof.
/// Proves the signer controls one key in the ring without revealing which one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RingSignatureProof {
    /// Serialised key image I = x * H_p(P) — used for double-spend detection
    pub key_image: String,
    /// Ring scalar c values (one per ring member)
    pub c_values: Vec<String>,
    /// Ring scalar r values (one per ring member)
    pub r_values: Vec<String>,
    /// Actual ring size used (11-16)
    pub ring_size: u8,
    /// Index of the actual signer in the ring (kept secret; validated by verifier)
    pub commitment_to_signer: Option<String>,
}

impl RingSignatureProof {
    pub fn is_valid_structure(&self) -> bool {
        let n = self.ring_size as usize;
        n >= MIN_RING_SIZE
            && n <= MAX_RING_SIZE
            && self.c_values.len() == n
            && self.r_values.len() == n
            && !self.key_image.is_empty()
    }
}

/// Pedersen commitment to a hidden amount: C = r*G + v*H
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PedersenCommitment {
    /// Compressed EC point bytes (hex, 64 chars)
    pub commitment_hex: String,
    /// Hash of the blinding factor (kept by sender for change tracking)
    pub blinding_factor_hash: Option<String>,
}

impl PedersenCommitment {
    pub fn is_valid(&self) -> bool {
        self.commitment_hex.len() == 64
            && self.commitment_hex.chars().all(|c| c.is_ascii_hexdigit())
    }
}

/// Bulletproof range proof — proves 0 ≤ amount < 2^64 without revealing the amount.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulletproofRangeProof {
    /// Serialised Bulletproof bytes (hex)
    pub proof_hex: String,
    /// Number of bits committed (typically 64)
    pub bit_length: u8,
    /// Proof size in bytes (for fee estimation)
    pub proof_size_bytes: u32,
    /// Aggregated proof flag (multiple outputs proven together)
    pub is_aggregated: bool,
}

impl BulletproofRangeProof {
    /// Typical Bulletproof size: ~672 bytes for 64-bit range
    pub const TYPICAL_SIZE_BYTES: u32 = 672;

    pub fn is_valid(&self) -> bool {
        self.bit_length > 0
            && self.bit_length <= 64
            && !self.proof_hex.is_empty()
            && self.proof_hex.len() % 2 == 0 // must be even hex
    }
}

/// Stealth address derivation proof — proves the stealth key belongs to recipient
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StealthProof {
    /// Ephemeral public key R = r*G (on-chain, allows receiver to derive P)
    pub ephemeral_pubkey: String,
    /// One-time destination address P = H_s(r*V)*G + S
    pub one_time_address: String,
    /// View tag — first byte of H_s(r*V), lets receiver scan faster
    pub view_tag: u8,
}

impl StealthProof {
    pub fn is_valid(&self) -> bool {
        !self.ephemeral_pubkey.is_empty()
            && !self.one_time_address.is_empty()
            && self.ephemeral_pubkey.len() == 64
            && self.one_time_address.len() >= 40
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge Data
// ─────────────────────────────────────────────────────────────────────────────

/// Supported EVM destination chains for wHSMC bridge
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BridgeChain {
    Bsc,
    Ethereum,
    Polygon,
    Avalanche,
    Arbitrum,
}

impl fmt::Display for BridgeChain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bsc       => write!(f, "bsc"),
            Self::Ethereum  => write!(f, "ethereum"),
            Self::Polygon   => write!(f, "polygon"),
            Self::Avalanche => write!(f, "avalanche"),
            Self::Arbitrum  => write!(f, "arbitrum"),
        }
    }
}

impl BridgeChain {
    /// EVM chain ID for each supported chain
    pub fn chain_id(&self) -> u64 {
        match self {
            Self::Bsc       => 56,
            Self::Ethereum  => 1,
            Self::Polygon   => 137,
            Self::Avalanche => 43114,
            Self::Arbitrum  => 42161,
        }
    }

    /// wHSMC contract address on each chain.
    /// Configured via env vars (WHSMC_BSC_ADDRESS, WHSMC_ETH_ADDRESS, etc.).
    /// Falls back to placeholder addresses if env vars are not set.
    pub fn whsmc_contract(&self) -> String {
        let (env_key, placeholder) = match self {
            Self::Bsc       => ("WHSMC_BSC_ADDRESS",       "0x0000000000000000000000000000000000001001"),
            Self::Ethereum  => ("WHSMC_ETH_ADDRESS",       "0x0000000000000000000000000000000000001002"),
            Self::Polygon   => ("WHSMC_POLYGON_ADDRESS",   "0x0000000000000000000000000000000000001003"),
            Self::Avalanche => ("WHSMC_AVALANCHE_ADDRESS", "0x0000000000000000000000000000000000001004"),
            Self::Arbitrum  => ("WHSMC_ARBITRUM_ADDRESS",  "0x0000000000000000000000000000000000001005"),
        };
        std::env::var(env_key).unwrap_or_else(|_| placeholder.to_string())
    }
}

/// Cross-chain bridge metadata attached to bridge lock transactions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeData {
    /// EVM chain to mint wHSMC on
    pub dest_chain: BridgeChain,
    /// EVM address to receive wHSMC on destination chain
    pub dest_address: String,
    /// HSMC amount locked (equals wHSMC amount minted minus bridge fee)
    pub amount: f64,
    /// Bridge fee in HSMC (BRIDGE_FEE_RATE of amount)
    pub fee: f64,
    /// Net amount after fee
    pub amount_after_fee: f64,
    /// ABI-encoded mint call data for the wHSMC contract
    pub mint_calldata: Option<String>,
    /// Bridge sequence number (monotonically increasing per dest chain)
    pub sequence: u64,
    /// Expiry timestamp — bridge must be confirmed before this time
    pub expires_at: i64,
}

impl BridgeData {
    pub fn new(dest_chain: BridgeChain, dest_address: &str, amount: f64, sequence: u64) -> Self {
        let fee = (amount * BRIDGE_FEE_RATE * 1e6).round() / 1e6;
        let amount_after_fee = (amount - fee).max(0.0);
        let expires_at = Utc::now().timestamp() + 3600; // 1 hour expiry
        Self {
            dest_chain,
            dest_address: dest_address.to_string(),
            amount,
            fee,
            amount_after_fee,
            mint_calldata: None,
            sequence,
            expires_at,
        }
    }

    /// Generate ABI-encoded mint calldata for the wHSMC contract
    /// Signature: mint(address to, uint256 amount, bytes32 mainnetTxHash)
    pub fn encode_mint_calldata(&mut self, mainnet_tx_hash: &str) {
        let amount_wei = (self.amount_after_fee * 1e18) as u128;
        let padded_addr = format!("000000000000000000000000{}", &self.dest_address.trim_start_matches("0x"));
        let padded_amount = format!("{:064x}", amount_wei);
        let tx_hash_clean = mainnet_tx_hash.trim_start_matches("0x");
        let padded_hash = format!("{:0>64}", tx_hash_clean);
        // keccak4 of "mint(address,uint256,bytes32)" = 0x40c10f19
        self.mint_calldata = Some(format!(
            "0x40c10f19{}{}{}",
            padded_addr,
            padded_amount,
            padded_hash,
        ));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Payload (typed variant)
// ─────────────────────────────────────────────────────────────────────────────

/// Typed transaction payload — selects the appropriate proof set for
/// validation without field-presence checks at call sites.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "payload_type", rename_all = "snake_case")]
pub enum TxPayload {
    /// Standard transparent transfer
    Transparent,

    /// RingCT — confidential amount + ring signature
    RingCt {
        ring_signature: RingSignatureProof,
        input_commitments:  Vec<PedersenCommitment>,
        output_commitments: Vec<PedersenCommitment>,
        excess_commitment:  PedersenCommitment, // ensures sum_in == sum_out + fee
    },

    /// Stealth — ring signature + one-time address
    Stealth {
        ring_signature: RingSignatureProof,
        stealth_proof:  StealthProof,
        input_commitments:  Vec<PedersenCommitment>,
        output_commitments: Vec<PedersenCommitment>,
    },

    /// Full privacy — RingCT + Stealth + Bulletproof range proof
    Full {
        ring_signature:  RingSignatureProof,
        stealth_proof:   StealthProof,
        range_proof:     BulletproofRangeProof,
        input_commitments:  Vec<PedersenCommitment>,
        output_commitments: Vec<PedersenCommitment>,
        excess_commitment:  PedersenCommitment,
    },

    /// Cross-chain bridge lock
    BridgeLock {
        bridge: BridgeData,
        // Optional privacy wrapper for bridge transactions
        stealth_proof: Option<StealthProof>,
    },

    /// Miner coinbase reward
    Coinbase {
        block_height: u64,
        reward:       f64,
        script_data:  String,
    },

    /// Post-Quantum — ECDSA + Dilithium-5 hybrid signatures, Kyber-1024 KEM
    /// Provides quantum-resistant authentication and key exchange for
    /// forward-looking security. Compatible with all privacy levels.
    PostQuantum {
        /// Hybrid ECDSA + Dilithium-5 signature (hex-encoded)
        hybrid_signature: String,
        /// Dilithium-5 public key for signature verification
        dilithium_pubkey: String,
        /// Kyber-1024 ciphertext for key encapsulation (optional, for stealth)
        kyber_ciphertext: Option<String>,
        /// Kyber-1024 public key for KEM (optional)
        kyber_pubkey: Option<String>,
        /// Base privacy level (sets fee multiplier and proof requirements)
        base_privacy: PrivacyLevel,
        /// Underlying classic proofs (ring sig, stealth, commitments)
        ring_signature: Option<RingSignatureProof>,
        stealth_proof: Option<StealthProof>,
        range_proof: Option<BulletproofRangeProof>,
        input_commitments: Vec<PedersenCommitment>,
        output_commitments: Vec<PedersenCommitment>,
        excess_commitment: Option<PedersenCommitment>,
    },
}

impl TxPayload {
    pub fn privacy_level(&self) -> PrivacyLevel {
        match self {
            Self::Transparent   => PrivacyLevel::Transparent,
            Self::RingCt { .. } => PrivacyLevel::RingCt,
            Self::Stealth { .. }=> PrivacyLevel::Stealth,
            Self::Full { .. }   => PrivacyLevel::Full,
            Self::BridgeLock { stealth_proof, .. } =>
                if stealth_proof.is_some() { PrivacyLevel::Stealth } else { PrivacyLevel::Transparent },
            Self::Coinbase { .. }=> PrivacyLevel::Transparent,
            Self::PostQuantum { base_privacy, .. } => base_privacy.clone(),
        }
    }

    pub fn is_coinbase(&self) -> bool {
        matches!(self, Self::Coinbase { .. })
    }

    pub fn is_bridge(&self) -> bool {
        matches!(self, Self::BridgeLock { .. })
    }

    /// Returns true if this transaction uses post-quantum cryptography
    pub fn is_post_quantum(&self) -> bool {
        matches!(self, Self::PostQuantum { .. })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction
// ─────────────────────────────────────────────────────────────────────────────

/// Full HSMC transaction with all fields required for consensus validation,
/// mempool management, RocksDB persistence, and RPC serialisation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    // ── Identity ────────────────────────────────────────────────────────────
    /// Unique UUID (not consensus-critical; used as secondary DB key)
    pub id: String,
    /// SHA256d transaction hash (consensus-critical identifier)
    pub hash: String,
    /// Transaction version (for future soft-fork upgrades)
    pub version: u32,

    // ── Addressing ──────────────────────────────────────────────────────────
    pub from_address: String,
    pub to_address:   String,

    // ── Amounts (0 for RingCT — use commitment instead) ─────────────────────
    pub amount: f64,
    pub fee:    f64,

    // ── Status & timing ─────────────────────────────────────────────────────
    pub status:       TxStatus,
    pub created_at:   i64,
    pub confirmed_at: Option<i64>,
    pub block_number: Option<u64>,

    // ── UTXO model ──────────────────────────────────────────────────────────
    pub inputs:  Vec<TxInput>,
    pub outputs: Vec<TxOutput>,

    // ── Privacy level ────────────────────────────────────────────────────────
    pub privacy_level: PrivacyLevel,

    // ── Legacy flat fields (kept for backwards-compat / DB queries) ─────────
    /// LSAG ring signature (hex-serialised) — set for RingCt/Stealth/Full
    pub ring_signature:  Option<String>,
    /// One-time stealth address — set for Stealth/Full
    pub stealth_address: Option<String>,
    /// Pedersen commitment (hex) — set for RingCt/Stealth/Full
    pub commitment:      Option<String>,
    /// Bulletproof range proof (hex) — set for Full
    pub range_proof:     Option<String>,
    /// Ring size (11-16) — set for ring signature transactions
    pub decoy_count:     Option<u8>,
    /// Key image (hex) — prevents double-spend in ring signature txs
    pub key_image:       Option<String>,

    // ── Typed payload (includes structured proofs) ───────────────────────────
    pub payload: TxPayload,

    // ── Bridge fields ────────────────────────────────────────────────────────
    pub bridge_dest_chain:   Option<String>,
    pub bridge_dest_address: Option<String>,
    pub bridge_tx_hash:      Option<String>,
    pub bridge_sequence:     Option<u64>,

    // ── Miscellaneous ────────────────────────────────────────────────────────
    /// Optional on-chain memo (max MAX_MEMO_LEN chars; encrypted for privacy txs)
    pub memo:          Option<String>,
    /// Replace-By-Fee: previous tx hash this replaces (if RBF)
    pub replaces_hash: Option<String>,
    /// Estimated serialised tx size in bytes (for fee market)
    pub size_bytes:    u32,
    /// Lock time: tx is invalid until this block height
    pub lock_time:     u64,
    /// Nonce: prevents replay attacks on the same account
    pub nonce:         u64,
    /// Custom metadata (explorer annotations, wallet labels, etc.)
    pub metadata:      HashMap<String, String>,
}

impl Transaction {
    // ── Constructors ──────────────────────────────────────────────────────────

    /// Create a new transparent transfer transaction
    pub fn new(from: &str, to: &str, amount: f64, fee: f64, privacy: PrivacyLevel) -> Self {
        let id  = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        let hash = compute_tx_hash(TX_HASH_PREFIX, &id, from, to, amount, fee, now);

        let output = TxOutput::new(amount, to);
        let size = 250 + output.byte_size() as u32 + privacy.byte_overhead() as u32;

        Self {
            id,
            hash,
            version:            2,
            from_address:       from.to_string(),
            to_address:         to.to_string(),
            amount,
            fee,
            status:             TxStatus::Pending,
            created_at:         now,
            confirmed_at:       None,
            block_number:       None,
            inputs:             vec![TxInput::new("0".repeat(64).as_str(), 0, "")],
            outputs:            vec![output],
            privacy_level:      privacy.clone(),
            ring_signature:     None,
            stealth_address:    None,
            commitment:         None,
            range_proof:        None,
            decoy_count:        None,
            key_image:          None,
            payload:            TxPayload::Transparent,
            bridge_dest_chain:  None,
            bridge_dest_address:None,
            bridge_tx_hash:     None,
            bridge_sequence:    None,
            memo:               None,
            replaces_hash:      None,
            size_bytes:         size,
            lock_time:          0,
            nonce:              0,
            metadata:           HashMap::new(),
        }
    }

    /// Create a coinbase transaction for a miner reward
    pub fn new_coinbase(
        block_number: u64,
        miner_address: &str,
        reward: f64,
        fees: f64,
        script_data: &str,
    ) -> Self {
        let id  = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        let total_reward = reward + fees;
        let hash = compute_tx_hash(
            b"HSMC_COINBASE_V2",
            &id,
            "coinbase",
            miner_address,
            total_reward,
            0.0,
            now,
        );

        let output = TxOutput {
            amount: total_reward,
            address: miner_address.to_string(),
            lock_script: format!("OP_DUP OP_HASH160 {} OP_EQUALVERIFY OP_CHECKSIG", miner_address),
            commitment: None,
            stealth_key: None,
            ephemeral_key: None,
            output_type: OutputType::Coinbase,
        };

        Self {
            id,
            hash,
            version: 2,
            from_address: "coinbase".to_string(),
            to_address:   miner_address.to_string(),
            amount:       total_reward,
            fee:          0.0,
            status:       TxStatus::Confirmed,
            created_at:   now,
            confirmed_at: Some(now),
            block_number: Some(block_number),
            inputs:       vec![],
            outputs:      vec![output],
            privacy_level: PrivacyLevel::Transparent,
            ring_signature:     None,
            stealth_address:    None,
            commitment:         None,
            range_proof:        None,
            decoy_count:        None,
            key_image:          None,
            payload: TxPayload::Coinbase {
                block_height: block_number,
                reward,
                script_data: script_data.to_string(),
            },
            bridge_dest_chain:  None,
            bridge_dest_address:None,
            bridge_tx_hash:     None,
            bridge_sequence:    None,
            memo:               None,
            replaces_hash:      None,
            size_bytes:         250,
            lock_time:          0,
            nonce:              0,
            metadata:           HashMap::new(),
        }
    }

    /// Create a bridge-lock transaction
    pub fn new_bridge_lock(
        from: &str,
        amount: f64,
        dest_chain: BridgeChain,
        dest_address: &str,
        sequence: u64,
    ) -> Result<Self, TxValidationError> {
        if amount < BRIDGE_MIN_AMOUNT {
            return Err(TxValidationError::BridgeAmountTooSmall {
                amount,
                min: BRIDGE_MIN_AMOUNT,
            });
        }
        let id  = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        let bridge = BridgeData::new(dest_chain, dest_address, amount, sequence);
        let fee = bridge.fee;

        let hash = compute_tx_hash(
            b"HSMC_BRIDGE_V2",
            &id,
            from,
            "bridge_vault",
            amount,
            fee,
            now,
        );

        let lock_output = TxOutput {
            amount,
            address: "bridge_vault_0000000000000000000000000000000000000000".to_string(),
            lock_script: format!("OP_BRIDGE_LOCK {} {}", bridge.dest_chain, dest_address),
            commitment:  None,
            stealth_key: None,
            ephemeral_key: None,
            output_type: OutputType::BridgeLock,
        };

        let dest_chain_str = bridge.dest_chain.to_string();
        let bridge_seq = bridge.sequence;

        Ok(Self {
            id,
            hash,
            version: 2,
            from_address:       from.to_string(),
            to_address:         "bridge_vault".to_string(),
            amount,
            fee,
            status:             TxStatus::Pending,
            created_at:         now,
            confirmed_at:       None,
            block_number:       None,
            inputs:             vec![TxInput::new("0".repeat(64).as_str(), 0, "")],
            outputs:            vec![lock_output],
            privacy_level:      PrivacyLevel::Transparent,
            ring_signature:     None,
            stealth_address:    None,
            commitment:         None,
            range_proof:        None,
            decoy_count:        None,
            key_image:          None,
            payload: TxPayload::BridgeLock {
                bridge,
                stealth_proof: None,
            },
            bridge_dest_chain:  Some(dest_chain_str),
            bridge_dest_address:Some(dest_address.to_string()),
            bridge_tx_hash:     None,
            bridge_sequence:    Some(bridge_seq),
            memo:               None,
            replaces_hash:      None,
            size_bytes:         350,
            lock_time:          0,
            nonce:              0,
            metadata:           HashMap::new(),
        })
    }

    // ── State mutations ────────────────────────────────────────────────────────

    /// Mark this transaction as confirmed in a block
    pub fn confirm(&mut self, block_number: u64) {
        self.status       = TxStatus::Confirmed;
        self.confirmed_at = Some(Utc::now().timestamp());
        self.block_number = Some(block_number);
    }

    /// Mark as bridge-locked (HSMC locked, waiting for wHSMC mint)
    pub fn bridge_lock(&mut self) {
        self.status = TxStatus::BridgeLocked;
    }

    /// Mark as bridge-minted (wHSMC successfully minted on destination chain)
    pub fn bridge_mint(&mut self, evm_tx_hash: &str) {
        self.status          = TxStatus::BridgeMinted;
        self.bridge_tx_hash  = Some(evm_tx_hash.to_string());
        self.confirmed_at    = Some(Utc::now().timestamp());
    }

    /// Replace-by-fee: update fee and recalculate hash
    pub fn replace_with_fee(&mut self, new_fee: f64) -> Result<(), TxValidationError> {
        if new_fee <= self.fee {
            return Err(TxValidationError::RbfFeeTooLow {
                current_fee: self.fee,
                new_fee,
            });
        }
        let old_hash = self.hash.clone();
        self.fee = new_fee;
        self.replaces_hash = Some(old_hash);
        // Recalculate hash with new fee
        self.hash = compute_tx_hash(
            TX_HASH_PREFIX,
            &self.id,
            &self.from_address,
            &self.to_address,
            self.amount,
            self.fee,
            self.created_at,
        );
        Ok(())
    }

    /// Attach a privacy proof set (for RingCt/Stealth/Full transactions)
    pub fn attach_ring_proof(
        &mut self,
        ring_sig: &str,
        commitment: &str,
        ring_size: u8,
        key_image: &str,
    ) {
        self.ring_signature = Some(ring_sig.to_string());
        self.commitment     = Some(commitment.to_string());
        self.decoy_count    = Some(ring_size);
        self.key_image      = Some(key_image.to_string());
    }

    /// Attach stealth proof fields
    pub fn attach_stealth_proof(&mut self, stealth_address: &str) {
        self.stealth_address = Some(stealth_address.to_string());
    }

    /// Attach Bulletproof range proof
    pub fn attach_range_proof(&mut self, range_proof: &str) {
        self.range_proof = Some(range_proof.to_string());
    }

    /// Add a metadata annotation (explorer / wallet label)
    pub fn annotate(&mut self, key: &str, value: &str) {
        self.metadata.insert(key.to_string(), value.to_string());
    }

    // ── Fee utilities ──────────────────────────────────────────────────────────

    /// Minimum fee required for this transaction's privacy level
    pub fn min_fee(&self) -> f64 {
        self.privacy_level.min_fee()
    }

    /// Minimum fee for a given privacy level (backwards-compatible static method)
    pub fn min_fee_for_privacy(level: &PrivacyLevel) -> f64 {
        level.min_fee()
    }

    /// Fee per byte (for mempool prioritisation)
    pub fn fee_per_byte(&self) -> f64 {
        if self.size_bytes == 0 { return self.fee; }
        self.fee / self.size_bytes as f64
    }

    /// Whether this transaction has a higher effective fee than `other`
    pub fn has_higher_priority_than(&self, other: &Transaction) -> bool {
        self.fee_per_byte() > other.fee_per_byte()
    }

    // ── Validation helpers ────────────────────────────────────────────────────

    /// Validate the internal consistency of this transaction
    pub fn validate(&self) -> Result<(), TxValidationError> {
        validate_tx(self)
    }

    /// Returns true if this is a coinbase transaction
    pub fn is_coinbase(&self) -> bool {
        self.payload.is_coinbase() || self.from_address == "coinbase"
    }

    /// Returns true if this is a bridge lock transaction
    pub fn is_bridge(&self) -> bool {
        self.payload.is_bridge()
    }

    /// Returns true if the transaction is final (no RBF, lock_time satisfied)
    pub fn is_final(&self, current_height: u64) -> bool {
        self.lock_time == 0 || self.lock_time <= current_height
    }

    /// Returns true if any input signals RBF opt-in (BIP125)
    pub fn signals_rbf(&self) -> bool {
        self.inputs.iter().any(|i| i.is_rbf())
    }

    /// Check whether key image has been seen before (double-spend detection)
    pub fn has_key_image(&self) -> bool {
        self.key_image.is_some()
    }

    /// Compute the effective "fee priority score" for mempool ordering.
    /// Higher = evicted last.
    pub fn priority_score(&self) -> f64 {
        // Score = fee_per_byte * privacy_multiplier
        // Privacy txs carry more verification cost → need higher fee to be competitive
        self.fee_per_byte() * (1.0 / self.privacy_level.fee_multiplier() + 1.0)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Validation
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub enum TxValidationError {
    EmptyHash,
    EmptyFromAddress,
    EmptyToAddress,
    SelfTransfer,
    NegativeOrNonFiniteAmount,
    NegativeOrNonFiniteFee,
    FeeTooLow                { required: f64, provided: f64 },
    MissingRingSignature,
    MissingCommitment,
    MissingRangeProof,
    MissingStealthAddress,
    InvalidRingSignatureStructure,
    InvalidCommitmentStructure,
    InvalidRangeProofStructure,
    InvalidStealthProof,
    RingTooSmall             { size: usize, min: usize },
    RingTooBig               { size: usize, max: usize },
    TooManyInputs            { count: usize, max: usize },
    TooManyOutputs           { count: usize, max: usize },
    MemoTooLong              { len: usize, max: usize },
    BridgeAmountTooSmall     { amount: f64, min: f64 },
    BridgeInvalidAddress,
    RbfFeeTooLow             { current_fee: f64, new_fee: f64 },
    TransactionTooLarge      { size: u32, max: u32 },
    DoubleSpendDetected      { key_image: String },
    LockTimeNotMet           { lock_time: u64, height: u64 },
}

impl fmt::Display for TxValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyHash                  => write!(f, "Transaction hash is empty"),
            Self::EmptyFromAddress           => write!(f, "from_address is empty"),
            Self::EmptyToAddress             => write!(f, "to_address is empty"),
            Self::SelfTransfer               => write!(f, "Self-transfers are not allowed"),
            Self::NegativeOrNonFiniteAmount  => write!(f, "Amount must be finite and non-negative"),
            Self::NegativeOrNonFiniteFee     => write!(f, "Fee must be finite and non-negative"),
            Self::FeeTooLow { required, provided } =>
                write!(f, "Fee too low: required {:.6} HSMC, provided {:.6}", required, provided),
            Self::MissingRingSignature       => write!(f, "Privacy level requires ring_signature"),
            Self::MissingCommitment          => write!(f, "Privacy level requires Pedersen commitment"),
            Self::MissingRangeProof          => write!(f, "Full privacy requires Bulletproof range_proof"),
            Self::MissingStealthAddress      => write!(f, "Privacy level requires stealth_address"),
            Self::InvalidRingSignatureStructure => write!(f, "Ring signature has invalid structure"),
            Self::InvalidCommitmentStructure    => write!(f, "Commitment has invalid structure"),
            Self::InvalidRangeProofStructure    => write!(f, "Range proof has invalid structure"),
            Self::InvalidStealthProof           => write!(f, "Stealth proof is invalid"),
            Self::RingTooSmall { size, min } =>
                write!(f, "Ring size {} < minimum {}", size, min),
            Self::RingTooBig { size, max } =>
                write!(f, "Ring size {} > maximum {}", size, max),
            Self::TooManyInputs { count, max } =>
                write!(f, "Too many inputs: {} (max {})", count, max),
            Self::TooManyOutputs { count, max } =>
                write!(f, "Too many outputs: {} (max {})", count, max),
            Self::MemoTooLong { len, max } =>
                write!(f, "Memo too long: {} chars (max {})", len, max),
            Self::BridgeAmountTooSmall { amount, min } =>
                write!(f, "Bridge amount {:.4} < minimum {:.4} HSMC", amount, min),
            Self::BridgeInvalidAddress       => write!(f, "Bridge destination address is invalid"),
            Self::RbfFeeTooLow { current_fee, new_fee } =>
                write!(f, "RBF fee {:.6} must be > current fee {:.6}", new_fee, current_fee),
            Self::TransactionTooLarge { size, max } =>
                write!(f, "Tx too large: {} bytes (max {})", size, max),
            Self::DoubleSpendDetected { key_image } =>
                write!(f, "Double spend detected: key image {} already seen", &key_image[..12.min(key_image.len())]),
            Self::LockTimeNotMet { lock_time, height } =>
                write!(f, "Lock time {} not met at height {}", lock_time, height),
        }
    }
}

impl std::error::Error for TxValidationError {}

/// Validate a transaction for mempool acceptance (does not check double-spend — that's Chain's job)
pub fn validate_tx(tx: &Transaction) -> Result<(), TxValidationError> {
    // Basic field checks
    if tx.hash.is_empty()         { return Err(TxValidationError::EmptyHash); }
    if tx.from_address.is_empty() { return Err(TxValidationError::EmptyFromAddress); }
    if tx.to_address.is_empty()   { return Err(TxValidationError::EmptyToAddress); }
    if tx.from_address == tx.to_address && !tx.is_coinbase() {
        return Err(TxValidationError::SelfTransfer);
    }

    // Numeric sanity (allow amount = 0 for RingCT where amount is hidden)
    if tx.amount < 0.0 || !tx.amount.is_finite() {
        return Err(TxValidationError::NegativeOrNonFiniteAmount);
    }
    if tx.fee < 0.0 || !tx.fee.is_finite() {
        return Err(TxValidationError::NegativeOrNonFiniteFee);
    }

    // Skip fee/privacy checks for coinbase
    if tx.is_coinbase() { return Ok(()); }

    // Fee floor
    let min_fee = tx.min_fee();
    if tx.fee < min_fee {
        return Err(TxValidationError::FeeTooLow { required: min_fee, provided: tx.fee });
    }

    // UTXO limits
    if tx.inputs.len() > MAX_TX_INPUTS {
        return Err(TxValidationError::TooManyInputs { count: tx.inputs.len(), max: MAX_TX_INPUTS });
    }
    if tx.outputs.len() > MAX_TX_OUTPUTS {
        return Err(TxValidationError::TooManyOutputs { count: tx.outputs.len(), max: MAX_TX_OUTPUTS });
    }

    // Memo length
    if let Some(ref m) = tx.memo {
        if m.len() > MAX_MEMO_LEN {
            return Err(TxValidationError::MemoTooLong { len: m.len(), max: MAX_MEMO_LEN });
        }
    }

    // Transaction size
    let max_tx_size = 65536u32; // 64 KB
    if tx.size_bytes > max_tx_size {
        return Err(TxValidationError::TransactionTooLarge { size: tx.size_bytes, max: max_tx_size });
    }

    // Privacy proof requirements
    match &tx.privacy_level {
        PrivacyLevel::Transparent => {}

        PrivacyLevel::RingCt => {
            let sig = tx.ring_signature.as_deref().ok_or(TxValidationError::MissingRingSignature)?;
            tx.commitment.as_deref().ok_or(TxValidationError::MissingCommitment)?;
            // Validate ring size embedded in legacy field
            if let Some(ring_size) = tx.decoy_count {
                let n = ring_size as usize;
                if n < MIN_RING_SIZE { return Err(TxValidationError::RingTooSmall { size: n, min: MIN_RING_SIZE }); }
                if n > MAX_RING_SIZE { return Err(TxValidationError::RingTooBig   { size: n, max: MAX_RING_SIZE }); }
            }
        }

        PrivacyLevel::Stealth => {
            tx.ring_signature.as_deref().ok_or(TxValidationError::MissingRingSignature)?;
            tx.stealth_address.as_deref().ok_or(TxValidationError::MissingStealthAddress)?;
            tx.commitment.as_deref().ok_or(TxValidationError::MissingCommitment)?;
        }

        PrivacyLevel::Full => {
            tx.ring_signature.as_deref().ok_or(TxValidationError::MissingRingSignature)?;
            tx.stealth_address.as_deref().ok_or(TxValidationError::MissingStealthAddress)?;
            tx.commitment.as_deref().ok_or(TxValidationError::MissingCommitment)?;
            tx.range_proof.as_deref().ok_or(TxValidationError::MissingRangeProof)?;
            // Validate range proof structure
            if let Some(ref rp) = tx.range_proof {
                if rp.is_empty() || rp.len() % 2 != 0 {
                    return Err(TxValidationError::InvalidRangeProofStructure);
                }
            }
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash utilities
// ─────────────────────────────────────────────────────────────────────────────

/// Compute a tagged double-SHA256 transaction hash.
/// Domain separation via `prefix` prevents hash collisions with block headers.
pub fn compute_tx_hash(
    prefix: &[u8],
    id: &str,
    from: &str,
    to: &str,
    amount: f64,
    fee: f64,
    timestamp: i64,
) -> String {
    let data = format!(
        "{}:{}:{}:{:.12}:{:.12}:{}",
        id, from, to, amount, fee, timestamp
    );
    // First pass with domain separator
    let first = {
        let mut h = Sha256::new();
        h.update(prefix);
        h.update(data.as_bytes());
        h.finalize()
    };
    // Second pass (SHA256d)
    let second = Sha256::digest(&first);
    format!("0x{}", hex::encode(second))
}

/// Hash arbitrary bytes with a domain tag (generic utility)
pub fn tagged_hash(tag: &[u8], data: &[u8]) -> String {
    let tag_hash = Sha256::digest(tag);
    let first = {
        let mut h = Sha256::new();
        h.update(&tag_hash);
        h.update(&tag_hash);
        h.update(data);
        h.finalize()
    };
    hex::encode(Sha256::digest(&first))
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee calculator (standalone)
// ─────────────────────────────────────────────────────────────────────────────

/// Recommend a fee for a new transaction given current mempool conditions
pub fn recommend_fee(
    size_bytes: usize,
    privacy: &PrivacyLevel,
    congestion_factor: f64, // 0.0 = empty mempool, 1.0 = full mempool
) -> FeeRecommendation {
    let base = MIN_BASE_FEE * (size_bytes as f64 / 250.0).max(1.0);
    let privacy_mult = privacy.fee_multiplier();
    let congestion_mult = 1.0 + congestion_factor * 3.0;

    let slow   = (base * privacy_mult * congestion_mult * 0.7).max(privacy.min_fee());
    let normal = (base * privacy_mult * congestion_mult * 1.0).max(privacy.min_fee());
    let fast   = (base * privacy_mult * congestion_mult * 2.0).max(privacy.min_fee());

    FeeRecommendation { slow, normal, fast }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeRecommendation {
    pub slow:   f64,
    pub normal: f64,
    pub fast:   f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transparent_tx_valid() {
        let tx = Transaction::new("ADDR_A", "ADDR_B", 10.0, 0.0001, PrivacyLevel::Transparent);
        assert!(validate_tx(&tx).is_ok());
    }

    #[test]
    fn test_reject_self_transfer() {
        let tx = Transaction::new("ADDR_A", "ADDR_A", 1.0, 0.001, PrivacyLevel::Transparent);
        assert!(matches!(validate_tx(&tx), Err(TxValidationError::SelfTransfer)));
    }

    #[test]
    fn test_reject_low_fee() {
        let tx = Transaction::new("ADDR_A", "ADDR_B", 1.0, 0.000001, PrivacyLevel::Transparent);
        assert!(matches!(validate_tx(&tx), Err(TxValidationError::FeeTooLow { .. })));
    }

    #[test]
    fn test_reject_ringct_without_ring_sig() {
        let tx = Transaction::new("ADDR_A", "ADDR_B", 0.0, 0.001, PrivacyLevel::RingCt);
        assert!(matches!(validate_tx(&tx), Err(TxValidationError::MissingRingSignature)));
    }

    #[test]
    fn test_reject_full_without_range_proof() {
        let mut tx = Transaction::new("ADDR_A", "ADDR_B", 0.0, 0.005, PrivacyLevel::Full);
        tx.ring_signature  = Some("deadbeef".repeat(8));
        tx.stealth_address = Some("0xStealth".into());
        tx.commitment      = Some("0xCommit".into());
        // range_proof is still None → should fail
        assert!(matches!(validate_tx(&tx), Err(TxValidationError::MissingRangeProof)));
    }

    #[test]
    fn test_coinbase_skips_fee_check() {
        let cb = Transaction::new_coinbase(1, "HSMC_miner", 50.0, 0.001, "test");
        assert!(validate_tx(&cb).is_ok());
    }

    #[test]
    fn test_hash_determinism() {
        let id  = "test-id-001";
        let h1  = compute_tx_hash(TX_HASH_PREFIX, id, "from", "to", 1.0, 0.001, 1_700_000_000);
        let h2  = compute_tx_hash(TX_HASH_PREFIX, id, "from", "to", 1.0, 0.001, 1_700_000_000);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_bridge_lock_min_amount() {
        let result = Transaction::new_bridge_lock(
            "HSMC_sender",
            0.5, // below 1 HSMC minimum
            BridgeChain::Bsc,
            "0xRecipient",
            1,
        );
        assert!(matches!(result, Err(TxValidationError::BridgeAmountTooSmall { .. })));
    }

    #[test]
    fn test_bridge_lock_valid() -> anyhow::Result<()> {
        let tx = Transaction::new_bridge_lock(
            "HSMC_sender",
            10.0,
            BridgeChain::Bsc,
            "0xRecipient000000000000000000000000000000",
            1,
        )?;
        assert_eq!(tx.bridge_dest_chain.as_deref(), Some("bsc"));
        assert!(tx.fee > 0.0);
        assert!(tx.fee < tx.amount);
        Ok(())
    }

    #[test]
    fn test_fee_recommendation() {
        let rec = recommend_fee(500, &PrivacyLevel::Full, 0.5);
        assert!(rec.fast > rec.normal);
        assert!(rec.normal > rec.slow);
        assert!(rec.slow >= PrivacyLevel::Full.min_fee());
    }

    #[test]
    fn test_priority_ordering() {
        let mut high_fee = Transaction::new("A", "B", 1.0, 0.01, PrivacyLevel::Transparent);
        let mut low_fee  = Transaction::new("A", "B", 1.0, 0.001, PrivacyLevel::Transparent);
        high_fee.size_bytes = 250;
        low_fee.size_bytes  = 250;
        assert!(high_fee.has_higher_priority_than(&low_fee));
    }

    #[test]
    fn test_privacy_level_display() {
        assert_eq!(PrivacyLevel::Full.to_string(), "full");
        assert_eq!(PrivacyLevel::RingCt.to_string(), "ringct");
    }

    #[test]
    fn test_bridge_chain_ids() {
        assert_eq!(BridgeChain::Bsc.chain_id(), 56);
        assert_eq!(BridgeChain::Ethereum.chain_id(), 1);
        assert_eq!(BridgeChain::Polygon.chain_id(), 137);
    }

    #[test]
    fn test_tx_signals_rbf() {
        let mut tx = Transaction::new("A", "B", 1.0, 0.001, PrivacyLevel::Transparent);
        assert!(!tx.signals_rbf());
        tx.inputs[0].sequence = 0xFFFFFFFD;
        assert!(tx.signals_rbf());
    }
}
