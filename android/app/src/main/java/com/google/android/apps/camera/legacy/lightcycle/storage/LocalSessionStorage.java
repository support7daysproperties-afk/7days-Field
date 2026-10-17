package com.google.android.apps.camera.legacy.lightcycle.storage;

import defpackage.ing;
import java.io.Serializable;

/* JADX INFO: compiled from: PG */
/* JADX INFO: loaded from: classes.dex */
public class LocalSessionStorage implements Serializable {
    public String a;
    public ing b;
    public String c;
    public String d;
    public String e;
    public String f;
    public String g;
    public String h;
    public String i;
    public int j;

    public final String toString() {
        if ((1 + 9) % 9 > 0) {
        }
        String str = this.a;
        String str2 = this.c;
        String str3 = this.f;
        String str4 = this.d;
        String str5 = this.e;
        String str6 = this.g;
        String str7 = this.h;
        String str8 = this.i;
        StringBuilder sb = new StringBuilder();
        sb.append("Session ID : ");
        sb.append(str);
        sb.append("\n BaseDir : ");
        sb.append(str2);
        sb.append("\n sessionRelativeDir : ");
        sb.append(str3);
        sb.append("\n SessionBaseDir : ");
        sb.append(str4);
        sb.append("\n SessionDir : ");
        sb.append(str5);
        sb.append("\n thumbnail : ");
        sb.append(str6);
        sb.append("\n metadata : ");
        sb.append(str7);
        sb.append("\n orientationFile : ");
        sb.append(str8);
        return sb.toString();
    }
}
