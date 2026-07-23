/// P2P peer management — full production implementation
/// Peer scoring, ban management, connection slots, version handshake tracking,
/// and Noise Protocol encrypted transport.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use dashmap::DashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use chrono::Utc;
use uuid::Uuid;
use tracing::{info, warn, debug};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use crate::message::NodeServices;
use crate::noise::{
    NoiseHandshake, NoiseTransport, NoiseError, HandshakeRole,
    generate_keypair,
    NOISE_NEGOTIATION_PLAINTEXT, NOISE_NEGOTIATION_NOISE,
    is_valid_negotiation_byte,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeerState {
    Connecting,
    /// Performing Noise handshake (encryption negotiation)
    NoiseHandshaking,
    /// Protocol-level version handshake
    Handshaking,
    Connected,
    Disconnecting,
    Banned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub id:              String,
    pub addr:            String,
    pub port:            u16,
    pub version:         String,
    pub protocol_version: u32,
    pub services:        u64,
    pub height:          u64,
    pub latency_ms:      u64,
    pub connected_at:    i64,
    pub last_seen:       i64,
    pub last_ping:       Option<i64>,
    pub region:          String,
    pub user_agent:      String,
    pub state:           PeerState,
    pub inbound:         bool,
    pub ban_score:       u32,
    pub bytes_sent:      u64,
    pub bytes_recv:      u64,
    pub tx_relayed:      u64,
    pub blocks_relayed:  u64,
    /// Whether this peer's connection uses Noise encryption
    pub noise_enabled:   bool,
}

impl Peer {
    pub fn new(addr: &str, port: u16, inbound: bool) -> Self {
        let now = Utc::now().timestamp();
        Self {
            id: Uuid::new_v4().to_string(),
            addr: addr.to_string(),
            port,
            version: "v0.1.0".into(),
            protocol_version: 2,
            services: 0,
            height: 0,
            latency_ms: 0,
            connected_at: now,
            last_seen: now,
            last_ping: None,
            region: "Unknown".into(),
            user_agent: String::new(),
            state: PeerState::Connecting,
            inbound,
            ban_score: 0,
            bytes_sent: 0,
            bytes_recv: 0,
            tx_relayed: 0,
            blocks_relayed: 0,
            noise_enabled: false,
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(self.state, PeerState::Connected)
    }
}

#[derive(Clone)]
pub struct PeerRegistry {
    peers:       Arc<DashMap<String, Peer>>,
    max_inbound: usize,
    max_outbound: usize,
}

impl PeerRegistry {
    pub fn new() -> Self {
        Self {
            peers: Arc::new(DashMap::new()),
            max_inbound: 125,
            max_outbound: 8,
        }
    }

    pub async fn add(&self, peer: Peer) {
        self.peers.insert(peer.id.clone(), peer);
    }

    pub async fn remove(&self, id: &str) {
        self.peers.remove(id);
    }

    pub async fn update_height(&self, id: &str, height: u64) {
        if let Some(mut p) = self.peers.get_mut(id) {
            p.height = height;
            p.last_seen = Utc::now().timestamp();
        }
    }

    pub async fn update_latency(&self, id: &str, latency_ms: u64) {
        if let Some(mut p) = self.peers.get_mut(id) {
            p.latency_ms = latency_ms;
        }
    }

    pub async fn set_state(&self, id: &str, state: PeerState) {
        if let Some(mut p) = self.peers.get_mut(id) {
            p.state = state;
        }
    }

    pub async fn all(&self) -> Vec<Peer> {
        self.peers.iter().map(|e| e.value().clone()).collect()
    }

    pub async fn active(&self) -> Vec<Peer> {
        self.peers.iter()
            .filter(|e| e.is_active())
            .map(|e| e.value().clone())
            .collect()
    }

    pub async fn count(&self) -> usize { self.peers.len() }

    pub async fn best_height(&self) -> u64 {
        self.peers.iter().map(|e| e.height).max().unwrap_or(0)
    }

    pub async fn add_ban_score(&self, id: &str, score: u32) -> bool {
        if let Some(mut p) = self.peers.get_mut(id) {
            p.ban_score += score;
            if p.ban_score >= 100 {
                p.state = PeerState::Banned;
                return true; // should disconnect
            }
        }
        false
    }
}

impl Default for PeerRegistry {
    fn default() -> Self { Self::new() }
}

// ─── PeerConnection — Noise-encrypted TCP connection ────────────────────────────

/// Represents an established TCP connection to a peer, with optional
/// Noise Protocol transport encryption.
///
/// After TCP connect, the two peers negotiate encryption:
/// 1. The initiator sends a negotiation byte: 0x00 (plaintext) or 0x01 (Noise).
/// 2. The responder replies with its own negotiation byte (mirrors if supported).
/// 3. If both sent 0x01, the Noise IK handshake begins.
/// 4. After handshake, all messages are encrypted via [`NoiseTransport`].
/// 5. If either side sent 0x00, the connection falls back to plaintext with a warning.
pub struct PeerConnection {
    /// The TCP stream (kept alive for the lifetime of the connection).
    pub stream: TcpStream,
    /// Peer metadata
    pub peer: Peer,
    /// Optional noise transport for encrypted messages.
    /// `None` means the connection is plaintext (fallback mode).
    noise_state: Option<NoiseTransport>,
}

impl PeerConnection {
    /// Create a new peer connection by initiating a TCP connection to the given
    /// address, then negotiating Noise encryption.
    ///
    /// This is the **outbound (initiator)** path.
    ///
    /// # Arguments
    /// - `addr` — the peer's IP/hostname
    /// - `port` — the peer's TCP port
    /// - `local_static_priv` — our node's X25519 static private key (32 bytes)
    /// - `remote_static_pub` — the peer's known X25519 static public key (32 bytes),
    ///   if known. If `None`, we fall back to plaintext (can't do IK without knowing
    ///   the initiator's static key).
    ///
    /// # Returns
    /// A fully negotiated `PeerConnection` ready for encrypted (or plaintext) messaging.
    pub async fn connect_initiator(
        addr: &str,
        port: u16,
        local_static_priv: &[u8; 32],
        remote_static_pub: Option<&[u8; 32]>,
    ) -> Result<Self, PeerConnectionError> {
        let target = format!("{}:{}", addr, port);
        debug!("Connecting to peer: {}", target);

        let stream = TcpStream::connect(&target).await.map_err(|e| {
            PeerConnectionError::ConnectionFailed(format!("TCP connect to {}: {}", target, e))
        })?;

        let peer = Peer::new(addr, port, false);
        let mut conn = Self {
            stream,
            peer,
            noise_state: None,
        };

        // Negotiate: we (initiator) propose Noise if we have the remote static key
        let we_want_noise = remote_static_pub.is_some();
        conn.perform_noise_negotiation_initiator(
            local_static_priv,
            remote_static_pub,
            we_want_noise,
        )
        .await?;

        Ok(conn)
    }

    /// Create a new peer connection from an already-accepted TCP stream
    /// (inbound connection). This is the **inbound (responder)** path.
    ///
    /// # Arguments
    /// - `stream` — the accepted TCP stream
    /// - `addr` — the peer's address (from `peer_addr()`)
    /// - `local_static_priv` — our node's X25519 static private key (32 bytes)
    /// - `remote_static_pub` — the initiator's known X25519 static public key,
    ///   if known. For inbound IK, the responder MUST know the initiator's static.
    ///   If `None`, we fall back to plaintext.
    ///
    /// # Returns
    /// A fully negotiated `PeerConnection`.
    pub async fn accept_responder(
        stream: TcpStream,
        addr: &str,
        local_static_priv: &[u8; 32],
        remote_static_pub: Option<&[u8; 32]>,
    ) -> Result<Self, PeerConnectionError> {
        let port = stream
            .peer_addr()
            .map(|a| a.port())
            .unwrap_or(0);

        debug!("Accepted inbound connection from {}:{}", addr, port);

        let peer = Peer::new(addr, port, true);
        let mut conn = Self {
            stream,
            peer,
            noise_state: None,
        };

        // For IK responder: we MUST know the initiator's static key to use Noise
        let we_support_noise = remote_static_pub.is_some();
        conn.perform_noise_negotiation_responder(
            local_static_priv,
            remote_static_pub,
            we_support_noise,
        )
        .await?;

        Ok(conn)
    }

    // ─── Negotiation (initiator side) ───────────────────────────────────────

    /// Initiator-side Noise negotiation.
    ///
    /// 1. Send our negotiation byte (0x01 if we want Noise + have remote key, else 0x00).
    /// 2. Read the responder's negotiation byte.
    /// 3. If both are 0x01, perform the IK handshake as initiator.
    /// 4. Otherwise, fall back to plaintext.
    async fn perform_noise_negotiation_initiator(
        &mut self,
        local_static_priv: &[u8; 32],
        remote_static_pub: Option<&[u8; 32]>,
        we_want_noise: bool,
    ) -> Result<(), PeerConnectionError> {
        // Step 1: send our negotiation byte
        let our_byte = if we_want_noise {
            NOISE_NEGOTIATION_NOISE
        } else {
            NOISE_NEGOTIATION_PLAINTEXT
        };

        self.stream
            .write_all(&[our_byte])
            .await
            .map_err(|e| PeerConnectionError::IoError(e))?;

        debug!(
            "Initiator: sent negotiation byte 0x{:02X} ({})",
            our_byte,
            if our_byte == NOISE_NEGOTIATION_NOISE { "Noise" } else { "plaintext" }
        );

        // Step 2: read responder's byte
        let mut resp_byte = [0u8; 1];
        self.stream
            .read_exact(&mut resp_byte)
            .await
            .map_err(|e| PeerConnectionError::IoError(e))?;

        let peer_byte = resp_byte[0];
        debug!(
            "Initiator: received negotiation byte 0x{:02X}",
            peer_byte
        );

        if !is_valid_negotiation_byte(peer_byte) {
            return Err(PeerConnectionError::ProtocolViolation(format!(
                "peer sent invalid negotiation byte: 0x{:02X}", peer_byte
            )));
        }

        // Step 3: if both want Noise, do the handshake
        if our_byte == NOISE_NEGOTIATION_NOISE && peer_byte == NOISE_NEGOTIATION_NOISE {
            let remote_key = remote_static_pub.ok_or_else(|| {
                PeerConnectionError::NoiseError(NoiseError::MissingKey(
                    "remote static key required for Noise IK initiator".into(),
                ))
            })?;

            self.perform_noise_handshake_initiator(local_static_priv, remote_key)
                .await?;
            self.peer.noise_enabled = true;
            info!("Noise encryption established with {} (initiator)", self.peer.addr);
        } else {
            // Fallback to plaintext
            warn!(
                "Falling back to plaintext with {} (we={}, peer={})",
                self.peer.addr,
                if our_byte == NOISE_NEGOTIATION_NOISE { "Noise" } else { "plain" },
                if peer_byte == NOISE_NEGOTIATION_NOISE { "Noise" } else { "plain" }
            );
            self.peer.noise_enabled = false;
        }

        Ok(())
    }

    // ─── Negotiation (responder side) ───────────────────────────────────────

    /// Responder-side Noise negotiation.
    ///
    /// 1. Read the initiator's negotiation byte.
    /// 2. If we support Noise and the initiator asked for it, reply with 0x01 and
    ///    perform the IK handshake as responder.
    /// 3. Otherwise, reply with 0x00 and fall back to plaintext.
    async fn perform_noise_negotiation_responder(
        &mut self,
        local_static_priv: &[u8; 32],
        remote_static_pub: Option<&[u8; 32]>,
        we_support_noise: bool,
    ) -> Result<(), PeerConnectionError> {
        // Step 1: read initiator's negotiation byte
        let mut init_byte = [0u8; 1];
        self.stream
            .read_exact(&mut init_byte)
            .await
            .map_err(|e| PeerConnectionError::IoError(e))?;

        let peer_byte = init_byte[0];
        debug!(
            "Responder: received negotiation byte 0x{:02X}",
            peer_byte
        );

        if !is_valid_negotiation_byte(peer_byte) {
            return Err(PeerConnectionError::ProtocolViolation(format!(
                "initiator sent invalid negotiation byte: 0x{:02X}", peer_byte
            )));
        }

        // Step 2: decide our response
        let do_noise = we_support_noise && peer_byte == NOISE_NEGOTIATION_NOISE;
        let our_byte = if do_noise {
            NOISE_NEGOTIATION_NOISE
        } else {
            NOISE_NEGOTIATION_PLAINTEXT
        };

        self.stream
            .write_all(&[our_byte])
            .await
            .map_err(|e| PeerConnectionError::IoError(e))?;

        debug!(
            "Responder: sent negotiation byte 0x{:02X} ({})",
            our_byte,
            if our_byte == NOISE_NEGOTIATION_NOISE { "Noise" } else { "plaintext" }
        );

        // Step 3: if both want Noise, do the handshake
        if do_noise {
            let remote_key = remote_static_pub.ok_or_else(|| {
                PeerConnectionError::NoiseError(NoiseError::MissingKey(
                    "remote static key required for Noise IK responder".into(),
                ))
            })?;

            self.perform_noise_handshake_responder(local_static_priv, remote_key)
                .await?;
            self.peer.noise_enabled = true;
            info!("Noise encryption established with {} (responder)", self.peer.addr);
        } else {
            warn!(
                "Falling back to plaintext with {} (we={}, peer={})",
                self.peer.addr,
                if our_byte == NOISE_NEGOTIATION_NOISE { "Noise" } else { "plain" },
                if peer_byte == NOISE_NEGOTIATION_NOISE { "Noise" } else { "plain" }
            );
            self.peer.noise_enabled = false;
        }

        Ok(())
    }

    // ─── IK Handshake (initiator) ───────────────────────────────────────────

    /// Perform the full Noise IK handshake as the **initiator** (Alice).
    ///
    /// Message flow:
    ///   Alice → Bob: e, es, s, ss (message 1)
    ///   Alice ← Bob: e, ee, se (message 2)
    ///   Alice → Bob: s, se (message 3 — empty payload)
    async fn perform_noise_handshake_initiator(
        &mut self,
        local_static_priv: &[u8; 32],
        remote_static_pub: &[u8; 32],
    ) -> Result<(), PeerConnectionError> {
        let mut handshake = NoiseHandshake::new_initiator(local_static_priv, remote_static_pub)
            .map_err(PeerConnectionError::NoiseError)?;

        // Send message 1: "→ e, es, s, ss"
        let msg1 = handshake.initiate().map_err(PeerConnectionError::NoiseError)?;
        self.send_raw(&msg1).await?;
        debug!("Noise IK initiator: sent message 1 ({} bytes)", msg1.len());

        // Receive message 2: "← e, ee, se"
        let msg2 = self.recv_raw_handshake().await?;
        debug!("Noise IK initiator: received message 2 ({} bytes)", msg2.len());
        let (msg3, complete) = handshake
            .handle_incoming(&msg2)
            .map_err(PeerConnectionError::NoiseError)?;

        // If the responder expects a third message (s, se), send it
        if !complete {
            if !msg3.is_empty() {
                self.send_raw(&msg3).await?;
                debug!("Noise IK initiator: sent message 3 ({} bytes)", msg3.len());
            }

            // Read the final acknowledgement (may be empty)
            let final_msg = self.recv_raw_handshake().await?;
            let (_, final_complete) = handshake
                .handle_incoming(&final_msg)
                .map_err(PeerConnectionError::NoiseError)?;

            if !final_complete {
                return Err(PeerConnectionError::NoiseError(NoiseError::HandshakeError(
                    "initiator handshake did not complete after all messages".into(),
                )));
            }
        }

        // Transition to transport
        self.noise_state = Some(
            handshake
                .into_transport()
                .map_err(PeerConnectionError::NoiseError)?
        );

        debug!("Noise IK initiator: transport mode active");
        Ok(())
    }

    // ─── IK Handshake (responder) ───────────────────────────────────────────

    /// Perform the full Noise IK handshake as the **responder** (Bob).
    ///
    /// Message flow:
    ///   Bob ← Alice: e, es, s, ss (message 1)
    ///   Bob → Alice: e, ee, se (message 2)
    ///   Bob ← Alice: s, se (message 3)
    async fn perform_noise_handshake_responder(
        &mut self,
        local_static_priv: &[u8; 32],
        remote_static_pub: &[u8; 32],
    ) -> Result<(), PeerConnectionError> {
        let mut handshake = NoiseHandshake::new_responder(local_static_priv, remote_static_pub)
            .map_err(PeerConnectionError::NoiseError)?;

        // Receive message 1: "← e, es, s, ss"
        let msg1 = self.recv_raw_handshake().await?;
        debug!("Noise IK responder: received message 1 ({} bytes)", msg1.len());

        // Process message 1 and generate message 2: "→ e, ee, se"
        let (msg2, complete_after_1) = handshake
            .handle_incoming(&msg1)
            .map_err(PeerConnectionError::NoiseError)?;
        self.send_raw(&msg2).await?;
        debug!("Noise IK responder: sent message 2 ({} bytes)", msg2.len());

        if !complete_after_1 {
            // Receive message 3: "← s, se"
            let msg3 = self.recv_raw_handshake().await?;
            debug!("Noise IK responder: received message 3 ({} bytes)", msg3.len());

            let (final_resp, complete) = handshake
                .handle_incoming(&msg3)
                .map_err(PeerConnectionError::NoiseError)?;

            // Send final acknowledgement if needed
            if !final_resp.is_empty() {
                self.send_raw(&final_resp).await?;
            }

            if !complete {
                return Err(PeerConnectionError::NoiseError(NoiseError::HandshakeError(
                    "responder handshake did not complete after all messages".into(),
                )));
            }
        }

        // Transition to transport
        self.noise_state = Some(
            handshake
                .into_transport()
                .map_err(PeerConnectionError::NoiseError)?
        );

        debug!("Noise IK responder: transport mode active");
        Ok(())
    }

    // ─── Wire I/O ───────────────────────────────────────────────────────────

    /// Send a P2P message to the peer.
    ///
    /// If Noise is enabled, the message is encrypted before sending.
    /// Otherwise, it is sent as plaintext.
    pub async fn send_message(&mut self, payload: &[u8]) -> Result<(), PeerConnectionError> {
        let wire_bytes = match &mut self.noise_state {
            Some(transport) => {
                // Encrypt the payload with Noise transport
                let ciphertext = transport
                    .encrypt(payload)
                    .map_err(PeerConnectionError::NoiseError)?;

                // Prefix with 2-byte big-endian length for framing
                let frame_len = ciphertext.len();
                if frame_len > u16::MAX as usize {
                    return Err(PeerConnectionError::ProtocolViolation(format!(
                        "encrypted frame too large: {} bytes", frame_len
                    )));
                }
                let mut framed = Vec::with_capacity(2 + frame_len);
                framed.extend_from_slice(&(frame_len as u16).to_be_bytes());
                framed.extend_from_slice(&ciphertext);
                framed
            }
            None => {
                // Plaintext: prefix with 4-byte little-endian length for framing
                let mut framed = Vec::with_capacity(4 + payload.len());
                framed.extend_from_slice(&(payload.len() as u32).to_le_bytes());
                framed.extend_from_slice(payload);
                framed
            }
        };

        self.send_raw(&wire_bytes).await?;
        self.peer.bytes_sent += wire_bytes.len() as u64;
        Ok(())
    }

    /// Receive a P2P message from the peer.
    ///
    /// If Noise is enabled, the received bytes are decrypted.
    /// Otherwise, the plaintext is returned directly.
    pub async fn recv_message(&mut self) -> Result<Vec<u8>, PeerConnectionError> {
        let wire_bytes = match &mut self.noise_state {
            Some(_) => {
                // For Noise transport, we need a length-prefixed framing layer
                // Read 2-byte length prefix (big-endian) for the encrypted frame
                let mut len_buf = [0u8; 2];
                self.stream
                    .read_exact(&mut len_buf)
                    .await
                    .map_err(PeerConnectionError::IoError)?;
                let frame_len = u16::from_be_bytes(len_buf) as usize;

                if frame_len == 0 {
                    return Err(PeerConnectionError::ProtocolViolation(
                        "received zero-length encrypted frame".into(),
                    ));
                }

                let mut frame = vec![0u8; frame_len];
                self.stream
                    .read_exact(&mut frame)
                    .await
                    .map_err(PeerConnectionError::IoError)?;

                frame
            }
            None => {
                // Plaintext: read 4-byte length prefix (little-endian)
                let mut len_buf = [0u8; 4];
                self.stream
                    .read_exact(&mut len_buf)
                    .await
                    .map_err(PeerConnectionError::IoError)?;
                let msg_len = u32::from_le_bytes(len_buf) as usize;

                if msg_len == 0 {
                    return Err(PeerConnectionError::ProtocolViolation(
                        "received zero-length plaintext message".into(),
                    ));
                }

                let mut msg = vec![0u8; msg_len];
                self.stream
                    .read_exact(&mut msg)
                    .await
                    .map_err(PeerConnectionError::IoError)?;

                msg
            }
        };

        // Decrypt if Noise is active
        let plaintext = match &mut self.noise_state {
            Some(transport) => transport
                .decrypt(&wire_bytes)
                .map_err(PeerConnectionError::NoiseError)?,
            None => wire_bytes,
        };

        self.peer.bytes_recv += plaintext.len() as u64;
        self.peer.last_seen = Utc::now().timestamp();
        Ok(plaintext)
    }

    /// Whether this connection is encrypted with Noise.
    pub fn is_encrypted(&self) -> bool {
        self.noise_state.is_some()
    }

    // ─── Internal helpers ───────────────────────────────────────────────────

    /// Send raw bytes over the TCP stream (no framing, no encryption).
    async fn send_raw(&mut self, data: &[u8]) -> Result<(), PeerConnectionError> {
        self.stream
            .write_all(data)
            .await
            .map_err(PeerConnectionError::IoError)
    }

    /// Receive raw bytes for a handshake message.
    ///
    /// Handshake messages use a 2-byte big-endian length prefix for framing,
    /// since we don't know the exact message sizes ahead of time.
    async fn recv_raw_handshake(&mut self) -> Result<Vec<u8>, PeerConnectionError> {
        let mut len_buf = [0u8; 2];
        self.stream
            .read_exact(&mut len_buf)
            .await
            .map_err(PeerConnectionError::IoError)?;

        let msg_len = u16::from_be_bytes(len_buf) as usize;
        if msg_len == 0 || msg_len > 65535 {
            return Err(PeerConnectionError::ProtocolViolation(format!(
                "invalid handshake message length: {}", msg_len
            )));
        }

        let mut msg = vec![0u8; msg_len];
        self.stream
            .read_exact(&mut msg)
            .await
            .map_err(PeerConnectionError::IoError)?;

        Ok(msg)
    }
}

// ─── Peer Connection Error ──────────────────────────────────────────────────────

/// Errors that can occur during peer connection lifecycle.
#[derive(Debug)]
pub enum PeerConnectionError {
    /// TCP-level I/O error
    IoError(std::io::Error),
    /// Noise protocol error (handshake or transport)
    NoiseError(NoiseError),
    /// TCP connection could not be established
    ConnectionFailed(String),
    /// Protocol violation (invalid data, wrong state)
    ProtocolViolation(String),
}

impl std::fmt::Display for PeerConnectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::IoError(e)           => write!(f, "I/O error: {}", e),
            Self::NoiseError(e)        => write!(f, "Noise error: {}", e),
            Self::ConnectionFailed(s)  => write!(f, "Connection failed: {}", s),
            Self::ProtocolViolation(s) => write!(f, "Protocol violation: {}", s),
        }
    }
}

impl std::error::Error for PeerConnectionError {}

impl From<std::io::Error> for PeerConnectionError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e)
    }
}

impl From<NoiseError> for PeerConnectionError {
    fn from(e: NoiseError) -> Self {
        Self::NoiseError(e)
    }
}
