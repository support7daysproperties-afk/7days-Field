package com.sevendaysfield.app;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
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
