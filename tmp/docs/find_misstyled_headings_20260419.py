from docx import Document
import re, sys
D=Document(sys.argv[1])
for i,p in enumerate(D.paragraphs):
    t=p.text.strip()
    if t and p.style.name in ('11一级标题','12二级标题') and not re.match(r'^\d+(\.\d+)?\s', t):
        print(i, p.style.name, repr(t[:180]))
