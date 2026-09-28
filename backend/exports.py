import csv
import io
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from tempfile import SpooledTemporaryFile
from unicodedata import east_asian_width
from urllib.parse import quote

import xlsxwriter

HEADERS = ["document_id", "filename", "page_number", "text", "status"]
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def export_disposition(filename: str | None, count: int, selected: bool, format: str) -> str:
    if count == 1:
        stem = Path(filename).stem
        stem = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', "-", stem)
        stem = stem.encode("utf-8")[:140].decode("utf-8", errors="ignore").strip(" .")
        stem = f"{stem or 'document'}-ocr"
    else:
        scope = "selected" if selected else "library"
        stem = f"folio-{scope}-{count}-documents"
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%SZ")
    name = f"{stem}_{timestamp}.{format}"
    fallback = name.encode("ascii", errors="replace").decode().replace("?", "_")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


def csv_cell(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def csv_rows(rows):
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    yield "\ufeff"
    writer.writerow(HEADERS)
    yield buffer.getvalue()
    for row in rows:
        buffer.seek(0)
        buffer.truncate()
        writer.writerow([csv_cell(cell) for cell in row])
        yield buffer.getvalue()


def csv_file(rows):
    directory = "/tmp/opencode" if Path("/tmp/opencode").is_dir() else None
    output = SpooledTemporaryFile(max_size=8 * 1024 * 1024, dir=directory)
    try:
        for chunk in csv_rows(rows):
            output.write(chunk.encode("utf-8"))
        output.seek(0)
        return output
    except Exception:
        output.close()
        raise


def row_height(text):
    lines = sum(
        max(1, math.ceil(sum(2 if east_asian_width(c) in "WF" else 1 for c in line) / 80))
        for line in text.splitlines()
    )
    return min(409, max(36, lines * 15 + 12))


def excel_file(rows):
    directory = "/tmp/opencode" if Path("/tmp/opencode").is_dir() else None
    output = SpooledTemporaryFile(max_size=8 * 1024 * 1024, dir=directory)
    try:
        with xlsxwriter.Workbook(
            output, {"constant_memory": True, "tmpdir": directory}
        ) as workbook:
            sheet = workbook.add_worksheet("Pages")
            sheet.freeze_panes(1, 0)
            sheet.hide_gridlines(2)
            for column, width in enumerate((34, 36, 14, 90, 18)):
                sheet.set_column(column, column, width)
            header = workbook.add_format(
                {
                    "font_name": "Arial",
                    "font_size": 11,
                    "bold": True,
                    "font_color": "#FFFFFF",
                    "bg_color": "#4258E8",
                    "valign": "vcenter",
                }
            )
            styles = [
                workbook.add_format(
                    {
                        "font_name": "Arial",
                        "font_size": 11,
                        "font_color": "#243247",
                        "valign": "top",
                        "text_wrap": True,
                        "bg_color": color,
                    }
                )
                for color in ("#FFFFFF", "#F3F6FA")
            ]
            sheet.set_row(0, 28)
            sheet.write_row(0, 0, HEADERS, header)
            count = 0
            for count, row in enumerate(rows, 1):
                if count >= 1_048_576:
                    raise ValueError(
                        "Too many pages for one Excel sheet. Use CSV or select fewer documents."
                    )
                sheet.set_row(count, row_height(row[3]))
                for column, value in enumerate(row):
                    style = styles[(count - 1) % 2]
                    if column == 2:
                        sheet.write_number(count, column, value, style)
                    else:
                        # Keep IDs and formula-like text literal, without automatic hyperlinks.
                        result = sheet.write_string(count, column, value, style)
                        if result == -2:
                            raise ValueError(
                                f"{row[1]}, page {row[2]} exceeds Excel's "
                                "32,767-character cell limit. "
                                "Use CSV to export the full text."
                            )
            sheet.autofilter(0, 0, count, len(HEADERS) - 1)
        output.seek(0)
        return output
    except Exception:
        output.close()
        raise


def file_chunks(stream):
    try:
        while chunk := stream.read(64 * 1024):
            yield chunk
    finally:
        stream.close()
