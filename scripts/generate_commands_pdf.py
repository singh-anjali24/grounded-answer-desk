"""
generate_commands_pdf.py
Generates a PDF cheatsheet of all VPS health-check and diagnostic commands
for the Grounded Answer Desk project.

Usage:
    pip install fpdf2
    python scripts/generate_commands_pdf.py
"""

from fpdf import FPDF

OUTPUT = "docs/vps_commands.pdf"

SECTIONS = [
    {
        "title": "1. Check MCP Server Status",
        "color": (0, 120, 212),
        "commands": [
            ("Is it running?", "sudo systemctl status mcp-server"),
            ("Start it", "sudo systemctl start mcp-server"),
            ("Stop it", "sudo systemctl stop mcp-server"),
            ("Restart it", "sudo systemctl restart mcp-server"),
            ("View live logs", "sudo journalctl -u mcp-server -f"),
            ("Last 20 log lines", "sudo journalctl -u mcp-server --no-pager -n 20"),
            ("Test /mcp endpoint", 'curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8001/mcp \\\n  -H "Content-Type: application/json" \\\n  -d \'{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}},"id":1}\''),
        ],
    },
    {
        "title": "2. Check OpenClaw Gateway Status",
        "color": (16, 137, 62),
        "commands": [
            ("Is it running?", "sudo systemctl status openclaw"),
            ("Start it", "sudo systemctl start openclaw"),
            ("Stop it", "sudo systemctl stop openclaw"),
            ("Restart it", "sudo systemctl restart openclaw"),
            ("View live logs", "sudo journalctl -u openclaw -f"),
            ("Health check", "curl -s http://localhost:18789/health"),
            ("List available models", "openclaw models list"),
        ],
    },
    {
        "title": "3. Check Qdrant Vector DB Status",
        "color": (181, 36, 0),
        "commands": [
            ("Docker container status", "sudo docker ps | grep qdrant"),
            ("Start if stopped", "sudo docker start qdrant"),
            ("Restart container", "sudo docker restart qdrant"),
            ("Health check", "curl http://localhost:6333/healthz"),
            ("Collection status", "curl -s http://localhost:6333/collections/strapi_docs"),
            ("Count stored vectors", 'curl -s -X POST http://localhost:6333/collections/strapi_docs/points/count \\\n  -H "Content-Type: application/json" \\\n  -d \'{"exact": true}\''),
            ("Chunk breakdown by source", "curl -s -X POST http://localhost:6333/collections/strapi_docs/points/scroll -H \"Content-Type: application/json\" -d '{\"limit\": 100, \"with_payload\": [\"source_id\"]}' | python3 -c \"import sys,json; from collections import Counter; d=json.load(sys.stdin); c=Counter(p['payload']['source_id'] for p in d['result']['points']); [print(f'  {k}: {v} chunks') for k,v in sorted(c.items())]; print(f'  TOTAL: {sum(c.values())} chunks')\""),
        ],
    },
    {
        "title": "4. Full Stack Health Check (Run All at Once)",
        "color": (100, 0, 180),
        "commands": [
            ("Run smoke test script", "bash scripts/smoke-test.sh"),
            ("Check all systemd services", "sudo systemctl status mcp-server openclaw"),
            ("Check all ports in use", "sudo ss -tlnp | grep -E '8001|18789|6333'"),
        ],
    },
    {
        "title": "5. MCP Inspector (Run on LOCAL Machine, not VPS)",
        "color": (180, 100, 0),
        "commands": [
            ("Launch Inspector (SSE transport)", "npx @modelcontextprotocol/inspector sse http://3.107.236.36:8001/sse"),
            ("Launch Inspector (no args, configure in UI)", "npx @modelcontextprotocol/inspector"),
            ("Then open in browser", "http://localhost:6274"),
            ("Inspector UI settings", "Transport Type: SSE\nURL: http://3.107.236.36:8001/sse"),
        ],
    },
    {
        "title": "6. Re-Ingest Corpus (Only If Needed)",
        "color": (60, 60, 60),
        "commands": [
            ("Delete existing collection", "curl -X DELETE http://localhost:6333/collections/strapi_docs"),
            ("Activate venv", "source ~/venv/bin/activate  (or source .venv/bin/activate)"),
            ("Run ingestion pipeline", "python ingestion/run_ingestion.py"),
            ("Verify vector count after", 'curl -s -X POST http://localhost:6333/collections/strapi_docs/points/count -H "Content-Type: application/json" -d \'{"exact": true}\''),
        ],
    },
    {
        "title": "7. Docker Utility Commands",
        "color": (0, 90, 160),
        "commands": [
            ("List all containers", "sudo docker ps -a"),
            ("Add ubuntu to docker group (no sudo needed after)", "sudo usermod -aG docker ubuntu && newgrp docker"),
            ("View Qdrant container logs", "sudo docker logs qdrant --tail 20"),
            ("Qdrant storage path", "~/data/qdrant  (persisted volume)"),
        ],
    },
]


class PDF(FPDF):
    def header(self):
        self.set_font("Helvetica", "B", 14)
        self.set_fill_color(20, 20, 40)
        self.set_text_color(255, 255, 255)
        self.cell(0, 12, "Grounded Answer Desk - VPS Commands Cheatsheet", fill=True, align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)
        self.ln(3)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 8, f"Grounded Answer Desk | VPS: 3.107.236.36 | Frontend: grounded-answer-desk.vercel.app | Page {self.page_no()}", align="C")


def main():
    pdf = PDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_margins(15, 15, 15)

    for section in SECTIONS:
        r, g, b = section["color"]

        # Section header
        pdf.set_fill_color(r, g, b)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 9, f"  {section['title']}", fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)
        pdf.ln(2)

        for label, cmd in section["commands"]:
            # Label
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(60, 60, 60)
            pdf.cell(0, 6, f"  >> {label}", new_x="LMARGIN", new_y="NEXT")

            # Command box
            pdf.set_fill_color(240, 240, 245)
            pdf.set_font("Courier", "", 8)
            pdf.set_text_color(20, 20, 100)

            # Handle multi-line commands
            lines = cmd.split("\n")
            for line in lines:
                # Break long lines
                if len(line) > 105:
                    chunks = [line[i:i+105] for i in range(0, len(line), 105)]
                    for chunk in chunks:
                        pdf.cell(0, 5, f"    {chunk}", fill=True, new_x="LMARGIN", new_y="NEXT")
                else:
                    pdf.cell(0, 5, f"    {line}", fill=True, new_x="LMARGIN", new_y="NEXT")

            pdf.set_text_color(0, 0, 0)
            pdf.ln(2)

        pdf.ln(3)

    pdf.output(OUTPUT)
    print(f"[OK] PDF saved to: {OUTPUT}")


if __name__ == "__main__":
    main()
