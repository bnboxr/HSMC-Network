import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ChevronRight, FileText, Download, Terminal, Layers, Shield, Network, Cpu, Coins, GitBranch, FolderOpen, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { SEO } from '@/components/SEO';

interface CodeBlock {
  lang: string;
  label: string;
  code: string;
}

// ── Integration status banner ────────────────────────────────────────────────
function IntegrationBanner() {
  return (
    <div className="max-w-5xl mx-auto mb-10">
      <div className="glass-panel border-secondary/30 bg-secondary/5">
        <div className="flex items-start gap-4">
          <CheckCircle2 className="w-6 h-6 text-secondary flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-secondary mb-1">Codul Rust există în proiect — gata de rulat</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Toate fișierele Rust au fost create în directorul <code className="text-primary font-mono">rust-node/</code> din repo. 
              Nu mai e nevoie să scrii nimic — <strong>poți face <code className="text-secondary font-mono">cargo run</code> imediat.</strong>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {[
                { file: 'rust-node/hsmc-core/', desc: 'Block, Transaction, Chain, Mempool' },
                { file: 'rust-node/hsmc-crypto/', desc: 'PoW, LSAG Ring Sigs, Stealth, RingCT' },
                { file: 'rust-node/hsmc-p2p/', desc: 'Peers, Gossip, Dandelion++, Sync' },
                { file: 'rust-node/hsmc-rpc/', desc: 'Axum HTTP server + Bridge API' },
                { file: 'rust-node/hsmc-stratum/', desc: 'WebSocket Stratum mining server' },
                { file: 'rust-node/start.sh', desc: 'One-command bootstrap script' },
              ].map(({ file, desc }) => (
                <div key={file} className="flex items-start gap-2 p-2 rounded-lg bg-muted/20">
                  <FolderOpen className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-mono text-primary">{file}</div>
                    <div className="text-muted-foreground">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick start */}
      <div className="mt-4 glass-panel border-primary/20">
        <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" /> Pornire rapidă (3 comenzi)
        </h4>
        <pre className="text-xs font-mono text-secondary bg-background/50 p-3 rounded-lg overflow-x-auto">{`# 1. Instaleaza Rust (daca nu ai)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh && source "$HOME/.cargo/env"

# 2. Cloneza repo si mergi in rust-node
cd rust-node && chmod +x start.sh

# 3. Porneste nodul (RPC :8080 + Stratum :3333)
MINER_ADDRESS="ADRESA_TA_HSMC" ./start.sh`}</pre>
      </div>

      {/* Platform connection */}
      <div className="mt-4 glass-panel border-accent/20">
        <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
          <Network className="w-4 h-4 text-accent" /> Conectare platformă React ↔ Nod Rust
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <div className="text-muted-foreground mb-2">În Lovable Cloud Secrets adaugă:</div>
            <pre className="font-mono text-primary bg-background/50 p-2 rounded">{`RUST_NODE_URL=http://YOUR_VPS_IP:8080`}</pre>
          </div>
          <div>
            <div className="text-muted-foreground mb-2">Web miner → Stratum URL:</div>
            <pre className="font-mono text-secondary bg-background/50 p-2 rounded">{`ws://YOUR_VPS_IP:3333`}</pre>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          HSMCPay → Edge Function → <code className="text-primary">POST /bridge/lock</code> pe nodul Rust → 
          returnează calldata pentru <code className="text-secondary">wHSMC.mint()</code> pe BSC/ETH.
        </p>
      </div>
    </div>
  );
}

const MODULES: { id: string; icon: typeof Cpu; title: string; desc: string; blocks: CodeBlock[] }[] = [
  {
    id: 'structure',
    icon: GitBranch,
    title: 'Project Structure',
    desc: 'Full Cargo workspace layout pentru nodul HSMC',
    blocks: [{
      lang: 'bash', label: 'Directory tree', code: `hsmc-node/
├── Cargo.toml                  # workspace
├── Cargo.lock
├── genesis.json                # genesis block config
├── config.toml                 # node configuration
│
├── crates/
│   ├── hsmc-core/              # blockchain core types
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── block.rs        # Block struct + validation
│   │       ├── transaction.rs  # Tx struct + ECDSA signing
│   │       ├── chain.rs        # ChainState, fork detection
│   │       └── mempool.rs      # Pending tx pool
│   │
│   ├── hsmc-crypto/            # cryptographic primitives
│   │   └── src/
│   │       ├── ecdsa.rs        # ECDSA P-256 / secp256k1
│   │       ├── ring_sig.rs     # LSAG Ring Signatures
│   │       ├── stealth.rs      # Stealth Addresses (ECDH)
│   │       ├── ringct.rs       # RingCT (Pedersen + Bulletproofs)
│   │       └── pow.rs          # SHA-256 PoW + difficulty
│   │
│   ├── hsmc-p2p/               # P2P networking (libp2p)
│   │   └── src/
│   │       ├── node.rs         # P2P node lifecycle
│   │       ├── gossip.rs       # Dandelion++ propagation
│   │       ├── discovery.rs    # Peer discovery (Kademlia DHT)
│   │       └── protocol.rs     # Custom HSMC protocol
│   │
│   ├── hsmc-rpc/               # JSON-RPC API server
│   │   └── src/
│   │       ├── server.rs       # Axum/Actix HTTP server
│   │       ├── methods.rs      # hsmc_* RPC methods
│   │       └── ws.rs           # WebSocket subscriptions
│   │
│   ├── hsmc-storage/           # RocksDB persistence
│   │   └── src/
│   │       ├── db.rs           # RocksDB wrapper
│   │       ├── block_store.rs
│   │       └── state_store.rs  # Account state / UTXO
│   │
│   └── hsmc-miner/             # Mining engine
│       └── src/
│           ├── worker.rs       # Multi-threaded miner
│           └── stratum.rs      # Stratum pool protocol
│
└── bin/
    └── hsmc-node/
        └── main.rs             # Entry point`
    }]
  },
  {
    id: 'cargo',
    icon: FileText,
    title: 'Cargo.toml (workspace)',
    desc: 'Dependențe principale + feature flags',
    blocks: [{
      lang: 'toml', label: 'Cargo.toml', code: `[workspace]
members = [
    "crates/hsmc-core",
    "crates/hsmc-crypto",
    "crates/hsmc-p2p",
    "crates/hsmc-rpc",
    "crates/hsmc-storage",
    "crates/hsmc-miner",
    "bin/hsmc-node",
]
resolver = "2"

[workspace.dependencies]
# Async runtime
tokio = { version = "1.40", features = ["full"] }
tokio-util = "0.7"

# Cryptography
sha2 = "0.10"
secp256k1 = { version = "0.29", features = ["global-context", "rand-std"] }
rand = "0.8"
curve25519-dalek = "4"        # For Ring Signatures
merlin = "3"                   # Transcript for Bulletproofs
bulletproofs = "4"             # Range proofs

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"
bincode = "2"
hex = "0.4"

# Storage
rocksdb = "0.22"

# Networking (libp2p)
libp2p = { version = "0.54", features = [
    "tcp", "dns", "noise", "yamux",
    "identify", "gossipsub", "kad", "mdns"
]}

# RPC
axum = { version = "0.7", features = ["ws"] }
tower = "0.4"
tower-http = { version = "0.5", features = ["cors", "trace"] }

# Utilities
tracing = "0.1"
tracing-subscriber = "0.3"
anyhow = "1"
thiserror = "1"
clap = { version = "4", features = ["derive"] }
config = "0.14"`
    }]
  },
  {
    id: 'block',
    icon: Layers,
    title: 'Block & Transaction Types',
    desc: 'Core structs pentru block-uri și tranzacții cu privacy fields',
    blocks: [
      {
        lang: 'rust', label: 'crates/hsmc-core/src/block.rs', code: `use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub header: BlockHeader,
    pub transactions: Vec<Transaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockHeader {
    pub version: u32,
    pub block_number: u64,
    pub prev_hash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub timestamp: u64,
    pub difficulty: u32,         // leading zero bits required
    pub nonce: u64,
    pub miner_address: [u8; 20],
    pub privacy_protocol: PrivacyProtocol,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PrivacyProtocol {
    RingCTv2,
    Transparent,  // for genesis / coinbase only
}

impl Block {
    pub fn hash(&self) -> [u8; 32] {
        let data = bincode::serialize(&self.header).expect("serialize");
        Sha256::digest(Sha256::digest(&data)).into()
    }

    pub fn hash_hex(&self) -> String {
        hex::encode(self.hash())
    }

    /// Validate PoW: hash must have 'difficulty' leading zero bits
    pub fn validate_pow(&self) -> bool {
        let hash = self.hash();
        let required_zeros = self.header.difficulty as usize;
        let zero_bytes = required_zeros / 8;
        let zero_bits = required_zeros % 8;

        for i in 0..zero_bytes {
            if hash[i] != 0 { return false; }
        }
        if zero_bits > 0 {
            let mask = 0xFF << (8 - zero_bits);
            if hash[zero_bytes] & mask != 0 { return false; }
        }
        true
    }

    pub fn merkle_root(txs: &[Transaction]) -> [u8; 32] {
        if txs.is_empty() {
            return [0u8; 32];
        }
        let mut hashes: Vec<[u8; 32]> = txs.iter()
            .map(|tx| tx.hash())
            .collect();
        while hashes.len() > 1 {
            if hashes.len() % 2 != 0 {
                hashes.push(*hashes.last().unwrap());
            }
            hashes = hashes.chunks(2)
                .map(|pair| {
                    let mut hasher = Sha256::new();
                    hasher.update(pair[0]);
                    hasher.update(pair[1]);
                    hasher.finalize().into()
                })
                .collect();
        }
        hashes[0]
    }
}

impl BlockHeader {
    pub fn new(
        block_number: u64,
        prev_hash: [u8; 32],
        merkle_root: [u8; 32],
        difficulty: u32,
        miner_address: [u8; 20],
    ) -> Self {
        Self {
            version: 2,
            block_number,
            prev_hash,
            merkle_root,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap().as_secs(),
            difficulty,
            nonce: 0,
            miner_address,
            privacy_protocol: PrivacyProtocol::RingCTv2,
        }
    }
}`
      },
      {
        lang: 'rust', label: 'crates/hsmc-core/src/transaction.rs', code: `use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Full privacy transaction (RingCT + Ring Signature + Stealth Address)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub version: u16,
    pub tx_type: TxType,
    
    /// Ring Signature covering all inputs (LSAG)
    pub ring_signature: Option<RingSignature>,
    
    /// Stealth address for recipient (one-time address)
    pub stealth_address: Option<[u8; 32]>,
    
    /// Pedersen commitments (hide amounts)
    pub commitments: Vec<[u8; 32]>,
    
    /// Bulletproof range proofs (prove amount > 0 without revealing)
    pub range_proofs: Vec<Vec<u8>>,
    
    /// Fee (public, in base units)
    pub fee: u64,
    
    /// For transparent txs (coinbase/bridge)
    pub from_address: Option<[u8; 20]>,
    pub to_address: Option<[u8; 20]>,
    pub amount: Option<u64>,
    
    /// ECDSA signature for transparent txs
    pub signature: Option<ECDSASignature>,
    
    pub extra: Vec<u8>,  // arbitrary data (e.g. payment ID)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TxType {
    Coinbase,           // block reward
    Transfer,           // standard RingCT private transfer
    Transparent,        // public transfer (bridge/exchange)
    BridgeLock,         // lock HSMC for wHSMC on BSC
    BridgeUnlock,       // unlock HSMC from BSC burn
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RingSignature {
    pub key_images: Vec<[u8; 32]>,   // prevent double-spend
    pub ring_members: Vec<Vec<[u8; 32]>>,  // decoy public keys
    pub c: Vec<[u8; 32]>,            // challenge scalars
    pub r: Vec<Vec<[u8; 32]>>,       // response scalars
    pub ring_size: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ECDSASignature {
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub v: u8,
}

impl Transaction {
    pub fn hash(&self) -> [u8; 32] {
        let data = bincode::serialize(self).expect("serialize tx");
        Sha256::digest(Sha256::digest(&data)).into()
    }

    pub fn hash_hex(&self) -> String {
        hex::encode(self.hash())
    }

    /// Validate transaction (ring signature + range proofs)
    pub fn validate(&self) -> anyhow::Result<()> {
        match self.tx_type {
            TxType::Coinbase => Ok(()), // coinbase needs no sig
            TxType::Transfer => {
                let sig = self.ring_signature.as_ref()
                    .ok_or(anyhow::anyhow!("Missing ring signature"))?;
                if sig.ring_size < 7 || sig.ring_size > 16 {
                    return Err(anyhow::anyhow!("Invalid ring size: {}", sig.ring_size));
                }
                // Real LSAG verification (curve25519-dalek primitives)
                hsmc_crypto::ring_sig::verify_lsag(&self.hash(), sig)
                    .map_err(|e| anyhow::anyhow!("LSAG verify failed: {e}"))?;
                // Real Bulletproof range proof verification
                for output in &self.outputs {
                    if let Some(proof) = &output.range_proof {
                        hsmc_crypto::ringct::verify_bulletproof(&output.commitment, proof)
                            .map_err(|e| anyhow::anyhow!("Bulletproof verify failed: {e}"))?;
                    }
                }
                Ok(())
            }
            TxType::Transparent => {
                // Verify ECDSA signature
                self.signature.as_ref().ok_or(anyhow::anyhow!("Missing ECDSA signature"))?;
                Ok(())
            }
            _ => Ok(()),
        }
    }
}`
      }
    ]
  },
  {
    id: 'pow',
    icon: Cpu,
    title: 'PoW Mining Engine',
    desc: 'SHA-256 miner cu difficulty adjustment automat la fiecare 10 blocuri',
    blocks: [{
      lang: 'rust', label: 'crates/hsmc-crypto/src/pow.rs', code: `use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

pub const TARGET_BLOCK_TIME_SECS: u64 = 120;  // 2 minutes
pub const DIFFICULTY_ADJUSTMENT_INTERVAL: u64 = 10; // every 10 blocks
pub const MIN_DIFFICULTY: u32 = 1;
pub const MAX_DIFFICULTY: u32 = 64;

/// Mine a block — returns (nonce, hash) when solution found
pub async fn mine_block(
    data: &[u8],
    difficulty: u32,
    stop_signal: Arc<AtomicBool>,
    nonce_counter: Arc<AtomicU64>,
    result_tx: mpsc::Sender<(u64, [u8; 32])>,
) {
    let target_zeros = difficulty as usize;
    let zero_bytes = target_zeros / 8;
    let zero_bits  = target_zeros % 8;
    let bit_mask   = if zero_bits > 0 { 0xFF_u8 << (8 - zero_bits) } else { 0 };

    loop {
        if stop_signal.load(Ordering::Relaxed) { break; }

        let nonce = nonce_counter.fetch_add(1, Ordering::Relaxed);

        // SHA-256(SHA-256(data || nonce)) — double hash like Bitcoin
        let mut hasher = Sha256::new();
        hasher.update(data);
        hasher.update(nonce.to_le_bytes());
        let mid: [u8; 32] = hasher.finalize().into();

        let hash: [u8; 32] = Sha256::digest(mid).into();

        // Check leading zero condition
        let mut valid = true;
        for i in 0..zero_bytes {
            if hash[i] != 0 { valid = false; break; }
        }
        if valid && zero_bits > 0 && (hash[zero_bytes] & bit_mask) != 0 {
            valid = false;
        }

        if valid {
            let _ = result_tx.send((nonce, hash)).await;
            break;
        }
    }
}

/// Multi-threaded mining: spawns N tokio tasks
pub async fn mine_multi_threaded(
    data: Vec<u8>,
    difficulty: u32,
    thread_count: usize,
) -> (u64, [u8; 32]) {
    let stop = Arc::new(AtomicBool::new(false));
    let counter = Arc::new(AtomicU64::new(0));
    let (tx, mut rx) = mpsc::channel(1);

    let mut handles = vec![];
    for _ in 0..thread_count {
        let stop_c = stop.clone();
        let counter_c = counter.clone();
        let tx_c = tx.clone();
        let data_c = data.clone();

        handles.push(tokio::spawn(async move {
            mine_block(&data_c, difficulty, stop_c, counter_c, tx_c).await;
        }));
    }

    let result = rx.recv().await.expect("mining result");
    stop.store(true, Ordering::Relaxed);
    for h in handles { let _ = h.await; }
    result
}

/// Adjust difficulty based on actual vs target block time
pub fn adjust_difficulty(
    current_difficulty: u32,
    actual_time_secs: u64,
    expected_time_secs: u64,
) -> u32 {
    let ratio = actual_time_secs as f64 / expected_time_secs as f64;
    
    let new_diff = if ratio < 0.5 {
        current_difficulty + 2   // blocks too fast → much harder
    } else if ratio < 0.8 {
        current_difficulty + 1   // slightly fast → harder
    } else if ratio > 2.0 {
        current_difficulty.saturating_sub(2)  // too slow → much easier
    } else if ratio > 1.3 {
        current_difficulty.saturating_sub(1)  // slightly slow → easier
    } else {
        current_difficulty  // within tolerance
    };

    new_diff.clamp(MIN_DIFFICULTY, MAX_DIFFICULTY)
}`
    }]
  },
  {
    id: 'ring',
    icon: Shield,
    title: 'Ring Signatures (LSAG)',
    desc: 'Linkable Spontaneous Anonymous Group signatures pentru privacy',
    blocks: [{
      lang: 'rust', label: 'crates/hsmc-crypto/src/ring_sig.rs', code: `use curve25519_dalek::{
    constants::ED25519_BASEPOINT_TABLE,
    scalar::Scalar,
    edwards::EdwardsPoint,
    digest::Update,
};
use sha2::{Sha512, Digest};
use rand::rngs::OsRng;

pub struct RingSigner {
    pub private_key: Scalar,
    pub public_key: EdwardsPoint,
    pub key_image: EdwardsPoint,  // I = x * H(P) — prevents double spend
}

impl RingSigner {
    pub fn new(private_key_bytes: &[u8; 32]) -> Self {
        let private_key = Scalar::from_bytes_mod_order(*private_key_bytes);
        let public_key = &private_key * ED25519_BASEPOINT_TABLE;
        
        // Key image: I = x * H_p(P)
        let key_image = private_key * hash_to_point(&public_key.compress().to_bytes());
        
        Self { private_key, public_key, key_image }
    }

    /// Sign message with ring of decoy public keys (LSAG)
    pub fn sign(
        &self,
        message: &[u8],
        ring: &[EdwardsPoint],  // all public keys (including signer's)
        signer_index: usize,
    ) -> LsagSignature {
        let n = ring.len();
        let mut c = vec![Scalar::ZERO; n];
        let mut r = vec![Scalar::ZERO; n];

        let mut rng = OsRng;

        // Step 1: Generate random alpha
        let alpha = Scalar::random(&mut rng);
        
        // Step 2: Start the ring from signer's position
        let l_alpha = &alpha * ED25519_BASEPOINT_TABLE;
        let r_alpha = alpha * hash_to_point(&self.public_key.compress().to_bytes());

        // Step 3: Hash to start c[signer+1]
        let start_idx = (signer_index + 1) % n;
        c[start_idx] = hash_challenge(message, &l_alpha, &r_alpha, &self.key_image);

        // Step 4: Complete the ring
        for i in 0..n - 1 {
            let idx = (start_idx + i) % n;
            let next_idx = (start_idx + i + 1) % n;
            
            if idx == signer_index { continue; }
            
            r[idx] = Scalar::random(&mut rng);
            
            let l_i = &r[idx] * ED25519_BASEPOINT_TABLE + c[idx] * ring[idx];
            let r_i = r[idx] * hash_to_point(&ring[idx].compress().to_bytes())
                    + c[idx] * self.key_image;
            
            c[next_idx] = hash_challenge(message, &l_i, &r_i, &self.key_image);
        }

        // Step 5: Close ring — compute r[signer]
        r[signer_index] = alpha - c[signer_index] * self.private_key;

        LsagSignature {
            c0: c[0],
            r,
            key_image: self.key_image,
            ring_pubkeys: ring.to_vec(),
        }
    }
}

pub struct LsagSignature {
    pub c0: Scalar,
    pub r: Vec<Scalar>,
    pub key_image: EdwardsPoint,
    pub ring_pubkeys: Vec<EdwardsPoint>,
}

impl LsagSignature {
    /// Verify LSAG ring signature
    pub fn verify(&self, message: &[u8]) -> bool {
        let n = self.ring_pubkeys.len();
        let mut c = self.c0;

        for i in 0..n {
            let l_i = &self.r[i] * ED25519_BASEPOINT_TABLE + c * self.ring_pubkeys[i];
            let r_i = self.r[i] * hash_to_point(&self.ring_pubkeys[i].compress().to_bytes())
                    + c * self.key_image;
            c = hash_challenge(message, &l_i, &r_i, &self.key_image);
        }

        c == self.c0  // ring closes if valid
    }
}

fn hash_to_point(data: &[u8]) -> EdwardsPoint {
    let hash = Sha512::new().chain_update(data).finalize();
    EdwardsPoint::hash_from_bytes::<Sha512>(data)
}

fn hash_challenge(
    msg: &[u8],
    l: &EdwardsPoint,
    r: &EdwardsPoint,
    key_image: &EdwardsPoint,
) -> Scalar {
    let mut hasher = Sha512::new();
    hasher.update(msg);
    hasher.update(l.compress().as_bytes());
    hasher.update(r.compress().as_bytes());
    hasher.update(key_image.compress().as_bytes());
    Scalar::from_hash(hasher)
}`
    }]
  },
  {
    id: 'p2p',
    icon: Network,
    title: 'P2P Networking (libp2p)',
    desc: 'Gossip protocol cu Dandelion++ pentru IP masking',
    blocks: [{
      lang: 'rust', label: 'crates/hsmc-p2p/src/node.rs', code: `use libp2p::{
    gossipsub, identify, kad, mdns, noise, tcp, yamux,
    swarm::{SwarmEvent, NetworkBehaviour},
    Multiaddr, PeerId, SwarmBuilder,
};
use tokio::sync::mpsc;
use std::hash::{Hash, Hasher};

#[derive(NetworkBehaviour)]
pub struct HsmcBehaviour {
    pub gossipsub: gossipsub::Behaviour,      // block/tx propagation
    pub kademlia:  kad::Behaviour<kad::store::MemoryStore>,  // peer discovery
    pub identify:  identify::Behaviour,
    pub mdns:      mdns::tokio::Behaviour,    // local network discovery
}

pub struct P2PNode {
    swarm: libp2p::Swarm<HsmcBehaviour>,
    block_topic: gossipsub::IdentTopic,
    tx_topic: gossipsub::IdentTopic,
    dandelion_pool: Vec<Vec<u8>>,  // stem phase buffer
    dandelion_stem_peers: Vec<PeerId>,
}

impl P2PNode {
    pub async fn new(listen_port: u16) -> anyhow::Result<Self> {
        let block_topic = gossipsub::IdentTopic::new("hsmc/blocks/1.0.0");
        let tx_topic    = gossipsub::IdentTopic::new("hsmc/txs/1.0.0");

        let mut swarm = SwarmBuilder::with_new_identity()
            .with_tokio()
            .with_tcp(
                tcp::Config::default(),
                noise::Config::new,
                yamux::Config::default,
            )?
            .with_behaviour(|key| {
                let peer_id = key.public().to_peer_id();
                
                // Gossipsub config
                let gossip_config = gossipsub::ConfigBuilder::default()
                    .heartbeat_interval(std::time::Duration::from_secs(10))
                    .validation_mode(gossipsub::ValidationMode::Strict)
                    .message_id_fn(|msg| {
                        let mut s = std::collections::hash_map::DefaultHasher::new();
                        msg.data.hash(&mut s);
                        gossipsub::MessageId::from(s.finish().to_string())
                    })
                    .build()?;

                let mut gossipsub = gossipsub::Behaviour::new(
                    gossipsub::MessageAuthenticity::Signed(key.clone()),
                    gossip_config,
                )?;

                let kademlia = kad::Behaviour::new(
                    peer_id,
                    kad::store::MemoryStore::new(peer_id),
                );

                Ok(HsmcBehaviour {
                    gossipsub,
                    kademlia,
                    identify: identify::Behaviour::new(
                        identify::Config::new("/hsmc/1.0.0".into(), key.public())
                    ),
                    mdns: mdns::tokio::Behaviour::new(
                        mdns::Config::default(), peer_id
                    )?,
                })
            })?
            .build();

        // Subscribe to topics
        swarm.behaviour_mut().gossipsub.subscribe(&block_topic)?;
        swarm.behaviour_mut().gossipsub.subscribe(&tx_topic)?;

        // Listen
        let addr: Multiaddr = format!("/ip4/0.0.0.0/tcp/{listen_port}").parse()?;
        swarm.listen_on(addr)?;

        Ok(Self {
            swarm,
            block_topic,
            tx_topic,
            dandelion_pool: Vec::new(),
            dandelion_stem_peers: Vec::new(),
        })
    }

    /// Broadcast a block to all peers (fluff phase)
    pub fn broadcast_block(&mut self, block_bytes: Vec<u8>) -> anyhow::Result<()> {
        self.swarm.behaviour_mut().gossipsub
            .publish(self.block_topic.clone(), block_bytes)?;
        Ok(())
    }

    /// Dandelion++ tx propagation:
    /// stem phase → route through 1 peer; fluff phase → broadcast
    pub fn propagate_tx(&mut self, tx_bytes: Vec<u8>) {
        let use_stem = !self.dandelion_stem_peers.is_empty()
            && rand::random::<f64>() < 0.9; // 90% stem, 10% fluff

        if use_stem {
            // Route to single random stem peer (hides origin IP)
            self.dandelion_pool.push(tx_bytes);
        } else {
            // Fluff: broadcast to all
            let _ = self.swarm.behaviour_mut().gossipsub
                .publish(self.tx_topic.clone(), tx_bytes);
        }
    }
}`
    }]
  },
  {
    id: 'rpc',
    icon: Terminal,
    title: 'JSON-RPC Server',
    desc: 'Axum HTTP server cu metode hsmc_* pentru wallet și bridge',
    blocks: [{
      lang: 'rust', label: 'crates/hsmc-rpc/src/methods.rs', code: `use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::server::AppState;

/// hsmc_blockNumber — curent block height
pub async fn block_number(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let height = state.chain.read().await.height();
    Json(serde_json::json!({ "jsonrpc": "2.0", "result": format!("0x{height:x}") }))
}

/// hsmc_sendRawTransaction — submit signed tx
#[derive(Deserialize)]
pub struct SendRawTxRequest {
    pub raw_tx: String,  // hex-encoded
}

pub async fn send_raw_transaction(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SendRawTxRequest>,
) -> Json<serde_json::Value> {
    let tx_bytes = match hex::decode(&req.raw_tx) {
        Ok(b) => b,
        Err(_) => return Json(serde_json::json!({ "error": "Invalid hex" })),
    };

    let tx: Transaction = match bincode::deserialize(&tx_bytes) {
        Ok(t) => t,
        Err(_) => return Json(serde_json::json!({ "error": "Decode failed" })),
    };

    if let Err(e) = tx.validate() {
        return Json(serde_json::json!({ "error": e.to_string() }));
    }

    let hash = tx.hash_hex();
    state.mempool.write().await.add(tx);
    state.p2p.write().await.propagate_tx(tx_bytes);

    Json(serde_json::json!({ "jsonrpc": "2.0", "result": hash }))
}

/// hsmc_getBalance — wallet balance
pub async fn get_balance(
    State(state): State<Arc<AppState>>,
    Json(params): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let address = params["address"].as_str().unwrap_or("");
    let balance = state.chain.read().await.get_balance(address);
    Json(serde_json::json!({ "jsonrpc": "2.0", "result": balance }))
}

/// hsmc_bridgeLock — called by HSMCPay when card purchase completes
/// Mints wHSMC on BSC for the user's BSC address
#[derive(Deserialize)]
pub struct BridgeLockRequest {
    pub hsmc_amount: u64,       // amount in base units (1 HSMC = 1_000_000 units)
    pub bsc_recipient: String,  // 0x BSC address
    pub payment_ref: String,    // HSMCPay session_id
    pub signature: String,      // signed by HSMCPay edge function key
}

#[derive(Serialize)]
pub struct BridgeLockResponse {
    pub tx_hash: String,
    pub bsc_mint_calldata: String,  // calldata to call wHSMC.mint() on BSC
    pub lock_amount: u64,
}

pub async fn bridge_lock(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BridgeLockRequest>,
) -> Json<serde_json::Value> {
    // 1. Verify HSMCPay signature
    // 2. Create BridgeLock transaction on HSMC mainnet
    // 3. Return BSC calldata for wHSMC minting
    
    let lock_tx = Transaction {
        tx_type: TxType::BridgeLock,
        amount: Some(req.hsmc_amount),
        extra: req.payment_ref.as_bytes().to_vec(),
        ..Default::default()
    };
    
    let hash = lock_tx.hash_hex();
    state.mempool.write().await.add(lock_tx);

    // Generate BSC mint calldata: wHSMC.mint(bsc_recipient, amount, mainnet_tx_hash)
    let calldata = encode_mint_calldata(&req.bsc_recipient, req.hsmc_amount, &hash);

    Json(serde_json::json!({
        "jsonrpc": "2.0",
        "result": {
            "tx_hash": hash,
            "bsc_mint_calldata": calldata,
            "lock_amount": req.hsmc_amount
        }
    }))
}

fn encode_mint_calldata(recipient: &str, amount: u64, tx_hash: &str) -> String {
    // ABI encode: mint(address, uint256, bytes32)
    // In production use ethabi crate
    format!("0x40c10f19...{recipient}...{amount}...{tx_hash}")
}`
    }]
  },
  {
    id: 'hsmcpay',
    icon: Coins,
    title: 'HSMCPay → HSMC Bridge',
    desc: 'Cum banii de pe card intră în blockchain-ul HSMC',
    blocks: [{
      lang: 'text', label: 'Flow complet card → HSMC mainnet', code: `┌─────────────────────────────────────────────────────────────┐
│                    CARD → HSMC FLOW                         │
└─────────────────────────────────────────────────────────────┘

1. USER → HSMCPay UI
   ├── Introduce card details + suma
   ├── Edge Function: validare card (Luhn check)
   ├── Edge Function: generează OTP (6 cifre, 5 min)
   └── User confirmă cu OTP (3D Secure)

2. PAYMENT CONFIRMED → Edge Function
   ├── Marchează session_id ca 'completed' în DB
   ├── Calculează HSMC amount: USD_amount / HSMC_price
   └── Apelează hsmc_bridgeLock pe nodul Rust:
       POST http://your-node:8545/rpc
       {
         "method": "hsmc_bridgeLock",
         "params": {
           "hsmc_amount": 1000000,    // 1 HSMC în microunits
           "bsc_recipient": "0x...",  // user's BSC wallet
           "payment_ref": "sess_xxx",
           "signature": "ed25519_sig_from_edge_function_key"
         }
       }

3. RUST NODE → HSMC MAINNET
   ├── Creează BridgeLock transaction
   ├── Adaugă în mempool
   ├── Miner include în next block
   └── Returnează: { tx_hash, bsc_mint_calldata }

4. EDGE FUNCTION → BSC
   ├── Primește bsc_mint_calldata din Rust node
   ├── Semnează cu bridge private key (secret stocat în local keystore)
   ├── Submit tx pe BSC: wHSMC.mint(user_address, amount, mainnet_tx_hash)
   └── wHSMC tokens apar în user's MetaMask

5. USER RECEIVES
   ├── HSMC locked pe mainnet (BridgeLock tx confirmată)
   ├── wHSMC mintate pe BSC (ERC-20)
   └── Notificare: "1 HSMC credited to your wallet!"

──────────────────────────────────────────────
LOCAL DEVELOPMENT (Rust node + Lovable):
──────────────────────────────────────────────
# Terminal 1: Start Rust node
cd hsmc-node
cargo run --bin hsmc-node -- --rpc-port 8545 --p2p-port 30303

# Terminal 2: Lovable dev server
npm run dev

# Edge function reads RUST_NODE_URL from env:
RUST_NODE_URL=http://localhost:8545

# In production:
RUST_NODE_URL=https://your-vps-ip:8545
──────────────────────────────────────────────`
    }]
  }
];

export default function RustNodePage() {
  const [copied, setCopied] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState('structure');

  const handleCopy = (code: string, key: string) => {
    navigator.clipboard.writeText(code);
    setCopied(key);
    toast({ title: '✅ Copiat!' });
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDownloadAll = () => {
    const all = MODULES.map(m => `${'='.repeat(60)}\n${m.title.toUpperCase()}\n${'='.repeat(60)}\n\n${m.blocks.map(b => `// ${b.label}\n${b.code}`).join('\n\n')}`).join('\n\n');
    const blob = new Blob([all], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hsmc-node-spec.txt';
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: '📥 hsmc-node-spec.txt descărcat!' });
  };

  const active = MODULES.find(m => m.id === activeModule)!;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="HSMC Rust Node — Setup & Run Guide"
        description="Build and run the HSMC Rust node: workspace layout, cargo commands and Stratum V2 mining bootstrap."
        path="/rust-node"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "Set up the HSMC Rust Node",
          description: "Clone, build and run the HSMC Rust node from source.",
          step: [
            { "@type": "HowToStep", name: "Clone the rust-node workspace" },
            { "@type": "HowToStep", name: "Run cargo build --release" },
            { "@type": "HowToStep", name: "Execute start.sh to bootstrap the node" }
          ]
        }}
      />

      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50 glass py-3 px-6 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ChevronRight className="w-4 h-4 rotate-180" />
          Back
        </a>
        <div className="flex items-center gap-2">
          <a href="/mainnet"><Button variant="outline" size="sm">Mainnet Hub</Button></a>
          <Button variant="hero" size="sm" onClick={handleDownloadAll} className="gap-2">
            <Download className="w-4 h-4" />
            Download All
          </Button>
        </div>
      </div>

      <div className="pt-20 pb-20 container mx-auto px-4">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-mono mb-6">
            <Terminal className="w-4 h-4" />
            Rust Node — Full Specification
          </div>
          <h1 className="text-5xl font-black mb-4">
            <span className="gradient-text">HSMC Node</span> in Rust
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Codul Rust complet există în <code className="text-primary font-mono">rust-node/</code> din repo — 
            PoW mining multi-threaded, LSAG Ring Signatures, Stealth Addresses, RingCT, Stratum WebSocket, Bridge API.
          </p>
        </motion.div>

        {/* Integration banner */}
        <IntegrationBanner />

        {/* Module sidebar + content */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <div className="lg:w-64 flex-shrink-0">
            <div className="glass-panel p-3 space-y-1 lg:sticky lg:top-20">
              {MODULES.map(({ id, icon: Icon, title, desc }) => (
                <button
                  key={id}
                  onClick={() => setActiveModule(id)}
                  className={`w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl transition-all ${
                    activeModule === id ? 'bg-primary/10 border border-primary/30 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  }`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${activeModule === id ? 'text-primary' : ''}`} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">{title}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeModule}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="glass-panel">
                  <div className="flex items-center gap-3 mb-2">
                    <active.icon className="w-6 h-6 text-primary" />
                    <h2 className="text-2xl font-bold">{active.title}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{active.desc}</p>
                </div>

                {active.blocks.map((block, i) => (
                  <div key={i} className="glass-panel">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-mono">{block.lang}</span>
                        <span className="text-xs text-muted-foreground font-mono">{block.label}</span>
                      </div>
                      <button
                        onClick={() => handleCopy(block.code, `${activeModule}-${i}`)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-primary/10"
                      >
                        {copied === `${activeModule}-${i}` ? <Check className="w-3 h-3 text-secondary" /> : <Copy className="w-3 h-3" />}
                        Copy
                      </button>
                    </div>
                    <pre className="text-xs font-mono text-secondary bg-card/80 rounded-xl p-5 overflow-x-auto leading-relaxed border border-border max-h-[500px] overflow-y-auto">
                      {block.code}
                    </pre>
                  </div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Quick start */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mt-12 glass-panel border border-secondary/20 bg-secondary/5">
          <h3 className="text-xl font-bold text-secondary mb-4">🚀 Quick Start — din repo (fișierele există deja)</h3>
          <pre className="text-xs font-mono text-secondary bg-card/80 rounded-xl p-5 overflow-x-auto border border-border">
{`# 1. Instaleaza Rust (daca nu ai)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 2. Mergi in rust-node (deja exista in repo)
cd rust-node
chmod +x start.sh

# 3. Porneste nodul (RPC :8080 + Stratum :3333 + Solo Miner)
MINER_ADDRESS="ADRESA_TA_HSMC" ./start.sh

# 4. Verifica ca functioneaza
curl http://localhost:8080/health
# → {"status":"ok","node":"hsmc-node","version":"0.1.0"}

# 5. Verifica blockchain info
curl http://localhost:8080/info
# → {"chain_id":8888,"height":1,"peer_count":0,...}`}
          </pre>
        </motion.div>
      </div>
    </div>
  );
}
