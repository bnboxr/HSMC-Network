# HSMC Rust Node

Full production-ready Rust blockchain node for the HSMC network.

## Structure

```
rust-node/
├── Cargo.toml              # Workspace
├── start.sh                # One-command bootstrap
├── hsmc-core/              # Block, Transaction, Chain, Mempool
├── hsmc-crypto/            # PoW miner, LSAG Ring Signatures, Stealth Addresses, RingCT
├── hsmc-p2p/               # Peer registry, Gossip, Dandelion++, Sync
├── hsmc-rpc/               # Axum HTTP server, JSON-RPC handlers, Bridge API
├── hsmc-stratum/           # WebSocket Stratum server (mining pool protocol)
└── hsmc-node/              # Main binary — wires everything together
```

## Quick Start

```bash
# Prerequisites: Rust >= 1.75 (https://rustup.rs)

cd rust-node
chmod +x start.sh
MINER_ADDRESS="YOUR_HSMC_ADDRESS" ./start.sh
```

## Ports

| Service   | Port | Protocol       |
|-----------|------|----------------|
| JSON-RPC  | 8080 | HTTP/REST      |
| Stratum   | 3333 | WebSocket      |

## API Endpoints

| Method | Path                  | Description              |
|--------|-----------------------|--------------------------|
| GET    | /health               | Node health check        |
| GET    | /info                 | Chain info + peer count  |
| GET    | /block/latest         | Latest block             |
| GET    | /block/:number        | Block by number          |
| GET    | /mempool              | Pending transactions     |
| POST   | /tx/submit            | Submit transaction       |
| GET    | /mining/info          | Current mining job       |
| POST   | /mining/submit        | Submit mined block       |
| POST   | /bridge/lock          | Lock HSMC → wHSMC        |
| GET    | /bridge/status/:hash  | Bridge status            |

## Connect Web Platform

In the platform's Edge Function (supabase/functions), set:
```
RUST_NODE_URL=http://YOUR_VPS_IP:8080
```

The frontend already calls `/mining/info`, `/tx/submit`, and `/bridge/lock`
through the Edge Function proxy.

## Web Miner (Stratum)

The `MiningRPCClient` component in the web app connects to:
```
ws://YOUR_VPS_IP:3333
```
Set Pool URL to your VPS IP in the mining configuration panel.

## Deploy on VPS

```bash
# Ubuntu/Debian VPS
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
git clone YOUR_REPO && cd YOUR_REPO/rust-node
MINER_ADDRESS="YOUR_HSMC_ADDRESS" ./start.sh

# Run as service (systemd)
sudo systemctl enable hsmc-node
sudo systemctl start hsmc-node
```
