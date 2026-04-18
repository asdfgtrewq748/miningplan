import os
from pathlib import Path

import win32com.client


docx_path = Path(os.environ["DOCX_PATH"]).resolve()
out_dir = Path(os.environ.get("RENDER_OUT", "tmp/docs/coal_sci_render_20260418")).resolve()
out_dir.mkdir(parents=True, exist_ok=True)
pdf_path = out_dir / (docx_path.stem + ".pdf")

word = win32com.client.Dispatch("Word.Application")
word.Visible = False
word.DisplayAlerts = 0
try:
    doc = word.Documents.Open(str(docx_path))
    # 17 = wdExportFormatPDF
    doc.ExportAsFixedFormat(str(pdf_path), 17)
    doc.Close(False)
finally:
    word.Quit()

print(pdf_path)
