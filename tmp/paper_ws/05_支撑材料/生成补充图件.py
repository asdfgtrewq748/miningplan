from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Rectangle


plt.rcParams["font.sans-serif"] = [
    "Microsoft YaHei",
    "SimHei",
    "Noto Sans CJK SC",
    "DejaVu Sans",
]
plt.rcParams["axes.unicode_minus"] = False


ROOT = Path(__file__).resolve().parents[1]
FIG_DIR = ROOT / "01_可视化图汇总" / "主文图"


def ensure_dir() -> None:
    FIG_DIR.mkdir(parents=True, exist_ok=True)


def add_box(ax, xy, w, h, text, fc="#f7f7fb", ec="#2d3748", size=12):
    rect = Rectangle(xy, w, h, linewidth=1.8, edgecolor=ec, facecolor=fc, zorder=2)
    ax.add_patch(rect)
    ax.text(xy[0] + w / 2, xy[1] + h / 2, text, ha="center", va="center", fontsize=size, zorder=3)


def add_arrow(ax, start, end, color="#4a5568"):
    arrow = FancyArrowPatch(start, end, arrowstyle="-|>", mutation_scale=16, linewidth=1.6, color=color)
    ax.add_patch(arrow)


def draw_workflow():
    fig, ax = plt.subplots(figsize=(16, 4.6))
    ax.set_xlim(0, 16)
    ax.set_ylim(0, 4)
    ax.axis("off")

    items = [
        (0.3, 1.4, 2.0, 1.2, "多源数据输入\n边界/钻孔/参数"),
        (2.7, 1.4, 2.0, 1.2, "参数场构建\n插值/标准化"),
        (5.1, 1.4, 2.0, 1.2, "ODI 风险表征\n三场景统一组织"),
        (7.5, 1.4, 2.0, 1.2, "候选规划\n四模式比选"),
        (9.9, 1.4, 2.0, 1.2, "采掘接续\n阶段化组织"),
        (12.3, 1.4, 2.0, 1.2, "经济评价\n现金流/NPV"),
    ]
    for x, y, w, h, text in items:
        add_box(ax, (x, y), w, h, text)
    for i in range(len(items) - 1):
        add_arrow(ax, (items[i][0] + items[i][2], 2.0), (items[i + 1][0], 2.0))
    add_box(ax, (13.3, 0.2), 1.5, 0.7, "图件/JSON/CAD", fc="#edf2f7", size=10)
    add_arrow(ax, (13.05, 1.4), (14.05, 0.9))
    add_arrow(ax, (12.3, 1.0), (7.7, 0.9), color="#c53030")
    ax.text(9.9, 0.62, "评价结果反馈至方案修正与重算", color="#c53030", fontsize=11, ha="center")
    ax.set_title("图2 采区智能规划设计一体化方法总流程", fontsize=16, pad=12)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "图2_采区智能规划设计一体化方法总流程.png", dpi=220)
    plt.close(fig)


def draw_architecture():
    fig, ax = plt.subplots(figsize=(12, 6))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10)
    ax.axis("off")

    add_box(ax, (0.8, 7.2), 10.4, 1.6, "数据与项目管理层：边界、钻孔、分层、设计参数、项目快照", fc="#ebf8ff")
    add_box(ax, (0.8, 5.0), 4.7, 1.6, "模型与分析层：参数场构建、三场景组织、ODI 风险场", fc="#fefcbf")
    add_box(ax, (6.5, 5.0), 4.7, 1.6, "扩展建模层：GNN 预测、可扩展学习接口", fc="#faf5ff")
    add_box(ax, (0.8, 2.8), 4.7, 1.6, "规划与决策层：候选池、四模式规划、方案筛选", fc="#e6fffa")
    add_box(ax, (6.5, 2.8), 4.7, 1.6, "接续与经济层：阶段排程、风险联动、现金流分析", fc="#fff5f5")
    add_box(ax, (2.5, 0.6), 7.0, 1.2, "输出与交付层：图件、JSON、CAD、归档清单", fc="#f7fafc")

    add_arrow(ax, (3.15, 7.2), (3.15, 6.6))
    add_arrow(ax, (8.85, 7.2), (8.85, 6.6))
    add_arrow(ax, (3.15, 5.0), (3.15, 4.4))
    add_arrow(ax, (8.85, 5.0), (8.85, 4.4))
    add_arrow(ax, (5.5, 3.6), (6.5, 3.6))
    add_arrow(ax, (3.15, 2.8), (4.4, 1.8))
    add_arrow(ax, (8.85, 2.8), (7.6, 1.8))

    ax.set_title("图3 数据-模型-决策分层架构图", fontsize=16, pad=10)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "图3_数据模型决策分层架构图.png", dpi=220)
    plt.close(fig)


def draw_planning_modes():
    fig, ax = plt.subplots(figsize=(12, 5.4))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 8)
    ax.axis("off")

    add_box(ax, (4.1, 5.9), 3.8, 1.2, "候选方案池", fc="#edf2f7", size=13)
    mode_boxes = [
        (0.8, 3.4, "工程效率最优"),
        (3.6, 3.4, "资源回收最优"),
        (6.4, 3.4, "覆岩扰动优化"),
        (9.2, 3.4, "综合权衡优化"),
    ]
    for x, y, text in mode_boxes:
        add_box(ax, (x, y), 2.0, 1.2, text, fc="#e6fffa", size=11)
        add_arrow(ax, (6.0, 5.9), (x + 1.0, 4.6))
    add_box(ax, (2.0, 1.0), 3.0, 1.1, "多指标评分", fc="#fefcbf", size=12)
    add_box(ax, (7.0, 1.0), 3.0, 1.1, "非支配排序与推荐", fc="#fefcbf", size=12)
    add_arrow(ax, (2.8, 3.4), (3.3, 2.1))
    add_arrow(ax, (5.6, 3.4), (4.2, 2.1))
    add_arrow(ax, (7.4, 3.4), (8.0, 2.1))
    add_arrow(ax, (10.2, 3.4), (9.0, 2.1))
    add_arrow(ax, (5.0, 1.55), (7.0, 1.55))
    ax.text(6.0, 0.35, "输出可比较、可解释的候选方案集", ha="center", fontsize=11, color="#4a5568")
    ax.set_title("图5 四模式智能规划协同关系图", fontsize=16, pad=10)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "图5_四模式智能规划协同关系图.png", dpi=220)
    plt.close(fig)


def draw_closed_loop():
    fig, ax = plt.subplots(figsize=(12, 5))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 6.5)
    ax.axis("off")

    add_box(ax, (0.7, 2.4), 2.2, 1.2, "规划结果\n工作面/巷道")
    add_box(ax, (3.4, 2.4), 2.2, 1.2, "接续组织\n阶段任务")
    add_box(ax, (6.1, 2.4), 2.2, 1.2, "风险联动\nODI 序列")
    add_box(ax, (8.8, 2.4), 2.2, 1.2, "经济评价\n现金流/NPV")
    add_arrow(ax, (2.9, 3.0), (3.4, 3.0))
    add_arrow(ax, (5.6, 3.0), (6.1, 3.0))
    add_arrow(ax, (8.3, 3.0), (8.8, 3.0))
    add_arrow(ax, (10.9, 2.35), (2.0, 1.1), color="#c53030")
    ax.text(6.0, 0.72, "经济与风险结果反馈到方案调整", ha="center", fontsize=11, color="#c53030")
    ax.set_title("图7 规划-接续-经济闭环评价图", fontsize=16, pad=10)
    fig.tight_layout()
    fig.savefig(FIG_DIR / "图7_规划接续经济闭环评价图.png", dpi=220)
    plt.close(fig)


def main():
    ensure_dir()
    draw_workflow()
    draw_architecture()
    draw_planning_modes()
    draw_closed_loop()
    print("已生成补充图件到：", FIG_DIR)


if __name__ == "__main__":
    main()
