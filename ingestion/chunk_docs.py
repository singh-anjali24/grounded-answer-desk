import csv
import json
import re
from pathlib import Path

HEADING_RE = re.compile(r"^\s*(#{2,3})\s+(.+?)\s*$")

def normalize_text(text):
    return "\n".join(line.rstrip() for line in text.strip().splitlines()).strip()

def split_sections(md_text):
    sections = []
    current_heading = "Introduction"
    current_lines = []

    for line in md_text.splitlines():
        if HEADING_RE.match(line):
            if current_lines:
                # If there's content before the heading, save it
                sections.append((current_heading, "\n".join(current_lines).strip()))
            current_heading = line.strip()
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sections.append((current_heading, "\n".join(current_lines).strip()))

    return sections

def chunk_markdown_file(source_path, source_id, title, url, out_dir):
    md_text = Path(source_path).read_text(encoding="utf-8")
    sections = split_sections(md_text)

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{source_id}.jsonl"

    with out_path.open("w", encoding="utf-8") as f:
        chunk_num = 1
        for heading, section_text in sections:
            section_text = normalize_text(section_text)
            if not section_text:
                continue
            record = {
                "chunk_id": f"{source_id}-{chunk_num}",
                "source_id": source_id,
                "title": title,
                "url": url,
                "section_title": heading,
                "text": section_text,
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            chunk_num += 1

    return out_path

def load_manifest(manifest_path):
    rows = []
    with open(manifest_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows