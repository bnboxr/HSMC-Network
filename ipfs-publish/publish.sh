#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Publish HSMC Whitepaper to IPFS (web3.storage) AND GitHub Pages
# ════════════════════════════════════════════════════════════════════
# Requirements:
#   - WEB3_STORAGE_TOKEN env var (free at https://web3.storage)
#   - GH_PAGES_REPO env var (e.g. "XMC-OXR/hsmc-whitepaper")
#   - gh CLI authenticated (`gh auth login`)
#   - Whitepaper PDFs in /mnt/documents/
#
# Output:
#   - ipfs://<CID>/Whitepaper.pdf
#   - https://<org>.github.io/hsmc-whitepaper/
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

DOCS_DIR="${DOCS_DIR:-/mnt/documents}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "▶ Staging files in $WORK"
mkdir -p "$WORK/whitepaper"
cp "$DOCS_DIR/HSMC_Whitepaper_v2.pdf"            "$WORK/whitepaper/Whitepaper.pdf"           2>/dev/null || true
cp "$DOCS_DIR/HSMC_Liquidity_Mechanism.pdf"      "$WORK/whitepaper/Liquidity_Mechanism.pdf"  2>/dev/null || true
cp "$DOCS_DIR/HSMC_Rust_Audit.pdf"               "$WORK/whitepaper/Rust_Audit.pdf"           2>/dev/null || true

cat > "$WORK/whitepaper/index.html" <<'HTML'
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><title>HSMC — Whitepaper</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui;max-width:720px;margin:4rem auto;padding:1rem;line-height:1.6}a{color:#0aa}</style>
</head><body>
<h1>HSMC Whitepaper</h1>
<p>Privacy-first Layer-1 blockchain. Rust-native. RingCT + CLSAG.</p>
<ul>
  <li><a href="Whitepaper.pdf">Whitepaper v2 (PDF)</a></li>
  <li><a href="Liquidity_Mechanism.pdf">Liquidity Mechanism (PDF)</a></li>
  <li><a href="Rust_Audit.pdf">Rust Code Audit (PDF)</a></li>
</ul>
<p>Source: <a href="https://github.com/XMC-OXR/astranet-network-hub">github.com/XMC-OXR/astranet-network-hub</a></p>
</body></html>
HTML

# ── 1. IPFS publish via web3.storage ────────────────────────────────
if [[ -n "${WEB3_STORAGE_TOKEN:-}" ]]; then
  echo "▶ Publishing to IPFS via web3.storage…"
  npx --yes @web3-storage/w3cli login --token "$WEB3_STORAGE_TOKEN" >/dev/null 2>&1 || true
  CID=$(npx --yes @web3-storage/w3cli up "$WORK/whitepaper" --json | jq -r '.root["/"] // .cid')
  echo "✅ IPFS CID: $CID"
  echo "   ipfs://$CID/Whitepaper.pdf"
  echo "   https://$CID.ipfs.dweb.link/"
else
  echo "⚠ WEB3_STORAGE_TOKEN not set — skipping IPFS"
fi

# ── 2. GitHub Pages publish ─────────────────────────────────────────
if [[ -n "${GH_PAGES_REPO:-}" ]] && command -v gh >/dev/null; then
  echo "▶ Pushing to GitHub Pages: $GH_PAGES_REPO"
  REPO_DIR="$WORK/repo"
  gh repo clone "$GH_PAGES_REPO" "$REPO_DIR" -- --depth=1 2>/dev/null || \
    gh repo create "$GH_PAGES_REPO" --public --clone --add-readme && mv "$GH_PAGES_REPO" "$REPO_DIR"
  cp -r "$WORK/whitepaper/." "$REPO_DIR/"
  cd "$REPO_DIR"
  git add -A && git commit -m "Publish whitepaper $(date -u +%FT%TZ)" || true
  git push origin HEAD:main
  gh api -X POST "repos/$GH_PAGES_REPO/pages" -f source='{"branch":"main","path":"/"}' 2>/dev/null || true
  ORG="${GH_PAGES_REPO%%/*}"; REPO="${GH_PAGES_REPO##*/}"
  echo "✅ GitHub Pages: https://$ORG.github.io/$REPO/"
else
  echo "⚠ GH_PAGES_REPO not set or gh missing — skipping GitHub Pages"
fi

echo "Done."
