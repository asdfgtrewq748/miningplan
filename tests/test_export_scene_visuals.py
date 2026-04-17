from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import export_scene_visuals as exporter


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def minimal_scene_payload() -> dict:
    return {
        "kind": "mining-plan-project-input-snapshot",
        "schemaVersion": 5,
        "planningParams": {
            "mineCapacity": "500",
            "coalDensity": "1.35",
            "recoveryRateMin": "0.85",
            "recoveryRateMax": "0.95",
            "seamThickness": "4.5",
        },
        "succession": {
            "stage1Params": {
                "daysPerMonth": 25,
                "utilization": 0.85,
                "shearAdvanceRate": 6,
                "driveRate": 15,
                "installDays": 15,
                "relocationDays": 10,
                "singleFaceMining": True,
                "driveParallelWithMining": True,
                "driveCrews": 1,
            },
            "stage2Params": {
                "metric": "p90",
                "threshold": 0.85,
                "sampleStepM": 25,
                "useOdiStarWhenAvailable": True,
            },
            "stage3Params": {"wProd": 1.0, "wRisk": 1.0, "wMonths": 0.15},
            "panelOrderMode": "yardConfirmed",
            "yardDir": "NE",
            "yardOffsetM": 120,
            "yardConfirmed": {"dir": "NE", "offsetM": 120, "confirmedAt": 1772866102052},
            "selectedFaceIndex": 1,
        },
        "economicsParams": {
            "coalPriceYuanPerTon": 820,
            "salesRatio": 1.0,
            "opexVarYuanPerTon": 320,
            "opexFixedWanPerMonth": 300,
            "capexInitialWan": 1800,
            "capexSustainWanPerYear": 120,
            "discountRate": 0.10,
            "riskLinkEnabled": True,
            "riskMetricKey": "p90",
            "riskImpactThreshold": 0.85,
            "riskDowntimeRatio": 0.10,
            "riskExtraCostWanPerHighRiskMonth": 0,
        },
        "scenarioParamsById": {
            "surface": {
                "drillholeData": [
                    {"id": "Z1", "x": 0.0, "y": 0.0},
                    {"id": "Z2", "x": 100.0, "y": 0.0},
                    {"id": "Z3", "x": 0.0, "y": 80.0},
                    {"id": "Z4", "x": 100.0, "y": 80.0},
                ],
                "boundaryData": [
                    {"x": -10.0, "y": -10.0},
                    {"x": 110.0, "y": -10.0},
                    {"x": 110.0, "y": 90.0},
                    {"x": -10.0, "y": 90.0},
                ],
                "workingFaceData": [
                    {"id": "No.1", "x": 20.0, "y": 20.0},
                    {"id": "No.1", "x": 80.0, "y": 20.0},
                    {"id": "No.1", "x": 80.0, "y": 60.0},
                    {"id": "No.1", "x": 20.0, "y": 60.0},
                ],
                "measuredConstraintData": [
                    {"id": "M1", "x": 20.0, "y": 40.0, "measured": 0.2},
                    {"id": "M2", "x": 40.0, "y": 40.0, "measured": 0.4},
                    {"id": "M3", "x": 60.0, "y": 40.0, "measured": 0.7},
                    {"id": "M4", "x": 80.0, "y": 40.0, "measured": 0.9},
                ],
                "paramExtractionResult": {
                    "points": [
                        {"id": "P1", "x": 0.0, "y": 0.0, "Ti": 10.0, "Hi": 100.0, "Di": 200.0, "Mi": 5.0},
                        {"id": "P2", "x": 100.0, "y": 0.0, "Ti": 15.0, "Hi": 110.0, "Di": 190.0, "Mi": 6.0},
                        {"id": "P3", "x": 0.0, "y": 80.0, "Ti": 12.0, "Hi": 90.0, "Di": 210.0, "Mi": 4.5},
                        {"id": "P4", "x": 100.0, "y": 80.0, "Ti": 18.0, "Hi": 120.0, "Di": 205.0, "Mi": 6.5},
                    ]
                },
                "odiResult": {
                    "points": [
                        {"id": "O1", "cat": "red", "x": 20.0, "y": 40.0, "odi": 0.2, "odiNorm": 0.2, "Ti": 10.0, "Hi": 100.0, "Di": 200.0, "Mi": 5.0},
                        {"id": "O2", "cat": "red", "x": 40.0, "y": 40.0, "odi": 0.4, "odiNorm": 0.4, "Ti": 11.0, "Hi": 98.0, "Di": 202.0, "Mi": 5.3},
                        {"id": "O3", "cat": "red", "x": 60.0, "y": 40.0, "odi": 0.7, "odiNorm": 0.7, "Ti": 12.0, "Hi": 95.0, "Di": 205.0, "Mi": 5.8},
                        {"id": "O4", "cat": "red", "x": 80.0, "y": 40.0, "odi": 0.9, "odiNorm": 0.9, "Ti": 13.0, "Hi": 92.0, "Di": 208.0, "Mi": 6.1},
                    ],
                    "weights": {"wd": 0.4, "wo": 0.35, "wf": 0.25},
                    "minOdi": 0.2,
                    "maxOdi": 0.9,
                },
                "measuredZoningResult": {
                    "scenario": "surface",
                    "validOdiCount": 4,
                    "importedCount": 4,
                    "bins": [
                        {"odiLo": 0.0, "odiHi": 0.2, "measuredMin": 0.0, "measuredMax": 0.3},
                        {"odiLo": 0.2, "odiHi": 0.4, "measuredMin": 0.3, "measuredMax": 0.6},
                        {"odiLo": 0.4, "odiHi": 0.6, "measuredMin": 0.6, "measuredMax": 0.9},
                        {"odiLo": 0.6, "odiHi": 0.8, "measuredMin": 0.9, "measuredMax": 1.2},
                        {"odiLo": 0.8, "odiHi": 1.0, "measuredMin": 1.2, "measuredMax": 1.5},
                    ],
                },
                "errorAnalysisByLineId": {
                    "line-1": {
                        "label": "测线1",
                        "data": [
                            {"id": "M1", "x": 20.0, "y": 40.0, "measured": 0.2, "odiRenorm": 0.15, "errorRatio": 0.1, "errorRatioChart": 0.1},
                            {"id": "M2", "x": 40.0, "y": 40.0, "measured": 0.4, "odiRenorm": 0.35, "errorRatio": 0.12, "errorRatioChart": 0.12},
                            {"id": "M3", "x": 60.0, "y": 40.0, "measured": 0.7, "odiRenorm": 0.68, "errorRatio": 0.08, "errorRatioChart": 0.08},
                        ],
                    }
                },
            }
        },
        "workfacePlan": {
            "plannedWorkfaceLoopsWorld": [
                {
                    "faceIndex": 1,
                    "loop": [
                        {"x": 15.0, "y": 15.0},
                        {"x": 85.0, "y": 15.0},
                        {"x": 85.0, "y": 65.0},
                        {"x": 15.0, "y": 65.0},
                    ],
                }
            ]
        },
        "planningResults": {
            "efficiency": {
                "result": {
                    "table": {
                        "rows": [
                            {"rank": 1, "signature": "eff-A", "coveragePct": 96.0, "efficiencyScore": 0.92, "tonnageTotal": 5400000, "N": 1, "B": 260, "wb": 300, "ws": 20},
                            {"rank": 2, "signature": "eff-B", "coveragePct": 92.0, "efficiencyScore": 0.88, "tonnageTotal": 5000000, "N": 2, "B": 240, "wb": 280, "ws": 20},
                        ]
                    }
                }
            },
            "recovery": {
                "result": {
                    "table": {
                        "rows": [
                            {"rank": 1, "signature": "rec-A", "coveragePct": 95.0, "recoveryScore": 0.90, "tonnageTotal": 5600000, "N": 1, "B": 255, "wb": 300, "ws": 20},
                            {"rank": 2, "signature": "rec-B", "coveragePct": 90.0, "recoveryScore": 0.84, "tonnageTotal": 5100000, "N": 2, "B": 235, "wb": 280, "ws": 20},
                        ]
                    }
                }
            },
            "disturbance": {
                "result": {
                    "table": {
                        "rows": [
                            {"rank": 1, "signature": "dist-A", "coveragePct": 94.0, "distScore": 0.28, "tonnageTotal": 5200000, "N": 1, "B": 250, "wb": 300, "ws": 20},
                            {"rank": 2, "signature": "dist-B", "coveragePct": 91.0, "distScore": 0.34, "tonnageTotal": 5000000, "N": 2, "B": 245, "wb": 280, "ws": 20},
                        ]
                    }
                }
            },
            "weighted": {
                "result": {
                    "table": {
                        "rows": [
                            {"rank": 1, "signature": "w-A", "totalScore": 92.5, "effScore": 0.91, "recScore": 0.89, "distScore": 0.24, "coveragePct": 95.0, "tonnageTotal": 5500000, "N": 1, "B": 255, "wb": 300, "ws": 20},
                            {"rank": 2, "signature": "w-B", "totalScore": 86.3, "effScore": 0.86, "recScore": 0.82, "distScore": 0.31, "coveragePct": 91.0, "tonnageTotal": 5050000, "N": 2, "B": 240, "wb": 280, "ws": 20},
                        ]
                    }
                }
            },
        },
    }


def test_discover_scene_files_from_directory(tmp_path: Path) -> None:
    scene_dir = tmp_path / "scenes"
    write_json(scene_dir / "0-地表下沉.miningplan.json", minimal_scene_payload())
    write_json(scene_dir / "1-含水层扰动评价.miningplan.json", minimal_scene_payload())

    discovered = exporter.discover_scene_files([scene_dir])

    assert [path.name for path in discovered] == [
        "0-地表下沉.miningplan.json",
        "1-含水层扰动评价.miningplan.json",
    ]


def test_default_output_dir_is_nested_under_output(tmp_path: Path) -> None:
    out_dir = exporter.build_default_output_dir(tmp_path)

    assert out_dir.parent.name == "scene_visual_exports"
    assert out_dir.parent.parent == tmp_path / "output"


def test_export_scene_writes_vector_and_data_files(tmp_path: Path) -> None:
    scene_file = tmp_path / "0-地表下沉.miningplan.json"
    write_json(scene_file, minimal_scene_payload())
    output_root = tmp_path / "exports"

    summary = exporter.export_scene_file(scene_file, output_root, formats=("svg", "pdf", "png"))

    assert summary.figure_count >= 6

    scene_dir = output_root / summary.scene_slug
    surface_dir = scene_dir / "surface"
    assert scene_dir.is_dir()
    assert surface_dir.is_dir()

    assert any(surface_dir.glob("*.svg"))
    assert any(surface_dir.glob("*.pdf"))
    assert any(surface_dir.glob("*.png"))
    assert (surface_dir / "data_odi_points.csv").is_file()
    assert (surface_dir / "odi_summary.json").is_file()


def test_export_scene_includes_planning_succession_and_economics_figures(tmp_path: Path) -> None:
    scene_file = tmp_path / "3-planning.miningplan.json"
    write_json(scene_file, minimal_scene_payload())
    output_root = tmp_path / "exports"

    summary = exporter.export_scene_file(scene_file, output_root, formats=("svg",))

    scene_dir = output_root / summary.scene_slug
    assert (scene_dir / "overview" / "02-四模式规划指标对比.svg").is_file()
    assert (scene_dir / "overview" / "03-加权优选候选方案.svg").is_file()
    assert (scene_dir / "succession" / "01-月产曲线.svg").is_file()
    assert (scene_dir / "succession" / "02-采掘接续甘特图.svg").is_file()
    assert (scene_dir / "succession" / "03-接续方案对比.svg").is_file()
    assert (scene_dir / "economics" / "01-现金流分析.svg").is_file()
    assert (scene_dir / "economics" / "02-收入成本结构.svg").is_file()
    assert (scene_dir / "economics" / "03-成本构成.svg").is_file()
    assert summary.figure_count >= 12


def test_write_paper_figure_guide_creates_recommendation_doc(tmp_path: Path) -> None:
    output_root = tmp_path / "exports"
    output_root.mkdir(parents=True, exist_ok=True)
    planning_overview = output_root / "03_mining_planning" / "overview"
    planning_overview.mkdir(parents=True, exist_ok=True)
    (planning_overview / "01-采区规划布局.svg").write_text("<svg/>", encoding="utf-8")
    (planning_overview / "02-四模式规划指标对比.svg").write_text("<svg/>", encoding="utf-8")
    summaries = [
        exporter.ExportSummary(
            scene_name="0-surface",
            scene_slug="00_surface_subsidence",
            source_file=tmp_path / "0-surface.miningplan.json",
            figure_count=9,
        ),
        exporter.ExportSummary(
            scene_name="3-planning",
            scene_slug="03_mining_planning",
            source_file=tmp_path / "3-planning.miningplan.json",
            figure_count=15,
        ),
    ]

    guide_path = exporter.write_paper_figure_guide(
        output_root,
        summaries,
        heading_lines=[
            "0 引言",
            "1 基于覆岩扰动指数约束的采区多目标协同规划方法",
            "2 工程案例与结果分析",
            "2.2 连续参数场构建结果",
            "2.3 多场景 ODI 风险表征结果",
            "3 四模式规划结果与方案比选",
            "3.1 结构化规划结果",
            "3.3 规划结果向采掘接续与工程经济评价的传递",
        ],
    )

    assert guide_path.is_file()
    content = guide_path.read_text(encoding="utf-8")
    assert "03_mining_planning" in content
    assert "02-四模式规划指标对比.svg" in content
    assert "2.2 连续参数场构建结果" in content
