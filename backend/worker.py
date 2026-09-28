import logging
from pathlib import Path

import pymupdf

from .db import connect, initialize, now, set_runtime
from .documents import image_page, pdf_page, save_preview
from .ocr import OCREngine

log = logging.getLogger(__name__)


def recover_jobs(root: Path):
    with connect(root) as db:
        db.execute("UPDATE documents SET status = 'queued' WHERE status = 'processing'")
        db.execute("UPDATE pages SET status = 'pending' WHERE status = 'processing'")


def process_document(root: Path, document_id: str, engine: OCREngine, stop=None):
    with connect(root) as db:
        document = db.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        if document is None:
            return
        db.execute("UPDATE documents SET status = 'processing' WHERE id = ?", (document_id,))
        pages = db.execute(
            "SELECT page_number FROM pages WHERE document_id = ? AND status = 'pending' "
            "ORDER BY page_number",
            (document_id,),
        ).fetchall()
    pdf = None
    try:
        if document["kind"] == "pdf":
            pdf = pymupdf.open(root / document["path"])
        for row in pages:
            if stop is not None and stop.is_set():
                return
            number = row["page_number"]
            with connect(root) as db:
                db.execute(
                    "UPDATE pages SET status = 'processing', error = NULL "
                    "WHERE document_id = ? AND page_number = ?",
                    (document_id, number),
                )
            try:
                page = pdf[number - 1] if pdf is not None else None
                image = pdf_page(page) if page is not None else image_page(root / document["path"])
                try:
                    save_preview(root, document_id, number, image)
                    embedded = page.get_text(sort=True).strip() if page is not None else ""
                    if embedded and not document["force_ocr"]:
                        text, confidence, backend = embedded, None, "PDF text"
                        method = "embedded"
                    else:
                        text, confidence, backend = engine.recognize(
                            image,
                            document["language"],
                            bool(document["handwriting"]),
                            document["device"],
                        )
                        method = "ocr"
                finally:
                    image.close()
                with connect(root) as db:
                    db.execute(
                        "UPDATE pages SET status = 'completed', raw_text = ?, method = ?, "
                        "backend = ?, confidence = ?, updated_at = ?, error = NULL "
                        "WHERE document_id = ? AND page_number = ?",
                        (text, method, backend, confidence, now(), document_id, number),
                    )
            except Exception as exc:
                log.exception("Failed page %s of %s", number, document_id)
                with connect(root) as db:
                    db.execute(
                        "UPDATE pages SET status = 'failed', error = ?, updated_at = ? "
                        "WHERE document_id = ? AND page_number = ?",
                        (str(exc)[:2000], now(), document_id, number),
                    )
        with connect(root) as db:
            failed = db.execute(
                "SELECT count(*) FROM pages WHERE document_id = ? AND status = 'failed'",
                (document_id,),
            ).fetchone()[0]
            db.execute(
                "UPDATE documents SET status = ?, error = ? WHERE id = ?",
                (
                    "failed" if failed else "completed",
                    f"{failed} page(s) failed. Retry to process only failed pages."
                    if failed
                    else None,
                    document_id,
                ),
            )
    except Exception as exc:
        log.exception("Failed document %s", document_id)
        with connect(root) as db:
            db.execute(
                "UPDATE documents SET status = 'failed', error = ? WHERE id = ?",
                (str(exc)[:2000], document_id),
            )
            db.execute(
                "UPDATE pages SET status = 'failed', error = ? WHERE document_id = ? "
                "AND status IN ('pending', 'processing')",
                (str(exc)[:2000], document_id),
            )
    finally:
        if pdf is not None:
            pdf.close()


def run_worker(directory: str, stop):
    logging.basicConfig(level=logging.INFO)
    root = Path(directory)
    initialize(root)
    recover_jobs(root)
    set_runtime(root, state="idle", backend=None, message="Models load on the first scanned page.")
    engine = OCREngine(root / "models", lambda **values: set_runtime(root, **values))
    while not stop.is_set():
        with connect(root) as db:
            row = db.execute(
                "SELECT id FROM documents WHERE status = 'queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
        if row:
            process_document(root, row["id"], engine, stop)
        else:
            stop.wait(0.5)
