#!/usr/bin/env bash
# scripts/smoke-test.sh — Quick end-to-end sanity check
# Usage: bash scripts/smoke-test.sh [MCP_PORT]
set -euo pipefail

MCP_PORT="${1:-${MCP_PORT:-8000}}"
QDRANT_PORT="${QDRANT_PORT:-6335}"
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

# 2. Qdrant collection exists
COLL=$(curl -sf "http://localhost:${QDRANT_PORT}/collections/strapi_docs" 2>&1)
if echo "$COLL" | grep -q '"status":"green"'; then
  check "Qdrant collection strapi_docs" "ok"
else
  check "Qdrant collection strapi_docs" "not found or not green — run ingestion first"
fi

# 3. MCP server SSE endpoint responds
MCP_STATUS=$(curl -sf --max-time 3 -o /dev/null -w "%{http_code}" "http://localhost:${MCP_PORT}/sse" 2>&1 || echo "000")
if [ "$MCP_STATUS" = "200" ] || [ "$MCP_STATUS" = "405" ]; then
  check "MCP server SSE endpoint (port $MCP_PORT)" "ok"
else
  check "MCP server SSE endpoint (port $MCP_PORT)" "HTTP $MCP_STATUS — is server.py running?"
fi

# 4. search_kb_tool via MCP /search shim (if available)
SEARCH=$(curl -sf -X POST "http://localhost:${MCP_PORT}/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"What is RBAC?","top_k":2}' 2>&1 || echo "error")
if echo "$SEARCH" | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d)>0" 2>/dev/null; then
  check "search_kb returns results" "ok"
else
  check "search_kb returns results" "no results or endpoint not available"
fi

# 5. Frontend (if running)
FE_STATUS=$(curl -sf --max-time 3 -o /dev/null -w "%{http_code}" "http://localhost:3000" 2>&1 || echo "000")
if [ "$FE_STATUS" = "200" ]; then
  check "Frontend (port 3000)" "ok"
else
  check "Frontend (port 3000)" "HTTP $FE_STATUS — run: cd app && npm run dev"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "All checks passed ✔" && exit 0 || exit 1
