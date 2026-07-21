/// hsmc-core — Full production blockchain engine
/// UTXO model, RingCT privacy, PoW consensus, script engine, governance
pub mod block;
pub mod transaction;
pub mod chain;
pub mod mempool;
pub mod wallet;
pub mod validator;
pub mod script;
pub mod governance;
pub mod fee;
pub mod state;

pub use block::*;

// Export everything from transaction EXCEPT validate_tx which conflicts with validator::validate_tx
pub use transaction::{
    Transaction, TxInput, TxOutput, TxPayload, TxStatus, PrivacyLevel,
    TxValidationError, RingSignatureProof, PedersenCommitment, BulletproofRangeProof,
    StealthProof, BridgeData, BridgeChain, OutputType,
    TX_HASH_PREFIX,
    MAX_RING_SIZE, MIN_RING_SIZE, MAX_TX_INPUTS, MAX_TX_OUTPUTS,
    MAX_TX_DATA_BYTES, MAX_MEMO_LEN, MIN_BASE_FEE,
    FEE_MULTIPLIER_TRANSPARENT, FEE_MULTIPLIER_RINGCT,
    FEE_MULTIPLIER_STEALTH, FEE_MULTIPLIER_FULL,
    BRIDGE_FEE_RATE, BRIDGE_MIN_AMOUNT,
};

pub use chain::*;
pub use mempool::*;
pub use wallet::*;
// validator::validate_tx is the canonical one — takes precedence over transaction::validate_tx
pub use validator::*;
pub use script::*;
pub use governance::*;
pub use fee::*;
pub use state::*;
