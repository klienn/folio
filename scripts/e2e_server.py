import os
import tempfile
from pathlib import Path

import uvicorn
from create_samples import create_samples

if __name__ == "__main__":
    project = Path(__file__).resolve().parent.parent
    create_samples(project / "frontend" / ".e2e")
    preferred_tmp = Path("/tmp/opencode")
    with tempfile.TemporaryDirectory(
        prefix="folio-e2e-", dir=preferred_tmp if preferred_tmp.exists() else None
    ) as directory:
        os.environ["OCR_DATA_DIR"] = directory
        uvicorn.run("backend.main:app", host="127.0.0.1", port=8001, app_dir=str(project))
