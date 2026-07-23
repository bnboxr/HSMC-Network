/// Noise Protocol IK handshake + transport encryption for P2P connections
///
/// Implements Noise_IK_25519_ChaChaPoly_BLAKE2b:
///   - IK  = Interactive handshake; initiator's static key is known to responder
///   - 25519 = X25519 Diffie-Hellman
///   - ChaChaPoly = ChaCha20-Poly1305 AEAD
///   - BLAKE2b = hashing primitive
///
/// Flow:
///   Initiator                         Responder
///     | e (ephemeral key) ──────────────→ |
///     | ←─ e, ee, se (auth tag) ───────── |
///     | s, se (auth tag) ───────────────→ |
///     |◄══════ Transport Encrypted ══════►|
///
/// Uses the `snow` crate (Rust Noise Protocol Framework) as the standard
/// implementation. All errors are propagated via Result; no unwrap() in
/// production paths.

use std::fmt;
use snow::{Builder, HandshakeState, TransportState};
use tracing::{debug, warn};

// ─── Error Type ─────────────────────────────────────────────────────────────────

/// Errors that can occur during Noise handshake or transport operations.
#[derive(Debug)]
pub enum NoiseError {
    /// Failed to build the Noise handshake state (invalid key, pattern, etc.)
    BuildError(String),
    /// Handshake protocol error (bad message, state mismatch)
    HandshakeError(String),
    /// Encryption/decryption of a transport message failed
    TransportError(String),
    /// Peer sent an invalid or unexpected message during handshake
    ProtocolViolation(String),
    /// Required key material is missing (e.g., no static keypair configured)
    MissingKey(String),
}

impl fmt::Display for NoiseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BuildError(msg)        => write!(f, "Noise build error: {}", msg),
            Self::HandshakeError(msg)    => write!(f, "Noise handshake error: {}", msg),
            Self::TransportError(msg)    => write!(f, "Noise transport error: {}", msg),
            Self::ProtocolViolation(msg) => write!(f, "Noise protocol violation: {}", msg),
            Self::MissingKey(msg)        => write!(f, "Noise missing key: {}", msg),
        }
    }
}

impl std::error::Error for NoiseError {}

// ─── Constants ──────────────────────────────────────────────────────────────────

/// Noise protocol pattern string for snow.
/// "Noise_IK_25519_ChaChaPoly_BLAKE2b"
const NOISE_PATTERN: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2b";

/// Maximum size of a single handshake message (64 KiB).
const MAX_HANDSHAKE_MSG_LEN: usize = 65_535;

/// Maximum size of a transport message payload after encryption (16 MiB).
const MAX_TRANSPORT_MSG_LEN: usize = 16 * 1024 * 1024;

// ─── Handshake ──────────────────────────────────────────────────────────────────

/// Manages the Noise IK handshake lifecycle.
///
/// Created once per connection. Depending on the role (initiator or responder),
/// the handshake proceeds through 3 messages as defined by the IK pattern.
pub struct NoiseHandshake {
    state: HandshakeState,
    role: HandshakeRole,
    /// Number of handshake messages processed so far (0, 1, or 2).
    step: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandshakeRole {
    /// We initiate the connection (Alice in IK).
    Initiator,
    /// We respond to the connection (Bob in IK).
    Responder,
}

impl NoiseHandshake {
    /// Create a new Noise handshake for the *initiator* role.
    ///
    /// The initiator (Alice) knows the responder's static public key from
    /// configuration; she provides it as `remote_static_pub`.
    ///
    /// # Arguments
    /// - `local_static_priv` — our node's X25519 static private key (32 bytes)
    /// - `remote_static_pub` — the peer's known X25519 static public key (32 bytes)
    pub fn new_initiator(
        local_static_priv: &[u8; 32],
        remote_static_pub: &[u8; 32],
    ) -> Result<Self, NoiseError> {
        let builder = Builder::new(NOISE_PATTERN.parse().map_err(|e| {
            NoiseError::BuildError(format!("invalid pattern: {}", e))
        })?);

        let state = builder
            .local_private_key(local_static_priv)
            .remote_public_key(remote_static_pub)
            .build_initiator()
            .map_err(|e| NoiseError::BuildError(format!("initiator build: {}", e)))?;

        debug!("Noise handshake: initiator created");
        Ok(Self {
            state,
            role: HandshakeRole::Initiator,
            step: 0,
        })
    }

    /// Create a new Noise handshake for the *responder* role.
    ///
    /// The responder (Bob) knows the initiator's static public key from
    /// configuration; he provides it as `remote_static_pub`.
    ///
    /// # Arguments
    /// - `local_static_priv` — our node's X25519 static private key (32 bytes)
    /// - `remote_static_pub` — the peer's known X25519 static public key (32 bytes)
    pub fn new_responder(
        local_static_priv: &[u8; 32],
        remote_static_pub: &[u8; 32],
    ) -> Result<Self, NoiseError> {
        let builder = Builder::new(NOISE_PATTERN.parse().map_err(|e| {
            NoiseError::BuildError(format!("invalid pattern: {}", e))
        })?);

        let state = builder
            .local_private_key(local_static_priv)
            .remote_public_key(remote_static_pub)
            .build_responder()
            .map_err(|e| NoiseError::BuildError(format!("responder build: {}", e)))?;

        debug!("Noise handshake: responder created");
        Ok(Self {
            state,
            role: HandshakeRole::Responder,
            step: 0,
        })
    }

    /// Generate the first handshake message.
    ///
    /// - **Initiator**: produces "→ e, es, s, ss" and transitions to step 1.
    ///   This is the first message Alice sends to Bob.
    /// - **Responder**: this should NOT be called on the responder; the responder
    ///   waits to receive the initiator's first message and calls [`respond`] instead.
    ///
    /// Returns the serialized handshake message bytes to be sent over the wire.
    pub fn initiate(&mut self) -> Result<Vec<u8>, NoiseError> {
        if self.role != HandshakeRole::Initiator {
            return Err(NoiseError::ProtocolViolation(
                "only the initiator calls initiate()".into(),
            ));
        }
        if self.step != 0 {
            return Err(NoiseError::ProtocolViolation(format!(
                "initiate() called at step {} (expected 0)", self.step
            )));
        }

        let mut buf = vec![0u8; MAX_HANDSHAKE_MSG_LEN];
        let written = self
            .state
            .write_message(&[], &mut buf)
            .map_err(|e| NoiseError::HandshakeError(format!("initiate write: {}", e)))?;

        buf.truncate(written);
        self.step = 1;

        debug!(
            "Noise handshake: initiator sent message 1 ({} bytes)",
            written
        );
        Ok(buf)
    }

    /// Process an incoming handshake message and, for the responder,
    /// produce the next message to send back.
    ///
    /// - **Responder** step 0 (first call): reads initiator's "→ e, es, s, ss",
    ///   produces "← e, ee, se" — transitions to step 1.
    /// - **Responder** step 1 (second call): reads initiator's "→ s, se",
    ///   produces the final response (empty payload). Handshake is complete.
    /// - **Initiator** step 1: reads responder's "← e, ee, se" and returns empty.
    ///   Then on second call reads final response.
    ///
    /// Returns `(response_to_send, is_complete)`:
    /// - `response_to_send`: bytes to send back to the peer (may be 0-length)
    /// - `is_complete`: true when the handshake is finished and transport can begin
    pub fn handle_incoming(
        &mut self,
        msg: &[u8],
    ) -> Result<(Vec<u8>, bool), NoiseError> {
        let role_str = match self.role {
            HandshakeRole::Initiator => "initiator",
            HandshakeRole::Responder => "responder",
        };

        debug!(
            "Noise handshake: {} processing {} bytes at step {}",
            role_str,
            msg.len(),
            self.step
        );

        let mut out_buf = vec![0u8; MAX_HANDSHAKE_MSG_LEN];
        let written = self
            .state
            .read_message(msg, &mut out_buf)
            .map_err(|e| NoiseError::HandshakeError(format!(
                "{} read_message at step {}: {}",
                role_str, self.step, e
            )))?;

        out_buf.truncate(written);
        self.step += 1;

        // The IK pattern requires 3 messages total for the handshake.
        // After the third message, the handshake is done.
        // "e, es, s, ss" = msg 1 (initiator→) = 2 steps for responder
        // "e, ee, se"     = msg 2 (←responder) = 1 step for initiator
        // "s, se"         = msg 3 (initiator→) = 1 more step for responder
        let is_complete = self.state.is_handshake_finished();

        if is_complete {
            debug!(
                "Noise handshake: {} handshake complete after {} messages",
                role_str, self.step
            );
        }

        Ok((out_buf, is_complete))
    }

    /// Whether the handshake has completed successfully.
    pub fn is_complete(&self) -> bool {
        self.state.is_handshake_finished()
    }

    /// Transition from handshake state to transport state.
    ///
    /// Consumes the handshake and returns a [`NoiseTransport`] for
    /// encrypting/decrypting subsequent messages.
    ///
    /// # Errors
    /// Returns `NoiseError::HandshakeError` if the handshake is not yet finished.
    pub fn into_transport(self) -> Result<NoiseTransport, NoiseError> {
        if !self.is_complete() {
            return Err(NoiseError::HandshakeError(
                "cannot transition to transport: handshake not complete".into(),
            ));
        }

        let transport = self
            .state
            .into_transport_mode()
            .map_err(|e| NoiseError::HandshakeError(format!(
                "into_transport_mode: {}", e
            )))?;

        debug!("Noise handshake: transitioned to transport mode");
        Ok(NoiseTransport {
            state: transport,
        })
    }
}

// ─── Transport ──────────────────────────────────────────────────────────────────

/// Post-handshake encrypted transport.
///
/// Wraps snow's [`TransportState`] to encrypt/decrypt P2P messages using
/// the established Noise session keys. Each encrypt/decrypt call advances
/// the internal nonce counter (monotonically increasing), ensuring replay
/// protection.
pub struct NoiseTransport {
    state: TransportState,
}

impl NoiseTransport {
    /// Encrypt a plaintext message for the wire.
    ///
    /// The resulting ciphertext includes the AEAD authentication tag
    /// (ChaCha20-Poly1305) appended automatically by snow.
    ///
    /// # Arguments
    /// - `plaintext` — the raw P2P message bytes to encrypt
    ///
    /// # Returns
    /// Encrypted + authenticated ciphertext bytes.
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, NoiseError> {
        if plaintext.is_empty() {
            return Err(NoiseError::TransportError(
                "cannot encrypt empty message".into(),
            ));
        }
        if plaintext.len() > MAX_TRANSPORT_MSG_LEN {
            return Err(NoiseError::TransportError(format!(
                "plaintext too large: {} bytes (max {})",
                plaintext.len(),
                MAX_TRANSPORT_MSG_LEN
            )));
        }

        let mut ciphertext = vec![0u8; plaintext.len() + 16]; // Poly1305 tag is 16 bytes
        let written = self
            .state
            .write_message(plaintext, &mut ciphertext)
            .map_err(|e| NoiseError::TransportError(format!(
                "encrypt: {}", e
            )))?;

        ciphertext.truncate(written);
        Ok(ciphertext)
    }

    /// Decrypt a ciphertext message from the wire.
    ///
    /// Verifies the AEAD authentication tag and returns the plaintext.
    ///
    /// # Arguments
    /// - `ciphertext` — the encrypted bytes received from the peer
    ///
    /// # Returns
    /// Decrypted + authenticated plaintext bytes.
    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, NoiseError> {
        if ciphertext.is_empty() {
            return Err(NoiseError::TransportError(
                "cannot decrypt empty message".into(),
            ));
        }
        if ciphertext.len() > MAX_TRANSPORT_MSG_LEN + 16 {
            return Err(NoiseError::TransportError(format!(
                "ciphertext too large: {} bytes", ciphertext.len()
            )));
        }

        let mut plaintext = vec![0u8; ciphertext.len()];
        let written = self
            .state
            .read_message(ciphertext, &mut plaintext)
            .map_err(|e| NoiseError::TransportError(format!(
                "decrypt: {}", e
            )))?;

        plaintext.truncate(written);
        Ok(plaintext)
    }
}

// ─── Key Generation Helpers ─────────────────────────────────────────────────────

/// Generate a fresh X25519 static keypair for use as a node's Noise identity.
///
/// Uses OS entropy (via `rand`).
pub fn generate_keypair() -> ([u8; 32], [u8; 32]) {
    use rand::RngCore;
    let mut rng = rand::thread_rng();
    let mut secret = [0u8; 32];
    rng.fill_bytes(&mut secret);

    // Derive the public key from the private key using X25519 basepoint
    // multiplication. We use x25519-dalek for this.
    let secret_dalek = x25519_dalek::StaticSecret::from(secret);
    let public = x25519_dalek::PublicKey::from(&secret_dalek);

    (secret, *public.as_bytes())
}

/// Noise IK handshake result: completed transport + the remote's static public key
/// (which we learn through the handshake for the responder case, or already knew
/// for the initiator).
pub struct HandshakeResult {
    pub transport: NoiseTransport,
    /// The remote peer's static public key (learned/verified through handshake)
    pub remote_static: [u8; 32],
}

// ─── Negotiation Byte ───────────────────────────────────────────────────────────

/// The protocol negotiation byte sent immediately after TCP connect.
pub const NOISE_NEGOTIATION_PLAINTEXT: u8 = 0x00;
pub const NOISE_NEGOTIATION_NOISE: u8 = 0x01;

/// Check if a byte is a valid Noise negotiation byte.
pub fn is_valid_negotiation_byte(b: u8) -> bool {
    b == NOISE_NEGOTIATION_PLAINTEXT || b == NOISE_NEGOTIATION_NOISE
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Full Noise IK handshake: initiator ↔ responder, then encrypt/decrypt round-trip.
    #[test]
    fn test_noise_ik_handshake_and_transport() {
        // Generate keypairs for both parties
        let (init_static_priv, init_static_pub) = generate_keypair();
        let (resp_static_priv, resp_static_pub) = generate_keypair();

        // Initiator knows responder's public key
        let mut initiator = NoiseHandshake::new_initiator(
            &init_static_priv,
            &resp_static_pub,
        )
        .expect("initiator build");

        // Responder knows initiator's public key (IK pattern: responder knows initiator's static)
        let mut responder = NoiseHandshake::new_responder(
            &resp_static_priv,
            &init_static_pub,
        )
        .expect("responder build");

        // Step 1: Initiator → Responder (message 1)
        let msg1 = initiator.initiate().expect("initiator msg1");
        assert!(!msg1.is_empty(), "message 1 should not be empty");
        assert!(!initiator.is_complete());

        // Responder reads msg1, responds with msg2
        let (msg2, responder_done1) = responder
            .handle_incoming(&msg1)
            .expect("responder handle msg1");
        assert!(!responder_done1, "responder should not be done after msg1");

        // Initiator reads msg2, responds with msg3
        let (msg3, initiator_done) = initiator
            .handle_incoming(&msg2)
            .expect("initiator handle msg2");
        assert!(initiator_done, "initiator should be done after msg2");

        // Responder reads msg3 (if any), handshake completes
        let (final_resp, responder_done2) = responder
            .handle_incoming(&msg3)
            .expect("responder handle msg3");
        assert!(responder_done2, "responder should be done after msg3");
        assert!(final_resp.is_empty(), "final response should be empty");

        // Both sides transition to transport
        let mut init_transport = initiator
            .into_transport()
            .expect("initiator → transport");
        let mut resp_transport = responder
            .into_transport()
            .expect("responder → transport");

        // Round-trip test: encrypt on one side, decrypt on the other
        let plaintext1 = b"hello from initiator";
        let ciphertext1 = init_transport
            .encrypt(plaintext1)
            .expect("initiator encrypt");
        let decrypted1 = resp_transport
            .decrypt(&ciphertext1)
            .expect("responder decrypt");
        assert_eq!(decrypted1, plaintext1);

        // Reverse direction
        let plaintext2 = b"hello from responder";
        let ciphertext2 = resp_transport
            .encrypt(plaintext2)
            .expect("responder encrypt");
        let decrypted2 = init_transport
            .decrypt(&ciphertext2)
            .expect("initiator decrypt");
        assert_eq!(decrypted2, plaintext2);
    }

    /// Verify that the handshake produces different keys each time (forward secrecy).
    #[test]
    fn test_forward_secrecy() {
        let (init_static_priv, init_static_pub) = generate_keypair();
        let (resp_static_priv, resp_static_pub) = generate_keypair();

        let plaintext = b"test message";

        // Run two independent handshakes
        let ciphertexts: Vec<Vec<u8>> = (0..2)
            .map(|_| {
                let mut init = NoiseHandshake::new_initiator(&init_static_priv, &resp_static_pub)
                    .unwrap();
                let mut resp = NoiseHandshake::new_responder(&resp_static_priv, &init_static_pub)
                    .unwrap();

                let msg1 = init.initiate().unwrap();
                let (msg2, _) = resp.handle_incoming(&msg1).unwrap();
                let (msg3, _) = init.handle_incoming(&msg2).unwrap();
                let _ = resp.handle_incoming(&msg3).unwrap();

                let mut transport = init.into_transport().unwrap();
                transport.encrypt(plaintext).unwrap()
            })
            .collect();

        // Same plaintext should produce different ciphertexts (ephemeral keys differ)
        assert_ne!(ciphertexts[0], ciphertexts[1],
            "Noise IK should produce different session keys each handshake");
    }

    /// Test that invalid handshake messages are rejected.
    #[test]
    fn test_handshake_rejects_garbage() {
        let (init_static_priv, init_static_pub) = generate_keypair();
        let (resp_static_priv, _resp_static_pub) = generate_keypair();

        let mut responder = NoiseHandshake::new_responder(&resp_static_priv, &init_static_pub)
            .unwrap();

        // Feed garbage bytes to responder — should fail
        let garbage = vec![0xFFu8; 100];
        let result = responder.handle_incoming(&garbage);
        assert!(result.is_err(), "responder should reject garbage handshake msg");
    }

    /// Test that transport encrypt-then-decrypt with wrong keypair fails.
    #[test]
    fn test_transport_key_mismatch() {
        let (init_priv, init_pub) = generate_keypair();
        let (resp_priv, resp_pub) = generate_keypair();

        // Honest handshake between init and resp
        let mut init = NoiseHandshake::new_initiator(&init_priv, &resp_pub).unwrap();
        let mut resp = NoiseHandshake::new_responder(&resp_priv, &init_pub).unwrap();

        let msg1 = init.initiate().unwrap();
        let (msg2, _) = resp.handle_incoming(&msg1).unwrap();
        let (msg3, _) = init.handle_incoming(&msg2).unwrap();
        let _ = resp.handle_incoming(&msg3).unwrap();

        let mut transport = init.into_transport().unwrap();

        // Encrypt with correct transport
        let ct = transport.encrypt(b"secret").unwrap();

        // Now try to decrypt with a different transport (separate handshake)
        let (attacker_priv, attacker_pub) = generate_keypair();
        let mut attacker_init = NoiseHandshake::new_initiator(&attacker_priv, &resp_pub).unwrap();
        let mut attacker_resp = NoiseHandshake::new_responder(&resp_priv, &attacker_pub).unwrap();
        let a1 = attacker_init.initiate().unwrap();
        let (a2, _) = attacker_resp.handle_incoming(&a1).unwrap();
        let (a3, _) = attacker_init.handle_incoming(&a2).unwrap();
        let _ = attacker_resp.handle_incoming(&a3).unwrap();
        let mut attacker_transport = attacker_init.into_transport().unwrap();

        // Decrypt should fail — different session key
        let result = attacker_transport.decrypt(&ct);
        assert!(result.is_err(), "decrypt with wrong key must fail");
    }

    /// Verify negotiation byte constants.
    #[test]
    fn test_negotiation_bytes() {
        assert!(is_valid_negotiation_byte(0x00));
        assert!(is_valid_negotiation_byte(0x01));
        assert!(!is_valid_negotiation_byte(0x02));
        assert!(!is_valid_negotiation_byte(0xFF));
    }
}
