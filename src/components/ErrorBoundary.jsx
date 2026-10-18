import React from 'react';
import { RotateCcw, Home, AlertTriangle, Copy, Check } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[7Days Field] Uncaught application error:', error, errorInfo);
    this.setState({ errorInfo });
    try {
      const sanitized = {
        message: error?.message || String(error),
        name: error?.name || 'Error',
        stack: error?.stack || null,
        componentStack: errorInfo?.componentStack || null,
        timestamp: new Date().toISOString(),
        url: typeof window !== 'undefined' ? window.location.pathname : '',
      };
      localStorage.setItem('7days_last_crash', JSON.stringify(sanitized));
    } catch (_) {}
  }

  handleCopyDiagnostics = async () => {
    try {
      const details = [
        `Error: ${this.state.error?.message || String(this.state.error)}`,
        `Name: ${this.state.error?.name || 'Error'}`,
        `Time: ${new Date().toISOString()}`,
        `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
        `Stack:\n${this.state.error?.stack || 'No stack'}`,
        `Component Stack:\n${this.state.errorInfo?.componentStack || 'No component stack'}`
      ].join('\n\n');

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(details);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = details;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    } catch (e) {
      console.warn('Failed to copy error details:', e);
    }
  };

  handleReload = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div 
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0b1329',
            color: '#f8fafc',
            padding: '24px',
            textAlign: 'center',
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          <div 
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '20px',
              border: '1px solid rgba(239, 68, 68, 0.3)'
            }}
          >
            <AlertTriangle size={32} color="#ef4444" />
          </div>

          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px 0', color: '#ffffff' }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: '14px', color: '#94a3b8', maxWidth: '340px', lineHeight: 1.5, margin: '0 0 16px 0' }}>
            7Days Field encountered an unexpected state. Your local data and media remain safe in storage.
          </p>

          {this.state.error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '8px',
                padding: '12px 14px',
                margin: '0 0 20px 0',
                maxWidth: '440px',
                width: '100%',
                fontSize: '11px',
                color: '#fca5a5',
                fontFamily: 'monospace',
                textAlign: 'left',
                overflowX: 'auto',
                lineHeight: 1.4,
                maxHeight: '260px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid rgba(239, 68, 68, 0.2)', paddingBottom: '6px' }}>
                <span style={{ fontWeight: 'bold', color: '#f87171' }}>Diagnostic Details</span>
                <button
                  type="button"
                  onClick={this.handleCopyDiagnostics}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#f8fafc',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  {this.state.copied ? <><Check size={11} color="#10b981" /> Copied</> : <><Copy size={11} /> Copy</>}
                </button>
              </div>

              <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#ffffff' }}>
                {this.state.error.message || String(this.state.error)}
              </div>
              {this.state.error.stack && (
                <div style={{ fontSize: '10px', color: '#cbd5e1', opacity: 0.9, marginBottom: '6px' }}>
                  {this.state.error.stack}
                </div>
              )}
              {this.state.errorInfo?.componentStack && (
                <div style={{ fontSize: '9px', color: '#94a3b8', borderTop: '1px dashed rgba(255, 255, 255, 0.1)', paddingTop: '4px' }}>
                  {this.state.errorInfo.componentStack}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', width: '100%', maxWidth: '320px' }}>
            <button
              onClick={this.handleReload}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <RotateCcw size={16} /> Reload App
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                fontWeight: 600,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <Home size={16} /> Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
