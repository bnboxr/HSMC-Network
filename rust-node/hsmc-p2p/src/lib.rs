/// hsmc-p2p — Production P2P networking module
/// Dandelion++, Gossip protocol, peer discovery, ban scoring, sync service,
/// and Noise Protocol encrypted transport (Noise_IK_25519_ChaChaPoly_BLAKE2b).
pub mod peer;
pub mod gossip;
pub mod dandelion;
pub mod sync;
pub mod discovery;
pub mod message;
pub mod noise;

pub use peer::*;
pub use gossip::*;
pub use dandelion::*;
pub use sync::*;
pub use discovery::*;
pub use message::*;
pub use noise::{
    NoiseHandshake, NoiseTransport, NoiseError, HandshakeRole, HandshakeResult,
    generate_keypair,
    NOISE_NEGOTIATION_PLAINTEXT, NOISE_NEGOTIATION_NOISE,
    is_valid_negotiation_byte,
};
