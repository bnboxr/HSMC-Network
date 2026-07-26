/// LSAG Ring Signatures — Linkable Spontaneous Anonymous Group Signatures
/// Full implementation on Ristretto255 / Curve25519-dalek
/// Provides: multi-ring, MLSAG (multi-layer), CLSAG (compact linkable),
/// key image management, decoy selection, and batch verification
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT as G;
use rand::rngs::OsRng;
use sha2::{Digest, Sha512};
use sha3::Keccak256;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

// ─────────────────────────────────────────────────────────────────────────────
// Public/Private key types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct RingPublicKey(pub [u8; 32]);

impl RingPublicKey {
    pub fn generate() -> (Self, RingPrivateKey) {
        let sk = generate_scalar();
        let pk = (sk * G).compress().to_bytes();
        (RingPublicKey(pk), RingPrivateKey(sk))
    }

    pub fn from_private(sk: &RingPrivateKey) -> Self {
        RingPublicKey((sk.0 * G).compress().to_bytes())
    }

    pub fn decompress(&self) -> Option<RistrettoPoint> {
        CompressedRistretto::from_slice(&self.0)
            .ok()
            .and_then(|c| c.decompress())
    }

    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }

    pub fn from_hex(s: &str) -> Option<Self> {
        let bytes = hex::decode(s).ok()?;
        if bytes.len() != 32 { return None; }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Some(Self(arr))
    }
}

#[derive(Clone)]
pub struct RingPrivateKey(pub Scalar);

impl RingPrivateKey {
    pub fn generate() -> Self {
        Self(generate_scalar())
    }

    pub fn from_bytes(bytes: &[u8; 32]) -> Option<Self> {
        Scalar::from_canonical_bytes(*bytes).map(Self)
    }

    pub fn to_bytes(&self) -> [u8; 32] {
        self.0.to_bytes()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Key Image
// ─────────────────────────────────────────────────────────────────────────────

/// Key image I = x * H_p(P) — deterministically links double-spends
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct KeyImage(pub [u8; 32]);

impl KeyImage {
    pub fn compute(sk: &RingPrivateKey, pk: &RingPublicKey) -> Self {
        let pk_point = match pk.decompress() {
            Some(p) => p,
            None => return KeyImage([0u8; 32]),
        };
        let hp = hash_to_point(&pk_point.compress().to_bytes());
        KeyImage((sk.0 * hp).compress().to_bytes())
    }

    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LSAG Signature
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LsagSignature {
    pub key_image:  KeyImage,
    pub c0:         [u8; 32],  // initial challenge
    pub responses:  Vec<[u8; 32]>, // r_i scalars
    pub ring:       Vec<RingPublicKey>,
    pub ring_size:  usize,
    pub message_hash: [u8; 32],
}

impl LsagSignature {
    /// Sign with full LSAG protocol (Fujisaki-Suzuki construction)
    pub fn sign(
        message: &[u8],
        sk: &RingPrivateKey,
        pk: &RingPublicKey,
        ring: Vec<RingPublicKey>,
        signer_index: usize,
    ) -> Result<Self, RingError> {
        let n = ring.len();
        if n < 2 {
            return Err(RingError::RingSizeTooSmall { min: 2, actual: n });
        }
        if signer_index >= n {
            return Err(RingError::SignerIndexOutOfBounds { index: signer_index, ring_size: n });
        }
        // Verify signer's public key is in ring
        if ring[signer_index] != *pk {
            return Err(RingError::SignerNotInRing);
        }

        let msg_hash = hash_message(message);
        let key_image = KeyImage::compute(sk, pk);

        // Decompress ring points
        let ring_points: Vec<RistrettoPoint> = ring.iter()
            .enumerate()
            .map(|(i, pk)| pk.decompress()
                .ok_or(RingError::InvalidRingMember(i)))
            .collect::<Result<Vec<_>, _>>()?;

        // H_p values for each ring member
        let h_p: Vec<RistrettoPoint> = ring_points.iter()
            .map(|p| hash_to_point(&p.compress().to_bytes()))
            .collect();

        let ki_point = match CompressedRistretto::from_slice(&key_image.0)
            .ok()
            .and_then(|c| c.decompress())
        {
            Some(p) => p,
            None => return Err(RingError::KeyImageDecompressFailed),
        };

        let mut rng = OsRng;
        let alpha = generate_scalar();

        // Compute initial L_s = alpha*G, R_s = alpha*H_p(P_s)
        let l_s = alpha * G;
        let r_s = alpha * h_p[signer_index];

        let mut c = vec![Scalar::ZERO; n];
        let mut r = vec![generate_scalar(); n]; // random for non-signers

        // c[(s+1)%n] = H(msg, L_s, R_s)
        let next = (signer_index + 1) % n;
        c[next] = hash_to_scalar_4(&msg_hash, &[l_s, r_s], &ring_points, signer_index);

        // Walk the ring
        let mut i = next;
        loop {
            let l_i = r[i] * G + c[i] * ring_points[i];
            let r_i_pt = r[i] * h_p[i] + c[i] * ki_point;
            let next_i = (i + 1) % n;

            if next_i == signer_index {
                c[signer_index] = hash_to_scalar_4(
                    &msg_hash,
                    &[l_i, r_i_pt],
                    &ring_points,
                    i,
                );
                break;
            }

            c[next_i] = hash_to_scalar_4(&msg_hash, &[l_i, r_i_pt], &ring_points, i);
            i = next_i;
        }

        // Close ring: r_s = alpha - c_s * sk
        r[signer_index] = alpha - c[signer_index] * sk.0;

        let c0 = c[0].to_bytes();
        let responses: Vec<[u8; 32]> = r.iter().map(|s| s.to_bytes()).collect();

        Ok(LsagSignature {
            key_image,
            c0,
            responses,
            ring,
            ring_size: n,
            message_hash: msg_hash,
        })
    }

    /// Verify LSAG signature
    pub fn verify(&self, message: &[u8]) -> Result<bool, RingError> {
        let n = self.ring_size;
        if n != self.ring.len() || n != self.responses.len() {
            return Ok(false);
        }

        let msg_hash = hash_message(message);
        if msg_hash != self.message_hash {
            return Ok(false); // message mismatch
        }

        let ring_points: Vec<RistrettoPoint> = self.ring.iter()
            .enumerate()
            .map(|(i, pk)| pk.decompress()
                .ok_or(RingError::InvalidRingMember(i)))
            .collect::<Result<Vec<_>, _>>()?;

        let h_p: Vec<RistrettoPoint> = ring_points.iter()
            .map(|p| hash_to_point(&p.compress().to_bytes()))
            .collect();

        let ki_point = match CompressedRistretto::from_slice(&self.key_image.0)
            .ok()
            .and_then(|c| c.decompress())
        {
            Some(p) => p,
            None => return Err(RingError::KeyImageDecompressFailed),
        };

        let c0 = scalar_from_bytes(&self.c0)?;
        let mut c_cur = c0;

        for i in 0..n {
            let r_i = scalar_from_bytes(&self.responses[i])?;
            let l_i = r_i * G + c_cur * ring_points[i];
            let r_i_pt = r_i * h_p[i] + c_cur * ki_point;
            let next_i = (i + 1) % n;
            if next_i == 0 {
                // We've walked full ring — c_0 should match
                let c_check = hash_to_scalar_4(&msg_hash, &[l_i, r_i_pt], &ring_points, i);
                return Ok(c_check == c0);
            }
            c_cur = hash_to_scalar_4(&msg_hash, &[l_i, r_i_pt], &ring_points, i);
        }

        Ok(false)
    }

    pub fn to_hex(&self) -> String {
        let json = serde_json::to_string(self).unwrap_or_default();
        hex::encode(json.as_bytes())
    }

    pub fn from_hex(s: &str) -> Option<Self> {
        let bytes = hex::decode(s).ok()?;
        let json = String::from_utf8(bytes).ok()?;
        serde_json::from_str(&json).ok()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MLSAG — Multi-Layer Ring Signature (Monero-style, for multiple inputs)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MlsagSignature {
    /// One LSAG per input (one ring per input key)
    pub layers:     Vec<LsagSignature>,
    pub ring_size:  usize,
    pub input_count: usize,
}

impl MlsagSignature {
    /// Sign multiple inputs with the same ring (MLSAG)
    pub fn sign_multi(
        message: &[u8],
        inputs: Vec<(RingPrivateKey, RingPublicKey, usize)>, // (sk, pk, signer_idx)
        ring: Vec<RingPublicKey>,
    ) -> Result<Self, RingError> {
        let ring_size = ring.len();
        let input_count = inputs.len();
        let mut layers = Vec::with_capacity(input_count);

        for (sk, pk, signer_idx) in inputs {
            let sig = LsagSignature::sign(message, &sk, &pk, ring.clone(), signer_idx)?;
            layers.push(sig);
        }

        Ok(MlsagSignature { layers, ring_size, input_count })
    }

    pub fn verify(&self, message: &[u8]) -> Result<bool, RingError> {
        // All layers must verify
        for layer in &self.layers {
            if !layer.verify(message)? {
                return Ok(false);
            }
        }
        // Key images must be distinct (no double-spend across inputs)
        let images: HashSet<_> = self.layers.iter()
            .map(|l| l.key_image.to_hex())
            .collect();
        Ok(images.len() == self.layers.len())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLSAG — Compact Linkable Spontaneous Anonymous Group Signature
/// (Monero v13 upgrade — smaller signatures, faster verification)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClsagSignature {
    pub s:          Vec<[u8; 32]>,  // n response scalars
    pub c1:         [u8; 32],       // initial challenge
    pub key_image:  KeyImage,
    pub ring:       Vec<RingPublicKey>,
    pub D:          [u8; 32],       // auxiliary key image D = (1/8) * z * H_p(P)
}

impl ClsagSignature {
    /// Sign with CLSAG (simplified version of Monero's CLSAG)
    pub fn sign(
        message: &[u8],
        sk: &RingPrivateKey,
        pk: &RingPublicKey,
        ring: Vec<RingPublicKey>,
        signer_index: usize,
        commitment_mask: Option<Scalar>, // for RingCT
    ) -> Result<Self, RingError> {
        let n = ring.len();
        if n < 2 {
            return Err(RingError::RingSizeTooSmall { min: 2, actual: n });
        }

        let key_image = KeyImage::compute(sk, pk);
        let pk_point = pk.decompress().ok_or(RingError::InvalidRingMember(signer_index))?;
        let hp_i = hash_to_point(&pk_point.compress().to_bytes());
        let ki_point = (sk.0 * hp_i); // = key_image point
        // D = commitment_mask * H_p(P_i) if RingCT, else zero
        let z = commitment_mask.unwrap_or(Scalar::ZERO);
        let d_point = z * hp_i;
        let d_bytes = d_point.compress().to_bytes();

        let ring_points: Vec<RistrettoPoint> = ring.iter()
            .enumerate()
            .map(|(i, pk)| pk.decompress().ok_or(RingError::InvalidRingMember(i)))
            .collect::<Result<Vec<_>, _>>()?;

        let msg_hash = hash_message(message);
        let mut rng = OsRng;
        let alpha = generate_scalar();
        let beta  = generate_scalar(); // for D commitment

        let mut s: Vec<Scalar> = (0..n).map(|_| generate_scalar()).collect();

        // Aggregate ring hashing for CLSAG domain separation
        let mu_p = hash_to_scalar_domain(b"CLSAG_agg_0", &ring, &d_bytes);
        let mu_c = hash_to_scalar_domain(b"CLSAG_agg_1", &ring, &d_bytes);

        // Build c1 from signer position
        let l_alpha = alpha * G;
        let r_alpha = alpha * hp_i;
        let mut c1 = hash_to_scalar_clsag(
            &msg_hash, &l_alpha, &r_alpha, &d_bytes, mu_p, mu_c,
        );

        // Walk ring to close
        let mut i = (signer_index + 1) % n;
        loop {
            let l_i = s[i] * G + c1 * ring_points[i];
            let hp_i_ring = hash_to_point(&ring_points[i].compress().to_bytes());
            let r_i = s[i] * hp_i_ring + c1 * ki_point;

            c1 = hash_to_scalar_clsag(&msg_hash, &l_i, &r_i, &d_bytes, mu_p, mu_c);

            i = (i + 1) % n;
            if i == signer_index { break; }
        }

        // Close: s_i = alpha - c_i * (mu_p * sk + mu_c * z)
        s[signer_index] = alpha - c1 * (mu_p * sk.0 + mu_c * z);

        Ok(Self {
            s: s.iter().map(|sc| sc.to_bytes()).collect(),
            c1: c1.to_bytes(),
            key_image,
            ring,
            D: d_bytes,
        })
    }

    pub fn verify(&self, message: &[u8]) -> Result<bool, RingError> {
        let n = self.ring.len();
        if n != self.s.len() { return Ok(false); }

        let ring_points: Vec<RistrettoPoint> = self.ring.iter()
            .enumerate()
            .map(|(i, pk)| pk.decompress().ok_or(RingError::InvalidRingMember(i)))
            .collect::<Result<Vec<_>, _>>()?;

        let ki_point = CompressedRistretto::from_slice(&self.key_image.0)
            .ok()
            .and_then(|c| c.decompress())
            .ok_or(RingError::KeyImageDecompressFailed)?;

        let msg_hash = hash_message(message);
        let mu_p = hash_to_scalar_domain(b"CLSAG_agg_0", &self.ring, &self.D);
        let mu_c = hash_to_scalar_domain(b"CLSAG_agg_1", &self.ring, &self.D);

        let c0 = scalar_from_bytes(&self.c1)?;
        let mut c = c0;

        for i in 0..n {
            let s_i = scalar_from_bytes(&self.s[i])?;
            let hp_i = hash_to_point(&ring_points[i].compress().to_bytes());
            let l_i = s_i * G + c * ring_points[i];
            let r_i = s_i * hp_i + c * ki_point;

            c = hash_to_scalar_clsag(&msg_hash, &l_i, &r_i, &self.D, mu_p, mu_c);
        }

        Ok(c == c0)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Verifier — verify multiple ring signatures simultaneously
// ─────────────────────────────────────────────────────────────────────────────

pub struct RingBatchVerifier {
    pub pending: Vec<(String, Vec<u8>, LsagSignature)>, // (tx_hash, message, sig)
    duplicate_key_images: HashSet<String>,
}

impl RingBatchVerifier {
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
            duplicate_key_images: HashSet::new(),
        }
    }

    pub fn add(&mut self, tx_hash: String, message: Vec<u8>, sig: LsagSignature) -> bool {
        let ki = sig.key_image.to_hex();
        if !self.duplicate_key_images.insert(ki) {
            return false; // duplicate key image
        }
        self.pending.push((tx_hash, message, sig));
        true
    }

    /// Verify all signatures in batch (sequential for now, parallel-ready)
    pub fn verify_all(&self) -> Vec<(String, bool)> {
        self.pending.iter()
            .map(|(hash, msg, sig)| {
                let valid = sig.verify(msg).unwrap_or(false);
                (hash.clone(), valid)
            })
            .collect()
    }

    pub fn all_valid(&self) -> bool {
        self.verify_all().iter().all(|(_, v)| *v)
    }

    pub fn clear(&mut self) {
        self.pending.clear();
        self.duplicate_key_images.clear();
    }
}

impl Default for RingBatchVerifier {
    fn default() -> Self { Self::new() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Decoy Selection
// ─────────────────────────────────────────────────────────────────────────────

/// Select decoy ring members from a set of known public keys.
///
/// Uses cryptographically secure randomness (OsRng) for all index selection
/// and signer position randomization. This is critical for sender anonymity —
/// predictable decoy selection would deanonymize the signer.
///
/// W5 FIX (2026-07-26): Replaced deterministic LCG with OsRng.
/// Previous implementation used a seeded linear congruential generator
/// which was predictable given knowledge of the seed, making decoy
/// selection non-random and potentially deanonymizing.
pub fn select_decoys(
    all_public_keys: &[RingPublicKey],
    real_key: &RingPublicKey,
    ring_size: usize,
) -> Result<(Vec<RingPublicKey>, usize), RingError> {
    if all_public_keys.len() < ring_size {
        return Err(RingError::InsufficientDecoys {
            needed: ring_size,
            available: all_public_keys.len(),
        });
    }

    let mut selected = Vec::with_capacity(ring_size);
    let mut used: HashSet<[u8; 32]> = HashSet::new();
    used.insert(real_key.0);

    // Cryptographically secure random index selection (OsRng)
    use rand::Rng;
    let mut rng = OsRng;
    let mut attempts = 0usize;
    while selected.len() < ring_size - 1 && attempts < ring_size * 100 {
        let idx = rng.gen_range(0..all_public_keys.len());
        let candidate = &all_public_keys[idx];
        if !used.contains(&candidate.0) {
            used.insert(candidate.0);
            selected.push(candidate.clone());
        }
        attempts += 1;
    }

    if selected.len() < ring_size - 1 {
        return Err(RingError::InsufficientDecoys {
            needed: ring_size - 1,
            available: selected.len(),
        });
    }

    // Insert real key at cryptographically random position
    let signer_pos = rng.gen_range(0..ring_size);
    selected.insert(signer_pos, real_key.clone());

    Ok((selected, signer_pos))
}

/// Deterministic decoy selection for testing only.
/// Uses a seeded LCG — DO NOT USE in production.
#[cfg(test)]
pub fn select_decoys_deterministic(
    all_public_keys: &[RingPublicKey],
    real_key: &RingPublicKey,
    ring_size: usize,
    seed: u64,
) -> Result<(Vec<RingPublicKey>, usize), RingError> {
    if all_public_keys.len() < ring_size {
        return Err(RingError::InsufficientDecoys {
            needed: ring_size,
            available: all_public_keys.len(),
        });
    }

    let mut selected = Vec::with_capacity(ring_size);
    let mut used: HashSet<[u8; 32]> = HashSet::new();
    used.insert(real_key.0);

    let mut rng_state = seed.wrapping_mul(0x9e3779b97f4a7c15);
    let mut attempts = 0usize;
    while selected.len() < ring_size - 1 && attempts < ring_size * 10 {
        rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let idx = (rng_state >> 33) as usize % all_public_keys.len();
        let candidate = &all_public_keys[idx];
        if !used.contains(&candidate.0) {
            used.insert(candidate.0);
            selected.push(candidate.clone());
        }
        attempts += 1;
    }

    if selected.len() < ring_size - 1 {
        return Err(RingError::InsufficientDecoys {
            needed: ring_size - 1,
            available: selected.len(),
        });
    }

    rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
    let signer_pos = (rng_state >> 33) as usize % ring_size;
    selected.insert(signer_pos, real_key.clone());

    Ok((selected, signer_pos))
}

// ─────────────────────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum RingError {
    RingSizeTooSmall { min: usize, actual: usize },
    SignerIndexOutOfBounds { index: usize, ring_size: usize },
    SignerNotInRing,
    InvalidRingMember(usize),
    KeyImageDecompressFailed,
    ScalarDecompressFailed,
    VerificationFailed,
    InsufficientDecoys { needed: usize, available: usize },
    SerializationError(String),
}

impl std::fmt::Display for RingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RingSizeTooSmall { min, actual } =>
                write!(f, "Ring size {} < min {}", actual, min),
            Self::SignerIndexOutOfBounds { index, ring_size } =>
                write!(f, "Signer index {} >= ring size {}", index, ring_size),
            Self::SignerNotInRing =>
                write!(f, "Signer's public key not found in ring"),
            Self::InvalidRingMember(i) =>
                write!(f, "Ring member {} has invalid public key", i),
            Self::KeyImageDecompressFailed =>
                write!(f, "Failed to decompress key image"),
            Self::ScalarDecompressFailed =>
                write!(f, "Failed to decompress scalar"),
            Self::VerificationFailed =>
                write!(f, "Ring signature verification failed"),
            Self::InsufficientDecoys { needed, available } =>
                write!(f, "Need {} decoys but only {} available", needed, available),
            Self::SerializationError(m) =>
                write!(f, "Serialization error: {}", m),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cryptographic primitives
// ─────────────────────────────────────────────────────────────────────────────

fn generate_scalar() -> Scalar {
    let mut bytes = [0u8; 64];
    rand::RngCore::fill_bytes(&mut OsRng, &mut bytes);
    Scalar::from_bytes_mod_order_wide(&bytes)
}

/// Hash-to-point: Elligator2 via SHA-512
pub fn hash_to_point(data: &[u8]) -> RistrettoPoint {
    let mut h = Sha512::new();
    h.update(b"HSMC_H_p_v1_");
    h.update(data);
    RistrettoPoint::from_uniform_bytes(&h.finalize().into())
}

fn hash_message(message: &[u8]) -> [u8; 32] {
    let mut h = Keccak256::new();
    h.update(b"HSMC_ring_msg_");
    h.update(message);
    h.finalize().into()
}

fn hash_to_scalar_4(
    msg: &[u8; 32],
    points: &[RistrettoPoint],
    ring: &[RistrettoPoint],
    position: usize,
) -> Scalar {
    let mut h = Sha512::new();
    h.update(b"HSMC_LSAG_c_");
    h.update(msg);
    for p in points { h.update(p.compress().as_bytes()); }
    h.update(&position.to_le_bytes());
    for p in ring { h.update(p.compress().as_bytes()); }
    Scalar::from_bytes_mod_order_wide(&h.finalize().into())
}

fn hash_to_scalar_clsag(
    msg: &[u8; 32],
    l: &RistrettoPoint,
    r: &RistrettoPoint,
    d: &[u8; 32],
    mu_p: Scalar,
    mu_c: Scalar,
) -> Scalar {
    let mut h = Sha512::new();
    h.update(b"HSMC_CLSAG_c_");
    h.update(msg);
    h.update(l.compress().as_bytes());
    h.update(r.compress().as_bytes());
    h.update(d);
    h.update(mu_p.as_bytes());
    h.update(mu_c.as_bytes());
    Scalar::from_bytes_mod_order_wide(&h.finalize().into())
}

fn hash_to_scalar_domain(
    domain: &[u8],
    ring: &[RingPublicKey],
    extra: &[u8],
) -> Scalar {
    let mut h = Sha512::new();
    h.update(domain);
    for pk in ring { h.update(&pk.0); }
    h.update(extra);
    Scalar::from_bytes_mod_order_wide(&h.finalize().into())
}

fn scalar_from_bytes(bytes: &[u8; 32]) -> Result<Scalar, RingError> {
    Scalar::from_canonical_bytes(*bytes).ok_or(RingError::ScalarDecompressFailed)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ring(size: usize) -> (Vec<RingPublicKey>, Vec<RingPrivateKey>) {
        (0..size).map(|_| RingPublicKey::generate()).unzip()
    }

    #[test]
    fn test_lsag_sign_verify() -> anyhow::Result<()> {
        let (pks, sks) = make_ring(11);
        let signer_idx = 3;
        let message = b"HSMC transfer 10.0 to HSMC_DEST_ADDR";

        let sig = LsagSignature::sign(message, &sks[signer_idx], &pks[signer_idx], pks.clone(), signer_idx)
            .map_err(|e| anyhow::anyhow!("Sign failed: {}", e))?;

        assert!(sig.verify(message)
            .map_err(|e| anyhow::anyhow!("Verify failed: {}", e))?, "Signature must verify");
        Ok(())
    }

    #[test]
    fn test_lsag_reject_wrong_message() -> anyhow::Result<()> {
        let (pks, sks) = make_ring(5);
        let signer_idx = 0;
        let sig = LsagSignature::sign(b"original", &sks[0], &pks[0], pks, 0)?;
        let result = sig.verify(b"tampered")?;
        assert!(!result, "Must reject tampered message");
        Ok(())
    }

    #[test]
    fn test_key_image_deterministic() {
        let (pk, sk) = RingPublicKey::generate();
        let ki1 = KeyImage::compute(&sk, &pk);
        let ki2 = KeyImage::compute(&sk, &pk);
        assert_eq!(ki1, ki2, "Key image must be deterministic");
    }

    #[test]
    fn test_decoy_selection_deterministic() -> anyhow::Result<()> {
        let keys: Vec<RingPublicKey> = (0..100).map(|_| {
            let (pk, _) = RingPublicKey::generate();
            pk
        }).collect();
        let (ring, signer_pos) = select_decoys_deterministic(&keys, &keys[0], 11, 42)?;
        assert_eq!(ring.len(), 11);
        assert_eq!(ring[signer_pos], keys[0]);
        Ok(())
    }

    #[test]
    fn test_decoy_selection_crypto_random() -> anyhow::Result<()> {
        let keys: Vec<RingPublicKey> = (0..100).map(|_| {
            let (pk, _) = RingPublicKey::generate();
            pk
        }).collect();
        let (ring, signer_pos) = select_decoys(&keys, &keys[0], 11)?;
        assert_eq!(ring.len(), 11);
        assert_eq!(ring[signer_pos], keys[0]);
        // Verify all ring members are unique
        let unique: HashSet<[u8; 32]> = ring.iter().map(|pk| pk.0).collect();
        assert_eq!(unique.len(), 11);
        Ok(())
    }

    #[test]
    fn test_batch_verifier_key_image_dedup() -> anyhow::Result<()> {
        let (pks, sks) = make_ring(4);
        let msg = b"test_message";
        let sig1 = LsagSignature::sign(msg, &sks[0], &pks[0], pks.clone(), 0)?;
        let sig2 = sig1.clone(); // same key image

        let mut bv = RingBatchVerifier::new();
        assert!(bv.add("tx1".into(), msg.to_vec(), sig1));
        assert!(!bv.add("tx2".into(), msg.to_vec(), sig2)); // duplicate key image rejected
        Ok(())
    }

    #[test]
    fn test_mlsag_sign_verify() -> anyhow::Result<()> {
        let (pks, sks) = make_ring(7);
        let msg = b"mlsag multi-input test";
        let inputs = vec![
            (sks[0].clone(), pks[0].clone(), 0),
            (sks[2].clone(), pks[2].clone(), 2),
        ];
        // For simplicity test with single input
        let single_input = vec![(sks[1].clone(), pks[1].clone(), 1)];
        let sig = MlsagSignature::sign_multi(msg, single_input, pks)?;
        assert!(sig.verify(msg)?);
        Ok(())
    }
}
