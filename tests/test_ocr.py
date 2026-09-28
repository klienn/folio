import os
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from backend.ocr import OCREngine, candidates


def test_provider_preference_and_unavailable_fallback(monkeypatch):
    monkeypatch.setattr(
        "backend.ocr.available_devices", lambda: [{"id": "cuda"}, {"id": "migraphx"}, {"id": "cpu"}]
    )
    assert candidates("auto") == ["cuda", "migraphx", "cpu"]
    assert candidates("directml") == ["cpu"]
    assert candidates("cpu") == ["cpu"]


@pytest.mark.ocr
@pytest.mark.skipif(os.getenv("RUN_OCR_TESTS") != "1", reason="Opt-in model download and inference")
def test_real_cpu_ocr_and_initialization_fallback(monkeypatch):
    from backend import ocr

    font_path = os.getenv("OCR_TEST_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    if not Path(font_path).exists():
        pytest.skip("Set OCR_TEST_FONT to a local TrueType font")
    image = Image.new("RGB", (1100, 240), "white")
    ImageDraw.Draw(image).text(
        (40, 70),
        "Hello, local OCR. Invoice 12345.",
        fill="black",
        font=ImageFont.truetype(font_path, 40),
    )
    root = Path(os.getenv("OCR_MODEL_DIR", "data/models"))
    root.mkdir(parents=True, exist_ok=True)
    original = ocr.make_session
    attempted = []

    def simulated_gpu_failure(path, device, shape):
        attempted.append(device)
        if device == "cuda":
            raise RuntimeError("Simulated missing GPU libraries")
        return original(path, device, shape)

    monkeypatch.setattr(ocr, "available_devices", lambda: [{"id": "cuda"}, {"id": "cpu"}])
    monkeypatch.setattr(ocr, "make_session", simulated_gpu_failure)
    engine = OCREngine(root)
    text, confidence, backend = engine.recognize(image, "mixed", False, "auto")
    assert "Invoice 12345" in text
    assert confidence > 0.8
    assert backend == "CPU"
    assert attempted[0] == "cuda"
    assert "failed validation" in engine.note

    # A mid-job accelerator failure must also fall back to actual CPU inference.
    class FailedGPU:
        def __call__(self, image):
            raise RuntimeError("Device lost")

    engine.engine = FailedGPU()
    engine.device = "cuda"
    text, _, backend = engine.recognize(image, "mixed", False, "auto")
    assert "Invoice 12345" in text
    assert backend == "CPU"
    assert "resumed on CPU" in engine.note
