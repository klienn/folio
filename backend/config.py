import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_PAGES = 500
MAX_IMAGE_PIXELS = 40_000_000


def data_directory() -> Path:
    return Path(os.environ.get("OCR_DATA_DIR", ROOT / "data")).resolve()
