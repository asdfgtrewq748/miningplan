from __future__ import annotations

import sys
import zipfile
from pathlib import Path

from docx import Document


REPLACEMENTS = {
    15: (
        "[4-10,33-37,39-41,45,48-50]",
        "[4-10,22-25,33-37,39-41,45,48-50]",
    ),
    100: (
        "[33-37,39-41,45,48-50]",
        "[22-25,33-37,39-41,45,48-50]",
    ),
    104: (
        "[34-37,40-41,45,49-50]",
        "[22-25,34-37,40-41,45,49-50]",
    ),
}


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: patch_missing_body_citations_20260418.py <docx>")
        return 2

    path = Path(sys.argv[1])
    doc = Document(str(path))

    changed = []
    for para_idx, (old, new) in REPLACEMENTS.items():
        paragraph = doc.paragraphs[para_idx]
        if new in paragraph.text:
            continue
        if old not in paragraph.text:
            raise RuntimeError(f"Expected citation token not found at paragraph {para_idx}: {old}")
        paragraph.text = paragraph.text.replace(old, new, 1)
        changed.append(para_idx)

    doc.save(str(path))
    with zipfile.ZipFile(path) as zf:
        bad = zf.testzip()
    if bad is not None:
        raise RuntimeError(f"Bad DOCX zip member: {bad}")

    print(f"Patched paragraphs: {changed}")
    print(f"DOCX OK: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
