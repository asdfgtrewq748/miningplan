from __future__ import annotations

import re
import shutil
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
DOCX = ROOT / "煤科投稿" / "煤科论文4.20.docx"
OUT_DIR = ROOT / "煤科投稿" / "最终图片" / "13_4.20正文现用图_仅清晰增强PNG"


NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
}


def rels_map(zf: zipfile.ZipFile) -> dict[str, str]:
    rels = ET.fromstring(zf.read("word/_rels/document.xml.rels"))
    out = {}
    for rel in rels:
        rid = rel.attrib.get("Id")
        target = rel.attrib.get("Target", "")
        if rid and target.startswith("media/"):
            out[rid] = "word/" + target
    return out


def paragraph_text(p: ET.Element) -> str:
    parts = []
    for t in p.findall(".//w:t", NS):
        if t.text:
            parts.append(t.text)
    return "".join(parts)


def extract_docx_figures() -> list[tuple[str, str, str]]:
    """Return (media_path, caption_zh, caption_en) for actual figure images in document order."""
    with zipfile.ZipFile(DOCX) as zf:
        rels = rels_map(zf)
        doc = ET.fromstring(zf.read("word/document.xml"))
        body = doc.find("w:body", NS)
        paragraphs = list(body.findall("w:p", NS)) if body is not None else []
        figures = []
        current_media = []
        for p in paragraphs:
            blips = p.findall(".//a:blip", NS)
            rids = []
            for b in blips:
                rid = b.attrib.get(f"{{{NS['r']}}}embed")
                if rid and rid in rels:
                    rids.append(rid)
            text = paragraph_text(p).strip()
            if rids:
                # A real manuscript figure is normally represented by the largest/first drawing
                # in the paragraph followed by a caption. Formula fallback pictures are ignored
                # because they are not followed by 图/Fig captions.
                current_media.extend(rels[rid] for rid in rids)
                continue
            if re.search(r"图\s*\d+", text) and current_media:
                zh = text
                en = ""
                figures.append((current_media[0], zh, en))
                current_media = []
            elif text.startswith("Fig.") and figures:
                media, zh, _ = figures[-1]
                figures[-1] = (media, zh, text)
        return figures


def sanitize_caption(zh: str, idx: int) -> str:
    m = re.search(r"图\s*([0-9]+)", zh)
    num = int(m.group(1)) if m else idx
    title = re.sub(r"^图\s*[0-9]+\s*", "", zh).strip()
    title = re.sub(r"[\\/:*?\"<>|，,。；;（）()、\s]+", "_", title).strip("_")
    return f"fig{num:02d}_{title or 'figure'}.png"


def enhance_image(src_bytes: bytes, out_path: Path) -> None:
    tmp = out_path.with_suffix(".source")
    tmp.write_bytes(src_bytes)
    try:
        with Image.open(tmp) as im:
            im = im.convert("RGBA") if im.mode in {"P", "LA"} else im.convert("RGB")
            # Keep the original figure exactly: no redrawing, no cropping, no data changes.
            # Only apply a mild sharpness pass and write 600 dpi metadata.
            if im.mode == "RGBA":
                bg = Image.new("RGBA", im.size, "white")
                bg.alpha_composite(im)
                im = bg.convert("RGB")
            im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=80, threshold=3))
            im.save(out_path, format="PNG", dpi=(600, 600), optimize=True)
    finally:
        tmp.unlink(missing_ok=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for p in OUT_DIR.iterdir():
        if p.is_file():
            p.unlink()
    figures = extract_docx_figures()
    with zipfile.ZipFile(DOCX) as zf:
        for idx, (media, zh, en) in enumerate(figures, start=1):
            data = zf.read(media)
            name = sanitize_caption(zh, idx)
            out = OUT_DIR / name
            enhance_image(data, out)
            with Image.open(out) as im:
                print(f"{idx:02d}\t{name}\t{im.width}x{im.height}\t{media}\t{zh}\t{en}")
    print(f"OUT_DIR={OUT_DIR}")


if __name__ == "__main__":
    main()
