/// P2P wire protocol message types
/// Full serializable protocol with versioning, checksums, and compression
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use chrono::{DateTime, Utc};

// ─── Protocol Constants ───────────────────────────────────────────────────────

pub const PROTOCOL_VERSION: u32 = 2;
pub const MAGIC_MAINNET: u32 = 0x48534D43; // "HSMC" in ASCII
pub const MAGIC_TESTNET: u32 = 0x4853544E; // "HSTN"
pub const MAX_MESSAGE_SIZE: usize = 32 * 1024 * 1024; // 32 MB
pub const MAX_INV_ITEMS: usize = 50_000;
pub const MAX_HEADERS_COUNT: usize = 2_000;
pub const MAX_BLOCK_TXS: usize = 10_000;
pub const NONCE_SIZE: usize = 8;

// ─── Inventory ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u32)]
pub enum InvType {
    Error      = 0,
    Tx         = 1,
    Block      = 2,
    FilteredBlock = 3,
    WitnessTx  = 0x40000001,
    WitnessBlock = 0x40000002,
    CompactBlock = 4,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvItem {
    pub inv_type: InvType,
    pub hash:     String,
}

// ─── Message Types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum P2PMessage {
    /// Initial handshake
    Version(VersionMsg),
    /// Handshake acknowledgment
    VerAck,
    /// Request peer addresses
    GetAddr,
    /// Peer addresses
    Addr(AddrMsg),
    /// Announce inventory
    Inv(InvMsg),
    /// Request data by inventory
    GetData(GetDataMsg),
    /// Block not found
    NotFound(NotFoundMsg),
    /// Request block headers
    GetHeaders(GetHeadersMsg),
    /// Block headers
    Headers(HeadersMsg),
    /// Request blocks
    GetBlocks(GetBlocksMsg),
    /// Full block
    Block(BlockMsg),
    /// Transaction
    Tx(TxMsg),
    /// Memory pool request (returns tx hashes)
    MemPool,
    /// Compact block announcement
    CmpctBlock(CmpctBlockMsg),
    /// Request missing compact block transactions
    GetBlockTxns(GetBlockTxnsMsg),
    /// Compact block transaction data
    BlockTxns(BlockTxnsMsg),
    /// Ping with nonce
    Ping { nonce: u64 },
    /// Pong with matching nonce
    Pong { nonce: u64 },
    /// Alert (deprecated, but kept for backwards compat)
    Alert { message: String, signature: String },
    /// Reject a message
    Reject(RejectMsg),
    /// Filter (Bloom filter for SPV)
    FilterLoad(FilterLoadMsg),
    FilterAdd { data: Vec<u8> },
    FilterClear,
    /// Send compact blocks v2
    SendCmpct { announce: bool, version: u64 },
    /// Fee filter: don't relay txs below this fee rate
    FeeFilter { min_fee_rate: u64 },
    /// Dandelion++ stem transaction
    DandelionStem(DandelionStemMsg),
    /// Announce validated block hash for checkpoint
    Checkpoint(CheckpointMsg),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionMsg {
    pub version:        u32,
    pub services:       u64,       // node service flags
    pub timestamp:      i64,
    pub addr_recv:      PeerAddress,
    pub addr_from:      PeerAddress,
    pub nonce:          u64,       // random nonce for loop detection
    pub user_agent:     String,
    pub start_height:   u64,       // best block height at connection time
    pub relay:          bool,       // whether to relay unconfirmed txs
    pub protocol_features: ProtocolFeatures,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProtocolFeatures {
    pub compact_blocks: bool,
    pub dandelion: bool,
    pub segwit: bool,
    pub taproot: bool,
    pub ring_ct: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerAddress {
    pub services: u64,
    pub ip:       String,
    pub port:     u16,
    pub last_seen: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddrMsg {
    pub addresses: Vec<PeerAddress>,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvMsg {
    pub items: Vec<InvItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetDataMsg {
    pub items: Vec<InvItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotFoundMsg {
    pub items: Vec<InvItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetHeadersMsg {
    pub version:         u32,
    pub locator_hashes:  Vec<String>, // block locator from newest to genesis
    pub stop_hash:       String,       // all-zero = as many as possible
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeadersMsg {
    pub headers: Vec<BlockHeaderWire>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockHeaderWire {
    pub block_number:   u64,
    pub hash:           String,
    pub prev_hash:      String,
    pub merkle_root:    String,
    pub timestamp:      i64,
    pub difficulty:     u64,
    pub nonce:          u64,
    pub tx_count:       u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetBlocksMsg {
    pub version:        u32,
    pub locator_hashes: Vec<String>,
    pub stop_hash:      String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockMsg {
    pub block_number:   u64,
    pub hash:           String,
    pub prev_hash:      String,
    pub miner_address:  String,
    pub difficulty:     u64,
    pub nonce:          u64,
    pub timestamp:      i64,
    pub merkle_root:    String,
    pub transactions:   Vec<TxMsg>,
    pub coinbase_data:  Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxMsg {
    pub hash:           String,
    pub version:        u32,
    pub inputs:         Vec<TxInputWire>,
    pub outputs:        Vec<TxOutputWire>,
    pub locktime:       u64,
    pub fee:            u64,
    pub privacy_level:  u8,
    pub ring_signature: Option<String>,
    pub range_proof:    Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxInputWire {
    pub txid:        String,
    pub vout:        u32,
    pub script_sig:  String,
    pub sequence:    u32,
    pub witness:     Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxOutputWire {
    pub value:        u64,
    pub script_pubkey: String,
    pub commitment:   Option<String>, // Pedersen commitment for confidential outputs
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmpctBlockMsg {
    pub header:   BlockHeaderWire,
    pub nonce:    u64,
    pub short_ids: Vec<u64>, // SipHash short tx IDs
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetBlockTxnsMsg {
    pub block_hash: String,
    pub indices:    Vec<u16>, // transaction indices needed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockTxnsMsg {
    pub block_hash:   String,
    pub transactions: Vec<TxMsg>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RejectMsg {
    pub message:  String,     // rejected message type
    pub code:     RejectCode,
    pub reason:   String,
    pub data:     Vec<u8>,    // hash or extra data
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[repr(u8)]
pub enum RejectCode {
    Malformed    = 0x01,
    Invalid      = 0x10,
    Obsolete     = 0x11,
    Duplicate    = 0x12,
    NonStandard  = 0x40,
    DustOutput   = 0x41,
    InsufficientFee = 0x42,
    Checkpoint   = 0x43,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterLoadMsg {
    pub filter:    Vec<u8>,
    pub n_hash_funcs: u32,
    pub n_tweak:   u32,
    pub n_flags:   u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DandelionStemMsg {
    pub tx:         TxMsg,
    pub routing_id: String,  // anonymized stem path identifier
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointMsg {
    pub height:    u64,
    pub hash:      String,
    pub signature: String,  // validator signature
    pub validators: Vec<String>, // signing validators
}

// ─── Message envelope ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageEnvelope {
    pub magic:    u32,
    pub checksum: [u8; 4],
    pub payload:  P2PMessage,
}

impl MessageEnvelope {
    pub fn new(magic: u32, msg: P2PMessage) -> Self {
        let payload_bytes = serde_json::to_vec(&msg).unwrap_or_default();
        let checksum_full = Sha256::digest(Sha256::digest(&payload_bytes));
        let mut checksum = [0u8; 4];
        checksum.copy_from_slice(&checksum_full[..4]);
        Self { magic, checksum, payload: msg }
    }

    pub fn verify_checksum(&self) -> bool {
        let payload_bytes = serde_json::to_vec(&self.payload).unwrap_or_default();
        let checksum_full = Sha256::digest(Sha256::digest(&payload_bytes));
        &checksum_full[..4] == self.checksum
    }
}

// ─── Node Service Flags ───────────────────────────────────────────────────────

bitflags::bitflags! {
    // The bitflags `serde` feature supports these derives on the public flag type.
    // VersionMsg/PeerAddress retain their established numeric u64 wire fields below.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub struct NodeServices: u64 {
        const NETWORK        = 1 << 0;  // Full node
        const BLOOM          = 1 << 2;  // SPV bloom filters
        const WITNESS        = 1 << 3;  // SegWit
        const COMPACT_FILTERS= 1 << 6;  // BIP157/BIP158 compact filters
        const NETWORK_LIMITED= 1 << 10; // Pruned node
        const RING_CT        = 1 << 20; // HSMC RingCT support
        const STRATUM        = 1 << 21; // Mining stratum
        const BRIDGE_RELAY   = 1 << 22; // wHSMC bridge relay
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_services_constructs_and_retains_protocol_bits() {
        let services = NodeServices::NETWORK | NodeServices::RING_CT | NodeServices::STRATUM;

        assert_eq!(services.bits(), (1 << 0) | (1 << 20) | (1 << 21));
        assert!(services.contains(NodeServices::NETWORK));
        assert!(services.contains(NodeServices::RING_CT));
        assert!(services.contains(NodeServices::STRATUM));
        assert_eq!(NodeServices::from_bits(services.bits()), Some(services));

        // Regression: this requires bitflags' `serde` feature rather than a
        // derive on the macro input (which targets its private representation).
        let encoded = serde_json::to_string(&services).expect("NodeServices serializes");
        let decoded: NodeServices =
            serde_json::from_str(&encoded).expect("NodeServices deserializes");
        assert_eq!(decoded, services);
    }

    #[test]
    fn version_message_keeps_services_as_numeric_wire_flags() {
        let services = NodeServices::NETWORK | NodeServices::RING_CT;
        let version = VersionMsg {
            version: PROTOCOL_VERSION,
            services: services.bits(),
            timestamp: 0,
            addr_recv: PeerAddress {
                services: services.bits(),
                ip: "127.0.0.1".into(),
                port: 18_080,
                last_seen: 0,
            },
            addr_from: PeerAddress {
                services: 0,
                ip: "0.0.0.0".into(),
                port: 0,
                last_seen: 0,
            },
            nonce: 42,
            user_agent: "/hsmc:test/".into(),
            start_height: 0,
            relay: true,
            protocol_features: ProtocolFeatures::default(),
        };

        let wire = serde_json::to_value(&version).expect("version message serializes");
        assert_eq!(wire["services"], serde_json::json!(services.bits()));
        assert_eq!(wire["addr_recv"]["services"], serde_json::json!(services.bits()));

        let decoded: VersionMsg =
            serde_json::from_value(wire).expect("version message deserializes");
        assert_eq!(decoded.services, services.bits());
        assert_eq!(decoded.addr_recv.services, services.bits());
    }
}
