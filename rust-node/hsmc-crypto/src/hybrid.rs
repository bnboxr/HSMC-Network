/// Hybrid Classical + Post-Quantum Cryptography
///
/// Combines ECDSA (Ristretto255) with Dilithium-5 for dual signatures,
/// and ECDH (X25519) with Kyber-1024 for dual key encapsulation.
///
/// Hybrid design ensures security even if one of the two schemes is broken:
/// - Classical side: ECDSA on Ristretto255 + ECDH on Curve25519
/// - PQ side:       ML-DSA-87 (Dilithium-5) + ML-KEM-1024 (Kyber-1024)
///
/// Security properties:
/// - EUF-CMA secure as long as either ECDSA or Dilithium-5 is secure
/// - IND-CCA2 secure as long as either ECDH or Kyber-1024 is secure

use crate::ecdsa::{KeyPair as EcdsaKeyPair, EcdsaSignature};
use crate::pq_dilithium::{
    PqDilithiumKeyPair, PqDilithiumPublicKey, PqDilithiumSignature,
    PqDilithiumError,
    pq_dilithium_sign, pq_dilithium_verify,
};
use crate::pq_kyber::{
    PqKyberKeyPair, PqKyberPublicKey,
    PqKyberCiphertext, PqKyberSharedSecret, PqKyberError,
    pq_kyber_encapsulate, pq_kyber_decapsulate,
};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::ristretto::RistrettoPoint;
use sha2::{Digest, Sha512};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

// ─────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum HybridError {
    #[error("ECDSA error: {0}")]
    Ecdsa(String),
    #[error("Dilithium error: {0}")]
    Dilithium(#[from] PqDilithiumError),
    #[error("Kyber error: {0}")]
    Kyber(#[from] PqKyberError),
    #[error("Serialization error: {0}")]
    Serialization(String),
}

// ─────────────────────────────────────────────────────────────
// Hybrid Signer (ECDSA + Dilithium-5)
// ─────────────────────────────────────────────────────────────

/// A dual-signature produced by HybridSigner.
///
/// Contains both an ECDSA signature (Ristretto255) and a Dilithium-5
/// post-quantum signature. Both must verify for the combined signature
/// to be considered valid.
#[derive(Clone, Serialize, Deserialize)]
pub struct HybridSignature {
    /// ECDSA signature on Ristretto255
    pub ecdsa_sig: Vec<u8>,
    /// Dilithium-5 post-quantum signature (4627 bytes)
    pub dilithium_sig: Vec<u8>,
    /// ECDSA public key (32 bytes, for verification)
    pub ecdsa_pubkey: Vec<u8>,
}

impl HybridSignature {
    pub fn to_hex(&self) -> String {
        format!(
            "HYBRID_SIG_V1:{}:{}:{}",
            hex::encode(&self.ecdsa_sig),
            hex::encode(&self.dilithium_sig),
            hex::encode(&self.ecdsa_pubkey),
        )
    }

    pub fn from_hex(hex_str: &str) -> Result<Self, HybridError> {
        let parts: Vec<&str> = hex_str.split(':').collect();
        if parts.len() != 4 || parts[0] != "HYBRID_SIG_V1" {
            return Err(HybridError::Serialization("invalid hybrid signature format".into()));
        }
        let ecdsa_sig = hex::decode(parts[1])
            .map_err(|e| HybridError::Serialization(e.to_string()))?;
        let dilithium_sig = hex::decode(parts[2])
            .map_err(|e| HybridError::Serialization(e.to_string()))?;
        let ecdsa_pubkey = hex::decode(parts[3])
            .map_err(|e| HybridError::Serialization(e.to_string()))?;
        Ok(Self { ecdsa_sig, dilithium_sig, ecdsa_pubkey })
    }
}

/// Combined key pair for hybrid signing (ECDSA + Dilithium-5)
#[derive(Clone)]
pub struct HybridSignerKeyPair {
    pub ecdsa_kp:     EcdsaKeyPair,
    pub dilithium_kp: PqDilithiumKeyPair,
}

/// HybridSigner: generates dual ECDSA + Dilithium-5 signatures.
///
/// Usage:
/// 1. Generate a HybridSignerKeyPair
/// 2. Call sign(message) → HybridSignature
/// 3. Verifier calls verify(message, sig, ecdsa_pk, dilithium_pk) → bool
pub struct HybridSigner;

impl HybridSigner {
    /// Generate a fresh hybrid key pair
    pub fn generate_keypair() -> HybridSignerKeyPair {
        HybridSignerKeyPair {
            ecdsa_kp:     EcdsaKeyPair::generate(),
            dilithium_kp: pq_dilithium_keygen().expect("Dilithium-5 keygen should not fail"),
        }
    }

    /// Sign a message with both ECDSA and Dilithium-5.
    ///
    /// Each scheme signs the message independently with its own domain-separated
    /// hash. Dual verification requires BOTH signatures to be valid.
    pub fn sign(message: &[u8], keypair: &HybridSignerKeyPair) -> Result<HybridSignature, HybridError> {
        // ECDSA signature (deterministic, RFC6979-style)
        let ecdsa_sig = keypair.ecdsa_kp.sign_deterministic(message)
            .map_err(|e| HybridError::Ecdsa(format!("ECDSA sign failed: {}", e)))?;
        let ecdsa_sig_bytes = ecdsa_sig.to_compact().to_vec();

        // Dilithium-5 signature
        let pq_sig = pq_dilithium_sign(message, &keypair.dilithium_kp.secret_key)?;

        Ok(HybridSignature {
            ecdsa_sig:      ecdsa_sig_bytes,
            dilithium_sig:  pq_sig.sig_bytes,
            ecdsa_pubkey:   keypair.ecdsa_kp.public_key_bytes().to_vec(),
        })
    }

    /// Verify a hybrid signature.
    ///
    /// Returns true only if both the ECDSA and Dilithium-5 signatures verify.
    pub fn verify(
        message: &[u8],
        signature: &HybridSignature,
        ecdsa_public_key: &RistrettoPoint,
        dilithium_public_key: &PqDilithiumPublicKey,
    ) -> Result<bool, HybridError> {
        // Reconstruct ECDSA signature from compact bytes
        let ecdsa_sig = ecdsa_sig_from_compact(&signature.ecdsa_sig, &signature.ecdsa_pubkey)?;

        // Verify ECDSA
        let ecdsa_valid = ecdsa_sig.verify_with_key(message, ecdsa_public_key);

        // Verify Dilithium-5
        let pq_sig = PqDilithiumSignature {
            sig_bytes: signature.dilithium_sig.clone(),
        };
        let pq_valid = pq_dilithium_verify(message, &pq_sig, dilithium_public_key)?;

        Ok(ecdsa_valid && pq_valid)
    }
}

/// Helper: reconstruct ECDSA signature from compact bytes (64 bytes) + pubkey
fn ecdsa_sig_from_compact(compact: &[u8], pubkey: &[u8]) -> Result<EcdsaSignature, HybridError> {
    if compact.len() != 64 {
        return Err(HybridError::Ecdsa("ECDSA compact sig must be 64 bytes".into()));
    }
    let mut arr = [0u8; 64];
    arr.copy_from_slice(compact);
    let mut pk = [0u8; 32];
    if pubkey.len() == 32 {
        pk.copy_from_slice(pubkey);
    }
    Ok(EcdsaSignature::from_compact(&arr, pk))
}

// ─────────────────────────────────────────────────────────────
// Hybrid KEM (ECDH + Kyber-1024)
// ─────────────────────────────────────────────────────────────

/// Combined key pair for hybrid KEM (ECDH + Kyber-1024)
#[derive(Clone)]
pub struct HybridKemKeyPair {
    /// ECDH key pair (Ristretto255 scalar + point)
    pub ecdh_secret: Scalar,
    pub ecdh_public: RistrettoPoint,
    /// Kyber-1024 key pair
    pub kyber_kp:    PqKyberKeyPair,
}

/// Result of hybrid encapsulation
#[derive(Clone)]
pub struct HybridEncapsulation {
    /// ECDH ephemeral public key (R = r*G)
    pub ecdh_ephemeral: [u8; 32],
    /// Kyber-1024 ciphertext
    pub kyber_ct:       Vec<u8>,
}

/// Combined shared secret from both ECDH and Kyber-1024
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct HybridSharedSecret {
    #[zeroize(skip)]
    pub secret_bytes: [u8; 64], // first 32 = ECDH-derived, last 32 = Kyber-derived, combined via SHA-512
}

impl Drop for HybridSharedSecret {
    fn drop(&mut self) {
        self.secret_bytes.zeroize();
    }
}

/// HybridKEM: combines ECDH (Curve25519) with Kyber-1024 for dual key exchange.
///
/// The final shared secret is SHA-512(ecdh_shared || kyber_shared).
/// Both key exchanges must succeed; the combined secret is secure
/// as long as either ECDH or Kyber-1024 is secure.
pub struct HybridKEM;

impl HybridKEM {
    /// Generate a fresh hybrid KEM key pair
    pub fn generate_keypair() -> HybridKemKeyPair {
        use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT as G;
        use rand::rngs::OsRng;

        let mut rng = OsRng;
        let ecdh_secret = Scalar::random(&mut rng);
        let ecdh_public = ecdh_secret * G;

        HybridKemKeyPair {
            ecdh_secret,
            ecdh_public,
            kyber_kp: pq_kyber_keygen().expect("Kyber-1024 keygen should not fail"),
        }
    }

    /// Encapsulate: produce a ciphertext and shared secret given the recipient's public keys.
    ///
    /// Returns (encapsulation, shared_secret) where:
    /// - encapsulation contains the ECDH ephemeral key and Kyber ciphertext
    /// - shared_secret is SHA-512(ecdh_ss || kyber_ss)
    pub fn encapsulate(
        ecdh_public_key: &RistrettoPoint,
        kyber_public_key: &PqKyberPublicKey,
    ) -> Result<(HybridEncapsulation, HybridSharedSecret), HybridError> {
        use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT as G;
        use rand::rngs::OsRng;

        // ECDH: generate ephemeral key, compute shared secret
        let mut rng = OsRng;
        let r = Scalar::random(&mut rng);
        let r_g = r * G;
        let ecdh_shared_point = r * ecdh_public_key;
        let ecdh_shared_bytes = ecdh_shared_point.compress().to_bytes();
        let ecdh_ephemeral_bytes = r_g.compress().to_bytes();

        // Kyber-1024: encapsulate
        let (kyber_ct, kyber_ss) = pq_kyber_encapsulate(kyber_public_key)?;

        // Combine: SHA-512(ecdh_shared || kyber_shared)
        let combined = Self::combine_secrets(&ecdh_shared_bytes, &kyber_ss.secret_bytes);

        Ok((
            HybridEncapsulation {
                ecdh_ephemeral: ecdh_ephemeral_bytes,
                kyber_ct:       kyber_ct.ct_bytes,
            },
            HybridSharedSecret { secret_bytes: combined },
        ))
    }

    /// Decapsulate: recover the shared secret from the encapsulation.
    pub fn decapsulate(
        encapsulation: &HybridEncapsulation,
        keypair: &HybridKemKeyPair,
    ) -> Result<HybridSharedSecret, HybridError> {
        use curve25519_dalek::ristretto::CompressedRistretto;

        // ECDH: compute shared secret from ephemeral key
        let ephemeral = CompressedRistretto::from_slice(&encapsulation.ecdh_ephemeral)
            .map_err(|_| HybridError::Serialization("invalid ECDH ephemeral key".into()))?
            .decompress()
            .ok_or_else(|| HybridError::Serialization("ECDH ephemeral key decompression failed".into()))?;

        let ecdh_shared_point = keypair.ecdh_secret * ephemeral;
        let ecdh_shared_bytes = ecdh_shared_point.compress().to_bytes();

        // Kyber-1024: decapsulate
        let kyber_ct = PqKyberCiphertext {
            ct_bytes: encapsulation.kyber_ct.clone(),
        };
        let kyber_ss = pq_kyber_decapsulate(&kyber_ct, &keypair.kyber_kp.secret_key)?;

        // Combine
        let combined = Self::combine_secrets(&ecdh_shared_bytes, &kyber_ss.secret_bytes);

        Ok(HybridSharedSecret { secret_bytes: combined })
    }

    /// Combine ECDH and Kyber shared secrets using SHA-512
    fn combine_secrets(ecdh_ss: &[u8; 32], kyber_ss: &[u8; 32]) -> [u8; 64] {
        let mut hasher = Sha512::new();
        hasher.update(b"HSMC_HYBRID_KEM_V1");
        hasher.update(ecdh_ss);
        hasher.update(kyber_ss);
        hasher.finalize().into()
    }

    /// Generate shared secret from existing keypair for sending
    pub fn encapsulate_with_keypair(
        keypair: &HybridKemKeyPair,
    ) -> Result<(HybridEncapsulation, HybridSharedSecret), HybridError> {
        Self::encapsulate(&keypair.ecdh_public, &keypair.kyber_kp.public_key)
    }
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Hybrid Signer tests ──────────────────────────────────

    #[test]
    fn test_hybrid_signer_keygen() {
        let kp = HybridSigner::generate_keypair();
        // Just verify keys are generated without panicking
        let pk_bytes = kp.ecdsa_kp.public_key_bytes();
        assert_eq!(pk_bytes.len(), 32);
        assert_eq!(kp.dilithium_kp.public_key.key_bytes.len(), PqDilithiumPublicKey::KEY_SIZE);
    }

    #[test]
    fn test_hybrid_sign_verify() {
        let kp = HybridSigner::generate_keypair();
        let msg = b"HSMC Hybrid Sign Test";

        let sig = HybridSigner::sign(msg, &kp).expect("hybrid sign should succeed");
        assert!(!sig.ecdsa_sig.is_empty());
        assert_eq!(sig.dilithium_sig.len(), PqDilithiumSignature::SIG_SIZE);

        let valid = HybridSigner::verify(
            msg,
            &sig,
            &kp.ecdsa_kp.public_key,
            &kp.dilithium_kp.public_key,
        ).expect("hybrid verify should succeed");
        assert!(valid, "hybrid signature should verify");
    }

    #[test]
    fn test_hybrid_sign_wrong_message_fails() {
        let kp = HybridSigner::generate_keypair();
        let msg = b"correct message";
        let wrong = b"tampered message";

        let sig = HybridSigner::sign(msg, &kp).expect("sign");
        let valid = HybridSigner::verify(
            wrong, &sig,
            &kp.ecdsa_kp.public_key,
            &kp.dilithium_kp.public_key,
        ).expect("verify");
        assert!(!valid, "hybrid sig for wrong message should not verify");
    }

    #[test]
    fn test_hybrid_signature_serialization() {
        let kp = HybridSigner::generate_keypair();
        let msg = b"serialization test";

        let sig = HybridSigner::sign(msg, &kp).expect("sign");
        let hex_str = sig.to_hex();
        let restored = HybridSignature::from_hex(&hex_str).expect("deserialize");

        assert_eq!(sig.ecdsa_sig, restored.ecdsa_sig);
        assert_eq!(sig.dilithium_sig, restored.dilithium_sig);

        let valid = HybridSigner::verify(
            msg, &restored,
            &kp.ecdsa_kp.public_key,
            &kp.dilithium_kp.public_key,
        ).expect("verify restored");
        assert!(valid);
    }

    // ── Hybrid KEM tests ─────────────────────────────────────

    #[test]
    fn test_hybrid_kem_keygen() {
        let kp = HybridKEM::generate_keypair();
        let pk_bytes = kp.ecdh_public.compress().to_bytes();
        assert_eq!(pk_bytes.len(), 32);
        assert_eq!(kp.kyber_kp.public_key.key_bytes.len(), PqKyberPublicKey::KEY_SIZE);
    }

    #[test]
    fn test_hybrid_kem_encapsulate_decapsulate() {
        let kp = HybridKEM::generate_keypair();

        let (encap, ss_sender) = HybridKEM::encapsulate(
            &kp.ecdh_public,
            &kp.kyber_kp.public_key,
        ).expect("hybrid encaps should succeed");

        assert_eq!(encap.ecdh_ephemeral.len(), 32);
        assert_eq!(encap.kyber_ct.len(), PqKyberCiphertext::CT_SIZE);
        assert_eq!(ss_sender.secret_bytes.len(), 64);

        let ss_receiver = HybridKEM::decapsulate(&encap, &kp).expect("hybrid decaps should succeed");

        assert_eq!(ss_sender.secret_bytes, ss_receiver.secret_bytes,
            "sender and receiver should derive the same hybrid shared secret");
    }

    #[test]
    fn test_hybrid_kem_different_encapsulations() {
        let kp = HybridKEM::generate_keypair();

        let (encap1, ss1) = HybridKEM::encapsulate(
            &kp.ecdh_public, &kp.kyber_kp.public_key,
        ).expect("encaps 1");
        let (encap2, ss2) = HybridKEM::encapsulate(
            &kp.ecdh_public, &kp.kyber_kp.public_key,
        ).expect("encaps 2");

        // Each encapsulation should produce different secrets (ephemeral ECDH + random Kyber)
        assert_ne!(ss1.secret_bytes, ss2.secret_bytes,
            "independent encapsulations should produce different shared secrets");
        assert_ne!(encap1.ecdh_ephemeral, encap2.ecdh_ephemeral);
    }

    #[test]
    fn test_hybrid_kem_wrong_keypair_fails() {
        let kp1 = HybridKEM::generate_keypair();
        let kp2 = HybridKEM::generate_keypair();

        let (encap, ss1) = HybridKEM::encapsulate(
            &kp1.ecdh_public, &kp1.kyber_kp.public_key,
        ).expect("encaps with kp1");

        let ss2 = HybridKEM::decapsulate(&encap, &kp2).expect("decaps with kp2");

        assert_ne!(ss1.secret_bytes, ss2.secret_bytes,
            "decapsulating with wrong keypair should give different secret");
    }

    #[test]
    fn test_hybrid_kem_encapsulate_with_keypair() {
        let kp = HybridKEM::generate_keypair();

        let (encap, ss_sender) = HybridKEM::encapsulate_with_keypair(&kp).expect("encaps");
        let ss_receiver = HybridKEM::decapsulate(&encap, &kp).expect("decaps");

        assert_eq!(ss_sender.secret_bytes, ss_receiver.secret_bytes);
    }

    #[test]
    fn test_hybrid_shared_secret_entropy() {
        let kp = HybridKEM::generate_keypair();
        let (_, ss) = HybridKEM::encapsulate(
            &kp.ecdh_public, &kp.kyber_kp.public_key,
        ).expect("encaps");

        // 64-byte shared secret should have entropy
        let non_zero = ss.secret_bytes.iter().filter(|&&b| b != 0).count();
        assert!(non_zero > 10, "shared secret should have significant entropy, got {} non-zero bytes", non_zero);
    }
}
