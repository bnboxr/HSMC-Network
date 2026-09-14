#!/usr/bin/env bash
# HSMC Network — production start (Option A)
#
# Starts both production services detached (survive terminal exit / SSH drop):
#   (a) API server   -> :3001   bun server/api-server.ts
#   (b) Frontend     -> :3000   bun server/hsmc-frontend-server.ts
#
# Logs:  ${HSMC_LOG_DIR:-/home/team/shared/logs}/api-server.log  and  proxy.log
#
# Secrets come exclusively from .env at the repo root — bun loads it
# automatically; nothing is hardcoded in this script and no secret leaves
# this environment.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${HSMC_LOG_DIR:-/home/team/shared/logs}"
mkdir -p "$LOG_DIR"

cd "$REPO_DIR" # bun loads .env from the repo root (cwd)

# --- 1) API server on :3001 -------------------------------------------------
setsid nohup bun server/api-server.ts >>"$LOG_DIR/api-server.log" 2>&1 </dev/null &
APIPID=$!
echo "$APIPID" >"$LOG_DIR/api-server.pid"

# --- 2) Frontend proxy on :3000 ---------------------------------------------
setsid nohup bun server/hsmc-frontend-server.ts >>"$LOG_DIR/proxy.log" 2>&1 </dev/null &
PROXYPID=$!
echo "$PROXYPID" >"$LOG_DIR/proxy.pid"

echo "HSMC start: api-server pid=$APIPID (log: $LOG_DIR/api-server.log), proxy pid=$PROXYPID (log: $LOG_DIR/proxy.log)"

# --- Wait for both to be listening ------------------------------------------
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null http://localhost:3001/health && curl -fsS -o /dev/null http://localhost:3000/ && break
  sleep 1
done

curl -fsS -o /dev/null http://localhost:3001/health \
  || { echo "ERROR: api-server :3001 not listening after 30s — see $LOG_DIR/api-server.log"; exit 1; }
curl -fsS -o /dev/null http://localhost:3000/ \
  || { echo "ERROR: frontend proxy :3000 not listening after 30s — see $LOG_DIR/proxy.log"; exit 1; }

echo "HSMC listening: api-server on :3001, frontend proxy on :3000"
