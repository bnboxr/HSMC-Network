#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# HSMC Public Seed Node — Bootstrap (Ubuntu 22.04)
# Run as root on a fresh VPS:
#   curl -fsSL https://raw.githubusercontent.com/bnboxr/HSMC-Network/main/rust-node/seed-bootstrap.sh | sudo bash
# ════════════════════════════════════════════════════════════════════
# ⚠️ STATUS: This provisions a node, but HSMC mainnet is NOT LIVE yet —
#    there are no public seed nodes. Do NOT point operators at placeholder
#    seed addresses. See rust-node/PUBLIC_MAINNET.md before running.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="${REPO:-https://github.com/bnboxr/HSMC-Network.git}"
DATA_DIR="/var/hsmc"
USER_NAME="hsmc"

if [[ $EUID -ne 0 ]]; then echo "Run as root."; exit 1; fi

echo "▶ Installing system dependencies…"
apt-get update -qq
apt-get install -y curl git build-essential pkg-config libssl-dev clang libclang-dev cmake librocksdb-dev jq

echo "▶ Creating system user $USER_NAME…"
id -u "$USER_NAME" &>/dev/null || useradd -r -m -d "$DATA_DIR" -s /usr/sbin/nologin "$USER_NAME"
mkdir -p "$DATA_DIR"/{data,logs}
chown -R "$USER_NAME:$USER_NAME" "$DATA_DIR"

echo "▶ Installing Rust (stable)…"
sudo -u "$USER_NAME" bash -c 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable'

echo "▶ Cloning repo & building hsmc-node…"
sudo -u "$USER_NAME" bash <<EOF
set -euo pipefail
cd "$DATA_DIR"
[[ -d HSMC-Network ]] || git clone --depth 1 "$REPO" HSMC-Network
cd HSMC-Network/rust-node
source "$DATA_DIR/.cargo/env"
cargo build --release --bin hsmc-node
EOF

echo "▶ Generating node identity…"
if [[ ! -f "$DATA_DIR/identity.key" ]]; then
  openssl rand -hex 32 > "$DATA_DIR/identity.key"
  chmod 600 "$DATA_DIR/identity.key"
  chown "$USER_NAME:$USER_NAME" "$DATA_DIR/identity.key"
fi
NODE_ID=$(cat "$DATA_DIR/identity.key" | head -c 16)
echo "  Node ID: $NODE_ID…"

echo "▶ Installing systemd service…"
cat >/etc/systemd/system/hsmc-node.service <<EOF
[Unit]
Description=HSMC Public Seed Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$DATA_DIR/HSMC-Network/rust-node
Environment=RUST_LOG=info
Environment=HSMC_DATA_DIR=$DATA_DIR/data
Environment=HSMC_IDENTITY_FILE=$DATA_DIR/identity.key
Environment=RPC_PORT=8080
Environment=P2P_PORT=30303
Environment=STRATUM_PORT=3333
Environment=MINER_ADDRESS=HSMC_NODE_MINER_${NODE_ID}000000000000000000000000
ExecStart=$DATA_DIR/HSMC-Network/rust-node/target/release/hsmc-node
Restart=always
RestartSec=5
StandardOutput=append:$DATA_DIR/logs/node.log
StandardError=append:$DATA_DIR/logs/node.err
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/logrotate.d/hsmc-node <<EOF
$DATA_DIR/logs/*.log $DATA_DIR/logs/*.err {
  daily
  rotate 14
  compress
  missingok
  notifempty
  copytruncate
}
EOF

echo "▶ Opening firewall ports 8080, 30303, 3333…"
if command -v ufw >/dev/null; then
  ufw allow 8080/tcp comment 'HSMC RPC'
  ufw allow 30303/tcp comment 'HSMC P2P'
  ufw allow 3333/tcp comment 'HSMC Stratum'
fi

systemctl daemon-reload
systemctl enable --now hsmc-node

echo ""
echo "✅  HSMC seed node running."
echo "   Status : systemctl status hsmc-node"
echo "   Logs   : tail -f $DATA_DIR/logs/node.log"
echo "   RPC    : curl http://$(curl -s ifconfig.me):8080/health"
echo "   Node ID: $NODE_ID"
echo ""
echo "Next: if this node is to become a public seed, coordinate with the team"
echo "      to publish its address. The public seed list is NOT live yet —"
echo "      placeholder seed entries (e.g. rust-node/config/genesis.toml) are"
echo "      documentation only and must never be advertised as live seeds."
