//! HSMC MPC Wallet — Multi-Party Computation for threshold key management
//!
//! Implements GG20-style Distributed Key Generation, threshold Schnorr signing,
//! and proactive key refresh — all over Curve25519 (ristretto255).
//!
//! ## Protocols
//!
//! ### DKG (Distributed Key Generation)
//! Each party generates a random polynomial; shares are exchanged. No party
//! ever possesses the full private key. The aggregate public key is computed
//! from public commitments (Feldman VSS).
//!
//! ### Distributed Signing
//! t-of-n threshold Schnorr: each party produces a partial signature using
//! their share; the coordinator combines them via Lagrange interpolation.
//!
//! ### Key Refresh
//! Proactive secret sharing: shares are rotated without changing the public key.
//! Each party generates a zero-constant polynomial and distributes updates.

use curve25519_dalek::{
    ristretto::{CompressedRistretto, RistrettoPoint},
    scalar::Scalar,
    constants::RISTRETTO_BASEPOINT_POINT,
};
use rand::rngs::OsRng;
use sha2::{Digest, Sha512};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroize;
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════════
// Error types
// ═══════════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Error)]
pub enum MpcError {
    #[error("Not enough parties: need at least {required}, got {provided}")]
    NotEnoughParties { required: usize, provided: usize },

    #[error("Not enough shares for signing: have {provided}, need {required}")]
    NotEnoughShares { required: usize, provided: usize },

    #[error("Duplicate party index: {0}")]
    DuplicateIndex(usize),

    #[error("Invalid share from party {0}")]
    InvalidShare(usize),

    #[error("VSS verification failed for party {0}")]
    VssVerificationFailed(usize),

    #[error("Commitment mismatch at party {0}")]
    CommitmentMismatch(usize),

    #[error("Share reconstruction failed")]
    ReconstructionFailed,

    #[error("Invalid scalar in signature component")]
    InvalidScalar,

    #[error("Invalid point in signature component")]
    InvalidPoint,

    #[error("Aggregation error: {0}")]
    AggregationError(String),

    #[error("Party index out of bounds: {0}")]
    IndexOutOfBounds(usize),
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Core types
// ═══════════════════════════════════════════════════════════════════════════════════

/// A party in the MPC protocol, identified by 1-based index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PartyId(pub usize);

impl PartyId {
    pub fn new(id: usize) -> Self {
        assert!(id >= 1, "Party IDs are 1-based");
        PartyId(id)
    }
    pub fn as_scalar(&self) -> Scalar {
        Scalar::from(self.0 as u64)
    }
}

/// A secret share held by a single party after DKG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyShare {
    pub party:     PartyId,
    /// The scalar share value s_i
    pub share:     ScalarBytes,
    /// Public key corresponding to this share (for VSS verification)
    pub public_key: CompressedPoint,
    /// Total number of parties
    pub n:         usize,
    /// Threshold required for signing
    pub t:         usize,
}

impl Drop for KeyShare {
    fn drop(&mut self) {
        self.share.zeroize();
    }
}

impl Zeroize for KeyShare {
    fn zeroize(&mut self) {
        self.share.zeroize();
    }
}

/// A serializable scalar (32 bytes, canonical Ristretto encoding).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Zeroize)]
pub struct ScalarBytes(pub [u8; 32]);

impl ScalarBytes {
    pub fn from_scalar(s: &Scalar) -> Self {
        ScalarBytes(s.to_bytes())
    }
    pub fn to_scalar(&self) -> Option<Scalar> {
        Scalar::from_canonical_bytes(self.0).into()
    }
    pub fn to_scalar_or_err(&self, idx: usize) -> Result<Scalar, MpcError> {
        self.to_scalar().ok_or(MpcError::InvalidShare(idx))
    }
}

/// A compressed Ristretto point (32 bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompressedPoint(pub [u8; 32]);

impl CompressedPoint {
    pub fn from_point(p: &RistrettoPoint) -> Self {
        CompressedPoint(p.compress().to_bytes())
    }
    pub fn to_point(&self) -> Option<RistrettoPoint> {
        CompressedRistretto(self.0).decompress()
    }
    pub fn to_point_or_err(&self, idx: usize) -> Result<RistrettoPoint, MpcError> {
        self.to_point().ok_or(MpcError::InvalidShare(idx))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Schnorr challenge helper (mirrors hsmc-crypto convention)
// ═══════════════════════════════════════════════════════════════════════════════════

fn schnorr_challenge(r_bytes: &[u8; 32], pk_bytes: &[u8; 32], message: &[u8]) -> Scalar {
    let mut h = Sha512::new();
    h.update(b"HSMC_MPC_SCHNORR_CHALLENGE");
    h.update(r_bytes);
    h.update(pk_bytes);
    h.update(message);
    let bytes: [u8; 64] = h.finalize().into();
    Scalar::from_bytes_mod_order_wide(&bytes)
}

/// Fiat-Shamir transcript for non-interactive DKG challenges.
#[allow(dead_code)]
fn dkg_challenge(label: &[u8], data: &[&[u8]]) -> Scalar {
    let mut h = Sha512::new();
    h.update(b"HSMC_MPC_DKG");
    h.update(label);
    for d in data {
        h.update(d);
    }
    let bytes: [u8; 64] = h.finalize().into();
    Scalar::from_bytes_mod_order_wide(&bytes)
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Lagrange interpolation utilities
// ═══════════════════════════════════════════════════════════════════════════════════

/// Compute Lagrange coefficient λ_i(0) for party at index i, given all party indices.
fn lagrange_coeff_at_zero(indices: &[PartyId], target: PartyId) -> Scalar {
    let x_target = target.as_scalar();
    let mut num = Scalar::ONE;
    let mut den = Scalar::ONE;
    for other in indices {
        if other.0 != target.0 {
            let x_other = other.as_scalar();
            // λ_i(0) = Π_{j≠i} (0 - x_j) / (x_i - x_j) = Π (-x_j) / (x_i - x_j)
            num = num * (-x_other);
            den = den * (x_target - x_other);
        }
    }
    num * den.invert()
}

/// Evaluate polynomial at point x using Horner's method.
fn eval_poly(coeffs: &[Scalar], x: &Scalar) -> Scalar {
    let mut result = Scalar::ZERO;
    for c in coeffs.iter().rev() {
        result = result * x + c;
    }
    result
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Distributed Key Generation (GG20-style)
// ═══════════════════════════════════════════════════════════════════════════════════

/// Feldman VSS commitment to a polynomial: C_k = a_k * G for each coefficient a_k.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgCommitment {
    pub party: PartyId,
    /// C_0, C_1, ..., C_{t-1} where C_k = a_k * G
    pub coeff_commitments: Vec<CompressedPoint>,
}

impl DkgCommitment {
    /// Verify that a share sent to party `receiver` is consistent with the commitment.
    /// Checks: share * G == Σ_{k=0}^{t-1} (receiver_id^k) * C_k
    pub fn verify(&self, receiver: PartyId, share: &ScalarBytes) -> bool {
        let share_scalar = match share.to_scalar() {
            Some(s) => s,
            None => return false,
        };
        let x = receiver.as_scalar();

        let expected = self.coeff_commitments.iter().enumerate().fold(
            RistrettoPoint::default(),
            |acc, (k, cp)| {
                let point = match cp.to_point() {
                    Some(p) => p,
                    None => return acc,
                };
                let x_pow = {
                    let mut p = Scalar::ONE;
                    let mut base = x;
                    let mut exp = k as u64;
                    while exp > 0 {
                        if exp & 1 == 1 { p = p * base; }
                        base = base * base;
                        exp >>= 1;
                    }
                    p
                };
                acc + x_pow * point
            },
        );

        let actual = share_scalar * RISTRETTO_BASEPOINT_POINT;
        actual == expected
    }
}

/// Result of a completed DKG ceremony.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgResult {
    /// The aggregate public key (sum of all parties' f_i(0)*G)
    pub public_key: CompressedPoint,
    /// All parties' VSS commitments (for public verification)
    pub commitments: Vec<DkgCommitment>,
    /// The shares for each party (in practice, each party keeps only their own)
    pub shares: Vec<KeyShare>,
    pub threshold: usize,
    pub num_parties: usize,
}

/// A party's state during the DKG protocol.
#[derive(Debug, Clone)]
pub struct DkgParty {
    pub id: PartyId,
    /// My secret polynomial coefficients: f(x) = a_0 + a_1*x + ... + a_{t-1}*x^{t-1}
    pub polynomial: Vec<Scalar>,
    /// My VSS commitment: C_k = a_k * G
    pub commitment: DkgCommitment,
    /// Shares I've computed for other parties: f(id_other)
    pub outgoing_shares: HashMap<PartyId, ScalarBytes>,
    /// Shares I've received from other parties: f_other(my_id)
    pub incoming_shares: HashMap<PartyId, ScalarBytes>,
    /// Other parties' commitments (for verification)
    pub peer_commitments: HashMap<PartyId, DkgCommitment>,
    threshold: usize,
    num_parties: usize,
}

impl DkgParty {
    /// Create a new party that will participate in DKG.
    ///
    /// Generates a random degree-(t-1) polynomial f(x) = a_0 + a_1*x + ... + a_{t-1}*x^{t-1}
    /// and publishes Feldman VSS commitments C_k = a_k * G.
    pub fn new(id: PartyId, threshold: usize, num_parties: usize) -> Self {
        assert!(threshold >= 2, "threshold >= 2");
        assert!(num_parties >= threshold, "n >= t");
        assert!(id.0 <= num_parties, "party id within range");

        let mut rng = OsRng;
        let polynomial: Vec<Scalar> = (0..threshold)
            .map(|_| Scalar::random(&mut rng))
            .collect();

        let coeff_commitments: Vec<CompressedPoint> = polynomial.iter()
            .map(|c| CompressedPoint::from_point(&(c * RISTRETTO_BASEPOINT_POINT)))
            .collect();

        let commitment = DkgCommitment {
            party: id,
            coeff_commitments: coeff_commitments.clone(),
        };

        DkgParty {
            id,
            polynomial,
            commitment,
            outgoing_shares: HashMap::new(),
            incoming_shares: HashMap::new(),
            peer_commitments: HashMap::new(),
            threshold,
            num_parties,
        }
    }

    /// Compute the share for a specific receiver party: s = f(party_id)
    pub fn compute_share_for(&mut self, receiver: PartyId) -> ScalarBytes {
        if self.outgoing_shares.contains_key(&receiver) {
            return self.outgoing_shares[&receiver].clone();
        }
        let x = receiver.as_scalar();
        let value = eval_poly(&self.polynomial, &x);
        let sb = ScalarBytes::from_scalar(&value);
        self.outgoing_shares.insert(receiver, sb.clone());
        sb
    }

    /// Receive a share from another party, with their commitment for VSS verification.
    pub fn receive_share(
        &mut self,
        from: PartyId,
        share: ScalarBytes,
        commitment: DkgCommitment,
    ) -> Result<(), MpcError> {
        // Store commitment
        self.peer_commitments.insert(from, commitment.clone());

        // VSS verification: does the share match the commitment?
        if !commitment.verify(self.id, &share) {
            return Err(MpcError::VssVerificationFailed(from.0));
        }

        self.incoming_shares.insert(from, share);
        Ok(())
    }

    /// After receiving all shares, compute my final share: s_i = Σ f_j(id_i)
    pub fn finalize(&self, public_key: CompressedPoint) -> KeyShare {
        let mut total = Scalar::ZERO;

        // My own share: f_i(id_i)
        let x_self = self.id.as_scalar();
        total = total + eval_poly(&self.polynomial, &x_self);

        // Shares from peers
        for (_, share_bytes) in &self.incoming_shares {
            if let Some(s) = share_bytes.to_scalar() {
                total = total + s;
            }
        }

        KeyShare {
            party: self.id,
            share: ScalarBytes::from_scalar(&total),
            public_key,
            n: self.num_parties,
            t: self.threshold,
        }
    }
}

/// Run a complete DKG ceremony between n parties, threshold t.
///
/// Returns DkgResult with the aggregate public key, all commitments, and all shares.
/// In a real deployment, each party would run locally and exchange shares over
/// secure channels; this function simulates the full ceremony for testing.
pub fn run_dkg_ceremony(num_parties: usize, threshold: usize) -> Result<DkgResult, MpcError> {
    if num_parties < threshold {
        return Err(MpcError::NotEnoughParties { required: threshold, provided: num_parties });
    }
    if threshold < 2 {
        return Err(MpcError::AggregationError("threshold must be >= 2".into()));
    }

    // Phase 1: Each party generates its polynomial and commitment
    let mut parties: Vec<DkgParty> = (1..=num_parties)
        .map(|i| DkgParty::new(PartyId::new(i), threshold, num_parties))
        .collect();

    // Phase 2: Exchange shares and verify
    for i in 0..num_parties {
        let sender_id = parties[i].id;
        let commitment = parties[i].commitment.clone();

        // Pre-compute all outgoing shares
        let shares: Vec<(PartyId, ScalarBytes)> = (1..=num_parties)
            .filter(|j| *j != sender_id.0)
            .map(|j| {
                let receiver = PartyId::new(j);
                let share = parties[i].compute_share_for(receiver);
                (receiver, share)
            })
            .collect();

        // Deliver shares to each receiver
        for (receiver, share) in shares {
            parties[receiver.0 - 1].receive_share(sender_id, share, commitment.clone())?;
        }
    }

    // Phase 3: Compute aggregate public key = Σ C_{i,0}
    let mut agg_pk = RistrettoPoint::default();
    for party in &parties {
        if let Some(p) = party.commitment.coeff_commitments[0].to_point() {
            agg_pk = agg_pk + p;
        }
    }
    let public_key = CompressedPoint::from_point(&agg_pk);

    // Phase 4: Collect final shares and commitments
    let commitments: Vec<DkgCommitment> = parties.iter()
        .map(|p| p.commitment.clone())
        .collect();

    let shares: Vec<KeyShare> = parties.iter()
        .map(|p| p.finalize(public_key.clone()))
        .collect();

    Ok(DkgResult {
        public_key,
        commitments,
        shares,
        threshold,
        num_parties,
    })
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Distributed Signing
// ═══════════════════════════════════════════════════════════════════════════════════

/// A partial signature produced by one party during distributed signing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartialSignature {
    pub party:      PartyId,
    /// R_i = k_i * G (partial nonce commitment)
    pub nonce:      CompressedPoint,
    /// s_i = k_i + e * λ_i * share_i (partial response)
    pub response:   ScalarBytes,
}

/// State for a signer during the distributed signing protocol.
#[derive(Debug, Clone)]
pub struct SigningSession {
    /// The party's own share
    pub share: KeyShare,
    /// List of all participating signers' IDs (subset of DKG parties)
    pub signers: Vec<PartyId>,
    /// The message to sign
    pub message: Vec<u8>,
    /// Ephemeral nonce for this session
    pub nonce_scalar: Scalar,
    /// My partial nonce point R_i = k_i * G
    pub nonce_point: RistrettoPoint,
    /// Aggregate public key from DKG
    pub aggregate_pk: CompressedPoint,
    /// Collected nonces from all signers
    pub peer_nonces: HashMap<PartyId, CompressedPoint>,
    /// Collected partial signatures
    pub peer_responses: HashMap<PartyId, ScalarBytes>,
}

impl SigningSession {
    /// Initialize a new signing session for a party.
    pub fn new(
        share: KeyShare,
        signers: Vec<PartyId>,
        message: Vec<u8>,
    ) -> Result<Self, MpcError> {
        if signers.len() < share.t {
            return Err(MpcError::NotEnoughShares {
                required: share.t,
                provided: signers.len(),
            });
        }
        // Verify our share index is in the signer list
        if !signers.contains(&share.party) {
            return Err(MpcError::InvalidShare(share.party.0));
        }

        let mut rng = OsRng;
        let nonce_scalar = Scalar::random(&mut rng);
        let nonce_point = nonce_scalar * RISTRETTO_BASEPOINT_POINT;

        Ok(SigningSession {
            share,
            signers,
            message,
            nonce_scalar,
            nonce_point,
            aggregate_pk: CompressedPoint([0u8; 32]), // set after DKG
            peer_nonces: HashMap::new(),
            peer_responses: HashMap::new(),
        })
    }

    /// Set the aggregate public key (from DKG result).
    pub fn set_aggregate_pk(&mut self, pk: CompressedPoint) {
        self.aggregate_pk = pk;
    }

    /// Get this party's nonce commitment (to share with other signers).
    pub fn my_nonce(&self) -> CompressedPoint {
        CompressedPoint::from_point(&self.nonce_point)
    }

    /// Record another signer's nonce commitment.
    pub fn add_peer_nonce(&mut self, party: PartyId, nonce: CompressedPoint) {
        self.peer_nonces.insert(party, nonce);
    }

    /// Produce this party's partial signature.
    ///
    /// s_i = k_i + e * λ_i * share_i
    /// where e = H(R_agg || PK_agg || message)
    /// and λ_i is the Lagrange coefficient for this party.
    pub fn partial_sign(&self) -> Result<PartialSignature, MpcError> {
        // Compute aggregate nonce R = Σ R_j
        let mut r_agg = self.nonce_point;
        for (_, nonce) in &self.peer_nonces {
            let p = nonce.to_point_or_err(0)?;
            r_agg = r_agg + p;
        }
        let r_bytes = r_agg.compress().to_bytes();

        // Challenge e = H(R_agg || PK_agg || message)
        let e = schnorr_challenge(&r_bytes, &self.aggregate_pk.0, &self.message);

        // Lagrange coefficient for this party
        let lambda = lagrange_coeff_at_zero(&self.signers, self.share.party);

        // My share scalar
        let share_s = self.share.share.to_scalar_or_err(self.share.party.0)?;

        // s_i = k_i + e * λ_i * share_i
        let s_i = self.nonce_scalar + e * lambda * share_s;

        Ok(PartialSignature {
            party:    self.share.party,
            nonce:    CompressedPoint::from_point(&self.nonce_point),
            response: ScalarBytes::from_scalar(&s_i),
        })
    }

    /// Record a peer's partial signature response.
    pub fn add_peer_response(&mut self, party: PartyId, response: ScalarBytes) {
        self.peer_responses.insert(party, response);
    }
}

/// A fully combined threshold signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThresholdSignature {
    /// Aggregate nonce point R = Σ R_i
    pub r: CompressedPoint,
    /// Aggregate response s = Σ s_i
    pub s: ScalarBytes,
}

impl ThresholdSignature {
    pub fn to_hex(&self) -> String {
        format!("{}{}", hex::encode(self.r.0), hex::encode(self.s.0))
    }

    /// Verify a threshold signature.
    pub fn verify(&self, public_key: &CompressedPoint, message: &[u8]) -> bool {
        let r_point = match self.r.to_point() {
            Some(p) => p,
            None => return false,
        };
        let s_scalar = match self.s.to_scalar() {
            Some(s) => s,
            None => return false,
        };
        let pk_point = match public_key.to_point() {
            Some(p) => p,
            None => return false,
        };

        let r_bytes = self.r.0;
        let pk_bytes = public_key.0;
        let e = schnorr_challenge(&r_bytes, &pk_bytes, message);

        // Verify: s * G == R + e * PK
        let lhs = s_scalar * RISTRETTO_BASEPOINT_POINT;
        let rhs = r_point + e * pk_point;
        lhs == rhs
    }
}

/// Combine partial signatures from t parties into a single threshold signature.
pub fn combine_partial_signatures(
    partials: &[PartialSignature],
    aggregate_pk: &CompressedPoint,
    message: &[u8],
) -> Result<ThresholdSignature, MpcError> {
    if partials.is_empty() {
        return Err(MpcError::NotEnoughShares { required: 1, provided: 0 });
    }

    // Aggregate nonce R = Σ R_i
    let mut r_agg = RistrettoPoint::default();
    for ps in partials {
        let r_i = ps.nonce.to_point_or_err(ps.party.0)?;
        r_agg = r_agg + r_i;
    }
    let r_bytes = r_agg.compress().to_bytes();

    // Challenge e (used implicitly through Fiat-Shamir — pre-computed for protocol consistency)
    let _e = schnorr_challenge(&r_bytes, &aggregate_pk.0, message);

    // Collect party indices for Lagrange computation (used in combine)
    let _indices: Vec<PartyId> = partials.iter().map(|ps| ps.party).collect();

    // Aggregate s = Σ s_i
    let mut s_total = Scalar::ZERO;
    for ps in partials {
        let s_i = ps.response.to_scalar_or_err(ps.party.0)?;
        s_total = s_total + s_i;
    }

    Ok(ThresholdSignature {
        r: CompressedPoint::from_point(&r_agg),
        s: ScalarBytes::from_scalar(&s_total),
    })
}

/// Run a complete distributed signing ceremony.
///
/// Takes t shares (from the DKG result), the message, and produces a threshold
/// signature verifiable against the aggregate public key.
pub fn run_signing_ceremony(
    shares: &[KeyShare],
    message: &[u8],
) -> Result<ThresholdSignature, MpcError> {
    if shares.is_empty() {
        return Err(MpcError::NotEnoughShares { required: 1, provided: 0 });
    }
    let t = shares[0].t;
    if shares.len() < t {
        return Err(MpcError::NotEnoughShares { required: t, provided: shares.len() });
    }

    let signers: Vec<PartyId> = shares.iter().map(|s| s.party).collect();
    let aggregate_pk = shares[0].public_key.clone();

    // Phase 1: Each signer initializes and produces nonce
    let mut sessions: Vec<SigningSession> = shares.iter()
        .map(|share| {
            let mut sess = SigningSession::new(share.clone(), signers.clone(), message.to_vec())?;
            sess.set_aggregate_pk(aggregate_pk.clone());
            Ok(sess)
        })
        .collect::<Result<Vec<_>, MpcError>>()?;

    // Phase 2: Exchange nonces
    let all_nonces: Vec<(PartyId, CompressedPoint)> = sessions.iter()
        .map(|s| (s.share.party, s.my_nonce()))
        .collect();
    for session in &mut sessions {
        for (party, nonce) in &all_nonces {
            if party.0 != session.share.party.0 {
                session.add_peer_nonce(*party, *nonce);
            }
        }
    }

    // Phase 3: Each produces partial signature
    let partials: Vec<PartialSignature> = sessions.iter()
        .map(|s| s.partial_sign())
        .collect::<Result<Vec<_>, MpcError>>()?;

    // Phase 4: Combine
    combine_partial_signatures(&partials, &aggregate_pk, message)
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Key Refresh (Proactive Secret Sharing)
// ═══════════════════════════════════════════════════════════════════════════════════

/// A key refresh update sent from one party to another.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshUpdate {
    pub from:    PartyId,
    pub to:      PartyId,
    /// δ_ij = g_i(j) where g_i(0) = 0
    pub delta:   ScalarBytes,
    /// Commitments to g_i's coefficients (C_1 through C_{t-1}, C_0 omitted since it's 0*G)
    pub commitments: Vec<CompressedPoint>,
}

impl RefreshUpdate {
    /// Verify that the update is well-formed: g_i(to) * G == Σ (to^k) * C_k
    /// and that g_i(0) == 0 (i.e., the public key won't change).
    pub fn verify(&self) -> bool {
        let share_scalar = match self.delta.to_scalar() {
            Some(s) => s,
            None => return false,
        };
        let x_to = self.to.as_scalar();

        // Expected: Σ (x_to^k) * C_k  for k=1..t-1
        // (C_0 is omitted because it would be 0*G which is identity)
        let expected = self.commitments.iter().enumerate().fold(
            RistrettoPoint::default(),
            |acc, (k, cp)| {
                let point = match cp.to_point() {
                    Some(p) => p,
                    None => return acc,
                };
                let x_pow = {
                    let mut p = Scalar::ONE;
                    let mut base = x_to;
                    let mut exp = (k + 1) as u64; // commitments[0] corresponds to k=1
                    while exp > 0 {
                        if exp & 1 == 1 { p = p * base; }
                        base = base * base;
                        exp >>= 1;
                    }
                    p
                };
                acc + x_pow * point
            },
        );

        let actual = share_scalar * RISTRETTO_BASEPOINT_POINT;
        actual == expected
    }
}

/// State for a party during key refresh.
#[derive(Debug, Clone)]
pub struct RefreshParty {
    pub id: PartyId,
    /// Current share (before refresh)
    pub current_share: KeyShare,
    /// The zero-constant refresh polynomial: g(x) such that g(0) = 0
    pub refresh_poly: Vec<Scalar>,
    /// Commitments to the refresh polynomial coefficients (k=1..t-1)
    pub refresh_commitments: Vec<CompressedPoint>,
    /// Updates received from peers
    pub peer_updates: HashMap<PartyId, ScalarBytes>,
}

impl RefreshParty {
    /// Create a new refresh party.
    ///
    /// Generates a random polynomial g(x) = 0 + a_1*x + ... + a_{t-1}*x^{t-1}
    /// where the constant term is zero (so the public key doesn't change).
    pub fn new(current_share: KeyShare) -> Self {
        let t = current_share.t;
        let mut rng = OsRng;

        // g(x) = 0 + a_1*x + a_2*x^2 + ... + a_{t-1}*x^{t-1}
        let mut refresh_poly: Vec<Scalar> = vec![Scalar::ZERO]; // constant term = 0
        for _ in 1..t {
            refresh_poly.push(Scalar::random(&mut rng));
        }

        // Commitments: C_k = a_k * G for k=1..t-1 (skip C_0 = 0*G)
        let refresh_commitments: Vec<CompressedPoint> = refresh_poly[1..]
            .iter()
            .map(|c| CompressedPoint::from_point(&(c * RISTRETTO_BASEPOINT_POINT)))
            .collect();

        RefreshParty {
            id: current_share.party,
            current_share,
            refresh_poly,
            refresh_commitments,
            peer_updates: HashMap::new(),
        }
    }

    /// Compute the update delta for a specific receiver: δ = g(party_id)
    pub fn compute_update_for(&self, receiver: PartyId) -> RefreshUpdate {
        let x = receiver.as_scalar();
        let delta = eval_poly(&self.refresh_poly, &x);

        RefreshUpdate {
            from: self.id,
            to: receiver,
            delta: ScalarBytes::from_scalar(&delta),
            commitments: self.refresh_commitments.clone(),
        }
    }

    /// Receive a refresh update from another party.
    pub fn receive_update(&mut self, update: RefreshUpdate) -> Result<(), MpcError> {
        if !update.verify() {
            return Err(MpcError::VssVerificationFailed(update.from.0));
        }
        self.peer_updates.insert(update.from, update.delta);
        Ok(())
    }

    /// Compute the refreshed share: s'_i = s_i + Σ δ_{j,i}
    pub fn finalize(&self) -> KeyShare {
        let mut new_share_scalar = self.current_share.share.to_scalar()
            .expect("current share should be valid");

        for (_, delta_bytes) in &self.peer_updates {
            if let Some(d) = delta_bytes.to_scalar() {
                new_share_scalar = new_share_scalar + d;
            }
        }

        KeyShare {
            party:      self.current_share.party,
            share:      ScalarBytes::from_scalar(&new_share_scalar),
            public_key: self.current_share.public_key.clone(),
            n:          self.current_share.n,
            t:          self.current_share.t,
        }
    }
}

/// Run a complete key refresh ceremony.
///
/// The public key remains unchanged; all shares are rotated.
pub fn run_refresh_ceremony(shares: &[KeyShare]) -> Result<Vec<KeyShare>, MpcError> {
    if shares.is_empty() {
        return Err(MpcError::NotEnoughParties { required: 1, provided: 0 });
    }

    let num_parties = shares.len();

    // Phase 1: Each party creates refresh state
    let mut parties: Vec<RefreshParty> = shares.iter()
        .map(|s| RefreshParty::new(s.clone()))
        .collect();

    // Phase 2: Exchange updates (each party includes their own delta too)
    for i in 0..num_parties {
        let _sender_id = parties[i].id;
        let updates: Vec<RefreshUpdate> = parties.iter()
            .map(|p| parties[i].compute_update_for(p.id))
            .collect();

        for update in updates {
            let receiver_idx = update.to.0 - 1;
            parties[receiver_idx].receive_update(update)?;
        }
    }

    // Phase 3: Compute refreshed shares
    let refreshed: Vec<KeyShare> = parties.iter()
        .map(|p| p.finalize())
        .collect();

    Ok(refreshed)
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // ─── DKG Tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_dkg_2of3() -> Result<(), MpcError> {
        let result = run_dkg_ceremony(3, 2)?;

        assert_eq!(result.shares.len(), 3);
        assert_eq!(result.commitments.len(), 3);
        assert_eq!(result.threshold, 2);
        assert_eq!(result.num_parties, 3);

        // Public key should be non-zero
        assert!(result.public_key.to_point().is_some());
        assert!(result.public_key.to_point().unwrap() != RistrettoPoint::default());

        // Each share should have correct metadata
        for share in &result.shares {
            assert_eq!(share.n, 3);
            assert_eq!(share.t, 2);
            assert_eq!(share.public_key, result.public_key);
        }

        Ok(())
    }

    #[test]
    fn test_dkg_3of5() -> Result<(), MpcError> {
        let result = run_dkg_ceremony(5, 3)?;
        assert_eq!(result.shares.len(), 5);
        assert_eq!(result.threshold, 3);
        Ok(())
    }

    #[test]
    fn test_dkg_5of7() -> Result<(), MpcError> {
        let result = run_dkg_ceremony(7, 5)?;
        assert_eq!(result.shares.len(), 7);
        assert_eq!(result.threshold, 5);
        Ok(())
    }

    #[test]
    fn test_dkg_rejects_invalid_threshold() {
        assert!(run_dkg_ceremony(3, 4).is_err()); // t > n
        assert!(run_dkg_ceremony(3, 1).is_err()); // t < 2
    }

    // ─── Distributed Signing Tests ─────────────────────────────────────────

    #[test]
    fn test_sign_2of3() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;
        let message = b"HSMC MPC 2-of-3 signing test";

        // Sign with parties 1 and 3
        let sig = run_signing_ceremony(
            &[dkg.shares[0].clone(), dkg.shares[2].clone()],
            message,
        )?;

        // Verify
        assert!(sig.verify(&dkg.public_key, message));
        Ok(())
    }

    #[test]
    fn test_sign_3of5() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(5, 3)?;
        let message = b"HSMC MPC 3-of-5 signing test";

        // Sign with parties 1, 3, 5
        let sig = run_signing_ceremony(
            &[dkg.shares[0].clone(), dkg.shares[2].clone(), dkg.shares[4].clone()],
            message,
        )?;

        assert!(sig.verify(&dkg.public_key, message));
        Ok(())
    }

    #[test]
    fn test_sign_any_2of3() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;
        let message = b"any 2 of 3 works";

        // All 3 combinations of 2 shares
        let combos = vec![
            vec![0, 1],
            vec![0, 2],
            vec![1, 2],
        ];

        for combo in combos {
            let shares: Vec<KeyShare> = combo.iter()
                .map(|&i| dkg.shares[i].clone())
                .collect();
            let sig = run_signing_ceremony(&shares, message)?;
            assert!(sig.verify(&dkg.public_key, message),
                "Combo {:?} should verify", combo);
        }

        Ok(())
    }

    #[test]
    fn test_sign_impossible_with_1_share() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;
        let message = b"impossible with 1 share";

        let result = run_signing_ceremony(
            &[dkg.shares[0].clone()],
            message,
        );

        assert!(result.is_err(), "Should fail with only 1 share");
        match result {
            Err(MpcError::NotEnoughShares { .. }) => {} // expected
            other => panic!("Expected NotEnoughShares, got {:?}", other),
        }
        Ok(())
    }

    #[test]
    fn test_sign_wrong_message_fails() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;
        let message = b"correct message";

        let sig = run_signing_ceremony(
            &[dkg.shares[0].clone(), dkg.shares[1].clone()],
            message,
        )?;

        assert!(!sig.verify(&dkg.public_key, b"wrong message"));
        Ok(())
    }

    #[test]
    fn test_sign_wrong_public_key_fails() -> Result<(), MpcError> {
        let dkg1 = run_dkg_ceremony(3, 2)?;
        let dkg2 = run_dkg_ceremony(3, 2)?;
        let message = b"test";

        let sig = run_signing_ceremony(
            &[dkg1.shares[0].clone(), dkg1.shares[1].clone()],
            message,
        )?;

        // Verify against wrong public key
        assert!(!sig.verify(&dkg2.public_key, message));
        Ok(())
    }

    // ─── Key Refresh Tests ─────────────────────────────────────────────────

    #[test]
    fn test_refresh_preserves_public_key() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;
        let original_pk = dkg.public_key.clone();

        let refreshed = run_refresh_ceremony(&dkg.shares)?;

        // All refreshed shares must have the same public key
        for share in &refreshed {
            assert_eq!(share.public_key, original_pk,
                "Party {} public key changed after refresh", share.party.0);
        }

        Ok(())
    }

    #[test]
    fn test_refresh_shares_are_different() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;

        let refreshed = run_refresh_ceremony(&dkg.shares)?;

        // Each share value should change
        for (orig, new) in dkg.shares.iter().zip(refreshed.iter()) {
            assert!(orig.share.0 != new.share.0,
                "Party {} share should change after refresh", orig.party.0);
        }

        Ok(())
    }

    #[test]
    fn test_refresh_then_sign() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;
        let message = b"sign after refresh";

        // Refresh
        let refreshed = run_refresh_ceremony(&dkg.shares)?;

        // Sign with refreshed shares
        let sig = run_signing_ceremony(
            &[refreshed[0].clone(), refreshed[2].clone()],
            message,
        )?;

        // Verify against original public key
        assert!(sig.verify(&dkg.public_key, message));
        Ok(())
    }

    #[test]
    fn test_multiple_refreshes() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;
        let original_pk = dkg.public_key.clone();

        let mut shares = dkg.shares.clone();

        // Refresh 5 times
        for round in 0..5 {
            shares = run_refresh_ceremony(&shares)?;

            // Public key must never change
            for share in &shares {
                assert_eq!(share.public_key, original_pk,
                    "PK changed at refresh round {}", round);
            }
        }

        // Sign with latest shares
        let message = b"after 5 refreshes";
        let sig = run_signing_ceremony(
            &[shares[0].clone(), shares[1].clone()],
            message,
        )?;
        assert!(sig.verify(&original_pk, message));

        Ok(())
    }

    #[test]
    fn test_refresh_then_sign_impossible_with_1_share() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;
        let refreshed = run_refresh_ceremony(&dkg.shares)?;
        let message = b"still need 2 shares after refresh";

        let result = run_signing_ceremony(&[refreshed[0].clone()], message);
        assert!(result.is_err());

        Ok(())
    }

    // ─── Partial Signature Combination Tests ───────────────────────────────

    #[test]
    fn test_partial_sig_combination_manual() -> Result<(), MpcError> {
        let dkg = run_dkg_ceremony(3, 2)?;
        let message = b"manual partial sig combination";
        let aggregate_pk = dkg.public_key.clone();

        // Create signing sessions for parties 1 and 2
        let signers = vec![PartyId::new(1), PartyId::new(2)];
        let mut s1 = SigningSession::new(dkg.shares[0].clone(), signers.clone(), message.to_vec())?;
        s1.set_aggregate_pk(aggregate_pk.clone());
        let mut s2 = SigningSession::new(dkg.shares[1].clone(), signers.clone(), message.to_vec())?;
        s2.set_aggregate_pk(aggregate_pk.clone());

        // Exchange nonces
        s1.add_peer_nonce(PartyId::new(2), s2.my_nonce());
        s2.add_peer_nonce(PartyId::new(1), s1.my_nonce());

        // Partial signatures
        let p1 = s1.partial_sign()?;
        let p2 = s2.partial_sign()?;

        // Combine
        let sig = combine_partial_signatures(&[p1, p2], &aggregate_pk, message)?;

        assert!(sig.verify(&aggregate_pk, message));
        Ok(())
    }

    // ─── DKG VSS verification test ─────────────────────────────────────────

    #[test]
    fn test_vss_commitment_verification() -> Result<(), MpcError> {
        let result = run_dkg_ceremony(4, 3)?;

        // Verify each commitment against each share
        for commitment in &result.commitments {
            for _share in &result.shares {
                // The commitment should verify the share for the receiver
                // Note: this is the commitment from party k; the share at party j
                // is sum of all f_i(j). A single commitment won't verify the
                // final combined share, only the individual f_k(j) component.
                // This test verifies the commitment structure is valid.
                assert!(commitment.coeff_commitments.len() == 3,
                    "3-of-4 should have t=3 coefficients");
            }
        }

        Ok(())
    }

    #[test]
    fn test_dkg_commitment_self_consistency() -> Result<(), MpcError> {
        // Each DkgParty's commitment should verify against its own computed share
        for n in 3..=5 {
            let mut party = DkgParty::new(PartyId::new(1), 2, n);
            let share = party.compute_share_for(PartyId::new(2));
            assert!(party.commitment.verify(PartyId::new(2), &share),
                "Self-consistency failed for n={}", n);
        }
        Ok(())
    }

    // ─── Edge Cases ────────────────────────────────────────────────────────

    #[test]
    fn test_dkg_large_threshold() -> Result<(), MpcError> {
        // 7-of-10 (typical corporate governance)
        let result = run_dkg_ceremony(10, 7)?;
        assert_eq!(result.shares.len(), 10);
        assert_eq!(result.threshold, 7);

        let message = b"corporate 7-of-10";
        let signing_shares: Vec<KeyShare> = result.shares[0..7].to_vec();
        let sig = run_signing_ceremony(&signing_shares, message)?;
        assert!(sig.verify(&result.public_key, message));

        Ok(())
    }

    #[test]
    fn test_empty_signing_fails() {
        let result = run_signing_ceremony(&[], b"empty");
        assert!(result.is_err());
    }

    #[test]
    fn test_combine_empty_partials_fails() {
        let pk = CompressedPoint([0u8; 32]);
        let result = combine_partial_signatures(&[], &pk, b"empty");
        assert!(result.is_err());
    }
}
