#!/usr/bin/env bash
# scripts/deploy.sh — Full VPS deploy from scratch
# Tested on Ubuntu 22.04 (Oracle Always-Free / DigitalOcean)
# Usage: bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Grounded Answer Desk — VPS deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Load .env ─────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill it in."
  exit 1
fi
set -o allexport; source .env; set +o allexport

# ── 1. System deps ─────────────────────────────────────────────────────
echo "[1/6] Installing system dependencies …"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pip python3-venv nodejs npm docker.io curl

sudo systemctl enable docker --now

# ── 2. Python venv + deps ─────────────────────────────────────────────
echo "[2/6] Installing Python dependencies …"
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

# ── 3. Qdrant via Docker ──────────────────────────────────────────────
echo "[3/6] Starting Qdrant …"
QDRANT_PORT="${QDRANT_PORT:-6335}"
if ! docker ps --format '{{.Names}}' | grep -q '^qdrant$'; then
  docker run -d \
    --name qdrant \
    --restart always \
    -p "${QDRANT_PORT}:6333" \
    -v "$ROOT/data/qdrant:/qdrant/storage" \
    qdrant/qdrant
fi

# Wait for Qdrant
for i in {1..30}; do
  curl -sf "http://localhost:${QDRANT_PORT}/healthz" >/dev/null 2>&1 && break || sleep 2
done

# ── 4. Ingestion ──────────────────────────────────────────────────────
echo "[4/6] Running ingestion pipeline …"
QDRANT_URL="http://localhost:${QDRANT_PORT}" \
  .venv/bin/python ingestion/run_ingestion.py

# ── 5. MCP server as systemd service ──────────────────────────────────
echo "[5/6] Installing MCP server as systemd service …"
MCP_PORT="${MCP_PORT:-8000}"
cat > /tmp/mcp-server.service <<EOF
[Unit]
Description=Grounded Answer Desk MCP Server
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=${ROOT}/mcp-server
ExecStart=${ROOT}/.venv/bin/python ${ROOT}/mcp-server/server.py
Environment="QDRANT_URL=http://localhost:${QDRANT_PORT}"
Environment="MCP_HOST=0.0.0.0"
Environment="MCP_PORT=${MCP_PORT}"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo mv /tmp/mcp-server.service /etc/systemd/system/mcp-server.service
sudo systemctl daemon-reload
sudo systemctl enable mcp-server
sudo systemctl restart mcp-server

# ── 6. Frontend (Next.js) ─────────────────────────────────────────────
echo "[6/6] Building and starting Next.js frontend …"
cd app
npm ci --silent
npm run build
# Install PM2 to keep it running
npm install -g pm2 --silent
pm2 start "npm start" --name grounded-answer-desk-frontend
pm2 save

cd "$ROOT"
echo ""
echo "✔ Deployment complete."
echo "  MCP SSE:    http://$(hostname -I | awk '{print $1}'):${MCP_PORT}/sse"
echo "  Frontend:   http://$(hostname -I | awk '{print $1}'):3000"
