/// Post-Quantum Signature — Dilithium-5 (ML-DSA-87 / FIPS 204)
///
/// Wraps the `fips204` crate (ML-DSA-87 / Dilithium-5 parameter set).
/// Provides NIST-standardised post-quantum digital signatures resistant
/// to both classical and quantum attacks.
///
/// Key sizes (Dilithium-5 / ML-DSA-87):
///   - Public key:  2592 bytes
///   - Secret key:  4896 bytes
///   - Signature:   4627 bytes
///
/// These are large compared to ECDSA, but provide quantum security at
/// NIST security level 5 (equivalent to AES-256).

use fips204::ml_dsa_87;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

// ─────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum PqDilithiumError {
    #[error("Key generation failed: {0}")]
    KeyGen(String),
    #[error("Signing failed: {0}")]
    Signing(String),
    #[error("Verification failed: signature does not match")]
    VerificationFailed,
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Invalid key format")]
    InvalidKeyFormat,
}

// ─────────────────────────────────────────────────────────────
// Key types
// ─────────────────────────────────────────────────────────────

/// Dilithium-5 public key (2592 bytes)
#[derive(Clone, Serialize, Deserialize)]
pub struct PqDilithiumPublicKey {
    /// Raw ML-DSA-87 public key bytes
    pub key_bytes: Vec<u8>,
}

/// Dilithium-5 secret key (4896 bytes)
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct PqDilithiumSecretKey {
    /// Raw ML-DSA-87 secret key bytes
    #[zeroize(skip)] // underlying bytes already handled; Vec<u8> zeroizes on drop
    pub key_bytes: Vec<u8>,
}

impl Drop for PqDilithiumSecretKey {
    fn drop(&mut self) {
        // Explicitly zeroize secret key material
        for byte in self.key_bytes.iter_mut() {
            *byte = 0;
        }
    }
}

/// Dilithium-5 key pair
#[derive(Clone)]
pub struct PqDilithiumKeyPair {
    pub public_key:  PqDilithiumPublicKey,
    pub secret_key:  PqDilithiumSecretKey,
}

/// Dilithium-5 signature (4627 bytes for ML-DSA-87)
#[derive(Clone, Serialize, Deserialize)]
pub struct PqDilithiumSignature {
    pub sig_bytes: Vec<u8>,
}

// ─────────────────────────────────────────────────────────────
// Key generation
// ─────────────────────────────────────────────────────────────

/// Generate a fresh Dilithium-5 (ML-DSA-87) key pair using OS CSPRNG
pub fn pq_dilithium_keygen() -> Result<PqDilithiumKeyPair, PqDilithiumError> {
    let (pk, sk) = ml_dsa_87::try_keygen()
        .map_err(|e| PqDilithiumError::KeyGen(format!("ML-DSA-87 keygen failed: {:?}", e)))?;

    Ok(PqDilithiumKeyPair {
        public_key: PqDilithiumPublicKey {
            key_bytes: pk.into_bytes().to_vec(),
        },
        secret_key: PqDilithiumSecretKey {
            key_bytes: sk.into_bytes().to_vec(),
        },
    })
}

// ─────────────────────────────────────────────────────────────
// Signing
// ─────────────────────────────────────────────────────────────

/// Sign a message with Dilithium-5
///
/// The message can be arbitrary bytes. Internally, ML-DSA-87 hashes
/// the message as part of the signing process (hash-then-sign).
pub fn pq_dilithium_sign(
    message: &[u8],
    secret_key: &PqDilithiumSecretKey,
) -> Result<PqDilithiumSignature, PqDilithiumError> {
    let sk = ml_dsa_87::SigningKey::try_from_bytes(&secret_key.key_bytes)
        .map_err(|e| PqDilithiumError::InvalidKeyFormat)?;

    let sig = sk.try_sign(message)
        .map_err(|e| PqDilithiumError::Signing(format!("ML-DSA-87 sign failed: {:?}", e)))?;

    Ok(PqDilithiumSignature {
        sig_bytes: sig.into_bytes().to_vec(),
    })
}

/// Sign a message with a full key pair (convenience)
pub fn pq_dilithium_sign_with_keypair(
    message: &[u8],
    keypair: &PqDilithiumKeyPair,
) -> Result<PqDilithiumSignature, PqDilithiumError> {
    pq_dilithium_sign(message, &keypair.secret_key)
}

// ─────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────

/// Verify a Dilithium-5 signature
pub fn pq_dilithium_verify(
    message: &[u8],
    signature: &PqDilithiumSignature,
    public_key: &PqDilithiumPublicKey,
) -> Result<bool, PqDilithiumError> {
    let pk = ml_dsa_87::VerifyingKey::try_from_bytes(&public_key.key_bytes)
        .map_err(|e| PqDilithiumError::InvalidKeyFormat)?;

    let sig = ml_dsa_87::Signature::try_from_bytes(&signature.sig_bytes)
        .map_err(|e| PqDilithiumError::InvalidKeyFormat)?;

    match pk.try_verify(message, &sig) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

// ─────────────────────────────────────────────────────────────
// Serialization helpers
// ─────────────────────────────────────────────────────────────

impl PqDilithiumPublicKey {
    /// Serialize to hex string
    pub fn to_hex(&self) -> String {
        hex::encode(&self.key_bytes)
    }

    /// Deserialize from hex string
    pub fn from_hex(hex_str: &str) -> Result<Self, PqDilithiumError> {
        let bytes = hex::decode(hex_str)
            .map_err(|e| PqDilithiumError::Serialization(e.to_string()))?;
        Ok(Self { key_bytes: bytes })
    }

    /// Get raw bytes reference
    pub fn as_bytes(&self) -> &[u8] {
        &self.key_bytes
    }

    /// Expected size for ML-DSA-87 public key
    pub const KEY_SIZE: usize = 2592;
}

impl PqDilithiumSecretKey {
    /// Serialize to hex string (WARNING: exposes secret material)
    pub fn to_hex(&self) -> String {
        hex::encode(&self.key_bytes)
    }

    /// Deserialize from hex string
    pub fn from_hex(hex_str: &str) -> Result<Self, PqDilithiumError> {
        let bytes = hex::decode(hex_str)
            .map_err(|e| PqDilithiumError::Serialization(e.to_string()))?;
        Ok(Self { key_bytes: bytes })
    }

    /// Expected size for ML-DSA-87 secret key
    pub const KEY_SIZE: usize = 4896;
}

impl PqDilithiumSignature {
    /// Serialize to hex string
    pub fn to_hex(&self) -> String {
        hex::encode(&self.sig_bytes)
    }

    /// Deserialize from hex string
    pub fn from_hex(hex_str: &str) -> Result<Self, PqDilithiumError> {
        let bytes = hex::decode(hex_str)
            .map_err(|e| PqDilithiumError::Serialization(e.to_string()))?;
        Ok(Self { sig_bytes: bytes })
    }

    /// Expected size for ML-DSA-87 signature
    pub const SIG_SIZE: usize = 4627;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dilithium_keygen() {
        let kp = pq_dilithium_keygen().expect("keygen should succeed");
        assert_eq!(kp.public_key.key_bytes.len(), PqDilithiumPublicKey::KEY_SIZE);
        assert_eq!(kp.secret_key.key_bytes.len(), PqDilithiumSecretKey::KEY_SIZE);
        // Verify keys are not all-zero
        assert!(kp.public_key.key_bytes.iter().any(|&b| b != 0));
        assert!(kp.secret_key.key_bytes.iter().any(|&b| b != 0));
    }

    #[test]
    fn test_dilithium_sign_verify() {
        let kp = pq_dilithium_keygen().expect("keygen should succeed");
        let msg = b"HSMC Post-Quantum Test Message v1";

        let sig = pq_dilithium_sign(msg, &kp.secret_key).expect("sign should succeed");
        assert_eq!(sig.sig_bytes.len(), PqDilithiumSignature::SIG_SIZE);

        let valid = pq_dilithium_verify(msg, &sig, &kp.public_key).expect("verify should succeed");
        assert!(valid, "valid signature should verify");
    }

    #[test]
    fn test_dilithium_wrong_message_fails() {
        let kp = pq_dilithium_keygen().expect("keygen should succeed");
        let msg = b"correct message";
        let wrong_msg = b"tampered message";

        let sig = pq_dilithium_sign(msg, &kp.secret_key).expect("sign should succeed");
        let valid = pq_dilithium_verify(wrong_msg, &sig, &kp.public_key).expect("verify should succeed");
        assert!(!valid, "signature for wrong message should not verify");
    }

    #[test]
    fn test_dilithium_wrong_key_fails() {
        let kp1 = pq_dilithium_keygen().expect("keygen should succeed");
        let kp2 = pq_dilithium_keygen().expect("keygen should succeed");
        let msg = b"test message";

        let sig = pq_dilithium_sign(msg, &kp1.secret_key).expect("sign should succeed");
        let valid = pq_dilithium_verify(msg, &sig, &kp2.public_key).expect("verify should succeed");
        assert!(!valid, "signature from kp1 should not verify with kp2");
    }

    #[test]
    fn test_dilithium_key_serialization() {
        let kp = pq_dilithium_keygen().expect("keygen should succeed");

        // Public key serialization round-trip
        let pk_hex = kp.public_key.to_hex();
        let pk_restored = PqDilithiumPublicKey::from_hex(&pk_hex).expect("deserialize pk");
        assert_eq!(kp.public_key.key_bytes, pk_restored.key_bytes);

        // Secret key serialization round-trip
        let sk_hex = kp.secret_key.to_hex();
        let sk_restored = PqDilithiumSecretKey::from_hex(&sk_hex).expect("deserialize sk");
        assert_eq!(kp.secret_key.key_bytes, sk_restored.key_bytes);

        // Verify restored keys still work
        let msg = b"serialization round-trip test";
        let sig = pq_dilithium_sign(msg, &sk_restored).expect("sign");
        assert!(pq_dilithium_verify(msg, &sig, &pk_restored).expect("verify"));
    }

    #[test]
    fn test_dilithium_signature_serialization() {
        let kp = pq_dilithium_keygen().expect("keygen should succeed");
        let msg = b"sig serialization test";

        let sig = pq_dilithium_sign(msg, &kp.secret_key).expect("sign");
        let sig_hex = sig.to_hex();
        let sig_restored = PqDilithiumSignature::from_hex(&sig_hex).expect("deserialize sig");

        assert!(pq_dilithium_verify(msg, &sig_restored, &kp.public_key).expect("verify"));
    }

    #[test]
    fn test_dilithium_deterministic() {
        // ML-DSA-87 is deterministic — same message, same key → same signature
        let kp = pq_dilithium_keygen().expect("keygen should succeed");
        let msg = b"deterministic test";

        let sig1 = pq_dilithium_sign(msg, &kp.secret_key).expect("sign 1");
        let sig2 = pq_dilithium_sign(msg, &kp.secret_key).expect("sign 2");

        assert_eq!(sig1.sig_bytes, sig2.sig_bytes, "ML-DSA-87 should be deterministic");
    }

    #[test]
    fn test_dilithium_empty_message() {
        let kp = pq_dilithium_keygen().expect("keygen should succeed");
        let msg = b"";

        let sig = pq_dilithium_sign(msg, &kp.secret_key).expect("sign empty");
        assert!(pq_dilithium_verify(msg, &sig, &kp.public_key).expect("verify empty"));
    }

    #[test]
    fn test_dilithium_large_message() {
        let kp = pq_dilithium_keygen().expect("keygen should succeed");
        let msg = vec![0x42u8; 100_000]; // 100KB message

        let sig = pq_dilithium_sign(&msg, &kp.secret_key).expect("sign large");
        assert!(pq_dilithium_verify(&msg, &sig, &kp.public_key).expect("verify large"));
    }
}
