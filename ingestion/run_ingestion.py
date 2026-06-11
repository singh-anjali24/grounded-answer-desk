import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
INGESTION = BASE / "ingestion"


def run(script_name):
    script = INGESTION / script_name
    print(f"\n{'='*50}")
    print(f"Running: {script_name}")
    print(f"{'='*50}")
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(INGESTION)
    )
    if result.returncode != 0:
        print(f"ERROR: {script_name} failed. Stopping pipeline.")
        sys.exit(1)
    print(f"OK: {script_name} completed.")


if __name__ == "__main__":
    run("collect_docs.py")
    run("chunk_docs.py")
    run("embed_and_upsert.py")
    print("\nIngestion pipeline complete.")
    print("Vector store is ready at data/qdrant/")