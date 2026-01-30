from __future__ import annotations

import io
import json
import os
import subprocess
import tempfile
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field


router = APIRouter()


class CadPoint(BaseModel):
    x: float
    y: float


class CadLabel(BaseModel):
    x: float
    y: float
    text: str
    layer: Optional[str] = None
    height: Optional[float] = None


class CadLoop(BaseModel):
    id: Optional[str] = None
    points: List[CadPoint]
    closed: Optional[bool] = True


class CadFace(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    loop: List[CadPoint]


class CadTransform(BaseModel):
    spatialBounds: Dict[str, Any]
    mainMapRect: Optional[Dict[str, Any]] = None
    viewBox: Optional[Dict[str, Any]] = None
    note: Optional[str] = None


class CadStyle(BaseModel):
    boundaryColor: Optional[str] = '#22c55e'
    faceColor: Optional[str] = '#3b82f6'
    pillarColor: Optional[str] = '#f59e0b'
    textColor: Optional[str] = '#111827'
    boundaryLineweightMm: Optional[float] = 0.25
    faceLineweightMm: Optional[float] = 0.25
    pillarLineweightMm: Optional[float] = 0.25
    textHeight: Optional[float] = 2.5


class CadLayerMap(BaseModel):
    boundary: str = 'LAYER_BOUNDARY'
    face: str = 'LAYER_FACE'
    pillar: str = 'LAYER_PILLAR'
    text: str = 'LAYER_TEXT'
    dim: str = 'LAYER_DIM'


class CadExportPayload(BaseModel):
    # 单位（用于文档元信息/验收）；DXF 单位由 insUnits 控制
    units: Optional[str] = 'm'
    insUnits: Optional[int] = 6  # 6 = meters
    transform: CadTransform

    boundaryLoops: List[CadLoop] = Field(default_factory=list)
    effectiveDomainLoops: List[CadLoop] = Field(default_factory=list)
    faces: List[CadFace] = Field(default_factory=list)
    pillars: List[CadLoop] = Field(default_factory=list)
    labels: List[CadLabel] = Field(default_factory=list)

    layers: CadLayerMap = Field(default_factory=CadLayerMap)
    style: CadStyle = Field(default_factory=CadStyle)
    meta: Dict[str, Any] = Field(default_factory=dict)


def _hex_to_true_color(value: Optional[str], fallback: int = 0x111827) -> int:
    if not value:
        return fallback
    s = str(value).strip()
    if s.startswith('#'):
        s = s[1:]
    if len(s) == 3:
        s = ''.join([c * 2 for c in s])
    if len(s) != 6:
        return fallback
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        return (r << 16) | (g << 8) | b
    except Exception:
        return fallback


def _close_ring(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    if not points:
        return points
    if points[0] != points[-1]:
        return points + [points[0]]
    return points


def _dedupe_consecutive(points: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    if not points:
        return points
    out = [points[0]]
    for p in points[1:]:
        if p != out[-1]:
            out.append(p)
    return out


def _segments_intersect(a1, a2, b1, b2) -> bool:
    # 基础自交检测：严格线段相交（排除共享端点的相邻边）
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    def on_seg(p, q, r):
        return (
            min(p[0], r[0]) <= q[0] <= max(p[0], r[0])
            and min(p[1], r[1]) <= q[1] <= max(p[1], r[1])
        )

    o1 = orient(a1, a2, b1)
    o2 = orient(a1, a2, b2)
    o3 = orient(b1, b2, a1)
    o4 = orient(b1, b2, a2)

    if (o1 == 0 and on_seg(a1, b1, a2)) or (o2 == 0 and on_seg(a1, b2, a2)) or (o3 == 0 and on_seg(b1, a1, b2)) or (o4 == 0 and on_seg(b1, a2, b2)):
        return True

    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def _validate_simple_polygon(points: List[Tuple[float, float]]) -> Optional[str]:
    # points 必须已闭合
    if len(points) < 4:
        return '多边形点数不足（<3）。'
    # 全等/退化
    unique = set(points)
    if len(unique) < 3:
        return '多边形退化（有效点不足）。'

    # 自交检测（O(n^2)，n 通常不大）
    n = len(points) - 1
    segs = [(points[i], points[i + 1]) for i in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            # 跳过相邻边与首尾相邻
            if j == i or j == i + 1 or (i == 0 and j == n - 1):
                continue
            a1, a2 = segs[i]
            b1, b2 = segs[j]
            if _segments_intersect(a1, a2, b1, b2):
                return f'多边形存在自交（edge {i} 与 edge {j}）。'
    return None


def _error(code: str, message: str, status: int = 400, details: Optional[Dict[str, Any]] = None) -> Response:
    payload = {
        'success': False,
        'code': code,
        'message': message,
        'details': details or {},
    }
    return Response(content=json.dumps(payload, ensure_ascii=False), status_code=status, media_type='application/json')


def _build_dxf(payload: CadExportPayload) -> bytes:
    try:
        import ezdxf
    except Exception as e:
        raise RuntimeError(f'ezdxf 未安装或不可用：{e}')

    if payload.transform is None or payload.transform.spatialBounds is None:
        raise ValueError('MISSING_TRANSFORM')

    has_any = bool(payload.boundaryLoops or payload.effectiveDomainLoops or payload.faces or payload.pillars or payload.labels)
    if not has_any:
        raise ValueError('EMPTY_GEOMETRY')

    doc = ezdxf.new(dxfversion='R2010')
    doc.header['$INSUNITS'] = int(payload.insUnits or 6)
    doc.header['$MEASUREMENT'] = 1
    # DXF R2007+ 支持 UTF-8（多数 CAD 可正常打开）；尽量给出提示
    doc.header['$DWGCODEPAGE'] = 'UTF-8'

    msp = doc.modelspace()

    warnings: List[str] = []

    # 图层
    layers = payload.layers
    style = payload.style
    layer_defs = [
        (layers.boundary, _hex_to_true_color(style.boundaryColor), style.boundaryLineweightMm),
        (layers.face, _hex_to_true_color(style.faceColor), style.faceLineweightMm),
        (layers.pillar, _hex_to_true_color(style.pillarColor), style.pillarLineweightMm),
        (layers.text, _hex_to_true_color(style.textColor), None),
        (layers.dim, _hex_to_true_color(style.textColor), None),
    ]
    for name, tcol, lw in layer_defs:
        if name in doc.layers:
            continue
        layer = doc.layers.new(name=name)
        # 7 = white/black，配合 true_color
        layer.dxf.color = 7
        try:
            layer.dxf.true_color = int(tcol)
        except Exception:
            pass
        if lw is not None:
            # DXF lineweight unit: 1/100 mm; ezdxf expects 1/100 mm integer
            try:
                layer.dxf.lineweight = int(round(float(lw) * 100))
            except Exception:
                pass

    def add_poly(points_xy: List[Tuple[float, float]], layer_name: str, true_color: int, lineweight_mm: Optional[float], closed: bool, validate_closed_polygon: bool):
        pts = _dedupe_consecutive(points_xy)
        if closed:
            pts = _close_ring(pts)
            if validate_closed_polygon:
                err = _validate_simple_polygon(pts)
                if err:
                    raise RuntimeError(err)
        attribs = {'layer': layer_name, 'closed': bool(closed), 'color': 7}
        if lineweight_mm is not None:
            try:
                attribs['lineweight'] = int(round(float(lineweight_mm) * 100))
            except Exception:
                pass
        pl = msp.add_lwpolyline(pts, dxfattribs=attribs)
        try:
            pl.dxf.true_color = int(true_color)
        except Exception:
            pass

    def add_closed_poly(points_xy: List[Tuple[float, float]], layer_name: str, true_color: int, lineweight_mm: Optional[float]):
        return add_poly(
            points_xy=points_xy,
            layer_name=layer_name,
            true_color=true_color,
            lineweight_mm=lineweight_mm,
            closed=True,
            validate_closed_polygon=True,
        )

    def add_open_poly(points_xy: List[Tuple[float, float]], layer_name: str, true_color: int, lineweight_mm: Optional[float]):
        return add_poly(
            points_xy=points_xy,
            layer_name=layer_name,
            true_color=true_color,
            lineweight_mm=lineweight_mm,
            closed=False,
            validate_closed_polygon=False,
        )

    # 边界/有效域/煤柱
    for i, loop in enumerate(payload.boundaryLoops or []):
        pts = [(p.x, p.y) for p in (loop.points or [])]
        if len(pts) < 3:
            raise RuntimeError(f'boundaryLoops[{i}] 点数不足。')
        try:
            add_closed_poly(pts, layers.boundary, _hex_to_true_color(style.boundaryColor), style.boundaryLineweightMm)
        except RuntimeError as e:
            # 采区边界自交通常是点序问题；为了避免“导出不可用”，这里降级为闭合折线输出并记录 warning。
            warnings.append(f'boundaryLoops[{i}] 自交/无效，已按闭合折线导出：{e}')
            add_poly(
                points_xy=pts,
                layer_name=layers.boundary,
                true_color=_hex_to_true_color(style.boundaryColor),
                lineweight_mm=style.boundaryLineweightMm,
                closed=True,
                validate_closed_polygon=False,
            )

    # 有效布置域：部分算法输出可能出现自交；为保证可导出可验收（至少可视化），
    # 这里采用“优先闭合多边形；若自交则降级折线输出”策略。
    for i, loop in enumerate(payload.effectiveDomainLoops or []):
        pts = [(p.x, p.y) for p in (loop.points or [])]
        if len(pts) < 3:
            raise RuntimeError(f'effectiveDomainLoops[{i}] 点数不足。')
        try:
            add_closed_poly(pts, layers.boundary, _hex_to_true_color(style.boundaryColor), style.boundaryLineweightMm)
        except RuntimeError:
            # 降级：不做闭合与合法性校验，直接输出折线，避免整单失败
            add_open_poly(pts, layers.boundary, _hex_to_true_color(style.boundaryColor), style.boundaryLineweightMm)

    for i, loop in enumerate(payload.pillars or []):
        pts = [(p.x, p.y) for p in (loop.points or [])]
        if len(pts) < 3:
            raise RuntimeError(f'pillars[{i}] 点数不足。')
        try:
            add_closed_poly(pts, layers.pillar, _hex_to_true_color(style.pillarColor), style.pillarLineweightMm)
        except RuntimeError:
            add_open_poly(pts, layers.pillar, _hex_to_true_color(style.pillarColor), style.pillarLineweightMm)

    # 工作面
    for i, face in enumerate(payload.faces or []):
        pts = [(p.x, p.y) for p in (face.loop or [])]
        if len(pts) < 3:
            raise RuntimeError(f'faces[{i}] 点数不足。')
        try:
            add_closed_poly(pts, layers.face, _hex_to_true_color(style.faceColor), style.faceLineweightMm)
        except RuntimeError as e:
            raise RuntimeError(f'faces[{i}] 几何无效：{e}')

    # 文本
    text_h = float(style.textHeight or 2.5)
    for i, lb in enumerate(payload.labels or []):
        if lb.text is None or str(lb.text).strip() == '':
            continue
        h = float(lb.height or text_h)
        layer_name = lb.layer or layers.text
        ent = msp.add_text(str(lb.text), dxfattribs={'layer': layer_name, 'height': h, 'color': 7})
        ent.set_placement((float(lb.x), float(lb.y)))
        try:
            ent.dxf.true_color = _hex_to_true_color(style.textColor)
        except Exception:
            pass

    # 元信息（写入注释块，便于验收抽查）
    try:
        meta_str = json.dumps(
            {
                'generatedAt': datetime.utcnow().isoformat() + 'Z',
                'units': payload.units,
                'insUnits': payload.insUnits,
                'transform': payload.transform.model_dump(),
                'meta': payload.meta,
                'warnings': warnings,
            },
            ensure_ascii=False,
        )
        msp.add_text('EXPORT_META_JSON', dxfattribs={'layer': layers.text, 'height': 0.0, 'color': 7})
        msp.add_text(meta_str, dxfattribs={'layer': layers.text, 'height': 0.0, 'color': 7})
    except Exception:
        pass

    s = io.StringIO()
    doc.write(s)
    return s.getvalue().encode('utf-8', errors='ignore')


def _run_dxf_to_dwg_converter(dxf_bytes: bytes) -> bytes:
    # Windows：优先使用环境变量配置的转换器
    # 约定：DWG_CONVERTER_PATH 指向可执行文件（例如 ODAFileConverter.exe 或自研转换工具）
    exe = os.getenv('DWG_CONVERTER_PATH', '').strip().strip('"')
    if not exe:
        raise RuntimeError('DWG_CONVERTER_NOT_CONFIGURED')
    if not os.path.exists(exe):
        raise RuntimeError('DWG_CONVERTER_NOT_FOUND')

    mode = os.getenv('DWG_CONVERTER_MODE', '').strip().lower()
    if not mode:
        # 自动推断：ODAFileConverter 常见命名
        base = os.path.basename(exe).lower()
        mode = 'oda' if 'odafileconverter' in base else 'simple'

    with tempfile.TemporaryDirectory(prefix='cad_export_') as td:
        in_dir = os.path.join(td, 'in')
        out_dir = os.path.join(td, 'out')
        os.makedirs(in_dir, exist_ok=True)
        os.makedirs(out_dir, exist_ok=True)

        in_path = os.path.join(in_dir, 'input.dxf')
        with open(in_path, 'wb') as f:
            f.write(dxf_bytes)

        timeout_s = int(os.getenv('DWG_CONVERTER_TIMEOUT_S', '120') or '120')

        if mode == 'oda':
            # ODAFileConverter CLI（常见）：
            # ODAFileConverter <InputFolder> <OutputFolder> <OutputVersion> <OutputFileType> <Recurse> <Audit> [<InputFilter>] [<OutputFilter>]
            out_ver = os.getenv('DWG_CONVERTER_ODA_OUTVER', 'ACAD2018')
            out_type = os.getenv('DWG_CONVERTER_ODA_OUTTYPE', 'DWG')
            recurse = os.getenv('DWG_CONVERTER_ODA_RECURSE', '0')
            audit = os.getenv('DWG_CONVERTER_ODA_AUDIT', '1')
            cmd = [exe, in_dir, out_dir, out_ver, out_type, recurse, audit]
        else:
            # simple 模式：自研/封装工具，参数为 <in> <out>
            out_path = os.path.join(out_dir, 'output.dwg')
            cmd = [exe, in_path, out_path]

        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s)
        except subprocess.TimeoutExpired:
            raise RuntimeError('DWG_CONVERTER_TIMEOUT')

        if proc.returncode != 0:
            raise RuntimeError(f'DWG_CONVERTER_FAILED: {proc.stderr or proc.stdout or "unknown"}')

        # 取输出文件
        if mode == 'oda':
            # ODA 会在 out_dir 下生成同名文件（input.dwg）
            cand = os.path.join(out_dir, 'input.dwg')
            if not os.path.exists(cand):
                # 兜底：找第一个 .dwg
                try:
                    for name in os.listdir(out_dir):
                        if name.lower().endswith('.dwg'):
                            cand = os.path.join(out_dir, name)
                            break
                except Exception:
                    pass
            if not os.path.exists(cand):
                raise RuntimeError('DWG_CONVERTER_NO_OUTPUT')
            with open(cand, 'rb') as f:
                return f.read()
        else:
            out_path = os.path.join(out_dir, 'output.dwg')
            if not os.path.exists(out_path):
                raise RuntimeError('DWG_CONVERTER_NO_OUTPUT')
            with open(out_path, 'rb') as f:
                return f.read()


@router.post('/dxf')
async def export_dxf(payload: CadExportPayload):
    try:
        dxf_bytes = _build_dxf(payload)
    except ValueError as e:
        if str(e) == 'MISSING_TRANSFORM':
            return _error('MISSING_TRANSFORM', '缺少坐标变换（transform/spatialBounds），无法导出。')
        if str(e) == 'EMPTY_GEOMETRY':
            return _error('EMPTY_GEOMETRY', '导出几何为空（boundary/faces/labels 等均缺失）。')
        return _error('INVALID_PAYLOAD', f'导出参数不合法：{e}')
    except RuntimeError as e:
        msg = str(e)
        if '自交' in msg or '多边形' in msg or '点数不足' in msg:
            return _error('INVALID_POLYGON', f'几何无效：{msg}')
        if msg.startswith('ezdxf'):
            return _error('SERVER_DEP_MISSING', msg, status=500)
        return _error('EXPORT_FAILED', msg, status=500)
    except Exception as e:
        return _error('EXPORT_FAILED', f'导出失败：{e}', status=500)

    filename = f"mining_plan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.dxf"
    headers = {
        'Content-Disposition': f'attachment; filename="{filename}"'
    }
    return Response(content=dxf_bytes, media_type='application/dxf', headers=headers)


@router.post('/dwg')
async def export_dwg(payload: CadExportPayload):
    try:
        dxf_bytes = _build_dxf(payload)
    except ValueError as e:
        if str(e) == 'MISSING_TRANSFORM':
            return _error('MISSING_TRANSFORM', '缺少坐标变换（transform/spatialBounds），无法导出。')
        if str(e) == 'EMPTY_GEOMETRY':
            return _error('EMPTY_GEOMETRY', '导出几何为空（boundary/faces/labels 等均缺失）。')
        return _error('INVALID_PAYLOAD', f'导出参数不合法：{e}')
    except RuntimeError as e:
        msg = str(e)
        if '自交' in msg or '多边形' in msg or '点数不足' in msg:
            return _error('INVALID_POLYGON', f'几何无效：{msg}')
        if msg.startswith('ezdxf'):
            return _error('SERVER_DEP_MISSING', msg, status=500)
        return _error('EXPORT_FAILED', msg, status=500)
    except Exception as e:
        return _error('EXPORT_FAILED', f'导出失败：{e}', status=500)

    try:
        dwg_bytes = _run_dxf_to_dwg_converter(dxf_bytes)
    except RuntimeError as e:
        msg = str(e)
        if msg in ['DWG_CONVERTER_NOT_CONFIGURED', 'DWG_CONVERTER_NOT_FOUND']:
            return _error('DWG_CONVERTER_NOT_CONFIGURED', 'DWG 转换器未配置或不存在。请在后端设置环境变量 DWG_CONVERTER_PATH。', status=501)
        if msg.startswith('DWG_CONVERTER_FAILED'):
            return _error('DWG_CONVERTER_FAILED', msg, status=500)
        return _error('DWG_CONVERTER_FAILED', msg, status=500)

    filename = f"mining_plan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.dwg"
    headers = {
        'Content-Disposition': f'attachment; filename="{filename}"'
    }
    # dwg mime
    return Response(content=dwg_bytes, media_type='application/acad', headers=headers)
