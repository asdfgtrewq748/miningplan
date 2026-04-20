from __future__ import annotations

import shutil
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch


ROOT = Path(__file__).resolve().parents[1]
SUBMIT = ROOT / "煤科投稿"
FINAL_DIR = SUBMIT / "最终图片" / "11_五张核心正文图_20260420"


def get_font() -> font_manager.FontProperties:
    for candidate in [
        Path(r"C:\Windows\Fonts\simsun.ttc"),
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
    ]:
        if candidate.exists():
            return font_manager.FontProperties(fname=str(candidate))
    return font_manager.FontProperties(family="sans-serif")


FONT = get_font()


def rounded_box(ax, x, y, w, h, text, *, fc="#f7fbff", ec="#7c98aa", lw=1.4, fs=10.5, weight="normal"):
    box = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.16,rounding_size=0.08",
        linewidth=lw,
        edgecolor=ec,
        facecolor=fc,
    )
    ax.add_patch(box)
    ax.text(
        x + w / 2,
        y + h / 2,
        text,
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=fs,
        color="#213547",
        linespacing=1.35,
        weight=weight,
    )
    return box


def arrow(ax, x1, y1, x2, y2):
    ax.add_patch(
        FancyArrowPatch(
            (x1, y1),
            (x2, y2),
            arrowstyle="-|>",
            mutation_scale=14,
            linewidth=1.3,
            color="#52616b",
            shrinkA=5,
            shrinkB=5,
        )
    )


def draw_fig1(outdir: Path) -> None:
    mpl.rcParams["svg.fonttype"] = "none"
    mpl.rcParams["pdf.fonttype"] = 42
    mpl.rcParams["ps.fonttype"] = 42

    # Keep the aspect ratio close to the previous in-document Fig.1 frame
    # so the DOCX media can be replaced without editing Word drawing XML.
    fig, ax = plt.subplots(figsize=(11.8, 5.78), dpi=600)
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    group_fc = ["#edf6fb", "#eff8f3", "#fff7e8", "#f4f6f8"]
    group_ec = ["#a7c3d5", "#a8cdbb", "#e5c78e", "#c5ced6"]
    group_titles = [
        "多场景风险分量",
        "统一风险表达",
        "方案级风险统计",
        "规划决策环节",
    ]
    xs = [0.035, 0.285, 0.535, 0.785]
    gw = 0.18
    gh = 0.72
    y0 = 0.16
    for i, x in enumerate(xs):
        rounded_box(ax, x, y0, gw, gh, "", fc=group_fc[i], ec=group_ec[i], lw=1.1)
        ax.text(
            x + gw / 2,
            y0 + gh - 0.06,
            group_titles[i],
            ha="center",
            va="center",
            fontproperties=FONT,
            fontsize=12.2,
            color="#17384d",
            weight="bold",
        )

    # Group 1
    rounded_box(ax, xs[0] + 0.022, 0.66, 0.136, 0.08, "地表沉陷扰动", fc="#ffffff", ec="#9bb8ca", fs=10.2)
    rounded_box(ax, xs[0] + 0.022, 0.52, 0.136, 0.08, "含水层扰动", fc="#ffffff", ec="#9bb8ca", fs=10.2)
    rounded_box(ax, xs[0] + 0.022, 0.38, 0.136, 0.08, "上行开采扰动", fc="#ffffff", ec="#9bb8ca", fs=10.2)

    # Group 2
    rounded_box(ax, xs[1] + 0.022, 0.62, 0.136, 0.08, "归一化", fc="#ffffff", ec="#9bc3ad", fs=10.5)
    rounded_box(ax, xs[1] + 0.022, 0.49, 0.136, 0.08, "权重聚合", fc="#ffffff", ec="#9bc3ad", fs=10.5)
    rounded_box(ax, xs[1] + 0.022, 0.36, 0.136, 0.08, "ODI 场", fc="#ffffff", ec="#9bc3ad", fs=10.5, weight="bold")

    # Group 3
    rounded_box(ax, xs[2] + 0.022, 0.64, 0.136, 0.08, "ODI 均值", fc="#ffffff", ec="#d8b56f", fs=10.2)
    rounded_box(ax, xs[2] + 0.022, 0.51, 0.136, 0.08, "P90", fc="#ffffff", ec="#d8b56f", fs=10.2)
    rounded_box(ax, xs[2] + 0.022, 0.38, 0.136, 0.08, "E$_{T_{ODI}}$", fc="#ffffff", ec="#d8b56f", fs=10.8)

    # Group 4
    rounded_box(ax, xs[3] + 0.022, 0.66, 0.136, 0.08, "候选方案集合", fc="#ffffff", ec="#b7c2ca", fs=10.0)
    rounded_box(ax, xs[3] + 0.022, 0.52, 0.136, 0.08, "非支配排序", fc="#ffffff", ec="#b7c2ca", fs=10.0)
    rounded_box(ax, xs[3] + 0.022, 0.38, 0.136, 0.08, "偏好筛选", fc="#ffffff", ec="#b7c2ca", fs=10.0)
    rounded_box(ax, xs[3] + 0.022, 0.24, 0.136, 0.08, "A/B/C 候选输出", fc="#ffffff", ec="#b7c2ca", fs=10.0, weight="bold")

    for i in range(3):
        arrow(ax, xs[i] + gw + 0.008, 0.52, xs[i + 1] - 0.008, 0.52)

    ax.text(
        0.5,
        0.055,
        "风险分量输入 → ODI 统一组织 → 方案级统计 → 候选方案筛选与排序",
        ha="center",
        va="center",
        fontproperties=FONT,
        fontsize=10.4,
        color="#52616b",
    )

    for suffix in ["png", "svg", "pdf", "tif"]:
        out = outdir / f"fig1_odi_logic.{suffix}"
        fig.savefig(out, dpi=600, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def copy_asset(src: Path, dst_stem: Path) -> None:
    mapping = {
        ".png": dst_stem.with_suffix(".png"),
        ".svg": dst_stem.with_suffix(".svg"),
        ".pdf": dst_stem.with_suffix(".pdf"),
        ".tif": dst_stem.with_suffix(".tif"),
    }
    for suffix, dst in mapping.items():
        candidate = src.with_suffix(suffix)
        if candidate.exists():
            shutil.copy2(candidate, dst)


def main() -> None:
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    draw_fig1(FINAL_DIR)

    copy_asset(
        SUBMIT / "最终图片" / "08_历史论文插图包" / "20260417_124903" / "论文主图" / "02-研究区钻孔空间分布图.png",
        FINAL_DIR / "fig2_borehole_distribution",
    )
    copy_asset(
        SUBMIT / "最终图片" / "08_历史论文插图包" / "20260417_124903" / "论文主图" / "03-研究区主要地质参数场分布图.png",
        FINAL_DIR / "fig3_thickness_field",
    )
    copy_asset(
        SUBMIT / "最终图片" / "08_历史论文插图包" / "20260417_124903" / "论文主图" / "04-多场景ODI分布结果对比图.png",
        FINAL_DIR / "fig4_multiscenario_odi",
    )
    copy_asset(
        SUBMIT / "最终图片" / "10_论文图件精修版" / "图5_ABC三方案布局对比图_精修.png",
        FINAL_DIR / "fig5_abc_layout_odi_overlay",
    )

    captions = {
        "fig1_odi_logic": (
            "图1 ODI风险约束逻辑示意图",
            "Fig.1 Schematic diagram of the ODI risk-constraint logic",
        ),
        "fig2_borehole_distribution": (
            "图2 研究区钻孔空间分布图",
            "Fig.2 Spatial distribution of boreholes in the study area",
        ),
        "fig3_thickness_field": (
            "图3 研究区主要地质参数场分布图",
            "Fig.3 Distribution of main geological parameter fields in the study area",
        ),
        "fig4_multiscenario_odi": (
            "图4 多场景ODI分布结果对比图",
            "Fig.4 Comparison of multi-scenario ODI distribution results",
        ),
        "fig5_abc_layout_odi_overlay": (
            "图5 A/B/C候选方案工作面布局与ODI高值区叠置对比图",
            "Fig.5 Comparison of A/B/C candidate layouts overlaid with high-ODI zones",
        ),
    }
    lines = ["# 五张核心正文图清单", ""]
    for stem, (zh, en) in captions.items():
        lines.append(f"- `{stem}`")
        lines.append(f"  - {zh}")
        lines.append(f"  - {en}")
    (FINAL_DIR / "README_figure_manifest.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(FINAL_DIR)


if __name__ == "__main__":
    main()
