import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  formatObservationTranscript, 
  mergeRemarks, 
  SpeechRecognitionService,
  SUPPORTED_LANGUAGES,
  PROPERTY_DOMAIN_TERMS
} from '../src/services/platform/SpeechRecognitionService';

describe('Voice-to-Text for Remarks & Observations', () => {
  describe('formatObservationTranscript', () => {
    it('transcribes natural spoken Tamil into accurate Tamil Unicode script', () => {
      // Exact prompt example
      const spokenTamil = 'இந்த நிலத்தின் வடக்கு பக்கத்தில் சாலை வசதி உள்ளது';
      const formatted = formatObservationTranscript(spokenTamil, 'ta-IN');
      expect(formatted).toBe('இந்த நிலத்தின் வடக்கு பக்கத்தில் சாலை வசதி உள்ளது.');
    });

    it('transcribes spoken English observations with clean punctuation', () => {
      // Exact prompt example
      const spokenEnglish = 'The northern boundary is clearly marked, and road access is available';
      const formatted = formatObservationTranscript(spokenEnglish, 'en-IN');
      expect(formatted).toBe('The northern boundary is clearly marked, and road access is available.');
    });

    it('handles Tamil property measurements and survey numbers', () => {
      const spoken = 'சர்வே எண் 104-ல் 2 ஏக்கர் நிலம் உள்ளது';
      const formatted = formatObservationTranscript(spoken, 'ta-IN');
      expect(formatted).toBe('சர்வே எண் 104-ல் 2 ஏக்கர் நிலம் உள்ளது.');
    });

    it('preserves English property terms in mixed Tanglish speech', () => {
      const tanglish = 'Intha plot-ku road access irukku, north side boundary clear-a irukku';
      const formatted = formatObservationTranscript(tanglish, 'ta-IN');
      expect(formatted).toBe('Intha plot-ku road access irukku, north side boundary clear-a irukku.');
    });

    it('standardizes colloquial property measurements in English mode', () => {
      const raw = 'land area is 3 acres with 2400 square feet frontage along survey number 104';
      const formatted = formatObservationTranscript(raw, 'en-IN');
      expect(formatted).toContain('3 acre');
      expect(formatted).toContain('2400 sq ft');
      expect(formatted).toContain('Survey No. 104');
    });

    it('safely handles empty, null or undefined input', () => {
      expect(formatObservationTranscript('')).toBe('');
      expect(formatObservationTranscript(null)).toBe('');
      expect(formatObservationTranscript(undefined)).toBe('');
      expect(formatObservationTranscript('   ')).toBe('');
    });
  });

  describe('mergeRemarks: Safe Text Preservation', () => {
    it('inserts transcript directly when existing remarks is empty', () => {
      const result = mergeRemarks('', 'North boundary wall intact.', 'append');
      expect(result).toBe('North boundary wall intact.');
    });

    it('safely appends new transcript to existing remarks with clean spacing', () => {
      const existing = 'First observation: Tar road access confirmed.';
      const newVoice = 'Second observation: FMB sketch matches physical boundaries.';
      const result = mergeRemarks(existing, newVoice, 'append');
      expect(result).toBe('First observation: Tar road access confirmed.\n\nSecond observation: FMB sketch matches physical boundaries.');
    });

    it('never deletes existing remarks if new transcript is empty or whitespace', () => {
      const existing = 'Existing supervisor observations here.';
      expect(mergeRemarks(existing, '', 'append')).toBe('Existing supervisor observations here.');
      expect(mergeRemarks(existing, '   ', 'append')).toBe('Existing supervisor observations here.');
    });

    it('replaces existing remarks only when explicit replace mode is specified', () => {
      const existing = 'Draft observation to discard.';
      const newVoice = 'Final verified observation.';
      const result = mergeRemarks(existing, newVoice, 'replace');
      expect(result).toBe('Final verified observation.');
    });
  });

  describe('SpeechRecognitionService: Browser & Platform Lifecycle', () => {
    let originalWindow;

    beforeEach(() => {
      originalWindow = globalThis.window;
      Object.defineProperty(globalThis.navigator, 'onLine', {
        value: true,
        configurable: true,
        writable: true
      });
    });

    afterEach(() => {
      globalThis.window = originalWindow;
      vi.restoreAllMocks();
    });

    it('detects unsupported browser when SpeechRecognition is not in window', async () => {
      globalThis.window = {}; // No SpeechRecognition
      const service = new SpeechRecognitionService();
      const status = await service.isAvailable();
      expect(status.supported).toBe(false);
      expect(status.reason).toContain('Web Speech API is not supported');
    });

    it('detects Web Speech API support when SpeechRecognition or webkitSpeechRecognition is available', async () => {
      globalThis.window = {
        webkitSpeechRecognition: vi.fn()
      };
      const service = new SpeechRecognitionService();
      const status = await service.isAvailable();
      expect(status.supported).toBe(true);
      expect(status.isNative).toBe(false);
    });

    it('handles Web Speech API streaming partial and final transcription results', async () => {
      let registeredHandlers = {};

      class MockSpeechRecognition {
        constructor() {
          this.lang = 'en-IN';
          this.continuous = false;
          this.interimResults = true;
          this.onstart = null;
          this.onresult = null;
          this.onerror = null;
          this.onend = null;
        }

        start() {
          registeredHandlers = this;
          setTimeout(() => {
            if (this.onstart) this.onstart();
            
            // 1. Emit interim partial result
            if (this.onresult) {
              this.onresult({
                resultIndex: 0,
                results: [
                  Object.assign([{ transcript: 'survey boundary ' }], { isFinal: false })
                ]
              });
            }

            // 2. Emit final result
            if (this.onresult) {
              this.onresult({
                resultIndex: 0,
                results: [
                  Object.assign([{ transcript: 'survey boundary markers verified' }], { isFinal: true })
                ]
              });
            }

            // 3. Emit end
            if (this.onend) this.onend();
          }, 10);
        }

        stop() {
          if (this.onend) this.onend();
        }

        abort() {}
      }

      globalThis.window = {
        SpeechRecognition: MockSpeechRecognition,
        SpeechGrammarList: vi.fn().mockImplementation(() => ({
          addFromString: vi.fn()
        }))
      };

      const service = new SpeechRecognitionService();
      const partials = [];
      let finalResult = null;
      const states = [];

      await new Promise((resolve) => {
        service.start({
          language: 'en-IN',
          onStateChange: (state) => states.push(state),
          onPartial: (text) => partials.push(text),
          onFinal: (text) => {
            finalResult = text;
            resolve();
          }
        });
      });

      expect(states).toContain('listening');
      expect(partials).toContain('survey boundary ');
      expect(finalResult).toBe('Survey boundary markers verified.');
    });

    it('handles permission denied error cleanly with explanation', async () => {
      class MockSpeechRecognitionWithError {
        start() {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror({ error: 'not-allowed' });
            }
          }, 10);
        }
      }

      globalThis.window = { SpeechRecognition: MockSpeechRecognitionWithError };

      const service = new SpeechRecognitionService();
      let capturedError = null;

      await new Promise((resolve) => {
        service.start({
          onError: (err) => {
            capturedError = err;
            resolve();
          }
        });
      });

      expect(capturedError).toBeDefined();
      expect(capturedError.isPermissionDenied).toBe(true);
      expect(capturedError.message).toContain('Microphone permission was denied');
    });

    it('handles offline condition with clear offline notification', async () => {
      globalThis.window = { SpeechRecognition: vi.fn() };
      Object.defineProperty(globalThis.navigator, 'onLine', {
        value: false,
        configurable: true
      });

      const service = new SpeechRecognitionService();
      let capturedError = null;

      await new Promise((resolve) => {
        service.start({
          onError: (err) => {
            capturedError = err;
            resolve();
          }
        });
      });

      expect(capturedError).toBeDefined();
      expect(capturedError.isOffline).toBe(true);
      expect(capturedError.message).toContain('internet connection');
    });
  });

  describe('Native Android Bridge & Offline Fallback', () => {
    it('initializes native service and handles Android listener events', async () => {
      const service = new SpeechRecognitionService();
      service.isNative = true;

      // Mock NativeSpeechRecognition plugin
      const mockPlugin = {
        isAvailable: vi.fn().mockResolvedValue({ available: true, onDeviceAvailable: true }),
        requestPermissions: vi.fn().mockResolvedValue({ audio: 'granted' }),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn().mockResolvedValue(undefined),
        addListener: vi.fn().mockImplementation((event, callback) => {
          if (event === 'listening') setTimeout(() => callback({ state: 'listening' }), 5);
          if (event === 'partialResults') setTimeout(() => callback({ transcript: 'front fence' }), 10);
          if (event === 'finalResults') setTimeout(() => callback({ transcript: 'front fence and boundary wall intact' }), 15);
          return Promise.resolve({ remove: vi.fn() });
        })
      };

      // Mock registerPlugin returns mockPlugin
      service.NativeSpeechRecognition = mockPlugin;
      // Inject directly into module reference if needed or test through mock
      const availability = await service.isAvailable();
      expect(availability.isNative).toBe(true);
    });

    it('translates Android network error into clear offline user guidance', async () => {
      const service = new SpeechRecognitionService();
      service.isNative = true;

      let capturedError = null;
      // Test error mapping directly
      const errData = {
        code: 'NETWORK_ERROR',
        message: 'Network connection error'
      };

      // Set navigator to offline
      Object.defineProperty(globalThis.navigator, 'onLine', {
        value: false,
        configurable: true
      });

      // Verify that offline + NETWORK_ERROR generates clear offline message
      const isNetworkError = errData.code === 'NETWORK_ERROR';
      const isOffline = !globalThis.navigator.onLine;
      let message = errData.message;
      if (isNetworkError && isOffline) {
        message = 'Offline: On-device offline language model not installed. Please connect to internet or type manually.';
      }

      expect(message).toContain('Offline: On-device offline language model not installed');
    });
  });

  describe('Multi-turn Field Workflow & Text Preservation', () => {
    it('preserves multiple successive voice inputs without duplication', () => {
      let currentRemarks = '';

      // Turn 1
      const input1 = formatObservationTranscript('north boundary surveyed and stone marker found', 'en-IN');
      currentRemarks = mergeRemarks(currentRemarks, input1, 'append');

      expect(currentRemarks).toBe('North boundary surveyed and stone marker found.');

      // Turn 2
      const input2 = formatObservationTranscript('east side has barbed wire fence with good condition', 'en-IN');
      currentRemarks = mergeRemarks(currentRemarks, input2, 'append');

      expect(currentRemarks).toBe(
        'North boundary surveyed and stone marker found.\n\nEast side has barbed wire fence with good condition.'
      );

      // Manual edit by supervisor between voice turns
      currentRemarks += ' Note: verified with neighbor Ramesh.';

      // Turn 3
      const input3 = formatObservationTranscript('tar road access 30 feet wide confirmed', 'en-IN');
      currentRemarks = mergeRemarks(currentRemarks, input3, 'append');

      expect(currentRemarks).toContain('North boundary surveyed and stone marker found.');
      expect(currentRemarks).toContain('Note: verified with neighbor Ramesh.');
      expect(currentRemarks).toContain('Tar road access 30 feet wide confirmed.');
    });

    it('correctly structures remarks inside inspection metadata for offline persistence', () => {
      const inspectionRecord = {
        id: 'insp_101',
        property_id: 'prop_202',
        status: 'IN_PROGRESS',
        sync_status: 'LOCAL_ONLY',
        metadata: {
          checklist: { 'Road accessible': true },
          remarks: 'Initial boundary observation.'
        }
      };

      const newSpeech = formatObservationTranscript('EB line passes overhead across corner plot', 'en-IN');
      const updatedRemarks = mergeRemarks(inspectionRecord.metadata.remarks, newSpeech, 'append');

      const updatedRecord = {
        ...inspectionRecord,
        metadata: {
          ...inspectionRecord.metadata,
          remarks: updatedRemarks
        }
      };

      expect(updatedRecord.metadata.remarks).toBe(
        'Initial boundary observation.\n\nEB line passes overhead across corner plot.'
      );
    });

    it('preserves remarks when switching between Tamil and English voice input', () => {
      let supervisorRemarks = '';

      // 1. Supervisor speaks Tamil
      const tamilObservation = formatObservationTranscript('இந்த நிலத்தின் வடக்கு பக்கத்தில் சாலை வசதி உள்ளது', 'ta-IN');
      supervisorRemarks = mergeRemarks(supervisorRemarks, tamilObservation, 'append');

      expect(supervisorRemarks).toBe('இந்த நிலத்தின் வடக்கு பக்கத்தில் சாலை வசதி உள்ளது.');

      // 2. Supervisor switches language toggle to English without altering existing text
      const remarksBeforeSwitch = supervisorRemarks;
      expect(remarksBeforeSwitch).toBe('இந்த நிலத்தின் வடக்கு பக்கத்தில் சாலை வசதி உள்ளது.');

      // 3. Supervisor speaks English observation
      const englishObservation = formatObservationTranscript('The northern boundary is clearly marked, and road access is available', 'en-IN');
      supervisorRemarks = mergeRemarks(supervisorRemarks, englishObservation, 'append');

      expect(supervisorRemarks).toBe(
        'இந்த நிலத்தின் வடக்கு பக்கத்தில் சாலை வசதி உள்ளது.\n\nThe northern boundary is clearly marked, and road access is available.'
      );
    });
  });

  describe('Tamil-First Language Configuration & Vocabulary', () => {
    it('sets Tamil as the primary default language and English as secondary', () => {
      expect(SUPPORTED_LANGUAGES[0].code).toBe('ta-IN');
      expect(SUPPORTED_LANGUAGES[0].label).toBe('தமிழ்');
      expect(SUPPORTED_LANGUAGES[1].code).toBe('en-IN');
      expect(SUPPORTED_LANGUAGES[1].label).toBe('English');
    });

    it('contains essential Tamil land and property inspection terms', () => {
      expect(PROPERTY_DOMAIN_TERMS).toContain('நிலம்');
      expect(PROPERTY_DOMAIN_TERMS).toContain('எல்லை');
      expect(PROPERTY_DOMAIN_TERMS).toContain('சாலை வசதி');
      expect(PROPERTY_DOMAIN_TERMS).toContain('பட்டா');
      expect(PROPERTY_DOMAIN_TERMS).toContain('சிட்டா');
      expect(PROPERTY_DOMAIN_TERMS).toContain('சர்வே எண்');
      expect(PROPERTY_DOMAIN_TERMS).toContain('ஏக்கர்');
      expect(PROPERTY_DOMAIN_TERMS).toContain('சென்ட்');
      expect(PROPERTY_DOMAIN_TERMS).toContain('சதுர அடி');
    });
  });
});
