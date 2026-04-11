from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Rectangle


OUT = Path(__file__).resolve().parent
FONT = FontProperties(fname=r"C:\Windows\Fonts\msyh.ttc")
mpl.rcParams["svg.fonttype"] = "none"

COLORS = {
    "ink": "#15364A",
    "text": "#355468",
    "muted": "#6F8796",
    "line": "#2F5167",
    "phase1": "#A9C9DD",
    "phase2": "#AFCFC2",
    "phase3": "#E0C596",
    "panel_edge": "#D7E0E6",
    "panel_fill": "#FBFCFD",
    "box_fill": "#FFFFFF",
    "feedback": "#C8752E",
    "feedback_fill": "#FFF6EC",
}


def rounded(ax, x, y, w, h, fc, ec, lw=1.2, r=1.0):
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle=f"round,pad=0.18,rounding_size={r}",
        facecolor=fc,
        edgecolor=ec,
        linewidth=lw,
    )
    ax.add_patch(patch)
    return patch


def phase_panel(ax, x, y, w, h, accent, label):
    rounded(ax, x, y, w, h, COLORS["panel_fill"], COLORS["panel_edge"], lw=1.1, r=1.6)
    ax.add_patch(Rectangle((x, y + h - 1.7), w, 1.7, facecolor=accent, edgecolor="none"))
    ax.text(
        x + 1.4,
        y + h - 0.85,
        label,
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=11.8,
        color=COLORS["ink"],
        weight="bold",
    )
def step_box(ax, x, y, w, h, idx, title, lines, accent, text_size=9.2):
    rounded(ax, x, y, w, h, COLORS["box_fill"], accent, lw=1.5, r=0.9)
    ax.add_patch(Rectangle((x, y), 0.95, h, facecolor=accent, edgecolor="none"))
    rounded(ax, x + 1.2, y + h - 2.35, 2.0, 1.45, "white", accent, lw=1.1, r=0.5)
    ax.text(
        x + 2.2,
        y + h - 1.63,
        str(idx),
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=9.8,
        color=COLORS["ink"],
        weight="bold",
    )
    ax.text(
        x + 4.0,
        y + h - 1.55,
        title,
        ha="left",
        va="top",
        fontproperties=FONT,
        fontsize=13.0,
        color=COLORS["ink"],
        weight="bold",
    )
    start = y + h - 4.5
    for i, line in enumerate(lines):
        ax.text(
            x + 4.0,
            start - i * 2.25,
            line,
            ha="left",
            va="top",
            fontproperties=FONT,
            fontsize=text_size,
            color=COLORS["text"],
        )


def arrow(ax, start, end, color=None, lw=1.9, dashed=False, rad=0.0):
    ax.add_patch(
        FancyArrowPatch(
            start,
            end,
            arrowstyle="-|>",
            mutation_scale=15,
            linewidth=lw,
            color=color or COLORS["line"],
            linestyle=(0, (5, 4)) if dashed else "solid",
            connectionstyle=f"arc3,rad={rad}",
        )
    )


def draw():
    fig, ax = plt.subplots(figsize=(14.4, 6.9), dpi=320)
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 60)
    ax.axis("off")

    ax.text(
        4.2,
        56.8,
        "采区智能规划设计一体化方法总流程",
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=18.4,
        color=COLORS["ink"],
        weight="bold",
    )
    ax.text(
        4.2,
        53.8,
        "统一对象驱动的连续工作流",
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=10.0,
        color=COLORS["muted"],
    )

    phase_panel(ax, 4.0, 16.0, 27.5, 31.8, COLORS["phase1"], "I  输入与标准化")
    phase_panel(ax, 34.4, 16.0, 22.8, 31.8, COLORS["phase2"], "II  地质与风险建模")
    phase_panel(ax, 60.0, 8.8, 35.5, 39.0, COLORS["phase3"], "III  规划决策、接续与评价")

    step_box(ax, 6.0, 31.5, 10.7, 10.5, 1, "多源数据输入", ["边界、钻孔、分层、设计参数", "样例工程文件与项目快照"], COLORS["phase1"], text_size=8.9)
    step_box(ax, 18.4, 31.5, 10.7, 10.5, 2, "标准化与项目管理", ["字段映射、坐标统一、闭合校核", "统一对象口径与状态持久化"], COLORS["phase1"], text_size=8.8)
    step_box(ax, 36.4, 32.4, 18.8, 8.8, 3, "参数场构建", ["插值、规则网格、厚度场与空间底图"], COLORS["phase2"], text_size=8.9)
    step_box(ax, 36.4, 20.8, 18.8, 8.8, 4, "ODI 风险组织", ["地表、含水层、上行风险统一表征为可传递约束"], COLORS["phase3"], text_size=8.7)
    step_box(ax, 62.3, 32.8, 16.4, 8.8, 5, "四模式规划与候选池", ["效率、回收率、扰动、综合", "生成可比较候选布局"], COLORS["phase2"], text_size=8.7)
    step_box(ax, 62.3, 21.2, 16.4, 8.8, 6, "三阶段接续", ["排程序列、风险联动、推荐与方案比选"], COLORS["phase3"], text_size=8.7)
    step_box(ax, 62.3, 9.6, 16.4, 8.8, 7, "经济评价", ["月度现金流、NPV、回收期", "风险进入经济修正口径"], COLORS["phase3"], text_size=8.6)
    step_box(ax, 80.4, 20.8, 13.0, 12.8, 8, "输出交付", ["图件与结构化结果", "JSON / CAD", "论文材料与项目归档"], COLORS["phase1"], text_size=8.6)

    arrow(ax, (16.9, 36.7), (18.3, 36.7))
    arrow(ax, (29.3, 36.7), (36.1, 36.7))
    arrow(ax, (45.8, 32.3), (45.8, 29.8))
    arrow(ax, (55.4, 36.8), (62.0, 36.8))
    arrow(ax, (55.4, 25.1), (62.0, 35.3))
    arrow(ax, (70.5, 32.6), (70.5, 30.0))
    arrow(ax, (70.5, 21.0), (70.5, 18.4))
    arrow(ax, (78.9, 14.0), (80.1, 24.2))

    ax.text(
        45.8,
        31.0,
        "参数对象",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=9.0,
        color=COLORS["muted"],
    )
    ax.text(
        46.0,
        19.7,
        "风险对象",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=9.0,
        color=COLORS["muted"],
    )
    ax.text(
        72.0,
        45.8,
        "同一对象语义下连续推演",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=10.0,
        color=COLORS["ink"],
        weight="bold",
    )

    rounded(ax, 14.0, 9.8, 18.8, 5.8, COLORS["feedback_fill"], COLORS["feedback"], lw=1.2, r=0.9)
    ax.text(
        23.4,
        13.3,
        "闭环反馈",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=12.8,
        color=COLORS["ink"],
        weight="bold",
    )
    ax.text(
        23.4,
        11.2,
        "评价结果回写规划偏好与风险阈值",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=9.1,
        color=COLORS["text"],
    )
    arrow(ax, (70.0, 10.2), (32.9, 12.7), color=COLORS["feedback"], dashed=True, lw=1.8, rad=0.18)
    arrow(ax, (32.9, 12.8), (45.0, 21.4), color=COLORS["feedback"], dashed=True, lw=1.8, rad=-0.18)

    rounded(ax, 4.0, 3.2, 91.5, 3.8, "#F2F6F8", COLORS["panel_edge"], lw=1.0, r=0.8)
    ax.text(
        7.2,
        5.1,
        "统一对象传递链",
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=10.8,
        color=COLORS["ink"],
        weight="bold",
    )
    ax.text(
        21.0,
        5.1,
        "数据对象  ->  参数对象  ->  风险对象  ->  方案对象  ->  接续对象  ->  评价对象",
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=9.6,
        color=COLORS["text"],
    )

    png = OUT / "fig1_journal_v2.png"
    svg = OUT / "fig1_journal_v2.svg"
    fig.savefig(png, bbox_inches="tight", facecolor=fig.get_facecolor())
    fig.savefig(svg, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)


if __name__ == "__main__":
    draw()
