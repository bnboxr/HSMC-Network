#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Astra-HSMC Node — Quick Start Script
# Runs: RPC (port 8080) + Stratum (port 3333) + P2P sync + Solo Miner
# RocksDB data persisted to HSMC_DATA_DIR (default: ./hsmc-data)
#
# Usage:
#   ./start.sh                                   # mainnet, defaults
#   MINER_ADDRESS=0xYOUR_ADDR ./start.sh         # with custom miner address
#   RUST_LOG=debug ./start.sh                    # verbose logging
#   HSMC_DATA_DIR=/var/hsmc ./start.sh           # custom data directory
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MINER_ADDRESS="${MINER_ADDRESS:-HSMC_NODE_MINER_000000000000000000000000000000000000000}"
HSMC_DATA_DIR="${HSMC_DATA_DIR:-./hsmc-data}"
RPC_PORT="${RPC_PORT:-8080}"
STRATUM_PORT="${STRATUM_PORT:-3333}"
LOG_LEVEL="${RUST_LOG:-info}"

echo "╔═══════════════════════════════════════════════════╗"
echo "║  Astra-HSMC Node v0.1.0  |  Chain ID: 8888       ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""
echo "  RPC Server  :  http://0.0.0.0:${RPC_PORT}"
echo "  Stratum     :  ws://0.0.0.0:${STRATUM_PORT}"
echo "  Data Dir    :  ${HSMC_DATA_DIR}"
echo "  Miner Addr  :  ${MINER_ADDRESS:0:20}..."
echo "  Log Level   :  ${LOG_LEVEL}"
echo ""

# ── Check Rust ────────────────────────────────────────────────────
if ! command -v cargo &>/dev/null; then
    echo "❌  Rust/cargo not found."
    echo "    Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi
echo "✅  Rust $(rustc --version)"

# ── Check RocksDB dependencies (Ubuntu/Debian) ────────────────────
if command -v apt-get &>/dev/null && ! dpkg -l librocksdb-dev &>/dev/null 2>&1; then
    echo "⚠️   RocksDB dev library not found. Installing..."
    sudo apt-get install -y librocksdb-dev libclang-dev || true
fi

# ── Build ─────────────────────────────────────────────────────────
echo ""
echo "🔨  Building release binary (this may take 2-5 minutes on first run)..."
cargo build --release --bin hsmc-node

echo ""
echo "✅  Build complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Node starting. Press Ctrl+C to stop."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Run ───────────────────────────────────────────────────────────
exec env \
    RUST_LOG="${LOG_LEVEL}" \
    MINER_ADDRESS="${MINER_ADDRESS}" \
    HSMC_DATA_DIR="${HSMC_DATA_DIR}" \
    RPC_PORT="${RPC_PORT}" \
    STRATUM_PORT="${STRATUM_PORT}" \
    ./target/release/hsmc-node
