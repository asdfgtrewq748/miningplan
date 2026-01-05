import { useCallback, useState } from "react";
import {
	runMeasuredConstraintZoning,
	backfillAnalysisTableInPlace,
	buildContourBreaksFromThresholds,
} from "./measuredConstraintZoning";

/**
 * 用法（在按钮点击处）：
 * const { run, running, error, warnings } = useMeasuredConstraintZoning();
 * <button onClick={() => run({ measuredFiles, odiSource, subsidenceThresholds, activeFileId, ...callbacks })}>启动实测约束分区</button>
 */
export function useMeasuredConstraintZoning() {
	const [running, setRunning] = useState(false);
	const [error, setError] = useState(null);
	const [warnings, setWarnings] = useState([]);

	const run = useCallback(async (params) => {
		const {
			measuredFiles,
			odiSource,
			subsidenceThresholds,
			activeFileId, // 多文件时，指定当前回填/更新的文件
			// 回填/同步刷新：全部可选，传入则就地更新现有状态（不新建表）
			analysisTableRows, // “实测分级对应分析”表现有 rows 引用
			setAnalysisTableRows, // 若你用不可变更新，则传 setter
			minKey,
			maxKey,
			setZones, // “分级响应详情”五分区
			setContourConfig, // 中部等值线图配置（至少 breaks）
		} = params || {};

		setRunning(true);
		setError(null);
		setWarnings([]);

		try {
			const result = await runMeasuredConstraintZoning({
				measuredFiles,
				odiSource,
				subsidenceThresholds,
			});

			const fileId = String(activeFileId ?? measuredFiles?.[0]?.fileId ?? "");
			const r = result.byFile[fileId];
			if (!r) throw new Error(`未找到 activeFileId 对应结果: ${fileId}`);

			// 4) 结果回填（不新建表）：就地改 rows；若外部用不可变，则额外触发一次 setter
			if (analysisTableRows) {
				backfillAnalysisTableInPlace(analysisTableRows, r.bins, { minKey, maxKey });
				if (typeof setAnalysisTableRows === "function") setAnalysisTableRows([...analysisTableRows]);
			}

			// 同步更新“分级响应详情”五分区
			if (typeof setZones === "function") setZones(r.zones);

			// 同步更新等值线图（breaks=6 阈值）
			if (typeof setContourConfig === "function") {
				setContourConfig((prev) => ({
					...(prev || {}),
					breaks: buildContourBreaksFromThresholds(r.thresholds),
					source: "measured-inversion",
				}));
			}

			setWarnings(r.warnings || []);
			return { result, active: r };
		} catch (e) {
			setError(e instanceof Error ? e : new Error(String(e)));
			throw e;
		} finally {
			setRunning(false);
		}
	}, []);

	return { run, running, error, warnings };
}
