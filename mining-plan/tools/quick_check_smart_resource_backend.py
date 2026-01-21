import csv
import json
import sys
import time
import urllib.request
from pathlib import Path


def read_boundary_csv(file_path: Path) -> list[dict]:
    text = file_path.read_text(encoding="utf-8", errors="replace")
    rows = list(csv.reader([line for line in text.splitlines() if line.strip()]))
    if not rows:
        return []

    header = [c.strip().lower() for c in rows[0]]
    has_id = "id" in header and "x" in header and "y" in header
    has_xy = len(header) >= 2 and header[0] == "x" and header[1] == "y"
    start = 1 if (has_id or has_xy) else 0

    pts: list[dict] = []
    for r in rows[start:]:
        if len(r) < 2:
            continue
        try:
            if has_id:
                if len(r) < 3:
                    continue
                x = float(r[1])
                y = float(r[2])
            else:
                x = float(r[0])
                y = float(r[1])
        except Exception:
            continue
        if x != x or y != y:
            continue
        pts.append({"x": x, "y": y})

    # 去重（保持顺序）
    seen = set()
    out: list[dict] = []
    for p in pts:
        k = f"{p['x']:.6f},{p['y']:.6f}"
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out


def post_json(url: str, payload: dict, timeout: float = 180.0) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", errors="replace")
        return json.loads(text)


def main() -> int:
    base = sys.argv[1] if len(sys.argv) >= 2 else "http://localhost:3001"
    boundary_arg = sys.argv[2] if len(sys.argv) >= 3 else str(Path(__file__).resolve().parents[1] / "examples" / "采区边界.csv")
    axis = (sys.argv[3] if len(sys.argv) >= 4 else "x").lower()

    if str(boundary_arg).upper() == "RECT":
        pts = [
            {"x": 0.0, "y": 0.0},
            {"x": 800.0, "y": 0.0},
            {"x": 800.0, "y": 500.0},
            {"x": 0.0, "y": 500.0},
        ]
    else:
        boundary_csv = Path(boundary_arg)
        pts = read_boundary_csv(boundary_csv)
    if len(pts) < 3:
        print(f"boundary points too few: {len(pts)} from {boundary_arg}")
        return 2

    req_seq = int(time.time())
    # cacheKey 仅用于对齐前端断言/缓存隔离（本脚本不依赖）
    cache_key = "res|quick-check|thicknessDataHash=manual|targetSeam=CoalThk|gridRes=20|interpVersion=idw-v1"

    payload = {
        "reqSeq": req_seq,
        "cacheKey": cache_key,
        "mode": "smart-resource",
        "input": {"mode": "recovery"},
        "boundaryLoopWorld": pts,
        "axis": "y" if axis == "y" else "x",
        "fast": False,

        # 与 App.jsx 保持一致（核心：per-face + 全覆盖 + segmentWidth/cleanupResidual）
        "perFaceTrapezoid": True,
        "perFaceDeltaSetDeg": [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10],
        "perFaceAdjMaxStepDeg": 4,
        "perFaceInRatioMin": 0.7,
        "perFaceInRatioTry": 0.5,
        "perFaceMaxSeq": 160,
        "perFaceSeedM": 12,
        "perFaceNSet": [3, 4, 5, 6, 7],
        "perFaceExtraBudgetMs": 1500,
        "perFaceVarB": True,
        "perFaceBListMax": 10,
        "preferPerFaceBest": False,
        "relaxedAllowPerFaceShift": True,
        "autoRelaxInRatio": True,
        "autoRelaxInRatioFloor": 0.5,
        "maxTimeMs": 18000,

        "fullCover": True,
        "fullCoverMin": 0.995,
        "ignoreCoalPillarsInCoverage": True,
        "includeClippedLoops": True,

        "segmentWidth": {
            "enabled": True,
            "LtM": 50,
            "gmax": 0.4,
            "deltaBMaxMainM": 5,
            "deltaBMaxCleanupM": 10,
            "deltaBStepM": 1,
            "segmentCountMaxMain": 3,
            "segmentCountMaxCleanup": 3,
            "breakRatios2": [0.4, 0.5, 0.6],
            "breakRatios3": [[0.35, 0.65], [0.4, 0.7], [0.45, 0.75]],
        },
        "cleanupResidual": {
            "enabled": True,
            "maxFacesToAdjust": 5,
            "maxReplacements": 2,
            "allowAddShortFace": True,
            "maxNewFaces": 1,
            "maxTimeMs": 1500,
        },

        # 口径固定（最小值）
        "boundaryPillarMin": 65,
        "boundaryPillarMax": 65,
        "coalPillarMin": 60,
        "coalPillarMax": 60,

        # 面宽范围：确保不会出现“全等宽”假象
        "faceWidthMin": 100,
        "faceWidthMax": 350,
        "faceAdvanceMax": None,
        "topK": 10,

        # 厚度：这里用常数，避免依赖 fieldPack
        "thickness": {
            "fieldPack": None,
            "constantM": 3.5,
            "rho": 1.4,
            "gridRes": 20,
            "interpVersion": "idw-v1",
            "thicknessDataHash": "manual",
            "targetSeam": "CoalThk",
        },
    }

    url = f"{base.rstrip('/')}/api/planning/smart-resource/compute"
    data = post_json(url, payload)
    ok = bool(data.get("ok"))
    cand = data.get("candidates") or []

    print("ok=", ok, "mode=", data.get("mode"), "candidates=", len(cand))
    print("bestSignature=", data.get("bestSignature"), "top1.sig=", (data.get("top1") or {}).get("signature"))

    # 面宽多样性：看 topK 的 B 分布（不同值越多越不像“全等宽”）
    bs = []
    for c in cand[:10]:
        b = c.get("B")
        if isinstance(b, (int, float)):
            bs.append(float(b))
    uniq_b = sorted({round(b, 6) for b in bs})
    print("top10 unique B count=", len(uniq_b), "sample=", uniq_b[:10])

    # Top3 是否有 renderPatched/patchStats
    for i, c in enumerate(cand[:3], start=1):
        rp = c.get("renderPatched")
        has_rp = isinstance(rp, dict) and (
            isinstance(rp.get("clippedFacesLoops"), list) or isinstance(rp.get("plannedWorkfaceLoopsWorld"), list)
        )
        ps = (c.get("metrics") or {}).get("patchStats")
        tier = c.get("patchBudgetTier")
        print(f"top{i}: sig={c.get('signature')} patched={has_rp} tier={tier} patchStats.reason={getattr(ps, 'get', lambda *_: None)('reason') if isinstance(ps, dict) else None}")

    # 诊断：若缺少 base+patched 双版本字段，输出 top1 的关键结构
    if cand:
        c0 = cand[0]
        if "patchBudgetTier" not in c0 or "renderPatched" not in c0:
            keys = sorted([str(k) for k in c0.keys()])
            r0 = c0.get("render")
            print("WARN: top1 missing patch fields")
            print("top1 keys(sample)=", keys[:40])
            has_faces = isinstance((r0 or {}).get("plannedWorkfaceLoopsWorld"), list) if isinstance(r0, dict) else False
            has_omega_loops = isinstance((r0 or {}).get("omegaLoops"), list) if isinstance(r0, dict) else False
            print("top1.render type=", type(r0).__name__, "has plannedWorkfaceLoopsWorld=", has_faces, "has omegaLoops=", has_omega_loops)

            if isinstance(r0, dict) and isinstance(r0.get("omegaLoops"), list):
                omega_loops = r0.get("omegaLoops")
                first = omega_loops[0] if omega_loops else None
                if isinstance(first, list):
                    sample_pts = first[:5]
                    print("omegaLoops.count=", len(omega_loops), "first.len=", len(first), "first.sample=", sample_pts)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
