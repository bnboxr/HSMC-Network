/// HD Wallet — BIP32/44/39 derivation, UTXO management, coin selection,
/// fee estimation, address pool, watch-only support, multi-sig descriptors
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha512};
use sha3::Keccak256;
use hmac::{Hmac, Mac};
use std::collections::{HashMap, BTreeMap, HashSet};
use chrono::Utc;

type HmacSha512 = Hmac<Sha512>;
type HmacSha256 = Hmac<Sha256>;

// ─────────────────────────────────────────────────────────────────────────────
// HSMC Address
// ─────────────────────────────────────────────────────────────────────────────

/// HSMC address: "HSMC" + 40 lowercase hex chars = 44 chars
/// Derivation: SHA3-256(domain || pubkey_bytes)[0..20] → hex
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Address(pub String);

impl Address {
    pub const PREFIX: &'static str = "HSMC";
    pub const LENGTH: usize = 44;
    pub const HEX_LENGTH: usize = 40;

    /// Derive address from 32-byte compressed public key
    pub fn from_pubkey_bytes(pubkey_bytes: &[u8]) -> Self {
        let mut hasher = Keccak256::new();
        hasher.update(b"HSMC_ADDR_V2_");
        hasher.update(pubkey_bytes);
        let hash = hasher.finalize();
        // Last 20 bytes → checksum prefix
        let hex = hex::encode(&hash[12..32]);
        Address(format!("{}{}", Self::PREFIX, hex))
    }

    /// Generate from entropy (for testing only)
    pub fn from_entropy(entropy: &[u8]) -> Self {
        let mut h = Sha256::new();
        h.update(b"HSMC_ENTROPY_ADDR_");
        h.update(entropy);
        let hash = h.finalize();
        Address(format!("{}{}", Self::PREFIX, hex::encode(&hash[..20])))
    }

    pub fn as_str(&self) -> &str { &self.0 }

    pub fn is_valid(addr: &str) -> bool {
        addr.starts_with(Self::PREFIX)
            && addr.len() == Self::LENGTH
            && addr[4..].bytes().all(|b| b.is_ascii_hexdigit())
    }

    /// Checksum-verified equality (case-insensitive hex part)
    pub fn normalized(&self) -> String {
        format!("{}{}", Self::PREFIX, self.0[4..].to_lowercase())
    }

    pub fn zero() -> Self {
        Address(format!("{}{}", Self::PREFIX, "0".repeat(Self::HEX_LENGTH)))
    }

    pub fn is_zero(&self) -> bool {
        self.0 == Self::zero().0
    }

    /// EIP-55 style mixed-case checksum for HSMC addresses
    pub fn checksummed(&self) -> String {
        let hex_part = &self.0[4..];
        let mut h = Keccak256::new();
        h.update(hex_part.as_bytes());
        let hash = h.finalize();
        let mut out = Self::PREFIX.to_string();
        for (i, c) in hex_part.chars().enumerate() {
            if c.is_ascii_digit() {
                out.push(c);
            } else {
                let byte = hash[i / 2];
                let nibble_bit = if i % 2 == 0 { byte >> 4 } else { byte & 0x0f };
                if nibble_bit >= 8 {
                    out.push(c.to_ascii_uppercase());
                } else {
                    out.push(c.to_ascii_lowercase());
                }
            }
        }
        out
    }
}

impl std::fmt::Display for Address {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.checksummed())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// BIP32 Extended Key
// ─────────────────────────────────────────────────────────────────────────────

/// Extended key node: (key, chain_code, depth, index, fingerprint)
#[derive(Clone)]
pub struct ExtendedKey {
    pub key:         [u8; 32],
    pub chain_code:  [u8; 32],
    pub depth:       u8,
    pub index:       u32,
    pub parent_fp:   [u8; 4], // parent fingerprint
}

impl ExtendedKey {
    /// Derive child at index (hardened if index >= 0x8000_0000)
    pub fn derive_child(&self, index: u32) -> Result<Self, WalletError> {
        let mut mac = HmacSha512::new_from_slice(&self.chain_code)
            .map_err(|_| WalletError::CryptoError("HMAC init failed".into()))?;

        if index >= 0x8000_0000 {
            // Hardened: HMAC(0x00 || key || index)
            mac.update(&[0x00]);
            mac.update(&self.key);
        } else {
            // Normal: HMAC(pubkey || index) — simplified: use key
            mac.update(&self.key);
        }
        mac.update(&index.to_be_bytes());

        let result = mac.finalize().into_bytes();
        let mut child_key   = [0u8; 32];
        let mut child_code  = [0u8; 32];
        child_key.copy_from_slice(&result[..32]);
        child_code.copy_from_slice(&result[32..]);

        // Child key = (parent_key + IL) mod curve_order (simplified: XOR for now)
        // In production: use secp256k1::SecretKey::tweak_add
        for (ck, pk) in child_key.iter_mut().zip(self.key.iter()) {
            *ck = ck.wrapping_add(*pk);
        }

        // Fingerprint = HASH160(parent_pubkey)[0..4]
        let parent_fp = {
            let mut h = Sha256::new();
            h.update(b"pubkey_fp_");
            h.update(&self.key);
            let hash = h.finalize();
            [hash[0], hash[1], hash[2], hash[3]]
        };

        if child_key.iter().all(|&b| b == 0) {
            return Err(WalletError::CryptoError("Derived zero child key".into()));
        }

        Ok(ExtendedKey {
            key:       child_key,
            chain_code: child_code,
            depth:     self.depth.saturating_add(1),
            index,
            parent_fp,
        })
    }

    /// Derive address for this extended key
    pub fn to_address(&self) -> Address {
        Address::from_pubkey_bytes(&self.key)
    }

    /// Serialize to BIP32 xpub string (simplified)
    pub fn to_xpub_string(&self) -> String {
        let mut data = Vec::with_capacity(78);
        data.extend_from_slice(&[0x04, 0x88, 0xB2, 0x1E]); // mainnet xpub version
        data.push(self.depth);
        data.extend_from_slice(&self.parent_fp);
        data.extend_from_slice(&self.index.to_be_bytes());
        data.extend_from_slice(&self.chain_code);
        data.push(0x02); // compressed pubkey prefix
        data.extend_from_slice(&self.key);
        bs58_check_encode(&data)
    }
}

fn bs58_check_encode(data: &[u8]) -> String {
    // Double-SHA256 checksum
    let mut h1 = Sha256::new();
    h1.update(data);
    let h1 = h1.finalize();
    let mut h2 = Sha256::new();
    h2.update(h1);
    let checksum = h2.finalize();
    let mut full = data.to_vec();
    full.extend_from_slice(&checksum[..4]);
    bs58_encode(&full)
}

fn bs58_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut n = num_bigint_from_bytes(bytes);
    let mut chars = Vec::new();
    let base = 58u128;
    while n > 0 {
        let rem = (n % base) as usize;
        chars.push(ALPHABET[rem]);
        n /= base;
    }
    // Leading zero bytes → '1'
    for &b in bytes {
        if b == 0 { chars.push(b'1'); } else { break; }
    }
    chars.reverse();
    String::from_utf8(chars).unwrap_or_default()
}

fn num_bigint_from_bytes(bytes: &[u8]) -> u128 {
    let mut n = 0u128;
    for &b in bytes.iter().take(16) {
        n = n.wrapping_shl(8).wrapping_add(b as u128);
    }
    n
}

// ─────────────────────────────────────────────────────────────────────────────
// HD Wallet (BIP44: m/44'/8888'/account'/change/index)
// ─────────────────────────────────────────────────────────────────────────────

pub const COIN_TYPE_HSMC: u32 = 8888;

#[derive(Debug, Clone)]
pub enum WalletError {
    SeedTooShort { len: usize, min: usize },
    CryptoError(String),
    InvalidIndex(u32),
    DerivationFailed(String),
    InsufficientBalance { needed: f64, available: f64 },
    NoUTXOs,
    InvalidAddress(String),
}

impl std::fmt::Display for WalletError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SeedTooShort { len, min } =>
                write!(f, "Seed too short: {} bytes (min {})", len, min),
            Self::CryptoError(m)          => write!(f, "Crypto error: {}", m),
            Self::InvalidIndex(i)         => write!(f, "Invalid derivation index: {}", i),
            Self::DerivationFailed(m)     => write!(f, "Derivation failed: {}", m),
            Self::InsufficientBalance { needed, available } =>
                write!(f, "Insufficient balance: need {:.8}, have {:.8}", needed, available),
            Self::NoUTXOs                 => write!(f, "No spendable UTXOs available"),
            Self::InvalidAddress(a)       => write!(f, "Invalid address: {}", a),
        }
    }
}

pub struct HdWallet {
    pub master:      ExtendedKey,
    pub coin_type:   u32,
    pub network:     Network,
    /// Address pool cache: path → (address, pubkey_bytes)
    address_pool:    HashMap<String, (Address, [u8; 32])>,
    /// Watch-only xpubs registered for scanning
    watch_xpubs:     Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Network {
    Mainnet,
    Testnet,
}

impl HdWallet {
    /// Create wallet from BIP39 seed (64 bytes from mnemonic + passphrase)
    pub fn from_seed(seed: &[u8], network: Network) -> Result<Self, WalletError> {
        if seed.len() < 16 {
            return Err(WalletError::SeedTooShort { len: seed.len(), min: 16 });
        }
        let mut mac = HmacSha512::new_from_slice(b"HSMC seed v2")
            .map_err(|e| WalletError::CryptoError(e.to_string()))?;
        mac.update(seed);
        let result = mac.finalize().into_bytes();

        let mut key  = [0u8; 32];
        let mut code = [0u8; 32];
        key.copy_from_slice(&result[..32]);
        code.copy_from_slice(&result[32..]);

        if key.iter().all(|&b| b == 0) {
            return Err(WalletError::CryptoError("Derived zero master key".into()));
        }

        Ok(Self {
            master: ExtendedKey { key, chain_code: code, depth: 0, index: 0, parent_fp: [0u8; 4] },
            coin_type: COIN_TYPE_HSMC,
            network,
            address_pool: HashMap::new(),
            watch_xpubs: Vec::new(),
        })
    }

    /// Derive at full BIP44 path: m/44'/coin'/account'/change/index
    pub fn derive_path(
        &self,
        account: u32,
        change: u32,  // 0 = external, 1 = internal (change)
        index: u32,
    ) -> Result<ExtendedKey, WalletError> {
        // m/44'
        let k44 = self.master.derive_child(44 | 0x8000_0000)?;
        // m/44'/8888'
        let kct = k44.derive_child(self.coin_type | 0x8000_0000)?;
        // m/44'/8888'/account'
        let kacc = kct.derive_child(account | 0x8000_0000)?;
        // m/44'/8888'/account'/change
        let kch = kacc.derive_child(change)?;
        // m/44'/8888'/account'/change/index
        let kidx = kch.derive_child(index)?;
        Ok(kidx)
    }

    /// Get or derive address at account/change/index (with caching)
    pub fn address_at(
        &mut self,
        account: u32,
        change: u32,
        index: u32,
    ) -> Result<Address, WalletError> {
        let path = format!("m/44'/{}'/{}'/{}/{}", self.coin_type, account, change, index);
        if let Some((addr, _)) = self.address_pool.get(&path) {
            return Ok(addr.clone());
        }
        let key = self.derive_path(account, change, index)?;
        let addr = key.to_address();
        self.address_pool.insert(path, (addr.clone(), key.key));
        Ok(addr)
    }

    /// Pre-generate a range of addresses for gap limit scanning
    pub fn generate_address_pool(
        &mut self,
        account: u32,
        gap_limit: u32,
    ) -> Result<Vec<Address>, WalletError> {
        let mut addrs = Vec::with_capacity(gap_limit as usize * 2);
        for i in 0..gap_limit {
            addrs.push(self.address_at(account, 0, i)?); // external
            addrs.push(self.address_at(account, 1, i)?); // internal/change
        }
        Ok(addrs)
    }

    /// Export xpub for account (watch-only wallet support)
    pub fn account_xpub(&self, account: u32) -> Result<String, WalletError> {
        let k44 = self.master.derive_child(44 | 0x8000_0000)?;
        let kct = k44.derive_child(self.coin_type | 0x8000_0000)?;
        let kacc = kct.derive_child(account | 0x8000_0000)?;
        Ok(kacc.to_xpub_string())
    }

    /// Add watch-only xpub
    pub fn add_watch_xpub(&mut self, xpub: String) {
        self.watch_xpubs.push(xpub);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTXO model
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum UtxoStatus {
    Unspent,
    Pending,   // in mempool spending tx
    Spent { tx_hash: String, block_height: u64 },
    Immature,  // coinbase UTXO < 100 confirmations
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Utxo {
    pub tx_hash:      String,
    pub output_index: u32,
    pub amount:       f64,
    pub address:      Address,
    pub block_height: u64,
    pub status:       UtxoStatus,
    pub script_type:  ScriptType,
    pub created_at:   i64,
    /// For RingCT: Pedersen commitment bytes
    pub commitment:   Option<[u8; 32]>,
    /// Whether this is a coinbase output
    pub is_coinbase:  bool,
}

impl Utxo {
    pub fn new(
        tx_hash: String,
        output_index: u32,
        amount: f64,
        address: Address,
        block_height: u64,
    ) -> Self {
        Self {
            tx_hash,
            output_index,
            amount,
            address,
            block_height,
            status: UtxoStatus::Unspent,
            script_type: ScriptType::P2PKH,
            created_at: Utc::now().timestamp(),
            commitment: None,
            is_coinbase: false,
        }
    }

    pub fn key(&self) -> String {
        format!("{}:{}", self.tx_hash, self.output_index)
    }

    pub fn is_spendable(&self, current_height: u64) -> bool {
        match &self.status {
            UtxoStatus::Unspent => {
                if self.is_coinbase {
                    current_height >= self.block_height + 100
                } else {
                    true
                }
            }
            UtxoStatus::Immature => false,
            _ => false,
        }
    }

    pub fn confirmations(&self, current_height: u64) -> u64 {
        if current_height >= self.block_height {
            current_height - self.block_height + 1
        } else {
            0
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ScriptType {
    P2PKH,       // Pay-to-Public-Key-Hash
    P2SH,        // Pay-to-Script-Hash
    Stealth,     // Monero-style stealth address
    RingCT,      // Confidential output
    MultiSig,    // m-of-n multisig
}

// ─────────────────────────────────────────────────────────────────────────────
// UTXO Set with Dual Indexing
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct UtxoSet {
    /// Primary index: "txhash:idx" → Utxo
    utxos:       HashMap<String, Utxo>,
    /// Address index: address → set of utxo keys
    by_address:  HashMap<Address, HashSet<String>>,
    /// Block index: block_height → set of utxo keys
    by_block:    BTreeMap<u64, HashSet<String>>,
    /// Total transparent supply (non-confidential UTXOs)
    pub total_transparent_supply: f64,
    /// Key image set for double-spend detection
    key_images:  HashSet<String>,
}

impl UtxoSet {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, utxo: Utxo) {
        let key = utxo.key();
        if utxo.commitment.is_none() {
            self.total_transparent_supply += utxo.amount;
        }
        self.by_address
            .entry(utxo.address.clone())
            .or_default()
            .insert(key.clone());
        self.by_block
            .entry(utxo.block_height)
            .or_default()
            .insert(key.clone());
        self.utxos.insert(key, utxo);
    }

    pub fn spend(&mut self, tx_hash: &str, output_index: u32) -> Option<Utxo> {
        let key = format!("{}:{}", tx_hash, output_index);
        if let Some(u) = self.utxos.remove(&key) {
            if let Some(addr_set) = self.by_address.get_mut(&u.address) {
                addr_set.remove(&key);
                if addr_set.is_empty() {
                    self.by_address.remove(&u.address);
                }
            }
            if u.commitment.is_none() {
                self.total_transparent_supply -= u.amount;
            }
            return Some(u);
        }
        None
    }

    /// Mark a UTXO as pending (in a mempool tx)
    pub fn mark_pending(&mut self, tx_hash: &str, output_index: u32) -> bool {
        let key = format!("{}:{}", tx_hash, output_index);
        if let Some(u) = self.utxos.get_mut(&key) {
            u.status = UtxoStatus::Pending;
            return true;
        }
        false
    }

    /// Unmark pending (if tx removed from mempool)
    pub fn unmark_pending(&mut self, tx_hash: &str, output_index: u32) -> bool {
        let key = format!("{}:{}", tx_hash, output_index);
        if let Some(u) = self.utxos.get_mut(&key) {
            if u.status == UtxoStatus::Pending {
                u.status = UtxoStatus::Unspent;
                return true;
            }
        }
        false
    }

    pub fn get(&self, tx_hash: &str, output_index: u32) -> Option<&Utxo> {
        let key = format!("{}:{}", tx_hash, output_index);
        self.utxos.get(&key)
    }

    pub fn exists(&self, tx_hash: &str, output_index: u32) -> bool {
        let key = format!("{}:{}", tx_hash, output_index);
        self.utxos.contains_key(&key)
    }

    /// Balance of an address: sum of all unspent UTXOs
    pub fn balance_of(&self, address: &Address) -> f64 {
        self.by_address
            .get(address)
            .map(|keys| {
                keys.iter()
                    .filter_map(|k| self.utxos.get(k))
                    .filter(|u| u.status == UtxoStatus::Unspent)
                    .map(|u| u.amount)
                    .sum()
            })
            .unwrap_or(0.0)
    }

    /// Spendable balance (excludes immature coinbase, pending)
    pub fn spendable_balance_of(&self, address: &Address, current_height: u64) -> f64 {
        self.by_address
            .get(address)
            .map(|keys| {
                keys.iter()
                    .filter_map(|k| self.utxos.get(k))
                    .filter(|u| u.is_spendable(current_height))
                    .map(|u| u.amount)
                    .sum()
            })
            .unwrap_or(0.0)
    }

    /// All spendable UTXOs for an address, sorted by amount descending
    pub fn spendable_utxos_for(&self, address: &Address, current_height: u64) -> Vec<&Utxo> {
        let mut utxos: Vec<&Utxo> = self.by_address
            .get(address)
            .map(|keys| {
                keys.iter()
                    .filter_map(|k| self.utxos.get(k))
                    .filter(|u| u.is_spendable(current_height))
                    .collect()
            })
            .unwrap_or_default();
        utxos.sort_by(|a, b| b.amount.partial_cmp(&a.amount).unwrap());
        utxos
    }

    pub fn total_supply(&self) -> f64 {
        self.utxos.values()
            .filter(|u| u.status == UtxoStatus::Unspent && u.commitment.is_none())
            .map(|u| u.amount)
            .sum()
    }

    pub fn count(&self) -> usize { self.utxos.len() }

    pub fn address_count(&self) -> usize { self.by_address.len() }

    /// Register a key image to detect double spends
    pub fn register_key_image(&mut self, key_image: String) -> bool {
        self.key_images.insert(key_image)
    }

    pub fn has_key_image(&self, key_image: &str) -> bool {
        self.key_images.contains(key_image)
    }

    /// Rollback all UTXOs added at a specific block height (for reorgs)
    pub fn rollback_block(&mut self, block_height: u64) -> Vec<Utxo> {
        let keys: Vec<String> = self.by_block
            .remove(&block_height)
            .unwrap_or_default()
            .into_iter()
            .collect();
        let mut removed = Vec::new();
        for key in keys {
            if let Some(utxo) = self.utxos.remove(&key) {
                if let Some(addr_set) = self.by_address.get_mut(&utxo.address) {
                    addr_set.remove(&key);
                }
                if utxo.commitment.is_none() {
                    self.total_transparent_supply -= utxo.amount;
                }
                removed.push(utxo);
            }
        }
        removed
    }

    /// Compact: remove spent UTXOs older than `before_height` blocks
    pub fn compact(&mut self, before_height: u64, current_height: u64) -> usize {
        // Identify UTXOs in old blocks
        let old_blocks: Vec<u64> = self.by_block.keys()
            .filter(|&&h| h < before_height)
            .copied()
            .collect();
        let mut removed = 0;
        for bh in old_blocks {
            if let Some(keys) = self.by_block.remove(&bh) {
                for key in keys {
                    // Only remove if spent (confirmed)
                    if let Some(u) = self.utxos.get(&key) {
                        if u.status == UtxoStatus::Unspent {
                            continue; // keep unspent even if old
                        }
                    }
                    self.utxos.remove(&key);
                    removed += 1;
                }
            }
        }
        removed
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coin Selection Algorithms
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct CoinSelectionResult {
    pub selected:      Vec<Utxo>,
    pub total_input:   f64,
    pub change_amount: f64,
    pub fee:           f64,
    pub algorithm:     CoinSelectionAlgo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoinSelectionAlgo {
    /// Largest-first (minimal UTXO count, poor privacy)
    LargestFirst,
    /// Smallest-first (UTXO consolidation)
    SmallestFirst,
    /// Branch-and-Bound (exact match, BIP141)
    BranchAndBound,
    /// Single Random Draw (best privacy)
    SingleRandomDraw,
    /// Knapsack solver (minimize waste)
    Knapsack,
}

pub struct CoinSelector;

impl CoinSelector {
    /// Select UTXOs using the specified algorithm
    pub fn select(
        available: &[Utxo],
        target: f64,
        fee_per_utxo: f64,
        algorithm: CoinSelectionAlgo,
    ) -> Result<CoinSelectionResult, WalletError> {
        if available.is_empty() {
            return Err(WalletError::NoUTXOs);
        }
        let total_available: f64 = available.iter().map(|u| u.amount).sum();
        if total_available < target {
            return Err(WalletError::InsufficientBalance {
                needed: target,
                available: total_available,
            });
        }

        match algorithm {
            CoinSelectionAlgo::LargestFirst => Self::largest_first(available, target, fee_per_utxo),
            CoinSelectionAlgo::SmallestFirst => Self::smallest_first(available, target, fee_per_utxo),
            CoinSelectionAlgo::BranchAndBound => Self::branch_and_bound(available, target, fee_per_utxo),
            CoinSelectionAlgo::SingleRandomDraw => Self::single_random_draw(available, target, fee_per_utxo),
            CoinSelectionAlgo::Knapsack => Self::knapsack(available, target, fee_per_utxo),
        }
    }

    fn largest_first(
        available: &[Utxo],
        target: f64,
        fee_per_utxo: f64,
    ) -> Result<CoinSelectionResult, WalletError> {
        let mut sorted = available.to_vec();
        sorted.sort_by(|a, b| b.amount.partial_cmp(&a.amount).unwrap());
        Self::accumulate(sorted, target, fee_per_utxo, CoinSelectionAlgo::LargestFirst)
    }

    fn smallest_first(
        available: &[Utxo],
        target: f64,
        fee_per_utxo: f64,
    ) -> Result<CoinSelectionResult, WalletError> {
        let mut sorted = available.to_vec();
        sorted.sort_by(|a, b| a.amount.partial_cmp(&b.amount).unwrap());
        Self::accumulate(sorted, target, fee_per_utxo, CoinSelectionAlgo::SmallestFirst)
    }

    fn branch_and_bound(
        available: &[Utxo],
        target: f64,
        fee_per_utxo: f64,
    ) -> Result<CoinSelectionResult, WalletError> {
        // BnB: find exact match within 0.0001 HSMC tolerance
        let tolerance = 0.0001;
        let n = available.len().min(20); // limit search space
        let coins = &available[..n];

        // Exhaustive search for small sets
        for mask in 0u32..(1u32 << n) {
            let mut selected = Vec::new();
            let mut total = 0.0f64;
            for i in 0..n {
                if mask & (1 << i) != 0 {
                    selected.push(coins[i].clone());
                    total += coins[i].amount;
                }
            }
            let fee = selected.len() as f64 * fee_per_utxo;
            if (total - target - fee).abs() < tolerance {
                let change = total - target - fee;
                return Ok(CoinSelectionResult {
                    selected,
                    total_input: total,
                    change_amount: change.max(0.0),
                    fee,
                    algorithm: CoinSelectionAlgo::BranchAndBound,
                });
            }
        }
        // Fallback to largest-first if no exact match
        Self::largest_first(available, target, fee_per_utxo)
    }

    fn single_random_draw(
        available: &[Utxo],
        target: f64,
        fee_per_utxo: f64,
    ) -> Result<CoinSelectionResult, WalletError> {
        // Shuffle using deterministic seed from target amount
        let mut indices: Vec<usize> = (0..available.len()).collect();
        // Simple Fisher-Yates with deterministic seed
        let seed = (target * 1e8) as u64;
        let mut rng_state = seed;
        for i in (1..indices.len()).rev() {
            rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let j = (rng_state >> 33) as usize % (i + 1);
            indices.swap(i, j);
        }
        let shuffled: Vec<Utxo> = indices.iter().map(|&i| available[i].clone()).collect();
        Self::accumulate(shuffled, target, fee_per_utxo, CoinSelectionAlgo::SingleRandomDraw)
    }

    fn knapsack(
        available: &[Utxo],
        target: f64,
        fee_per_utxo: f64,
    ) -> Result<CoinSelectionResult, WalletError> {
        // Minimize waste: prefer UTXOs closest to target
        let mut sorted = available.to_vec();
        sorted.sort_by(|a, b| {
            let da = (a.amount - target).abs();
            let db = (b.amount - target).abs();
            da.partial_cmp(&db).unwrap()
        });
        Self::accumulate(sorted, target, fee_per_utxo, CoinSelectionAlgo::Knapsack)
    }

    fn accumulate(
        sorted: Vec<Utxo>,
        target: f64,
        fee_per_utxo: f64,
        algo: CoinSelectionAlgo,
    ) -> Result<CoinSelectionResult, WalletError> {
        let mut selected = Vec::new();
        let mut total = 0.0f64;
        for utxo in sorted {
            let fee_so_far = (selected.len() + 1) as f64 * fee_per_utxo;
            selected.push(utxo.clone());
            total += utxo.amount;
            if total >= target + fee_so_far {
                let fee = selected.len() as f64 * fee_per_utxo;
                let change = total - target - fee;
                return Ok(CoinSelectionResult {
                    selected,
                    total_input: total,
                    change_amount: change.max(0.0),
                    fee,
                    algorithm: algo,
                });
            }
        }
        Err(WalletError::InsufficientBalance { needed: target, available: total })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee Calculator
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct FeeEstimate {
    pub slow:      f64, // ~60 min confirmation
    pub normal:    f64, // ~10 min confirmation
    pub fast:      f64, // ~2 min confirmation
    pub instant:   f64, // next block
    pub per_byte:  f64,
}

pub struct FeeCalculator {
    /// Mempool congestion factor [0.0, 1.0]
    pub congestion: f64,
    /// Base fee rate in HSMC per byte
    pub base_rate:  f64,
}

impl FeeCalculator {
    pub const BASE_FEE_PER_BYTE: f64 = 0.000_001; // 1 satoshi per byte
    pub const TRANSPARENT_TX_SIZE: usize   = 250;   // typical bytes
    pub const RINGCT_TX_SIZE: usize        = 2_500;
    pub const STEALTH_TX_SIZE: usize       = 1_200;
    pub const FULL_PRIVACY_TX_SIZE: usize  = 5_000;

    pub fn new(congestion: f64) -> Self {
        Self {
            congestion: congestion.clamp(0.0, 1.0),
            base_rate: Self::BASE_FEE_PER_BYTE,
        }
    }

    pub fn estimate(&self, tx_size_bytes: usize, privacy: &crate::PrivacyLevel) -> FeeEstimate {
        let size = tx_size_bytes as f64;
        let privacy_mult = Self::privacy_multiplier(privacy);
        let base = self.base_rate * size * privacy_mult;
        let cong = 1.0 + self.congestion * 4.0; // 1x–5x

        let min_fee = crate::Transaction::min_fee_for_privacy(privacy);

        FeeEstimate {
            slow:    (base * 0.5  * cong).max(min_fee),
            normal:  (base * 1.0  * cong).max(min_fee * 1.5),
            fast:    (base * 2.0  * cong).max(min_fee * 2.0),
            instant: (base * 5.0  * cong).max(min_fee * 5.0),
            per_byte: self.base_rate * privacy_mult * cong,
        }
    }

    fn privacy_multiplier(privacy: &crate::PrivacyLevel) -> f64 {
        match privacy {
            crate::PrivacyLevel::Transparent => 1.0,
            crate::PrivacyLevel::RingCt       => 10.0,
            crate::PrivacyLevel::Stealth      => 20.0,
            crate::PrivacyLevel::Full         => 50.0,
        }
    }

    /// Estimate fee for a given coin selection result
    pub fn fee_for_selection(
        &self,
        input_count: usize,
        output_count: usize,
        privacy: &crate::PrivacyLevel,
        has_change: bool,
    ) -> f64 {
        let base_size = 10; // version + locktime
        let input_size = match privacy {
            crate::PrivacyLevel::Transparent => 148,
            crate::PrivacyLevel::RingCt       => 500,
            crate::PrivacyLevel::Stealth      => 250,
            crate::PrivacyLevel::Full         => 1000,
        };
        let output_size = match privacy {
            crate::PrivacyLevel::Transparent => 34,
            crate::PrivacyLevel::RingCt       => 64,
            crate::PrivacyLevel::Stealth      => 64,
            crate::PrivacyLevel::Full         => 128,
        };
        let total_size = base_size
            + input_count * input_size
            + output_count * output_size
            + if has_change { output_size } else { 0 };

        let est = self.estimate(total_size, privacy);
        est.normal
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-sig Descriptor
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiSigDescriptor {
    pub threshold:   usize,       // m
    pub pubkeys:     Vec<String>, // n compressed pubkeys (hex)
    pub script_hash: String,      // P2SH address
    pub created_at:  i64,
}

impl MultiSigDescriptor {
    /// Create m-of-n multisig descriptor
    pub fn new(threshold: usize, pubkeys: Vec<String>) -> Result<Self, WalletError> {
        let n = pubkeys.len();
        if threshold == 0 || threshold > n {
            return Err(WalletError::CryptoError(
                format!("Invalid threshold {}/{}", threshold, n)
            ));
        }
        if n > 15 {
            return Err(WalletError::CryptoError("Max 15 signers in multisig".into()));
        }
        // Build redeem script: OP_m [pubkeys...] OP_n OP_CHECKMULTISIG
        let mut script = Vec::new();
        script.push(0x50 + threshold as u8); // OP_m
        for pk in &pubkeys {
            let bytes = hex::decode(pk).unwrap_or_default();
            script.push(bytes.len() as u8);
            script.extend_from_slice(&bytes);
        }
        script.push(0x50 + n as u8); // OP_n
        script.push(0xAE); // OP_CHECKMULTISIG

        // P2SH: HSMC + HASH160(script)
        let mut h1 = Sha256::new();
        h1.update(&script);
        let h1 = h1.finalize();
        let mut h2 = Keccak256::new();
        h2.update(h1);
        let hash = h2.finalize();
        let script_hash = format!("HSMC{}", hex::encode(&hash[12..32]));

        Ok(Self {
            threshold,
            pubkeys,
            script_hash,
            created_at: Utc::now().timestamp(),
        })
    }

    pub fn address(&self) -> Address {
        Address(self.script_hash.clone())
    }

    pub fn description(&self) -> String {
        format!("{}-of-{} multisig", self.threshold, self.pubkeys.len())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_address_format() {
        let addr = Address::from_pubkey_bytes(&[1u8; 32]);
        assert!(Address::is_valid(addr.as_str()));
        assert_eq!(addr.as_str().len(), Address::LENGTH);
        assert!(addr.as_str().starts_with("HSMC"));
    }

    #[test]
    fn test_hd_wallet_derivation_deterministic() {
        let seed = [0x42u8; 64];
        let mut w1 = HdWallet::from_seed(&seed, Network::Mainnet).unwrap();
        let mut w2 = HdWallet::from_seed(&seed, Network::Mainnet).unwrap();
        let addr1 = w1.address_at(0, 0, 0).unwrap();
        let addr2 = w2.address_at(0, 0, 0).unwrap();
        assert_eq!(addr1, addr2, "Same seed must produce same address");
    }

    #[test]
    fn test_different_indices_produce_different_addresses() {
        let seed = [0x11u8; 64];
        let mut wallet = HdWallet::from_seed(&seed, Network::Mainnet).unwrap();
        let a0 = wallet.address_at(0, 0, 0).unwrap();
        let a1 = wallet.address_at(0, 0, 1).unwrap();
        let a2 = wallet.address_at(0, 1, 0).unwrap(); // change
        assert_ne!(a0, a1, "Different indices must differ");
        assert_ne!(a0, a2, "External vs internal must differ");
    }

    #[test]
    fn test_utxo_set_balance() {
        let mut set = UtxoSet::new();
        let addr = Address::from_pubkey_bytes(&[9u8; 32]);
        set.add(Utxo::new("tx1".into(), 0, 10.0, addr.clone(), 1));
        set.add(Utxo::new("tx2".into(), 0, 5.0,  addr.clone(), 2));
        assert_eq!(set.balance_of(&addr), 15.0);
        set.spend("tx1", 0);
        assert_eq!(set.balance_of(&addr), 5.0);
    }

    #[test]
    fn test_utxo_set_rollback() {
        let mut set = UtxoSet::new();
        let addr = Address::from_pubkey_bytes(&[7u8; 32]);
        set.add(Utxo::new("tx1".into(), 0, 10.0, addr.clone(), 100));
        set.add(Utxo::new("tx2".into(), 0, 5.0,  addr.clone(), 101));
        let removed = set.rollback_block(101);
        assert_eq!(removed.len(), 1);
        assert_eq!(set.balance_of(&addr), 10.0);
    }

    #[test]
    fn test_coin_selection_largest_first() {
        let addr = Address::from_pubkey_bytes(&[3u8; 32]);
        let utxos: Vec<Utxo> = (1..=5)
            .map(|i| Utxo::new(format!("tx{}", i), 0, i as f64, addr.clone(), i as u64))
            .collect();
        let result = CoinSelector::select(&utxos, 3.0, 0.01, CoinSelectionAlgo::LargestFirst).unwrap();
        assert!(result.total_input >= 3.0);
        assert_eq!(result.algorithm, CoinSelectionAlgo::LargestFirst);
    }

    #[test]
    fn test_multisig_descriptor() {
        let keys = vec![
            hex::encode([1u8; 33]),
            hex::encode([2u8; 33]),
            hex::encode([3u8; 33]),
        ];
        let desc = MultiSigDescriptor::new(2, keys).unwrap();
        assert_eq!(desc.threshold, 2);
        assert!(Address::is_valid(&desc.script_hash));
    }

    #[test]
    fn test_address_pool_generation() {
        let seed = [0xABu8; 64];
        let mut wallet = HdWallet::from_seed(&seed, Network::Mainnet).unwrap();
        let pool = wallet.generate_address_pool(0, 5).unwrap();
        assert_eq!(pool.len(), 10); // 5 external + 5 internal
        // All addresses must be valid and unique
        let unique: HashSet<_> = pool.iter().map(|a| a.as_str().to_string()).collect();
        assert_eq!(unique.len(), 10);
    }

    #[test]
    fn test_fee_calculator() {
        let calc = FeeCalculator::new(0.5); // 50% congestion
        let est = calc.estimate(FeeCalculator::TRANSPARENT_TX_SIZE, &crate::PrivacyLevel::Transparent);
        assert!(est.fast > est.normal, "Fast must cost more than normal");
        assert!(est.normal > est.slow, "Normal must cost more than slow");
        let est_ring = calc.estimate(FeeCalculator::RINGCT_TX_SIZE, &crate::PrivacyLevel::RingCt);
        assert!(est_ring.normal > est.normal, "RingCT must cost more than transparent");
    }
}
