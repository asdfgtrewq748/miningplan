from docx import Document
import sys
D=Document(sys.argv[1])
changed=False
for p in D.paragraphs:
    if p.text.strip() == '4 讨论':
        p.paragraph_format.page_break_before = True
        changed=True
D.save(sys.argv[1])
print('changed', changed)
