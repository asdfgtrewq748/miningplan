from pathlib import Path
from docx import Document
root = Path.cwd()
files = list((root/'煤科投稿').glob('*大修工作稿_20260418.docx'))
print([str(f) for f in files])
p = files[0]
doc = Document(str(p))
for i, para in enumerate(doc.paragraphs):
    t = para.text.strip()
    if t == '参考文献' or t.startswith('[1]'):
        print(i, repr(t[:160]))
