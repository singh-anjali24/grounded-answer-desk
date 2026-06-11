#!/usr/bin/env bash
# scripts/start.sh — Start all services locally (for development / VPS)
# Usage: bash scripts/start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Load .env if present ─────────────────────────────────────────────
if [ -f .env ]; then
  set -o allexport
  source .env
  set +o allexport
fi

QDRANT_PORT="${QDRANT_PORT:-6335}"
MCP_PORT="${MCP_PORT:-8000}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Grounded Answer Desk — start all services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Qdrant ─────────────────────────────────────────────────────────
echo "[1/3] Starting Qdrant on port $QDRANT_PORT …"
if ! docker ps --format '{{.Names}}' | grep -q '^qdrant$'; then
  docker run -d \
    --name qdrant \
    --restart unless-stopped \
    -p "${QDRANT_PORT}:6333" \
    -p "$((QDRANT_PORT+1)):6334" \
    -v "$ROOT/data/qdrant:/qdrant/storage" \
    qdrant/qdrant
  echo "  Qdrant container started."
else
  echo "  Qdrant already running."
fi

# Wait until Qdrant is healthy
for i in {1..20}; do
  if curl -sf "http://localhost:${QDRANT_PORT}/healthz" >/dev/null 2>&1; then
    echo "  Qdrant is healthy."
    break
  fi
  sleep 1
done

# ── 2. Ingestion (run if collection is empty) ─────────────────────────
echo "[2/3] Running ingestion pipeline …"
QDRANT_URL="http://localhost:${QDRANT_PORT}" \
  python "$ROOT/ingestion/run_ingestion.py"

# ── 3. MCP server ─────────────────────────────────────────────────────
echo "[3/3] Starting MCP server on port $MCP_PORT …"
QDRANT_URL="http://localhost:${QDRANT_PORT}" \
MCP_PORT="$MCP_PORT" \
  python "$ROOT/mcp-server/server.py" &
MCP_PID=$!
echo "  MCP server PID: $MCP_PID"

echo ""
echo "✔ All services started."
echo "  Qdrant:     http://localhost:${QDRANT_PORT}"
echo "  MCP SSE:    http://localhost:${MCP_PORT}/sse"
echo ""
echo "To start the frontend:"
echo "  cd app && npm install && npm run dev"
