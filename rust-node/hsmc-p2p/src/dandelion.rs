/// Dandelion++ — full stem/fluff routing with anonymity set tracking
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::RwLock;
use rand::Rng;
use tracing::{info, debug, warn};
use crate::PeerRegistry;

pub const STEM_HOPS_MIN: u8 = 5;
pub const STEM_HOPS_MAX: u8 = 15;
pub const FLUFF_PROBABILITY: f64 = 0.1;
pub const STEM_TIMEOUT_SECS: u64 = 30;
pub const DIFFUSION_DELAY_MS: u64 = 100;

#[derive(Debug, Clone)]
pub enum DandelionPhase { Stem { hops_remaining: u8 }, Fluff }

#[derive(Debug, Clone)]
pub struct DandelionEntry {
    pub tx_hash:    String,
    pub phase:      DandelionPhase,
    pub stem_peer:  Option<String>,    // the single peer in stem phase
    pub created_at: Instant,
    pub routing_id: String,            // anonymized path ID
}

pub struct DandelionRouter {
    peers:   Arc<PeerRegistry>,
    entries: Arc<RwLock<HashMap<String, DandelionEntry>>>,
    /// Stem-phase routing table: our node's stem relay peer for this epoch
    epoch_stem_peer: Arc<RwLock<Option<String>>>,
    epoch_refreshed: Arc<RwLock<Instant>>,
}

impl DandelionRouter {
    pub fn new(peers: Arc<PeerRegistry>) -> Self {
        Self {
            peers,
            entries: Arc::new(RwLock::new(HashMap::new())),
            epoch_stem_peer: Arc::new(RwLock::new(None)),
            epoch_refreshed: Arc::new(RwLock::new(Instant::now())),
        }
    }

    /// Submit a new transaction into Dandelion++ stem phase
    pub async fn submit(&self, tx_hash: String) -> DandelionPhase {
        let mut rng = rand::thread_rng();
        let hops = rng.gen_range(STEM_HOPS_MIN..=STEM_HOPS_MAX);
        let routing_id = format!("{:016x}", rng.gen::<u64>());
        let stem_peer = self.get_epoch_stem_peer().await;

        let entry = DandelionEntry {
            tx_hash: tx_hash.clone(),
            phase: DandelionPhase::Stem { hops_remaining: hops },
            stem_peer: stem_peer.clone(),
            created_at: Instant::now(),
            routing_id,
        };

        let phase = entry.phase.clone();
        self.entries.write().insert(tx_hash.clone(), entry);

        info!(
            tx = tx_hash,
            hops,
            stem_peer = stem_peer.as_deref().unwrap_or("none"),
            "Dandelion++ stem phase started"
        );
        phase
    }

    /// Route a transaction one step further
    pub async fn advance(&self, tx_hash: &str) -> DandelionPhase {
        let peers = self.peers.active().await;
        let mut rng = rand::thread_rng();

        let mut entries = self.entries.write();
        let entry = match entries.get_mut(tx_hash) {
            Some(e) => e,
            None => return DandelionPhase::Fluff,
        };

        // Timeout check — force fluff if stem phase stalled
        if entry.created_at.elapsed() > Duration::from_secs(STEM_TIMEOUT_SECS) {
            warn!(tx = tx_hash, "Dandelion++ stem timeout — forcing fluff");
            entry.phase = DandelionPhase::Fluff;
            return DandelionPhase::Fluff;
        }

        match &entry.phase {
            DandelionPhase::Stem { hops_remaining } => {
                let should_fluff = *hops_remaining == 0
                    || peers.is_empty()
                    || rng.gen_bool(FLUFF_PROBABILITY);

                if should_fluff {
                    info!(tx = tx_hash, "Dandelion++ entering FLUFF phase");
                    entry.phase = DandelionPhase::Fluff;
                    DandelionPhase::Fluff
                } else {
                    let hops = hops_remaining - 1;
                    let new_peer = if !peers.is_empty() {
                        Some(peers[rng.gen_range(0..peers.len())].id.clone())
                    } else { None };
                    entry.phase = DandelionPhase::Stem { hops_remaining: hops };
                    entry.stem_peer = new_peer;
                    DandelionPhase::Stem { hops_remaining: hops }
                }
            }
            DandelionPhase::Fluff => DandelionPhase::Fluff,
        }
    }

    /// Get or refresh the epoch stem peer (changes every ~10 min)
    async fn get_epoch_stem_peer(&self) -> Option<String> {
        let refresh_needed = self.epoch_refreshed.read().elapsed() > Duration::from_secs(600);
        if refresh_needed {
            let peers = self.peers.active().await;
            if peers.is_empty() { return None; }
            let idx = rand::thread_rng().gen_range(0..peers.len());
            let new_peer = peers[idx].id.clone();
            *self.epoch_stem_peer.write() = Some(new_peer);
            *self.epoch_refreshed.write() = Instant::now();
        }
        self.epoch_stem_peer.read().clone()
    }

    /// Clean up old fluff/expired entries
    pub fn prune_expired(&self) {
        let ttl = Duration::from_secs(300);
        self.entries.write().retain(|_, e| e.created_at.elapsed() < ttl);
    }
}
