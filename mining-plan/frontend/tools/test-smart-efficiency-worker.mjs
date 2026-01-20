// Minimal node-side harness to execute smartEfficiency.worker.js compute() via self.onmessage
// Run from mining-plan/frontend: node tools/test-smart-efficiency-worker.mjs

import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Collect result
let lastMsg = null;

globalThis.self = {
  postMessage: (msg) => {
    lastMsg = msg;
  },
};

// Import the worker (registers self.onmessage)
const workerPath = path.resolve('./src/planning/workers/smartEfficiency.worker.js');
await import(pathToFileURL(workerPath).href);

if (typeof globalThis.self.onmessage !== 'function') {
  throw new Error('self.onmessage not initialized');
}

// Load example boundary from repo CSV if present; otherwise synthesize a rectangle.
const defaultBoundary = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 800 },
  { x: 0, y: 800 },
];

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const runCompute = (payload) => {
  lastMsg = null;
  globalThis.self.onmessage({ data: { type: 'compute', payload } });
  if (!lastMsg) throw new Error('No postMessage result');
  return lastMsg.payload;
};

const base = {
  boundaryLoopWorld: defaultBoundary,
  faceWidthMin: 100,
  faceWidthMax: 350,
  boundaryPillarMin: 0,
  boundaryPillarMax: 0,
  coalPillarMin: 10,
  coalPillarMax: 10,
  faceAdvanceMax: 600,
  topK: 5,
};

// 1) axis=x
const resX = runCompute({
  ...base,
  reqSeq: 1,
  axis: 'x',
  cacheKey: 'eff|axis=x|node-harness',
});
assert(resX?.ok === true, `axis=x compute failed: ${String(resX?.failedReason ?? resX?.message ?? '')}`);
assert(resX.axis === 'x', `axis=x response.axis mismatch: ${String(resX.axis)}`);
assert(String(resX.cacheKey).includes('axis=x'), `axis=x response.cacheKey mismatch: ${String(resX.cacheKey)}`);
assert(String(resX.selectedCandidateKey).startsWith('x|'), `axis=x selectedCandidateKey prefix mismatch: ${String(resX.selectedCandidateKey)}`);

// 2) axis=y（必须仍返回 axis=y 语义，且 key 前缀为 y|）
const resY = runCompute({
  ...base,
  reqSeq: 2,
  axis: 'y',
  cacheKey: 'eff|axis=y|node-harness',
});
assert(resY?.ok === true, `axis=y compute failed: ${String(resY?.failedReason ?? resY?.message ?? '')}`);
assert(resY.axis === 'y', `axis=y response.axis mismatch: ${String(resY.axis)}`);
assert(String(resY.cacheKey).includes('axis=y'), `axis=y response.cacheKey mismatch: ${String(resY.cacheKey)}`);
assert(String(resY.selectedCandidateKey).startsWith('y|'), `axis=y selectedCandidateKey prefix mismatch: ${String(resY.selectedCandidateKey)}`);

// 3) 修改 wb（代表值）应影响签名与结果（至少 key 中 wb=... 改变）
const resWb = runCompute({
  ...base,
  reqSeq: 3,
  axis: 'x',
  boundaryPillarMin: 60,
  boundaryPillarMax: 60,
  cacheKey: 'eff|axis=x|wb=60|node-harness',
});
assert(resWb?.ok === true, `wb changed compute failed: ${String(resWb?.failedReason ?? resWb?.message ?? '')}`);
assert(String(resWb.selectedCandidateKey).includes('wb=60.0000'), `wb signature not updated: ${String(resWb.selectedCandidateKey)}`);

// 4) 修改 ws（范围）应能完成重算并返回结果（key 必须回显为新 cacheKey）
const resWs = runCompute({
  ...base,
  reqSeq: 4,
  axis: 'x',
  coalPillarMin: 30,
  coalPillarMax: 50,
  cacheKey: 'eff|axis=x|ws=30-50|node-harness',
});
assert(resWs?.ok === true, `ws changed compute failed: ${String(resWs?.failedReason ?? resWs?.message ?? '')}`);
assert(String(resWs.cacheKey).includes('ws=30-50'), `ws response.cacheKey mismatch: ${String(resWs.cacheKey)}`);

// 5) fast=true：必须快速返回，且 fast 标记、axis/key 前缀保持一致
const resFastX = runCompute({
  ...base,
  reqSeq: 5,
  axis: 'x',
  fast: true,
  cacheKey: 'eff|axis=x|fast|node-harness',
});
assert(resFastX?.ok === true, `fast axis=x compute failed: ${String(resFastX?.failedReason ?? resFastX?.message ?? '')}`);
assert(resFastX.fast === true, `fast axis=x response.fast mismatch: ${String(resFastX.fast)}`);
assert(resFastX.axis === 'x', `fast axis=x response.axis mismatch: ${String(resFastX.axis)}`);
assert(String(resFastX.selectedCandidateKey).startsWith('x|'), `fast axis=x selectedCandidateKey prefix mismatch: ${String(resFastX.selectedCandidateKey)}`);

const resFastY = runCompute({
  ...base,
  reqSeq: 6,
  axis: 'y',
  fast: true,
  cacheKey: 'eff|axis=y|fast|node-harness',
});
assert(resFastY?.ok === true, `fast axis=y compute failed: ${String(resFastY?.failedReason ?? resFastY?.message ?? '')}`);
assert(resFastY.fast === true, `fast axis=y response.fast mismatch: ${String(resFastY.fast)}`);
assert(resFastY.axis === 'y', `fast axis=y response.axis mismatch: ${String(resFastY.axis)}`);
assert(String(resFastY.selectedCandidateKey).startsWith('y|'), `fast axis=y selectedCandidateKey prefix mismatch: ${String(resFastY.selectedCandidateKey)}`);

console.log(JSON.stringify({
  ok: true,
  axisX: {
    bestKey: resX?.bestKey,
    selectedCandidateKey: resX?.selectedCandidateKey,
    candidateCount: resX?.stats?.candidateCount,
  },
  axisY: {
    bestKey: resY?.bestKey,
    selectedCandidateKey: resY?.selectedCandidateKey,
    candidateCount: resY?.stats?.candidateCount,
  },
  wbChanged: {
    bestKey: resWb?.bestKey,
    selectedCandidateKey: resWb?.selectedCandidateKey,
  },
  wsChanged: {
    bestKey: resWs?.bestKey,
    selectedCandidateKey: resWs?.selectedCandidateKey,
  },
  fastX: {
    bestKey: resFastX?.bestKey,
    selectedCandidateKey: resFastX?.selectedCandidateKey,
    candidateCount: resFastX?.stats?.candidateCount,
    BsearchVersion: resFastX?.attemptSummary?.Bsearch?.version,
  },
  fastY: {
    bestKey: resFastY?.bestKey,
    selectedCandidateKey: resFastY?.selectedCandidateKey,
    candidateCount: resFastY?.stats?.candidateCount,
    BsearchVersion: resFastY?.attemptSummary?.Bsearch?.version,
  },
}, null, 2));
