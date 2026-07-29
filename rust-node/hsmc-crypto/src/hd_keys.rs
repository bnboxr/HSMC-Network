/// HD Key Derivation — BIP32/BIP44 full implementation for HSMC
/// Supports hardened and non-hardened derivation, master key generation,
/// child key derivation, xpub/xprv serialization, BIP44 path parsing
use curve25519_dalek::{
    scalar::Scalar,
    ristretto::RistrettoPoint,
    constants::RISTRETTO_BASEPOINT_POINT,
};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256, Sha512};
use sha3::Keccak256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

type HmacSha512 = Hmac<Sha512>;

// ─── Constants ────────────────────────────────────────────────────────────────

const HMAC_KEY_MAINNET: &[u8] = b"HSMC Mainnet seed";
const HMAC_KEY_TESTNET: &[u8] = b"HSMC Testnet seed";
const HARDENED_OFFSET: u32 = 0x80000000;

/// HSMC BIP44 coin type
pub const COIN_TYPE_HSMC: u32 = 8888;

// ─── BIP44 Path ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DerivationPath {
    pub components: Vec<PathComponent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathComponent {
    pub index: u32,
    pub hardened: bool,
}

impl PathComponent {
    pub fn normal(index: u32) -> Self { Self { index, hardened: false } }
    pub fn hardened(index: u32) -> Self { Self { index, hardened: true } }
    pub fn child_number(&self) -> u32 {
        if self.hardened { self.index + HARDENED_OFFSET } else { self.index }
    }
}

impl std::fmt::Display for DerivationPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "m")?;
        for c in &self.components {
            if c.hardened { write!(f, "/{}'", c.index)?; }
            else { write!(f, "/{}", c.index)?; }
        }
        Ok(())
    }
}

impl DerivationPath {
    /// Parse a BIP44 path string like "m/44'/8888'/0'/0/0"
    pub fn parse(s: &str) -> Result<Self, HdKeyError> {
        let s = s.trim();
        if !s.starts_with("m/") && s != "m" {
            return Err(HdKeyError::InvalidPath(s.into()));
        }
        if s == "m" { return Ok(Self { components: vec![] }); }

        let components = s[2..].split('/').map(|part| {
            let hardened = part.ends_with('\'') || part.ends_with('h');
            let index_str = part.trim_end_matches('\'').trim_end_matches('h');
            let index: u32 = index_str.parse()
                .map_err(|_| HdKeyError::InvalidPath(part.into()))?;
            Ok(PathComponent { index, hardened })
        }).collect::<Result<Vec<_>, HdKeyError>>()?;

        Ok(Self { components })
    }

    /// Standard HSMC account path: m/44'/8888'/account'/change/index
    pub fn hsmc_account(account: u32, change: u32, index: u32) -> Self {
        Self {
            components: vec![
                PathComponent::hardened(44),
                PathComponent::hardened(COIN_TYPE_HSMC),
                PathComponent::hardened(account),
                PathComponent::normal(change),
                PathComponent::normal(index),
            ],
        }
    }

    /// Internal (change) address: m/44'/8888'/0'/1/index
    pub fn hsmc_change(account: u32, index: u32) -> Self {
        Self::hsmc_account(account, 1, index)
    }
}

// ─── Extended Key ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Zeroize, ZeroizeOnDrop)]
pub struct ExtendedPrivKey {
    #[zeroize(skip)]
    pub depth: u8,
    #[zeroize(skip)]
    pub parent_fingerprint: [u8; 4],
    #[zeroize(skip)]
    pub child_number: u32,
    pub chain_code: [u8; 32],
    pub secret_key: [u8; 32],  // Scalar bytes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtendedPubKey {
    pub depth: u8,
    pub parent_fingerprint: [u8; 4],
    pub child_number: u32,
    pub chain_code: [u8; 32],
    pub public_key: [u8; 32],  // Compressed Ristretto point
}

#[derive(Debug, Error)]
pub enum HdKeyError {
    #[error("Invalid seed length: need 16-64 bytes, got {0}")]
    InvalidSeedLength(usize),
    #[error("Invalid derivation path: {0}")]
    InvalidPath(String),
    #[error("Invalid key at index {0}: key is zero or not valid")]
    InvalidKey(u32),
    #[error("Cannot derive hardened child from public key")]
    HardenedFromPublic,
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Invalid checksum")]
    InvalidChecksum,
}

impl ExtendedPrivKey {
    /// Generate master key from seed bytes (BIP32 compatible)
    pub fn from_seed(seed: &[u8], network: Network) -> Result<Self, HdKeyError> {
        if seed.len() < 16 || seed.len() > 64 {
            return Err(HdKeyError::InvalidSeedLength(seed.len()));
        }

        let hmac_key = match network {
            Network::Mainnet => HMAC_KEY_MAINNET,
            Network::Testnet => HMAC_KEY_TESTNET,
        };

        let mut mac = HmacSha512::new_from_slice(hmac_key)
            .expect("HMAC-SHA512 accepts any key size");
        mac.update(seed);
        let result = mac.finalize().into_bytes();

        let (il, ir) = result.split_at(32);

        // Validate the key (must be nonzero and less than group order)
        let mut il_arr = [0u8; 32];
        il_arr.copy_from_slice(il);

        let scalar = Scalar::from_canonical_bytes(il_arr).into_option()
            .ok_or(HdKeyError::InvalidKey(0))?;

        if scalar == Scalar::ZERO {
            return Err(HdKeyError::InvalidKey(0));
        }

        let mut chain_code = [0u8; 32];
        chain_code.copy_from_slice(ir);

        Ok(Self {
            depth: 0,
            parent_fingerprint: [0u8; 4],
            child_number: 0,
            chain_code,
            secret_key: il_arr,
        })
    }

    /// Derive a child private key
    pub fn derive_child(&self, component: PathComponent) -> Result<Self, HdKeyError> {
        let child_num = component.child_number();

        let mut data = Vec::with_capacity(37);

        if component.hardened {
            // Hardened: HMAC(chain_code, 0x00 || key || index)
            data.push(0x00);
            data.extend_from_slice(&self.secret_key);
        } else {
            // Normal: HMAC(chain_code, pubkey || index)
            let pk = self.public_key_bytes();
            data.extend_from_slice(&pk);
        }
        data.extend_from_slice(&child_num.to_be_bytes());

        let mut mac = HmacSha512::new_from_slice(&self.chain_code)
            .expect("HMAC-SHA512 accepts any key size");
        mac.update(&data);
        let result = mac.finalize().into_bytes();

        let (il, ir) = result.split_at(32);
        let mut il_arr = [0u8; 32];
        il_arr.copy_from_slice(il);

        let il_scalar = Scalar::from_canonical_bytes(il_arr).into_option()
            .ok_or(HdKeyError::InvalidKey(child_num))?;

        let parent_scalar = Scalar::from_canonical_bytes(self.secret_key).into_option()
            .ok_or(HdKeyError::InvalidKey(child_num))?;

        let child_scalar = il_scalar + parent_scalar;
        if child_scalar == Scalar::ZERO {
            return Err(HdKeyError::InvalidKey(child_num));
        }

        let mut chain_code = [0u8; 32];
        chain_code.copy_from_slice(ir);

        // Compute parent fingerprint
        let parent_pk = self.public_key_bytes();
        let mut fingerprint = [0u8; 4];
        let fp_hash = Sha256::digest(Sha256::digest(&parent_pk));
        fingerprint.copy_from_slice(&fp_hash[..4]);

        Ok(Self {
            depth: self.depth + 1,
            parent_fingerprint: fingerprint,
            child_number: child_num,
            chain_code,
            secret_key: child_scalar.to_bytes(),
        })
    }

    /// Derive at a full BIP44 path
    pub fn derive_path(&self, path: &DerivationPath) -> Result<Self, HdKeyError> {
        let mut key = self.clone();
        for component in &path.components {
            key = key.derive_child(*component)?;
        }
        Ok(key)
    }

    /// Get the corresponding public key bytes (compressed Ristretto)
    pub fn public_key_bytes(&self) -> [u8; 32] {
        let sk = Scalar::from_canonical_bytes(self.secret_key).into_option()
            .expect("secret key should be valid scalar");
        (sk * RISTRETTO_BASEPOINT_POINT).compress().to_bytes()
    }

    /// Get the extended public key for this key
    pub fn to_extended_pubkey(&self) -> ExtendedPubKey {
        ExtendedPubKey {
            depth: self.depth,
            parent_fingerprint: self.parent_fingerprint,
            child_number: self.child_number,
            chain_code: self.chain_code,
            public_key: self.public_key_bytes(),
        }
    }

    /// Derive HSMC wallet address from this key
    pub fn to_hsmc_address(&self) -> String {
        let pk = self.public_key_bytes();
        // Keccak256 of public key, take last 20 bytes → hex address
        let hash = Keccak256::digest(&pk);
        format!("0x{}", hex::encode(&hash[12..]))
    }

    /// Serialize to xprv-like base58 string
    pub fn to_xprv_string(&self) -> String {
        let mut payload = Vec::with_capacity(78);
        payload.extend_from_slice(&[0x04, 0x88, 0xAD, 0xE4]); // version (mainnet xprv)
        payload.push(self.depth);
        payload.extend_from_slice(&self.parent_fingerprint);
        payload.extend_from_slice(&self.child_number.to_be_bytes());
        payload.extend_from_slice(&self.chain_code);
        payload.push(0x00); // prefix for private key
        payload.extend_from_slice(&self.secret_key);

        // Double SHA256 checksum
        let checksum = &Sha256::digest(Sha256::digest(&payload))[..4];
        payload.extend_from_slice(checksum);

        bs58_encode(&payload)
    }
}

impl ExtendedPubKey {
    /// Derive a child public key (non-hardened only)
    pub fn derive_child(&self, index: u32) -> Result<Self, HdKeyError> {
        if index >= HARDENED_OFFSET {
            return Err(HdKeyError::HardenedFromPublic);
        }

        let mut data = Vec::with_capacity(37);
        data.extend_from_slice(&self.public_key);
        data.extend_from_slice(&index.to_be_bytes());

        let mut mac = HmacSha512::new_from_slice(&self.chain_code)
            .expect("HMAC-SHA512 accepts any key size");
        mac.update(&data);
        let result = mac.finalize().into_bytes();

        let (il, ir) = result.split_at(32);
        let mut il_arr = [0u8; 32];
        il_arr.copy_from_slice(il);

        let il_scalar = Scalar::from_canonical_bytes(il_arr).into_option()
            .ok_or(HdKeyError::InvalidKey(index))?;

        use curve25519_dalek::ristretto::CompressedRistretto;
        let parent_pk = CompressedRistretto(self.public_key).decompress()
            .ok_or(HdKeyError::InvalidKey(index))?;

        let child_pk = il_scalar * RISTRETTO_BASEPOINT_POINT + parent_pk;

        let mut chain_code = [0u8; 32];
        chain_code.copy_from_slice(ir);

        let fp_hash = Sha256::digest(Sha256::digest(&self.public_key));
        let mut fingerprint = [0u8; 4];
        fingerprint.copy_from_slice(&fp_hash[..4]);

        Ok(Self {
            depth: self.depth + 1,
            parent_fingerprint: fingerprint,
            child_number: index,
            chain_code,
            public_key: child_pk.compress().to_bytes(),
        })
    }

    /// Derive HSMC address from public key
    pub fn to_hsmc_address(&self) -> String {
        let hash = Keccak256::digest(&self.public_key);
        format!("0x{}", hex::encode(&hash[12..]))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Network {
    Mainnet,
    Testnet,
}

/// Simple base58 encoding
fn bs58_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut digits = vec![0u32];
    for &byte in data {
        let mut carry = byte as u32;
        for digit in digits.iter_mut() {
            carry += *digit * 256;
            *digit = carry % 58;
            carry /= 58;
        }
        while carry > 0 {
            digits.push(carry % 58);
            carry /= 58;
        }
    }
    // Handle leading zeros
    let leading = data.iter().take_while(|&&b| b == 0).count();
    let mut result = "1".repeat(leading);
    for &d in digits.iter().rev() {
        result.push(ALPHABET[d as usize] as char);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_master_key_generation() -> anyhow::Result<()> {
        let seed = hex::decode("000102030405060708090a0b0c0d0e0f")
            .map_err(|e| anyhow::anyhow!("hex decode failed: {}", e))?;
        let master = ExtendedPrivKey::from_seed(&seed, Network::Mainnet)?;
        assert_eq!(master.depth, 0);
        assert!(master.secret_key != [0u8; 32]);
        Ok(())
    }

    #[test]
    fn test_bip44_path_derivation() -> anyhow::Result<()> {
        let seed = b"HSMC test seed for BIP44 derivation path";
        let master = ExtendedPrivKey::from_seed(seed, Network::Mainnet)?;
        let path = DerivationPath::hsmc_account(0, 0, 0);
        let child = master.derive_path(&path)?;
        assert_eq!(child.depth, 5);
        let address = child.to_hsmc_address();
        assert!(address.starts_with("0x"));
        assert_eq!(address.len(), 42);
        Ok(())
    }

    #[test]
    fn test_path_parsing() -> anyhow::Result<()> {
        let path = DerivationPath::parse("m/44'/8888'/0'/0/0")?;
        assert_eq!(path.components.len(), 5);
        assert!(path.components[0].hardened);
        assert!(!path.components[3].hardened);
        assert_eq!(path.to_string(), "m/44'/8888'/0'/0/0");
        Ok(())
    }

    #[test]
    fn test_non_hardened_xpub_derivation() -> anyhow::Result<()> {
        let seed = b"test seed for xpub derivation HSMC";
        let master = ExtendedPrivKey::from_seed(seed, Network::Mainnet)?;
        let path = DerivationPath::parse("m/44'/8888'/0'")?;
        let account_key = master.derive_path(&path)?;
        let xpub = account_key.to_extended_pubkey();

        // Derive address 0 from xpub (non-hardened)
        let child_pub = xpub.derive_child(0)?.derive_child(0)?;
        let addr = child_pub.to_hsmc_address();
        assert!(addr.starts_with("0x"));
        Ok(())
    }

    #[test]
    fn test_hardened_from_public_fails() -> anyhow::Result<()> {
        let seed = b"test seed";
        let master = ExtendedPrivKey::from_seed(seed, Network::Mainnet)?;
        let xpub = master.to_extended_pubkey();
        let result = xpub.derive_child(HARDENED_OFFSET + 0);
        assert!(result.is_err());
        Ok(())
    }
}
