from docx import Document
import sys
D=Document(sys.argv[1])
for i,p in enumerate(D.paragraphs[100:116], start=100):
    print(i,p.style.name,repr(p.text.strip()[:120]),len(p._element.xpath('.//w:drawing')))
