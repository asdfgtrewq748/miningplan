from pathlib import Path
from docx import Document


doc = Document(Path(__file__).resolve().parent / "template_from_download.docx")
paragraphs = [p for p in doc.paragraphs if p.text.strip()]
for idx, paragraph in enumerate(paragraphs, start=1):
    text = paragraph.text.strip()
    if text.startswith(("图", "表", "Fig.", "Table")) or "Fig." in text or "Table" in text:
        print(f"{idx}: {paragraph.style.name if paragraph.style else ''} | {text[:260]}")
