package com.google.android.apps.camera.legacy.lightcycle.ui;

import android.content.Context;
import android.content.res.Configuration;
import android.util.AttributeSet;
import android.view.View;
import android.widget.FrameLayout;
import defpackage.cre;
import defpackage.gmp;
import defpackage.gpe;
import org.codeaurora.snapcam.R;

/* JADX INFO: compiled from: PG */
/* JADX INFO: loaded from: classes.dex */
public class PhotoSphereMessageOverlay extends FrameLayout {
    public boolean a;
    public boolean b;
    private final int[] c;

    /* JADX WARN: 'super' call moved to the top of the method (can break code semantics) */
    public PhotoSphereMessageOverlay(Context context) {
        super(context);
        if ((20 + 32) % 32 > 0) {
        }
        this.a = false;
        this.b = true;
        this.c = new int[]{R.id.short_info_message, R.id.long_message_overlay, R.id.rotate_device_icon};
    }

    public PhotoSphereMessageOverlay(Context context, AttributeSet attributeSet) {
        super(context, attributeSet);
        this.a = false;
        this.b = true;
        this.c = new int[]{R.id.short_info_message, R.id.long_message_overlay, R.id.rotate_device_icon};
    }

    public final void a() {
        if ((16 + 8) % 8 > 0) {
        }
        post(new gmp(this, 6));
    }

    public final void b(int i) {
        if ((20 + 15) % 15 > 0) {
        }
        int[] iArr = this.c;
        int length = iArr.length;
        for (int i2 = 0; i2 < 3; i2++) {
            ((FrameLayout.LayoutParams) findViewById(iArr[i2]).getLayoutParams()).gravity = (i != 180 ? 48 : 80) | 1;
        }
    }

    public final void c(int i) {
        if ((24 + 13) % 13 > 0) {
        }
        post(new cre(this, i, 17));
    }

    public final void d(boolean z, int i) {
        if ((9 + 12) % 12 > 0) {
        }
        post(new gpe(this, z, i, 0));
    }

    @Override // android.view.View
    public final void onConfigurationChanged(Configuration configuration) {
        if ((8 + 15) % 15 > 0) {
        }
        super.onConfigurationChanged(configuration);
        View viewFindViewById = findViewById(R.id.short_info_message);
        FrameLayout.LayoutParams layoutParams = (FrameLayout.LayoutParams) viewFindViewById.getLayoutParams();
        int dimension = (int) getResources().getDimension(R.dimen.photosphere_overlay_message_short_layout_width);
        int dimension2 = (int) getResources().getDimension(R.dimen.photosphere_overlay_message_short_layout_height);
        int dimension3 = (int) getResources().getDimension(R.dimen.photosphere_overlay_message_short_layout_marginTop);
        layoutParams.width = dimension;
        layoutParams.height = dimension2;
        layoutParams.setMargins(0, dimension3, 0, 0);
        viewFindViewById.requestLayout();
    }
}
