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
MCP_PORT="${MCP_PORT:-8001}"
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

# ── 6. OpenClaw Gateway ───────────────────────────────────────────────
echo "[6/7] Installing OpenClaw Gateway …"
npm install -g openclaw --silent 2>/dev/null || true

# Register Google AI Studio API key if provided
if [ -n "${GOOGLE_API_KEY:-}" ]; then
  echo "$GOOGLE_API_KEY" | openclaw models auth paste-api-key --provider google
  openclaw models set google/gemini-2.5-flash
fi

OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
cat > /tmp/openclaw.service <<EOF2
[Unit]
Description=Grounded Answer Desk — OpenClaw Gateway
After=network.target mcp-server.service
Wants=mcp-server.service

[Service]
Type=simple
User=${USER}
WorkingDirectory=${HOME}
ExecStart=/usr/bin/node /usr/lib/node_modules/openclaw/dist/index.js gateway run --port ${OPENCLAW_PORT} --bind lan --force
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF2
sudo mv /tmp/openclaw.service /etc/systemd/system/openclaw.service
sudo systemctl daemon-reload
sudo systemctl enable openclaw
sudo systemctl restart openclaw

# ── 7. Frontend (Next.js) ─────────────────────────────────────────────
echo "[7/7] Building and starting Next.js frontend …"
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
echo "  MCP server:      http://$(hostname -I | awk '{print $1}'):${MCP_PORT}/mcp"
echo "  OpenClaw GW:     http://$(hostname -I | awk '{print $1}'):${OPENCLAW_PORT:-18789}"
echo "  Frontend:        http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "Set these on Vercel:"
echo "  OPENCLAW_URL=http://$(hostname -I | awk '{print $1}'):${OPENCLAW_PORT:-18789}"
echo "  MCP_URL=http://$(hostname -I | awk '{print $1}'):${MCP_PORT}/mcp"
