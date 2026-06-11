from pathlib import Path
import csv

BASE = Path(__file__).resolve().parents[1]
MANIFEST = BASE / 'corpus' / 'manifest.csv'

def load_manifest(path=MANIFEST):
    rows = []
    with path.open(newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows

def read_source(row):
    source_path = BASE / row['local_path']
    content = source_path.read_text(encoding='utf-8')
    return {
        'id': row['id'],
        'title': row['title'],
        'url': row['url'],
        'local_path': row['local_path'],
        'content': content
    }

if __name__ == '__main__':
    manifest = load_manifest()
    docs = [read_source(row) for row in manifest]
    print(f'Loaded {len(docs)} documents')
    for d in docs:
        has_h2 = '##' in d['content']
        has_h3 = '###' in d['content']
        print(d['id'], d['title'], len(d['content']), f'H2={has_h2}', f'H3={has_h3}')
        print(d['content'][:300].replace('\n', '\\n'))