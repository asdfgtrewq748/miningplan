from pathlib import Path
from zipfile import ZipFile
import re

from docx import Document
from lxml import etree


BASE = Path(__file__).resolve().parents[1]
DOCX = BASE / "煤科论文5.23格式改稿_格式问题修正版.docx"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def cm(length):
    return round(length.twips / 567, 2)


doc = Document(DOCX)
paragraphs = [p for p in doc.paragraphs if p.text.strip()]

table_caption_issues = []
for p in paragraphs:
    text = p.text.strip()
    if p.style and p.style.name == "15表题" and text.startswith("Table  "):
        table_caption_issues.append(text)

mixed_caption_issues = [
    p.text.strip()
    for p in paragraphs
    if p.style and p.style.name == "14图题" and "\nFig." in p.text
]

refs = []
in_refs = False
for p in paragraphs:
    text = p.text.strip()
    if text == "参考文献":
        in_refs = True
        continue
    if in_refs:
        m = re.match(r"^\[(\d{1,3})\]", text)
        if m:
            refs.append((int(m.group(1)), text, p))

tabbed_refs = [n for n, text, _ in refs if "\t" in text]
missing_bilingual = [
    n
    for n, text, _ in refs
    if re.search(r"[\u4e00-\u9fff]", text)
    and not re.search(r"[A-Z]{2,}\s+[A-Z][a-z]+.*\[(J|M|D|C)\]", text)
]

with ZipFile(DOCX) as z:
    root = etree.fromstring(z.read("word/document.xml"))
section_breaks = len(root.xpath(".//w:body/w:p/w:pPr/w:sectPr", namespaces=NS))
body_sections = len(root.xpath(".//w:body/w:sectPr", namespaces=NS))

print("sections:", section_breaks + body_sections, "paragraph-level:", section_breaks, "body:", body_sections)
print("first section margins:", {k: cm(getattr(doc.sections[0], k)) for k in ["top_margin", "bottom_margin", "left_margin", "right_margin", "header_distance", "footer_distance"]})
print("different first page:", doc.sections[0].different_first_page_header_footer)
print("refs:", len(refs), refs[0][0], refs[-1][0])
print("tabbed refs:", tabbed_refs)
print("missing bilingual chinese refs:", missing_bilingual)
print("table caption issues:", table_caption_issues)
print("mixed fig caption issues:", mixed_caption_issues)
print("fixed text has 文献标志码:", any("文献标志码" in p.text for p in paragraphs))
print("Berlin double comma:", any("Berlin, ," in text for _, text, _ in refs))
for n, text, _ in refs:
    if n in (2, 11, 14, 15, 19, 20, 21):
        print(n, text[:240])
