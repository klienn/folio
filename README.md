# Folio OCR

A local document workspace for uploading, extracting, reviewing, and exporting text. Built with React, TypeScript, FastAPI, SQLite, and RapidOCR / PP-OCRv5 through ONNX Runtime.

## Quick start

Install **[Node.js 22+](https://nodejs.org/)** with npm, then run the appropriate command from the project directory. On Windows, you can install it with `winget install --id OpenJS.NodeJS.LTS -e`; reopen your terminal afterward.

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Start
```

**Linux / macOS:**

```sh
bash scripts/setup.sh --start
```

The scripts check Node.js, install **uv** from its official installer if missing, set up **Python 3.12** and the locked Python dependencies, install the locked frontend dependencies, build the interface, and start the app at **http://127.0.0.1:8000**. Keep the terminal open; press Ctrl+C to stop.

- Omit `-Start` / `--start` to install and build only. The script prints the command to launch later.
- Initial setup requires internet access; Linux/macOS also needs `curl` or `wget` if uv is not installed.
- Run as your normal user. The uv installer uses your home directory; its path is used directly without changing your shell profile.
- Setup can be rerun after an interrupted installation. It preserves `data/` and rebuilds dependencies. It restores the default CPU runtime, so apply optional GPU setup afterward.
- When moving between Windows and Linux, copy the source rather than `.venv` or `frontend/node_modules`; setup creates those for the destination platform.

CPU processing is included; no GPU, database server, or OCR-service API key is needed. OCR models download on the first scanned page and are cached locally. Try `samples/welcome-guide.pdf` for an immediate embedded-text extraction demo.

### Manual setup

Requirements: **Python 3.12**, **Node.js 22+**, and [uv](https://docs.astral.sh/uv/getting-started/installation/). CPU processing is included in the default installation; no GPU is required.

From this directory:

```sh
uv sync
npm --prefix frontend ci
npm --prefix frontend run build
uv run python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. Keep the terminal running. The API starts and supervises its own separate OCR worker.

The first scanned document downloads the chosen OCR models from the URLs pinned in RapidOCR's model manifest. Downloads are SHA-256 verified and cached in `data/models/`. Subsequent processing with those packs works offline. Documents are processed locally; they are not sent to an OCR service. Font assets are bundled locally too.

### Try the sample documents

```sh
uv run python scripts/create_samples.py
```

Upload any of the four synthetic files in `samples/`:

| File | What it demonstrates |
| --- | --- |
| `welcome-guide.pdf` | Two-page PDF with embedded text; no OCR model needed |
| `sample-invoice.png` | Printed image OCR; choose English |
| `scanned-invoices.pdf` | Two-page image-only PDF; choose English |
| `multilingual.png` | English, Chinese, and Japanese on one image; choose the mixed pack |

Samples have no personal information. You can regenerate them at any time.

## Workflow

1. **Add documents** or drag files onto the workspace. Choose a language pack, processing device, and optional handwriting mode.
2. Files enter a persistent queue. Each page gets its own status, preview, extracted text, and processing metadata.
3. Open a document to compare its original page with the editable text. Changes remain drafts until you select **Save changes**. The original extraction is retained separately.
4. Export one document, selected documents, or the entire library. Choose **Excel (.xlsx)** for a formatted workbook or **CSV (.csv)** for a plain-text data file.

### Delete documents

Use a document's three-dot menu in the library and choose **Delete**, use **Delete document** in its review screen, or select multiple documents and choose **Delete N selected**. Confirming permanently removes each document's original upload, all page previews, database record, extracted text, saved corrections, and extraction errors. There is no recycle bin.

Wait for queued or processing documents to finish before deleting them. If a file cannot be removed (for example, it is locked by another program), the app reports the failure and retains the database record so you can retry. In a multiple-document deletion, successfully removed documents disappear while failed ones remain selected. Shared OCR models and files you already exported to your downloads folder are separate from the stored documents.

Search and status filters help find documents. Failed pages show an error and can be retried without reprocessing completed pages or discarding corrections. Deleting a completed/failed document removes its original, page previews, and database records.

### Inputs and extraction

- PNG, JPG/JPEG, and single- or multi-page PDF. File contents are checked, not just extensions.
- Up to 20 files per request, 50 MiB per file, 500 pages per PDF, and 40 million pixels per image.
- Password-protected PDFs must be unlocked before uploading.
- PDF pages with embedded text use that text by default; image-only pages use OCR. If a page combines a small text layer with a larger scanned region, or has a bad existing OCR layer, select **Always use OCR** when uploading.
- Processing is text-focused. Exact tables, columns, reading order, and visual formatting are not reconstructed.
- Portrait/landscape images and EXIF orientation are handled; severely rotated, blurred, low-resolution, or complex documents may need preprocessing.

### Language and handwriting coverage

The language menu selects **one recognition pack per document**, not automatic identification across every language. The mixed pack covers English, Chinese, and Japanese together. Additional mobile packs cover Latin, Korean, Cyrillic, Arabic, Devanagari, Tamil, Telugu, Thai, and Greek scripts. Coverage and accuracy depend on the underlying PP-OCRv5 model and the input.

**Handwriting mode** selects the larger PP-OCRv5 Chinese server recognizer, whose advertised coverage includes English, Chinese, Japanese, and handwriting. It is offered only with English or the mixed pack. It is not a universal multilingual handwriting recognizer. Cursive names and poor scans especially need review. The confidence value is a model score, not a guarantee of correctness.

The application does not assume a form schema or a specific document type. Text is retained page by page rather than mapped into invoice fields or other structured records.

### Export behavior

Downloads use descriptive filenames with a UTC timestamp:

- One document: `invoice-ocr_2026-09-29_14-30-00Z.xlsx` (based on the original filename).
- Selected documents: `folio-selected-3-documents_2026-09-29_14-30-00Z.xlsx`.
- Entire library: `folio-library-6-documents_2026-09-29_14-30-00Z.xlsx`.

CSV uses the same naming with a `.csv` extension. Unicode names are preserved; filename-unsafe characters are replaced.

Both formats have one row per page and the same five columns:

```text
document_id,filename,page_number,text,status
```

- Saved corrections take precedence over raw extraction, including deliberately empty corrections.
- Commas, quotes, line breaks, and Unicode are preserved.
- Queued and failed pages are included with their current status. Error details stay in the app.
- Selection can include documents hidden by the current search/filter; the export button displays the selected count.

**Excel** is the default in the interface. It includes a wide, wrapped text column, top-aligned Arial text, estimated row heights, bold colored headers, alternating row shading, filters, and a frozen header row. Text is stored as literal strings, including values beginning with `=`, rather than executable formulas. Page numbers are numeric. Excel's maximum row height is 409 points, so very long text may require the formula bar to read in full. Cells exceeding Excel's 32,767-character limit are rejected with a message to use CSV, rather than silently truncated.

**CSV** uses UTF-8 with a BOM and standard CSV quoting. It does not store spreadsheet formatting. Values that could be interpreted as formulas are prefixed with an apostrophe in CSV only; database text is unchanged. The API defaults to CSV; use `/api/export?format=xlsx` for Excel and repeat the `ids` query parameter to select documents.

## CPU and GPU processing

The default setup installs **CPU ONNX Runtime**. GPU use requires a compatible GPU-enabled runtime, drivers, and vendor libraries; the application does not install drivers.

In **Automatic** mode the worker tries installed providers in this order:

1. NVIDIA CUDA
2. DirectML (normally Windows; supports compatible AMD, Intel, and NVIDIA GPUs)
3. AMD MIGraphX (supported Linux/ROCm configurations)
4. CPU

Each candidate must successfully create **and run** detector, orientation, and recognizer sessions. If initialization or later GPU inference fails, processing falls back to CPU. The per-page metadata shows the provider that completed extraction; **Processing settings** shows the latest worker runtime state and fallback reason. Providers may still run unsupported individual operations on CPU.

Only one ONNX Runtime distribution should own the `onnxruntime` Python module. Replace the CPU distribution instead of installing multiple variants on top of each other.

### NVIDIA example

After the ordinary `uv sync` setup, install a CUDA runtime matching the current [ONNX Runtime CUDA requirements](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html):

```sh
uv pip uninstall onnxruntime
uv pip install "onnxruntime-gpu[cuda,cudnn]"
uv run --no-sync python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The worker preloads CUDA/cuDNN libraries where supported by ONNX Runtime. A compatible NVIDIA driver is still required. On WSL, follow the NVIDIA WSL driver requirements.

### AMD on Windows / DirectML example

Use a Python version supported by the current [DirectML package](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html), then:

```sh
uv pip uninstall onnxruntime
uv pip install onnxruntime-directml
uv run --no-sync python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Sequential execution and disabled memory-pattern optimization are configured for DirectML compatibility.

### AMD on Linux

Install AMD's compatible ONNX Runtime build exposing `MIGraphXExecutionProvider` according to the [MIGraphX instructions](https://onnxruntime.ai/docs/execution-providers/MIGraphX-ExecutionProvider.html). Compatibility varies by GPU, ROCm version, Python, and operating system. The old `ROCMExecutionProvider` is not used.

Use `uv run --no-sync` after installing a custom runtime; a normal `uv sync` restores the lockfile's CPU setup. Restart the app after changing runtimes.

Inspect installed providers with:

```sh
uv run --no-sync python -c "import onnxruntime as ort; print(ort.get_available_providers())"
```

GPU execution paths are implemented with CPU fallback, but **physical NVIDIA/AMD hardware has not been validated in this environment**. See [verification notes](docs/verification.md) for tested coverage.

## Storage and memory

```text
data/
  folio.sqlite3          Documents, page text, edits, queue, runtime state
  uploads/               Original uploaded files under generated IDs
  previews/              Page preview images
  models/                Verified ONNX model cache
```

Set `OCR_DATA_DIR` before starting the server to change the storage directory. Example on Linux/macOS:

```sh
OCR_DATA_DIR=/path/to/workspace uv run python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

On PowerShell, set `$env:OCR_DATA_DIR = "C:\path\to\workspace"` before running the normal start command. Back up the entire directory while the server is stopped, including SQLite's sidecar files if present.

The app targets ordinary 8 GB systems by processing **one document and one page at a time**, limiting rendered images to a 2400-pixel longest side, using recognition batch size 1 and at most four CPU inference threads, and releasing the previous engine when switching packs. It does not load every language at once. Real memory requirements depend on document complexity, model, runtime, GPU allocations, and other applications. Measurements on the development machine are in the verification notes; this was not tested on a physical 8 GB machine.

Run **one API instance with one Uvicorn worker per data directory**. Interrupted jobs resume on restart, preserving completed pages and saved edits. Do not use `--workers` to scale this local application. Bind to loopback as shown; the sample has no user accounts or remote-access authentication.

## Development

The interface refreshes every 2 seconds while documents are queued or processing,
and every 30 seconds when idle. Polling pauses in hidden tabs and refreshes
immediately when you return. Failed requests retry after 5, 10, 20, 40, then
60 seconds (capped); successful requests restore the normal interval. Uploads,
saves, retries, and deletions trigger an immediate refresh. Refreshes preserve
unsaved text, never overlap within a tab, and time out after 15 seconds.

Run the API as above. In another terminal:

```sh
npm --prefix frontend run dev
```

Open the Vite URL (normally http://127.0.0.1:5173). Vite proxies `/api` to port 8000. Build again before serving frontend changes through the FastAPI URL.

### Checks

```sh
uv run ruff check backend tests scripts
uv run ruff format --check backend tests scripts
uv run pytest -q
npm --prefix frontend run format:check
npm --prefix frontend run build
```

Real-model integration test (downloads the English/Chinese/Japanese mixed pack if necessary):

```sh
RUN_OCR_TESTS=1 uv run pytest -q
```

On PowerShell, use `$env:RUN_OCR_TESTS = "1"` followed by `uv run pytest -q`. Set `OCR_TEST_FONT` to a readable TrueType font path if your system lacks `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` (for example, `C:\Windows\Fonts\arial.ttf`). `OCR_MODEL_DIR` overrides the model cache for this integration test only.

Chromium browser tests cover upload → review → save → CSV, draft retention during polling, invalid uploads, and desktop/mobile layouts. They start a server on port 8001 with an isolated temporary database:

```sh
cd frontend
npx playwright install chromium
npm run build
npm run test:e2e
```

Screenshots are written to `frontend/test-results/`. Some Linux environments also require Playwright's Chromium system dependencies (`npx playwright install --with-deps chromium`).

### Project map

```text
backend/main.py          API, upload validation, edits, exports, worker supervision
backend/worker.py        Persistent page-processing queue and recovery
backend/ocr.py           Model download, language packs, provider validation/fallback
backend/documents.py     PDF/image loading, orientation, bounded rendering, previews
backend/db.py            SQLite schema and transactions
frontend/src/App.tsx     Library, document review, polling, settings
frontend/src/components.tsx  Upload and dialog components
tests/                  API, queue recovery, real OCR/fallback integration tests
frontend/e2e/           Browser workflow tests
scripts/create_samples.py   Synthetic sample generator
```

Interactive API documentation is available at **http://127.0.0.1:8000/docs**. The principal routes are `/api/documents`, `/api/documents/{id}`, `/api/documents/{id}/pages/{number}`, `/api/documents/{id}/retry`, `/api/export`, and `/api/system`. Page edits require the current `revision`; conflicting edits return HTTP 409 instead of silently overwriting another save.

## Troubleshooting

- **Model download failed:** confirm access to the model host, then retry the document. Partial downloads are removed; failed checksums are rejected.
- **No GPU in settings:** check the installed ONNX provider list and follow the relevant runtime instructions. CPU remains available.
- **GPU selected but page says CPU:** inspect Processing settings for the fallback message. Having a provider installed alone does not prove its libraries or models work.
- **Some scanned text is missing from a PDF:** upload again with forced PDF OCR enabled.
- **Missing glyphs in the editor:** install system fonts for the document's script. Unicode text is still stored and exported correctly.
- **Frontend not found:** run `npm --prefix frontend run build` and restart the API.

Third-party libraries and models retain their respective licenses. In particular, PyMuPDF is available under AGPL/commercial terms; review its licensing before redistributing this sample as a proprietary product. RapidOCR's manifest supplies the downloaded model sources and hashes.
