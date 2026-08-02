#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════
# verify-chain-identity.sh — HSMC chain identity / config consistency check
#
# Exposes the KNOWN mismatch between the hardcoded node chain identity
# (numeric chain_id 8888) and rust-node/config/genesis.toml
# (chain_id = "hsmc-mainnet-1", a documentation-only file that NO code
# reads). Also guards operators against mistaking placeholder seed entries
# for live seeds.
#
# Usage:  sh rust-node/config/verify-chain-identity.sh
# Exit:   0 = expected state confirmed (mismatch is documented/expected)
#         1 = unexpected state (a source of truth changed, or a file is
#             missing — re-check before treating anything as authoritative)
# No Rust toolchain or build required. POSIX sh + grep only.
# ═══════════════════════════════════════════════════════════════════════
set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CORE="$ROOT/rust-node/hsmc-core/src"
NODE="$ROOT/rust-node/hsmc-node/src"
RPC="$ROOT/rust-node/hsmc-rpc/src"
GENESIS_TOML="$ROOT/rust-node/config/genesis.toml"

fail=0

echo "═ HSMC chain identity verification ═"

# ── 1. Authoritative chain ID in code ────────────────────────────────
MAIN_DEFAULT="$(grep -o 'env_u64("CHAIN_ID", *[0-9]*' "$NODE/main.rs" | head -1)"
CHAIN_RS="$(grep -o 'chain_id: *[0-9][0-9]*' "$CORE/chain.rs" | head -1)"
RPC_SRV="$(grep -o 'chain_id: *[0-9][0-9]*' "$RPC/server.rs" | head -1)"
RPC_HANDLERS="$(grep -o '"chain_id": *[0-9]*' "$RPC/handlers.rs" | head -1)"

echo "  code: $NODE/main.rs          -> ${MAIN_DEFAULT:-MISSING}"
echo "  code: $CORE/chain.rs         -> ${CHAIN_RS:-MISSING}"
echo "  code: $RPC/server.rs         -> ${RPC_SRV:-MISSING}"
echo "  code: $RPC/handlers.rs       -> ${RPC_HANDLERS:-MISSING}"

for src in "$MAIN_DEFAULT" "$CHAIN_RS" "$RPC_SRV" "$RPC_HANDLERS"; do
    case "$src" in
        *8888*) ;;
        *) echo "  ✗ UNEXPECTED: '$src' — chain ID source of truth changed?"; fail=1 ;;
    esac
done

# ── 2. genesis.toml (non-authoritative) ──────────────────────────────
if [ -f "$GENESIS_TOML" ]; then
    DOC_ID="$(grep -E '^chain_id[[:space:]]*=' "$GENESIS_TOML" | head -1 | tr -d ' "')"
    echo "  doc : $GENESIS_TOML          -> ${DOC_ID:-MISSING} (documentation only)"
    case "$DOC_ID" in
        chain_id=hsmc-mainnet-1)
            echo "  ✓ KNOWN MISMATCH confirmed: doc uses \"hsmc-mainnet-1\", node uses 8888."
            echo "    genesis.toml is NOT parsed by any code — this mismatch has no runtime effect."
            ;;
        *)
            echo "  ✗ UNEXPECTED: genesis.toml chain_id changed from hsmc-mainnet-1."
            echo "    Re-check the mismatch documentation before proceeding."
            fail=1
            ;;
    esac
else
    echo "  ✗ $GENESIS_TOML missing."
    fail=1
fi

# ── 3. Placeholder seed guard ────────────────────────────────────────
PLACEHOLDERS="$(grep -c 'ip *= *"0\.0\.0\.0"' "$GENESIS_TOML" 2>/dev/null || true)"
echo "  placeholders: $PLACEHOLDERS seed entry/entries in genesis.toml use ip 0.0.0.0"
echo "    ⚠  These are NOT live seeds. No HSMC mainnet seed nodes exist."
echo "    ⚠  Do not advertise, connect to, or publish any address from genesis.toml."
if [ "$PLACEHOLDERS" -gt 0 ] 2>/dev/null; then
    echo "  ✓ Placeholder guard confirmed (entries marked in-file as NOT LIVE)."
else
    echo "  ✓ No placeholder seed entries found — but still no live seeds exist."
fi

# ── Summary ──────────────────────────────────────────────────────────
echo "═"
if [ "$fail" -eq 0 ]; then
    echo "RESULT: expected state — node chain_id = 8888; genesis.toml = non-authoritative doc."
    exit 0
else
    echo "RESULT: UNEXPECTED — chain identity sources diverged. Investigate before mainnet."
    exit 1
fi
