package com.sevendaysfield.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;

@CapacitorPlugin(
    name = "SpeechRecognition",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "audio")
    }
)
public class SpeechRecognitionPlugin extends Plugin {

    private SpeechRecognizer speechRecognizer;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean isListening = false;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        Context context = getContext();
        boolean available = SpeechRecognizer.isRecognitionAvailable(context);
        boolean onDeviceAvailable = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            onDeviceAvailable = SpeechRecognizer.isOnDeviceRecognitionAvailable(context);
        }

        JSObject ret = new JSObject();
        ret.put("available", available);
        ret.put("onDeviceAvailable", onDeviceAvailable);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        Context context = getContext();
        boolean granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("audio", granted ? "granted" : "denied");
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            JSObject ret = new JSObject();
            ret.put("audio", "granted");
            call.resolve(ret);
        } else {
            requestPermissionForAlias("audio", call, "permissionCallback");
        }
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void permissionCallback(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("audio", granted ? "granted" : "denied");
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Microphone permission denied");
            return;
        }

        final String language = call.getString("language", "ta-IN");
        final boolean partialResults = call.getBoolean("partialResults", true);

        mainHandler.post(() -> {
            try {
                cleanupRecognizer();

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                if (speechRecognizer == null) {
                    call.reject("SpeechRecognizer could not be created on this device");
                    return;
                }

                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle params) {
                        isListening = true;
                        JSObject data = new JSObject();
                        data.put("state", "ready");
                        notifyListeners("ready", data);
                    }

                    @Override
                    public void onBeginningOfSpeech() {
                        JSObject data = new JSObject();
                        data.put("state", "listening");
                        notifyListeners("listening", data);
                    }

                    @Override
                    public void onRmsChanged(float rmsdB) {
                        JSObject data = new JSObject();
                        data.put("rmsdB", (double) rmsdB);
                        notifyListeners("rms", data);
                    }

                    @Override
                    public void onBufferReceived(byte[] buffer) {}

                    @Override
                    public void onEndOfSpeech() {
                        JSObject data = new JSObject();
                        data.put("state", "processing");
                        notifyListeners("endOfSpeech", data);
                    }

                    @Override
                    public void onError(int error) {
                        isListening = false;
                        String errorMsg = getErrorMessage(error);
                        String errorCode = getErrorCode(error);

                        JSObject errData = new JSObject();
                        errData.put("error", error);
                        errData.put("code", errorCode);
                        errData.put("message", errorMsg);
                        notifyListeners("error", errData);
                    }

                    @Override
                    public void onResults(Bundle results) {
                        isListening = false;
                        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        String transcript = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";

                        JSObject ret = new JSObject();
                        ret.put("transcript", transcript);
                        ret.put("isFinal", true);
                        notifyListeners("finalResults", ret);
                    }

                    @Override
                    public void onPartialResults(Bundle partialResultsBundle) {
                        ArrayList<String> matches = partialResultsBundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        String transcript = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";

                        JSObject ret = new JSObject();
                        ret.put("transcript", transcript);
                        ret.put("isFinal", false);
                        notifyListeners("partialResults", ret);
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {}
                });

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
                intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, language);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());

                // Enable bilingual code-switching (Tamil + English / Tanglish) support in Google Speech Services
                if ("ta-IN".equalsIgnoreCase(language)) {
                    intent.putExtra("android.speech.extra.ADDITIONAL_LANGUAGES", new String[]{"en-IN", "en-US"});
                } else {
                    intent.putExtra("android.speech.extra.ADDITIONAL_LANGUAGES", new String[]{"ta-IN"});
                }
                intent.putExtra("android.speech.extra.ENABLE_LANGUAGE_SWITCH", true);

                speechRecognizer.startListening(intent);
                call.resolve();
            } catch (Exception ex) {
                isListening = false;
                call.reject("Failed to start speech recognition: " + ex.getMessage(), ex);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        mainHandler.post(() -> {
            try {
                if (speechRecognizer != null && isListening) {
                    speechRecognizer.stopListening();
                }
                isListening = false;
                call.resolve();
            } catch (Exception ex) {
                call.reject("Failed to stop speech recognition: " + ex.getMessage());
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        mainHandler.post(() -> {
            try {
                cleanupRecognizer();
                call.resolve();
            } catch (Exception ex) {
                call.reject("Failed to cancel speech recognition: " + ex.getMessage());
            }
        });
    }

    private void cleanupRecognizer() {
        isListening = false;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            } catch (Exception ignored) {}
            speechRecognizer = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        mainHandler.post(this::cleanupRecognizer);
        super.handleOnDestroy();
    }

    private String getErrorCode(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "AUDIO_ERROR";
            case SpeechRecognizer.ERROR_CLIENT: return "CLIENT_ERROR";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "PERMISSION_DENIED";
            case SpeechRecognizer.ERROR_NETWORK: return "NETWORK_ERROR";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "NETWORK_TIMEOUT";
            case SpeechRecognizer.ERROR_NO_MATCH: return "NO_MATCH";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "RECOGNIZER_BUSY";
            case SpeechRecognizer.ERROR_SERVER: return "SERVER_ERROR";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "SPEECH_TIMEOUT";
            default: return "UNKNOWN_ERROR";
        }
    }

    private String getErrorMessage(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "Microphone audio recording error occurred.";
            case SpeechRecognizer.ERROR_CLIENT:
                return "Client speech service error.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Microphone permission is required to speak observations.";
            case SpeechRecognizer.ERROR_NETWORK:
                return "Network connection unavailable and on-device offline language pack not found.";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "Speech service network request timed out.";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "No speech detected. Please speak closer to the microphone.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "Speech recognizer is busy. Please try again.";
            case SpeechRecognizer.ERROR_SERVER:
                return "Speech server error. Please try again or type manually.";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "Listening timed out due to silence.";
            default:
                return "Speech recognition error (" + error + ").";
        }
    }
}
