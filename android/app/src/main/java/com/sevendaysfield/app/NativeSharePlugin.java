package com.sevendaysfield.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeShare")
public class NativeSharePlugin extends Plugin {

    @PluginMethod
    public void canShare(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void share(PluginCall call) {
        String title = call.getString("title", "7Days Field — Completed Inspection");
        String text = call.getString("text", "");
        String url = call.getString("url", "");
        String dialogTitle = call.getString("dialogTitle", "Share Inspection via");

        StringBuilder fullMessage = new StringBuilder();
        if (text != null && !text.isEmpty()) {
            fullMessage.append(text);
        }
        if (url != null && !url.isEmpty()) {
            if (fullMessage.length() > 0 && !text.contains(url)) {
                fullMessage.append("\n\n").append(url);
            } else if (fullMessage.length() == 0) {
                fullMessage.append(url);
            }
        }

        try {
            Intent sendIntent = new Intent(Intent.ACTION_SEND);
            sendIntent.setType("text/plain");
            sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
            sendIntent.putExtra(Intent.EXTRA_TEXT, fullMessage.toString());

            Intent chooser = Intent.createChooser(sendIntent, dialogTitle);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(chooser);

            JSObject ret = new JSObject();
            ret.put("activityType", "native_sheet");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not open native share sheet: " + e.getMessage(), e);
        }
    }
}
