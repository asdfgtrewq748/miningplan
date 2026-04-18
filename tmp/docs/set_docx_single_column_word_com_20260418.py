import os
from pathlib import Path

import win32com.client


docx_path = Path(os.environ["DOCX_PATH"]).resolve()

word = win32com.client.Dispatch("Word.Application")
word.Visible = False
word.DisplayAlerts = 0
try:
    doc = word.Documents.Open(str(docx_path))
    for section in doc.Sections:
        section.PageSetup.TextColumns.SetCount(1)
    for table in doc.Tables:
        table.AutoFitBehavior(2)  # wdAutoFitWindow
        table.Range.Font.Size = 7
    doc.Save()
    doc.Close(False)
finally:
    word.Quit()

print(f"set single-column layout {docx_path}")
