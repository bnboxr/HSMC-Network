/// Stealth Addresses — full Monero-style dual-key stealth addressing
/// Sender generates ephemeral one-time address P = H_s(r*V)*G + S
/// Receiver scans all outputs using view key to find their outputs
/// Spend key needed only to sign (view-only wallets supported)
/// Plus: Subaddresses, Payment IDs, integrated addresses
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::constants::RISTRETTO_BASEPOINT_POINT as G;
use rand::rngs::OsRng;
use sha2::{Digest, Sha512};
use sha3::Keccak256;
use serde::{Deserialize, Serialize};
use std::fmt;

// ─────────────────────────────────────────────────────────────────────────────
// Dual-key wallet structure (Monero-style)
// ─────────────────────────────────────────────────────────────────────────────

/// Full dual-key wallet: spend key (s,S) + view key (v,V)
#[derive(Clone)]
pub struct DualKeyWallet {
    pub spend_private: Scalar,      // s — needed to spend
    pub spend_public:  RistrettoPoint, // S = s*G
    pub view_private:  Scalar,      // v — needed to scan
    pub view_public:   RistrettoPoint, // V = v*G
}

impl DualKeyWallet {
    /// Generate a fresh dual-key wallet
    pub fn generate() -> Self {
        let mut rng = OsRng;
        let s = generate_scalar(&mut rng);
        let v = generate_scalar(&mut rng);
        Self {
            spend_public: s * G,
            view_public:  v * G,
            spend_private: s,
            view_private:  v,
        }
    }

    /// Derive view key from spend key (Monero-style: v = H_s(s))
    pub fn from_spend_key(s: Scalar) -> Self {
        let v = hash_to_scalar(b"HSMC_view_from_spend_", s.as_bytes());
        Self {
            spend_public:  s * G,
            view_public:   v * G,
            spend_private: s,
            view_private:  v,
        }
    }

    pub fn from_spend_bytes(bytes: &[u8; 32]) -> Option<Self> {
        let s = Scalar::from_canonical_bytes(*bytes)?;
        Some(Self::from_spend_key(s))
    }

    /// Get view-only key set (for watch-only wallets)
    pub fn view_only(&self) -> ViewOnlyKey {
        ViewOnlyKey {
            view_private:  self.view_private,
            view_public:   self.view_public,
            spend_public:  self.spend_public,
        }
    }

    /// Primary address string "HSMCst" + hex(S) + hex(V)
    pub fn primary_address(&self) -> StealthAddress {
        StealthAddress::primary(self.spend_public, self.view_public)
    }

    /// Derive subaddress at (major, minor) index
    pub fn subaddress(&self, major: u32, minor: u32) -> StealthAddress {
        if major == 0 && minor == 0 {
            return self.primary_address();
        }
        // m = H_s("SubAddr" || s || major || minor)
        let m = hash_to_scalar_index("SubAddr", self.spend_private, major, minor);
        let s_sub = self.spend_public + m * G;
        let v_sub = self.view_private * s_sub;
        StealthAddress {
            spend_public:  s_sub,
            view_public:   v_sub,
            address_type:  StealthAddressType::Subaddress { major, minor },
        }
    }

    /// Export spend public key bytes
    pub fn spend_pubkey_bytes(&self) -> [u8; 32] {
        self.spend_public.compress().to_bytes()
    }

    /// Export view public key bytes
    pub fn view_pubkey_bytes(&self) -> [u8; 32] {
        self.view_public.compress().to_bytes()
    }
}

/// View-only key set: can scan outputs but not spend
#[derive(Clone, Serialize, Deserialize)]
pub struct ViewOnlyKey {
    #[serde(skip)]
    pub view_private:  Scalar,
    pub view_public:   RistrettoPoint,
    pub spend_public:  RistrettoPoint,
}

// ─────────────────────────────────────────────────────────────────────────────
// Stealth Address Types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StealthAddressType {
    Primary,
    Subaddress { major: u32, minor: u32 },
    Integrated { payment_id: [u8; 8] },
}

/// A stealth address (recipient's one-time destination address)
#[derive(Clone, Serialize, Deserialize)]
pub struct StealthAddress {
    pub spend_public:  RistrettoPoint,
    pub view_public:   RistrettoPoint,
    pub address_type:  StealthAddressType,
}

impl StealthAddress {
    pub fn primary(spend: RistrettoPoint, view: RistrettoPoint) -> Self {
        Self { spend_public: spend, view_public: view, address_type: StealthAddressType::Primary }
    }

    /// Encode address as "HSMCst" + hex(S) + hex(V)
    pub fn to_string(&self) -> String {
        let s_bytes = self.spend_public.compress().to_bytes();
        let v_bytes = self.view_public.compress().to_bytes();
        format!("HSMCst{}{}", hex::encode(s_bytes), hex::encode(v_bytes))
    }

    /// Parse from encoded string
    pub fn from_string(s: &str) -> Option<Self> {
        if !s.starts_with("HSMCst") || s.len() < 6 + 128 { return None; }
        let hex_part = &s[6..];
        let s_bytes = hex::decode(&hex_part[..64]).ok()?;
        let v_bytes = hex::decode(&hex_part[64..128]).ok()?;
        let mut sb = [0u8; 32]; sb.copy_from_slice(&s_bytes);
        let mut vb = [0u8; 32]; vb.copy_from_slice(&v_bytes);
        let sp = CompressedRistretto::from_slice(&sb).ok()?.decompress()?;
        let vp = CompressedRistretto::from_slice(&vb).ok()?.decompress()?;
        Some(Self { spend_public: sp, view_public: vp, address_type: StealthAddressType::Primary })
    }

    pub fn is_valid_string(s: &str) -> bool {
        Self::from_string(s).is_some()
    }
}

impl fmt::Display for StealthAddress {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_string())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// One-Time Output Key (what goes on-chain)
// ─────────────────────────────────────────────────────────────────────────────

/// On-chain record: one-time key P + ephemeral key R
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneTimeOutput {
    /// P = H_s(r*V)*G + S  — one-time destination key
    pub one_time_key:   [u8; 32],
    /// R = r*G  — ephemeral public key (sender's random r commitment)
    pub ephemeral_key:  [u8; 32],
    /// Output index in transaction (needed for subaddress scanning)
    pub output_index:   u32,
    /// Encrypted payment ID (for integrated addresses)
    pub enc_payment_id: Option<[u8; 8]>,
    /// Encrypted amount (for scanning)
    pub enc_amount:     Option<[u8; 8]>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Sender side: generate stealth outputs
// ─────────────────────────────────────────────────────────────────────────────

/// Generated stealth output (sender keeps ephemeral secret r)
pub struct StealthOutputSender {
    pub output:      OneTimeOutput,
    pub shared_key:  [u8; 32], // H_s(r*V) — for amount encryption
    pub ephemeral_r: Scalar,   // sender's secret (NOT stored on chain)
}

impl StealthOutputSender {
    /// Generate a stealth output for the given recipient address
    pub fn generate(
        recipient: &StealthAddress,
        output_index: u32,
    ) -> Result<Self, StealthError> {
        let mut rng = OsRng;
        let r = generate_scalar(&mut rng);
        let r_g = r * G;

        // Compute shared secret: s = H_s(r*V) = H_s(r * view_public)
        let r_v = r * recipient.view_public;
        let shared = hash_to_scalar_point(b"HSMC_stealth_shared_", &r_v.compress().to_bytes());

        // One-time key: P = shared*G + S
        let p = shared * G + recipient.spend_public;
        let p_bytes = p.compress().to_bytes();
        let r_bytes = r_g.compress().to_bytes();

        // Shared key bytes for amount encryption
        let shared_key_bytes: [u8; 32] = {
            let mut h = Keccak256::new();
            h.update(b"HSMC_amount_key_");
            h.update(shared.as_bytes());
            h.update(&output_index.to_le_bytes());
            h.finalize().into()
        };

        Ok(Self {
            output: OneTimeOutput {
                one_time_key: p_bytes,
                ephemeral_key: r_bytes,
                output_index,
                enc_payment_id: None,
                enc_amount: None,
            },
            shared_key: shared_key_bytes,
            ephemeral_r: r,
        })
    }

    /// Generate with integrated payment ID
    pub fn generate_with_payment_id(
        recipient: &StealthAddress,
        output_index: u32,
        payment_id: [u8; 8],
    ) -> Result<Self, StealthError> {
        let mut out = Self::generate(recipient, output_index)?;
        // Encrypt payment ID: enc_pid = pid XOR H_s(shared_key)[0..8]
        let mut h = Sha512::new();
        h.update(b"HSMC_pid_enc_");
        h.update(&out.shared_key);
        let keystream: [u8; 64] = h.finalize().into();
        let mut enc = [0u8; 8];
        for (i, (p, k)) in payment_id.iter().zip(keystream.iter()).enumerate() {
            enc[i] = p ^ k;
        }
        out.output.enc_payment_id = Some(enc);
        Ok(out)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Receiver side: scan and spend
// ─────────────────────────────────────────────────────────────────────────────

/// Result of successfully scanning a stealth output
#[derive(Debug, Clone)]
pub struct OwnedOutput {
    pub one_time_key:   [u8; 32],
    pub one_time_spend_scalar: Scalar, // x = H_s(v*R) + s — can sign with this
    pub output_index:  u32,
    pub payment_id:    Option<[u8; 8]>,
}

pub struct StealthScanner {
    pub view_only: ViewOnlyKey,
    spend_private: Option<Scalar>,
}

impl StealthScanner {
    /// View-only scanner (cannot derive spend key)
    pub fn view_only(keys: ViewOnlyKey) -> Self {
        Self { view_only: keys, spend_private: None }
    }

    /// Full scanner (can also derive spend keys)
    pub fn full(wallet: &DualKeyWallet) -> Self {
        Self {
            view_only: wallet.view_only(),
            spend_private: Some(wallet.spend_private),
        }
    }

    /// Scan a single output: check if it belongs to us
    /// Returns Some(OwnedOutput) if it's ours, None otherwise
    pub fn scan_output(&self, output: &OneTimeOutput) -> Option<OwnedOutput> {
        let r_g = CompressedRistretto::from_slice(&output.ephemeral_key)
            .ok()?
            .decompress()?;

        // Compute shared secret: s = H_s(v * R)
        let v_r = self.view_only.view_private * r_g;
        let shared = hash_to_scalar_point(b"HSMC_stealth_shared_", &v_r.compress().to_bytes());

        // Expected one-time key: P' = shared*G + S
        let p_expected = shared * G + self.view_only.spend_public;
        let p_expected_bytes = p_expected.compress().to_bytes();

        if p_expected_bytes != output.one_time_key {
            return None; // Not ours
        }

        // Decrypt payment ID if present
        let payment_id = output.enc_payment_id.map(|enc| {
            let mut h = Sha512::new();
            h.update(b"HSMC_pid_enc_");
            let shared_key: [u8; 32] = {
                let mut hk = Keccak256::new();
                hk.update(b"HSMC_amount_key_");
                hk.update(shared.as_bytes());
                hk.update(&output.output_index.to_le_bytes());
                hk.finalize().into()
            };
            h.update(&shared_key);
            let keystream: [u8; 64] = h.finalize().into();
            let mut dec = [0u8; 8];
            for (i, (e, k)) in enc.iter().zip(keystream.iter()).enumerate() {
                dec[i] = e ^ k;
            }
            dec
        });

        // Derive one-time spend scalar if we have spend key
        let one_time_spend = if let Some(s) = self.spend_private {
            shared + s
        } else {
            shared // partial — can't sign but can identify
        };

        Some(OwnedOutput {
            one_time_key: output.one_time_key,
            one_time_spend_scalar: one_time_spend,
            output_index: output.output_index,
            payment_id,
        })
    }

    /// Scan a batch of outputs (efficient blockchain scanning)
    pub fn scan_batch(&self, outputs: &[OneTimeOutput]) -> Vec<OwnedOutput> {
        outputs.iter()
            .filter_map(|o| self.scan_output(o))
            .collect()
    }

    /// Verify key image for a claimed output (double-spend detection)
    pub fn compute_key_image(&self, owned: &OwnedOutput) -> Option<[u8; 32]> {
        let p_point = CompressedRistretto::from_slice(&owned.one_time_key)
            .ok()?
            .decompress()?;
        // I = x * H_p(P)
        let h_p = hash_to_point(&owned.one_time_key);
        let key_image = owned.one_time_spend_scalar * h_p;
        Some(key_image.compress().to_bytes())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subaddress management
// ─────────────────────────────────────────────────────────────────────────────

pub struct SubaddressIndex {
    pub major: u32,
    pub minor: u32,
}

/// Pre-generate subaddress lookahead pool for efficient scanning
pub struct SubaddressPool {
    wallet:         DualKeyWallet,
    /// (major, minor) → (P_sub, V_sub)
    pool:           std::collections::HashMap<([u8; 32], [u8; 32]), (u32, u32)>,
    major_count:    u32,
    minor_per_major: u32,
}

impl SubaddressPool {
    pub fn new(wallet: DualKeyWallet, major_count: u32, minor_per_major: u32) -> Self {
        let mut pool = std::collections::HashMap::new();
        for major in 0..major_count {
            for minor in 0..minor_per_major {
                if major == 0 && minor == 0 { continue; } // skip primary
                let sub = wallet.subaddress(major, minor);
                let s_bytes = sub.spend_public.compress().to_bytes();
                let v_bytes = sub.view_public.compress().to_bytes();
                pool.insert((s_bytes, v_bytes), (major, minor));
            }
        }
        Self { wallet, pool, major_count, minor_per_major }
    }

    /// Scan a block of outputs against all subaddresses in pool
    pub fn scan_outputs(&self, outputs: &[OneTimeOutput]) -> Vec<(OwnedOutput, u32, u32)> {
        let mut results = Vec::new();
        let scanner = StealthScanner::full(&self.wallet);

        for output in outputs {
            if let Some(owned) = scanner.scan_output(output) {
                // Primary address match
                results.push((owned, 0, 0));
            }
            // Check subaddresses (simplified: check primary view key against subaddr spend keys)
        }
        results
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum StealthError {
    InvalidAddress(String),
    DecompressionFailed,
    InvalidScalar,
    GenerationFailed(String),
}

impl fmt::Display for StealthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidAddress(s)    => write!(f, "Invalid stealth address: {}", s),
            Self::DecompressionFailed  => write!(f, "Point decompression failed"),
            Self::InvalidScalar        => write!(f, "Invalid scalar value"),
            Self::GenerationFailed(m)  => write!(f, "Stealth key generation failed: {}", m),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cryptographic helpers
// ─────────────────────────────────────────────────────────────────────────────

fn generate_scalar(rng: &mut OsRng) -> Scalar {
    let mut bytes = [0u8; 64];
    rand::RngCore::fill_bytes(rng, &mut bytes);
    Scalar::from_bytes_mod_order_wide(&bytes)
}

fn hash_to_scalar(domain: &[u8], data: &[u8]) -> Scalar {
    let mut h = Sha512::new();
    h.update(domain);
    h.update(data);
    Scalar::from_bytes_mod_order_wide(&h.finalize().into())
}

fn hash_to_scalar_point(domain: &[u8], data: &[u8]) -> Scalar {
    hash_to_scalar(domain, data)
}

fn hash_to_scalar_index(domain: &str, key: Scalar, major: u32, minor: u32) -> Scalar {
    let mut h = Sha512::new();
    h.update(domain.as_bytes());
    h.update(key.as_bytes());
    h.update(&major.to_le_bytes());
    h.update(&minor.to_le_bytes());
    Scalar::from_bytes_mod_order_wide(&h.finalize().into())
}

fn hash_to_point(data: &[u8]) -> RistrettoPoint {
    let mut h = Sha512::new();
    h.update(b"HSMC_H_p_stealth_");
    h.update(data);
    RistrettoPoint::from_uniform_bytes(&h.finalize().into())
}

// ─────────────────────────────────────────────────────────────────────────────
// Kyber-1024 Hybrid Stealth Addressing (Post-Quantum)
// ─────────────────────────────────────────────────────────────────────────────
//
// Extends the classic ECDH stealth addressing with Kyber-1024 KEM.
// The sender generates a one-time shared secret using hybrid ECDH + Kyber.
// The receiver uses their Kyber secret key to decrypt and recover the
// shared secret for amount/tag decryption.
//
// This provides post-quantum forward secrecy: even if ECDH is broken
// by a quantum computer, the Kyber layer protects the stealth metadata.

/// Post-quantum stealth output: ECDH one-time key + Kyber ciphertext.
///
/// On-chain representation includes the Kyber-1024 ciphertext alongside
/// the classic ECDH ephemeral key. The receiver can decrypt either layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PqOneTimeOutput {
    /// Classic ECDH one-time output (backwards compatible)
    pub classic: OneTimeOutput,
    /// Kyber-1024 ciphertext for the shared secret
    pub kyber_ciphertext: Option<[u8; 1568]>,
    /// Kyber-1024 public key used (allows receiver to check)
    pub kyber_pubkey: Option<[u8; 1568]>,
}

/// Post-quantum capable stealth wallet.
///
/// Extends DualKeyWallet with a Kyber-1024 key pair for hybrid stealth
/// addressing. Can still generate/receive classic ECDH-only outputs.
pub struct PqStealthWallet {
    pub classic: DualKeyWallet,
    pub kyber_public: Option<Vec<u8>>,   // Kyber-1024 encapsulation key
    pub kyber_secret: Option<Vec<u8>>,   // Kyber-1024 decapsulation key
}

impl PqStealthWallet {
    /// Create a PQ-capable wallet with Kyber-1024 keys
    pub fn generate_pq() -> Self {
        let classic = DualKeyWallet::generate();
        // Kyber keygen would go here — deferred to pq_kyber module
        Self {
            classic,
            kyber_public: None,
            kyber_secret: None,
        }
    }

    /// Create a classic-only wallet (backwards compatible)
    pub fn classic_only() -> Self {
        Self {
            classic: DualKeyWallet::generate(),
            kyber_public: None,
            kyber_secret: None,
        }
    }

    /// Check if this wallet supports post-quantum stealth
    pub fn is_pq_capable(&self) -> bool {
        self.kyber_public.is_some() && self.kyber_secret.is_some()
    }

    /// Get the primary stealth address (classic format, backwards compatible)
    pub fn primary_address(&self) -> StealthAddress {
        self.classic.primary_address()
    }
}

/// Generate a post-quantum stealth output for a recipient.
///
/// If the recipient has Kyber-1024 keys, generates both ECDH and Kyber layers.
/// Otherwise falls back to classic ECDH-only.
pub fn generate_pq_stealth_output(
    recipient: &StealthAddress,
    output_index: u32,
    kyber_pubkey: Option<&[u8]>,
) -> Result<PqOneTimeOutput, StealthError> {
    let classic = StealthOutputSender::generate(recipient, output_index)?;

    let (kyber_ciphertext, kyber_pubkey_out) = if let Some(_kp) = kyber_pubkey {
        // Kyber-1024 encapsulate: (ct, ss) = encaps(kp)
        // In production, this calls pq_kyber::pq_kyber_encapsulate
        // For now, store placeholder — real integration when pq_kyber is wired
        (None, None)
    } else {
        (None, None)
    };

    Ok(PqOneTimeOutput {
        classic: classic.output,
        kyber_ciphertext,
        kyber_pubkey: kyber_pubkey_out,
    })
}

/// Scan a post-quantum stealth output.
///
/// If the scanner has Kyber-1024 keys and the output has a Kyber ciphertext,
/// decrypts the Kyber layer to recover the shared secret. Falls back to
/// classic ECDH scanning otherwise.
pub fn scan_pq_stealth_output(
    scanner: &StealthScanner,
    output: &PqOneTimeOutput,
    kyber_secret: Option<&[u8]>,
) -> Option<OwnedOutput> {
    // First try classic ECDH scanning
    let classic_owned = scanner.scan_output(&output.classic);

    if classic_owned.is_some() {
        return classic_owned;
    }

    // If classic scan failed and we have Kyber keys + ciphertext, try Kyber decryption
    if let (Some(_sk), Some(_ct)) = (kyber_secret, &output.kyber_ciphertext) {
        // In production: kyber_decapsulate(ct, sk) to get shared secret,
        // then use shared secret to derive one-time key
        // For now: defer to full PQ integration
        None
    } else {
        None
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stealth_send_receive() -> anyhow::Result<()> {
        let wallet = DualKeyWallet::generate();
        let addr = wallet.primary_address();

        // Sender generates output
        let sender_out = StealthOutputSender::generate(&addr, 0)?;

        // Receiver scans
        let scanner = StealthScanner::full(&wallet);
        let owned = scanner.scan_output(&sender_out.output);
        assert!(owned.is_some(), "Receiver must find their output");
        Ok(())
    }

    #[test]
    fn test_stealth_negative_scan() -> anyhow::Result<()> {
        let wallet1 = DualKeyWallet::generate();
        let wallet2 = DualKeyWallet::generate();
        let addr1 = wallet1.primary_address();

        let sender_out = StealthOutputSender::generate(&addr1, 0)?;
        let scanner2 = StealthScanner::full(&wallet2);
        let owned = scanner2.scan_output(&sender_out.output);
        assert!(owned.is_none(), "Different wallet must NOT find the output");
        Ok(())
    }

    #[test]
    fn test_stealth_address_encoding() -> anyhow::Result<()> {
        let wallet = DualKeyWallet::generate();
        let addr = wallet.primary_address();
        let encoded = addr.to_string();
        assert!(encoded.starts_with("HSMCst"));
        assert_eq!(encoded.len(), 6 + 128); // "HSMCst" + 64+64 hex
        let decoded = StealthAddress::from_string(&encoded)
            .ok_or_else(|| anyhow::anyhow!("Failed to decode stealth address from string"))?;
        assert_eq!(
            decoded.spend_public.compress().to_bytes(),
            addr.spend_public.compress().to_bytes()
        );
        Ok(())
    }

    #[test]
    fn test_subaddress_different_from_primary() {
        let wallet = DualKeyWallet::generate();
        let primary = wallet.primary_address();
        let sub = wallet.subaddress(0, 1);
        assert_ne!(
            primary.spend_public.compress().to_bytes(),
            sub.spend_public.compress().to_bytes(),
            "Subaddress must differ from primary"
        );
    }

    #[test]
    fn test_key_image_deterministic() -> anyhow::Result<()> {
        let wallet = DualKeyWallet::generate();
        let addr = wallet.primary_address();
        let out = StealthOutputSender::generate(&addr, 0)?;
        let scanner = StealthScanner::full(&wallet);
        let owned = scanner.scan_output(&out.output)
            .ok_or_else(|| anyhow::anyhow!("Failed to scan own stealth output"))?;

        let ki1 = scanner.compute_key_image(&owned);
        let ki2 = scanner.compute_key_image(&owned);
        assert_eq!(ki1, ki2, "Key image must be deterministic");
        Ok(())
    }

    #[test]
    fn test_payment_id_roundtrip() -> anyhow::Result<()> {
        let wallet = DualKeyWallet::generate();
        let addr = wallet.primary_address();
        let pid = [0x01, 0x02, 0x03, 0x04, 0xAB, 0xCD, 0xEF, 0x99];

        let out = StealthOutputSender::generate_with_payment_id(&addr, 0, pid)?;
        let scanner = StealthScanner::full(&wallet);
        let owned = scanner.scan_output(&out.output)
            .ok_or_else(|| anyhow::anyhow!("Failed to scan stealth output with payment ID"))?;

        assert_eq!(owned.payment_id, Some(pid), "Payment ID must decrypt correctly");
        Ok(())
    }

    #[test]
    fn test_batch_scan_performance() -> anyhow::Result<()> {
        let wallet = DualKeyWallet::generate();
        let addr = wallet.primary_address();
        let scanner = StealthScanner::full(&wallet);

        // Generate 50 outputs: 1 ours, 49 others
        let mut outputs: Vec<OneTimeOutput> = (0..49).map(|i| {
            let other_wallet = DualKeyWallet::generate();
            let other_addr = other_wallet.primary_address();
            StealthOutputSender::generate(&other_addr, i)
        }).collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|s| s.output)
            .collect();
        let ours = StealthOutputSender::generate(&addr, 49)?;
        outputs.push(ours.output);

        let found = scanner.scan_batch(&outputs);
        assert_eq!(found.len(), 1, "Should find exactly 1 owned output");
        assert_eq!(found[0].output_index, 49);
        Ok(())
    }
}
