from docx import Document
import sys
D=Document(sys.argv[1])
for ti,t in enumerate(D.tables):
    text='\n'.join(c.text for r in t.rows for c in r.cells)
    if '模式有效候选数' in text or '候选方案对比' in text or ('工程效率偏好' in text and '联合判据筛选' in text):
        print('TABLE', ti, 'rows', len(t.rows), 'cols', len(t.columns))
        for ri,r in enumerate(t.rows):
            print('ROW',ri, [c.text.replace('\n','|') for c in r.cells])
        print('---')
