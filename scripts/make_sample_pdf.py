"""Builds public/sample-SYNTHETIC-annual-report.pdf from tests/fixtures/synthetic-report.json.

Offline helper (standard library only). The PDF is a SYNTHETIC demo document: not a real company,
every figure invented. It lets visitors try the PDF route without uploading anything real.

    python scripts/make_sample_pdf.py
"""
import json
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "tests" / "fixtures" / "synthetic-report.json"
OUT = ROOT / "public" / "sample-SYNTHETIC-annual-report.pdf"

PAGE_W, PAGE_H = 842, 595  # A4 landscape, points
LEFT, TOP, LEADING, SIZE = 40, 555, 15, 9
WRAP = 130  # characters that fit across the page in 9pt Courier


def esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build(pages: list[list[str]]) -> bytes:
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")
    pages_id = len(objects) + 1 + 2 * len(pages)  # reserved: the /Pages object comes after all page pairs
    kids = []
    for lines in pages:
        ops = ["BT", f"/F1 {SIZE} Tf", f"{LEADING} TL", f"{LEFT} {TOP} Td"]
        for line in (part for raw in lines for part in (textwrap.wrap(raw, WRAP) or [''])):
            ops.append(f"({esc(line)}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("cp1252")
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        kids.append(add(
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>"
            % (pages_id, PAGE_W, PAGE_H, content, font)
        ))
    assert len(objects) + 1 == pages_id
    add(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids)))
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, catalog, xref)
    return bytes(out)


if __name__ == "__main__":
    data = json.loads(SRC.read_text(encoding="utf-8"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(build(data["pages"]))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, {len(data['pages'])} pages)")
