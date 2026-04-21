from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Polygon as MplPolygon
from matplotlib.path import Path as MplPath
import numpy as np
import pandas as pd
from PIL import Image, ImageFilter
from shapely.geometry import MultiPolygon, Polygon


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "煤科投稿" / "最终图片" / "12_4.20正文图_宋体Times大字PNG"

BOUNDARY_CSV = ROOT / "data" / "采区边界_敏东.csv"
BOREHOLE_CSV = ROOT / "data" / "钻孔坐标_敏东.csv"
LAYER_DIR = ROOT / "data" / "钻孔分层数据"
ABC_STATS_CSV = ROOT / "docs" / "plans" / "coal_sci_abc_odi_unified_stats_20260418.csv"
THRESHOLD_CSV = ROOT / "docs" / "plans" / "coal_sci_threshold_sensitivity_candidates_20260418.csv"
WEIGHT_CSV = ROOT / "docs" / "plans" / "coal_sci_weight_sensitivity_candidates_20260418.csv"


def setup_fonts() -> None:
    for p in [
        Path(r"C:\Windows\Fonts\times.ttf"),
        Path(r"C:\Windows\Fonts\timesbd.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
    ]:
        if p.exists():
            font_manager.fontManager.addfont(str(p))
    plt.rcParams.update(
        {
            "font.family": ["Times New Roman", "SimSun"],
            "axes.unicode_minus": False,
            "mathtext.fontset": "stix",
            "figure.dpi": 160,
            "savefig.dpi": 600,
            "axes.titlesize": 15,
            "axes.labelsize": 13,
            "xtick.labelsize": 11,
            "ytick.labelsize": 11,
            "legend.fontsize": 11,
            "lines.linewidth": 1.8,
        }
    )


def read_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, encoding="utf-8-sig")


def ensure_output_dir() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.png"):
        old.unlink()


def save(fig: plt.Figure, name: str) -> None:
    fig.savefig(OUT_DIR / name, bbox_inches="tight", pad_inches=0.08, facecolor="white")
    plt.close(fig)


def rel_arrays(df: pd.DataFrame, xmin: float, ymin: float) -> tuple[np.ndarray, np.ndarray]:
    return df["x"].astype(float).to_numpy() - xmin, df["y"].astype(float).to_numpy() - ymin


def boundary_data() -> tuple[pd.DataFrame, float, float, Polygon]:
    bd = read_csv(BOUNDARY_CSV)
    xmin = float(bd["x"].min())
    ymin = float(bd["y"].min())
    poly = Polygon(list(zip(bd["x"].astype(float), bd["y"].astype(float))))
    return bd, xmin, ymin, poly


def add_scale_north(ax: plt.Axes, x0: float, y0: float, length: float = 500) -> None:
    ax.plot([x0, x0 + length], [y0, y0], color="black", lw=2.2)
    ax.plot([x0, x0], [y0 - 24, y0 + 24], color="black", lw=1.4)
    ax.plot([x0 + length, x0 + length], [y0 - 24, y0 + 24], color="black", lw=1.4)
    ax.text(x0 + length / 2, y0 + 48, f"{int(length)} m", ha="center", va="bottom", fontsize=11)
    ax.annotate(
        "N",
        xy=(x0, y0 + 420),
        xytext=(x0, y0 + 170),
        ha="center",
        va="bottom",
        fontsize=13,
        arrowprops=dict(arrowstyle="-|>", lw=1.8, color="black"),
    )


def plot_boundary(ax: plt.Axes, bd: pd.DataFrame, xmin: float, ymin: float, **kwargs) -> None:
    x, y = rel_arrays(bd, xmin, ymin)
    ax.plot(np.r_[x, x[0]], np.r_[y, y[0]], **{"color": "#1f2937", "lw": 1.8, **kwargs})


def plot_geom(ax: plt.Axes, geom, xmin: float, ymin: float, fc="#dbeafe", ec="#2563eb", alpha=0.35, lw=1.5) -> None:
    if geom.is_empty:
        return
    geoms = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    for g in geoms:
        xs, ys = np.asarray(g.exterior.coords.xy[0]) - xmin, np.asarray(g.exterior.coords.xy[1]) - ymin
        ax.fill(xs, ys, facecolor=fc, edgecolor=ec, alpha=alpha, lw=lw)


def idw_grid(
    xs: np.ndarray,
    ys: np.ndarray,
    zs: np.ndarray,
    bd: pd.DataFrame,
    xmin: float,
    ymin: float,
    nx: int = 180,
    ny: int = 120,
    power: float = 2.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    bx, by = rel_arrays(bd, xmin, ymin)
    gx = np.linspace(bx.min(), bx.max(), nx)
    gy = np.linspace(by.min(), by.max(), ny)
    xx, yy = np.meshgrid(gx, gy)
    pts = np.column_stack([xx.ravel(), yy.ravel()])
    data = np.column_stack([xs, ys])
    dist = np.sqrt(((pts[:, None, :] - data[None, :, :]) ** 2).sum(axis=2))
    close = dist < 1e-9
    w = 1.0 / np.maximum(dist, 1e-9) ** power
    vals = (w @ zs) / w.sum(axis=1)
    if close.any():
        rows = np.where(close.any(axis=1))[0]
        vals[rows] = zs[np.argmax(close[rows], axis=1)]
    boundary_path = MplPath(np.column_stack([bx, by]))
    mask = boundary_path.contains_points(pts).reshape(yy.shape)
    zz = vals.reshape(yy.shape)
    zz[~mask] = np.nan
    return xx, yy, zz


def label_panel(ax: plt.Axes, text: str) -> None:
    ax.text(
        0.02,
        0.96,
        text,
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=14,
        fontweight="bold",
        bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="#cbd5e1", alpha=0.92),
    )


def draw_arrow(ax: plt.Axes, x1: float, y1: float, x2: float, y2: float) -> None:
    ax.add_patch(
        FancyArrowPatch(
            (x1, y1),
            (x2, y2),
            arrowstyle="-|>",
            mutation_scale=18,
            lw=1.6,
            color="#334155",
            shrinkA=8,
            shrinkB=8,
        )
    )


def draw_box(ax: plt.Axes, xy, wh, title: str, body: str, fc: str) -> None:
    x, y = xy
    w, h = wh
    ax.add_patch(
        FancyBboxPatch(
            (x, y),
            w,
            h,
            boxstyle="round,pad=0.025,rounding_size=0.035",
            fc=fc,
            ec="#334155",
            lw=1.4,
        )
    )
    ax.text(x + w / 2, y + h - 0.12, title, ha="center", va="top", fontsize=16, fontweight="bold")
    ax.text(x + w / 2, y + h / 2 - 0.06, body, ha="center", va="center", fontsize=14, linespacing=1.55)


def figure_01() -> None:
    fig, ax = plt.subplots(figsize=(12.5, 4.6))
    ax.set_axis_off()
    boxes = [
        ((0.03, 0.18), (0.20, 0.62), "多场景风险分量", "地表沉陷扰动\n含水层扰动\n上行开采扰动", "#eff6ff"),
        ((0.29, 0.18), (0.20, 0.62), "统一风险表达", "归一化处理\n权重聚合\n形成 ODI 场", "#ecfdf5"),
        ((0.55, 0.18), (0.20, 0.62), "方案级统计", "ODI 均值\nP90 分位值\n超阈值暴露比例", "#fff7ed"),
        ((0.81, 0.18), (0.16, 0.62), "规划决策", "候选方案集合\n非支配排序\nA/B/C 输出", "#f5f3ff"),
    ]
    for xy, wh, title, body, fc in boxes:
        draw_box(ax, xy, wh, title, body, fc)
    for x1, x2 in [(0.23, 0.29), (0.49, 0.55), (0.75, 0.81)]:
        draw_arrow(ax, x1, 0.49, x2, 0.49)
    ax.text(0.5, 0.08, "ODI 风险约束逻辑：从风险分量到候选方案筛选", ha="center", va="center", fontsize=15)
    save(fig, "fig01_odi_risk_constraint_logic.png")


def figure_02() -> None:
    bd, xmin, ymin, poly = boundary_data()
    fig, axes = plt.subplots(1, 4, figsize=(13.2, 3.9), sharex=True, sharey=True)
    titles = ["原始采区边界", "边界煤柱内缩", "保护距离校核", "有效布置域"]
    buffers = [0, -50, -85, -120]
    colors = ["#e0f2fe", "#dcfce7", "#fef3c7", "#ede9fe"]
    for i, ax in enumerate(axes):
        ax.set_aspect("equal")
        ax.set_title(titles[i], fontsize=14, pad=8)
        plot_boundary(ax, bd, xmin, ymin, color="#111827", lw=1.5)
        geom = poly if buffers[i] == 0 else poly.buffer(buffers[i], join_style=2)
        if i == 3 and isinstance(geom, MultiPolygon):
            geom = max(geom.geoms, key=lambda g: g.area)
        plot_geom(ax, geom, xmin, ymin, fc=colors[i], ec="#2563eb", alpha=0.55)
        ax.set_xticks([])
        ax.set_yticks([])
        for s in ax.spines.values():
            s.set_visible(False)
        if i < 3:
            ax.annotate("", xy=(1.09, 0.5), xytext=(1.01, 0.5), xycoords="axes fraction", arrowprops=dict(arrowstyle="-|>", lw=1.6))
    save(fig, "fig02_boundary_to_effective_domain.png")


def load_thickness_points() -> pd.DataFrame:
    holes = read_csv(BOREHOLE_CSV)
    rows = []
    for _, row in holes.iterrows():
        p = LAYER_DIR / f"{row['id']}.csv"
        if not p.exists():
            continue
        layer = read_csv(p)
        names = layer["name"].astype(str)
        hit = layer[names.eq("16-3煤")]
        if hit.empty:
            hit = layer[names.str.contains("16-3", regex=False, na=False) & names.str.contains("煤", regex=False, na=False)]
        if hit.empty:
            continue
        thk = pd.to_numeric(hit["thickness"], errors="coerce").dropna().sum()
        if thk > 0:
            rows.append({"id": row["id"], "x": float(row["x"]), "y": float(row["y"]), "thickness": float(thk)})
    return pd.DataFrame(rows)


def figure_03() -> None:
    bd, xmin, ymin, _ = boundary_data()
    holes = read_csv(BOREHOLE_CSV)
    hx, hy = rel_arrays(holes, xmin, ymin)
    fig, ax = plt.subplots(figsize=(7.4, 5.0))
    ax.set_aspect("equal")
    plot_boundary(ax, bd, xmin, ymin)
    ax.scatter(hx, hy, s=38, c="#dc2626", edgecolors="white", linewidths=0.8, zorder=3, label="钻孔")
    for x, y, name in zip(hx, hy, holes["id"].astype(str)):
        ax.text(x + 28, y + 20, name, fontsize=8.8, color="#111827")
    ax.set_xlabel("X / m")
    ax.set_ylabel("Y / m")
    ax.legend(loc="upper right", frameon=True)
    add_scale_north(ax, 180, 130, 500)
    ax.grid(True, lw=0.4, color="#e5e7eb")
    save(fig, "fig03_borehole_distribution.png")


def figure_04() -> None:
    fig, ax = plt.subplots(figsize=(13.0, 3.8))
    ax.set_axis_off()
    boxes = [
        ((0.03, 0.22), (0.19, 0.55), "钻孔样本", "孔位坐标\n煤厚属性\n异常值校核", "#eff6ff"),
        ((0.29, 0.22), (0.19, 0.55), "空间插值", "IDW 插值\n统一网格\n边界外剔除", "#ecfdf5"),
        ((0.55, 0.22), (0.19, 0.55), "边界裁剪", "有效布置域\n栅格掩膜\n连续参数场", "#fff7ed"),
        ((0.81, 0.22), (0.16, 0.55), "规划输入", "工作面布置\n目标函数\n方案排序", "#f5f3ff"),
    ]
    for xy, wh, title, body, fc in boxes:
        draw_box(ax, xy, wh, title, body, fc)
    for x1, x2 in [(0.22, 0.29), (0.48, 0.55), (0.74, 0.81)]:
        draw_arrow(ax, x1, 0.50, x2, 0.50)
    ax.text(0.5, 0.10, "钻孔样本到煤层厚度连续参数场的构建流程", ha="center", fontsize=15)
    save(fig, "fig04_thickness_field_workflow.png")


def figure_05() -> None:
    bd, xmin, ymin, _ = boundary_data()
    pts = load_thickness_points()
    xs, ys = pts["x"].to_numpy() - xmin, pts["y"].to_numpy() - ymin
    zs = pts["thickness"].to_numpy()
    xx, yy, zz = idw_grid(xs, ys, zs, bd, xmin, ymin)
    fig, ax = plt.subplots(figsize=(7.2, 5.2))
    im = ax.imshow(
        zz,
        extent=[xx.min(), xx.max(), yy.min(), yy.max()],
        origin="lower",
        cmap="YlGnBu",
        vmin=np.nanmin(zs),
        vmax=np.nanmax(zs),
        interpolation="bilinear",
    )
    cs = ax.contour(xx, yy, zz, levels=7, colors="#334155", linewidths=0.55, alpha=0.65)
    ax.clabel(cs, fmt="%.1f", fontsize=8)
    plot_boundary(ax, bd, xmin, ymin, color="#111827", lw=1.7)
    ax.scatter(xs, ys, s=28, c="white", edgecolors="#111827", linewidths=0.8, zorder=3)
    for key in ["50-14", "50-16", "64-24", "56-18"]:
        hit = pts[pts["id"].astype(str).eq(key)]
        if not hit.empty:
            ax.text(float(hit.iloc[0]["x"] - xmin) + 30, float(hit.iloc[0]["y"] - ymin) + 18, key, fontsize=9)
    ax.set_aspect("equal")
    ax.set_xlabel("X / m")
    ax.set_ylabel("Y / m")
    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.03)
    cb.set_label("煤厚 / m", fontsize=12)
    ax.grid(True, lw=0.35, color="#e5e7eb")
    save(fig, "fig05_geological_parameter_field.png")


def load_odi_points(kind: str) -> pd.DataFrame:
    if kind == "surface":
        path = ROOT / "data" / "export_package" / "0-地表下沉.miningplan" / "地表下沉" / "ODI评价点.csv"
    elif kind == "aquifer":
        path = ROOT / "data" / "export_package" / "2-含水层扰动评价.miningplan" / "含水层扰动" / "ODI评价点.csv"
    elif kind == "upward":
        path = ROOT / "data" / "export_package" / "5-采掘接续.miningplan" / "含水层扰动" / "ODI评价点.csv"
    else:
        path = ROOT / "data" / "export_package" / "6-全覆岩扰动.miningplan" / "综合评价" / "ODI评价点.csv"
    df = read_csv(path)
    return df.rename(columns={"X": "x", "Y": "y", "ODI归一化": "odi_norm"})


def field_from_points(df: pd.DataFrame, bd: pd.DataFrame, xmin: float, ymin: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    xs = pd.to_numeric(df["x"], errors="coerce").to_numpy() - xmin
    ys = pd.to_numeric(df["y"], errors="coerce").to_numpy() - ymin
    zs = pd.to_numeric(df["odi_norm"], errors="coerce").to_numpy()
    ok = np.isfinite(xs) & np.isfinite(ys) & np.isfinite(zs)
    return idw_grid(xs[ok], ys[ok], np.clip(zs[ok], 0, 1), bd, xmin, ymin, nx=170, ny=120)


def plot_odi_field(ax: plt.Axes, xx, yy, zz, bd, xmin, ymin, title: str) -> matplotlib.image.AxesImage:
    im = ax.imshow(
        zz,
        extent=[xx.min(), xx.max(), yy.min(), yy.max()],
        origin="lower",
        cmap="viridis",
        vmin=0,
        vmax=1,
        interpolation="bilinear",
    )
    plot_boundary(ax, bd, xmin, ymin, color="#111827", lw=1.35)
    ax.set_title(title, fontsize=14, pad=8)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)
    return im


def figure_06() -> None:
    bd, xmin, ymin, _ = boundary_data()
    fig, axes = plt.subplots(1, 3, figsize=(12.8, 4.0), sharex=True, sharey=True)
    fields = []
    for kind in ["surface", "aquifer", "upward"]:
        fields.append(field_from_points(load_odi_points(kind), bd, xmin, ymin))
    titles = ["地表沉陷分量", "含水层扰动分量", "上行开采分量"]
    im = None
    for ax, field, title in zip(axes, fields, titles):
        im = plot_odi_field(ax, *field, bd, xmin, ymin, title)
    cb = fig.colorbar(im, ax=axes.ravel().tolist(), fraction=0.03, pad=0.02)
    cb.set_label("ODI 归一化值", fontsize=12)
    save(fig, "fig06_odi_risk_components.png")


def figure_07() -> None:
    bd, xmin, ymin, _ = boundary_data()
    base = {
        "地表沉陷场景": field_from_points(load_odi_points("surface"), bd, xmin, ymin),
        "含水层扰动场景": field_from_points(load_odi_points("aquifer"), bd, xmin, ymin),
        "上行开采场景": field_from_points(load_odi_points("upward"), bd, xmin, ymin),
    }
    xx, yy, zs = next(iter(base.values()))
    combo = np.clip(0.45 * base["地表沉陷场景"][2] + 0.30 * base["含水层扰动场景"][2] + 0.25 * base["上行开采场景"][2], 0, 1)
    base["综合 ODI 场"] = (xx, yy, combo)
    fig, axes = plt.subplots(2, 2, figsize=(9.8, 7.4), sharex=True, sharey=True)
    im = None
    for ax, (title, field) in zip(axes.ravel(), base.items()):
        im = plot_odi_field(ax, *field, bd, xmin, ymin, title)
    cb = fig.colorbar(im, ax=axes.ravel().tolist(), fraction=0.032, pad=0.02)
    cb.set_label("ODI 归一化值", fontsize=12)
    save(fig, "fig07_multiscenario_odi_distribution.png")


def figure_08() -> None:
    stats = read_csv(ABC_STATS_CSV)
    stats = stats[stats["plan_code"].isin(["A", "B", "C"])].copy()
    stats["plan_code"] = pd.Categorical(stats["plan_code"], ["A", "B", "C"])
    stats = stats.sort_values("plan_code")
    colors = {"A": "#2563eb", "B": "#f97316", "C": "#16a34a"}
    fig, axes = plt.subplots(1, 3, figsize=(12.5, 4.2))
    x = np.arange(len(stats))
    axes[0].bar(x - 0.18, stats["coverage_pct"], width=0.36, color=[colors[c] for c in stats["plan_code"]], alpha=0.85, label="覆盖率")
    axes[0].bar(x + 0.18, stats["efficiency_score"], width=0.36, color=[colors[c] for c in stats["plan_code"]], alpha=0.45, label="工程效率分")
    axes[0].set_title("布局与效率指标", fontsize=14)
    axes[0].set_ylim(0, 105)
    axes[0].legend(frameon=False)
    axes[1].plot(x, stats["odi_mean"], marker="o", ms=7, color="#0f766e", label="ODI 均值")
    axes[1].plot(x, stats["odi_p90"], marker="s", ms=7, color="#7c3aed", label="P90")
    axes[1].set_title("ODI 统计指标", fontsize=14)
    axes[1].set_ylim(0.38, 0.68)
    axes[1].legend(frameon=False)
    axes[2].bar(x - 0.18, stats["odi_gt_070_pct"], width=0.36, color="#ef4444", alpha=0.75, label="超阈值比例/%")
    axes[2].plot(x + 0.18, stats["risk_score"], marker="D", ms=7, color="#111827", label="风险综合得分")
    axes[2].set_title("阈值暴露与风险得分", fontsize=14)
    axes[2].legend(frameon=False)
    for ax in axes:
        ax.set_xticks(x, stats["plan_code"].astype(str))
        ax.grid(axis="y", color="#e5e7eb", lw=0.5)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
    save(fig, "fig08_abc_multi_indicator_comparison.png")


def project_json_path() -> Path:
    parent = ROOT / "mining-plan" / "frontend" / "public" / "demo"
    return [p for p in parent.glob("*.miningplan.json") if p.name.startswith("3-")][0]


def load_project() -> dict:
    return json.loads(project_json_path().read_text(encoding="utf-8"))


def candidate_by_signature(project: dict, signature: str) -> dict | None:
    for mode in ["efficiency", "recovery", "disturbance"]:
        result = project.get("planningResults", {}).get(mode, {}).get("result", {})
        for cand in result.get("candidates", []):
            if cand.get("signature") == signature or cand.get("key") == signature:
                return cand
    return None


def loop_xy(loop) -> tuple[np.ndarray, np.ndarray]:
    if isinstance(loop, dict) and "loop" in loop:
        loop = loop["loop"]
    if not loop:
        return np.array([]), np.array([])
    if isinstance(loop[0], dict):
        xs = [p.get("x", p.get("X")) for p in loop]
        ys = [p.get("y", p.get("Y")) for p in loop]
    else:
        xs = [p[0] for p in loop]
        ys = [p[1] for p in loop]
    return np.asarray(xs, dtype=float), np.asarray(ys, dtype=float)


def candidate_loops(cand: dict) -> list:
    render = cand.get("render", {})
    loops = render.get("plannedWorkfaceLoopsWorld") or render.get("facesLoops") or cand.get("facesLoops") or []
    return loops


def odi_overlay_field() -> tuple[np.ndarray, list[float], float]:
    p = list(ROOT.rglob("000_mindong_layout_odi_field.json"))[0]
    data = json.loads(p.read_text(encoding="utf-8"))
    arr = np.asarray(data["field"], dtype=float)
    bd, xmin, ymin, _ = boundary_data()
    extent = [float(bd["x"].min()) - xmin, float(bd["x"].max()) - xmin, float(bd["y"].min()) - ymin, float(bd["y"].max()) - ymin]
    return arr, extent, 0.70


def figure_09() -> None:
    bd, xmin, ymin, _ = boundary_data()
    stats = read_csv(ABC_STATS_CSV)
    stats = stats[stats["plan_code"].isin(["A", "B", "C"])].copy()
    project = load_project()
    arr, extent, threshold = odi_overlay_field()
    fig, axes = plt.subplots(1, 3, figsize=(13.5, 5.0), sharex=True, sharey=True)
    colors = {"A": "#2563eb", "B": "#f97316", "C": "#16a34a"}
    names = {"A": "A 工程效率优先", "B": "B 资源回收优先", "C": "C 联合判据低扰动"}
    high = np.where(arr >= threshold, arr, np.nan)
    for ax, code in zip(axes, ["A", "B", "C"]):
        sig = stats.loc[stats["plan_code"].eq(code), "signature"].iloc[0]
        cand = candidate_by_signature(project, sig)
        ax.imshow(high, extent=extent, origin="lower", cmap="Reds", vmin=threshold, vmax=1.0, alpha=0.42, interpolation="bilinear")
        plot_boundary(ax, bd, xmin, ymin, color="#111827", lw=1.5)
        if cand:
            for idx, loop in enumerate(candidate_loops(cand), start=1):
                xs, ys = loop_xy(loop)
                if len(xs) == 0:
                    continue
                xs, ys = xs - xmin, ys - ymin
                ax.fill(xs, ys, facecolor=colors[code], alpha=0.18, edgecolor=colors[code], lw=1.25)
                cx, cy = np.nanmean(xs), np.nanmean(ys)
                ax.text(cx, cy, str(idx), ha="center", va="center", fontsize=8.5, color="#111827")
        ax.set_title(names[code], fontsize=14)
        ax.set_aspect("equal")
        ax.set_xticks([])
        ax.set_yticks([])
        ax.text(0.03, 0.04, "红色阴影：ODI ≥ 0.70", transform=ax.transAxes, fontsize=10, bbox=dict(fc="white", ec="#e5e7eb", alpha=0.86))
    save(fig, "fig09_abc_layout_odi_overlay.png")


def figure_10() -> None:
    df = read_csv(THRESHOLD_CSV)
    df = df[df["plan_code"].isin(["A", "B", "C"])].copy()
    colors = {"A": "#2563eb", "B": "#f97316", "C": "#16a34a"}
    fig, ax = plt.subplots(figsize=(7.2, 4.6))
    for code in ["A", "B", "C"]:
        part = df[df["plan_code"].eq(code)].sort_values("threshold")
        ax.plot(part["threshold"], part["exceed_pct"], marker="o", ms=7, color=colors[code], label=f"方案 {code}")
    ax.set_xlabel("ODI 阈值")
    ax.set_ylabel("超阈值比例 / %")
    ax.grid(True, color="#e5e7eb", lw=0.55)
    ax.legend(frameon=False)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    save(fig, "fig10_threshold_sensitivity.png")


def figure_11() -> None:
    df = read_csv(WEIGHT_CSV)
    df = df[df["plan_code"].isin(["A", "B", "C"])].copy()
    order = ["baseline", "wd_plus10pct", "wd_minus10pct", "wo_plus10pct", "wo_minus10pct", "wf_plus10pct", "wf_minus10pct", "aquifer_special"]
    labels = ["基准", "沉陷+10%", "沉陷-10%", "含水层+10%", "含水层-10%", "上行+10%", "上行-10%", "上行专项"]
    colors = {"A": "#2563eb", "B": "#f97316", "C": "#16a34a"}
    fig, ax = plt.subplots(figsize=(9.0, 4.8))
    x = np.arange(len(order))
    for code in ["A", "B", "C"]:
        part = df[df["plan_code"].eq(code)].set_index("case_id").reindex(order)
        ax.plot(x, part["risk_score"], marker="o", ms=6.5, color=colors[code], label=f"方案 {code}")
    ax.set_xticks(x, labels, rotation=20, ha="right")
    ax.set_ylabel("风险综合得分")
    ax.set_xlabel("权重情景")
    ax.grid(True, axis="y", color="#e5e7eb", lw=0.55)
    ax.legend(frameon=False, ncol=3, loc="upper left")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    save(fig, "fig11_weight_sensitivity.png")


def polish_pngs() -> None:
    for p in OUT_DIR.glob("*.png"):
        with Image.open(p) as im:
            im = im.convert("RGB")
            im = im.filter(ImageFilter.UnsharpMask(radius=1.1, percent=90, threshold=3))
            im.save(p, format="PNG", dpi=(600, 600), optimize=True)


def main() -> None:
    setup_fonts()
    ensure_output_dir()
    figure_01()
    figure_02()
    figure_03()
    figure_04()
    figure_05()
    figure_06()
    figure_07()
    figure_08()
    figure_09()
    figure_10()
    figure_11()
    polish_pngs()
    for p in sorted(OUT_DIR.glob("*.png")):
        with Image.open(p) as im:
            print(f"{p.name}\t{im.width}x{im.height}")
    print(f"OUT_DIR={OUT_DIR}")


if __name__ == "__main__":
    main()
