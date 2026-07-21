/// Peer discovery — DNS seed bootstrapping, peer exchange, address book
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};
use parking_lot::RwLock;
use std::sync::Arc;
use tracing::{info, warn, debug};
use sha2::{Digest, Sha256};
use crate::peer::{Peer, PeerRegistry};
use crate::message::PeerAddress;

// ─── DNS Seeds ────────────────────────────────────────────────────────────────

/// HSMC mainnet DNS seeds — resolver bootstraps initial peer list
pub const MAINNET_DNS_SEEDS: &[&str] = &[
    "seed.hsmc.network",
    "seed2.hsmc.network",
    "nodes.hsmc.io",
    "bootstrap.hsmc.org",
    "seed.hsmc.com",
];

pub const TESTNET_DNS_SEEDS: &[&str] = &[
    "testnet-seed.hsmc.network",
    "testnet.hsmc.io",
];

/// Well-known mainnet bootstrap nodes
pub const MAINNET_BOOTSTRAP_NODES: &[(&str, u16)] = &[
    ("bootstrap1.hsmc.network", 8080),
    ("bootstrap2.hsmc.network", 8080),
    ("node.hsmc.io", 8080),
];

// ─── Address Book ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AddressEntry {
    pub address: PeerAddress,
    pub source: AddressSource,
    pub times_tried: u32,
    pub times_connected: u32,
    pub last_tried: Option<Instant>,
    pub last_success: Option<Instant>,
    pub ban_score: u32,
    pub tried: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressSource {
    DnsSeed,
    PeerExchange,
    Bootstrap,
    Manual,
    InboundConnection,
}

impl AddressEntry {
    pub fn new(address: PeerAddress, source: AddressSource) -> Self {
        Self {
            address,
            source,
            times_tried: 0,
            times_connected: 0,
            last_tried: None,
            last_success: None,
            ban_score: 0,
            tried: false,
        }
    }

    /// Penalty score based on failed attempts
    pub fn penalty(&self) -> u64 {
        let base = self.times_tried as u64;
        let last_tried_secs = self.last_tried
            .map(|t| t.elapsed().as_secs())
            .unwrap_or(u64::MAX);

        // Exponential backoff for failed connections
        if last_tried_secs < 60 { 1_000_000 }
        else if last_tried_secs < 600 { 100_000 }
        else if last_tried_secs < 3600 { 10_000 }
        else { base }
    }

    pub fn is_good(&self) -> bool {
        self.ban_score < 100
            && self.times_tried < 20
            && self.last_tried.map(|t| t.elapsed().as_secs() > 60).unwrap_or(true)
    }
}

/// Trickling address manager — Bitcoin-style "tried" and "new" buckets
pub struct AddressBook {
    /// "new" table: freshly seen addresses, 1024 buckets × 64 slots
    new_table: HashMap<String, AddressEntry>,
    /// "tried" table: successfully connected addresses, 256 buckets × 64 slots
    tried_table: HashMap<String, AddressEntry>,
    /// Maximum addresses per table
    max_new: usize,
    max_tried: usize,
    /// Banned IPs (with ban time)
    banned: HashMap<String, Instant>,
    ban_duration: Duration,
}

impl AddressBook {
    pub fn new() -> Self {
        Self {
            new_table: HashMap::new(),
            tried_table: HashMap::new(),
            max_new: 65_536,
            max_tried: 16_384,
            banned: HashMap::new(),
            ban_duration: Duration::from_secs(24 * 3600),
        }
    }

    /// Add a new address (from peer exchange or DNS)
    pub fn add_new(&mut self, addr: PeerAddress, source: AddressSource) {
        let key = format!("{}:{}", addr.ip, addr.port);

        if self.is_banned(&addr.ip) { return; }
        if self.tried_table.contains_key(&key) { return; }

        if self.new_table.len() >= self.max_new {
            // Evict lowest-priority entry
            if let Some(worst_key) = self.find_worst_new() {
                self.new_table.remove(&worst_key);
            }
        }

        self.new_table.entry(key).or_insert_with(|| AddressEntry::new(addr, source));
    }

    /// Mark address as successfully connected
    pub fn mark_good(&mut self, ip: &str, port: u16) {
        let key = format!("{}:{}", ip, port);
        if let Some(entry) = self.new_table.remove(&key) {
            let mut tried_entry = entry;
            tried_entry.tried = true;
            tried_entry.times_connected += 1;
            tried_entry.last_success = Some(Instant::now());

            if self.tried_table.len() >= self.max_tried {
                if let Some(worst) = self.find_worst_tried() {
                    let evicted = self.tried_table.remove(&worst).unwrap();
                    // Move evicted back to new table
                    self.new_table.insert(worst, evicted);
                }
            }
            self.tried_table.insert(key, tried_entry);
        } else if let Some(entry) = self.tried_table.get_mut(&key) {
            entry.times_connected += 1;
            entry.last_success = Some(Instant::now());
        }
    }

    /// Mark connection attempt
    pub fn mark_attempt(&mut self, ip: &str, port: u16) {
        let key = format!("{}:{}", ip, port);
        for table in [&mut self.new_table, &mut self.tried_table] {
            if let Some(entry) = table.get_mut(&key) {
                entry.times_tried += 1;
                entry.last_tried = Some(Instant::now());
            }
        }
    }

    /// Select addresses to try connecting (prioritizes tried table)
    pub fn select_for_connection(&self, count: usize) -> Vec<PeerAddress> {
        let mut candidates: Vec<_> = self.tried_table.values()
            .filter(|e| e.is_good())
            .collect();
        candidates.sort_by_key(|e| e.penalty());

        let mut result: Vec<PeerAddress> = candidates.iter()
            .take(count)
            .map(|e| e.address.clone())
            .collect();

        // Fill remaining from new table
        if result.len() < count {
            let new_candidates: Vec<_> = self.new_table.values()
                .filter(|e| e.is_good())
                .take(count - result.len())
                .map(|e| e.address.clone())
                .collect();
            result.extend(new_candidates);
        }

        result
    }

    /// Get random addresses for peer exchange (avoiding banned/tried-too-many)
    pub fn get_for_addr_relay(&self, n: usize) -> Vec<PeerAddress> {
        use rand::seq::SliceRandom;
        let mut rng = rand::thread_rng();
        let mut all: Vec<_> = self.tried_table.values()
            .chain(self.new_table.values())
            .filter(|e| !self.is_banned(&e.address.ip) && e.ban_score < 50)
            .map(|e| e.address.clone())
            .collect();
        all.shuffle(&mut rng);
        all.into_iter().take(n).collect()
    }

    /// Ban an IP for misbehavior
    pub fn ban(&mut self, ip: &str) {
        warn!(ip, "Banning peer");
        self.banned.insert(ip.to_string(), Instant::now());
        // Remove from both tables
        self.new_table.retain(|_, e| e.address.ip != ip);
        self.tried_table.retain(|_, e| e.address.ip != ip);
    }

    pub fn is_banned(&self, ip: &str) -> bool {
        if let Some(&ban_time) = self.banned.get(ip) {
            if ban_time.elapsed() < self.ban_duration {
                return true;
            }
        }
        false
    }

    /// Increase ban score for an IP (ban if >= 100)
    pub fn add_ban_score(&mut self, ip: &str, port: u16, score: u32) {
        let key = format!("{}:{}", ip, port);
        let mut should_ban = false;
        for table in [&mut self.new_table, &mut self.tried_table] {
            if let Some(entry) = table.get_mut(&key) {
                entry.ban_score += score;
                if entry.ban_score >= 100 { should_ban = true; }
            }
        }
        if should_ban { self.ban(ip); }
    }

    pub fn total_addresses(&self) -> usize {
        self.new_table.len() + self.tried_table.len()
    }

    fn find_worst_new(&self) -> Option<String> {
        self.new_table.iter()
            .max_by_key(|(_, e)| e.penalty())
            .map(|(k, _)| k.clone())
    }

    fn find_worst_tried(&self) -> Option<String> {
        self.tried_table.iter()
            .max_by_key(|(_, e)| e.penalty())
            .map(|(k, _)| k.clone())
    }
}

impl Default for AddressBook {
    fn default() -> Self { Self::new() }
}

// ─── Discovery Service ────────────────────────────────────────────────────────

pub struct DiscoveryService {
    pub address_book: Arc<RwLock<AddressBook>>,
    pub peers: Arc<PeerRegistry>,
}

impl DiscoveryService {
    pub fn new(peers: Arc<PeerRegistry>) -> Self {
        Self {
            address_book: Arc::new(RwLock::new(AddressBook::new())),
            peers,
        }
    }

    /// Bootstrap from well-known nodes
    pub fn bootstrap_with_static_nodes(&self, testnet: bool) {
        let bootstrap_nodes = if testnet { TESTNET_DNS_SEEDS } else { &MAINNET_DNS_SEEDS[..] };
        let mut book = self.address_book.write();

        for host in bootstrap_nodes {
            book.add_new(PeerAddress {
                services: 0,
                ip: host.to_string(),
                port: 8080,
                last_seen: chrono::Utc::now().timestamp(),
            }, AddressSource::DnsSeed);
        }

        for (ip, port) in MAINNET_BOOTSTRAP_NODES {
            book.add_new(PeerAddress {
                services: 0,
                ip: ip.to_string(),
                port: *port,
                last_seen: chrono::Utc::now().timestamp(),
            }, AddressSource::Bootstrap);
        }

        info!(
            addresses = book.total_addresses(),
            "Address book bootstrapped"
        );
    }

    /// Add peer addresses received from a peer (ADDR message)
    pub fn add_peer_addresses(&self, addrs: Vec<PeerAddress>, source_ip: &str) {
        let mut book = self.address_book.write();
        let mut added = 0;
        for addr in addrs {
            if addr.ip != source_ip {
                book.add_new(addr, AddressSource::PeerExchange);
                added += 1;
            }
        }
        debug!(added, source = source_ip, "Added peer addresses");
    }

    /// Get addresses to connect to
    pub fn get_connection_candidates(&self, n: usize) -> Vec<PeerAddress> {
        self.address_book.read().select_for_connection(n)
    }

    /// Mark successful connection
    pub fn on_connected(&self, ip: &str, port: u16) {
        self.address_book.write().mark_good(ip, port);
    }

    /// Add ban score for misbehaving peer
    pub fn penalize_peer(&self, ip: &str, port: u16, score: u32, reason: &str) {
        warn!(ip, port, score, reason = reason, "Penalizing peer");
        self.address_book.write().add_ban_score(ip, port, score);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_addr(ip: &str, port: u16) -> PeerAddress {
        PeerAddress { services: 0, ip: ip.into(), port, last_seen: 0 }
    }

    #[test]
    fn test_address_book_lifecycle() {
        let mut book = AddressBook::new();
        book.add_new(make_addr("1.2.3.4", 8080), AddressSource::Bootstrap);
        assert_eq!(book.total_addresses(), 1);
        book.mark_good("1.2.3.4", 8080);
        assert_eq!(book.tried_table.len(), 1);
        assert_eq!(book.new_table.len(), 0);
    }

    #[test]
    fn test_ban_logic() {
        let mut book = AddressBook::new();
        book.add_new(make_addr("5.6.7.8", 8080), AddressSource::DnsSeed);
        book.ban("5.6.7.8");
        assert!(book.is_banned("5.6.7.8"));
        assert_eq!(book.total_addresses(), 0); // removed from tables
    }

    #[test]
    fn test_ban_score_accumulation() {
        let mut book = AddressBook::new();
        book.add_new(make_addr("9.10.11.12", 8080), AddressSource::PeerExchange);
        book.add_ban_score("9.10.11.12", 8080, 50);
        assert!(!book.is_banned("9.10.11.12")); // not yet at 100
        book.add_ban_score("9.10.11.12", 8080, 60);
        assert!(book.is_banned("9.10.11.12")); // banned now
    }
}
