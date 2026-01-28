import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
  }

  render() {
    const error = this.state.error;
    const info = this.state.info;
    if (!error) return this.props.children;

    const details = String(error?.stack || error?.message || error);
    const comp = String(info?.componentStack || '');

    return (
      <div style={{ padding: 16, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
        <div style={{ fontWeight: 900, color: '#b91c1c' }}>页面渲染失败（已捕获）</div>
        <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, color: '#0f172a', background: '#f8fafc', border: '1px solid #e2e8f0', padding: 12, borderRadius: 8 }}>
{details}
        </pre>
        {comp && (
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, color: '#334155', background: '#fff', border: '1px solid #e2e8f0', padding: 12, borderRadius: 8 }}>
{comp}
          </pre>
        )}
        <div style={{ marginTop: 12, color: '#64748b', fontSize: 12 }}>
          提示：请把上述错误内容发我，我会按行修复。
        </div>
      </div>
    );
  }
}

function GlobalErrorCatcher({ children }) {
  const [fatal, setFatal] = useState(null);

  useEffect(() => {
    const onError = (event) => {
      const err = event?.error || event?.message || event;

      // 过滤：React 18 + HMR/StrictMode 场景下偶发的 DOM 删除竞态。
      // 该错误通常来自 ReactDOM 的 commitDeletionEffects，显示为：
      // NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.
      // 这类错误会被我们全局捕获器误判为“致命”，从而直接把页面切到 fatal UI。
      // 这里选择忽略它，让应用继续运行（控制台仍可看到错误）。
      try {
        const msg = String(err?.message || err || '');
        const name = String(err?.name || '');
        const stack = String(err?.stack || '');
        const isReactRemoveChild = (name === 'NotFoundError' || msg.includes('NotFoundError'))
          && msg.includes("removeChild")
          && msg.includes('not a child')
          && (stack.includes('commitDeletionEffects') || stack.includes('removeChildFromContainer'));
        if (isReactRemoveChild) return;
      } catch {
        // ignore
      }

      setFatal({ kind: 'error', err });
    };
    const onRejection = (event) => {
      setFatal({ kind: 'rejection', err: event?.reason || event });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (!fatal) return children;

  const details = String(fatal?.err?.stack || fatal?.err?.message || fatal?.err);
  return (
    <div style={{ padding: 16, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
      <div style={{ fontWeight: 900, color: '#b91c1c' }}>
        页面运行时异常（{fatal.kind === 'rejection' ? 'Promise 未处理' : '全局错误'}）
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, color: '#0f172a', background: '#f8fafc', border: '1px solid #e2e8f0', padding: 12, borderRadius: 8 }}>
{details}
      </pre>
      <div style={{ marginTop: 12, color: '#64748b', fontSize: 12 }}>
        提示：请把上述错误内容发我，我会按行修复。
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <GlobalErrorCatcher>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </GlobalErrorCatcher>
)
