from __future__ import annotations

import re
import sys
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


NUM_RE = re.compile(r"^\uff08\d+\uff09$")


def is_formula_table(tbl) -> bool:
    rows = tbl.findall(qn("w:tr"))
    if len(rows) != 1:
        return False
    cells = rows[0].findall(qn("w:tc"))
    if len(cells) != 3:
        return False
    texts = []
    for cell in cells:
        value = "".join(t.text or "" for t in cell.findall(".//" + qn("w:t"))).strip()
        texts.append(value)
    return any(NUM_RE.fullmatch(text) for text in texts)


def make_separator_paragraph():
    p = OxmlElement("w:p")
    ppr = OxmlElement("w:pPr")

    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:before"), "0")
    spacing.set(qn("w:after"), "0")
    spacing.set(qn("w:line"), "1")
    spacing.set(qn("w:lineRule"), "exact")
    ppr.append(spacing)

    rpr = OxmlElement("w:rPr")
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), "1")
    rpr.append(sz)
    ppr.append(rpr)

    p.append(ppr)
    r = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.set(qn("xml:space"), "preserve")
    t.text = " "
    r.append(t)
    p.append(r)
    return p


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: ensure_formula_table_separators_20260418.py <docx>")
        return 2

    path = Path(sys.argv[1])
    doc = Document(str(path))
    body = doc._body._element
    children = list(body)

    inserted = 0
    for i, child in enumerate(children[:-1]):
        if child.tag != qn("w:tbl"):
            continue
        if not is_formula_table(child):
            continue
        next_child = children[i + 1]
        if next_child.tag == qn("w:tbl") and is_formula_table(next_child):
            child.addnext(make_separator_paragraph())
            inserted += 1

    if inserted:
        doc.save(str(path))

    print(f"inserted_separators={inserted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
