from pathlib import Path
from docx import Document


paper = next(Path(__file__).resolve().parents[1].glob("*5.23格式改稿.docx"))
doc = Document(paper)
paragraphs = [p for p in doc.paragraphs if p.text.strip()]

for idx, paragraph in enumerate(paragraphs, start=1):
    style = paragraph.style.name if paragraph.style else ""
    text = paragraph.text.strip()
    if style in ("14图题", "15表题") or text.startswith(("Fig.", "Table")):
        previous_text = paragraphs[idx - 2].text.strip() if idx >= 2 else ""
        print(f"{idx}: {style} | {text[:260]}")
        print(f"  previous: {previous_text[:260]}")
