import asyncio
import json
import logging
import multiprocessing
import shutil
from contextlib import asynccontextmanager, closing
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import unquote, urlparse
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from .config import MAX_PAGES, MAX_UPLOAD_BYTES, ROOT, data_directory
from .db import connect, initialize, now
from .documents import inspect_document
from .exports import XLSX_MEDIA_TYPE, csv_file, excel_file, export_disposition, file_chunks
from .ocr import LANGUAGES, available_devices
from .worker import run_worker

log = logging.getLogger(__name__)
Device = Literal["auto", "cpu", "cuda", "directml", "migraphx"]


class PageEdit(BaseModel):
    text: str = Field(max_length=2_000_000)
    revision: int = Field(ge=0)


def document_data(db, document_id: str):
    row = db.execute(
        "SELECT d.*, "
        "(SELECT count(*) FROM pages p WHERE p.document_id = d.id AND p.status = 'completed') "
        "AS completed_pages, "
        "(SELECT count(*) FROM pages p WHERE p.document_id = d.id AND p.status = 'failed') "
        "AS failed_pages FROM documents d WHERE id = ?",
        (document_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Document not found.")
    result = dict(row)
    result.pop("path")
    return result


def page_data(row):
    result = dict(row)
    result["text"] = row["edited_text"] if row["edited_text"] is not None else row["raw_text"]
    result["is_edited"] = row["edited_text"] is not None
    result.pop("edited_text")
    return result


def create_app(root: Path | None = None, start_worker: bool = True):
    root = root or data_directory()

    @asynccontextmanager
    async def lifespan(app):
        initialize(root)
        context = multiprocessing.get_context("spawn")
        stop = context.Event()
        process = None

        def launch():
            child = context.Process(target=run_worker, args=(str(root), stop), daemon=True)
            child.start()
            return child

        async def supervise():
            nonlocal process
            while True:
                await asyncio.sleep(3)
                if process is not None and not process.is_alive():
                    log.error("OCR worker exited; recovering its queue.")
                    process.join()
                    process = launch()

        if start_worker:
            process = launch()
        supervisor = asyncio.create_task(supervise()) if start_worker else None
        try:
            yield
        finally:
            if supervisor:
                supervisor.cancel()
                try:
                    await supervisor
                except asyncio.CancelledError:
                    pass
            stop.set()
            if process:
                await run_in_threadpool(process.join, 5)
                if process.is_alive():
                    process.terminate()
                    await run_in_threadpool(process.join, 5)

    app = FastAPI(title="Folio OCR", lifespan=lifespan)

    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            if origin and urlparse(origin).netloc != request.headers.get("host"):
                return JSONResponse({"detail": "Cross-origin changes are not allowed."}, 403)
        return await call_next(request)

    @app.get("/api/system")
    def system():
        with connect(root) as db:
            row = db.execute("SELECT value FROM settings WHERE key = 'runtime'").fetchone()
        return {
            "languages": [{"id": key, "label": label} for key, label in LANGUAGES.items()],
            "devices": available_devices(),
            "runtime": json.loads(row[0]) if row else {"state": "idle", "backend": None},
            "limits": {"file_mb": MAX_UPLOAD_BYTES // 1024**2, "pages": MAX_PAGES},
        }

    @app.get("/api/documents")
    def list_documents():
        with connect(root) as db:
            rows = db.execute("SELECT id FROM documents ORDER BY created_at DESC").fetchall()
            return [document_data(db, row["id"]) for row in rows]

    @app.post("/api/documents", status_code=201)
    async def upload_documents(
        files: Annotated[list[UploadFile], File()],
        language: Annotated[str, Form()] = "mixed",
        device: Annotated[Device, Form()] = "auto",
        handwriting: Annotated[bool, Form()] = False,
        force_ocr: Annotated[bool, Form()] = False,
    ):
        if language not in LANGUAGES:
            raise HTTPException(422, "Choose a supported language pack.")
        if handwriting and language not in {"mixed", "en"}:
            raise HTTPException(422, "Handwriting mode supports English, Chinese, and Japanese.")
        if len(files) > 20:
            raise HTTPException(422, "Upload up to 20 files at a time.")
        documents, errors = [], []
        for file in files:
            filename = unquote(file.filename or "untitled").replace("\\", "/").split("/")[-1][:240]
            suffix = Path(filename).suffix.lower()
            document_id = uuid4().hex
            relative = f"uploads/{document_id}{suffix}"
            path = root / relative
            try:
                if suffix not in {".pdf", ".png", ".jpg", ".jpeg"}:
                    raise ValueError("Choose a PDF, PNG, or JPG file.")
                size = 0
                with path.open("wb") as output:
                    while chunk := await file.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_UPLOAD_BYTES:
                            raise ValueError("Each file must be 50 MB or smaller.")
                        await run_in_threadpool(output.write, chunk)
                if not size:
                    raise ValueError("This file is empty.")
                kind, page_count = await run_in_threadpool(inspect_document, path, suffix)
                with connect(root) as db:
                    db.execute(
                        "INSERT INTO documents (id, filename, path, kind, size, page_count, "
                        "language, device, handwriting, force_ocr, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            document_id,
                            filename,
                            relative,
                            kind,
                            size,
                            page_count,
                            language,
                            device,
                            handwriting,
                            force_ocr,
                            now(),
                        ),
                    )
                    db.executemany(
                        "INSERT INTO pages (document_id, page_number) VALUES (?, ?)",
                        [(document_id, number) for number in range(1, page_count + 1)],
                    )
                    documents.append(document_data(db, document_id))
            except Exception as exc:
                path.unlink(missing_ok=True)
                errors.append({"filename": filename, "error": str(exc)})
            finally:
                await file.close()
        return {"documents": documents, "errors": errors}

    @app.get("/api/export")
    def export(
        ids: Annotated[list[str] | None, Query()] = None,
        format: Literal["csv", "xlsx"] = "csv",
    ):
        if ids and len(ids) > 500:
            raise HTTPException(422, "Export up to 500 selected documents at once.")
        condition, params = "", []
        if ids:
            condition = f"WHERE d.id IN ({','.join('?' for _ in ids)})"
            params = ids
        with connect(root) as db:
            count, filename = db.execute(
                f"SELECT count(*), min(filename) FROM documents d {condition}", params
            ).fetchone()
            if ids and count != len(set(ids)):
                raise HTTPException(404, "One or more selected documents no longer exist.")
        disposition = export_disposition(filename, count, bool(ids), format)

        def rows():
            with connect(root) as db:
                yield from db.execute(
                    "SELECT d.id, d.filename, p.page_number, "
                    "COALESCE(p.edited_text, p.raw_text), p.status "
                    "FROM documents d JOIN pages p ON p.document_id = d.id "
                    f"{condition} ORDER BY d.created_at, d.id, p.page_number",
                    params,
                )

        try:
            # Finish reading SQLite in this thread before streaming from the worker pool.
            with closing(rows()) as export_rows:
                output = excel_file(export_rows) if format == "xlsx" else csv_file(export_rows)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return StreamingResponse(
            file_chunks(output),
            media_type=XLSX_MEDIA_TYPE if format == "xlsx" else "text/csv; charset=utf-8",
            headers={
                "Content-Disposition": disposition,
            },
            background=BackgroundTask(output.close),
        )

    @app.get("/api/documents/{document_id}")
    def get_document(document_id: str):
        with connect(root) as db:
            document = document_data(db, document_id)
            document["pages"] = [
                page_data(row)
                for row in db.execute(
                    "SELECT * FROM pages WHERE document_id = ? ORDER BY page_number", (document_id,)
                )
            ]
            return document

    @app.get("/api/documents/{document_id}/original")
    def original(document_id: str):
        with connect(root) as db:
            document_data(db, document_id)
            row = db.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        return FileResponse(root / row["path"], filename=row["filename"])

    @app.get("/api/documents/{document_id}/pages/{number}/preview")
    def preview(document_id: str, number: int):
        with connect(root) as db:
            document = document_data(db, document_id)
        if not 1 <= number <= document["page_count"]:
            raise HTTPException(404, "Page not found.")
        path = root / "previews" / document_id / f"{number}.png"
        if not path.exists():
            raise HTTPException(404, "The preview will be available when this page is processed.")
        return FileResponse(path, media_type="image/png")

    @app.patch("/api/documents/{document_id}/pages/{number}")
    def edit_page(document_id: str, number: int, edit: PageEdit):
        with connect(root) as db:
            row = db.execute(
                "SELECT * FROM pages WHERE document_id = ? AND page_number = ?",
                (document_id, number),
            ).fetchone()
            if row is None:
                raise HTTPException(404, "Page not found.")
            if row["status"] != "completed":
                raise HTTPException(409, "Wait for extraction to finish before editing this page.")
            updated = db.execute(
                "UPDATE pages SET edited_text = ?, updated_at = ?, revision = revision + 1 "
                "WHERE document_id = ? AND page_number = ? AND revision = ?",
                (edit.text, now(), document_id, number, edit.revision),
            )
            if not updated.rowcount:
                raise HTTPException(409, "This page changed in another tab. Reload before saving.")
            return page_data(
                db.execute(
                    "SELECT * FROM pages WHERE document_id = ? AND page_number = ?",
                    (document_id, number),
                ).fetchone()
            )

    @app.post("/api/documents/{document_id}/retry")
    def retry(document_id: str):
        with connect(root) as db:
            document = document_data(db, document_id)
            if document["status"] != "failed":
                raise HTTPException(409, "Only failed documents can be retried.")
            db.execute(
                "UPDATE pages SET status = 'pending', error = NULL "
                "WHERE document_id = ? AND status = 'failed'",
                (document_id,),
            )
            db.execute(
                "UPDATE documents SET status = 'queued', error = NULL WHERE id = ?", (document_id,)
            )
            return document_data(db, document_id)

    @app.delete("/api/documents/{document_id}", status_code=204)
    def delete(document_id: str):
        with connect(root) as db:
            db.execute("BEGIN IMMEDIATE")
            document = document_data(db, document_id)
            if document["status"] in {"queued", "processing"}:
                raise HTTPException(409, "Wait for processing to finish before deleting.")
            row = db.execute("SELECT path FROM documents WHERE id = ?", (document_id,)).fetchone()
            # Keep the database record until cleanup succeeds so failed deletions can be retried.
            try:
                previews = root / "previews" / document_id
                if previews.exists():
                    shutil.rmtree(previews)
                (root / row["path"]).unlink(missing_ok=True)
            except OSError as exc:
                log.exception("Could not fully delete document %s", document_id)
                raise HTTPException(
                    500,
                    "Could not fully delete this document's files. Close any programs using "
                    "them, check file permissions, and try deleting again.",
                ) from exc
            db.execute("DELETE FROM documents WHERE id = ?", (document_id,))

    # A built frontend can be served by the same local server.
    dist = ROOT / "frontend" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
