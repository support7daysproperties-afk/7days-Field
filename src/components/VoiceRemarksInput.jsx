import { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  Square, 
  RotateCcw, 
  AlertCircle, 
  Check, 
  Undo2, 
  Loader2, 
  Volume2, 
  WifiOff, 
  X
} from 'lucide-react';
import speechRecognitionService, { 
  mergeRemarks 
} from '../services/platform/SpeechRecognitionService';

export default function VoiceRemarksInput({
  value = '',
  onChange = () => {},
  placeholder = 'Add any issues or observations...',
  rows = 5,
  id = 'remarks-textarea'
}) {
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    try {
      const saved = localStorage.getItem('7days_voice_language');
      return (saved === 'en-IN' || saved === 'ta-IN') ? saved : 'ta-IN';
    } catch (_) {
      return 'ta-IN';
    }
  });

  const [recognitionState, setRecognitionState] = useState('idle'); // 'idle' | 'starting' | 'listening' | 'processing' | 'error'
  const [interimTranscript, setInterimTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);
  const [isOfflineError, setIsOfflineError] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [unsupportedReason, setUnsupportedReason] = useState(null);
  const [insertMode, setInsertMode] = useState('append'); // 'append' | 'replace'
  const [undoHistory, setUndoHistory] = useState(null); // stores previous value for 1-click undo
  const [successNotice, setSuccessNotice] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const textareaRef = useRef(null);
  const successTimeoutRef = useRef(null);
  const previousValueRef = useRef(value);

  // Check speech recognition capability on mount
  useEffect(() => {
    let isMounted = true;
    const checkCapability = async () => {
      try {
        const capability = await speechRecognitionService.isAvailable();
        if (isMounted) {
          setIsSupported(capability.supported);
          if (!capability.supported) {
            setUnsupportedReason(capability.reason || 'Speech recognition not supported in this browser');
          }
        }
      } catch (err) {
        if (isMounted) {
          setIsSupported(false);
          setUnsupportedReason('Unable to check speech recognition capability');
        }
      }
    };
    checkCapability();

    return () => {
      isMounted = false;
      speechRecognitionService.cancel().catch(() => {});
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const handleLanguageSelect = (newLang) => {
    if (isListening) return;
    setSelectedLanguage(newLang);
    try {
      localStorage.setItem('7days_voice_language', newLang);
    } catch (_) {}
  };

  const handleStartListening = async () => {
    setErrorMessage(null);
    setIsPermissionDenied(false);
    setIsOfflineError(false);
    setInterimTranscript('');
    setAudioLevel(0);

    // Save previous value for safe undo
    previousValueRef.current = value;

    try {
      await speechRecognitionService.start({
        language: selectedLanguage,
        onStateChange: (state) => {
          setRecognitionState(state);
        },
        onPartial: (partial) => {
          setInterimTranscript(partial);
        },
        onRms: (rms) => {
          // Normalize rms to 0-100 range for pulsing indicator
          const normalized = Math.min(Math.max((rms + 2) * 12, 0), 100);
          setAudioLevel(normalized);
        },
        onFinal: (finalTranscript) => {
          setInterimTranscript('');
          if (!finalTranscript || !finalTranscript.trim()) {
            setRecognitionState('idle');
            return;
          }

          const updatedValue = mergeRemarks(previousValueRef.current, finalTranscript, insertMode);
          onChange(updatedValue);

          // Record undo history
          setUndoHistory({
            previous: previousValueRef.current,
            transcript: finalTranscript
          });

          setSuccessNotice(`Added: "${finalTranscript.slice(0, 45)}${finalTranscript.length > 45 ? '...' : ''}"`);
          if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
          successTimeoutRef.current = setTimeout(() => {
            setSuccessNotice(null);
          }, 7000);

          setRecognitionState('idle');
        },
        onError: (err) => {
          setInterimTranscript('');
          setErrorMessage(err.message || 'Speech recognition failed');
          setIsPermissionDenied(Boolean(err.isPermissionDenied));
          setIsOfflineError(Boolean(err.isOffline));
          setRecognitionState('error');
        }
      });
    } catch (err) {
      setRecognitionState('error');
      setErrorMessage(err.message || 'Could not start microphone');
    }
  };

  const handleStopListening = async () => {
    setRecognitionState('processing');
    try {
      await speechRecognitionService.stop();
    } catch (err) {
      setRecognitionState('idle');
    }
  };

  const handleCancelListening = async () => {
    setInterimTranscript('');
    setRecognitionState('idle');
    try {
      await speechRecognitionService.cancel();
    } catch (_) {}
  };

  const handleUndo = () => {
    if (undoHistory !== null) {
      onChange(undoHistory.previous);
      setUndoHistory(null);
      setSuccessNotice(null);
    }
  };

  const isListening = recognitionState === 'listening';
  const isProcessing = recognitionState === 'processing';
  const isStarting = recognitionState === 'starting';

  return (
    <div className="voice-remarks-container" style={{ width: '100%' }}>
      {/* 1. Main Multiline Text Area (Always fully editable) */}
      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          id={id}
          className="form-textarea mb-sm"
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            previousValueRef.current = e.target.value;
          }}
          style={{
            minHeight: '130px',
            resize: 'vertical',
            lineHeight: 1.5,
            borderColor: isListening ? 'var(--primary-color)' : undefined,
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            boxShadow: isListening ? '0 0 0 1px var(--primary-color)' : undefined
          }}
        />

        {/* Character count & status badge */}
        <div 
          style={{ 
            position: 'absolute', 
            bottom: '16px', 
            right: '12px', 
            fontSize: '11px', 
            color: 'var(--text-tertiary)',
            pointerEvents: 'none'
          }}
        >
          {value ? `${value.length} chars` : ''}
        </div>
      </div>

      {/* 2. Live Interim Preview Banner while speaking */}
      {isListening && interimTranscript && (
        <div 
          className="animate-fade-in"
          style={{
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            border: '1px solid var(--primary-border)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
          }}
        >
          <Volume2 size={16} className="text-primary" style={{ marginTop: '2px', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary-light)', fontWeight: 600 }}>
              {selectedLanguage === 'ta-IN' ? 'தமிழ் நேரடி பதிவு (Listening Live)' : 'Listening Live...'}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginTop: '2px', fontStyle: 'italic', wordBreak: 'break-word' }}>
              "{interimTranscript}"
            </div>
          </div>
        </div>
      )}

      {/* 3. Processing State Banner */}
      {isProcessing && (
        <div
          style={{
            backgroundColor: 'var(--surface-raised)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          <Loader2 size={16} className="animate-spin text-primary" />
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {selectedLanguage === 'ta-IN' 
              ? 'பதிவு இறுதி செய்யப்படுகிறது... (Finalizing observation transcript...)'
              : 'Finalizing observation transcript...'}
          </span>
        </div>
      )}

      {/* 4. Error & Warning Messages */}
      {errorMessage && (
        <div
          className="animate-fade-in"
          style={{
            backgroundColor: isOfflineError ? 'rgba(148, 163, 184, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            border: `1px solid ${isOfflineError ? 'var(--offline-border)' : 'var(--danger-border)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '10px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: 1 }}>
            {isOfflineError ? (
              <WifiOff size={16} style={{ color: 'var(--offline-color)', marginTop: '2px', flexShrink: 0 }} />
            ) : (
              <AlertCircle size={16} style={{ color: 'var(--danger-color)', marginTop: '2px', flexShrink: 0 }} />
            )}
            <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
              {errorMessage}
              {isPermissionDenied && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Tip: Check microphone permissions in your device/browser settings.
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={handleStartListening}
              className="btn btn-sm btn-outline"
              style={{
                padding: '4px 8px',
                minHeight: '28px',
                fontSize: '12px',
                whiteSpace: 'nowrap'
              }}
            >
              <RotateCcw size={12} /> Retry
            </button>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                padding: '4px'
              }}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* 5. Success Notice with One-Click Undo */}
      {successNotice && !isListening && (
        <div
          className="animate-fade-in"
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid var(--success-border)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <Check size={15} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
            <span style={{ fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {successNotice}
            </span>
          </div>
          {undoHistory && (
            <button
              type="button"
              onClick={handleUndo}
              className="btn btn-sm"
              style={{
                backgroundColor: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                padding: '2px 8px',
                minHeight: '26px',
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Undo2 size={12} /> Undo
            </button>
          )}
        </div>
      )}

      {/* 6. Primary Voice Control Bar */}
      <div 
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 12px'
        }}
      >
        {/* Left: Speak / Stop Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 200px' }}>
          {!isListening && !isStarting && !isProcessing ? (
            <button
              type="button"
              id="btn-speak-remarks"
              onClick={handleStartListening}
              disabled={!isSupported}
              className="btn btn-secondary"
              style={{
                width: 'auto',
                minWidth: '160px',
                minHeight: '44px',
                backgroundColor: 'var(--surface-raised)',
                border: '1px solid var(--primary-border)',
                color: 'var(--text-primary)',
                padding: '8px 16px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: 600
              }}
            >
              <Mic size={18} className="text-primary" />
              <span>{selectedLanguage === 'ta-IN' ? 'பேச தொடங்கு' : 'Speak Remarks'}</span>
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
              <button
                type="button"
                id="btn-stop-speak-remarks"
                onClick={handleStopListening}
                className="btn"
                style={{
                  width: 'auto',
                  minHeight: '44px',
                  backgroundColor: 'var(--danger-color)',
                  color: '#ffffff',
                  padding: '8px 16px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 600,
                  boxShadow: '0 2px 10px rgba(239, 68, 68, 0.4)'
                }}
              >
                <Square size={16} fill="currentColor" />
                <span>{selectedLanguage === 'ta-IN' ? 'நிறுத்து (Stop)' : 'Stop'}</span>
              </button>

              <button
                type="button"
                onClick={handleCancelListening}
                className="btn btn-secondary btn-sm"
                style={{
                  minHeight: '44px',
                  padding: '8px 12px',
                  fontSize: '12px'
                }}
                title="Cancel recording without saving"
              >
                Cancel
              </button>

              {/* Listening animated pulse indicator */}
              <div 
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)'
                }}
              >
                <div 
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--danger-color)',
                    boxShadow: `0 0 ${6 + Math.round(audioLevel / 10)}px var(--danger-color)`,
                    transform: `scale(${1 + (audioLevel / 200)})`,
                    transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                    animation: audioLevel > 5 ? 'none' : 'pulse 1s infinite'
                  }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500 }}>
                  {selectedLanguage === 'ta-IN' ? 'கேட்கிறது...' : 'Listening...'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Language Toggle & Mode Settings */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Tamil / English Segmented Toggle */}
          <div 
            className="lang-segmented-toggle"
            role="radiogroup" 
            aria-label="Recognition Language"
            style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              backgroundColor: 'var(--surface-light)',
              padding: '3px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              gap: '2px'
            }}
          >
            <button
              type="button"
              role="radio"
              id="toggle-lang-ta"
              aria-checked={selectedLanguage === 'ta-IN'}
              onClick={() => handleLanguageSelect('ta-IN')}
              disabled={isListening}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: selectedLanguage === 'ta-IN' ? 'var(--primary-color)' : 'transparent',
                color: selectedLanguage === 'ta-IN' ? '#ffffff' : 'var(--text-secondary)',
                cursor: isListening ? 'not-allowed' : 'pointer',
                fontWeight: selectedLanguage === 'ta-IN' ? 700 : 500,
                fontSize: '13px',
                fontFamily: 'var(--font-main)',
                transition: 'all 0.15s ease',
                boxShadow: selectedLanguage === 'ta-IN' ? '0 1px 4px rgba(37, 99, 235, 0.4)' : 'none'
              }}
            >
              தமிழ்
            </button>
            <button
              type="button"
              role="radio"
              id="toggle-lang-en"
              aria-checked={selectedLanguage === 'en-IN'}
              onClick={() => handleLanguageSelect('en-IN')}
              disabled={isListening}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: selectedLanguage === 'en-IN' ? 'var(--primary-color)' : 'transparent',
                color: selectedLanguage === 'en-IN' ? '#ffffff' : 'var(--text-secondary)',
                cursor: isListening ? 'not-allowed' : 'pointer',
                fontWeight: selectedLanguage === 'en-IN' ? 700 : 500,
                fontSize: '13px',
                fontFamily: 'var(--font-main)',
                transition: 'all 0.15s ease',
                boxShadow: selectedLanguage === 'en-IN' ? '0 1px 4px rgba(37, 99, 235, 0.4)' : 'none'
              }}
            >
              English
            </button>
          </div>

          {/* Append vs Replace Toggle (Only relevant when remarks already contains text) */}
          {value.trim().length > 0 && !isListening && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: 'var(--surface-light)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                padding: '2px',
                fontSize: '11px'
              }}
              title={insertMode === 'append' ? 'Voice adds to existing text' : 'Voice replaces existing text'}
            >
              <button
                type="button"
                onClick={() => setInsertMode('append')}
                style={{
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  backgroundColor: insertMode === 'append' ? 'var(--primary-color)' : 'transparent',
                  color: insertMode === 'append' ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: insertMode === 'append' ? 600 : 400,
                  fontSize: '11px'
                }}
              >
                Append
              </button>
              <button
                type="button"
                onClick={() => setInsertMode('replace')}
                style={{
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  backgroundColor: insertMode === 'replace' ? 'var(--primary-color)' : 'transparent',
                  color: insertMode === 'replace' ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: insertMode === 'replace' ? 600 : 400,
                  fontSize: '11px'
                }}
              >
                Replace
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 7. Unsupported Browser / Device Banner */}
      {!isSupported && (
        <div 
          style={{ 
            fontSize: '12px', 
            color: 'var(--text-tertiary)', 
            marginTop: '8px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px' 
          }}
        >
          <MicOff size={13} />
          <span>{unsupportedReason}. You can continue typing observations manually.</span>
        </div>
      )}

      {/* 8. Privacy & Field Guidance Note */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: 'var(--text-tertiary)',
          marginTop: '6px',
          padding: '0 2px'
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <span>🔒 Speech processed securely on device / system service.</span>
        </span>
        <span>Manual typing always available</span>
      </div>
    </div>
  );
}
