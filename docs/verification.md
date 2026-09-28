# Verification notes

These are development checks, not a benchmark or a guarantee of accuracy for arbitrary documents.

## Environment

- Linux / WSL, Python 3.12, ONNX Runtime CPU, RapidOCR 3.9.2.
- Development host reports approximately 24 GB RAM. No physical 8 GB device or NVIDIA/AMD GPU was used for these checks.
- Chromium browser automation at 1440 × 1000 and 390 × 844.

## Automated coverage

- API/database tests cover multipage PDFs, mixed scanned/digital pages, forced OCR, invalid/encrypted/oversized uploads, partial batch success, page previews/originals, saved corrections, optimistic edit conflicts, persistence after reopening, CSV Unicode/quoting/empty edits/formula neutralization, selected exports, failed-page retries, deletion, and interrupted-job recovery.
- An opt-in real-model CPU test recognizes `Invoice 12345` and simulates GPU initialization/inference failures to verify CPU fallback. Simulated failures are not physical GPU validation.
- Browser tests exercise upload, automatic background processing, page navigation, draft preservation during polling, save, original extraction, CSV download, library selection, deletion, invalid-upload errors, and mobile overflow checks.

Initial OCR implementation checks: **11 Python tests passed** (including real OCR), **2 Chromium workflow tests passed**, and frontend production build, Python lint/format checks, and frontend formatting passed.

The Excel export update passed **13 Python tests** with the opt-in real OCR test skipped, plus **2 Chromium workflow tests**, the frontend build, and lint/format checks. Export coverage now checks the five-column CSV schema, Excel download, saved Unicode/multiline/empty corrections, literal formula-like text, numeric page numbers, styling, wide wrapped text, top alignment, frozen headers, filters, selected/all documents, empty workspaces, and Excel cell-limit errors without CSV truncation. Browser screenshots verify that the format selector fits desktop and mobile layouts.

The document-deletion update passed **18 Python tests** (opt-in real OCR skipped), **3 Chromium workflow tests**, the frontend production build, and Python lint checks. Tests verify removal of original uploads, every page preview, document/page database rows, saved corrections, and export entries for completed and failed documents; unrelated documents and shared models remain intact. Permission failures for originals and previews retain database records and succeed on retry. Missing files are tolerated, active jobs cannot be deleted, and browser coverage includes cancellation, library row deletion, selected deletion with partial failures, retry, and persistence after reload. Permission failures are simulated; native Windows file-lock behavior has not been tested.

A live-server check also uploaded five documents through the real API and spawned worker: an embedded-text PDF, printed PNG, two-page scanned PDF, multilingual PNG, and JPEG. All seven pages completed, their previews loaded, and the combined CSV contained seven page rows. The four generated sample documents are left in the local workspace for trying the app; the temporary JPEG check was deleted.

## Setup scripts

- Ran `scripts/setup.sh` on Linux against a clean project copy with no virtual environment, frontend dependencies, or build output. Existing local download caches were available.
- Confirmed locked dependency installation, production frontend build, and backend import succeeded. The project path contained spaces, the command ran from another directory, and an existing file in `data/` was preserved.
- Isolated command-stub checks covered help, unknown options, missing/unsupported Node.js, missing download tools, uv installation flow, rerunning setup, start arguments, and stopping after an installation failure. The uv bootstrap check simulated the installer rather than downloading it.
- Native Windows PowerShell and macOS setup have not been executed on those platforms.

## Real-model spot checks

| Input | Mode | Result |
| --- | --- | --- |
| Synthetic English line | English mobile, CPU | Exact `Hello, local OCR. Page 1 of 2.` |
| `samples/sample-invoice.png` | English mobile, CPU | Invoice number, date, company, descriptions, and amounts extracted correctly; columns become separate lines |
| `samples/multilingual.png` | Mixed mobile, CPU | Exact English lines, `中文文字识别测试`, and `日本語の文字認識` |
| Same multilingual image | Handwriting/server pack, CPU | Same text correctly extracted |
| [Public handwriting example](https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/handwriting.jpg) | Handwriting/server pack, CPU | Recognized `Mr. Bom commented icily`; image reads `Mr. Brown commented icily.` — name and final punctuation need correction |

The handwriting example demonstrates why review is part of the workflow. That external example was used only for a local check and is not distributed in this project. Other language packs are exposed based on the model manifest's coverage; they have not all been individually accuracy-tested.

## Observed process memory

Linux peak resident memory (`resource.getrusage`, OCR process only):

- Invoice then mixed-mobile model switching: approximately **543 MiB** peak.
- Switching again to the server/handwriting pack: approximately **609 MiB** peak.
- Separate handwriting-line process: approximately **494 MiB** peak.

These exclude the browser, API, OS, and GPU allocations. The first model load may include download time. Larger or more complex inputs may use more memory. The code bounds page size, runs inference sequentially, and holds one model configuration at a time, but these measurements do not establish a universal 8 GB ceiling.
