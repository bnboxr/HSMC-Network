#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  Astra-HSMC — Setup complet pe PC local (Ubuntu/Debian/WSL)
#  Rulează: bash setup-local.sh
#  Sau cu adresa ta: MINER_ADDRESS=0x... bash setup-local.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Culori ────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅  $*${NC}"; }
info() { echo -e "${BLUE}ℹ️   $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $*${NC}"; }
err()  { echo -e "${RED}❌  $*${NC}"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}"; }

MINER_ADDRESS="${MINER_ADDRESS:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║      Astra-HSMC Node — Setup Local Complet              ║"
echo "║      Rust Node + Cloudflare Tunnel (HTTPS gratuit)      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Verifică OS ───────────────────────────────────────────────────
if [[ ! -f /etc/debian_version ]] && [[ ! -f /etc/ubuntu_version ]] && ! grep -qi 'debian\|ubuntu' /etc/os-release 2>/dev/null; then
  warn "OS-ul nu a putut fi detectat ca Ubuntu/Debian. Continuăm oricum..."
fi

# ═══════════════════════════════════════════════════════════════════
step "PASUL 1: Instalare dependențe sistem"
# ═══════════════════════════════════════════════════════════════════
info "Actualizare pachete..."
sudo apt-get update -qq

info "Instalare build tools, librocksdb, clang..."
sudo apt-get install -y -qq \
  curl wget git build-essential pkg-config libssl-dev \
  clang cmake libclang-dev librocksdb-dev \
  screen jq ca-certificates 2>/dev/null || \
sudo apt-get install -y \
  curl wget git build-essential pkg-config libssl-dev \
  clang cmake libclang-dev \
  screen jq ca-certificates
ok "Dependențe instalate"

# ═══════════════════════════════════════════════════════════════════
step "PASUL 2: Instalare Rust"
# ═══════════════════════════════════════════════════════════════════
if command -v cargo &>/dev/null; then
  ok "Rust deja instalat: $(rustc --version)"
else
  info "Instalare Rust toolchain..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  source "$HOME/.cargo/env"
  ok "Rust instalat: $(rustc --version)"
fi
export PATH="$HOME/.cargo/bin:$PATH"

# ═══════════════════════════════════════════════════════════════════
step "PASUL 3: Instalare Cloudflared"
# ═══════════════════════════════════════════════════════════════════
if command -v cloudflared &>/dev/null; then
  ok "cloudflared deja instalat: $(cloudflared --version 2>&1 | head -1)"
else
  info "Descărcare cloudflared..."
  ARCH=$(dpkg --print-architecture 2>/dev/null || echo "amd64")
  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  wget -q -O /tmp/cloudflared.deb "$CF_URL"
  sudo dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
  ok "cloudflared instalat: $(cloudflared --version 2>&1 | head -1)"
fi

# ═══════════════════════════════════════════════════════════════════
step "PASUL 4: Adresă miner"
# ═══════════════════════════════════════════════════════════════════
if [[ -z "$MINER_ADDRESS" ]]; then
  echo ""
  echo -e "${YELLOW}  Introdu adresa ta de wallet HSMC din platformă (/app → Wallet → copiază adresa):${NC}"
  read -rp "  MINER_ADDRESS: " MINER_ADDRESS
  [[ -z "$MINER_ADDRESS" ]] && MINER_ADDRESS="HSMC_NODE_MINER_000000000000000000000000000000000000000"
fi
ok "Miner address: ${MINER_ADDRESS:0:20}..."

# Salvează în fișier .env local
cat > "$SCRIPT_DIR/.env.local" <<EOF
MINER_ADDRESS=${MINER_ADDRESS}
RPC_PORT=8080
STRATUM_PORT=3333
RUST_LOG=info
HSMC_DATA_DIR=${SCRIPT_DIR}/hsmc-data
EOF
ok "Salvat în .env.local"

# ═══════════════════════════════════════════════════════════════════
step "PASUL 5: Build nod Rust (3-5 minute)"
# ═══════════════════════════════════════════════════════════════════
cd "$SCRIPT_DIR"
info "Compilare release binary..."
if ! cargo build --release --bin hsmc-node; then
  err "Build eșuat! Verifică dependențele sau rulează: sudo apt-get install -y librocksdb-dev libclang-dev"
fi
ok "Build complet! Binary la: target/release/hsmc-node"

# ═══════════════════════════════════════════════════════════════════
step "PASUL 6: Creare scripturi de management"
# ═══════════════════════════════════════════════════════════════════

# Script pornire nod
cat > "$SCRIPT_DIR/run-node.sh" <<'RUNNODE'
#!/usr/bin/env bash
set -a
source "$(dirname "$0")/.env.local"
set +a
cd "$(dirname "$0")"
echo "🚀 Pornire Astra-HSMC Node pe portul ${RPC_PORT:-8080}..."
exec ./target/release/hsmc-node
RUNNODE
chmod +x "$SCRIPT_DIR/run-node.sh"

# Script pornire tunel
cat > "$SCRIPT_DIR/run-tunnel.sh" <<'RUNTUNNEL'
#!/usr/bin/env bash
source "$(dirname "$0")/.env.local" 2>/dev/null || true
PORT="${RPC_PORT:-8080}"
echo "🌐 Pornire Cloudflare Tunnel pentru http://localhost:${PORT}..."
echo "   Asteaptă URL-ul https://... și salvează-l în Settings → Secrets → RUST_NODE_URL"
cloudflared tunnel --url "http://localhost:${PORT}"
RUNTUNNEL
chmod +x "$SCRIPT_DIR/run-tunnel.sh"

# Script pornire ambele cu screen
cat > "$SCRIPT_DIR/start-all.sh" <<'STARTALL'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Oprire sesiuni vechi
screen -X -S hsmc-node quit 2>/dev/null || true
screen -X -S cloudflare quit 2>/dev/null || true
sleep 1

echo ""
echo "▶️  Pornire nod Rust în screen 'hsmc-node'..."
screen -dmS hsmc-node bash -c "cd '$SCRIPT_DIR' && ./run-node.sh; exec bash"
sleep 3

echo "▶️  Pornire Cloudflare Tunnel în screen 'cloudflare'..."
screen -dmS cloudflare bash -c "cd '$SCRIPT_DIR' && ./run-tunnel.sh 2>&1 | tee /tmp/cloudflare.log; exec bash"
sleep 5

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅  Totul rulează în background!"
echo ""
echo "  Afișează URL-ul Cloudflare (RUST_NODE_URL):"
echo "    grep -o 'https://[^ ]*trycloudflare.com' /tmp/cloudflare.log | tail -1"
echo ""
echo "  Revino la sesiuni:"
echo "    screen -r hsmc-node     ← log-urile nodului"
echo "    screen -r cloudflare    ← URL-ul tunelului"
echo ""
echo "  Detașare din screen: Ctrl+A apoi D"
echo "  Oprire tot: ./stop-all.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Asteaptă URL-ul cloudflare
echo ""
echo "⏳ Așteptare URL Cloudflare (max 30s)..."
for i in $(seq 1 30); do
  CF_URL=$(grep -o 'https://[^ ]*trycloudflare.com' /tmp/cloudflare.log 2>/dev/null | tail -1 || true)
  if [[ -n "$CF_URL" ]]; then
    echo ""
    echo -e "\033[1m\033[32m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
    echo -e "\033[1m\033[32m  🎉 RUST_NODE_URL = ${CF_URL}\033[0m"
    echo -e "\033[1m\033[32m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
    echo ""
    echo "  ➡️  Setează acest URL în platforma Astra-HSMC:"
    echo "      Settings → Secrets → RUST_NODE_URL → $CF_URL"
    echo ""
    break
  fi
  sleep 1
done
STARTALL
chmod +x "$SCRIPT_DIR/start-all.sh"

# Script oprire
cat > "$SCRIPT_DIR/stop-all.sh" <<'STOPALL'
#!/usr/bin/env bash
echo "🛑 Oprire Astra-HSMC Node și Cloudflare Tunnel..."
screen -X -S hsmc-node quit 2>/dev/null && echo "  ✅ Nod oprit" || echo "  ℹ️  Nodul nu rula"
screen -X -S cloudflare quit 2>/dev/null && echo "  ✅ Tunel oprit" || echo "  ℹ️  Tunelul nu rula"
echo "Done."
STOPALL
chmod +x "$SCRIPT_DIR/stop-all.sh"

# Script status
cat > "$SCRIPT_DIR/status.sh" <<'STATUS'
#!/usr/bin/env bash
source "$(dirname "$0")/.env.local" 2>/dev/null || true
PORT="${RPC_PORT:-8080}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Astra-HSMC Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
# Screen sessions
echo "  Screen sessions active:"
screen -list 2>/dev/null | grep -E 'hsmc-node|cloudflare' && echo "" || echo "  (nicio sesiune activă)"
echo ""
# Health check
echo "  Nod health check (localhost:${PORT}/health):"
curl -s --max-time 3 "http://localhost:${PORT}/health" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  ❌ Nod offline sau nu răspunde"
echo ""
# Cloudflare URL
CF_URL=$(grep -o 'https://[^ ]*trycloudflare.com' /tmp/cloudflare.log 2>/dev/null | tail -1 || true)
if [[ -n "$CF_URL" ]]; then
  echo "  🌐 RUST_NODE_URL activ: $CF_URL"
else
  echo "  🌐 RUST_NODE_URL: (rulează ./start-all.sh pentru URL)"
fi
echo ""
STATUS
chmod +x "$SCRIPT_DIR/status.sh"

ok "Scripturi create: run-node.sh, run-tunnel.sh, start-all.sh, stop-all.sh, status.sh"

# ═══════════════════════════════════════════════════════════════════
step "PASUL 7: PORNIRE"
# ═══════════════════════════════════════════════════════════════════
echo ""
info "Pornire nod + tunel în background..."
bash "$SCRIPT_DIR/start-all.sh"

# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅  Setup complet!                                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Comenzi utile:"
echo ""
echo -e "  ${CYAN}./start-all.sh${NC}   — pornește nod + tunel"
echo -e "  ${CYAN}./stop-all.sh${NC}    — oprește tot"
echo -e "  ${CYAN}./status.sh${NC}      — status + URL curent"
echo -e "  ${CYAN}screen -r hsmc-node${NC}   — log-urile nodului live"
echo -e "  ${CYAN}screen -r cloudflare${NC}  — URL-ul tunelului live"
echo ""
echo "  ⚡ Data dir: ${SCRIPT_DIR}/hsmc-data"
echo "  ⚡ Config:   ${SCRIPT_DIR}/.env.local"
echo ""
