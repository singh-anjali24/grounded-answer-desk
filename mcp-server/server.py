from mcp.server.fastmcp import FastMCP

from schemas import SearchRequest, SourceRequest
from search_kb import search_kb
from get_source import get_source

mcp = FastMCP(
    "grounded-answer-desk",
    host="0.0.0.0",
    port=8001,
)

@mcp.tool()
def search_kb_tool(query: str, top_k: int = 4) -> list[dict]:
    return search_kb(SearchRequest(query=query, top_k=top_k))

@mcp.tool()
def get_source_tool(source_id: str) -> dict:
    return get_source(SourceRequest(source_id=source_id))

if __name__ == "__main__":
    mcp.run(transport="streamable-http")