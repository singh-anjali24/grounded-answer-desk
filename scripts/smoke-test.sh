#!/usr/bin/env bash
# scripts/smoke-test.sh — Quick end-to-end sanity check
# Usage: bash scripts/smoke-test.sh
set -euo pipefail

MCP_PORT="${MCP_PORT:-8001}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [ "$result" = "ok" ]; then
    echo "  ✔ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✘ $label — $result"
    FAIL=$((FAIL + 1))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Grounded Answer Desk — smoke test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Qdrant health
QDRANT_STATUS=$(curl -sf "http://localhost:${QDRANT_PORT}/healthz" 2>&1 && echo "ok" || echo "unreachable")
check "Qdrant health (port $QDRANT_PORT)" "$QDRANT_STATUS"

# 2. Qdrant collection exists and has vectors
COLL=$(curl -sf "http://localhost:${QDRANT_PORT}/collections/strapi_docs" 2>&1)
VCOUNT=$(echo "$COLL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['vectors_count'])" 2>/dev/null || echo "0")
if [ "$VCOUNT" -gt 0 ] 2>/dev/null; then
  check "Qdrant collection strapi_docs ($VCOUNT vectors)" "ok"
else
  check "Qdrant collection strapi_docs" "empty or not found — run ingestion first"
fi

# 3. MCP server /mcp endpoint responds
MCP_STATUS=$(curl -sf --max-time 5 -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:${MCP_PORT}/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}},"id":1}' \
  2>&1 || echo "000")
if [ "$MCP_STATUS" = "200" ] || [ "$MCP_STATUS" = "405" ] || [ "$MCP_STATUS" = "400" ]; then
  check "MCP server /mcp endpoint (port $MCP_PORT)" "ok"
else
  check "MCP server /mcp endpoint (port $MCP_PORT)" "HTTP $MCP_STATUS — is mcp-server.service running?"
fi

# 4. search_kb_tool via MCP returns results
SEARCH_BODY=$(curl -sf --max-time 10 \
  -X POST "http://localhost:${MCP_PORT}/messages" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search_kb_tool","arguments":{"query":"API token Strapi","top_k":2}},"id":2}' \
  2>&1 || echo "error")
if echo "$SEARCH_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'result' in d" 2>/dev/null; then
  check "search_kb_tool returns results" "ok"
else
  check "search_kb_tool returns results" "no result — check Qdrant has data and MCP is running"
fi

# 5. OpenClaw Gateway health
OC_STATUS=$(curl -sf --max-time 5 "http://localhost:${OPENCLAW_PORT}/health" 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('ok') else 'not ok')" 2>/dev/null || echo "unreachable")
check "OpenClaw Gateway (port $OPENCLAW_PORT)" "$OC_STATUS"

# 6. systemd services enabled
for svc in mcp-server openclaw; do
  STATE=$(systemctl is-active "$svc" 2>/dev/null || echo "inactive")
  if [ "$STATE" = "active" ]; then
    check "systemd: $svc.service" "ok"
  else
    check "systemd: $svc.service" "$STATE — run: sudo systemctl start $svc"
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "All checks passed ✔" && exit 0 || exit 1
