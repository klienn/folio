import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect(root: Path):
    db = sqlite3.connect(root / "folio.sqlite3", timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize(root: Path):
    for folder in (root, root / "uploads", root / "previews", root / "models"):
        folder.mkdir(parents=True, exist_ok=True)
    with connect(root) as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY, filename TEXT NOT NULL, path TEXT NOT NULL,
                kind TEXT NOT NULL, size INTEGER NOT NULL, page_count INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued', language TEXT NOT NULL,
                device TEXT NOT NULL, handwriting INTEGER NOT NULL DEFAULT 0,
                force_ocr INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, error TEXT
            );
            CREATE TABLE IF NOT EXISTS pages (
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                page_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                raw_text TEXT NOT NULL DEFAULT '', edited_text TEXT,
                method TEXT, backend TEXT, confidence REAL, error TEXT,
                updated_at TEXT, revision INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(document_id, page_number)
            );
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS document_queue ON documents(status, created_at);
        """)


def set_runtime(root: Path, **values):
    with connect(root) as db:
        db.execute(
            "INSERT OR REPLACE INTO settings(key, value) VALUES ('runtime', ?)",
            (json.dumps(values),),
        )
