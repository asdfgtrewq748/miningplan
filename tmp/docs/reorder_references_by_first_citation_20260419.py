from __future__ import annotations

import re
import shutil
import zipfile
from copy import deepcopy
from pathlib import Path

from lxml import etree


DOCX = Path("E:/xiangmu/miningplan/煤科投稿/最新版论文4.18.docx")
REPORT = Path("E:/xiangmu/miningplan/tmp/docs/reference_reorder_map_20260419.txt")
TMP = DOCX.with_suffix(".ref_reorder_tmp.docx")

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
}
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


def expand_citation(token: str) -> list[int]:
    inner = token.strip("[]").replace("，", ",").replace("–", "-").replace("—", "-")
    out: list[int] = []
    for part in inner.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = [int(x) for x in part.split("-", 1)]
            step = 1 if b >= a else -1
            out.extend(range(a, b + step, step))
        else:
            out.append(int(part))
    return out


def compress_numbers(nums: list[int]) -> str:
    nums = list(nums)
    if not nums:
        return "[]"
    ranges: list[str] = []
    start = prev = nums[0]
    for n in nums[1:]:
        if n == prev + 1:
            prev = n
            continue
        ranges.append(f"{start}" if start == prev else f"{start}-{prev}")
        start = prev = n
    ranges.append(f"{start}" if start == prev else f"{start}-{prev}")
    return "[" + ",".join(ranges) + "]"


def max_bookmark_id(root: etree._Element) -> int:
    ids = []
    for el in root.xpath(".//w:bookmarkStart", namespaces=NS):
        val = el.get(qn("id"))
        if val and val.isdigit():
            ids.append(int(val))
    return max(ids) if ids else 0


def remove_ref_bookmarks_and_links(root: etree._Element) -> None:
    for h in list(root.xpath(".//w:hyperlink[starts-with(@w:anchor,'REF_')]", namespaces=NS)):
        parent = h.getparent()
        idx = parent.index(h)
        for child in list(h):
            h.remove(child)
            parent.insert(idx, child)
            idx += 1
        parent.remove(h)

    ref_ids = set()
    for b in list(root.xpath(".//w:bookmarkStart[starts-with(@w:name,'REF_')]", namespaces=NS)):
        bid = b.get(qn("id"))
        if bid is not None:
            ref_ids.add(bid)
        b.getparent().remove(b)
    for e in list(root.xpath(".//w:bookmarkEnd", namespaces=NS)):
        if e.get(qn("id")) in ref_ids:
            e.getparent().remove(e)


def remove_hyperlink_style(run: etree._Element) -> None:
    rpr = run.find("w:rPr", namespaces=NS)
    if rpr is None:
        return
    for style in list(rpr.xpath("./w:rStyle", namespaces=NS)):
        rpr.remove(style)


def normalize_citation_run(run: etree._Element) -> None:
    rpr = run.find("w:rPr", namespaces=NS)
    if rpr is None:
        rpr = etree.Element(qn("rPr"))
        run.insert(0, rpr)
    remove_hyperlink_style(run)
    va = rpr.find("w:vertAlign", namespaces=NS)
    if va is None:
        va = etree.Element(qn("vertAlign"))
        rpr.append(va)
    va.set(qn("val"), "superscript")
    sz = rpr.find("w:sz", namespaces=NS)
    if sz is None:
        sz = etree.Element(qn("sz"))
        rpr.append(sz)
    sz.set(qn("val"), "18")
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


def make_run_like(src_run: etree._Element, text: str) -> etree._Element:
    new_run = deepcopy(src_run)
    for child in list(new_run):
        if child.tag != qn("rPr"):
            new_run.remove(child)
    t = etree.Element(qn("t"))
    if text.startswith(" ") or text.endswith(" "):
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t.text = text
    new_run.append(t)
    return new_run


def split_run_for_citations(run: etree._Element, old_to_new: dict[int, int]) -> list[etree._Element] | None:
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
        old_nums = expand_citation(m.group(0))
        new_nums = sorted(dict.fromkeys(old_to_new[n] for n in old_nums))
        new_token = compress_numbers(new_nums)
        cite_run = make_run_like(run, new_token)
        normalize_citation_run(cite_run)
        href = etree.Element(qn("hyperlink"))
        href.set(qn("anchor"), f"REF_{new_nums[0]:03d}")
        href.set(qn("history"), "1")
        href.append(cite_run)
        out.append(href)
        pos = m.end()
    if pos < len(text):
        out.append(make_run_like(run, text[pos:]))
    return out


def add_body_links_and_update_citations(root: etree._Element, ref_header_idx: int, old_to_new: dict[int, int]) -> int:
    count = 0
    paragraphs = root.xpath(".//w:body/w:p", namespaces=NS)
    for p in paragraphs[:ref_header_idx]:
        runs = list(
            p.xpath(
                ".//w:r[./w:t and not(ancestor::m:oMath) and not(ancestor::m:oMathPara)]",
                namespaces=NS,
            )
        )
        for child in runs:
            parent = child.getparent()
            if parent is None:
                continue
            pieces = split_run_for_citations(child, old_to_new)
            if not pieces:
                continue
            idx = parent.index(child)
            parent.remove(child)
            for piece in pieces:
                parent.insert(idx, piece)
                if piece.tag == qn("hyperlink"):
                    count += 1
                idx += 1
    return count


def update_reference_number(p: etree._Element, old_n: int, new_n: int) -> None:
    target = f"[{old_n}]"
    repl = f"[{new_n}]"
    for t in p.xpath(".//w:t", namespaces=NS):
        if t.text and target in t.text:
            t.text = t.text.replace(target, repl, 1)
            return


def add_reference_bookmarks(root: etree._Element, ref_paragraphs: list[etree._Element]) -> int:
    bookmark_id = max_bookmark_id(root) + 1
    count = 0
    for i, p in enumerate(ref_paragraphs, start=1):
        start = etree.Element(qn("bookmarkStart"))
        start.set(qn("id"), str(bookmark_id))
        start.set(qn("name"), f"REF_{i:03d}")
        end = etree.Element(qn("bookmarkEnd"))
        end.set(qn("id"), str(bookmark_id))
        p.insert(0, start)
        p.append(end)
        bookmark_id += 1
        count += 1
    return count


with zipfile.ZipFile(DOCX, "r") as zin:
    infos = zin.infolist()
    entries = {info.filename: zin.read(info.filename) for info in infos}

root = etree.fromstring(entries["word/document.xml"])
body = root.find(".//w:body", namespaces=NS)
paragraphs = root.xpath(".//w:body/w:p", namespaces=NS)
ref_header_idx = None
for i, p in enumerate(paragraphs):
    if paragraph_text(p) == "参考文献":
        ref_header_idx = i
        break
if ref_header_idx is None:
    raise RuntimeError("Reference heading not found.")

remove_ref_bookmarks_and_links(root)

# Current direct-body paragraphs after the reference heading.
paragraphs = root.xpath(".//w:body/w:p", namespaces=NS)
ref_header = paragraphs[ref_header_idx]
ref_paras_by_old: dict[int, etree._Element] = {}
for p in paragraphs[ref_header_idx + 1 :]:
    text = paragraph_text(p)
    m = re.match(r"^\[(\d{1,2})\]", text)
    if not m:
        continue
    n = int(m.group(1))
    if 1 <= n <= 50:
        ref_paras_by_old[n] = p

if len(ref_paras_by_old) != 50:
    raise RuntimeError(f"Expected 50 references, found {len(ref_paras_by_old)}")

# Determine first citation order in body text.
order: list[int] = []
seen: set[int] = set()
for p in paragraphs[:ref_header_idx]:
    text = paragraph_text(p)
    for m in re.finditer(r"\[[0-9,，\-–—\s]+\]", text):
        token = m.group(0)
        if not is_citation(token):
            continue
        for old_n in expand_citation(token):
            if old_n not in seen:
                seen.add(old_n)
                order.append(old_n)

for n in range(1, 51):
    if n not in seen:
        order.append(n)

old_to_new = {old: new for new, old in enumerate(order, start=1)}

# Reorder reference paragraphs physically after the reference heading.
for p in ref_paras_by_old.values():
    body.remove(p)

insert_idx = body.index(ref_header) + 1
new_ref_paras: list[etree._Element] = []
for new_n, old_n in enumerate(order, start=1):
    p = ref_paras_by_old[old_n]
    update_reference_number(p, old_n, new_n)
    body.insert(insert_idx, p)
    insert_idx += 1
    new_ref_paras.append(p)

links = add_body_links_and_update_citations(root, ref_header_idx, old_to_new)
bookmarks = add_reference_bookmarks(root, new_ref_paras)

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

lines = ["old->new reference map:"]
for old_n in range(1, 51):
    lines.append(f"{old_n:02d} -> {old_to_new[old_n]:02d}")
lines.append("")
lines.append("new order (old reference numbers):")
lines.append(",".join(str(n) for n in order))
lines.append(f"body_citation_hyperlinks={links}")
lines.append(f"reference_bookmarks={bookmarks}")
REPORT.write_text("\n".join(lines), encoding="utf-8")

print(f"body_citation_hyperlinks={links}")
print(f"reference_bookmarks={bookmarks}")
print(REPORT)
