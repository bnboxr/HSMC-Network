#!/usr/bin/env bash
# ================================================================
# HSMC Node — Full VPS Deploy Script
# Tested on Ubuntu 22.04 LTS (DigitalOcean / Hetzner)
#
# Usage:
#   chmod +x deploy.sh
#   sudo DOMAIN=node.yourdomain.com EMAIL=you@email.com ./deploy.sh
#
# What this script does:
#   1. Installs Rust, build dependencies
#   2. Creates dedicated hsmc user
#   3. Builds the release binary
#   4. Installs systemd service
#   5. Installs nginx with HTTPS (Let's Encrypt via certbot)
#   6. Configures UFW firewall (ports 22, 80, 443, 3333)
# ================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
MINER_ADDRESS="${MINER_ADDRESS:-HSMC_NODE_MINER_000000000000000000000000000000000000000}"
RPC_PORT="${RPC_PORT:-8080}"
STRATUM_PORT="${STRATUM_PORT:-3333}"
DATA_DIR="${DATA_DIR:-/var/lib/hsmc-node}"
INSTALL_DIR="${INSTALL_DIR:-/opt/hsmc-node}"
SERVICE_USER="hsmc"
BINARY_NAME="hsmc-node"

# ── Colors ───────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   HSMC Node — VPS Deploy Script             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""

[[ $EUID -ne 0 ]] && error "This script must be run as root (sudo)"

# ── 1. System packages ────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq
apt-get install -y -qq \
    curl wget git build-essential pkg-config libssl-dev \
    clang cmake libclang-dev \
    nginx certbot python3-certbot-nginx \
    ufw fail2ban \
    ca-certificates gnupg lsb-release

success "System packages installed"

# ── 2. Install Rust ────────────────────────────────────────────────
if ! command -v cargo &>/dev/null; then
    info "Installing Rust toolchain..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
    source "$HOME/.cargo/env"
    success "Rust $(rustc --version) installed"
else
    success "Rust already installed: $(rustc --version)"
fi

export PATH="$HOME/.cargo/bin:$PATH"

# ── 3. Create service user ─────────────────────────────────────────
if ! id "$SERVICE_USER" &>/dev/null; then
    info "Creating user '$SERVICE_USER'..."
    useradd -r -s /bin/bash -d "$DATA_DIR" -m "$SERVICE_USER"
    success "User '$SERVICE_USER' created"
else
    success "User '$SERVICE_USER' already exists"
fi

# ── 4. Copy source and build ───────────────────────────────────────
info "Setting up installation directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -r rust-node/. "$INSTALL_DIR/"

info "Building HSMC node in release mode (this takes 3-5 minutes)..."
cd "$INSTALL_DIR"
# Run as root but cargo needs $HOME
HOME=/root cargo build --release --bin "$BINARY_NAME" 2>&1 | tail -20

success "Build complete!"

# ── 5. Install binary ─────────────────────────────────────────────
cp "$INSTALL_DIR/target/release/$BINARY_NAME" "/usr/local/bin/$BINARY_NAME"
chmod +x "/usr/local/bin/$BINARY_NAME"
mkdir -p "$DATA_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
success "Binary installed to /usr/local/bin/$BINARY_NAME"

# ── 6. systemd service ─────────────────────────────────────────────
info "Installing systemd service..."
cat > /etc/systemd/system/hsmc-node.service <<EOF
[Unit]
Description=HSMC Blockchain Node
Documentation=https://github.com/bnboxr/HSMC-Network
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${DATA_DIR}

Environment="RUST_LOG=info"
Environment="MINER_ADDRESS=${MINER_ADDRESS}"
Environment="HSMC_DATA_DIR=${DATA_DIR}"
Environment="RPC_PORT=${RPC_PORT}"
Environment="STRATUM_PORT=${STRATUM_PORT}"

ExecStart=/usr/local/bin/${BINARY_NAME}
ExecReload=/bin/kill -HUP \$MAINPID

Restart=on-failure
RestartSec=10
TimeoutStopSec=30

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR}
ProtectHome=true

# Resource limits
LimitNOFILE=65535
LimitNPROC=32768

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable hsmc-node
success "systemd service installed and enabled"

# ── 7. nginx reverse proxy ─────────────────────────────────────────
info "Configuring nginx..."

# HTTP-only config first (for certbot challenge)
cat > /etc/nginx/sites-available/hsmc-node <<'NGINX_HTTP'
server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
NGINX_HTTP

# Replace placeholder
sed -i "s/DOMAIN_PLACEHOLDER/${DOMAIN:-_}/g" /etc/nginx/sites-available/hsmc-node
ln -sf /etc/nginx/sites-available/hsmc-node /etc/nginx/sites-enabled/hsmc-node
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
success "nginx HTTP config applied"

# Obtain TLS certificate
if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
    info "Obtaining Let's Encrypt certificate for $DOMAIN..."
    mkdir -p /var/www/certbot
    certbot --nginx -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --redirect
    
    # Full HTTPS config with RPC proxy
    cat > /etc/nginx/sites-available/hsmc-node <<NGINX_HTTPS
# HSMC Node — nginx reverse proxy
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

# HTTPS RPC proxy (port 443 → 8080)
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;

    # CORS for platform Edge Functions
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;

    if (\$request_method = OPTIONS) {
        return 204;
    }

    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=rpc:10m rate=60r/m;
    limit_req zone=rpc burst=20 nodelay;

    # JSON-RPC proxy
    location / {
        proxy_pass         http://127.0.0.1:${RPC_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
        proxy_connect_timeout 5s;
    }
}

# Stratum WebSocket (port 3333 exposed directly — no nginx needed)
# Miners connect to: ws://${DOMAIN}:3333
NGINX_HTTPS

    nginx -t && systemctl reload nginx
    success "HTTPS enabled for https://${DOMAIN}"
else
    warn "DOMAIN or EMAIL not set — skipping TLS certificate. Set these env vars and re-run."
    warn "  sudo DOMAIN=node.yourdomain.com EMAIL=you@email.com ./deploy.sh"
fi

# ── 8. UFW Firewall ───────────────────────────────────────────────
info "Configuring UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh               # 22
ufw allow 'Nginx Full'      # 80 + 443
ufw allow ${STRATUM_PORT}/tcp comment 'HSMC Stratum mining'
ufw --force enable
success "Firewall configured"
ufw status verbose

# ── 9. fail2ban ───────────────────────────────────────────────────
info "Enabling fail2ban..."
systemctl enable fail2ban --now
success "fail2ban active"

# ── 10. Start node ────────────────────────────────────────────────
info "Starting HSMC node service..."
systemctl start hsmc-node
sleep 3
if systemctl is-active --quiet hsmc-node; then
    success "HSMC node is running!"
else
    warn "Node may not have started. Check: journalctl -u hsmc-node -n 50"
fi

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Deploy Complete!                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "  📡 RPC endpoint:"
if [[ -n "$DOMAIN" ]]; then
    echo "     https://${DOMAIN}/ → proxied to :${RPC_PORT}"
else
    echo "     http://YOUR_VPS_IP:${RPC_PORT}"
fi
echo ""
echo "  ⛏  Stratum WebSocket:"
if [[ -n "$DOMAIN" ]]; then
    echo "     ws://${DOMAIN}:${STRATUM_PORT}"
else
    echo "     ws://YOUR_VPS_IP:${STRATUM_PORT}"
fi
echo ""
echo "  🔐 Set RUST_NODE_URL in your environment (e.g. API-server/frontend secrets):"
if [[ -n "$DOMAIN" ]]; then
    echo "     RUST_NODE_URL=https://${DOMAIN}"
else
    echo "     RUST_NODE_URL=http://YOUR_VPS_IP:${RPC_PORT}"
fi
echo ""
echo "  📋 Useful commands:"
echo "     journalctl -u hsmc-node -f          # live logs"
echo "     systemctl restart hsmc-node          # restart"
echo "     curl http://localhost:${RPC_PORT}/health  # health check"
echo ""
