"""Generate original, synthetic documents for trying the workspace without personal files."""

import argparse
from pathlib import Path

import pymupdf


def write_page(pdf, title, lines, page_number):
    page = pdf.new_page(width=595, height=842)
    page.draw_rect(pymupdf.Rect(0, 0, 595, 12), color=None, fill=(0.25, 0.36, 0.91))
    page.insert_text((55, 60), "FOLIO / SAMPLE DOCUMENT", fontsize=9, color=(0.45, 0.5, 0.6))
    page.insert_text((55, 116), title, fontsize=25, color=(0.15, 0.2, 0.3))
    page.draw_line((55, 145), (540, 145), color=(0.87, 0.9, 0.94))
    for index, line in enumerate(lines):
        page.insert_text((55, 185 + index * 29), line, fontsize=12, color=(0.25, 0.3, 0.4))
    page.insert_text((55, 790), f"Synthetic sample - Page {page_number}", fontsize=9)
    return page


def create_samples(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    with pymupdf.open() as pdf:
        write_page(
            pdf,
            "A little less paperwork.",
            [
                "Welcome to your local document workspace.",
                "This two-page PDF contains selectable text.",
                "Folio reads its text layer without running an OCR model.",
                "Try correcting this sentence, then save your changes.",
                "Your CSV export will contain one row for each page.",
            ],
            1,
        )
        write_page(
            pdf,
            "Make the text your own.",
            [
                "1. Compare the original page with the extracted text.",
                "2. Make a correction and select Save changes.",
                "3. Download the document as a CSV file.",
                "Punctuation stays intact: commas, quotes, and line breaks.",
                'Example: "Review complete, ready to export."',
            ],
            2,
        )
        pdf.save(directory / "welcome-guide.pdf")

    with pymupdf.open() as original, pymupdf.open() as scans:
        for number in (1, 2):
            page = write_page(
                original,
                f"Invoice 2026-00{number}",
                [
                    "Northwind Studio",
                    "September 28, 2026",
                    "Bill to: Sample Company",
                    "Document digitization        $125.00",
                    "Review and corrections        $45.00",
                    "Total due                    $170.00",
                    "Thank you for your business.",
                ],
                number,
            )
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2))
            if number == 1:
                pixmap.save(directory / "sample-invoice.png")
            scan = scans.new_page(width=595, height=842)
            scan.insert_image(scan.rect, stream=pixmap.tobytes("png"))
        scans.save(directory / "scanned-invoices.pdf", deflate=True)

    with pymupdf.open() as pdf:
        page = pdf.new_page(width=650, height=330)
        page.insert_text((35, 60), "Multilingual OCR sample", fontsize=24)
        page.insert_text((35, 120), "Hello, local document recognition.", fontsize=21)
        page.insert_text((35, 180), "中文文字识别测试", fontname="china-s", fontsize=26)
        page.insert_text((35, 240), "日本語の文字認識", fontname="japan", fontsize=26)
        page.get_pixmap(matrix=pymupdf.Matrix(2, 2)).save(directory / "multilingual.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("samples"))
    args = parser.parse_args()
    create_samples(args.output)
    print(f"Created 4 sample documents in {args.output.resolve()}")
