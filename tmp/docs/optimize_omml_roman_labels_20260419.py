from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

from lxml import etree


DOCX = Path("E:/xiangmu/miningplan/煤科投稿/最新版论文4.18.docx")
TMP = DOCX.with_suffix(".omml_roman_tmp.docx")

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
}
M = NS["m"]


def qn(ns: str, tag: str) -> str:
    return f"{{{NS[ns]}}}{tag}"


ROMAN_SUBSTRINGS = (
    "ODI",
    "mean",
    "max",
    "min",
    "cov",
    "short",
    "ton",
    "area",
    "eng",
    "CV",
    "NCF",
    "Rev",
    "RiskCost",
    "Cost",
)


def omath_text(node: etree._Element) -> str:
    om = node
    while om is not None and om.tag != qn("m", "oMath"):
        om = om.getparent()
    if om is None:
        return ""
    return "".join(t.text or "" for t in om.xpath(".//m:t", namespaces=NS))


def should_romanize(run: etree._Element) -> bool:
    text_el = run.find("m:t", namespaces=NS)
    if text_el is None:
        return False
    text = text_el.text or ""
    if not text:
        return False
    if any(s in text for s in ROMAN_SUBSTRINGS):
        return True
    # Word sometimes builds Conn_max as "Con" + n_{max}; romanize the split parts
    # only in formulas where the complete oMath text is Connmax.
    full = omath_text(run)
    if "Connmax" in full and (text == "Con" or text == "n"):
        return True
    return False


def ensure_nor(run: etree._Element) -> bool:
    rpr = run.find("m:rPr", namespaces=NS)
    if rpr is None:
        rpr = etree.Element(qn("m", "rPr"))
        # m:rPr should precede w:rPr and m:t when present.
        insert_at = 0
        run.insert(insert_at, rpr)
    if rpr.find("m:nor", namespaces=NS) is None:
        nor = etree.Element(qn("m", "nor"))
        rpr.insert(0, nor)
        return True
    return False


with zipfile.ZipFile(DOCX, "r") as zin:
    entries = {info.filename: zin.read(info.filename) for info in zin.infolist()}

root = etree.fromstring(entries["word/document.xml"])
changed = 0
for run in root.xpath(".//m:r", namespaces=NS):
    if should_romanize(run):
        if ensure_nor(run):
            changed += 1

entries["word/document.xml"] = etree.tostring(
    root,
    xml_declaration=True,
    encoding="UTF-8",
    standalone="yes",
)

with zipfile.ZipFile(TMP, "w", compression=zipfile.ZIP_DEFLATED) as zout:
    with zipfile.ZipFile(DOCX, "r") as zin:
        for info in zin.infolist():
            data = entries[info.filename]
            zout.writestr(info, data)

shutil.move(str(TMP), str(DOCX))
print(f"romanized_runs={changed}")
