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
  <React.StrictMode>
    <GlobalErrorCatcher>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </GlobalErrorCatcher>
  </React.StrictMode>
)
