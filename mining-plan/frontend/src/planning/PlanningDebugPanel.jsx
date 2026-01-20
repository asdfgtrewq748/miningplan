import React, { useMemo, useState } from 'react';

const TAB_ITEMS = [
  { key: 'input', label: 'Input（输入参数）' },
  { key: 'request', label: 'Request（Worker 请求）' },
  { key: 'response', label: 'Response（返回摘要）' },
];

function safeJson(data) {
  try {
    return JSON.stringify(data ?? null, null, 2);
  } catch (e) {
    return JSON.stringify({ error: String(e?.message ?? e) }, null, 2);
  }
}

export default function PlanningDebugPanel({ snapshot }) {
  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState('input');
  const [copiedKey, setCopiedKey] = useState('');

  const tsText = useMemo(() => {
    const ts = Number(snapshot?.ts);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts);
    }
  }, [snapshot?.ts]);

  const onCopy = async (key, data) => {
    try {
      await navigator.clipboard.writeText(safeJson(data));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    } catch (e) {
      // 剪贴板权限在部分环境下可能失败；退化为 prompt 不影响业务逻辑。
      // eslint-disable-next-line no-alert
      window.alert(`复制失败：${String(e?.message ?? e)}`);
    }
  };

  const allData = useMemo(() => ({
    ts: snapshot?.ts ?? null,
    mode: snapshot?.mode ?? null,
    input: snapshot?.input ?? null,
    request: snapshot?.request ?? null,
    response: snapshot?.response ?? null,
    lastError: snapshot?.lastError ?? '',
  }), [snapshot]);

  const activeData = useMemo(() => {
    if (activeTab === 'input') return snapshot?.input ?? null;
    if (activeTab === 'request') return snapshot?.request ?? null;
    return snapshot?.response ?? null;
  }, [activeTab, snapshot]);

  return (
    <section className="mt-3 bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-100 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="min-w-0 text-left">
          <div className="text-[12px] font-black text-slate-700">参数返回框（调试面板）</div>
          <div className="text-[10px] text-slate-500 truncate">
            {snapshot?.mode ? `mode=${snapshot.mode}` : 'mode=--'}
            {tsText ? ` · ts=${tsText}` : ''}
            {snapshot?.lastError ? ` · lastError=${String(snapshot.lastError)}` : ''}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 font-bold">{collapsed ? '展开' : '折叠'}</div>
      </button>

      {!collapsed && (
        <div className="p-4 pt-3 space-y-3">
          <div className="flex items-center gap-2">
            {TAB_ITEMS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={
                  `px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ` +
                  (activeTab === t.key
                    ? 'bg-white border-slate-300 text-slate-700'
                    : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-white')
                }
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}

            <div className="flex-1" />

            <button
              type="button"
              className="px-3 py-1.5 rounded-full text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              onClick={() => onCopy('all', allData)}
              title="一键复制 Input/Request/Response"
            >
              一键复制三段
            </button>
            {copiedKey === 'all' && (
              <span className="text-[10px] text-emerald-600 font-bold">已复制</span>
            )}
          </div>

          <pre className="text-[11px] leading-relaxed bg-white border border-slate-200 rounded-xl p-3 max-h-[260px] overflow-auto">
            {safeJson(activeData)}
          </pre>
        </div>
      )}
    </section>
  );
}
