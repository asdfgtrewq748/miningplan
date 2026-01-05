/**
 * 实测约束下 ODI 分级区间反推与结果回填（前端纯算法实现，不引入新依赖）
 *
 * 数据约定：
 * measuredFiles: Array<{
 *   fileId: string,
 *   fileName?: string,
 *   points: Array<{ id?: string|number, x: number, y: number, subsidence: number }>
 * }>
 *
 * odiSource:
 *   - 优先：{ sample: (x:number, y:number) => number }
 *   - 备选栅格：{ grid: { x0,y0, dx,dy, nx,ny, values:number[][] } }  // values[yi][xi]
 *
 * subsidenceThresholds: number[6]  // 6 个实测沉陷分级临界值（升序/可自动排序）
 */

export async function runMeasuredConstraintZoning({
	measuredFiles,
	odiSource,
	subsidenceThresholds,
	options = {},
}) {
	const {
		clipNormOdiTo01 = true,
		constantOdiFallback = 0, // 当某文件 ODI 全相同无法归一化时，normOdi 全部置为该值
	} = options;

	if (!Array.isArray(measuredFiles) || measuredFiles.length === 0) {
		throw new Error("measuredFiles 不能为空");
	}
	if (!odiSource || (!isFn(odiSource.sample) && !odiSource.grid)) {
		throw new Error("odiSource 需提供 sample(x,y) 或 grid");
	}
	const subThr = normalizeThresholds(subsidenceThresholds, 6, "subsidenceThresholds");

	const byFile = {};
	for (const file of measuredFiles) {
		const fileId = String(file?.fileId ?? "");
		if (!fileId) throw new Error("measuredFiles[].fileId 必填");

		const rawPoints = Array.isArray(file.points) ? file.points : [];
		if (rawPoints.length === 0) {
			byFile[fileId] = {
				fileId,
				fileName: file.fileName,
				points: [],
				thresholds: subThr.map(() => 0),
				bins: thresholdsToBins(subThr.map(() => 0)),
				zones: defaultZonesFromBins(thresholdsToBins(subThr.map(() => 0))),
				warnings: ["该文件无测点数据，已跳过采样/反推"],
			};
			continue;
		}

		// 1) ODI 逐点提取：point-odi-subsidence
		const sampled = rawPoints.map((p, idx) => {
			const x = toNum(p.x);
			const y = toNum(p.y);
			const subsidence = toNum(p.subsidence);
			if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`测点坐标非法: fileId=${fileId}, row=${idx}`);
			if (!Number.isFinite(subsidence)) throw new Error(`实测下沉非法: fileId=${fileId}, row=${idx}`);
			const odi = sampleOdi(odiSource, x, y);
			if (!Number.isFinite(odi)) throw new Error(`ODI 采样失败: fileId=${fileId}, row=${idx}`);
			return {
				id: p.id ?? idx,
				x,
				y,
				subsidence,
				odi,
			};
		});

		// 2) 按文件 ODI 再归一化：point-normOdi-subsidence
		const { points: normed, warnings: normWarnings } = normalizeOdiPerFile(sampled, {
			constantOdiFallback,
			clipNormOdiTo01,
		});

		// 3) 阈值反推：PAV 单调回归 subsidence -> normOdi，并在 6 个 subsidence 临界值处取对应 normOdi
		const inv = invertThresholdsByIsotonic(normed, subThr, { clipNormOdiTo01 });

		// 5 个区间
		const bins = thresholdsToBins(inv.normOdiThresholds);
		const zones = defaultZonesFromBins(bins);

		byFile[fileId] = {
			fileId,
			fileName: file.fileName,
			points: normed, // 含 odi / normOdi / subsidence
			thresholds: inv.normOdiThresholds, // 6 个
			bins, // 5 个 [min,max]
			zones,
			warnings: [...normWarnings, ...inv.warnings],
		};
	}

	return { byFile, subsidenceThresholds: subThr };
}

/**
 * 将 5 个区间回填到“实测分级对应分析”表（不新建表：就地修改）
 * tableRows: Array<object>，建议行数=5，分别对应 5 个扰动等级
 * 需要你在 UI 侧把字段名映射到现有表结构（默认 odiMin/odiMax）
 */
export function backfillAnalysisTableInPlace(tableRows, bins, { minKey = "odiMin", maxKey = "odiMax" } = {}) {
	if (!Array.isArray(tableRows)) return;
	for (let i = 0; i < Math.min(tableRows.length, bins.length); i++) {
		const row = tableRows[i];
		if (!row) continue;
		row[minKey] = bins[i].min;
		row[maxKey] = bins[i].max;
	}
}

/**
 * 等值线/插值面分级配置：使用 6 阈值（breaks）即可同步更新中部等值线图
 */
export function buildContourBreaksFromThresholds(normOdiThresholds) {
	const thr = normalizeThresholds(normOdiThresholds, 6, "normOdiThresholds");
	return thr;
}

// ----------------- internals -----------------

function isFn(v) {
	return typeof v === "function";
}
function toNum(v) {
	const n = typeof v === "string" ? Number(v) : v;
	return Number.isFinite(n) ? n : NaN;
}

function normalizeThresholds(arr, expectedLen, name) {
	if (!Array.isArray(arr) || arr.length !== expectedLen) {
		throw new Error(`${name} 需为长度 ${expectedLen} 的数组`);
	}
	const nums = arr.map(toNum);
	if (nums.some((n) => !Number.isFinite(n))) throw new Error(`${name} 含非法数值`);
	// 升序（若传入无序，自动排序）
	return [...nums].sort((a, b) => a - b);
}

function sampleOdi(odiSource, x, y) {
	if (isFn(odiSource.sample)) return odiSource.sample(x, y);
	if (odiSource.grid) return sampleGridBilinear(odiSource.grid, x, y);
	return NaN;
}

function sampleGridBilinear(grid, x, y) {
	const { x0, y0, dx, dy, nx, ny, values } = grid || {};
	if (![x0, y0, dx, dy, nx, ny].every(Number.isFinite)) return NaN;
	if (!Array.isArray(values) || values.length < ny) return NaN;

	const fx = (x - x0) / dx;
	const fy = (y - y0) / dy;

	// clamp to grid bounds
	const xClamped = clamp(fx, 0, nx - 1);
	const yClamped = clamp(fy, 0, ny - 1);

	const x1 = Math.floor(xClamped);
	const y1 = Math.floor(yClamped);
	const x2 = clamp(x1 + 1, 0, nx - 1);
	const y2 = clamp(y1 + 1, 0, ny - 1);

	const q11 = getGrid(values, x1, y1);
	const q21 = getGrid(values, x2, y1);
	const q12 = getGrid(values, x1, y2);
	const q22 = getGrid(values, x2, y2);

	if (![q11, q21, q12, q22].every(Number.isFinite)) return NaN;

	const tx = xClamped - x1;
	const ty = yClamped - y1;

	const a = q11 * (1 - tx) + q21 * tx;
	const b = q12 * (1 - tx) + q22 * tx;
	return a * (1 - ty) + b * ty;
}

function getGrid(values, xi, yi) {
	const row = values?.[yi];
	if (!Array.isArray(row)) return NaN;
	const v = row[xi];
	return Number.isFinite(v) ? v : NaN;
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

function normalizeOdiPerFile(points, { constantOdiFallback, clipNormOdiTo01 }) {
	const warnings = [];
	let min = Infinity;
	let max = -Infinity;
	for (const p of points) {
		min = Math.min(min, p.odi);
		max = Math.max(max, p.odi);
	}
	const span = max - min;
	if (!Number.isFinite(span) || span === 0) {
		warnings.push("该文件 ODI 为常数/异常，归一化已使用兜底值");
		return {
			points: points.map((p) => ({
				...p,
				normOdi: clipNormOdiTo01 ? clamp(constantOdiFallback, 0, 1) : constantOdiFallback,
			})),
			warnings,
		};
	}
	return {
		points: points.map((p) => {
			let normOdi = (p.odi - min) / span;
			if (clipNormOdiTo01) normOdi = clamp(normOdi, 0, 1);
			return { ...p, normOdi };
		}),
		warnings,
	};
}

/**
 * 用 PAV（Pool Adjacent Violators）做单调回归：x=subsidence（升序）-> y=normOdi（单调不减）
 * 在每个 subsidenceThreshold 处，取对应的 yhat（线性插值）
 */
function invertThresholdsByIsotonic(points, subsidenceThresholds, { clipNormOdiTo01 }) {
	const warnings = [];

	const pairs = points
		.map((p) => ({ x: p.subsidence, y: p.normOdi }))
		.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
		.sort((a, b) => a.x - b.x);

	if (pairs.length < 2) {
		warnings.push("有效测点不足，阈值反推退化为全 0");
		const z = subsidenceThresholds.map(() => 0);
		return { normOdiThresholds: z, warnings };
	}

	const fit = isotonicRegressionPAV(pairs);

	const normOdiThresholds = subsidenceThresholds.map((thr) => {
		const y = evalPiecewiseLinear(fit.xs, fit.ys, thr);
		let yy = y;
		if (clipNormOdiTo01) yy = clamp(yy, 0, 1);
		return yy;
	});

	// 最终保证单调不减（极端数据情况下再兜底一次）
	for (let i = 1; i < normOdiThresholds.length; i++) {
		if (normOdiThresholds[i] < normOdiThresholds[i - 1]) {
			warnings.push("反推阈值出现非单调，已进行单调修正");
			normOdiThresholds[i] = normOdiThresholds[i - 1];
		}
	}

	return { normOdiThresholds, warnings };
}

function isotonicRegressionPAV(pairs) {
	// blocks: { sumY, sumW, startX, endX }
	const blocks = [];
	for (const p of pairs) {
		blocks.push({ sumY: p.y, sumW: 1, startX: p.x, endX: p.x });
		// merge backward if violates monotonicity
		while (blocks.length >= 2) {
			const b = blocks[blocks.length - 1];
			const a = blocks[blocks.length - 2];
			const avgA = a.sumY / a.sumW;
			const avgB = b.sumY / b.sumW;
			if (avgA <= avgB) break;
			// merge
			a.sumY += b.sumY;
			a.sumW += b.sumW;
			a.endX = b.endX;
			blocks.pop();
		}
	}

	// expand to fitted points per original x (use block average for each x in that block)
	const xs = [];
	const ys = [];
	let i = 0;
	for (const b of blocks) {
		const avg = b.sumY / b.sumW;
		// cover all original points with x in [startX, endX] in order
		while (i < pairs.length && pairs[i].x >= b.startX && pairs[i].x <= b.endX) {
			xs.push(pairs[i].x);
			ys.push(avg);
			i++;
		}
	}
	// 兜底：若浮点边界导致遗漏，补齐
	while (i < pairs.length) {
		xs.push(pairs[i].x);
		ys.push(ys.length ? ys[ys.length - 1] : pairs[i].y);
		i++;
	}
	return { xs, ys };
}

function evalPiecewiseLinear(xs, ys, x) {
	if (!xs.length) return 0;
	if (x <= xs[0]) return ys[0];
	const n = xs.length;
	if (x >= xs[n - 1]) return ys[n - 1];
	// find rightmost idx with xs[idx] <= x
	let lo = 0, hi = n - 1;
	while (lo + 1 < hi) {
		const mid = (lo + hi) >> 1;
		if (xs[mid] <= x) lo = mid;
		else hi = mid;
	}
	const x1 = xs[lo], y1 = ys[lo];
	const x2 = xs[hi], y2 = ys[hi];
	if (x2 === x1) return y2;
	const t = (x - x1) / (x2 - x1);
	return y1 * (1 - t) + y2 * t;
}

function thresholdsToBins(thresholds6) {
	const thr = normalizeThresholds(thresholds6, 6, "normOdiThresholds");
	const bins = [];
	for (let i = 0; i < 5; i++) bins.push({ min: thr[i], max: thr[i + 1] });
	return bins;
}

function defaultZonesFromBins(bins) {
	// 仅提供默认结构；UI 可按既定“分级响应详情”字段映射
	return bins.map((b, idx) => ({
		level: idx + 1,
		label: `扰动等级${idx + 1}`,
		odiMin: b.min,
		odiMax: b.max,
	}));
}
