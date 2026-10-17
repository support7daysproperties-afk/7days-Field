package com.sevendaysfield.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Task;

@CapacitorPlugin(name = "NativeGoogleAuth")
public class GoogleAuthPlugin extends Plugin {

    private static final String DEFAULT_WEB_CLIENT_ID = "611802862463-c1ak7q81p66o4nodgfhnlq1dthcrfq3p.apps.googleusercontent.com";
    private static final String DRIVE_SCOPE = "oauth2:https://www.googleapis.com/auth/drive.file";

    @PluginMethod
    public void signIn(PluginCall call) {
        String webClientId = call.getString("webClientId", DEFAULT_WEB_CLIENT_ID);

        GoogleSignInOptions.Builder gsoBuilder = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(webClientId)
                .requestEmail()
                .requestProfile()
                .requestScopes(new Scope("https://www.googleapis.com/auth/drive.file"));

        try {
            gsoBuilder.requestServerAuthCode(webClientId);
        } catch (Exception ignored) {}

        GoogleSignInOptions gso = gsoBuilder.build();
        GoogleSignInClient googleSignInClient = GoogleSignIn.getClient(getActivity(), gso);

        // Disconnect/signOut previous cached session so account chooser always works
        googleSignInClient.signOut().addOnCompleteListener(task -> {
            Intent signInIntent = googleSignInClient.getSignInIntent();
            startActivityForResult(call, signInIntent, "handleSignInResult");
        });
    }

    @ActivityCallback
    private void handleSignInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);

        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            if (account != null) {
                JSObject ret = new JSObject();
                ret.put("idToken", account.getIdToken());
                ret.put("serverAuthCode", account.getServerAuthCode());
                ret.put("email", account.getEmail());
                ret.put("displayName", account.getDisplayName());
                ret.put("id", account.getId());
                ret.put("photoUrl", account.getPhotoUrl() != null ? account.getPhotoUrl().toString() : "");
                call.resolve(ret);
            } else {
                call.reject("Google Sign-In returned null account");
            }
        } catch (ApiException e) {
            String errorMsg = "Google Sign-In failed (status code " + e.getStatusCode() + "): " + e.getLocalizedMessage();
            call.reject(errorMsg, String.valueOf(e.getStatusCode()));
        } catch (Exception e) {
            call.reject("Unexpected error during Google Sign-In: " + e.getMessage());
        }
    }

    /**
     * Native Google Drive OAuth2 Access Token retrieval via Google Play Services
     */
    /**
     * Native Google Drive OAuth2 Access Token retrieval via Google Play Services
     */
    @PluginMethod
    public void getDriveAccessToken(PluginCall call) {
        String reqEmail = call.getString("email");
        new Thread(() -> {
            try {
                android.accounts.Account targetAccount = null;
                String resolvedEmail = reqEmail;

                if (reqEmail != null && !reqEmail.trim().isEmpty()) {
                    targetAccount = new android.accounts.Account(reqEmail.trim(), "com.google");
                } else {
                    GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
                    if (account != null) {
                        targetAccount = account.getAccount();
                        resolvedEmail = account.getEmail();
                    }
                }

                if (targetAccount == null) {
                    call.reject("No Google account specified or signed in. Please sign in first.");
                    return;
                }

                String token = GoogleAuthUtil.getToken(getContext(), targetAccount, DRIVE_SCOPE);
                if (token != null && !token.isEmpty()) {
                    JSObject ret = new JSObject();
                    ret.put("accessToken", token);
                    ret.put("email", resolvedEmail);
                    ret.put("expiresIn", 3600);
                    call.resolve(ret);
                } else {
                    call.reject("Failed to obtain Google Drive token");
                }
            } catch (UserRecoverableAuthException e) {
                // Launch native Google permission consent dialog
                Intent consentIntent = e.getIntent();
                startActivityForResult(call, consentIntent, "handleDriveConsentResult");
            } catch (Exception e) {
                call.reject("Error fetching Drive token: " + e.getMessage());
            }
        }).start();
    }

    @ActivityCallback
    private void handleDriveConsentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() == Activity.RESULT_OK) {
            String reqEmail = call.getString("email");
            new Thread(() -> {
                try {
                    android.accounts.Account targetAccount = null;
                    String resolvedEmail = reqEmail;

                    if (reqEmail != null && !reqEmail.trim().isEmpty()) {
                        targetAccount = new android.accounts.Account(reqEmail.trim(), "com.google");
                    } else {
                        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
                        if (account != null) {
                            targetAccount = account.getAccount();
                            resolvedEmail = account.getEmail();
                        }
                    }

                    if (targetAccount == null) {
                        call.reject("No Google account found after consent");
                        return;
                    }

                    String token = GoogleAuthUtil.getToken(getContext(), targetAccount, DRIVE_SCOPE);
                    JSObject ret = new JSObject();
                    ret.put("accessToken", token);
                    ret.put("email", resolvedEmail);
                    ret.put("expiresIn", 3600);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Error fetching Drive token after consent: " + e.getMessage());
                }
            }).start();
        } else {
            call.reject("Google Drive authorization was cancelled by the user", "USER_CANCELLED");
        }
    }

    /**
     * Clear cached token on expiry to trigger silent refresh
     */
    @PluginMethod
    public void clearDriveToken(PluginCall call) {
        String token = call.getString("token");
        if (token != null && !token.isEmpty()) {
            new Thread(() -> {
                try {
                    GoogleAuthUtil.clearToken(getContext(), token);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Error clearing Drive token: " + e.getMessage());
                }
            }).start();
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        String webClientId = call.getString("webClientId", DEFAULT_WEB_CLIENT_ID);
        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestIdToken(webClientId)
                .requestEmail()
                .build();
        GoogleSignInClient client = GoogleSignIn.getClient(getActivity(), gso);
        client.signOut().addOnCompleteListener(task -> call.resolve());
    }
}
