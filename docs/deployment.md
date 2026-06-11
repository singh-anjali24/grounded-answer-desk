# Deployment Guide

## Local Development

See README.md Quick Start for the full local setup. Summary:

```bash
# 1. Qdrant
docker run -d --name qdrant -p 6335:6333 -v $(pwd)/data/qdrant:/qdrant/storage qdrant/qdrant

# 2. Ingestion
python ingestion/run_ingestion.py

# 3. MCP server
cd mcp-server && python server.py

# 4. Frontend
cd app && npm install && npm run dev
```

## VPS Deployment (Ubuntu 22.04)

### Provider options (all have free tiers)
- **Oracle Always-Free** — 4 ARM cores / 24 GB RAM — best for staying live ≥1 week
- DigitalOcean — $200/60 days free credit
- Google Cloud — $300/90 days
- AWS — up to $200 credit (2025 new-account model)

### One-command deploy
```bash
git clone https://github.com/YOUR_USERNAME/grounded-answer-desk.git
cd grounded-answer-desk
cp .env.example .env
# Fill in .env (especially LLM_BASE_URL if using Ollama Cloud)
bash scripts/deploy.sh
```

### What deploy.sh does
1. `apt install python3 nodejs npm docker.io`
2. Creates `.venv/` and installs `requirements.txt`
3. Starts Qdrant Docker container with persistent volume at `data/qdrant/`
4. Runs ingestion pipeline
5. Registers `mcp-server.service` in systemd (auto-start on reboot)
6. Builds Next.js and runs with PM2

### Environment variables (VPS)
```
QDRANT_URL=http://localhost:6335
MCP_HOST=0.0.0.0         # bind to all interfaces on VPS
MCP_PORT=8000
LLM_BASE_URL=https://openrouter.ai/api/v1   # or Ollama Cloud
LLM_MODEL=meta-llama/llama-3.2-3b-instruct
LLM_API_KEY=<your_key>
```

## Frontend → Vercel

1. Push the repo to GitHub.
2. In Vercel dashboard: New Project → import the repo → set **Root Directory** to `app`.
3. Add environment variables:
   - `MCP_HTTP_URL` — the public VPS URL of the MCP server (or a reverse-proxied path)
   - `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`
4. Deploy. Vercel auto-builds on every push.

## Keeping It Running (≥7 days)

- Qdrant: `--restart always` Docker flag ensures it survives reboots.
- MCP server: systemd `Restart=always` with `RestartSec=5`.
- Frontend: PM2 with `pm2 save` + `pm2 startup`.
- Vercel: always-on by default (serverless).

## Monitoring

```bash
# Check MCP server status
sudo systemctl status mcp-server

# View MCP server logs
sudo journalctl -u mcp-server -f

# Qdrant dashboard
open http://<VPS_IP>:6335/dashboard

# Run smoke tests
bash scripts/smoke-test.sh
```
