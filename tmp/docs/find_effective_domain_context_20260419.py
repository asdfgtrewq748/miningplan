from docx import Document
import sys
D=Document(sys.argv[1])
for i,p in enumerate(D.paragraphs):
    t=p.text.strip()
    if any(k in t for k in ['Ω_0','原始采区边界','有效布置域','内缩','多连通','降级内缩','D_p']):
        print(i, p.style.name, repr(t[:500]))
