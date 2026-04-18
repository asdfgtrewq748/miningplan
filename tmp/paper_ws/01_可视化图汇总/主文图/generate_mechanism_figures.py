from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch


ROOT = Path(r"D:\xiangmu\miningplan\论文\重构工作区\01_可视化图汇总\主文图")
FONT = FontProperties(fname=r"C:\Windows\Fonts\msyh.ttc")

COLORS = {
    "bg": "#f4f8fa",
    "title": "#183447",
    "section": "#527082",
    "text": "#365264",
    "arrow": "#355468",
    "feedback": "#c86f2f",
    "blue_fill": "#edf7fb",
    "blue_edge": "#bfd6e0",
    "green_fill": "#f1fbf7",
    "green_edge": "#b9d9c9",
    "mint_fill": "#edf8f4",
    "mint_edge": "#aed0c1",
    "orange_fill": "#fff8f0",
    "orange_edge": "#efcfad",
    "yellow_fill": "#fff9ef",
    "yellow_edge": "#ead2a8",
    "gray_fill": "#f4f7fa",
    "gray_edge": "#cdd8e0",
    "panel_fill": "#ffffff",
    "panel_edge": "#d7e3e7",
    "loop_fill": "#fff3e5",
    "loop_edge": "#efc89e",
}


def setup_canvas(title: str):
    fig, ax = plt.subplots(figsize=(15, 9), dpi=240)
    fig.patch.set_facecolor(COLORS["bg"])
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis("off")
    ax.text(
        50,
        96,
        title,
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=24,
        color=COLORS["title"],
        weight="bold",
    )
    ax.plot([36, 64], [92.5, 92.5], color="#c8d7dd", lw=1.5)
    return fig, ax


def add_box(ax, x, y, w, h, title, lines, fill, edge, title_size=15, text_size=10.5):
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.5,rounding_size=1.8",
        linewidth=1.7,
        facecolor=fill,
        edgecolor=edge,
    )
    ax.add_patch(patch)
    ax.text(
        x + w / 2,
        y + h - 3.6,
        title,
        ha="center",
        va="top",
        fontproperties=FONT,
        fontsize=title_size,
        color=COLORS["title"],
        weight="bold",
    )
    start_y = y + h - 8.8
    for i, line in enumerate(lines):
        ax.text(
            x + 1.8,
            start_y - i * 2.9,
            line,
            ha="left",
            va="top",
            fontproperties=FONT,
            fontsize=text_size,
            color=COLORS["text"],
        )


def add_centered_panel(ax, x, y, w, h, title, lines, fill, edge, title_size=14, text_size=10):
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.5,rounding_size=1.8",
        linewidth=1.7,
        facecolor=fill,
        edgecolor=edge,
    )
    ax.add_patch(patch)
    ax.text(
        x + w / 2,
        y + h - 3.8,
        title,
        ha="center",
        va="top",
        fontproperties=FONT,
        fontsize=title_size,
        color=COLORS["title"],
        weight="bold",
    )
    start_y = y + h - 8.5
    for i, line in enumerate(lines):
        ax.text(
            x + w / 2,
            start_y - i * 2.9,
            line,
            ha="center",
            va="top",
            fontproperties=FONT,
            fontsize=text_size,
            color=COLORS["text"],
        )


def add_arrow(ax, start, end, color=None, dashed=False, rad=0.0, lw=1.9):
    arrow = FancyArrowPatch(
        start,
        end,
        arrowstyle="-|>",
        mutation_scale=15,
        linewidth=lw,
        linestyle=(0, (6, 4)) if dashed else "solid",
        color=color or COLORS["arrow"],
        connectionstyle=f"arc3,rad={rad}",
    )
    ax.add_patch(arrow)


def add_label(ax, x, y, text):
    ax.text(
        x,
        y,
        text,
        ha="left",
        va="center",
        fontproperties=FONT,
        fontsize=11.5,
        color=COLORS["section"],
        weight="bold",
    )


def save(fig, stem: str):
    png = ROOT / f"{stem}.png"
    svg = ROOT / f"{stem}.svg"
    fig.savefig(png, bbox_inches="tight", facecolor=fig.get_facecolor())
    fig.savefig(svg, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)


def draw_fig2():
    fig, ax = setup_canvas("图2 采区智能规划设计一体化方法总流程")
    add_label(ax, 4, 88, "输入与标准化")
    add_label(ax, 38, 88, "前置建模与风险组织")
    add_label(ax, 69, 88, "规划决策与闭环评价")

    add_box(
        ax,
        4,
        69,
        16,
        12,
        "多源数据输入",
        ["边界、钻孔、分层、设计参数", "样例文件与项目快照"],
        COLORS["panel_fill"],
        COLORS["panel_edge"],
    )
    add_box(
        ax,
        24,
        69,
        18,
        12,
        "数据标准化与项目管理",
        ["字段映射、坐标整理、闭合校核", "统一对象口径与状态持久化"],
        "#f6fbfd",
        "#c4d8de",
    )
    add_box(
        ax,
        45,
        71,
        18,
        10,
        "参数场构建",
        ["插值、规则网格、厚度场与空间底图", "为规划约束提供连续地质表达"],
        COLORS["green_fill"],
        COLORS["green_edge"],
        text_size=9.5,
    )
    add_box(
        ax,
        45,
        56,
        18,
        10,
        "ODI 风险组织",
        ["surface / aquifer / upward 统一表征", "形成可比较、可传递的风险约束"],
        COLORS["orange_fill"],
        COLORS["orange_edge"],
        text_size=9.5,
    )
    add_box(
        ax,
        67,
        62,
        21,
        14,
        "四模式规划与候选池",
        ["效率最优、回收最优、扰动最优、综合加权", "候选布局、多指标评分、非支配排序", "输出可比较方案空间而非单一答案"],
        COLORS["mint_fill"],
        COLORS["mint_edge"],
        text_size=9.5,
    )
    add_box(
        ax,
        69,
        43,
        17,
        10.5,
        "三阶段接续",
        ["阶段 1 排程组织", "阶段 2 风险联动", "阶段 3 推荐与比较"],
        COLORS["yellow_fill"],
        COLORS["yellow_edge"],
    )
    add_box(
        ax,
        69,
        28,
        17,
        10.5,
        "经济评价",
        ["月度现金流、NPV、回收期", "风险序列进入经济修正口径"],
        "#fff7ef",
        "#e7c79d",
    )
    add_box(
        ax,
        88.5,
        43,
        8.5,
        25.5,
        "输出归档",
        ["图件与结果", "JSON / CAD", "论文材料", "项目归档"],
        "#f5f8fb",
        "#cad7df",
        title_size=13,
        text_size=9.5,
    )
    add_centered_panel(
        ax,
        6,
        14,
        54,
        11,
        "闭环反馈带",
        ["评价结果回写到规划偏好、风险阈值与方案修订。", "一体化的关键不是模块堆叠，而是关键对象被后续环节持续消费。"],
        COLORS["loop_fill"],
        COLORS["loop_edge"],
    )
    add_box(
        ax,
        6,
        4.5,
        88,
        6,
        "论文口径",
        ["新版平台的主价值在于把样例输入、参数场、风险约束、规划方案、接续组织和经济评价串成可复用的对象链。"],
        COLORS["panel_fill"],
        COLORS["panel_edge"],
        title_size=11,
        text_size=9.4,
    )

    add_arrow(ax, (20, 75), (24, 75))
    add_arrow(ax, (42, 77), (45, 77))
    add_arrow(ax, (42, 73), (45, 61))
    add_arrow(ax, (63, 76), (67, 71), rad=0.05)
    add_arrow(ax, (63, 61), (67, 68), rad=-0.05)
    add_arrow(ax, (77.5, 62), (77.5, 53))
    add_arrow(ax, (77.5, 43), (77.5, 38.5))
    add_arrow(ax, (86, 53), (88.5, 53))
    add_arrow(ax, (86, 33), (88.5, 33))
    add_arrow(ax, (69, 35), (59.5, 19), color=COLORS["feedback"], dashed=True, rad=0.28)
    ax.text(
        59,
        36,
        "评价反馈用于偏好修订与重算",
        fontproperties=FONT,
        fontsize=9.2,
        color=COLORS["feedback"],
        weight="bold",
    )
    save(fig, "图2_采区智能规划设计一体化方法总流程")


def draw_fig3():
    fig, ax = setup_canvas("图3 数据-模型-决策分层架构图")
    add_label(ax, 6, 87.5, "主论文论证链")
    add_label(ax, 73, 87.5, "侧向扩展能力")

    add_box(
        ax,
        6,
        70,
        56,
        13,
        "数据与项目管理层",
        ["采区边界、钻孔、分层、设计参数、项目快照", "负责输入对象的统一组织、校核与持久化"],
        COLORS["blue_fill"],
        COLORS["blue_edge"],
    )
    add_box(
        ax,
        6,
        51,
        56,
        13,
        "模型与风险组织层",
        ["参数场构建、规则网格、三场景分析、ODI 风险场", "把离散输入转化为连续空间对象与风险约束"],
        COLORS["green_fill"],
        COLORS["green_edge"],
    )
    add_box(
        ax,
        6,
        32,
        56,
        13,
        "规划与接续决策层",
        ["候选池生成、四模式规划、三阶段接续、风险联动", "在同一对象语义下完成求解、筛选与组织"],
        "#f5faf3",
        "#c7d7b5",
    )
    add_box(
        ax,
        6,
        14,
        56,
        11,
        "输出与交付层",
        ["图件、结构化结果、JSON、CAD / DXF、论文支撑材料、项目归档"],
        COLORS["gray_fill"],
        COLORS["gray_edge"],
    )
    add_box(
        ax,
        70,
        50,
        24,
        18,
        "扩展建模接口",
        ["GNN 预测、可扩展学习模块、替代性建模链路", "验证平台具备吸纳新模型的开放能力", "但在当前论文中不进入核心结论"],
        COLORS["orange_fill"],
        COLORS["orange_edge"],
        text_size=9.5,
    )
    add_box(
        ax,
        70,
        31,
        24,
        10,
        "边界说明",
        ["主链强调对象连续传递；扩展链强调平台开放性。", "二者主次分明，避免把扩展接口误写成主方法贡献。"],
        COLORS["panel_fill"],
        COLORS["panel_edge"],
        text_size=9.4,
    )

    add_arrow(ax, (34, 70), (34, 64))
    add_arrow(ax, (34, 51), (34, 45))
    add_arrow(ax, (34, 32), (34, 25))
    add_arrow(ax, (62, 57), (70, 57), color="#8a6a3a", dashed=True)
    add_arrow(ax, (82, 50), (82, 25), color="#8a6a3a", dashed=True)
    add_arrow(ax, (82, 25), (62, 19), color="#8a6a3a", dashed=True, rad=0.05)

    save(fig, "图3_数据模型决策分层架构图")


def draw_fig5():
    fig, ax = setup_canvas("图5 四模式智能规划协同关系图")
    add_label(ax, 6, 88, "候选对象共享")
    add_label(ax, 43, 88, "统一评价与筛选")
    add_label(ax, 74, 88, "工程决策输出")

    add_centered_panel(
        ax,
        32,
        72,
        36,
        10.5,
        "候选方案池",
        ["同一批工作面与巷道候选对象在不同工程偏好下被重复评估，而不是各自孤立求解。"],
        COLORS["blue_fill"],
        COLORS["blue_edge"],
    )

    add_box(
        ax,
        8,
        49,
        18,
        12,
        "工程效率最优",
        ["偏重施工效率与推进组织", "优先形成高可实施性候选"],
        COLORS["blue_fill"],
        COLORS["blue_edge"],
    )
    add_box(
        ax,
        29,
        49,
        18,
        12,
        "资源回收最优",
        ["偏重覆盖率、残煤修补与吨位", "保持资源导向的方案空间"],
        COLORS["green_fill"],
        COLORS["green_edge"],
    )
    add_box(
        ax,
        50,
        49,
        18,
        12,
        "覆岩扰动最优",
        ["把 ODI 及相关风险场作为硬约束", "压缩高扰动方案进入下游的概率"],
        COLORS["orange_fill"],
        COLORS["orange_edge"],
    )
    add_box(
        ax,
        71,
        49,
        18,
        12,
        "综合加权优化",
        ["综合效率、回收与扰动", "输出面向工程取舍的折中方案"],
        "#f5f6fb",
        "#cfd4e8",
    )

    add_centered_panel(
        ax,
        20,
        23,
        60,
        12.5,
        "统一评价空间",
        ["四模式共享同一候选对象池，并在多指标评分、约束校核与风险口径一致的前提下进入统一评价。", "这使论文能够讨论“方案空间的保留与收缩”，而不是只展示一个单点结果。"],
        "#fffdf2",
        "#ead792",
    )
    add_box(
        ax,
        28,
        6,
        18,
        10.5,
        "非支配排序 / Top-K 推荐",
        ["形成可比较、可解释的优选候选集合"],
        COLORS["mint_fill"],
        COLORS["mint_edge"],
        title_size=13.5,
    )
    add_box(
        ax,
        54,
        6,
        18,
        10.5,
        "人工复核与方案比选",
        ["保留工程师参与取舍的空间，而非算法替代人工"],
        COLORS["gray_fill"],
        COLORS["gray_edge"],
        title_size=13.5,
    )

    for end_x in (17, 38, 59, 80):
        add_arrow(ax, (50, 72), (end_x, 61))
    add_arrow(ax, (17, 49), (33, 35), rad=0.05)
    add_arrow(ax, (38, 49), (45, 35))
    add_arrow(ax, (59, 49), (55, 35))
    add_arrow(ax, (80, 49), (67, 35), rad=-0.05)
    add_arrow(ax, (50, 23), (37, 16.5))
    add_arrow(ax, (50, 23), (63, 16.5))

    save(fig, "图5_四模式智能规划协同关系图")


def draw_fig7():
    fig, ax = setup_canvas("图7 规划-接续-经济闭环评价图")
    add_label(ax, 6, 88, "结果生成与后续消费")
    add_label(ax, 74, 88, "闭环反馈")

    add_box(
        ax,
        6,
        59,
        18,
        15,
        "规划结果对象",
        ["工作面、巷道、边界约束", "候选方案", "结构化对象形式下传"],
        COLORS["blue_fill"],
        COLORS["blue_edge"],
        text_size=9.2,
    )
    add_box(
        ax,
        28,
        59,
        18,
        15,
        "接续组织",
        ["阶段 1 排程", "阶段 2 风险联动", "阶段 3 推荐与时间序列"],
        COLORS["green_fill"],
        COLORS["green_edge"],
        text_size=9.2,
    )
    add_box(
        ax,
        50,
        59,
        18,
        15,
        "风险联动",
        ["ODI / ODI* 序列", "约束触发与风险月统计", "空间风险口径延伸到评价"],
        COLORS["orange_fill"],
        COLORS["orange_edge"],
        text_size=9.2,
    )
    add_box(
        ax,
        72,
        59,
        18,
        15,
        "经济评价",
        ["现金流、NPV、回收期", "单位成本与月度校核", "统一口径检验可接受性"],
        COLORS["yellow_fill"],
        COLORS["yellow_edge"],
        text_size=9.2,
    )
    add_centered_panel(
        ax,
        13,
        32,
        74,
        12.5,
        "闭环含义",
        ["评价链路的价值不在于给出一个末端分数，而在于证明规划结果能够继续被接续组织和经济模块消费。", "本文强调的是“布局结果可传递、风险口径可延伸、评价结果可反馈”的闭环组织能力。"],
        COLORS["panel_fill"],
        COLORS["panel_edge"],
    )
    add_centered_panel(
        ax,
        17,
        12,
        66,
        9.5,
        "反馈控制带",
        ["经济与风险结果回写到方案偏好、接续顺序、约束阈值与人工复核环节，形成可迭代优化的规划流程。"],
        COLORS["loop_fill"],
        COLORS["loop_edge"],
    )

    add_arrow(ax, (24, 66.5), (28, 66.5))
    add_arrow(ax, (46, 66.5), (50, 66.5))
    add_arrow(ax, (68, 66.5), (72, 66.5))
    add_arrow(ax, (81, 59), (35, 44), color=COLORS["feedback"], dashed=True, rad=0.25)
    ax.text(
        67,
        54.5,
        "评价结果返回规划修订",
        fontproperties=FONT,
        fontsize=9.4,
        color=COLORS["feedback"],
        weight="bold",
    )

    save(fig, "图7_规划接续经济闭环评价图")


def draw_parameter_system():
    fig, ax = setup_canvas("采区规划参数体系构建图")
    add_label(ax, 7, 88, "从原始输入到候选方案")

    steps = [
        (6, "原始边界", ["采区外轮廓", "坐标闭合与合法性"]),
        (22, "有效布置域", ["边界煤柱", "保护距离与裁剪"]),
        (38, "设计参数", ["面长、推进长度", "巷道间距、煤柱宽度"]),
        (54, "约束条件", ["几何可行", "风险阈值、采掘规则"]),
        (70, "目标函数", ["效率、回收", "扰动控制"]),
        (86, "候选方案池", ["Top-K 方案", "结构化对象输出"]),
    ]
    fills = [
        COLORS["blue_fill"],
        COLORS["green_fill"],
        COLORS["mint_fill"],
        COLORS["orange_fill"],
        COLORS["yellow_fill"],
        "#f5f6fb",
    ]
    edges = [
        COLORS["blue_edge"],
        COLORS["green_edge"],
        COLORS["mint_edge"],
        COLORS["orange_edge"],
        COLORS["yellow_edge"],
        "#cfd4e8",
    ]
    for idx, (x, title, lines) in enumerate(steps):
        add_box(ax, x, 61, 12, 17, title, lines, fills[idx], edges[idx], title_size=12.5, text_size=8.8)
        if idx < len(steps) - 1:
            add_arrow(ax, (x + 12, 69.5), (steps[idx + 1][0], 69.5), lw=1.6)

    add_centered_panel(
        ax,
        9,
        37,
        35,
        13,
        "参数进入规划的方式",
        ["边界与钻孔并不直接等同于最终设计方案；", "它们先被转换为有效布置域、参数场和约束口径，", "再进入候选工作面与巷道生成。"],
        COLORS["panel_fill"],
        COLORS["panel_edge"],
        text_size=9.3,
    )
    add_centered_panel(
        ax,
        56,
        37,
        35,
        13,
        "论文证据口径",
        ["当前图件支撑的是参数体系已经形成可计算链路，", "不直接宣称样例结果已经满足真实矿井终判要求。"],
        COLORS["loop_fill"],
        COLORS["loop_edge"],
        text_size=9.3,
    )
    add_arrow(ax, (44, 43.5), (56, 43.5), color=COLORS["feedback"], dashed=True)
    add_centered_panel(
        ax,
        18,
        15,
        64,
        9,
        "核心作用",
        ["把“原始资料展示”转化为“可被规划模块消费的工程参数体系”，补足参数场与候选方案之间的逻辑接口。"],
        COLORS["gray_fill"],
        COLORS["gray_edge"],
        title_size=13,
        text_size=9.5,
    )
    save(fig, "图5_采区规划参数体系构建图")


def draw_odi_control_framework():
    fig, ax = setup_canvas("基于 ODI 分布的协同调控框架图")
    add_label(ax, 8, 88, "风险场生成")
    add_label(ax, 39, 88, "风险分区与控制变量")
    add_label(ax, 74, 88, "方案反馈")

    add_box(
        ax,
        7,
        63,
        18,
        14,
        "ODI 场生成",
        ["沉陷、含水层扰动、上行开采", "归一化指标与权重合成", "形成统一风险底图"],
        COLORS["orange_fill"],
        COLORS["orange_edge"],
        text_size=9.1,
    )
    add_box(
        ax,
        31,
        63,
        18,
        14,
        "风险分区",
        ["低 / 中 / 高扰动区", "P90、均值、阈值超限比例", "识别空间暴露强度"],
        COLORS["yellow_fill"],
        COLORS["yellow_edge"],
        text_size=9.1,
    )
    add_box(
        ax,
        55,
        63,
        18,
        14,
        "调控对象识别",
        ["工作面位置", "推进顺序", "巷道与煤柱组织"],
        COLORS["green_fill"],
        COLORS["green_edge"],
        text_size=9.1,
    )
    add_box(
        ax,
        79,
        63,
        15,
        14,
        "方案对比",
        ["筛除高风险暴露", "比较收益与扰动", "反馈阈值修订"],
        COLORS["blue_fill"],
        COLORS["blue_edge"],
        text_size=9.1,
    )

    add_centered_panel(
        ax,
        15,
        33,
        70,
        14,
        "协同调控逻辑",
        ["ODI 不是末端说明性指标，而是连接风险识别、方案生成、接续组织和经济评价的中介变量。", "风险分区结果进入候选方案筛选，同时把高扰动月份和高暴露空间反馈给后续接续与经济分析。"],
        COLORS["panel_fill"],
        COLORS["panel_edge"],
        text_size=9.5,
    )
    add_centered_panel(
        ax,
        22,
        13,
        56,
        9,
        "边界控制",
        ["该框架说明统一组织关系；参数权重和阈值仍需在真实矿井案例中标定。"],
        COLORS["loop_fill"],
        COLORS["loop_edge"],
        title_size=13,
        text_size=9.4,
    )

    add_arrow(ax, (25, 70), (31, 70))
    add_arrow(ax, (49, 70), (55, 70))
    add_arrow(ax, (73, 70), (79, 70))
    add_arrow(ax, (86, 63), (73, 47), color=COLORS["feedback"], dashed=True, rad=0.22)
    add_arrow(ax, (40, 63), (42, 47), color=COLORS["feedback"], dashed=True)
    save(fig, "图7_基于ODI分布的协同调控框架图")


def draw_succession_process():
    fig, ax = setup_canvas("采掘接续流程与结果组织图")
    add_label(ax, 8, 88, "空间对象到时间序列")

    steps = [
        (8, "规划结果输入", ["工作面几何", "巷道对象、ODI 暴露"]),
        (29, "接续任务生成", ["任务拆分", "产量与工期参数"]),
        (50, "阶段排序", ["阶段 1 / 2 / 3", "约束校核与调整"]),
        (71, "甘特化表达", ["月度推进", "产量-风险序列"]),
    ]
    for idx, (x, title, lines) in enumerate(steps):
        add_box(
            ax,
            x,
            61,
            15,
            15,
            title,
            lines,
            [COLORS["blue_fill"], COLORS["green_fill"], COLORS["yellow_fill"], COLORS["mint_fill"]][idx],
            [COLORS["blue_edge"], COLORS["green_edge"], COLORS["yellow_edge"], COLORS["mint_edge"]][idx],
            title_size=12.5,
            text_size=9.1,
        )
        if idx < len(steps) - 1:
            add_arrow(ax, (x + 15, 68.5), (steps[idx + 1][0], 68.5))

    add_centered_panel(
        ax,
        16,
        36,
        68,
        13,
        "结果组织方式",
        ["接续模块消费的不是图片截图，而是规划阶段形成的结构化工作面与巷道对象。", "这些对象进一步转化为生产任务、阶段顺序、月度推进和风险暴露序列。"],
        COLORS["panel_fill"],
        COLORS["panel_edge"],
        text_size=9.6,
    )
    add_box(
        ax,
        24,
        13,
        22,
        11,
        "风险联动评价",
        ["高 ODI 区域影响顺序与成本", "异常月份进入复核清单"],
        COLORS["orange_fill"],
        COLORS["orange_edge"],
        title_size=13,
        text_size=9.2,
    )
    add_box(
        ax,
        54,
        13,
        22,
        11,
        "方案修订入口",
        ["回写候选池偏好", "支持重算与人工调整"],
        COLORS["loop_fill"],
        COLORS["loop_edge"],
        title_size=13,
        text_size=9.2,
    )
    add_arrow(ax, (46, 18.5), (54, 18.5), color=COLORS["feedback"], dashed=True)
    add_arrow(ax, (71, 61), (65, 24), color=COLORS["feedback"], dashed=True, rad=0.14)
    save(fig, "图10_采掘接续流程与结果组织图")


def draw_economic_result_flow():
    fig, ax = setup_canvas("工程经济分析流程与结果图")
    add_label(ax, 8, 88, "经济评价输入")
    add_label(ax, 38, 88, "现金流计算")
    add_label(ax, 73, 88, "结果解释")

    add_box(
        ax,
        7,
        62,
        19,
        15,
        "接续计划",
        ["月度产量", "推进顺序", "风险暴露月份"],
        COLORS["green_fill"],
        COLORS["green_edge"],
        text_size=9.2,
    )
    add_box(
        ax,
        31,
        62,
        19,
        15,
        "现金流单元",
        ["收入 Rev", "成本 Cost", "风险联动成本 RiskCost"],
        COLORS["yellow_fill"],
        COLORS["yellow_edge"],
        text_size=9.2,
    )
    add_box(
        ax,
        55,
        62,
        19,
        15,
        "评价指标",
        ["月度 NCF", "累计现金流", "NPV、回收期"],
        COLORS["blue_fill"],
        COLORS["blue_edge"],
        text_size=9.2,
    )
    add_box(
        ax,
        79,
        62,
        15,
        15,
        "复核输出",
        ["高风险月份", "低收益阶段", "方案比较建议"],
        COLORS["orange_fill"],
        COLORS["orange_edge"],
        text_size=9.2,
    )
    for start_x, end_x in [(26, 31), (50, 55), (74, 79)]:
        add_arrow(ax, (start_x, 69.5), (end_x, 69.5))

    add_centered_panel(
        ax,
        13,
        35,
        74,
        13,
        "经济闭环含义",
        ["经济评价不是在规划结束后单独填表，而是把接续产量、风险暴露和成本修正纳入同一现金流口径。", "当 NPV、回收期或高风险月份不满足偏好时，结果可反馈至候选方案和接续顺序。"],
        COLORS["panel_fill"],
        COLORS["panel_edge"],
        text_size=9.6,
    )
    add_centered_panel(
        ax,
        23,
        14,
        54,
        9,
        "当前证据边界",
        ["样例已证明经济评价链路可运行；收益幅度和风险成本参数仍需实矿基线对照校准。"],
        COLORS["loop_fill"],
        COLORS["loop_edge"],
        title_size=13,
        text_size=9.3,
    )
    add_arrow(ax, (86, 62), (74, 48), color=COLORS["feedback"], dashed=True, rad=0.22)
    save(fig, "图11_工程经济分析流程与结果图")


if __name__ == "__main__":
    draw_fig2()
    draw_fig3()
    draw_parameter_system()
    draw_fig5()
    draw_odi_control_framework()
    draw_fig7()
    draw_succession_process()
    draw_economic_result_flow()
