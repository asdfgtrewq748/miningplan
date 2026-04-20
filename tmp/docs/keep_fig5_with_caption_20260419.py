from docx import Document
import sys
D=Document(sys.argv[1])
changed=False
for p in D.paragraphs:
    if p.text.strip().startswith('图5进一步给出了A、B、C三类候选方案'):
        p.paragraph_format.page_break_before = True
        changed=True
D.save(sys.argv[1])
print('changed', changed)
