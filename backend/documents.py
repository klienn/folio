import threading
import warnings
from pathlib import Path

import pymupdf
from PIL import Image, ImageOps

from .config import MAX_IMAGE_PIXELS, MAX_PAGES

PDF_LOCK = threading.Lock()
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def inspect_document(path: Path, suffix: str) -> tuple[str, int]:
    if suffix == ".pdf":
        with PDF_LOCK, pymupdf.open(path) as pdf:
            if not pdf.is_pdf:
                raise ValueError("The file is not a valid PDF.")
            if pdf.needs_pass:
                raise ValueError("Password-protected PDFs must be unlocked before uploading.")
            if not 1 <= len(pdf) <= MAX_PAGES:
                raise ValueError(f"PDFs must contain between 1 and {MAX_PAGES} pages.")
            return "pdf", len(pdf)
    if suffix not in {".png", ".jpg", ".jpeg"}:
        raise ValueError("Choose a PDF, PNG, or JPG file.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(path) as image:
            if image.format not in {"PNG", "JPEG"}:
                raise ValueError("The file contents must be a PNG or JPEG image.")
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("Images must be smaller than 40 megapixels.")
            image.verify()
    return "image", 1


def image_page(path: Path) -> Image.Image:
    with Image.open(path) as source:
        source.draft("RGB", (2400, 2400))
        image = ImageOps.exif_transpose(source)
        image.thumbnail((2400, 2400))
        if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", rgba.size, "white")
            image = Image.alpha_composite(background, rgba)
        return image.convert("RGB")


def pdf_page(page: pymupdf.Page) -> Image.Image:
    scale = min(200 / 72, 2400 / max(page.rect.width, page.rect.height))
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def save_preview(root: Path, document_id: str, number: int, image: Image.Image):
    directory = root / "previews" / document_id
    directory.mkdir(exist_ok=True)
    preview = image.copy()
    preview.thumbnail((1400, 1400))
    temporary = directory / f"{number}.tmp"
    preview.save(temporary, format="PNG")
    temporary.replace(directory / f"{number}.png")
