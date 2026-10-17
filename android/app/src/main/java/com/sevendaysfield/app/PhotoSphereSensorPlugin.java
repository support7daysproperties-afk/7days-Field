package com.sevendaysfield.app;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PhotoSphereSensor")
public class PhotoSphereSensorPlugin extends Plugin implements SensorEventListener {

    private SensorManager sensorManager;
    private Sensor rotationSensor;
    private boolean isListening = false;
    private final float[] quaternion = new float[4];
    private final float[] rotationMatrix = new float[16];
    private final float[] orientation = new float[3];

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            if (rotationSensor == null) {
                // Fallback to game rotation vector (no compass needed)
                rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR);
            }
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", rotationSensor != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (sensorManager != null && rotationSensor != null && !isListening) {
            // SENSOR_DELAY_GAME provides ~50Hz-200Hz hardware updates with zero lag
            sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME);
            isListening = true;
            call.resolve();
        } else if (isListening) {
            call.resolve();
        } else {
            call.reject("Hardware rotation vector sensor unavailable");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (sensorManager != null && isListening) {
            sensorManager.unregisterListener(this);
            isListening = false;
        }
        call.resolve();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() == Sensor.TYPE_ROTATION_VECTOR ||
            event.sensor.getType() == Sensor.TYPE_GAME_ROTATION_VECTOR) {

            // Extract hardware orientation quaternion directly from hardware DSP
            SensorManager.getQuaternionFromVector(quaternion, event.values);
            // quaternion is [w, x, y, z]

            SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
            SensorManager.getOrientation(rotationMatrix, orientation);
            // orientation is [azimuth (yaw), pitch, roll] in radians

            JSObject data = new JSObject();
            data.put("qx", (double) quaternion[1]);
            data.put("qy", (double) quaternion[2]);
            data.put("qz", (double) quaternion[3]);
            data.put("qw", (double) quaternion[0]);

            double yawDeg = Math.toDegrees(orientation[0]);
            double pitchDeg = Math.toDegrees(orientation[1]);
            double rollDeg = Math.toDegrees(orientation[2]);

            data.put("yaw", yawDeg);
            data.put("pitch", pitchDeg);
            data.put("roll", rollDeg);
            data.put("timestamp", System.currentTimeMillis());

            notifyListeners("sensorOrientation", data);
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // No-op
    }

    @Override
    protected void handleOnDestroy() {
        if (sensorManager != null && isListening) {
            sensorManager.unregisterListener(this);
            isListening = false;
        }
        super.handleOnDestroy();
    }
}
