from docx import Document
from docx.oxml.ns import qn
import sys
D=Document(sys.argv[1])
for ti,t in enumerate(D.tables):
    texts=[]
    omaths=[]
    for row in t.rows:
        rowtexts=[]
        for cell in row.cells:
            tx=cell.text.replace('\n','|')
            rowtexts.append(tx)
            # collect math text from OMML text nodes
            for node in cell._tc.xpath('.//m:t'):
                if node.text:
                    omaths.append(node.text)
        texts.append(rowtexts)
    if omaths or any(any(x.strip() for x in r) for r in texts):
        print('TABLE',ti,'rows',len(t.rows),'cols',len(t.columns),'omath',''.join(omaths)[:500])
        for r in texts:
            print('  ',r)
        print('---')
