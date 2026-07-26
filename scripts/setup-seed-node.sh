#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
# HSMC Mainnet — Seed Node Setup Script
# ════════════════════════════════════════════════════════════════════════
# Provisions a fresh Ubuntu 22.04/24.04 VPS as an HSMC mainnet seed node.
# Run as root on a clean VPS (Hetzner, DigitalOcean, Vultr, AWS, etc.).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/bnboxr/HSMC-Network/main/scripts/setup-seed-node.sh | sudo bash
#
# Or clone and run locally:
#   git clone https://github.com/bnboxr/HSMC-Network.git
#   cd HSMC-Network
#   sudo bash scripts/setup-seed-node.sh
#
# What this script does:
#   1. Installs system dependencies (Rust, RocksDB, build tools)
#   2. Clones the HSMC Network repository
#   3. Builds the hsmc-node binary (release)
#   4. Configures a systemd service for auto-start/restart
#   5. Opens firewall ports (8080 RPC, 30303 P2P, 3333 Stratum)
#   6. Starts the node with the canonical genesis block
#   7. Enables log rotation
#
# Minimum VPS specs: 4 vCPU, 8 GB RAM, 200 GB SSD
# Estimated cost: $25–50/month depending on provider
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration (override via environment) ────────────────────────────
REPO="${REPO:-https://github.com/bnboxr/HSMC-Network.git}"
BRANCH="${BRANCH:-main}"
DATA_DIR="${DATA_DIR:-/var/hsmc}"
USER_NAME="${USER_NAME:-hsmc}"
RPC_PORT="${RPC_PORT:-8080}"
P2P_PORT="${P2P_PORT:-30303}"
STRATUM_PORT="${STRATUM_PORT:-3333}"
METRICS_PORT="${METRICS_PORT:-9090}"
CHAIN_ID="${CHAIN_ID:-hsmc-mainnet-1}"
RUST_LOG="${RUST_LOG:-info}"
MAX_PEERS="${MAX_PEERS:-64}"

# ── Colors ──────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $*${NC}"; }
info() { echo -e "${BLUE}ℹ️   $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $*${NC}"; }
err()  { echo -e "${RED}❌  $*${NC}"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}"; }

# ── Pre-flight ──────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    err "This script must be run as root."
fi

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║      HSMC Mainnet — Seed Node Setup                    ║"
echo "║      Chain: ${CHAIN_ID}                                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ═══════════════════════════════════════════════════════════════════════
step "STEP 1: Install System Dependencies"
# ═══════════════════════════════════════════════════════════════════════

info "Updating package lists..."
apt-get update -qq

info "Installing build tools and libraries..."
apt-get install -y -qq \
    curl wget git build-essential pkg-config \
    libssl-dev libclang-dev clang cmake \
    librocksdb-dev \
    jq \
    ufw \
    logrotate \
    screen \
    ca-certificates \
    lsb-release \
    gnupg

ok "System dependencies installed"

# ═══════════════════════════════════════════════════════════════════════
step "STEP 2: Install Rust Toolchain"
# ═══════════════════════════════════════════════════════════════════════

if command -v cargo &>/dev/null; then
    ok "Rust already installed: $(rustc --version)"
else
    info "Installing Rust (stable toolchain)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
    source "$HOME/.cargo/env"
    ok "Rust installed: $(rustc --version)"
fi

export PATH="$HOME/.cargo/bin:$PATH"

# ═══════════════════════════════════════════════════════════════════════
step "STEP 3: Create System User & Data Directory"
# ═══════════════════════════════════════════════════════════════════════

info "Creating system user '${USER_NAME}'..."
id -u "$USER_NAME" &>/dev/null || useradd -r -m -d "$DATA_DIR" -s /usr/sbin/nologin "$USER_NAME"

mkdir -p "$DATA_DIR"/{data,logs,config}
chown -R "$USER_NAME:$USER_NAME" "$DATA_DIR"
ok "Data directory: $DATA_DIR"

# ═══════════════════════════════════════════════════════════════════════
step "STEP 4: Clone Repository & Build Node"
# ═══════════════════════════════════════════════════════════════════════

info "Cloning HSMC Network repository (branch: ${BRANCH})..."
REPO_DIR="$DATA_DIR/hsmc-network"

if [[ -d "$REPO_DIR/.git" ]]; then
    info "Repository already exists — pulling latest..."
    sudo -u "$USER_NAME" bash -c "cd '$REPO_DIR' && git fetch origin && git checkout '$BRANCH' && git pull origin '$BRANCH'"
else
    sudo -u "$USER_NAME" bash -c "git clone --branch '$BRANCH' --depth 1 '$REPO' '$REPO_DIR'"
fi
ok "Repository ready at: $REPO_DIR"

info "Building hsmc-node (release mode — may take 5–10 minutes)..."
sudo -u "$USER_NAME" bash <<EOF
set -euo pipefail
export PATH="$HOME/.cargo/bin:\$PATH"
cd "$REPO_DIR/rust-node"
cargo build --release --bin hsmc-node
EOF

BINARY="$REPO_DIR/rust-node/target/release/hsmc-node"
if [[ ! -f "$BINARY" ]]; then
    err "Build failed! Binary not found at $BINARY"
fi
ok "Node binary built: $BINARY"
info "Binary size: $(du -h "$BINARY" | cut -f1)"

# ═══════════════════════════════════════════════════════════════════════
step "STEP 5: Copy Genesis Configuration"
# ═══════════════════════════════════════════════════════════════════════

GENESIS_SRC="$REPO_DIR/rust-node/config/genesis.toml"
GENESIS_DST="$DATA_DIR/config/genesis.toml"

if [[ -f "$GENESIS_SRC" ]]; then
    cp "$GENESIS_SRC" "$GENESIS_DST"
    chown "$USER_NAME:$USER_NAME" "$GENESIS_DST"
    ok "Genesis config copied to $GENESIS_DST"
else
    warn "genesis.toml not found in repo — the node will use its hardcoded genesis block"
fi

# ═══════════════════════════════════════════════════════════════════════
step "STEP 6: Generate Node Identity"
# ═══════════════════════════════════════════════════════════════════════

if [[ ! -f "$DATA_DIR/identity.key" ]]; then
    openssl rand -hex 32 > "$DATA_DIR/identity.key"
    chmod 600 "$DATA_DIR/identity.key"
    chown "$USER_NAME:$USER_NAME" "$DATA_DIR/identity.key"
fi

NODE_ID=$(head -c 16 "$DATA_DIR/identity.key")
ok "Node identity: ${NODE_ID}..."

# ═══════════════════════════════════════════════════════════════════════
step "STEP 7: Configure systemd Service"
# ═══════════════════════════════════════════════════════════════════════

info "Creating systemd service file..."

cat > /etc/systemd/system/hsmc-node.service <<SYSTEMDUNIT
[Unit]
Description=HSMC Mainnet Seed Node
Documentation=https://hsmc.network
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=${USER_NAME}
Group=${USER_NAME}
WorkingDirectory=${REPO_DIR}/rust-node

# Environment
Environment=RUST_LOG=${RUST_LOG}
Environment=HSMC_DATA_DIR=${DATA_DIR}/data
Environment=HSMC_NETWORK=mainnet
Environment=CHAIN_ID=8888
Environment=RPC_PORT=${RPC_PORT}
Environment=P2P_PORT=${P2P_PORT}
Environment=STRATUM_PORT=${STRATUM_PORT}
Environment=METRICS_PORT=${METRICS_PORT}
Environment=MAX_PEERS=${MAX_PEERS}
Environment=HSMC_IDENTITY_FILE=${DATA_DIR}/identity.key
Environment=HSMC_GENESIS_CONFIG=${DATA_DIR}/config/genesis.toml

# Resource limits
LimitNOFILE=65535
LimitNPROC=32768
MemoryMax=12G
CPUQuota=400%

# ExecStart
ExecStart=${BINARY}
ExecStop=/bin/kill -SIGTERM \$MAINPID

# Restart policy
Restart=always
RestartSec=10
TimeoutStartSec=120
TimeoutStopSec=60

# Logging
StandardOutput=append:${DATA_DIR}/logs/node.log
StandardError=append:${DATA_DIR}/logs/node.err

# Security hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${DATA_DIR}
ReadOnlyPaths=${REPO_DIR}/rust-node/config

[Install]
WantedBy=multi-user.target
SYSTEMDUNIT

ok "systemd service created: /etc/systemd/system/hsmc-node.service"

# ═══════════════════════════════════════════════════════════════════════
step "STEP 8: Configure Log Rotation"
# ═══════════════════════════════════════════════════════════════════════

cat > /etc/logrotate.d/hsmc-node <<LOGROTATE
${DATA_DIR}/logs/*.log ${DATA_DIR}/logs/*.err {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    maxsize 100M
}
LOGROTATE

ok "Log rotation configured"

# ═══════════════════════════════════════════════════════════════════════
step "STEP 9: Configure Firewall"
# ═══════════════════════════════════════════════════════════════════════

info "Opening firewall ports..."
if command -v ufw &>/dev/null; then
    ufw --force enable 2>/dev/null || true
    ufw allow 22/tcp comment 'SSH'
    ufw allow ${RPC_PORT}/tcp comment 'HSMC RPC API'
    ufw allow ${P2P_PORT}/tcp comment 'HSMC P2P'
    ufw allow ${STRATUM_PORT}/tcp comment 'HSMC Stratum Mining'
    ufw allow ${METRICS_PORT}/tcp comment 'HSMC Prometheus Metrics'
    ok "Firewall configured (ufw)"
else
    warn "ufw not found — please configure firewall manually"
    info "Required ports: TCP ${RPC_PORT}, ${P2P_PORT}, ${STRATUM_PORT}, ${METRICS_PORT}"
fi

# ═══════════════════════════════════════════════════════════════════════
step "STEP 10: Start Node"
# ═══════════════════════════════════════════════════════════════════════

info "Reloading systemd and enabling service..."
systemctl daemon-reload
systemctl enable hsmc-node
systemctl start hsmc-node

# Wait for startup
sleep 5

# ═══════════════════════════════════════════════════════════════════════
step "STEP 11: Verify Node Health"
# ═══════════════════════════════════════════════════════════════════════

info "Checking node health..."
HEALTH_CHECK=$(curl -s --max-time 5 "http://localhost:${RPC_PORT}/health" 2>/dev/null || echo '{"status":"unreachable"}')

if echo "$HEALTH_CHECK" | grep -q '"ok"\|"healthy"\|"chain_height"'; then
    ok "Node is healthy and responding on port ${RPC_PORT}"
    echo ""
    echo "  Health response:"
    echo "$HEALTH_CHECK" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_CHECK"
elif systemctl is-active --quiet hsmc-node; then
    warn "Node is running but health endpoint not yet responding (may be syncing)"
    info "Check logs: journalctl -u hsmc-node -f"
else
    warn "Node may have failed to start. Check:"
    echo "  systemctl status hsmc-node"
    echo "  journalctl -u hsmc-node -n 50"
fi

# ═══════════════════════════════════════════════════════════════════════
# ── Summary ─────────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════

PUBLIC_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo "unknown")

echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅  HSMC Seed Node Setup Complete!                     ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo "  📋 Node Details:"
echo "     Chain ID   : ${CHAIN_ID}"
echo "     Node ID    : ${NODE_ID}"
echo "     Public IP  : ${PUBLIC_IP}"
echo ""
echo "  🌐 Endpoints:"
echo "     RPC API    : http://${PUBLIC_IP}:${RPC_PORT}"
echo "     P2P        : ${PUBLIC_IP}:${P2P_PORT}"
echo "     Stratum    : ${PUBLIC_IP}:${STRATUM_PORT}"
echo "     Metrics    : http://${PUBLIC_IP}:${METRICS_PORT}/metrics"
echo ""
echo "  📊 Management:"
echo "     Status     : systemctl status hsmc-node"
echo "     Logs       : journalctl -u hsmc-node -f"
echo "     Node logs  : tail -f ${DATA_DIR}/logs/node.log"
echo "     Restart    : systemctl restart hsmc-node"
echo "     Stop       : systemctl stop hsmc-node"
echo ""
echo "  📁 Files:"
echo "     Binary     : ${BINARY}"
echo "     Data       : ${DATA_DIR}/data"
echo "     Config     : ${DATA_DIR}/config/genesis.toml"
echo "     Identity   : ${DATA_DIR}/identity.key"
echo "     Logs       : ${DATA_DIR}/logs/"
echo ""
echo "  🔗 Next Steps:"
echo "     1. Register this seed node's IP in the public seed list"
echo "     2. Add multiaddr to network_bootstrap_peers in genesis.toml"
echo "     3. Set up monitoring alerts (Prometheus + Grafana)"
echo "     4. Announce node availability on HSMC Discord/Telegram"
echo ""
