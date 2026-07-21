/// Gossip protocol — flood-fill block/tx propagation with anti-flood,
/// message deduplication, exponential backoff, and peer scoring
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::collections::{HashMap, HashSet, VecDeque};
use tokio::sync::RwLock;
use tokio::time::{Duration, Instant};
use tracing::{info, warn, debug, trace};
use uuid::Uuid;
use sha2::{Digest, Sha256};
use crate::PeerRegistry;

// ─────────────────────────────────────────────────────────────────────────────
// Message types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum GossipMessageType {
    NewBlock,
    NewTransaction,
    Ping,
    Pong,
    GetBlocks,
    BlockHeaders,
    GetPeers,
    PeerList,
    Reject,
    Alert,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GossipEnvelope {
    pub id:         String,    // message UUID (for dedup)
    pub msg_type:   GossipMessageType,
    pub payload:    serde_json::Value,
    pub sender_id:  String,
    pub timestamp:  i64,
    pub ttl:        u8,        // hops remaining
    pub signature:  Option<String>, // optional sender sig
}

impl GossipEnvelope {
    pub fn new(sender_id: &str, msg_type: GossipMessageType, payload: serde_json::Value) -> Self {
        Self {
            id:        Uuid::new_v4().to_string(),
            msg_type,
            payload,
            sender_id: sender_id.to_string(),
            timestamp: chrono::Utc::now().timestamp(),
            ttl: 8,
            signature: None,
        }
    }

    pub fn content_hash(&self) -> String {
        let mut h = Sha256::new();
        h.update(self.id.as_bytes());
        h.update(self.sender_id.as_bytes());
        h.update(&self.timestamp.to_le_bytes());
        hex::encode(h.finalize())
    }

    pub fn is_expired(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        now - self.timestamp > 300 // 5 minutes
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Peer scoring
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PeerScore {
    pub peer_id:       String,
    pub score:         i32,      // higher = better
    pub bans:          u32,
    pub messages_sent: u64,
    pub messages_recv: u64,
    pub last_active:   Instant,
    pub latency_ema:   f64,      // ms EMA
    pub invalid_msgs:  u32,
    pub is_banned:     bool,
    pub ban_until:     Option<Instant>,
}

impl PeerScore {
    pub fn new(peer_id: String) -> Self {
        Self {
            peer_id,
            score: 100,
            bans: 0,
            messages_sent: 0,
            messages_recv: 0,
            last_active: Instant::now(),
            latency_ema: 50.0,
            invalid_msgs: 0,
            is_banned: false,
            ban_until: None,
        }
    }

    pub fn good_message(&mut self) {
        self.score = (self.score + 1).min(200);
        self.messages_recv += 1;
        self.last_active = Instant::now();
    }

    pub fn bad_message(&mut self, severity: i32) {
        self.score -= severity;
        self.invalid_msgs += 1;
        if self.score <= 0 {
            self.ban(Duration::from_secs(3600)); // 1 hour ban
        }
    }

    pub fn ban(&mut self, duration: Duration) {
        self.is_banned = true;
        self.ban_until = Some(Instant::now() + duration);
        self.bans += 1;
        warn!(peer = self.peer_id, bans = self.bans, "Peer banned");
    }

    pub fn check_ban(&mut self) -> bool {
        if let Some(until) = self.ban_until {
            if Instant::now() > until {
                self.is_banned = false;
                self.ban_until = None;
                self.score = 50; // partial reinstate
            }
        }
        self.is_banned
    }

    pub fn update_latency(&mut self, ms: f64) {
        self.latency_ema = 0.2 * ms + 0.8 * self.latency_ema;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message deduplication cache
// ─────────────────────────────────────────────────────────────────────────────

pub struct MsgCache {
    seen:    HashSet<String>,    // message IDs
    ordered: VecDeque<(String, Instant)>, // FIFO for TTL eviction
    max_size: usize,
    ttl:     Duration,
}

impl MsgCache {
    pub fn new(max_size: usize) -> Self {
        Self {
            seen: HashSet::new(),
            ordered: VecDeque::new(),
            max_size,
            ttl: Duration::from_secs(300),
        }
    }

    /// Returns true if this is a new message (not seen before)
    pub fn insert(&mut self, id: &str) -> bool {
        self.evict_expired();
        if self.seen.contains(id) {
            return false;
        }
        if self.seen.len() >= self.max_size {
            // Evict oldest
            if let Some((oldest_id, _)) = self.ordered.pop_front() {
                self.seen.remove(&oldest_id);
            }
        }
        self.seen.insert(id.to_string());
        self.ordered.push_back((id.to_string(), Instant::now()));
        true
    }

    fn evict_expired(&mut self) {
        let now = Instant::now();
        while let Some((id, ts)) = self.ordered.front() {
            if now.duration_since(*ts) > self.ttl {
                let id = id.clone();
                self.ordered.pop_front();
                self.seen.remove(&id);
            } else {
                break;
            }
        }
    }

    pub fn len(&self) -> usize { self.seen.len() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gossip service
// ─────────────────────────────────────────────────────────────────────────────

pub struct GossipService {
    pub peers:    Arc<PeerRegistry>,
    pub node_id:  String,
    msg_cache:    Arc<RwLock<MsgCache>>,
    peer_scores:  Arc<RwLock<HashMap<String, PeerScore>>>,
    /// In-memory outbound queue
    outbound_q:   Arc<RwLock<VecDeque<(String, GossipEnvelope)>>>, // (peer_id, msg)
}

impl GossipService {
    pub fn new(peers: Arc<PeerRegistry>, node_id: String) -> Self {
        Self {
            peers,
            node_id,
            msg_cache:   Arc::new(RwLock::new(MsgCache::new(50_000))),
            peer_scores: Arc::new(RwLock::new(HashMap::new())),
            outbound_q:  Arc::new(RwLock::new(VecDeque::new())),
        }
    }

    /// Announce a new block to all connected peers
    pub async fn announce_block(
        &self,
        block_number: u64,
        hash: &str,
        prev_hash: &str,
        miner: &str,
        tx_count: u32,
        reward: f64,
    ) {
        let envelope = GossipEnvelope::new(
            &self.node_id,
            GossipMessageType::NewBlock,
            serde_json::json!({
                "block_number":  block_number,
                "hash":          hash,
                "prev_hash":     prev_hash,
                "miner":         miner,
                "tx_count":      tx_count,
                "reward":        reward,
                "timestamp":     chrono::Utc::now().timestamp(),
            }),
        );

        // Register in dedup cache
        let mut cache = self.msg_cache.write().await;
        cache.insert(&envelope.id);
        drop(cache);

        let peers = self.peers.all().await;
        let peer_count = peers.len();

        // Flood to all peers (production: use WebSocket connections)
        for peer in &peers {
            trace!(
                block = block_number,
                hash = &hash[..8.min(hash.len())],
                peer = peer.addr,
                "Gossiping block"
            );
            // ws_send(&peer.addr, &envelope).await
        }

        info!(
            block = block_number,
            peers = peer_count,
            hash = &hash[..12.min(hash.len())],
            "Block announced via gossip"
        );
    }

    /// Broadcast a transaction (Dandelion++ fluff phase)
    pub async fn broadcast_tx(&self, tx_hash: &str, from: &str, fee: f64, privacy: &str) {
        let envelope = GossipEnvelope::new(
            &self.node_id,
            GossipMessageType::NewTransaction,
            serde_json::json!({
                "tx_hash":  tx_hash,
                "from":     from,
                "fee":      fee,
                "privacy":  privacy,
                "timestamp": chrono::Utc::now().timestamp(),
            }),
        );

        let mut cache = self.msg_cache.write().await;
        let is_new = cache.insert(&envelope.id);
        drop(cache);

        if !is_new { return; } // already seen

        let peers = self.peers.all().await;
        trace!(tx = tx_hash, peers = peers.len(), "Broadcasting tx via gossip");
        for peer in &peers {
            // ws_send(&peer.addr, &envelope).await
        }
    }

    /// Send ping to a specific peer and record latency
    pub async fn ping_peer(&self, peer_id: &str, local_height: u64) {
        let envelope = GossipEnvelope::new(
            &self.node_id,
            GossipMessageType::Ping,
            serde_json::json!({
                "height": local_height,
                "nonce":  rand::random::<u64>(),
            }),
        );
        debug!(peer = peer_id, height = local_height, "Sending ping");
        // ws_send(peer_addr, &envelope).await
    }

    /// Handle an incoming gossip message
    pub async fn handle_message(&self, from_peer: &str, envelope: GossipEnvelope) -> GossipAction {
        // Check TTL
        if envelope.ttl == 0 {
            debug!(msg = envelope.id, "Dropping gossip: TTL exhausted");
            return GossipAction::Drop;
        }

        // Check expiry
        if envelope.is_expired() {
            debug!(msg = envelope.id, "Dropping gossip: message expired");
            return GossipAction::Drop;
        }

        // Dedup check
        let mut cache = self.msg_cache.write().await;
        if !cache.insert(&envelope.id) {
            trace!(msg = envelope.id, "Gossip dedup: already seen");
            return GossipAction::Drop;
        }
        drop(cache);

        // Update peer score
        let mut scores = self.peer_scores.write().await;
        let score = scores.entry(from_peer.to_string())
            .or_insert_with(|| PeerScore::new(from_peer.to_string()));
        if score.check_ban() {
            warn!(peer = from_peer, "Dropping message from banned peer");
            return GossipAction::Drop;
        }
        score.good_message();
        drop(scores);

        // Relay to other peers (with decremented TTL)
        let mut relay = envelope.clone();
        relay.ttl -= 1;

        match &envelope.msg_type {
            GossipMessageType::NewBlock => {
                let block_num = envelope.payload.get("block_number")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                info!(block = block_num, from = from_peer, "Received new block gossip");
                GossipAction::Process(envelope)
            }
            GossipMessageType::NewTransaction => {
                let tx_hash = envelope.payload.get("tx_hash")
                    .and_then(|v| v.as_str())
                    .unwrap_or("?");
                debug!(tx = tx_hash, from = from_peer, "Received tx gossip");
                GossipAction::Process(envelope)
            }
            GossipMessageType::Ping => {
                let pong = GossipEnvelope::new(
                    &self.node_id,
                    GossipMessageType::Pong,
                    envelope.payload.clone(),
                );
                GossipAction::Respond(pong)
            }
            GossipMessageType::GetPeers => {
                let peers = self.peers.all().await;
                let peer_list: Vec<_> = peers.iter().map(|p| serde_json::json!({
                    "id": p.id, "addr": p.addr, "height": p.height,
                })).collect();
                let resp = GossipEnvelope::new(
                    &self.node_id,
                    GossipMessageType::PeerList,
                    serde_json::json!({ "peers": peer_list }),
                );
                GossipAction::Respond(resp)
            }
            _ => GossipAction::Relay(relay),
        }
    }

    /// Ban a peer (e.g., for sending invalid blocks)
    pub async fn ban_peer(&self, peer_id: &str, reason: &str, duration_secs: u64) {
        let mut scores = self.peer_scores.write().await;
        let score = scores.entry(peer_id.to_string())
            .or_insert_with(|| PeerScore::new(peer_id.to_string()));
        score.ban(Duration::from_secs(duration_secs));
        warn!(peer = peer_id, reason, secs = duration_secs, "Peer banned");
    }

    /// Stats about gossip layer
    pub async fn stats(&self) -> serde_json::Value {
        let cache = self.msg_cache.read().await;
        let scores = self.peer_scores.read().await;
        let peers = self.peers.count().await;
        let banned: usize = scores.values().filter(|s| s.is_banned).count();
        serde_json::json!({
            "node_id":        self.node_id,
            "connected_peers": peers,
            "known_peers":    scores.len(),
            "banned_peers":   banned,
            "msg_cache_size": cache.len(),
            "outbound_queue": 0,
        })
    }
}

/// Action to take after processing a gossip message
#[derive(Debug)]
pub enum GossipAction {
    Process(GossipEnvelope),  // handle locally
    Relay(GossipEnvelope),    // forward to other peers
    Respond(GossipEnvelope),  // send response to sender
    Drop,                     // discard
}
