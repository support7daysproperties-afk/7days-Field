/**
 * Land360Review.jsx
 *
 * Review interface for a completed or in-progress spherical capture session.
 * Displays:
 * 1. Summary stats (captured points, percentage, coverage, quality status).
 * 2. Captured frames gallery with orientation metadata and retake button.
 * 3. Spherical coverage breakdown across zenith, horizon, and nadir tiers.
 * 4. Issue validation list identifying gaps or motion blur.
 */

import { useState, useMemo } from 'react';
import {
  ChevronLeft,
  Check,
  AlertTriangle,
  XCircle,
  Camera,
  RotateCcw,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { CoverageTracker } from '../../lib/land360/CoverageTracker';
import { CoverageValidator } from '../../lib/land360/CoverageValidator';

export default function Land360Review({
  targets = [],
  frames = [],
  config,
  onRetake,
  onContinueCapture,
  onBack,
}) {
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [activeTab, setActiveTab] = useState('frames');

  const activeFrames = useMemo(
    () => frames.filter((f) => f.isActive !== false && f.status !== 'replaced'),
    [frames]
  );

  const report = useMemo(
    () => CoverageTracker.generateReport(targets, activeFrames),
    [targets, activeFrames]
  );

  const validation = useMemo(
    () => CoverageValidator.validate(targets, activeFrames, config),
    [targets, activeFrames, config]
  );

  const statusLabel = CoverageTracker.getStatusLabel(report);
  const isReady = report.canProceedToStitching;

  const tabs = [
    { id: 'frames', label: 'Frames', count: activeFrames.length },
    { id: 'coverage', label: 'Coverage' },
    { id: 'issues', label: 'Issues', count: validation.issues.length },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-color, #0f1115)',
        color: 'var(--text-primary, #ffffff)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── Top Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-color, #334155)',
          backgroundColor: 'var(--surface-color, #1a1d24)',
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label="Back"
        >
          <ChevronLeft size={24} />
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            360° Sphere Review
          </h2>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: isReady ? 'var(--success-color, #10b981)' : 'var(--warning-color, #f59e0b)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 2,
            }}
          >
            {isReady ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {statusLabel}
          </div>
        </div>
      </div>

      {/* ── Stat Badges ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          padding: '12px 16px',
          backgroundColor: 'var(--surface-color, #1a1d24)',
          borderBottom: '1px solid var(--border-color, #334155)',
        }}
      >
        <StatCard label="Captured" value={`${report.capturedTargets} / ${report.totalTargets}`} />
        <StatCard label="Coverage" value={`${report.overallTargetCompletion}%`} />
        <StatCard
          label="Issues"
          value={validation.issues.length}
          isWarning={validation.issues.length > 0}
        />
      </div>

      {/* ── Tabs Navigation ── */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-color, #334155)',
          backgroundColor: 'var(--surface-color, #1a1d24)',
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: '12px 0',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--primary-color, #3b82f6)' : '2px solid transparent',
                color: isActive ? 'var(--primary-color, #3b82f6)' : 'var(--text-secondary, #94a3b8)',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {tab.label}
              {tab.count != null && (
                <span
                  style={{
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 9999,
                    backgroundColor:
                      tab.id === 'issues' && tab.count > 0
                        ? 'var(--warning-color, #f59e0b)'
                        : 'rgba(255, 255, 255, 0.1)',
                    color: tab.id === 'issues' && tab.count > 0 ? '#000' : 'inherit',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ── */}
      <div style={{ flex: 1, padding: '16px', paddingBottom: 110, overflowY: 'auto' }}>
        {activeTab === 'frames' && (
          <FramesGrid
            frames={activeFrames}
            targets={targets}
            selectedFrame={selectedFrame}
            onSelectFrame={setSelectedFrame}
            onRetake={onRetake}
          />
        )}
        {activeTab === 'coverage' && <CoverageBreakdown report={report} />}
        {activeTab === 'issues' && (
          <IssuesList validation={validation} onRetake={onRetake} />
        )}
      </div>

      {/* ── Fixed Bottom Actions ── */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '16px 20px',
          backgroundColor: 'var(--surface-color, #1a1d24)',
          borderTop: '1px solid var(--border-color, #334155)',
          display: 'flex',
          gap: 12,
          zIndex: 20,
        }}
      >
        {report.pendingTargets > 0 ? (
          <button
            onClick={onContinueCapture}
            className="btn btn-primary"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '14px',
              borderRadius: 12,
              fontWeight: 600,
            }}
          >
            <Camera size={20} />
            Continue Capture ({report.pendingTargets} remaining)
          </button>
        ) : (
          <button
            onClick={onBack}
            className="btn btn-primary"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '14px',
              borderRadius: 12,
              fontWeight: 600,
            }}
          >
            <Check size={20} />
            Complete & Save Sphere
          </button>
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function StatCard({ label, value, isWarning = false }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-color, #0f1115)',
        border: `1px solid ${isWarning ? 'var(--warning-color, #f59e0b)' : 'var(--border-color, #334155)'}`,
        borderRadius: 8,
        padding: '10px 8px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary, #94a3b8)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function FramesGrid({ frames, targets, selectedFrame, onSelectFrame, onRetake }) {
  if (frames.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-secondary)' }}>
        <Camera size={44} style={{ opacity: 0.4, marginBottom: 12 }} />
        <p>No photos captured yet.</p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10,
      }}
    >
      {frames.map((frame) => {
        const isSelected = selectedFrame === frame.id;
        const hasWarning = frame.qualityStatus === 'warning';
        const hasFailed = frame.qualityStatus === 'failed';

        return (
          <div key={frame.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              onClick={() => onSelectFrame(isSelected ? null : frame.id)}
              style={{
                position: 'relative',
                aspectRatio: '1',
                borderRadius: 10,
                overflow: 'hidden',
                backgroundColor: '#000',
                cursor: 'pointer',
                border: isSelected
                  ? '2.5px solid var(--primary-color, #3b82f6)'
                  : hasFailed
                  ? '2px solid var(--danger-color, #ef4444)'
                  : hasWarning
                  ? '2px solid var(--warning-color, #f59e0b)'
                  : '1px solid var(--border-color, #334155)',
              }}
            >
              {frame.localUri && (
                <img
                  src={frame.localUri}
                  alt={`Frame ${frame.sequenceNumber}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}

              {(hasWarning || hasFailed) && (
                <div
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    backgroundColor: hasFailed ? 'var(--danger-color, #ef4444)' : 'var(--warning-color, #f59e0b)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AlertTriangle size={11} color="#ffffff" />
                </div>
              )}
            </div>

            {isSelected && (
              <div
                style={{
                  marginTop: 6,
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor: 'var(--surface-color, #1a1d24)',
                  border: '1px solid var(--border-color, #334155)',
                  fontSize: 11,
                }}
              >
                <div>Yaw: {Math.round(frame.capturedYaw ?? 0)}°</div>
                <div>Pitch: {Math.round(frame.capturedPitch ?? 0)}°</div>
                <button
                  onClick={() => onRetake(frame.targetId)}
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    marginTop: 6,
                    padding: '4px',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                  }}
                >
                  <RotateCcw size={12} /> Retake
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CoverageBreakdown({ report }) {
  const tiers = [
    { label: 'Zenith / Sky (Above)', value: report.upperCoverageEstimate },
    { label: 'Horizon Level (Surrounding)', value: report.horizonCoverageEstimate },
    { label: 'Nadir / Ground (Below)', value: report.lowerCoverageEstimate },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Spherical Tiers</h3>
        {tiers.map((tier) => (
          <div
            key={tier.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <span style={{ fontSize: 14 }}>{tier.label}</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: tier.value === 100 ? 'var(--success-color)' : 'var(--warning-color)',
              }}
            >
              {tier.value}%
            </span>
          </div>
        ))}
      </div>

      {report.missingRegions?.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 16, marginBottom: 8, color: 'var(--warning-color)' }}>
            Missing Spherical Regions
          </h3>
          {report.missingRegions.map((mr) => (
            <div key={mr.region} style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0' }}>
              • {mr.description}: {mr.uncapturedCount} uncaptured
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IssuesList({ validation, onRetake }) {
  if (validation.issues.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px' }}>
        <CheckCircle2 size={48} color="var(--success-color, #10b981)" style={{ marginBottom: 12 }} />
        <h4>All Frames Passed Quality Checks</h4>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          No excessive blur, underexposure, or missing coverage detected.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {validation.issues.map((issue, i) => (
        <div
          key={i}
          className="card"
          style={{
            padding: 14,
            borderLeft: `4px solid ${issue.severity === 'error' ? 'var(--danger-color)' : 'var(--warning-color)'}`,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>{issue.type}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {issue.message}
          </div>
          {issue.targetIds?.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {issue.targetIds.map((tid) => (
                <button
                  key={tid}
                  onClick={() => onRetake(tid)}
                  className="btn btn-secondary"
                  style={{ padding: '3px 8px', fontSize: 11 }}
                >
                  Retake {tid}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
