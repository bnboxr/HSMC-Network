/// Post-Quantum Key Encapsulation — Kyber-1024 (ML-KEM-1024 / FIPS 203)
///
/// Wraps the `fips203` crate (ML-KEM-1024 / Kyber-1024 parameter set).
/// Provides NIST-standardised post-quantum key encapsulation for secure
/// key exchange resistant to both classical and quantum attacks.
///
/// Key sizes (Kyber-1024 / ML-KEM-1024):
///   - Encapsulation key (public):  1568 bytes
///   - Decapsulation key (secret):  3168 bytes
///   - Ciphertext:                  1568 bytes
///   - Shared secret:               32 bytes
///
/// NIST security level 5 (equivalent to AES-256).

use fips203::ml_kem_1024;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

// ─────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum PqKyberError {
    #[error("Key generation failed: {0}")]
    KeyGen(String),
    #[error("Encapsulation failed: {0}")]
    Encapsulation(String),
    #[error("Decapsulation failed: {0}")]
    Decapsulation(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Invalid key format")]
    InvalidKeyFormat,
}

// ─────────────────────────────────────────────────────────────
// Key types
// ─────────────────────────────────────────────────────────────

/// Kyber-1024 encapsulation key (public, 1568 bytes)
#[derive(Clone, Serialize, Deserialize)]
pub struct PqKyberPublicKey {
    pub key_bytes: Vec<u8>,
}

/// Kyber-1024 decapsulation key (secret, 3168 bytes)
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct PqKyberSecretKey {
    #[zeroize(skip)]
    pub key_bytes: Vec<u8>,
}

impl Drop for PqKyberSecretKey {
    fn drop(&mut self) {
        for byte in self.key_bytes.iter_mut() {
            *byte = 0;
        }
    }
}

/// Kyber-1024 key pair
#[derive(Clone)]
pub struct PqKyberKeyPair {
    pub public_key:  PqKyberPublicKey,
    pub secret_key:  PqKyberSecretKey,
}

/// Kyber-1024 ciphertext (1568 bytes)
#[derive(Clone, Serialize, Deserialize)]
pub struct PqKyberCiphertext {
    pub ct_bytes: Vec<u8>,
}

/// Kyber-1024 shared secret (32 bytes)
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct PqKyberSharedSecret {
    #[zeroize(skip)]
    pub secret_bytes: [u8; 32],
}

impl Drop for PqKyberSharedSecret {
    fn drop(&mut self) {
        self.secret_bytes.zeroize();
    }
}

// ─────────────────────────────────────────────────────────────
// Key generation
// ─────────────────────────────────────────────────────────────

/// Generate a fresh Kyber-1024 (ML-KEM-1024) key pair using OS CSPRNG
pub fn pq_kyber_keygen() -> Result<PqKyberKeyPair, PqKyberError> {
    let (ek, dk) = ml_kem_1024::try_keygen()
        .map_err(|e| PqKyberError::KeyGen(format!("ML-KEM-1024 keygen failed: {:?}", e)))?;

    Ok(PqKyberKeyPair {
        public_key: PqKyberPublicKey {
            key_bytes: ek.into_bytes().to_vec(),
        },
        secret_key: PqKyberSecretKey {
            key_bytes: dk.into_bytes().to_vec(),
        },
    })
}

// ─────────────────────────────────────────────────────────────
// Encapsulation
// ─────────────────────────────────────────────────────────────

/// Encapsulate: given a public key, produce a ciphertext and a shared secret.
///
/// The shared secret can be used as a symmetric key (e.g., for AES-256-GCM).
/// The ciphertext is sent to the holder of the secret key, who can decapsulate
/// to recover the same shared secret.
pub fn pq_kyber_encapsulate(
    public_key: &PqKyberPublicKey,
) -> Result<(PqKyberCiphertext, PqKyberSharedSecret), PqKyberError> {
    let ek = ml_kem_1024::EncapsKey::try_from_bytes(&public_key.key_bytes)
        .map_err(|e| PqKyberError::InvalidKeyFormat)?;

    let (ct, ss) = ek.try_encaps()
        .map_err(|e| PqKyberError::Encapsulation(format!("ML-KEM-1024 encaps failed: {:?}", e)))?;

    let ct_bytes = ct.into_bytes();
    let ss_bytes: [u8; 32] = ss.into_bytes();

    Ok((
        PqKyberCiphertext { ct_bytes: ct_bytes.to_vec() },
        PqKyberSharedSecret { secret_bytes: ss_bytes },
    ))
}

/// Encapsulate with a full key pair (convenience)
pub fn pq_kyber_encapsulate_with_keypair(
    keypair: &PqKyberKeyPair,
) -> Result<(PqKyberCiphertext, PqKyberSharedSecret), PqKyberError> {
    pq_kyber_encapsulate(&keypair.public_key)
}

// ─────────────────────────────────────────────────────────────
// Decapsulation
// ─────────────────────────────────────────────────────────────

/// Decapsulate: given a ciphertext and secret key, recover the shared secret
pub fn pq_kyber_decapsulate(
    ciphertext: &PqKyberCiphertext,
    secret_key: &PqKyberSecretKey,
) -> Result<PqKyberSharedSecret, PqKyberError> {
    let dk = ml_kem_1024::DecapsKey::try_from_bytes(&secret_key.key_bytes)
        .map_err(|e| PqKyberError::InvalidKeyFormat)?;

    let ct = ml_kem_1024::Ciphertext::try_from_bytes(&ciphertext.ct_bytes)
        .map_err(|e| PqKyberError::InvalidKeyFormat)?;

    let ss = dk.try_decaps(&ct)
        .map_err(|e| PqKyberError::Decapsulation(format!("ML-KEM-1024 decaps failed: {:?}", e)))?;

    let ss_bytes: [u8; 32] = ss.into_bytes();

    Ok(PqKyberSharedSecret { secret_bytes: ss_bytes })
}

// ─────────────────────────────────────────────────────────────
// Serialization helpers
// ─────────────────────────────────────────────────────────────

impl PqKyberPublicKey {
    pub fn to_hex(&self) -> String {
        hex::encode(&self.key_bytes)
    }

    pub fn from_hex(hex_str: &str) -> Result<Self, PqKyberError> {
        let bytes = hex::decode(hex_str)
            .map_err(|e| PqKyberError::Serialization(e.to_string()))?;
        Ok(Self { key_bytes: bytes })
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.key_bytes
    }

    pub const KEY_SIZE: usize = 1568;
}

impl PqKyberSecretKey {
    pub fn to_hex(&self) -> String {
        hex::encode(&self.key_bytes)
    }

    pub fn from_hex(hex_str: &str) -> Result<Self, PqKyberError> {
        let bytes = hex::decode(hex_str)
            .map_err(|e| PqKyberError::Serialization(e.to_string()))?;
        Ok(Self { key_bytes: bytes })
    }

    pub const KEY_SIZE: usize = 3168;
}

impl PqKyberCiphertext {
    pub fn to_hex(&self) -> String {
        hex::encode(&self.ct_bytes)
    }

    pub fn from_hex(hex_str: &str) -> Result<Self, PqKyberError> {
        let bytes = hex::decode(hex_str)
            .map_err(|e| PqKyberError::Serialization(e.to_string()))?;
        Ok(Self { ct_bytes: bytes })
    }

    pub const CT_SIZE: usize = 1568;
}

impl PqKyberSharedSecret {
    pub fn to_hex(&self) -> String {
        hex::encode(self.secret_bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.secret_bytes
    }

    pub const SS_SIZE: usize = 32;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kyber_keygen() {
        let kp = pq_kyber_keygen().expect("keygen should succeed");
        assert_eq!(kp.public_key.key_bytes.len(), PqKyberPublicKey::KEY_SIZE);
        assert_eq!(kp.secret_key.key_bytes.len(), PqKyberSecretKey::KEY_SIZE);
        assert!(kp.public_key.key_bytes.iter().any(|&b| b != 0));
        assert!(kp.secret_key.key_bytes.iter().any(|&b| b != 0));
    }

    #[test]
    fn test_kyber_encapsulate_decapsulate() {
        let kp = pq_kyber_keygen().expect("keygen should succeed");

        let (ct, ss_sender) = pq_kyber_encapsulate(&kp.public_key).expect("encaps should succeed");
        assert_eq!(ct.ct_bytes.len(), PqKyberCiphertext::CT_SIZE);
        assert_eq!(ss_sender.secret_bytes.len(), 32);

        let ss_receiver = pq_kyber_decapsulate(&ct, &kp.secret_key).expect("decaps should succeed");
        assert_eq!(ss_sender.secret_bytes, ss_receiver.secret_bytes,
            "sender and receiver should derive the same shared secret");
    }

    #[test]
    fn test_kyber_different_ciphertexts_give_different_secrets() {
        let kp = pq_kyber_keygen().expect("keygen should succeed");

        let (ct1, ss1) = pq_kyber_encapsulate(&kp.public_key).expect("encaps 1");
        let (ct2, ss2) = pq_kyber_encapsulate(&kp.public_key).expect("encaps 2");

        // Ciphertexts should be different (randomness in encaps)
        assert_ne!(ct1.ct_bytes, ct2.ct_bytes,
            "independent encapsulations should produce different ciphertexts");

        // Shared secrets should also differ (each encaps produces a fresh one)
        assert_ne!(ss1.secret_bytes, ss2.secret_bytes,
            "independent encapsulations should produce different shared secrets");
    }

    #[test]
    fn test_kyber_wrong_secret_key_fails() {
        let kp1 = pq_kyber_keygen().expect("keygen 1");
        let kp2 = pq_kyber_keygen().expect("keygen 2");

        let (ct, ss1) = pq_kyber_encapsulate(&kp1.public_key).expect("encaps with kp1");
        let ss2 = pq_kyber_decapsulate(&ct, &kp2.secret_key).expect("decaps with kp2");

        // Decapsulating with wrong key should give different shared secret
        assert_ne!(ss1.secret_bytes, ss2.secret_bytes,
            "decapsulating with wrong key should not recover the original shared secret");
    }

    #[test]
    fn test_kyber_key_serialization() {
        let kp = pq_kyber_keygen().expect("keygen should succeed");

        // Public key round-trip
        let pk_hex = kp.public_key.to_hex();
        let pk_restored = PqKyberPublicKey::from_hex(&pk_hex).expect("deserialize pk");
        assert_eq!(kp.public_key.key_bytes, pk_restored.key_bytes);

        // Verify restored key still works
        let (ct, ss_sender) = pq_kyber_encapsulate(&pk_restored).expect("encaps with restored pk");
        let ss_receiver = pq_kyber_decapsulate(&ct, &kp.secret_key).expect("decaps");
        assert_eq!(ss_sender.secret_bytes, ss_receiver.secret_bytes);

        // Secret key round-trip
        let sk_hex = kp.secret_key.to_hex();
        let sk_restored = PqKyberSecretKey::from_hex(&sk_hex).expect("deserialize sk");
        assert_eq!(kp.secret_key.key_bytes, sk_restored.key_bytes);

        // Verify restored sk still works
        let ss_receiver2 = pq_kyber_decapsulate(&ct, &sk_restored).expect("decaps with restored sk");
        assert_eq!(ss_sender.secret_bytes, ss_receiver2.secret_bytes);
    }

    #[test]
    fn test_kyber_ciphertext_serialization() {
        let kp = pq_kyber_keygen().expect("keygen should succeed");
        let (ct, ss_sender) = pq_kyber_encapsulate(&kp.public_key).expect("encaps");

        let ct_hex = ct.to_hex();
        let ct_restored = PqKyberCiphertext::from_hex(&ct_hex).expect("deserialize ct");

        let ss_receiver = pq_kyber_decapsulate(&ct_restored, &kp.secret_key).expect("decaps");
        assert_eq!(ss_sender.secret_bytes, ss_receiver.secret_bytes);
    }

    #[test]
    fn test_kyber_shared_secret_has_entropy() {
        let kp = pq_kyber_keygen().expect("keygen");
        let (_, ss) = pq_kyber_encapsulate(&kp.public_key).expect("encaps");

        // Shared secret should not be all zeros
        assert!(ss.secret_bytes.iter().any(|&b| b != 0),
            "shared secret should have entropy");
    }

    #[test]
    fn test_kyber_encapsulate_with_keypair() {
        let kp = pq_kyber_keygen().expect("keygen");
        let (ct, ss_sender) = pq_kyber_encapsulate_with_keypair(&kp).expect("encaps");
        let ss_receiver = pq_kyber_decapsulate(&ct, &kp.secret_key).expect("decaps");
        assert_eq!(ss_sender.secret_bytes, ss_receiver.secret_bytes);
    }
}
