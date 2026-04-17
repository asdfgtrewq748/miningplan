from __future__ import annotations

import re
import shutil
import zipfile
from copy import deepcopy
from pathlib import Path

from latex2mathml.converter import convert as latex_to_mathml
from lxml import etree


ROOT = Path(r"D:/xiangmu/miningplan")
SRC = ROOT / "论文/重构工作区/06_投稿包/最新版论文4.16_插图版_公式对象化审稿版.docx"
OUT = ROOT / "论文/重构工作区/06_投稿包/最新版论文4.16_插图版_煤科格式项目图修正版.docx"
REPORT = ROOT / "论文/重构工作区/00_过程文档/煤科格式项目图修正说明.md"
TPL_DIR = ROOT / "tmp/coal_template"
MML2OMML = Path(r"C:/Program Files/Microsoft Office/Root/Office16/MML2OMML.XSL")

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
W = NS["w"]
M = NS["m"]

STYLE_MAP = {
    "01中文题名": "02",
    "02英文题名": "06",
    "03中文作者": "03",
    "04中文单位": "04",
    "05中文摘要关键词": "05",
    "06中图分类号": "05",
    "07英文作者": "07",
    "08英文单位": "08",
    "09英文摘要关键词": "09",
    "10正文": "10",
    "11一级标题": "11",
    "12二级标题": "12",
    "13三级标题": "13",
    "14图题": "14",
    "15表题": "15",
    "16公式编号": "16",
    "17参考文献": "17",
    "18首页脚注": "18",
}

FORMULAS = {
    "（1）": r"\mathrm{ODI}(x)=\sum_{i=1}^{n}w_i x_i",
    "（2）": r"0\le x_i\le 1,\quad \sum_{i=1}^{n}w_i=1,\quad w_i\ge0",
    "（3）": r"\overline{\mathrm{ODI}}_\pi=\mathrm{mean}_{x\in A_\pi}\{\mathrm{ODI}(x)\}",
    "（4）": r"P90_\pi=Q_{0.90}\{\mathrm{ODI}(x)\mid x\in A_\pi\}",
    "（5）": r"E_\pi=N(\mathrm{ODI}(x)>T_{\mathrm{ODI}})/N_\pi",
    "（6）": r"\Omega_e=\Omega_0\setminus(B_b\cup B_s\cup D_p)",
    "（7）": r"z(x)=\sum_{i=1}^{n}d_i(x)^{-p}z_i/\sum_{i=1}^{n}d_i(x)^{-p}",
    "（8）": r"F(\pi)=w_eS_e(\pi)+w_rS_r(\pi)+w_mS_m(\pi)",
    "（9）": r"w_e+w_r+w_m=1,\quad w_e\ge0,\quad w_r\ge0,\quad w_m\ge0",
    "（10）": r"\mathrm{Score}_s=\alpha P_s+\beta R_s+\gamma C_s",
    "（11）": r"\mathrm{NCF}_t=\mathrm{Rev}_t-\mathrm{Cost}_t-\mathrm{RiskCost}_t",
}


def qn(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def p_text(p: etree._Element) -> str:
    return "".join(p.xpath(".//w:t/text()", namespaces=NS))


def set_text(p: etree._Element, text: str) -> None:
    ppr = p.find(qn(W, "pPr"))
    ppr = deepcopy(ppr) if ppr is not None else etree.Element(qn(W, "pPr"))
    for child in list(p):
        p.remove(child)
    p.append(ppr)
    r = etree.SubElement(p, qn(W, "r"))
    t = etree.SubElement(r, qn(W, "t"))
    t.text = text


def set_cols(sect_pr: etree._Element, num: int | None) -> None:
    cols = sect_pr.find(qn(W, "cols"))
    if cols is None:
        cols = etree.SubElement(sect_pr, qn(W, "cols"))
    cols.set(qn(W, "space"), "425")
    if num is None or num == 1:
        cols.attrib.pop(qn(W, "num"), None)
    else:
        cols.set(qn(W, "num"), str(num))


def make_omml(latex: str) -> etree._Element:
    mathml = latex_to_mathml(latex, display="inline")
    root = etree.fromstring(mathml.encode("utf-8"))
    omml = etree.XSLT(etree.parse(str(MML2OMML)))(root).getroot()
    etree.cleanup_namespaces(omml)
    return omml


def make_run(text: str | None = None, *, tab=False) -> etree._Element:
    r = etree.Element(qn(W, "r"))
    if tab:
        etree.SubElement(r, qn(W, "tab"))
    if text is not None:
        t = etree.SubElement(r, qn(W, "t"))
        t.text = text
    return r


def replace_formula(p: etree._Element, num: str, omml: etree._Element) -> None:
    ppr = p.find(qn(W, "pPr"))
    ppr = deepcopy(ppr) if ppr is not None else etree.Element(qn(W, "pPr"))
    for child in list(p):
        p.remove(child)
    p.append(ppr)
    p.append(deepcopy(omml))
    p.append(make_run(tab=True))
    p.append(make_run(num))


def delete_figures_5_to_9(body: etree._Element) -> list[str]:
    removed: list[str] = []
    children = list(body)
    for idx, child in enumerate(children):
        if child.tag != qn(W, "p"):
            continue
        txt = p_text(child).strip()
        m = re.match(r"图([5-9])\s", txt)
        if not m:
            continue
        removed.append(txt.splitlines()[0])
        prev = children[idx - 1] if idx > 0 else None
        if prev is not None and prev.tag == qn(W, "p") and prev.xpath(".//w:drawing", namespaces=NS):
            body.remove(prev)
        if child.getparent() is not None:
            body.remove(child)
    return removed


def resize_remaining_images(root: etree._Element) -> None:
    max_cx = int(3.05 * 914400)  # double-column-safe width, about 7.75 cm
    for inline in root.xpath(".//wp:inline", namespaces=NS):
        ext = inline.find(qn(NS["wp"], "extent"))
        if ext is None:
            continue
        old_cx = int(ext.get("cx", str(max_cx)))
        old_cy = int(ext.get("cy", str(max_cx)))
        if old_cx <= 0:
            continue
        new_cx = min(old_cx, max_cx)
        new_cy = int(old_cy * new_cx / old_cx)
        ext.set("cx", str(new_cx))
        ext.set("cy", str(new_cy))
        for aext in inline.xpath(".//a:ext", namespaces=NS):
            aext.set("cx", str(new_cx))
            aext.set("cy", str(new_cy))


def main() -> None:
    tpl = next(TPL_DIR.glob("*.docx"))
    shutil.copy2(SRC, OUT)
    with zipfile.ZipFile(OUT, "r") as zin:
        items = {name: zin.read(name) for name in zin.namelist()}
    with zipfile.ZipFile(tpl, "r") as ztpl:
        tpl_styles = ztpl.read("word/styles.xml")

    root = etree.fromstring(items["word/document.xml"])
    body = root.find(qn(W, "body"))
    assert body is not None

    # Replace self-made styles with the official template styles.
    items["word/styles.xml"] = tpl_styles
    for pstyle in root.xpath(".//w:pStyle", namespaces=NS):
        val = pstyle.get(qn(W, "val"))
        if val in STYLE_MAP:
            pstyle.set(qn(W, "val"), STYLE_MAP[val])

    # Delete non-project / unsupported figures 5-9 and their image paragraphs.
    removed = delete_figures_5_to_9(body)

    # Stable layout: only the front matter is single-column; all body text is double-column.
    paras = body.xpath("./w:p", namespaces=NS)
    for i, p in enumerate(paras):
        ppr = p.find(qn(W, "pPr"))
        if ppr is None:
            continue
        sect = ppr.find(qn(W, "sectPr"))
        if sect is not None:
            if i == 11:  # end of front matter
                set_cols(sect, 1)
            else:
                ppr.remove(sect)
    final_sect = body.find(qn(W, "sectPr"))
    if final_sect is None:
        final_sect = etree.SubElement(body, qn(W, "sectPr"))
    set_cols(final_sect, 2)

    # Formula objects: replace with shorter formulas that match the definitions and fit a two-column layout.
    omml = {num: make_omml(latex) for num, latex in FORMULAS.items()}
    converted = 0
    for p in body.xpath("./w:p", namespaces=NS):
        txt = p_text(p)
        for num in FORMULAS:
            if num in txt and p.xpath(".//m:oMath", namespaces=NS):
                replace_formula(p, num, omml[num])
                converted += 1
                break

    # Text fixes so formula definitions match the displayed formulas.
    for p in body.xpath("./w:p", namespaces=NS):
        txt = p_text(p)
        if "式中，π为候选规划方案" in txt:
            set_text(
                p,
                "式中，π为候选规划方案；A_π为方案π对应的布置区域；ODI均值为方案区域内ODI的平均水平；Q_0.90为90%分位数；N_π为方案区域内参与统计的栅格数；N(ODI>T_ODI)为超过扰动控制阈值的栅格数；E_π为超阈值暴露比例。上述统计量用于把风险场从图层表达转化为方案级评价指标。",
            )
        elif "式中，Ω为原始采区边界" in txt:
            set_text(
                p,
                "式中，Ω_0为原始采区边界，B_b为边界煤柱宽度，B_s为区段煤柱宽度，D_p为局部保护距离，Ω_e为经约束内缩和几何合法性处理后的有效布置域。若内缩后出现多连通域或局部狭长畸变，则保留主连通区域并采用降级内缩策略，以保证后续工作面布置具有几何可解性。",
            )
        elif txt.startswith("从样例结果看，当前规划共形成3个工作面"):
            set_text(
                p,
                "表3列出了当前样例的结构化规划结果。当前规划共形成3个工作面和11条巷道，巷道总长度为4817.50 m，工作面布置面积为176565.72 m²，相对于原始边界的有效覆盖率为69.17%。3个工作面的推进长度分别为WF-01推进515.1 m、WF-02推进536.6 m、WF-03推进551.1 m，平均推进长度为534.3 m。需要说明的是，800.0 m在本样例中作为推荐/校核阈值使用，当前3个工作面的推进长度均低于该阈值，因此该结果用于证明对象生成、风险统计与后续传递链路，不作为真实生产方案的最终工程定案。",
            )
        elif "当前样例以示意方式给出由采区规划空间结果向采掘接续空间结果的传递路径" in txt:
            set_text(
                p,
                "在采掘接续层面，规划阶段形成的工作面边界和推进关系可映射为接续任务对象。当前样例仅保留对象传递口径说明，不插入缺乏独立数据支撑的接续图件；其证据重点是“对象可传递、链路可延伸”，而不是未经独立导出的量化优选结论。",
            )

    resize_remaining_images(root)

    items["word/document.xml"] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in items.items():
            zout.writestr(name, data)

    REPORT.write_text(
        "\n".join(
            [
                "# 煤科格式项目图修正说明",
                "",
                f"- 源文件：`{SRC}`",
                f"- 输出文件：`{OUT}`",
                f"- 正式模板来源：`{tpl}`",
                "",
                "## 已修正问题",
                "",
                "- 分栏：删除正文中多余分节符，仅保留首页信息单栏；正文统一为双栏排版。",
                "- 样式：用正式《煤炭科学技术论文撰写格式模板》的 `styles.xml` 替换自建样式，并将段落映射到模板原生 `02/03/04/05/06/07/08/09/10/11/12/13/14/15/16/17/18` 样式。",
                f"- 图件：删除图5～图9及其图片段落；删除清单：{'；'.join(removed) if removed else '无'}。",
                "- 图件口径：正文结果图只保留前4张，避免把未由当前项目结果支撑的接续、调控和经济示意图放入主文。",
                "- 公式：11条公式仍为 Word 原生可编辑 OMML 对象，但已改为更短表达，并同步修正公式下方文字解释。",
                "- 图片宽度：剩余图片按双栏宽度压缩，避免图片触发版式切换或跨栏错位。",
                "",
                "## 仍需注意",
                "",
                "- 如果你希望保留某个项目导出图作为新图5，需要明确指定对应导出文件；否则不再主动把接续、经济或示意图加入主文。",
                "- MathType OLE 对象仍未批量生成；当前为可编辑 Word 公式对象。若编辑部必须检查 MathType 插件对象，建议最后在 Word 内人工转换。",
            ]
        ),
        encoding="utf-8",
    )
    print(OUT)
    print(REPORT)


if __name__ == "__main__":
    main()
