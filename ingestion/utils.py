from pathlib import Path
import json

BASE = Path(__file__).resolve().parents[1]


def load_jsonl(path):
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def save_jsonl(records, path):
    with open(path, "w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record) + "\n")
    print(f"Saved {len(records)} records to {path}")


def word_count(text):
    return len(text.split())


def truncate_text(text, max_words=300):
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words])


def resolve_path(*parts):
    return BASE.joinpath(*parts)
