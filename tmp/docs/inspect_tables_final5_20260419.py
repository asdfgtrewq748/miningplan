from docx import Document
import sys
D=Document(sys.argv[1])
for ti,t in enumerate(D.tables):
    text='\n'.join(c.text for r in t.rows for c in r.cells)
    if '工程效率/资源回收偏好有效候选数' in text or '主导排序指标' in text:
        print('TABLE',ti,'rows',len(t.rows),'cols',len(t.columns))
        for ri,r in enumerate(t.rows):
            print('ROW',ri,[c.text.replace('\n','|') for c in r.cells])
        print('---')
