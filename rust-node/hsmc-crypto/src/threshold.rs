/// Threshold Signatures — Shamir Secret Sharing + Threshold ECDSA/Schnorr
/// Supports t-of-n signing without any single party knowing the full key
use curve25519_dalek::{
    ristretto::RistrettoPoint,
    scalar::Scalar,
    constants::RISTRETTO_BASEPOINT_POINT,
};
use rand::rngs::OsRng;
use sha2::{Digest, Sha512};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use std::collections::HashMap;

// ─── Shamir Secret Sharing ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretShare {
    pub index: u64,       // shard index (1-based)
    pub value: [u8; 32],  // scalar shard value
}

#[derive(Debug, Error)]
pub enum ThresholdError {
    #[error("Not enough shares: need {threshold}, got {provided}")]
    NotEnoughShares { threshold: usize, provided: usize },
    #[error("Duplicate shard index {0}")]
    DuplicateIndex(u64),
    #[error("Invalid shard value at index {0}")]
    InvalidShardValue(u64),
    #[error("Reconstruction failed")]
    ReconstructionFailed,
}

/// Split a secret scalar into n shares, requiring t to reconstruct
/// Uses Shamir's Secret Sharing over the Ristretto scalar field
pub fn split_secret(
    secret: &Scalar,
    threshold: usize,
    num_shares: usize,
) -> Vec<SecretShare> {
    assert!(threshold >= 2, "Threshold must be at least 2");
    assert!(num_shares >= threshold, "Number of shares must be >= threshold");

    let mut rng = OsRng;

    // Generate (threshold-1) random polynomial coefficients
    // P(x) = secret + a1*x + a2*x^2 + ... + a(t-1)*x^(t-1)
    let mut coefficients: Vec<Scalar> = vec![*secret];
    for _ in 1..threshold {
        coefficients.push(Scalar::random(&mut rng));
    }

    // Evaluate polynomial at x = 1, 2, ..., num_shares
    (1..=num_shares)
        .map(|i| {
            let x = Scalar::from(i as u64);
            let value = evaluate_polynomial(&coefficients, &x);
            SecretShare { index: i as u64, value: value.to_bytes() }
        })
        .collect()
}

/// Reconstruct secret from t shares using Lagrange interpolation
pub fn reconstruct_secret(shares: &[SecretShare]) -> Result<Scalar, ThresholdError> {
    if shares.is_empty() {
        return Err(ThresholdError::NotEnoughShares { threshold: 1, provided: 0 });
    }

    // Check for duplicate indices
    let mut seen = std::collections::HashSet::new();
    for share in shares {
        if !seen.insert(share.index) {
            return Err(ThresholdError::DuplicateIndex(share.index));
        }
    }

    // Lagrange interpolation at x=0 (the secret)
    let mut secret = Scalar::ZERO;

    for (i, share_i) in shares.iter().enumerate() {
        let x_i = Scalar::from(share_i.index);
        let y_i = Scalar::from_canonical_bytes(share_i.value).into()
            .ok_or(ThresholdError::InvalidShardValue(share_i.index))?;

        // Compute Lagrange basis polynomial l_i(0) = Π(j≠i) (0 - x_j) / (x_i - x_j)
        let mut numerator = Scalar::ONE;
        let mut denominator = Scalar::ONE;

        for (j, share_j) in shares.iter().enumerate() {
            if i != j {
                let x_j = Scalar::from(share_j.index);
                // numerator *= (0 - x_j) = -x_j
                numerator = numerator * (-x_j);
                // denominator *= (x_i - x_j)
                denominator = denominator * (x_i - x_j);
            }
        }

        let basis = numerator * denominator.invert();
        secret = secret + y_i * basis;
    }

    Ok(secret)
}

fn evaluate_polynomial(coefficients: &[Scalar], x: &Scalar) -> Scalar {
    // Horner's method: a0 + x*(a1 + x*(a2 + ...))
    let mut result = Scalar::ZERO;
    for coeff in coefficients.iter().rev() {
        result = result * x + coeff;
    }
    result
}

// ─── Verifiable Secret Sharing (VSS) ─────────────────────────────────────────

/// Commitment to a polynomial coefficient (for VSS)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VssCommitment {
    pub commitments: Vec<[u8; 32]>, // C_i = a_i * G
}

impl VssCommitment {
    /// Generate VSS commitments for the polynomial coefficients
    pub fn generate(coefficients: &[Scalar]) -> Self {
        let commitments = coefficients.iter()
            .map(|c| (c * RISTRETTO_BASEPOINT_POINT).compress().to_bytes())
            .collect();
        Self { commitments }
    }

    /// Verify a share against the VSS commitments
    /// Checks: y_i * G == Σ C_k * x_i^k
    pub fn verify_share(&self, share: &SecretShare) -> bool {
        let x_i = Scalar::from(share.index);
        let y_i = match Scalar::from_canonical_bytes(share.value).into() {
            Some(s) => s,
            None => return false,
        };

        // Expected: Σ_{k=0}^{t-1} C_k * x_i^k
        let expected = self.commitments.iter().enumerate().fold(
            RistrettoPoint::default(),
            |acc, (k, c_bytes)| {
                use curve25519_dalek::ristretto::CompressedRistretto;
                match CompressedRistretto(*c_bytes).decompress() {
                    Some(c_point) => {
                        let x_pow = pow_scalar(&x_i, k as u64);
                        acc + x_pow * c_point
                    }
                    None => acc,
                }
            },
        );

        let actual = y_i * RISTRETTO_BASEPOINT_POINT;
        actual == expected
    }
}

fn pow_scalar(base: &Scalar, exp: u64) -> Scalar {
    if exp == 0 { return Scalar::ONE; }
    let mut result = Scalar::ONE;
    let mut b = *base;
    let mut e = exp;
    while e > 0 {
        if e & 1 == 1 { result = result * b; }
        b = b * b;
        e >>= 1;
    }
    result
}

// ─── Threshold Schnorr Signing ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThresholdPartialSig {
    pub signer_index: u64,
    pub r_i: [u8; 32],   // partial nonce point
    pub s_i: [u8; 32],   // partial signature scalar
}

/// Threshold Schnorr: combine partial signatures
/// Each party i computes s_i = k_i + e * y_i (their secret share evaluated at their index)
/// Final signature: s = Σ λ_i * s_i (Lagrange-weighted sum)
pub fn combine_threshold_schnorr_sigs(
    partial_sigs: &[ThresholdPartialSig],
    aggregate_nonce: &RistrettoPoint,
    message: &[u8],
    aggregate_pk: &RistrettoPoint,
) -> crate::SchnorrSignature {
    let r_bytes = aggregate_nonce.compress().to_bytes();
    let pk_bytes = aggregate_pk.compress().to_bytes();

    // Lagrange interpolation weights for combining partial sigs
    let indices: Vec<Scalar> = partial_sigs.iter()
        .map(|ps| Scalar::from(ps.signer_index))
        .collect();

    let mut s_total = Scalar::ZERO;
    for (i, ps) in partial_sigs.iter().enumerate() {
        let s_i = match Scalar::from_canonical_bytes(ps.s_i).into() {
            Some(s) => s,
            None => continue,
        };
        let lambda = lagrange_coeff_at_zero(&indices, i);
        s_total = s_total + lambda * s_i;
    }

    crate::SchnorrSignature { r: r_bytes, s: s_total.to_bytes() }
}

fn lagrange_coeff_at_zero(indices: &[Scalar], i: usize) -> Scalar {
    let x_i = indices[i];
    let mut num = Scalar::ONE;
    let mut den = Scalar::ONE;
    for (j, &x_j) in indices.iter().enumerate() {
        if i != j {
            num = num * (-x_j);
            den = den * (x_i - x_j);
        }
    }
    num * den.invert()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shamir_2of3() -> anyhow::Result<()> {
        let mut rng = OsRng;
        let secret = Scalar::random(&mut rng);
        let shares = split_secret(&secret, 2, 3);
        assert_eq!(shares.len(), 3);

        // Reconstruct from any 2 shares
        let reconstructed = reconstruct_secret(&shares[..2])?;
        assert_eq!(secret, reconstructed);

        let reconstructed2 = reconstruct_secret(&[shares[0].clone(), shares[2].clone()])?;
        assert_eq!(secret, reconstructed2);

        let reconstructed3 = reconstruct_secret(&[shares[1].clone(), shares[2].clone()])?;
        assert_eq!(secret, reconstructed3);
        Ok(())
    }

    #[test]
    fn test_vss_share_verification() {
        let mut rng = OsRng;
        let secret = Scalar::random(&mut rng);
        let threshold = 3;
        let num_shares = 5;

        // Manually build polynomial
        let mut coefficients = vec![secret];
        for _ in 1..threshold {
            coefficients.push(Scalar::random(&mut rng));
        }

        let commitments = VssCommitment::generate(&coefficients);
        let shares = split_secret(&secret, threshold, num_shares);

        // All shares should verify
        for share in &shares {
            assert!(commitments.verify_share(share), "Share {} should verify", share.index);
        }
    }

    #[test]
    fn test_3of5_reconstruction() -> anyhow::Result<()> {
        let mut rng = OsRng;
        let secret = Scalar::random(&mut rng);
        let shares = split_secret(&secret, 3, 5);

        // Pick shares 1, 3, 5
        let selected = vec![shares[0].clone(), shares[2].clone(), shares[4].clone()];
        let reconstructed = reconstruct_secret(&selected)?;
        assert_eq!(secret, reconstructed);
        Ok(())
    }
}
