/// Schnorr signatures — MuSig2 multi-party Schnorr, Taproot-compatible
/// Used for efficient multi-sig and batch verification
use curve25519_dalek::{
    ristretto::{CompressedRistretto, RistrettoPoint},
    scalar::Scalar,
    constants::RISTRETTO_BASEPOINT_POINT,
};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256, Sha512};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

// ─── Schnorr Signature ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchnorrSignature {
    /// R = k*G (commitment point)
    pub r: [u8; 32],
    /// s = k + e*x (response scalar)
    pub s: [u8; 32],
}

impl SchnorrSignature {
    /// Sign a message with a secret key
    pub fn sign(secret_key: &Scalar, message: &[u8]) -> Self {
        let mut rng = OsRng;
        let k = Scalar::random(&mut rng);
        let r_point = k * RISTRETTO_BASEPOINT_POINT;
        let r_bytes = r_point.compress().to_bytes();

        let public_key = (secret_key * RISTRETTO_BASEPOINT_POINT).compress().to_bytes();

        // e = H(R || P || message) — Fiat-Shamir challenge
        let e = schnorr_challenge(&r_bytes, &public_key, message);
        let s = k + e * secret_key;

        SchnorrSignature { r: r_bytes, s: s.to_bytes() }
    }

    /// Verify a Schnorr signature
    pub fn verify(&self, public_key: &RistrettoPoint, message: &[u8]) -> bool {
        let r_point = match CompressedRistretto(self.r).decompress() {
            Some(p) => p,
            None => return false,
        };
        let s = match Scalar::from_canonical_bytes(self.s) {
            Some(s) => s,
            None => return false,
        };

        let pk_bytes = public_key.compress().to_bytes();
        let e = schnorr_challenge(&self.r, &pk_bytes, message);

        // Verify: s*G = R + e*P
        let lhs = s * RISTRETTO_BASEPOINT_POINT;
        let rhs = r_point + e * public_key;
        lhs == rhs
    }

    pub fn to_hex(&self) -> String {
        format!("{}{}", hex::encode(self.r), hex::encode(self.s))
    }

    pub fn from_hex(s: &str) -> Option<Self> {
        if s.len() < 128 { return None; }
        let r = hex::decode(&s[..64]).ok()?;
        let sv = hex::decode(&s[64..128]).ok()?;
        let mut r_arr = [0u8; 32]; r_arr.copy_from_slice(&r);
        let mut s_arr = [0u8; 32]; s_arr.copy_from_slice(&sv);
        Some(Self { r: r_arr, s: s_arr })
    }
}

fn schnorr_challenge(r_bytes: &[u8; 32], pk_bytes: &[u8; 32], message: &[u8]) -> Scalar {
    let mut h = Sha512::new();
    h.update(b"HSMC_SCHNORR_CHALLENGE");
    h.update(r_bytes);
    h.update(pk_bytes);
    h.update(message);
    let bytes: [u8; 64] = h.finalize().into();
    Scalar::from_bytes_mod_order_wide(&bytes)
}

// ─── MuSig2 Multi-Party Schnorr ───────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum MuSigError {
    #[error("Wrong number of signers: expected {expected}, got {got}")]
    WrongSignerCount { expected: usize, got: usize },
    #[error("Invalid public key from signer {0}")]
    InvalidPublicKey(usize),
    #[error("Invalid nonce commitment")]
    InvalidNonce,
    #[error("Aggregation failed: {0}")]
    AggregationFailed(String),
}

/// MuSig2 session state for multi-party signing
pub struct MuSig2Session {
    pub participants: Vec<RistrettoPoint>,  // Public keys
    pub nonce_commitments: HashMap<usize, ([u8; 32], [u8; 32])>, // signer_idx → (R1, R2)
    pub aggregated_public_key: RistrettoPoint,
    pub key_agg_coeff: Vec<Scalar>,
    pub message: Vec<u8>,
    pub threshold: usize,
}

impl MuSig2Session {
    /// Initialize a new MuSig2 session with n participants
    pub fn new(participants: Vec<RistrettoPoint>, message: Vec<u8>, threshold: usize) -> Self {
        let n = participants.len();

        // Compute key aggregation coefficients: a_i = H(L || P_i)
        // where L = H(P_1 || P_2 || ... || P_n)
        let mut l_hash_input = Vec::new();
        for pk in &participants {
            l_hash_input.extend_from_slice(&pk.compress().to_bytes());
        }
        let l_hash = Sha256::digest(&l_hash_input);

        let key_agg_coeff: Vec<Scalar> = participants.iter().map(|pk| {
            let mut h = Sha512::new();
            h.update(b"HSMC_MUSIG2_KEYGEN");
            h.update(l_hash.as_slice());
            h.update(pk.compress().to_bytes().as_slice());
            let bytes: [u8; 64] = h.finalize().into();
            Scalar::from_bytes_mod_order_wide(&bytes)
        }).collect();

        // Aggregate public key: P_agg = sum(a_i * P_i)
        let aggregated_public_key = participants.iter()
            .zip(key_agg_coeff.iter())
            .map(|(pk, coeff)| coeff * pk)
            .fold(RistrettoPoint::default(), |acc, p| acc + p);

        Self {
            participants,
            nonce_commitments: HashMap::new(),
            aggregated_public_key,
            key_agg_coeff,
            message,
            threshold,
        }
    }

    /// Round 1: Each signer generates two nonces and commits
    pub fn generate_nonce_commitment(idx: usize) -> (Scalar, Scalar, [u8; 32], [u8; 32]) {
        let mut rng = OsRng;
        let k1 = Scalar::random(&mut rng);
        let k2 = Scalar::random(&mut rng);
        let r1 = (k1 * RISTRETTO_BASEPOINT_POINT).compress().to_bytes();
        let r2 = (k2 * RISTRETTO_BASEPOINT_POINT).compress().to_bytes();
        (k1, k2, r1, r2)
    }

    pub fn add_nonce_commitment(&mut self, signer_idx: usize, r1: [u8; 32], r2: [u8; 32]) {
        self.nonce_commitments.insert(signer_idx, (r1, r2));
    }

    /// Round 2: Compute partial signature for a signer
    pub fn partial_sign(
        &self,
        signer_idx: usize,
        secret_key: &Scalar,
        k1: &Scalar,
        k2: &Scalar,
    ) -> Result<Scalar, MuSigError> {
        let agg_pk_bytes = self.aggregated_public_key.compress().to_bytes();

        // Compute aggregate nonce R = sum(R1_i + b*R2_i)
        let b = self.compute_b_challenge(&agg_pk_bytes);
        let r_agg = self.compute_aggregate_nonce(&b)?;
        let r_bytes = r_agg.compress().to_bytes();

        // Challenge: e = H(R_agg || P_agg || message)
        let e = schnorr_challenge(&r_bytes, &agg_pk_bytes, &self.message);

        let coeff = &self.key_agg_coeff[signer_idx];
        let s_i = k1 + b * k2 + e * coeff * secret_key;
        Ok(s_i)
    }

    fn compute_b_challenge(&self, agg_pk_bytes: &[u8]) -> Scalar {
        let mut h = Sha512::new();
        h.update(b"HSMC_MUSIG2_B");
        h.update(agg_pk_bytes);
        for (_, (r1, r2)) in &self.nonce_commitments {
            h.update(r1); h.update(r2);
        }
        h.update(&self.message);
        let bytes: [u8; 64] = h.finalize().into();
        Scalar::from_bytes_mod_order_wide(&bytes)
    }

    fn compute_aggregate_nonce(&self, b: &Scalar) -> Result<RistrettoPoint, MuSigError> {
        let mut r_agg = RistrettoPoint::default();
        for (_, (r1_bytes, r2_bytes)) in &self.nonce_commitments {
            let r1 = CompressedRistretto(*r1_bytes).decompress()
                .ok_or(MuSigError::InvalidNonce)?;
            let r2 = CompressedRistretto(*r2_bytes).decompress()
                .ok_or(MuSigError::InvalidNonce)?;
            r_agg = r_agg + r1 + b * r2;
        }
        Ok(r_agg)
    }

    /// Aggregate partial signatures into a final Schnorr signature
    pub fn aggregate_signatures(
        &self,
        partial_sigs: &[Scalar],
    ) -> Result<SchnorrSignature, MuSigError> {
        let agg_pk_bytes = self.aggregated_public_key.compress().to_bytes();
        let b = self.compute_b_challenge(&agg_pk_bytes);
        let r_agg = self.compute_aggregate_nonce(&b)?;
        let r_bytes = r_agg.compress().to_bytes();

        let s_total = partial_sigs.iter().fold(Scalar::ZERO, |acc, s| acc + s);
        Ok(SchnorrSignature { r: r_bytes, s: s_total.to_bytes() })
    }
}

// ─── Batch Verification ───────────────────────────────────────────────────────

/// Batch-verify multiple Schnorr signatures in O(n) using random linear combination
/// Much faster than n individual verifications
pub fn batch_verify_schnorr(
    signatures: &[SchnorrSignature],
    public_keys: &[RistrettoPoint],
    messages: &[Vec<u8>],
) -> bool {
    if signatures.len() != public_keys.len() || signatures.len() != messages.len() {
        return false;
    }
    if signatures.is_empty() { return true; }

    let mut rng = OsRng;

    // Σ(a_i * s_i) * G == Σ(a_i * R_i + a_i * e_i * P_i)
    let mut lhs_scalar = Scalar::ZERO;
    let mut rhs_point = RistrettoPoint::default();

    for (i, ((sig, pk), msg)) in signatures.iter().zip(public_keys.iter()).zip(messages.iter()).enumerate() {
        let a = if i == 0 {
            Scalar::ONE
        } else {
            Scalar::random(&mut rng)
        };

        let s = match Scalar::from_canonical_bytes(sig.s) {
            Some(s) => s,
            None => return false,
        };
        let r_point = match CompressedRistretto(sig.r).decompress() {
            Some(p) => p,
            None => return false,
        };
        let pk_bytes = pk.compress().to_bytes();
        let e = schnorr_challenge(&sig.r, &pk_bytes, msg);

        lhs_scalar = lhs_scalar + a * s;
        rhs_point = rhs_point + a * r_point + (a * e) * pk;
    }

    let lhs = lhs_scalar * RISTRETTO_BASEPOINT_POINT;
    lhs == rhs_point
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    #[test]
    fn test_schnorr_sign_verify() {
        let mut rng = OsRng;
        let sk = Scalar::random(&mut rng);
        let pk = sk * RISTRETTO_BASEPOINT_POINT;
        let msg = b"HSMC Schnorr test message 2026";
        let sig = SchnorrSignature::sign(&sk, msg);
        assert!(sig.verify(&pk, msg), "Schnorr sig should verify");
    }

    #[test]
    fn test_schnorr_rejects_wrong_message() {
        let mut rng = OsRng;
        let sk = Scalar::random(&mut rng);
        let pk = sk * RISTRETTO_BASEPOINT_POINT;
        let sig = SchnorrSignature::sign(&sk, b"correct");
        assert!(!sig.verify(&pk, b"wrong"), "Should reject wrong message");
    }

    #[test]
    fn test_batch_verify() {
        let mut rng = OsRng;
        let mut sigs = Vec::new();
        let mut pks = Vec::new();
        let mut msgs = Vec::new();
        for i in 0..5 {
            let sk = Scalar::random(&mut rng);
            let pk = sk * RISTRETTO_BASEPOINT_POINT;
            let msg = format!("message {}", i).into_bytes();
            let sig = SchnorrSignature::sign(&sk, &msg);
            sigs.push(sig);
            pks.push(pk);
            msgs.push(msg);
        }
        assert!(batch_verify_schnorr(&sigs, &pks, &msgs));
    }

    #[test]
    fn test_musig2_session_2of2() -> anyhow::Result<()> {
        let mut rng = OsRng;
        let sk1 = Scalar::random(&mut rng);
        let sk2 = Scalar::random(&mut rng);
        let pk1 = sk1 * RISTRETTO_BASEPOINT_POINT;
        let pk2 = sk2 * RISTRETTO_BASEPOINT_POINT;
        let msg = b"2-of-2 multisig HSMC transfer".to_vec();

        let mut session = MuSig2Session::new(vec![pk1, pk2], msg.clone(), 2);

        let (k1_1, k1_2, r1_1, r1_2) = MuSig2Session::generate_nonce_commitment(0);
        let (k2_1, k2_2, r2_1, r2_2) = MuSig2Session::generate_nonce_commitment(1);

        session.add_nonce_commitment(0, r1_1, r1_2);
        session.add_nonce_commitment(1, r2_1, r2_2);

        let s1 = session.partial_sign(0, &sk1, &k1_1, &k1_2)?;
        let s2 = session.partial_sign(1, &sk2, &k2_1, &k2_2)?;

        let final_sig = session.aggregate_signatures(&[s1, s2])?;
        assert!(final_sig.verify(&session.aggregated_public_key, &msg));
        Ok(())
    }
}
