// Runs the frontend smartEfficiency.worker.js in Node.js and returns the final `result` payload as JSON.
// Input: JSON via stdin.
// - If input has { type, payload }, it will be used as-is.
// - Otherwise input is treated as the worker payload and wrapped as { type: 'compute', payload: input }.

import fs from 'node:fs';

// Emulate WebWorker globals used by the worker bundle.
globalThis.self = globalThis;
const outbox = [];
// Collect all posted messages; caller can decide which to use.
globalThis.self.postMessage = (msg) => {
  outbox.push(msg);
};

const workerUrl = new URL('../frontend/src/planning/workers/smartEfficiency.worker.js', import.meta.url);
await import(workerUrl.href);

if (typeof globalThis.self.onmessage !== 'function') {
  throw new Error('smartEfficiency.worker.js did not register self.onmessage');
}

const stdin = fs.readFileSync(0, 'utf8');
const input = stdin && stdin.trim() ? JSON.parse(stdin) : {};

const msg = (input && typeof input === 'object' && input.type && input.payload)
  ? input
  : { type: 'compute', payload: input };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run (worker handler may be async).
const ret = globalThis.self.onmessage({ data: msg });
if (ret && typeof ret.then === 'function') {
  await ret;
}

// 等待消息队列稳定后取最后一次 result（避免只拿到早期/占位回包）。
const deadlineMs = Date.now() + Number(process.env.MP_WORKER_WAIT_MS || 8000);
let lastLen = outbox.length;
let lastChangeAt = Date.now();
while (Date.now() < deadlineMs) {
  await sleep(25);
  if (outbox.length !== lastLen) {
    lastLen = outbox.length;
    lastChangeAt = Date.now();
    continue;
  }
  if (Date.now() - lastChangeAt > 120) {
    const hasResult = [...outbox].reverse().some((m) => m && m.type === 'result');
    if (hasResult) break;
  }
}

const lastResult = [...outbox].reverse().find((m) => m && m.type === 'result');
if (!lastResult) {
  throw new Error('No result message emitted by worker');
}

process.stdout.write(JSON.stringify(lastResult.payload ?? lastResult));
