"""Small, lazily loaded PP-OCR models with explicit ONNX provider selection."""

import gc
import hashlib
import logging
import os
from pathlib import Path

import numpy as np
import onnxruntime as ort
import requests
import yaml
from PIL import Image

LANGUAGES = {
    "mixed": "English, Chinese & Japanese",
    "en": "English",
    "latin": "Latin scripts (French, Spanish, German, and more)",
    "korean": "Korean",
    "cyrillic": "Cyrillic scripts (Russian, Ukrainian, and more)",
    "arabic": "Arabic-script languages",
    "devanagari": "Devanagari (Hindi, Marathi, and more)",
    "ta": "Tamil",
    "te": "Telugu",
    "th": "Thai",
    "el": "Greek",
}
PROVIDERS = {
    "cuda": ("CUDAExecutionProvider", "NVIDIA CUDA"),
    "directml": ("DmlExecutionProvider", "DirectML GPU"),
    "migraphx": ("MIGraphXExecutionProvider", "AMD MIGraphX"),
    "cpu": ("CPUExecutionProvider", "CPU"),
}
log = logging.getLogger(__name__)


def available_devices() -> list[dict]:
    installed = ort.get_available_providers()
    return [
        {"id": key, "label": label}
        for key, (provider, label) in PROVIDERS.items()
        if provider in installed
    ]


def candidates(device: str) -> list[str]:
    available = {item["id"] for item in available_devices()}
    if device == "auto":
        return [key for key in PROVIDERS if key in available]
    return [device, "cpu"] if device != "cpu" and device in available else ["cpu"]


def download_model(root: Path, info: dict) -> Path:
    path = root / Path(info["model_dir"]).name
    expected = info["SHA256"]

    def digest(file: Path):
        with file.open("rb") as stream:
            return hashlib.file_digest(stream, "sha256").hexdigest()

    if path.exists() and digest(path) == expected:
        return path
    temporary = path.with_suffix(".part")
    try:
        with requests.get(info["model_dir"], stream=True, timeout=(15, 60)) as response:
            response.raise_for_status()
            with temporary.open("wb") as output:
                for chunk in response.iter_content(1024 * 1024):
                    output.write(chunk)
        if digest(temporary) != expected:
            raise RuntimeError("Model checksum did not match. Retry to download it again.")
        temporary.replace(path)
        return path
    finally:
        temporary.unlink(missing_ok=True)


def make_session(path: Path, device: str, shape: tuple) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(4, os.cpu_count() or 1)
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    provider = PROVIDERS[device][0]
    providers = [provider] if device == "cpu" else [provider, "CPUExecutionProvider"]
    session = ort.InferenceSession(str(path), sess_options=options, providers=providers)
    if provider not in session.get_providers():
        raise RuntimeError(f"{PROVIDERS[device][1]} could not initialize.")
    session.disable_fallback()
    # Validate model execution, not just the presence of a driver or provider package.
    session.run(None, {session.get_inputs()[0].name: np.zeros(shape, dtype=np.float32)})
    return session


class OCREngine:
    def __init__(self, root: Path, report=lambda **kwargs: None):
        self.root = root
        self.report = report
        self.engine = None
        self.key = None
        self.device = "cpu"
        self.note = None

    def load(self, language: str, handwriting: bool, device: str):
        key = (language, handwriting, device)
        if self.engine is not None and self.key == key:
            return
        self.engine = None
        gc.collect()
        from rapidocr import RapidOCR
        from rapidocr import __file__ as rapidocr_file
        from rapidocr.utils.typings import LangRec, ModelType, OCRVersion

        self.report(state="loading", backend=None, message="Preparing local OCR models…")
        manifest = yaml.safe_load((Path(rapidocr_file).parent / "default_models.yaml").read_text())[
            "onnxruntime"
        ]
        rec_language = "ch" if language == "mixed" or handwriting else language
        rec_size = "server" if handwriting else "mobile"
        specs = {
            "Det": ("PP-OCRv5", "det", "ch_PP-OCRv5_det_mobile", (1, 3, 64, 64)),
            "Cls": ("PP-OCRv4", "cls", "ch_ppocr_mobile_v2.0_cls_mobile", (1, 3, 48, 192)),
            "Rec": ("PP-OCRv5", "rec", f"{rec_language}_PP-OCRv5_rec_{rec_size}", (1, 3, 48, 320)),
        }
        paths = {
            section: download_model(self.root, manifest[version][task][name])
            for section, (version, task, name, _) in specs.items()
        }
        errors = []
        if device not in {"auto", "cpu"} and device not in {d["id"] for d in available_devices()}:
            errors.append(f"{PROVIDERS[device][1]} is not installed; using CPU.")
        for candidate in candidates(device):
            sessions = {}
            try:
                if candidate == "cuda" and hasattr(ort, "preload_dlls"):
                    ort.preload_dlls()
                for section, path in paths.items():
                    sessions[section] = make_session(path, candidate, specs[section][3])
                engine = RapidOCR(
                    params={
                        "Global.log_level": "error",
                        "Global.max_side_len": 2400,
                        "Global.text_score": 0.35,
                        "Det.ocr_version": OCRVersion.PPOCRV5,
                        "Det.model_type": ModelType.MOBILE,
                        "Det.limit_type": "max",
                        "Det.limit_side_len": 1600,
                        "Rec.ocr_version": OCRVersion.PPOCRV5,
                        "Rec.model_type": ModelType.SERVER if handwriting else ModelType.MOBILE,
                        "Rec.lang_type": LangRec(rec_language),
                        "Rec.rec_batch_num": 1,
                        "Cls.cls_batch_num": 1,
                    }
                )
                # RapidOCR supports supplied ORT sessions; this also enables MIGraphX.
                engine.cfg._set_flag("allow_objects", True)
                for section, session in sessions.items():
                    engine.cfg[section].session = session
                self.engine, self.key, self.device = engine, key, candidate
                self.note = " ".join(errors) or None
                return
            except Exception as exc:
                log.exception("Failed to initialize %s", candidate)
                sessions.clear()
                gc.collect()
                if candidate == "cpu":
                    raise
                errors.append(
                    f"{PROVIDERS[candidate][1]} failed validation; trying fallback. {exc}"
                )

    def recognize(self, image: Image.Image, language: str, handwriting: bool, device: str):
        try:
            self.load(language, handwriting, device)
        except Exception as exc:
            self.report(state="error", backend=None, message=str(exc)[:2000])
            raise
        try:
            result = self.engine(image)
        except Exception:
            if self.device == "cpu":
                raise
            previous = self.device
            self.load(language, handwriting, "cpu")
            self.note = f"{PROVIDERS[previous][1]} failed during processing; resumed on CPU."
            # Keep the fallback for this configuration instead of retrying a broken GPU each page.
            self.key = (language, handwriting, device)
            result = self.engine(image)
        label = PROVIDERS[self.device][1]
        self.report(state="ready", backend=label, message=self.note)
        texts = list(result.txts) if result.txts is not None else []
        scores = list(result.scores) if result.scores is not None else []
        return "\n".join(texts), float(np.mean(scores)) if scores else None, label
