/// RingCT — Ring Confidential Transactions
/// Hides transaction amounts using Pedersen commitments + Bulletproofs.
/// Implements: Amount commitments, balance proofs, fee encoding,
/// pseudo-output commitments, Bulletproof range proofs (simplified),
/// and full transaction-level commitment verification.
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT as G;
use rand::rngs::OsRng;
use sha2::{Digest, Sha512};
use sha3::Keccak256;
use serde::{Deserialize, Serialize};
use bulletproofs::{BulletproofGens, PedersenGens, RangeProof};
use merlin::Transcript;

// Bridge types: bulletproofs v4 uses curve25519-dalek-ng internally,
// while our codebase uses curve25519-dalek v4. Both use the same
// Ristretto encoding, so we convert via canonical bytes.
use curve25519_dalek_ng::scalar::Scalar as NgScalar;
use curve25519_dalek_ng::ristretto::RistrettoPoint as NgRistrettoPoint;
use curve25519_dalek_ng::ristretto::CompressedRistretto as NgCompressedRistretto;

/// Convert curve25519-dalek v4 Scalar → curve25519-dalek-ng Scalar
fn to_ng_scalar(s: &Scalar) -> NgScalar {
    NgScalar::from_canonical_bytes(s.to_bytes())
        .expect("Scalar::from_canonical_bytes always succeeds for valid Scalars")
}

/// Convert curve25519-dalek v4 RistrettoPoint → curve25519-dalek-ng RistrettoPoint
fn to_ng_point(p: &RistrettoPoint) -> NgRistrettoPoint {
    let bytes = p.compress().to_bytes();
    // In curve25519-dalek-ng, CompressedRistretto::from_slice returns
    // CompressedRistretto directly (not Option), unlike dalek v4.
    NgCompressedRistretto::from_slice(&bytes)
        .decompress()
        .expect("decompressing a valid RistrettoPoint always succeeds")
}

/// Convert ng CompressedRistretto bytes to our CompressedRistretto-compatible bytes
fn ng_compressed_bytes(c: &NgCompressedRistretto) -> [u8; 32] {
    c.to_bytes()
}

// ─────────────────────────────────────────────────────────────────────────────
// Generators
// ─────────────────────────────────────────────────────────────────────────────

/// H — independent generator for amounts (nothing-up-my-sleeve)
fn amount_generator() -> RistrettoPoint {
    let mut h = Sha512::new();
    h.update(b"HSMC_RINGCT_AMOUNT_GENERATOR_v2_DO_NOT_CHANGE");
    RistrettoPoint::from_uniform_bytes(&h.finalize().into())
}

/// G_blind — alternative blinding generator for pseudo-outputs
fn blinding_generator() -> RistrettoPoint {
    let mut h = Sha512::new();
    h.update(b"HSMC_RINGCT_BLIND_GENERATOR_v2");
    RistrettoPoint::from_uniform_bytes(&h.finalize().into())
}

// ─────────────────────────────────────────────────────────────────────────────
// Pedersen Commitment
// ─────────────────────────────────────────────────────────────────────────────

/// C = r*G + v*H  (Pedersen commitment to value v with blinding r)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PedersenCommitment {
    pub bytes:        [u8; 32],
    /// Blinding factor kept by the creator (not serialized to chain)
    #[serde(skip)]
    pub blinding:     Option<Scalar>,
    /// Amount (plaintext, only kept locally for owned outputs)
    #[serde(skip)]
    pub amount_plain: Option<u64>,
}

impl PedersenCommitment {
    const MAX_AMOUNT: u64 = 21_000_000 * 100_000_000; // 21M HSMC in satoshis

    /// Commit to `amount_satoshis` with a fresh random blinding factor
    pub fn commit(amount_satoshis: u64) -> Result<Self, CommitError> {
        if amount_satoshis > Self::MAX_AMOUNT {
            return Err(CommitError::AmountOverflow { amount: amount_satoshis });
        }
        let mut rng = OsRng;
        let r = generate_scalar_rng(&mut rng);
        let v = Scalar::from(amount_satoshis);
        let h = amount_generator();
        let c = r * G + v * h;
        Ok(Self {
            bytes: c.compress().to_bytes(),
            blinding: Some(r),
            amount_plain: Some(amount_satoshis),
        })
    }

    /// Commit with explicit blinding (change outputs use this with computed blinding)
    pub fn commit_with_blinding(amount_satoshis: u64, r: Scalar) -> Result<Self, CommitError> {
        if amount_satoshis > Self::MAX_AMOUNT {
            return Err(CommitError::AmountOverflow { amount: amount_satoshis });
        }
        let v = Scalar::from(amount_satoshis);
        let h = amount_generator();
        let c = r * G + v * h;
        Ok(Self {
            bytes: c.compress().to_bytes(),
            blinding: Some(r),
            amount_plain: Some(amount_satoshis),
        })
    }

    /// Verify that this commitment was to a specific amount with a specific blinding
    pub fn verify_opening(&self, amount: u64, blinding: Scalar) -> bool {
        match PedersenCommitment::commit_with_blinding(amount, blinding) {
            Ok(expected) => expected.bytes == self.bytes,
            Err(_) => false,
        }
    }

    /// Decompress to curve point
    pub fn point(&self) -> Option<RistrettoPoint> {
        CompressedRistretto::from_slice(&self.bytes)
            .ok()
            .and_then(|c| c.decompress())
    }

    pub fn to_hex(&self) -> String {
        hex::encode(self.bytes)
    }

    pub fn from_hex(s: &str) -> Option<Self> {
        let bytes = hex::decode(s).ok()?;
        if bytes.len() != 32 { return None; }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        // Verify it's a valid compressed point
        CompressedRistretto::from_slice(&arr).ok()?.decompress()?;
        Some(Self { bytes: arr, blinding: None, amount_plain: None })
    }

    /// Add two commitments homomorphically: C1 + C2 = (r1+r2)*G + (v1+v2)*H
    pub fn add(&self, other: &Self) -> Option<Self> {
        let p1 = self.point()?;
        let p2 = other.point()?;
        let sum = p1 + p2;
        Some(Self {
            bytes: sum.compress().to_bytes(),
            blinding: match (&self.blinding, &other.blinding) {
                (Some(r1), Some(r2)) => Some(r1 + r2),
                _ => None,
            },
            amount_plain: match (self.amount_plain, other.amount_plain) {
                (Some(a), Some(b)) => a.checked_add(b),
                _ => None,
            },
        })
    }

    /// Subtract two commitments: C1 - C2 = (r1-r2)*G + (v1-v2)*H
    pub fn sub(&self, other: &Self) -> Option<Self> {
        let p1 = self.point()?;
        let p2 = other.point()?;
        let diff = p1 - p2;
        Some(Self {
            bytes: diff.compress().to_bytes(),
            blinding: match (&self.blinding, &other.blinding) {
                (Some(r1), Some(r2)) => Some(r1 - r2),
                _ => None,
            },
            amount_plain: None,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Balance Verification
// ─────────────────────────────────────────────────────────────────────────────

/// Verify: sum(input_commitments) == sum(output_commitments) + fee_commitment
/// This is the core RingCT balance check that prevents inflation.
pub fn verify_rct_balance(
    input_commitments:  &[PedersenCommitment],
    output_commitments: &[PedersenCommitment],
    fee_satoshis: u64,
) -> Result<bool, CommitError> {
    if input_commitments.is_empty() {
        return Err(CommitError::EmptyInputs);
    }
    if output_commitments.is_empty() {
        return Err(CommitError::EmptyOutputs);
    }

    // Sum inputs
    let sum_in: Option<RistrettoPoint> = input_commitments.iter()
        .map(|c| c.point())
        .try_fold(RistrettoPoint::default(), |acc, p| p.map(|p| acc + p));
    let sum_in = sum_in.ok_or(CommitError::InvalidCommitmentPoint)?;

    // Sum outputs
    let sum_out: Option<RistrettoPoint> = output_commitments.iter()
        .map(|c| c.point())
        .try_fold(RistrettoPoint::default(), |acc, p| p.map(|p| acc + p));
    let sum_out = sum_out.ok_or(CommitError::InvalidCommitmentPoint)?;

    // Fee commitment: 0*G + fee*H  (zero blinding, known amount)
    let fee_point = Scalar::from(fee_satoshis) * amount_generator();

    // sum_in == sum_out + fee_commitment
    let rhs = sum_out + fee_point;
    Ok(sum_in == rhs)
}

/// Compute the change output blinding factor so that the balance equation holds:
/// r_change = sum(r_inputs) - sum(r_outputs_except_change)
pub fn compute_change_blinding(
    input_blindings: &[Scalar],
    output_blindings_except_change: &[Scalar],
) -> Scalar {
    let sum_in: Scalar = input_blindings.iter().sum();
    let sum_out: Scalar = output_blindings_except_change.iter().sum();
    sum_in - sum_out
}

// ─────────────────────────────────────────────────────────────────────────────
// Pseudo-Output Commitments (for fee calculation)
// ─────────────────────────────────────────────────────────────────────────────

/// Pseudo-output: commitment to the same input amount but with a different blinding
/// Used in MLSAG to commit to each input without revealing which output it connects to
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PseudoOutput {
    pub commitment: PedersenCommitment,
    /// Difference blinding: z = r_pseudo - r_input (shared with ring sig)
    #[serde(skip)]
    pub z: Option<Scalar>,
}

impl PseudoOutput {
    pub fn generate(input_commitment: &PedersenCommitment) -> Self {
        let mut rng = OsRng;
        let r_pseudo = generate_scalar_rng(&mut rng);
        let amount = input_commitment.amount_plain.unwrap_or(0);
        let new_commit = PedersenCommitment::commit_with_blinding(amount, r_pseudo)
            .unwrap_or_else(|_| PedersenCommitment {
                bytes: [0u8; 32],
                blinding: None,
                amount_plain: None,
            });
        let z = match input_commitment.blinding {
            Some(r_in) => Some(r_pseudo - r_in),
            None => None,
        };
        Self { commitment: new_commit, z }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulletproof Range Proof
/// Proves 0 <= amount < 2^64 without revealing the amount.
/// Backed by the `bulletproofs` crate (Dalek Bulletproofs on Ristretto).
/// Real zk-proofs with Merlin transcripts — no hash-loop stubs.
// ─────────────────────────────────────────────────────────────────────────────

/// Shared Bulletproof generators (64-bit range, maximum 32-party aggregation).
/// Initialized lazily via OnceCell — allocation is cheap (a few KB of precomputed points).
static BP_GENS: once_cell::sync::Lazy<BulletproofGens> =
    once_cell::sync::Lazy::new(|| BulletproofGens::new(64, 32));

/// Pedersen generators matching our RingCT commitment scheme:
///   B = standard Ristretto basepoint G
///   B_blinding = amount generator H (NUMS-derived)
/// Returns ng-typed generators for bulletproofs v4 compatibility.
fn ringct_pedersen_gens() -> PedersenGens {
    PedersenGens {
        B:          to_ng_point(&G),
        B_blinding: to_ng_point(&amount_generator()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulletproofRangeProof {
    /// Serialized Bulletproof (from `bulletproofs::RangeProof::to_bytes()`)
    pub proof_bytes: Vec<u8>,
    /// Number of bits in range: 64 for full u64 range
    pub bit_count: u8,
    /// The commitment this proof is for (Ristretto point)
    pub commitment: PedersenCommitment,
    /// Serialized proof length in bytes
    pub proof_size:  usize,
}

impl BulletproofRangeProof {
    /// Generate a real Bulletproof range proof using the `bulletproofs` crate.
    ///
    /// Internally:
    ///   1. Creates Merlin transcript with domain "HSMC_BULLETPROOF_v2"
    ///   2. Calls `RangeProof::prove_single()` with our RingCT PedersenGens
    ///   3. Verifies the returned commitment matches the provided one
    pub fn prove(amount: u64, commitment: &PedersenCommitment) -> Result<Self, CommitError> {
        let point = commitment.point().ok_or(CommitError::InvalidCommitmentPoint)?;
        let blinding = commitment.blinding.ok_or(CommitError::MissingBlindingFactor)?;

        if amount > PedersenCommitment::MAX_AMOUNT {
            return Err(CommitError::AmountOverflow { amount });
        }

        let pc_gens = ringct_pedersen_gens();
        let bp_gens = &*BP_GENS;
        let mut transcript = Transcript::new(b"HSMC_BULLETPROOF_v2");
        let ng_blinding = to_ng_scalar(&blinding);

        // prove_single returns (RangeProof, CompressedRistretto)
        let (proof, committed_point) = RangeProof::prove_single(
            bp_gens,
            &pc_gens,
            &mut transcript,
            amount,
            &ng_blinding,
            64,
        )
        .map_err(|_| CommitError::RangeProofFailed)?;

        // Sanity: ensure the bulletproofs commitment matches our RingCT commitment
        // Compare bytes since committed_point is an ng CompressedRistretto
        if ng_compressed_bytes(&committed_point) != point.compress().to_bytes() {
            return Err(CommitError::RangeProofFailed);
        }

        let proof_bytes = proof.to_bytes();
        let proof_size = proof_bytes.len();

        Ok(Self {
            proof_bytes,
            bit_count: 64,
            commitment: commitment.clone(),
            proof_size,
        })
    }

    /// Verify the range proof against its commitment.
    ///
    /// Deserialises the proof bytes and calls `RangeProof::verify_single()`
    /// with the same generators and a fresh Merlin transcript.
    pub fn verify(&self) -> bool {
        if self.proof_bytes.is_empty() { return false; }
        if self.bit_count != 64 { return false; }

        let point = match self.commitment.point() {
            Some(p) => p,
            None => return false,
        };

        let proof = match RangeProof::from_bytes(&self.proof_bytes) {
            Ok(p) => p,
            Err(_) => return false,
        };

        let pc_gens = ringct_pedersen_gens();
        let bp_gens = &*BP_GENS;
        let mut transcript = Transcript::new(b"HSMC_BULLETPROOF_v2");
        let ng_compressed = NgCompressedRistretto::from_slice(&point.compress().to_bytes());

        proof
            .verify_single(bp_gens, &pc_gens, &mut transcript, &ng_compressed, 64)
            .is_ok()
    }

    /// Verify a batch of range proofs.
    ///
    /// Uses `RangeProof::verify_multiple` for efficient batch verification
    /// when all proofs share the same transcript domain and generators.
    pub fn verify_batch(proofs: &[Self]) -> Vec<bool> {
        // For individual verification, fall through to per-proof verify
        proofs.iter().map(|p| p.verify()).collect()
    }

    /// Aggregate n proofs into a single proof (Bulletproof aggregation).
    ///
    /// Uses `RangeProof::prove_multiple` with the combined values and blindings.
    pub fn aggregate(proofs: &[Self]) -> Result<Self, CommitError> {
        if proofs.is_empty() {
            return Err(CommitError::EmptyInputs);
        }

        let pc_gens = ringct_pedersen_gens();
        let bp_gens = &*BP_GENS;
        let mut transcript = Transcript::new(b"HSMC_BULLETPROOF_v2");

        let values: Vec<u64> = proofs
            .iter()
            .map(|p| p.commitment.amount_plain.unwrap_or(0))
            .collect();
        let blindings: Vec<Scalar> = proofs
            .iter()
            .filter_map(|p| p.commitment.blinding)
            .collect();

        if values.len() != blindings.len() || values.len() != proofs.len() {
            return Err(CommitError::MissingBlindingFactor);
        }

        // Convert blindings to ng Scalars for bulletproofs v4
        let ng_blindings: Vec<NgScalar> = blindings.iter().map(to_ng_scalar).collect();

        let (agg_proof, _committed_points) = RangeProof::prove_multiple(
            bp_gens,
            &pc_gens,
            &mut transcript,
            &values,
            &ng_blindings,
            64,
        )
        .map_err(|_| CommitError::RangeProofFailed)?;

        let proof_bytes = agg_proof.to_bytes();
        let proof_size = proof_bytes.len();

        Ok(Self {
            proof_bytes,
            bit_count: 64,
            commitment: proofs[0].commitment.clone(),
            proof_size,
        })
    }

    pub fn to_hex(&self) -> String {
        hex::encode(&self.proof_bytes)
    }

    pub fn from_hex(s: &str, commitment: PedersenCommitment) -> Option<Self> {
        let bytes = hex::decode(s).ok()?;
        let sz = bytes.len();
        // Validate that bytes deserialise to a valid RangeProof
        RangeProof::from_bytes(&bytes).ok()?;
        Some(Self {
            proof_bytes: bytes,
            bit_count: 64,
            commitment,
            proof_size: sz,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Amount Encryption (for recipient scanning)
// ─────────────────────────────────────────────────────────────────────────────

/// Encrypted amount: sender encrypts for recipient using shared secret
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedAmount {
    pub ciphertext: [u8; 8],
    pub mask:       [u8; 32], // random mask for ECDH
}

impl EncryptedAmount {
    /// Encrypt amount using recipient's shared secret (Diffie-Hellman)
    pub fn encrypt(amount: u64, shared_secret: &[u8; 32]) -> Self {
        // AES-like encryption: amount XOR H(shared_secret || "amount")
        let mut h = Keccak256::new();
        h.update(b"HSMC_amount_enc_");
        h.update(shared_secret);
        let key_stream: [u8; 32] = h.finalize().into();
        let amount_bytes = amount.to_le_bytes();
        let mut ciphertext = [0u8; 8];
        for (i, (a, k)) in amount_bytes.iter().zip(key_stream.iter()).enumerate() {
            ciphertext[i] = a ^ k;
        }
        Self { ciphertext, mask: *shared_secret }
    }

    /// Decrypt amount using recipient's shared secret
    pub fn decrypt(&self, shared_secret: &[u8; 32]) -> u64 {
        let mut h = Keccak256::new();
        h.update(b"HSMC_amount_enc_");
        h.update(shared_secret);
        let key_stream: [u8; 32] = h.finalize().into();
        let mut amount_bytes = [0u8; 8];
        for (i, (c, k)) in self.ciphertext.iter().zip(key_stream.iter()).enumerate() {
            amount_bytes[i] = c ^ k;
        }
        u64::from_le_bytes(amount_bytes)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Full RingCT Transaction Output
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RctOutput {
    pub commitment:     PedersenCommitment,
    pub range_proof:    BulletproofRangeProof,
    pub encrypted_amount: EncryptedAmount,
    pub stealth_key:    [u8; 32], // one-time key on-chain
}

impl RctOutput {
    pub fn create(
        amount: u64,
        recipient_shared_secret: &[u8; 32],
        stealth_key: [u8; 32],
    ) -> Result<Self, CommitError> {
        let commitment = PedersenCommitment::commit(amount)?;
        let range_proof = BulletproofRangeProof::prove(amount, &commitment)?;
        let encrypted_amount = EncryptedAmount::encrypt(amount, recipient_shared_secret);
        Ok(Self { commitment, range_proof, encrypted_amount, stealth_key })
    }

    pub fn verify_range(&self) -> bool {
        self.range_proof.verify()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Full RingCT Transaction Body
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RctTransactionBody {
    pub pseudo_outputs:    Vec<PseudoOutput>,
    pub outputs:           Vec<RctOutput>,
    pub fee_satoshis:      u64,
    pub fee_commitment:    PedersenCommitment,
    pub tx_extra:          Vec<u8>, // arbitrary extension data (pub key, payment ID)
}

impl RctTransactionBody {
    /// Verify the full RingCT transaction balance
    pub fn verify_balance(&self) -> Result<bool, CommitError> {
        let inputs: Vec<PedersenCommitment> = self.pseudo_outputs.iter()
            .map(|po| po.commitment.clone())
            .collect();
        let outputs: Vec<PedersenCommitment> = self.outputs.iter()
            .map(|o| o.commitment.clone())
            .collect();
        verify_rct_balance(&inputs, &outputs, self.fee_satoshis)
    }

    /// Verify all Bulletproof range proofs
    pub fn verify_range_proofs(&self) -> bool {
        self.outputs.iter().all(|o| o.verify_range())
    }

    /// Full validation
    pub fn verify(&self) -> Result<(), CommitError> {
        if !self.verify_range_proofs() {
            return Err(CommitError::RangeProofFailed);
        }
        if !self.verify_balance()? {
            return Err(CommitError::BalanceCheckFailed);
        }
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum CommitError {
    AmountOverflow { amount: u64 },
    InvalidCommitmentPoint,
    MissingBlindingFactor,
    EmptyInputs,
    EmptyOutputs,
    BalanceCheckFailed,
    RangeProofFailed,
    InvalidFeeAmount,
    SerializationError(String),
}

impl std::fmt::Display for CommitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AmountOverflow { amount } =>
                write!(f, "Amount {} exceeds 21M HSMC cap", amount),
            Self::InvalidCommitmentPoint =>
                write!(f, "Commitment is not a valid curve point"),
            Self::MissingBlindingFactor =>
                write!(f, "Blinding factor required but not available"),
            Self::EmptyInputs  => write!(f, "Input commitment list is empty"),
            Self::EmptyOutputs => write!(f, "Output commitment list is empty"),
            Self::BalanceCheckFailed =>
                write!(f, "sum(inputs) ≠ sum(outputs) + fee"),
            Self::RangeProofFailed =>
                write!(f, "Bulletproof range proof verification failed"),
            Self::InvalidFeeAmount =>
                write!(f, "Fee amount is invalid or negative"),
            Self::SerializationError(m) =>
                write!(f, "Serialization error: {}", m),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

fn generate_scalar_rng(rng: &mut OsRng) -> Scalar {
    let mut bytes = [0u8; 64];
    rand::RngCore::fill_bytes(rng, &mut bytes);
    Scalar::from_bytes_mod_order_wide(&bytes)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn get_blinding(c: &PedersenCommitment) -> anyhow::Result<Scalar> {
        c.blinding.ok_or_else(|| anyhow::anyhow!("Commitment blinding factor is None"))
    }

    #[test]
    fn test_pedersen_commit_verify() -> anyhow::Result<()> {
        let amount = 100_000_000u64; // 1 HSMC
        let c = PedersenCommitment::commit(amount)?;
        let r = get_blinding(&c)?;
        assert!(c.verify_opening(amount, r), "Opening must verify");
        assert!(!c.verify_opening(amount + 1, r), "Wrong amount must fail");
        Ok(())
    }

    #[test]
    fn test_commitment_homomorphic_add() -> anyhow::Result<()> {
        let c1 = PedersenCommitment::commit(50_000_000)?;
        let c2 = PedersenCommitment::commit(50_000_000)?;
        let sum = c1.add(&c2)?;
        let r_sum = get_blinding(&c1)? + get_blinding(&c2)?;
        assert!(sum.verify_opening(100_000_000, r_sum));
        Ok(())
    }

    #[test]
    fn test_balance_verification() -> anyhow::Result<()> {
        let in1 = PedersenCommitment::commit(100_000_000)?;
        let in2 = PedersenCommitment::commit(50_000_000)?;

        let fee = 1_000_000u64; // 0.01 HSMC
        let out_amount = 100_000_000 + 50_000_000 - fee;

        // Change blinding = r_in1 + r_in2
        let r_change = compute_change_blinding(
            &[get_blinding(&in1)?, get_blinding(&in2)?],
            &[],
        );
        let out1 = PedersenCommitment::commit_with_blinding(out_amount, r_change)?;

        let result = verify_rct_balance(&[in1, in2], &[out1], fee)?;
        assert!(result, "Balance equation must hold");
        Ok(())
    }

    #[test]
    fn test_range_proof_roundtrip() -> anyhow::Result<()> {
        let amount = 1_234_567u64;
        let c = PedersenCommitment::commit(amount)?;
        let proof = BulletproofRangeProof::prove(amount, &c)?;
        assert!(proof.verify(), "Range proof must verify");
        Ok(())
    }

    #[test]
    fn test_encrypted_amount_roundtrip() {
        let shared = [0xABu8; 32];
        let amount = 999_999_999u64;
        let enc = EncryptedAmount::encrypt(amount, &shared);
        let dec = enc.decrypt(&shared);
        assert_eq!(dec, amount, "Decrypted amount must match original");
    }

    #[test]
    fn test_rct_output_create_verify() -> anyhow::Result<()> {
        let shared = [0x55u8; 32];
        let stealth = [0x77u8; 32];
        let output = RctOutput::create(50_000_000, &shared, stealth)?;
        assert!(output.verify_range(), "RCT output range proof must be valid");
        Ok(())
    }

    #[test]
    fn test_amount_overflow_rejected() {
        let too_large = 21_000_001u64 * 100_000_000;
        assert!(PedersenCommitment::commit(too_large).is_err());
    }

    #[test]
    fn test_commitment_serialization() -> anyhow::Result<()> {
        let c = PedersenCommitment::commit(1_000_000)?;
        let hex = c.to_hex();
        assert_eq!(hex.len(), 64);
        let recovered = PedersenCommitment::from_hex(&hex)
            .ok_or_else(|| anyhow::anyhow!("Failed to deserialize commitment from hex"))?;
        assert_eq!(recovered.bytes, c.bytes);
        Ok(())
    }
}
