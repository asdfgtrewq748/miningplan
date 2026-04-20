from __future__ import annotations

import re
import shutil
import zipfile
from copy import deepcopy
from pathlib import Path

from lxml import etree


DOCX = Path("E:/xiangmu/miningplan/煤科投稿/最新版论文4.18.docx")
TMP = DOCX.with_suffix(".crossref_tmp.docx")

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = NS["w"]


def qn(tag: str) -> str:
    return f"{{{W}}}{tag}"


def paragraph_text(p: etree._Element) -> str:
    return "".join(t.text or "" for t in p.xpath(".//w:t", namespaces=NS)).strip()


def is_citation(token: str) -> bool:
    if token in {"[0,1]", "[0，1]"}:
        return False
    inner = token.strip("[]")
    if not re.fullmatch(r"[0-9,，\-–—\s]+", inner):
        return False
    nums = [int(x) for x in re.findall(r"\d+", inner)]
    return bool(nums) and min(nums) >= 1 and max(nums) <= 50


def first_ref(token: str) -> int:
    return int(re.search(r"\d+", token).group(0))


def max_bookmark_id(root: etree._Element) -> int:
    ids = []
    for el in root.xpath(".//w:bookmarkStart", namespaces=NS):
        val = el.get(qn("id"))
        if val and val.isdigit():
            ids.append(int(val))
    return max(ids) if ids else 0


def remove_ref_bookmarks_and_links(root: etree._Element) -> None:
    # Unwrap previous internal hyperlinks to REF_*.
    for h in list(root.xpath(".//w:hyperlink[starts-with(@w:anchor,'REF_')]", namespaces=NS)):
        parent = h.getparent()
        idx = parent.index(h)
        for child in list(h):
            h.remove(child)
            parent.insert(idx, child)
            idx += 1
        parent.remove(h)

    # Remove old REF_* bookmark starts/ends.
    ref_ids = set()
    for b in list(root.xpath(".//w:bookmarkStart[starts-with(@w:name,'REF_')]", namespaces=NS)):
        bid = b.get(qn("id"))
        if bid is not None:
            ref_ids.add(bid)
        b.getparent().remove(b)
    for e in list(root.xpath(".//w:bookmarkEnd", namespaces=NS)):
        if e.get(qn("id")) in ref_ids:
            e.getparent().remove(e)


def add_reference_bookmarks(root: etree._Element, ref_header_idx: int) -> int:
    bookmark_id = max_bookmark_id(root) + 1
    count = 0
    paragraphs = root.xpath(".//w:p", namespaces=NS)
    for p in paragraphs[ref_header_idx + 1 :]:
        text = paragraph_text(p)
        m = re.match(r"^\[(\d{1,2})\]", text)
        if not m:
            continue
        n = int(m.group(1))
        if not (1 <= n <= 50):
            continue

        name = f"REF_{n:03d}"
        start = etree.Element(qn("bookmarkStart"))
        start.set(qn("id"), str(bookmark_id))
        start.set(qn("name"), name)
        end = etree.Element(qn("bookmarkEnd"))
        end.set(qn("id"), str(bookmark_id))

        p.insert(0, start)
        # Keep bookmark end before paragraph properties if any, otherwise at paragraph end.
        p.append(end)
        bookmark_id += 1
        count += 1
    return count


def make_run_like(src_run: etree._Element, text: str) -> etree._Element:
    new_run = deepcopy(src_run)
    # Keep run properties, remove old content.
    for child in list(new_run):
        if child.tag != qn("rPr"):
            new_run.remove(child)
    t = etree.Element(qn("t"))
    if text.startswith(" ") or text.endswith(" "):
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t.text = text
    new_run.append(t)
    return new_run


def normalize_citation_run(run: etree._Element) -> None:
    rpr = run.find("w:rPr", namespaces=NS)
    if rpr is None:
        rpr = etree.Element(qn("rPr"))
        run.insert(0, rpr)

    # Superscript.
    va = rpr.find("w:vertAlign", namespaces=NS)
    if va is None:
        va = etree.Element(qn("vertAlign"))
        rpr.append(va)
    va.set(qn("val"), "superscript")

    # 9 pt.
    sz = rpr.find("w:sz", namespaces=NS)
    if sz is None:
        sz = etree.Element(qn("sz"))
        rpr.append(sz)
    sz.set(qn("val"), "18")

    # Keep link visually like normal citation: no underline and automatic/black text.
    u = rpr.find("w:u", namespaces=NS)
    if u is None:
        u = etree.Element(qn("u"))
        rpr.append(u)
    u.set(qn("val"), "none")

    color = rpr.find("w:color", namespaces=NS)
    if color is None:
        color = etree.Element(qn("color"))
        rpr.append(color)
    color.set(qn("val"), "000000")


def wrap_citation_run(run: etree._Element, token: str) -> etree._Element:
    href = etree.Element(qn("hyperlink"))
    href.set(qn("anchor"), f"REF_{first_ref(token):03d}")
    href.set(qn("history"), "1")
    normalize_citation_run(run)
    href.append(run)
    return href


def split_run_for_citations(run: etree._Element) -> list[etree._Element] | None:
    text_nodes = run.xpath("./w:t", namespaces=NS)
    if len(text_nodes) != 1:
        return None
    text = text_nodes[0].text or ""
    matches = [m for m in re.finditer(r"\[[0-9,，\-–—\s]+\]", text) if is_citation(m.group(0))]
    if not matches:
        return None

    out: list[etree._Element] = []
    pos = 0
    for m in matches:
        if m.start() > pos:
            out.append(make_run_like(run, text[pos : m.start()]))
        token = m.group(0)
        cite_run = make_run_like(run, token)
        out.append(wrap_citation_run(cite_run, token))
        pos = m.end()
    if pos < len(text):
        out.append(make_run_like(run, text[pos:]))
    return out


def add_body_links(root: etree._Element, ref_header_idx: int) -> int:
    count = 0
    paragraphs = root.xpath(".//w:p", namespaces=NS)
    for p in paragraphs[:ref_header_idx]:
        # Only operate on direct run children. This avoids touching formula internals.
        for child in list(p):
            if child.tag != qn("r"):
                continue
            pieces = split_run_for_citations(child)
            if not pieces:
                continue
            idx = p.index(child)
            p.remove(child)
            for piece in pieces:
                p.insert(idx, piece)
                if piece.tag == qn("hyperlink"):
                    count += 1
                idx += 1
    return count


with zipfile.ZipFile(DOCX, "r") as zin:
    infos = zin.infolist()
    entries = {info.filename: zin.read(info.filename) for info in infos}

root = etree.fromstring(entries["word/document.xml"])
paragraphs = root.xpath(".//w:p", namespaces=NS)
ref_header_idx = None
for i, p in enumerate(paragraphs):
    if paragraph_text(p) == "参考文献":
        ref_header_idx = i
        break
if ref_header_idx is None:
    raise RuntimeError("Reference heading not found.")

remove_ref_bookmarks_and_links(root)
bookmark_count = add_reference_bookmarks(root, ref_header_idx)
link_count = add_body_links(root, ref_header_idx)

entries["word/document.xml"] = etree.tostring(
    root,
    xml_declaration=True,
    encoding="UTF-8",
    standalone="yes",
)

with zipfile.ZipFile(TMP, "w", compression=zipfile.ZIP_DEFLATED) as zout:
    for info in infos:
        zout.writestr(info, entries[info.filename])

shutil.move(str(TMP), str(DOCX))
print(f"reference_bookmarks={bookmark_count}")
print(f"body_citation_hyperlinks={link_count}")
