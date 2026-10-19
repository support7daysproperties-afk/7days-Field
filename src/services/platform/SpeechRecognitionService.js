import { registerPlugin, Capacitor } from '@capacitor/core';

// Native plugin registration for Android
const NativeSpeechRecognition = registerPlugin('SpeechRecognition');

// Curated domain vocabulary for property inspection in Tamil & English
export const TAMIL_PROPERTY_TERMS = [
  'நிலம்', 'எல்லை', 'சாலை', 'சாலை வசதி', 'வேலி', 'பட்டா', 'சிட்டா',
  'சர்வே எண்', 'வடக்கு', 'தெற்கு', 'கிழக்கு', 'மேற்கு',
  'ஏக்கர்', 'சென்ட்', 'சதுர அடி', 'கிணறு', 'போர்வெல்',
  'மின் இணைப்பு', 'மின்சாரம்', 'காம்பவுண்ட் சுவர்', 'முள்வேலி',
  'வழித்தடம்', 'அளவீடு', 'அங்கீகரிக்கப்பட்ட மனை', 'விவசாய நிலம்',
  'குடியிருப்பு மனை', 'கதவு எண்', 'உரிமையாளர்'
];

export const ENGLISH_PROPERTY_TERMS = [
  'survey number', 'patta', 'chitta', 'FMB', 'adangal',
  'boundary', 'boundary marker', 'stone marker', 'pillar', 'fence', 'fencing', 'barbed wire',
  'compound wall', 'gate', 'road access', 'tar road', 'panchayat road', 'pathway',
  'north', 'south', 'east', 'west',
  'acres', 'cents', 'sq ft', 'square feet', 'guntas',
  'borewell', 'open well', 'EB connection', 'transformer', 'high tension line',
  'encroachment', 'tree plantation', 'residential plot', 'agricultural land',
  'clear title', 'possession', 'owner verified', 'dimensions'
];

export const PROPERTY_DOMAIN_TERMS = [
  ...TAMIL_PROPERTY_TERMS,
  ...ENGLISH_PROPERTY_TERMS
];

export const SUPPORTED_LANGUAGES = [
  { code: 'ta-IN', label: 'தமிழ்', localized: 'தமிழ்' },
  { code: 'en-IN', label: 'English', localized: 'English' }
];

/**
 * Normalizes and formats raw speech transcript with proper casing,
 * property units and clean punctuation, respecting Tamil Unicode and Tanglish.
 */
export function formatObservationTranscript(rawText, lang = 'ta-IN') {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText.trim();
  if (!text) return '';

  if (lang === 'ta-IN') {
    // Preserve Tamil Unicode script intact.
    // Clean up spacing around Tamil punctuation and English loanwords in Tanglish
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\bsurvey\s+no\.?\s*(\d+)/gi, 'Survey No. $1')
      .replace(/\bsurvey\s+number\s*(\d+)/gi, 'Survey No. $1')
      .replace(/சர்வே\s+எண்\s*(\d+)/g, 'சர்வே எண் $1');
  } else if (lang && lang.startsWith('en')) {
    // English casing and standardization
    text = text.charAt(0).toUpperCase() + text.slice(1);
    text = text
      .replace(/\b(\d+)\s*(square\s*feet|sq\.?\s*ft\.?|sqft)\b/gi, '$1 sq ft')
      .replace(/\b(\d+)\s*(acres?)\b/gi, '$1 acre')
      .replace(/\b(\d+)\s*(cents?)\b/gi, '$1 cent')
      .replace(/\bsurvey\s+no\.?\s*(\d+)/gi, 'Survey No. $1')
      .replace(/\bsurvey\s+number\s*(\d+)/gi, 'Survey No. $1');
  }

  // Ensure trailing punctuation if it doesn't already have one
  if (!/[.!?,|]$/.test(text)) {
    text += '.';
  }

  return text;
}

/**
 * Safely merges a new transcript into existing remarks.
 * Guarantees no existing text is silently overwritten unless explicit replace mode is requested.
 */
export function mergeRemarks(existingRemarks, newTranscript, mode = 'append') {
  const cleanTranscript = (newTranscript || '').trim();
  if (!cleanTranscript) return existingRemarks || '';

  const cleanExisting = (existingRemarks || '').trim();
  if (!cleanExisting || mode === 'replace') {
    return cleanTranscript;
  }

  // Append with double newline for clean readability in field reports
  return `${cleanExisting}\n\n${cleanTranscript}`;
}

export class SpeechRecognitionService {
  constructor() {
    this.activeRecognition = null;
    this.nativeListeners = [];
    this.isListening = false;
    this.isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
  }

  /**
   * Checks whether speech recognition is available in the current environment
   * (Native Android SpeechRecognizer or Browser Web Speech API).
   */
  async isAvailable() {
    if (this.isNative) {
      try {
        const res = await NativeSpeechRecognition.isAvailable();
        return {
          supported: Boolean(res && res.available),
          isNative: true,
          isOfflineAvailable: Boolean(res && res.onDeviceAvailable),
          reason: res && res.available ? null : 'Native speech recognition service unavailable on device'
        };
      } catch (err) {
        return {
          supported: false,
          isNative: true,
          isOfflineAvailable: false,
          reason: err?.message || 'Native speech recognition plugin unavailable'
        };
      }
    }

    // Web Platform Check
    if (typeof window !== 'undefined') {
      const hasWebSpeech = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
      return {
        supported: hasWebSpeech,
        isNative: false,
        isOfflineAvailable: false, // Chrome/Edge Web Speech API requires network connection
        reason: hasWebSpeech ? null : 'Web Speech API is not supported in this browser'
      };
    }

    return {
      supported: false,
      isNative: false,
      isOfflineAvailable: false,
      reason: 'Environment does not support speech recognition'
    };
  }

  /**
   * Requests necessary microphone permissions.
   */
  async requestPermission() {
    if (this.isNative) {
      try {
        const perm = await NativeSpeechRecognition.requestPermissions();
        return perm?.audio === 'granted';
      } catch (err) {
        console.warn('Native permission request error:', err);
        return false;
      }
    }

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Release stream immediately; Web Speech API accesses audio directly
        stream.getTracks().forEach(track => track.stop());
        return true;
      } catch (err) {
        console.warn('Browser microphone permission error:', err);
        return false;
      }
    }

    return true;
  }

  /**
   * Starts speech recognition session.
   * Dispatches callbacks for partial live preview, final transcribed text, state updates, and errors.
   */
  async start({
    language = 'ta-IN',
    onPartial = () => {},
    onFinal = () => {},
    onError = () => {},
    onStateChange = () => {},
    onRms = () => {}
  } = {}) {
    // If already active, cancel previous session first
    if (this.isListening) {
      await this.cancel();
    }

    // Check offline state
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    // 1. Native Android Implementation
    if (this.isNative) {
      try {
        onStateChange('starting');

        // Clean up any stale listeners
        await this._cleanupNativeListeners();

        const readyListener = await NativeSpeechRecognition.addListener('ready', () => {
          onStateChange('listening');
        });
        const listeningListener = await NativeSpeechRecognition.addListener('listening', () => {
          onStateChange('listening');
        });
        const rmsListener = await NativeSpeechRecognition.addListener('rms', (data) => {
          if (data && typeof data.rmsdB === 'number') {
            onRms(data.rmsdB);
          }
        });
        const partialListener = await NativeSpeechRecognition.addListener('partialResults', (data) => {
          if (data && data.transcript) {
            onPartial(data.transcript);
          }
        });
        const finalListener = await NativeSpeechRecognition.addListener('finalResults', (data) => {
          this.isListening = false;
          onStateChange('processing');
          const formatted = formatObservationTranscript(data?.transcript || '', language);
          onFinal(formatted);
          onStateChange('idle');
          this._cleanupNativeListeners();
        });
        const endListener = await NativeSpeechRecognition.addListener('endOfSpeech', () => {
          onStateChange('processing');
        });
        const errorListener = await NativeSpeechRecognition.addListener('error', (errData) => {
          this.isListening = false;
          onStateChange('error');
          let message = errData?.message || 'Speech recognition failed';
          const isNetworkError = errData?.code === 'NETWORK_ERROR' || errData?.code === 'NETWORK_TIMEOUT';
          if (isNetworkError && isOffline) {
            message = 'Offline: On-device offline language model not installed. Please connect to internet or type manually.';
          }
          onError({
            code: errData?.code || 'RECOGNITION_ERROR',
            message,
            isPermissionDenied: errData?.code === 'PERMISSION_DENIED',
            isOffline: isNetworkError
          });
          this._cleanupNativeListeners();
        });

        this.nativeListeners = [
          readyListener,
          listeningListener,
          rmsListener,
          partialListener,
          finalListener,
          endListener,
          errorListener
        ];

        await NativeSpeechRecognition.start({
          language,
          partialResults: true
        });

        this.isListening = true;
        return;
      } catch (err) {
        this.isListening = false;
        onStateChange('error');
        onError({
          code: 'START_FAILED',
          message: err?.message || 'Failed to start speech recognition on Android',
          isPermissionDenied: err?.message?.toLowerCase().includes('permission')
        });
        await this._cleanupNativeListeners();
        return;
      }
    }

    // 2. Web Browser Implementation (Web Speech API)
    if (typeof window === 'undefined') {
      onError({ code: 'UNSUPPORTED', message: 'Window object not found' });
      return;
    }

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      onStateChange('error');
      onError({
        code: 'NOT_SUPPORTED',
        message: 'Speech recognition is not supported in this browser. Please use Chrome/Edge or type remarks manually.'
      });
      return;
    }

    if (isOffline) {
      onStateChange('error');
      onError({
        code: 'NETWORK_ERROR',
        message: 'Speech recognition requires an internet connection in this browser. You can type remarks manually.',
        isOffline: true
      });
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      this.activeRecognition = recognition;

      recognition.lang = language;
      recognition.continuous = false; // Capture complete sentence/observation chunk
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      // Add property domain vocabulary grammar list if supported
      const GrammarListClass = window.SpeechGrammarList || window.webkitSpeechGrammarList;
      if (GrammarListClass) {
        try {
          const grammarList = new GrammarListClass();
          const grammar = `#JSGF V1.0; grammar propertyTerms; public <term> = ${PROPERTY_DOMAIN_TERMS.join(' | ')} ;`;
          grammarList.addFromString(grammar, 1);
          recognition.grammars = grammarList;
        } catch (_) {
          // Non-blocking grammar hint fallback
        }
      }

      let finalAccumulatedTranscript = '';

      recognition.onstart = () => {
        this.isListening = true;
        onStateChange('listening');
      };

      recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalAccumulatedTranscript += res[0].transcript;
          } else {
            interimTranscript += res[0].transcript;
          }
        }

        if (interimTranscript) {
          onPartial(interimTranscript);
        }

        if (finalAccumulatedTranscript) {
          onStateChange('processing');
        }
      };

      recognition.onerror = (event) => {
        this.isListening = false;
        onStateChange('error');
        const errType = event.error;
        let message = 'Speech recognition error occurred.';
        let isPermission = false;
        let isOff = false;

        switch (errType) {
          case 'not-allowed':
          case 'service-not-allowed':
            message = 'Microphone permission was denied. Please allow microphone access in browser settings.';
            isPermission = true;
            break;
          case 'no-speech':
            message = 'No speech detected. Please speak closer to the microphone.';
            break;
          case 'network':
            message = 'Network error: speech recognition requires an internet connection or connection was interrupted.';
            isOff = true;
            break;
          case 'aborted':
            message = 'Speech input stopped.';
            break;
          case 'audio-capture':
            message = 'No microphone was found or microphone is busy.';
            break;
          default:
            message = `Speech recognition failed (${errType}).`;
            break;
        }

        // Only dispatch error if not intentionally aborted
        if (errType !== 'aborted') {
          onError({
            code: errType,
            message,
            isPermissionDenied: isPermission,
            isOffline: isOff
          });
        }
      };

      recognition.onend = () => {
        this.isListening = false;
        if (finalAccumulatedTranscript) {
          onStateChange('processing');
          const formatted = formatObservationTranscript(finalAccumulatedTranscript, language);
          onFinal(formatted);
          finalAccumulatedTranscript = '';
        }
        onStateChange('idle');
        this.activeRecognition = null;
      };

      recognition.start();
    } catch (err) {
      this.isListening = false;
      onStateChange('error');
      onError({
        code: 'START_EXCEPTION',
        message: err?.message || 'Could not initialize speech recognition'
      });
      this.activeRecognition = null;
    }
  }

  /**
   * Stops listening gracefully and waits for final transcription.
   */
  async stop() {
    this.isListening = false;

    if (this.isNative) {
      try {
        await NativeSpeechRecognition.stop();
      } catch (err) {
        console.warn('Native speech stop warning:', err);
      }
      return;
    }

    if (this.activeRecognition) {
      try {
        this.activeRecognition.stop();
      } catch (err) {
        console.warn('Web speech stop warning:', err);
      }
    }
  }

  /**
   * Cancels recognition immediately without saving transcript.
   */
  async cancel() {
    this.isListening = false;

    if (this.isNative) {
      try {
        await NativeSpeechRecognition.cancel();
      } catch (err) {
        console.warn('Native speech cancel warning:', err);
      }
      await this._cleanupNativeListeners();
      return;
    }

    if (this.activeRecognition) {
      try {
        this.activeRecognition.abort();
      } catch (err) {
        console.warn('Web speech abort warning:', err);
      }
      this.activeRecognition = null;
    }
  }

  async _cleanupNativeListeners() {
    if (this.nativeListeners && this.nativeListeners.length > 0) {
      for (const listener of this.nativeListeners) {
        try {
          if (listener && typeof listener.remove === 'function') {
            await listener.remove();
          }
        } catch (_) {}
      }
      this.nativeListeners = [];
    }
  }
}

export const speechRecognitionService = new SpeechRecognitionService();
export default speechRecognitionService;
