#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_SNAPSHOT_SCHEMA = 1;

const DEFAULT_DISTURBANCE_PARAMS = {
  sampleStepM: 25,
  maxSamples: 4500,
  exceedThreshold: 0.7,
  wMean: 0.5,
  wP90: 0.35,
  wExceed: 0.15,
  outerBufferM: 30,
};

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const nonNegNum = (v, fallback = null) => {
  const n = toNum(v);
  if (n == null) return fallback;
  return Math.max(0, n);
};

const clamp01 = (v, fallback = null) => {
  const n = toNum(v);
  if (n == null) return fallback;
  return Math.max(0, Math.min(1, n));
};

const formatIssue = (level, msg) => `${level.toUpperCase()}: ${msg}`;

const validateOne = async (filePath) => {
  const issues = [];
  const abs = path.resolve(process.cwd(), filePath);
  let raw = '';
  let obj = null;

  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch (e) {
    issues.push(formatIssue('error', `读取失败：${abs} (${String(e?.message ?? e)})`));
    return { abs, ok: false, issues };
  }

  try {
    obj = JSON.parse(raw);
  } catch (e) {
    issues.push(formatIssue('error', `JSON 解析失败：${abs} (${String(e?.message ?? e)})`));
    return { abs, ok: false, issues };
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    issues.push(formatIssue('error', '根对象必须是 object'));
    return { abs, ok: false, issues };
  }

  if (String(obj.kind) !== 'mining-plan-project-input-snapshot') {
    issues.push(formatIssue('error', `kind 不匹配：${String(obj.kind)}`));
  }

  const ver = toNum(obj.schemaVersion);
  if (ver == null) {
    issues.push(formatIssue('error', 'schemaVersion 缺失或不是数字'));
  } else if (ver > PROJECT_SNAPSHOT_SCHEMA) {
    issues.push(formatIssue('error', `schemaVersion=${ver} 过新（当前校验脚本版本=${PROJECT_SNAPSHOT_SCHEMA}）`));
  }

  const allowedTopKeys = new Set([
    'kind',
    'schemaVersion',
    'exportedAt',
    'activeTab',
    'planningParams',
    'planningDisturbanceParams',
    'planningAdvanceAxis',
    'scenarioParamsById',
  ]);
  for (const k of Object.keys(obj)) {
    if (!allowedTopKeys.has(k)) {
      issues.push(formatIssue('warn', `发现未预期字段：${k}`));
    }
  }

  const planningParams = (obj.planningParams && typeof obj.planningParams === 'object' && !Array.isArray(obj.planningParams))
    ? obj.planningParams
    : null;
  if (!planningParams) {
    issues.push(formatIssue('warn', 'planningParams 缺失或不是对象（将使用系统运行时默认值）'));
  } else {
    const rho = toNum(planningParams.coalDensity);
    if (rho == null) {
      issues.push(formatIssue('warn', `planningParams.coalDensity 不可解析：${String(planningParams.coalDensity)}（运行时会回退 1.4）`));
    } else if (!(rho > 0)) {
      issues.push(formatIssue('warn', `planningParams.coalDensity=${rho} 非正数（建议 > 0）`));
    }
  }

  const dpRaw = (obj.planningDisturbanceParams && typeof obj.planningDisturbanceParams === 'object' && !Array.isArray(obj.planningDisturbanceParams))
    ? obj.planningDisturbanceParams
    : null;

  const scenarioParamsById = (obj.scenarioParamsById && typeof obj.scenarioParamsById === 'object' && !Array.isArray(obj.scenarioParamsById))
    ? obj.scenarioParamsById
    : null;
  if (!scenarioParamsById) {
    issues.push(formatIssue('warn', 'scenarioParamsById 缺失或不是对象（导入时大概率会失败）'));
  } else {
    const keys = Object.keys(scenarioParamsById);
    if (!keys.length) issues.push(formatIssue('warn', 'scenarioParamsById 为空（导入时大概率会失败）'));
  }

  const dp = {
    ...DEFAULT_DISTURBANCE_PARAMS,
    ...(dpRaw ?? {}),
  };

  const sampleStepM = nonNegNum(dp.sampleStepM, DEFAULT_DISTURBANCE_PARAMS.sampleStepM);
  const maxSamples = nonNegNum(dp.maxSamples, DEFAULT_DISTURBANCE_PARAMS.maxSamples);
  const exceedThreshold = clamp01(dp.exceedThreshold, DEFAULT_DISTURBANCE_PARAMS.exceedThreshold);
  const wMean = clamp01(dp.wMean, DEFAULT_DISTURBANCE_PARAMS.wMean);
  const wP90 = clamp01(dp.wP90, DEFAULT_DISTURBANCE_PARAMS.wP90);
  const wExceed = clamp01(dp.wExceed, DEFAULT_DISTURBANCE_PARAMS.wExceed);
  const outerBufferM = nonNegNum(dp.outerBufferM, DEFAULT_DISTURBANCE_PARAMS.outerBufferM);

  if (dpRaw == null) {
    issues.push(formatIssue('warn', 'planningDisturbanceParams 缺失或不是对象（导入时会使用默认值）'));
  }

  if (!(sampleStepM > 0)) issues.push(formatIssue('warn', `planningDisturbanceParams.sampleStepM=${sampleStepM} 不合法（建议 > 0）`));
  if (!(maxSamples >= 100)) issues.push(formatIssue('warn', `planningDisturbanceParams.maxSamples=${maxSamples} 偏小（可能导致采样不足）`));
  if (!(outerBufferM >= 0)) issues.push(formatIssue('warn', `planningDisturbanceParams.outerBufferM=${outerBufferM} 不合法（应 >= 0）`));

  const ok = !issues.some((x) => x.startsWith('ERROR:'));
  return {
    abs,
    ok,
    issues,
    normalized: {
      schemaVersion: ver,
      planningParams: planningParams ? { coalDensity: planningParams.coalDensity } : null,
      planningDisturbanceParams: {
        sampleStepM,
        maxSamples,
        exceedThreshold,
        wMean,
        wP90,
        wExceed,
        outerBufferM,
      },
    },
  };
};

const main = async () => {
  const args = process.argv.slice(2).filter(Boolean);
  if (!args.length) {
    console.log('用法: node tools/validate_project_snapshot.mjs <file1.miningplan.json> [file2...]');
    process.exitCode = 2;
    return;
  }

  let anyError = false;
  for (const p of args) {
    const r = await validateOne(p);
    console.log(`\n==> ${r.abs}`);
    if (r.issues.length) {
      for (const line of r.issues) console.log(line);
    } else {
      console.log('OK: 未发现问题');
    }
    if (r.normalized) {
      console.log('归一化参数(供人工核对):');
      console.log(JSON.stringify(r.normalized, null, 2));
    }
    if (!r.ok) anyError = true;
  }

  process.exitCode = anyError ? 1 : 0;
};

main().catch((e) => {
  console.error('validate_project_snapshot failed:', e);
  process.exitCode = 1;
});
