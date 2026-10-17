import React from 'react';
import { RotateCcw, Home, AlertTriangle } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[7Days Field] Uncaught application error:', error, errorInfo);
  }

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
                padding: '10px 14px',
                margin: '0 0 20px 0',
                maxWidth: '360px',
                width: '100%',
                fontSize: '12px',
                color: '#fca5a5',
                fontFamily: 'monospace',
                textAlign: 'left',
                overflowX: 'auto',
                lineHeight: 1.4,
              }}
            >
              {this.state.error.message || String(this.state.error)}
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
