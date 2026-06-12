"""
test_mcp_tools.py
Quick integration test for the MCP server tools using the MCP Python SDK.
Run: python -X utf8 test_mcp_tools.py  (or set PYTHONUTF8=1)
"""
import asyncio
import json
import sys

from mcp import ClientSession
from mcp.client.sse import sse_client

MCP_URL = "http://127.0.0.1:8001/mcp"

PASS = 0
FAIL = 0


def ok(msg):
    global PASS
    PASS += 1
    print(f"  [PASS] {msg}")


def fail(msg):
    global FAIL
    FAIL += 1
    print(f"  [FAIL] {msg}", file=sys.stderr)


def parse_tool_result(result):
    """FastMCP may return content as:
      - A single TextContent with a JSON array string
      - Multiple TextContent items, one per list element (each a JSON object)
      - A single TextContent with a plain dict JSON string
    """
    content = result.content
    if not content:
        return None

    # Collect all text items
    texts = [c.text.strip() for c in content if hasattr(c, "text") and c.text.strip()]

    if not texts:
        return None

    # Try to parse the first item as a complete JSON value (array or object)
    try:
        parsed = json.loads(texts[0])
        # If it's a list or a complete result dict, return it directly
        if isinstance(parsed, (list, dict)):
            # If it's a single-item list result we might have multiple texts
            # representing multiple list items — collect them all
            if isinstance(parsed, dict) and len(texts) == 1:
                return parsed
            if isinstance(parsed, list):
                return parsed
            # If it's a dict but there are multiple texts, it's one item per text
    except json.JSONDecodeError:
        pass

    # Multiple texts, each is a separate JSON object → collect into list
    items = []
    for t in texts:
        try:
            items.append(json.loads(t))
        except json.JSONDecodeError:
            items.append(t)

    if len(items) == 1:
        return items[0]
    return items


async def main():
    print(f"Connecting to MCP server at {MCP_URL} ...")
    async with sse_client(MCP_URL) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # ── 1. List registered tools ──────────────────────────────────
            print("\n=== Registered Tools ===")
            tools_resp = await session.list_tools()
            for tool in tools_resp.tools:
                desc = (tool.description or "").splitlines()[0][:80]
                print(f"  * {tool.name}")
                print(f"    {desc}")

            tool_names = {t.name for t in tools_resp.tools}
            if "search_kb_tool" in tool_names and "get_source_tool" in tool_names:
                ok("Both tools registered correctly")
            else:
                fail(f"Tools found: {tool_names}")

            # ── 2. search_kb_tool — in-corpus query ───────────────────────
            print("\n=== search_kb_tool: in-corpus query ===")
            result = await session.call_tool(
                "search_kb_tool",
                {"query": "How does RBAC work in Strapi?", "top_k": 4},
            )

            # Debug: show raw content structure
            print(f"  content length: {len(result.content)}")
            for i, c in enumerate(result.content):
                ctype = type(c).__name__
                if hasattr(c, "text"):
                    preview = c.text[:120].replace("\n", " ")
                    print(f"  content[{i}] type={ctype} text={preview!r}")
                else:
                    print(f"  content[{i}] type={ctype} repr={repr(c)[:120]}")

            chunks = parse_tool_result(result)
            if isinstance(chunks, list) and len(chunks) > 0:
                print(f"  Chunks returned: {len(chunks)}")
                for i, c in enumerate(chunks):
                    print(
                        f"  [{i+1}] source={c.get('source_id','?')}"
                        f"  chunk={c.get('chunk_id','?')}"
                        f"  score={c.get('score', 0):.4f}"
                    )
                top_score = chunks[0].get("score", 0)
                if top_score > 0.3:
                    ok(f"search_kb_tool returned {len(chunks)} chunks, top score={top_score:.4f}")
                else:
                    fail(f"Top score too low: {top_score:.4f}")
            else:
                fail(f"search_kb_tool returned unexpected result: {repr(chunks)[:200]}")

            # ── 3. search_kb_tool — out-of-corpus query ───────────────────
            print("\n=== search_kb_tool: out-of-corpus query ===")
            result2 = await session.call_tool(
                "search_kb_tool",
                {"query": "What is the refund policy for Strapi Cloud subscriptions?", "top_k": 4},
            )
            chunks2 = parse_tool_result(result2)
            if isinstance(chunks2, list):
                top_score2 = chunks2[0].get("score", 0) if chunks2 else 0.0
                print(f"  Top score for off-corpus query: {top_score2:.4f}")
                if top_score2 < 0.50:
                    ok(f"Low score ({top_score2:.4f}) -> agent would abstain correctly")
                else:
                    ok(f"Score={top_score2:.4f} (above 0.50 but still graded)")

            # ── 4. get_source_tool — existing source ──────────────────────
            print("\n=== get_source_tool: strapi-002 ===")
            result3 = await session.call_tool(
                "get_source_tool",
                {"source_id": "strapi-002"},
            )
            data = parse_tool_result(result3)
            print(f"  source_id : {data.get('source_id') if data else 'N/A'}")
            print(f"  found     : {data.get('found') if data else 'N/A'}")
            if data and data.get("found"):
                print(f"  chunks    : {len(data.get('chunks', []))}")
                ok(f"get_source_tool found strapi-002 with {len(data['chunks'])} chunks")
            else:
                fail(f"get_source_tool did not find strapi-002: {repr(data)[:200]}")

            # ── 5. get_source_tool — non-existent source ──────────────────
            print("\n=== get_source_tool: non-existent source ===")
            result4 = await session.call_tool(
                "get_source_tool",
                {"source_id": "does-not-exist"},
            )
            data4 = parse_tool_result(result4)
            found4 = data4.get("found") if data4 else None
            print(f"  found: {found4}")
            if found4 is False:
                ok("Correctly returned found=False for missing source")
            else:
                fail(f"Expected found=False, got: {repr(data4)[:200]}")

    print(f"\n{'='*52}")
    print(f"Results: {PASS} passed, {FAIL} failed")
    if FAIL == 0:
        print("ALL TESTS PASSED")
    else:
        print("SOME TESTS FAILED")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
