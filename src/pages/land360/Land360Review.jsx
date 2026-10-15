/**
 * Land360Review.jsx
 *
 * Review panel for a spherical capture session.
 * Shows: captured frame grid, coverage summary, quality warnings,
 * missing targets, retake interface, and readiness status.
 */

import { useState, useMemo } from 'react';
import {
  ChevronLeft, Check, AlertTriangle, XCircle, Camera, RotateCcw,
} from 'lucide-react';
import { CoverageTracker } from '../../lib/land360/CoverageTracker';
import { CoverageValidator } from '../../lib/land360/CoverageValidator';

export default function Land360Review({
  targets,
  frames,
  config,
  onRetake,
  onContinueCapture,
  onBack,
}) {
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [activeTab, setActiveTab] = useState('frames');

  const activeFrames = useMemo(
    () => frames.filter((f) => f.isActive !== false && f.status !== 'replaced'),
    [frames],
  );

  const report = useMemo(
    () => CoverageTracker.generateReport(targets, activeFrames),
    [targets, activeFrames],
  );

  const validation = useMemo(
    () => CoverageValidator.validate(targets, activeFrames, config),
    [targets, activeFrames, config],
  );

  const statusLabel = CoverageTracker.getStatusLabel(report);
  const statusColor =
    statusLabel === 'Ready for stitching'
      ? 'var(--success-color, #22c55e)'
      : statusLabel.includes('progress')
        ? 'var(--primary-color, #6366f1)'
        : 'var(--warning-color, #f59e0b)';

  // ── Tab data ──────────────────────────────────────────────────────

  const tabs = [
    { id: 'frames', label: 'Frames', count: activeFrames.length },
    { id: 'coverage', label: 'Coverage' },
    { id: 'issues', label: 'Issues', count: validation.issues.length },
  ];

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ minHeight: '100vh', background: 'var(--bg-color)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-sm p-md"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <button onClick={onBack} className="p-xs" style={{ background: 'none', border: 'none' }}>
          <ChevronLeft size={24} />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold" style={{ margin: 0 }}>Capture Review</h2>
          <div className="text-xs" style={{ color: statusColor, fontWeight: 600 }}>
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Summary Bar */}
      <div
        className="flex gap-sm p-sm"
        style={{
          background: 'var(--card-bg, var(--bg-color))',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <_StatBadge label="Captured" value={`${report.capturedTargets}/${report.totalTargets}`} />
        <_StatBadge label="Completion" value={`${report.overallTargetCompletion}%`} />
        <_StatBadge
          label="Issues"
          value={validation.issues.length}
          warn={validation.issues.length > 0}
        />
      </div>

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: '1px solid var(--border-color)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 text-center py-sm text-sm font-bold"
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--primary-color)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--primary-color)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span
                style={{
                  marginLeft: 4,
                  fontSize: 10,
                  background: tab.id === 'issues' ? 'var(--warning-color, #f59e0b)' : 'var(--primary-color)',
                  color: '#fff',
                  borderRadius: 99,
                  padding: '1px 6px',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-md" style={{ paddingBottom: 100 }}>
        {activeTab === 'frames' && (
          <_FramesTab
            frames={activeFrames}
            targets={targets}
            selected={selectedFrame}
            onSelect={setSelectedFrame}
            onRetake={onRetake}
          />
        )}
        {activeTab === 'coverage' && <_CoverageTab report={report} />}
        {activeTab === 'issues' && <_IssuesTab validation={validation} onRetake={onRetake} />}
      </div>

      {/* Bottom action */}
      {report.pendingTargets > 0 && (
        <div
          className="p-md"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'var(--bg-color)',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={onContinueCapture}>
            <Camera size={18} style={{ marginRight: 8 }} />
            Continue Capture ({report.pendingTargets} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function _StatBadge({ label, value, warn }) {
  return (
    <div
      className="flex-1 text-center p-xs rounded-lg"
      style={{
        background: warn ? 'rgba(245,158,11,0.1)' : 'var(--bg-color)',
        border: `1px solid ${warn ? 'var(--warning-color, #f59e0b)' : 'var(--border-color)'}`,
      }}
    >
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-secondary">{label}</div>
    </div>
  );
}

function _FramesTab({ frames, targets, selected, onSelect, onRetake }) {
  if (frames.length === 0) {
    return <p className="text-center text-secondary py-lg">No frames captured yet.</p>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {frames.map((frame) => {
        const _target = targets.find(
          (t) => t.id === frame.targetId || t.originalTargetId === frame.targetId,
        );
        const isSelected = selected === frame.id;
        const hasWarning = frame.qualityStatus === 'warning';
        const hasFailed = frame.qualityStatus === 'failed';

        return (
          <div key={frame.id} style={{ position: 'relative' }}>
            <div
              onClick={() => onSelect(isSelected ? null : frame.id)}
              style={{
                aspectRatio: '1',
                borderRadius: 8,
                overflow: 'hidden',
                border: isSelected
                  ? '2px solid var(--primary-color)'
                  : hasFailed
                    ? '2px solid var(--error-color, #ef4444)'
                    : hasWarning
                      ? '2px solid var(--warning-color, #f59e0b)'
                      : '1px solid var(--border-color)',
                cursor: 'pointer',
                background: '#000',
              }}
            >
              {frame.localUri && (
                <img
                  src={frame.localUri}
                  alt={`Frame ${frame.sequenceNumber}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
              {/* Quality badge */}
              {(hasWarning || hasFailed) && (
                <div
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    background: hasFailed ? 'var(--error-color, #ef4444)' : 'var(--warning-color, #f59e0b)',
                    borderRadius: 99,
                    width: 20,
                    height: 20,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AlertTriangle size={12} color="#fff" />
                </div>
              )}
            </div>

            {/* Expanded info */}
            {isSelected && (
              <div
                className="p-xs rounded-lg mt-xs"
                style={{
                  background: 'var(--card-bg, var(--bg-color))',
                  border: '1px solid var(--border-color)',
                  fontSize: 11,
                }}
              >
                <div className="text-xs text-secondary mb-xs">
                  Yaw {Math.round(frame.capturedYaw ?? 0)}° Pitch{' '}
                  {Math.round(frame.capturedPitch ?? 0)}°
                </div>
                {frame.qualityWarnings?.length > 0 && (
                  <div className="text-xs mb-xs" style={{ color: 'var(--warning-color)' }}>
                    {frame.qualityWarnings.map((w, i) => (
                      <div key={i}>⚠ {w.message}</div>
                    ))}
                  </div>
                )}
                <button
                  className="btn btn-secondary text-xs"
                  style={{ width: '100%', padding: '4px 8px', height: 'auto' }}
                  onClick={() => onRetake(frame.targetId)}
                >
                  <RotateCcw size={12} style={{ marginRight: 4 }} /> Retake
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function _CoverageTab({ report }) {
  const regions = [
    { label: 'Upper hemisphere', value: report.upperCoverageEstimate },
    { label: 'Horizon level', value: report.horizonCoverageEstimate },
    { label: 'Lower hemisphere', value: report.lowerCoverageEstimate },
  ];

  return (
    <div className="flex flex-col gap-md">
      {/* Overall progress */}
      <div className="card" style={{ padding: 16 }}>
        <h3 className="mb-sm">Target Completion</h3>
        <div className="flex justify-between text-sm mb-xs">
          <span>
            {report.capturedTargets} / {report.totalTargets} targets
          </span>
          <span className="font-bold">{report.overallTargetCompletion}%</span>
        </div>
        <div
          style={{
            height: 8,
            background: 'var(--bg-color)',
            borderRadius: 99,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${report.overallTargetCompletion}%`,
              height: '100%',
              background: 'var(--primary-color)',
              borderRadius: 99,
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      {/* Region breakdown */}
      <div className="card" style={{ padding: 16 }}>
        <h3 className="mb-md">Region Coverage</h3>
        {regions.map((r) => (
          <div key={r.label} className="flex justify-between items-center mb-sm">
            <span className="text-sm">{r.label}</span>
            <_CoverageBadge value={r.value} />
          </div>
        ))}
      </div>

      {/* Missing regions */}
      {report.missingRegions.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <h3 className="mb-md flex items-center gap-sm">
            <AlertTriangle size={18} className="text-warning" />
            Missing Areas
          </h3>
          {report.missingRegions.map((mr) => (
            <div key={mr.region} className="flex justify-between text-sm mb-xs">
              <span>{mr.description}</span>
              <span className="text-secondary">
                {mr.uncapturedCount} / {mr.totalInRegion} missing
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function _CoverageBadge({ value }) {
  if (value == null) return <span className="text-xs text-secondary">N/A</span>;
  const color =
    value === 100
      ? 'var(--success-color, #22c55e)'
      : value > 0
        ? 'var(--warning-color, #f59e0b)'
        : 'var(--error-color, #ef4444)';
  const label =
    value === 100 ? 'Complete' : value > 0 ? 'In progress' : 'Not started';

  return (
    <span
      className="text-xs font-bold"
      style={{
        color,
        background: `${color}15`,
        padding: '2px 8px',
        borderRadius: 99,
      }}
    >
      {value}% — {label}
    </span>
  );
}

function _IssuesTab({ validation, onRetake }) {
  if (validation.issues.length === 0) {
    return (
      <div className="text-center py-lg">
        <Check size={48} className="text-success mx-auto mb-sm" />
        <p className="font-bold">No issues detected</p>
        <p className="text-sm text-secondary">Capture is ready for stitching.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-sm">
      {validation.issues.map((issue, i) => (
        <div
          key={i}
          className="card flex gap-sm items-start"
          style={{
            padding: 12,
            borderLeft: `3px solid ${issue.severity === 'error' ? 'var(--error-color, #ef4444)' : 'var(--warning-color, #f59e0b)'}`,
          }}
        >
          {issue.severity === 'error' ? (
            <XCircle size={18} style={{ color: 'var(--error-color, #ef4444)', flexShrink: 0, marginTop: 2 }} />
          ) : (
            <AlertTriangle size={18} style={{ color: 'var(--warning-color, #f59e0b)', flexShrink: 0, marginTop: 2 }} />
          )}
          <div className="flex-1">
            <div className="text-sm font-bold">{issue.type.replace(/_/g, ' ')}</div>
            <div className="text-xs text-secondary">{issue.message}</div>
            {issue.targetIds?.length > 0 && (
              <div className="flex gap-xs mt-xs flex-wrap">
                {issue.targetIds.slice(0, 5).map((tid) => (
                  <button
                    key={tid}
                    className="btn btn-secondary text-xs"
                    style={{ padding: '2px 6px', height: 'auto' }}
                    onClick={() => onRetake(tid)}
                  >
                    <RotateCcw size={10} style={{ marginRight: 2 }} /> {tid}
                  </button>
                ))}
                {issue.targetIds.length > 5 && (
                  <span className="text-xs text-secondary">
                    +{issue.targetIds.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
