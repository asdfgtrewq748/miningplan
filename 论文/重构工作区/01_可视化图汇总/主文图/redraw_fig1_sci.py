from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.patches import Circle, FancyArrowPatch, FancyBboxPatch


ROOT = Path(__file__).resolve().parent
FONT = FontProperties(fname=r"C:\Windows\Fonts\msyh.ttc")

mpl.rcParams["svg.fonttype"] = "none"

COLORS = {
    "ink": "#17384D",
    "text": "#355468",
    "muted": "#6D8594",
    "line": "#36586E",
    "phase_1": "#DCEEF7",
    "phase_2": "#DDF2EA",
    "phase_3": "#F8ECD8",
    "phase_edge": "#C7D7E0",
    "panel_1": "#F5FBFE",
    "panel_2": "#F6FCF9",
    "panel_3": "#FFF9F1",
    "blue_fill": "#FFFFFF",
    "blue_edge": "#BFD6E2",
    "green_fill": "#F2FBF7",
    "green_edge": "#B8D8C9",
    "mint_fill": "#EEF8F3",
    "mint_edge": "#AFCFBE",
    "amber_fill": "#FFF8EE",
    "amber_edge": "#E8CCA1",
    "gray_fill": "#F6F9FB",
    "gray_edge": "#CBD9E1",
    "band_fill": "#EEF3F6",
    "band_edge": "#CDD9E0",
    "feedback": "#C9772E",
}


def setup_canvas():
    fig, ax = plt.subplots(figsize=(14.4, 7.2), dpi=320)
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 60)
    ax.axis("off")
    return fig, ax


def rounded_box(ax, x, y, w, h, fill, edge, radius=1.8, lw=1.7, alpha=1.0):
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle=f"round,pad=0.35,rounding_size={radius}",
        linewidth=lw,
        facecolor=fill,
        edgecolor=edge,
        alpha=alpha,
    )
    ax.add_patch(patch)
    return patch


def phase_band(ax, x, y, w, h, text, fill):
    rounded_box(ax, x, y, w, h, fill, COLORS["phase_edge"], radius=1.5, lw=1.2)
    ax.text(
        x + w / 2,
        y + h / 2,
        text,
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=13.5,
        color=COLORS["ink"],
        weight="bold",
    )


def stage_box(ax, idx, x, y, w, h, title, lines, fill, edge, title_size=14, text_size=10.2):
    rounded_box(ax, x, y, w, h, fill, edge)
    circle = Circle((x + 2.25, y + h - 2.3), 1.25, facecolor="white", edgecolor=edge, linewidth=1.2)
    ax.add_patch(circle)
    ax.text(
        x + 2.25,
        y + h - 2.33,
        str(idx),
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=10,
        color=COLORS["ink"],
        weight="bold",
    )
    ax.text(
        x + 4.1,
        y + h - 2.0,
        title,
        ha="left",
        va="top",
        fontproperties=FONT,
        fontsize=title_size,
        color=COLORS["ink"],
        weight="bold",
    )
    start_y = y + h - 5.3
    for i, line in enumerate(lines):
        ax.text(
            x + 4.1,
            start_y - i * 2.6,
            line,
            ha="left",
            va="top",
            fontproperties=FONT,
            fontsize=text_size,
            color=COLORS["text"],
        )


def arrow(ax, start, end, color=None, dashed=False, rad=0.0, lw=1.8):
    patch = FancyArrowPatch(
        start,
        end,
        arrowstyle="-|>",
        mutation_scale=15,
        linewidth=lw,
        linestyle=(0, (6, 4)) if dashed else "solid",
        color=color or COLORS["line"],
        connectionstyle=f"arc3,rad={rad}",
    )
    ax.add_patch(patch)


def add_feedback_box(ax):
    rounded_box(ax, 14, 10.4, 31.5, 6.6, COLORS["amber_fill"], COLORS["amber_edge"], radius=1.6, lw=1.4)
    ax.text(
        29.75,
        14.9,
        "闭环反馈",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=13.4,
        color=COLORS["ink"],
        weight="bold",
    )
    ax.text(
        29.75,
        12.15,
        "评价结果回写规划偏好、风险阈值与方案修订",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=10.0,
        color=COLORS["text"],
    )


def add_object_band(ax):
    rounded_box(ax, 6, 2.4, 88, 4.2, COLORS["band_fill"], COLORS["band_edge"], radius=1.2, lw=1.2)
    ax.text(
        9.2,
        5.25,
        "统一对象底座",
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=11.2,
        color=COLORS["ink"],
        weight="bold",
    )
    ax.text(
        23,
        5.25,
        "数据对象  ->  参数对象  ->  风险对象  ->  方案对象  ->  接续对象  ->  评价对象",
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=10.2,
        color=COLORS["text"],
    )


def draw():
    fig, ax = setup_canvas()

    phase_band(ax, 6, 53.6, 34, 4.4, "输入与标准化", COLORS["phase_1"])
    phase_band(ax, 43, 53.6, 16, 4.4, "地质-风险建模", COLORS["phase_2"])
    phase_band(ax, 62, 53.6, 32, 4.4, "规划决策-接续-评价", COLORS["phase_3"])

    rounded_box(ax, 5.3, 18.8, 36.0, 31.2, COLORS["panel_1"], COLORS["phase_edge"], radius=2.0, lw=1.0, alpha=0.55)
    rounded_box(ax, 42.2, 18.8, 17.2, 31.2, COLORS["panel_2"], COLORS["phase_edge"], radius=2.0, lw=1.0, alpha=0.55)
    rounded_box(ax, 61.3, 6.9, 33.3, 43.3, COLORS["panel_3"], COLORS["phase_edge"], radius=2.0, lw=1.0, alpha=0.55)

    ax.text(
        6.2,
        50.65,
        "统一数据底座驱动参数场、风险场、方案场与评价结果持续传递",
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=10.1,
        color=COLORS["muted"],
    )

    stage_box(
        ax,
        1,
        7.0,
        35.7,
        16.8,
        12.0,
        "多源数据输入",
        ["边界、钻孔、分层、设计参数", "样例工程文件与项目快照"],
        COLORS["blue_fill"],
        COLORS["blue_edge"],
    )
    stage_box(
        ax,
        2,
        25.6,
        35.7,
        14.8,
        12.0,
        "标准化与项目管理",
        ["字段映射、坐标统一、拓扑校核", "统一对象口径与状态持久化"],
        "#F8FCFE",
        "#C6D9E3",
        title_size=13.0,
        text_size=9.5,
    )
    stage_box(
        ax,
        3,
        43.3,
        35.7,
        15.2,
        10.6,
        "参数场构建",
        ["插值与规则网格", "厚度场及空间底图"],
        COLORS["green_fill"],
        COLORS["green_edge"],
        title_size=13.2,
        text_size=9.6,
    )
    stage_box(
        ax,
        4,
        43.3,
        21.8,
        15.2,
        10.6,
        "ODI 风险组织",
        ["地表、含水层、上行风险", "统一表征为可传递约束"],
        COLORS["amber_fill"],
        COLORS["amber_edge"],
        title_size=13.2,
        text_size=9.6,
    )
    stage_box(
        ax,
        5,
        64.1,
        35.7,
        17.0,
        10.6,
        "四模式规划与候选池",
        ["效率、回收率、扰动、综合", "生成可比较候选布局"],
        COLORS["mint_fill"],
        COLORS["mint_edge"],
        text_size=9.6,
    )
    stage_box(
        ax,
        6,
        64.1,
        21.8,
        17.0,
        10.6,
        "三阶段接续",
        ["排程序列、风险联动", "推荐与方案比选"],
        "#FFF9F0",
        "#E7D2A8",
        text_size=9.7,
    )
    stage_box(
        ax,
        7,
        64.1,
        8.2,
        17.0,
        10.6,
        "经济评价",
        ["月度现金流、NPV、回收期", "风险进入经济修正口径"],
        "#FFF7EF",
        "#E5C8A0",
        text_size=9.4,
    )
    stage_box(
        ax,
        8,
        84.2,
        19.8,
        9.2,
        19.6,
        "输出交付",
        ["图件与结构化结果", "JSON / CAD", "论文材料与项目归档"],
        COLORS["gray_fill"],
        COLORS["gray_edge"],
        title_size=13.0,
        text_size=9.2,
    )

    arrow(ax, (24.2, 41.7), (25.4, 41.7))
    arrow(ax, (40.8, 41.7), (43.0, 41.7))
    arrow(ax, (51.0, 35.2), (51.0, 32.6))
    arrow(ax, (58.7, 40.9), (63.8, 40.9))
    arrow(ax, (58.6, 27.1), (63.8, 39.3))
    arrow(ax, (72.6, 35.3), (72.6, 32.6))
    arrow(ax, (72.6, 21.4), (72.6, 18.9))
    arrow(ax, (81.9, 13.6), (84.0, 21.4))

    ax.text(
        51.0,
        33.4,
        "连续参数对象",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=9.6,
        color=COLORS["muted"],
    )
    ax.text(
        51.0,
        18.9,
        "风险约束对象",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=9.6,
        color=COLORS["muted"],
    )
    ax.text(
        72.6,
        48.7,
        "同一对象语义下连续推演",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=10.1,
        color=COLORS["ink"],
        weight="bold",
    )

    add_feedback_box(ax)
    arrow(ax, (72.8, 8.0), (46.0, 15.0), color=COLORS["feedback"], dashed=True, rad=0.24, lw=1.9)
    arrow(ax, (46.0, 15.0), (50.6, 21.5), color=COLORS["feedback"], dashed=True, rad=-0.06, lw=1.9)

    add_object_band(ax)

    stem = "图2_采区智能规划设计一体化方法总流程_SCI重构版"
    fig.savefig(ROOT / f"{stem}.png", bbox_inches="tight", facecolor=fig.get_facecolor())
    fig.savefig(ROOT / f"{stem}.svg", bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)


if __name__ == "__main__":
    draw()
