package ai.amberx.droid;

import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;

/**
 * The detection overlay (Oct 27 2026, Brett: "like ActiveX"): a small floating window over every app while hands-free
 * listening is on. It shows a status chip (LISTENING / ARMED / PAUSED), the input level as a moving line, the level in dB,
 * what the recognizer is hearing, and quick settings: always armed, open AmberX, collapse, hide (hiding turns the overlay
 * setting off; the app's Voice page turns it back on). There is no pause: hands-free always listens (Brett, Oct 27 2026).
 * Drag it by its top row; its place is remembered. Colours come from the app's theme tokens (the web side sends them
 * with the voice config), so it looks like AmberX. Needs "Display over other apps".
 *
 * Levels are the recognizer's RMS dB (about -2 silence to 10 loud), the same scale `handsfree.ts` maps for the web side.
 */
final class DetectionOverlay {
    static final int HISTORY = 60;
    private static final float DB_LO = -2f, DB_HI = 10f;

    private final WatchService service;
    private final WindowManager wm;
    private final WindowManager.LayoutParams lp;
    private final LinearLayout root;
    private final LinearLayout body;
    private final TextView chip, db, heard, armBtn, openBtn, foldBtn, hideBtn;
    private final Graph graph;
    private boolean shown, collapsed, listening, armed;
    private int bg = Color.parseColor("#1e1e24"), fg = Color.parseColor("#f2f2f5"), accent = Color.parseColor("#e8a33d"),
        muted = Color.parseColor("#8a8a96"), danger = Color.parseColor("#e5484d");

    static boolean canDraw(Context c) { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c); }

    /** The system screen where the user allows "Display over other apps" for AmberX. */
    static Intent permissionIntent(Context c) {
        return new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + c.getPackageName()));
    }

    DetectionOverlay(WatchService service) {
        this.service = service;
        wm = service.getSystemService(WindowManager.class);
        lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = WatchService.prefs(service).getInt("overlayX", dp(12));
        lp.y = WatchService.prefs(service).getInt("overlayY", dp(120));

        root = new LinearLayout(service);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(10), dp(8), dp(10), dp(8));

        LinearLayout top = new LinearLayout(service);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        chip = text(11, true);
        chip.setPadding(dp(8), dp(2), dp(8), dp(2));
        db = text(13, true);
        db.setPadding(dp(10), 0, dp(6), 0);
        db.setText("– dB");
        foldBtn = button("▾", v -> setCollapsed(!collapsed));
        hideBtn = button("✕", v -> WatchService.setVoiceFlag(service, "overlay", false));
        top.addView(chip);
        top.addView(db);
        top.addView(foldBtn);
        top.addView(hideBtn);
        top.setOnTouchListener(new Drag());
        root.addView(top);

        body = new LinearLayout(service);
        body.setOrientation(LinearLayout.VERTICAL);
        graph = new Graph(service);
        body.addView(graph, new LinearLayout.LayoutParams(dp(200), dp(44)));
        heard = text(12, false);
        heard.setMaxLines(2);
        heard.setEllipsize(TextUtils.TruncateAt.START);
        heard.setMaxWidth(dp(200));
        heard.setText("Listening…");
        body.addView(heard);
        LinearLayout quick = new LinearLayout(service);
        quick.setOrientation(LinearLayout.HORIZONTAL);
        quick.setPadding(0, dp(6), 0, 0);
        armBtn = button("Armed", v -> WatchService.setVoiceFlag(service, "alwaysArmed", !armed));
        openBtn = button("Open", v -> {
            Intent i = new Intent(service, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            try { service.startActivity(i); } catch (Exception ignored) {}
        });
        quick.addView(armBtn);
        quick.addView(openBtn);
        body.addView(quick);
        root.addView(body);
        paint();
    }

    void show() {
        if (shown || !canDraw(service)) return;
        try { wm.addView(root, lp); shown = true; } catch (Exception ignored) { /* permission withdrawn meanwhile */ }
    }

    void hide() {
        if (!shown) return;
        try { wm.removeView(root); } catch (Exception ignored) {}
        shown = false;
    }

    void setColors(JSONObject c) {
        if (c == null) return;
        bg = color(c.optString("bg"), bg);
        fg = color(c.optString("fg"), fg);
        accent = color(c.optString("accent"), accent);
        muted = color(c.optString("muted"), muted);
        danger = color(c.optString("danger"), danger);
        paint();
    }

    void setListening(boolean on, boolean alwaysArmed) {
        listening = on;
        armed = alwaysArmed;
        paint();
    }

    void setArmed(boolean on) { armed = on; paint(); }

    void pushLevel(float rms) {
        graph.push(Math.max(0f, Math.min(1f, (rms - DB_LO) / (DB_HI - DB_LO))));
        db.setText(Math.round(rms) + " dB");
    }

    void setHeard(String text, boolean last) {
        heard.setText(text == null || text.isEmpty() ? "Listening…" : (last ? "“" + text + "”" : text + "…"));
        heard.setTextColor(last ? fg : muted);
    }

    /** A wake phrase (or an armed command) was just heard: the chip lights up for a moment. */
    void flashWake() {
        chip.setText("HEARD");
        chip.setBackground(pill(accent));
        chip.setTextColor(bg);
        chip.postDelayed(this::paint, 1200);
    }

    private void setCollapsed(boolean c) {
        collapsed = c;
        body.setVisibility(c ? View.GONE : View.VISIBLE);
        foldBtn.setText(c ? "▸" : "▾");
    }

    private void paint() {
        GradientDrawable panel = new GradientDrawable();
        panel.setColor(bg);
        panel.setCornerRadius(dp(14));
        panel.setStroke(dp(1), muted);
        root.setBackground(panel);
        String state = !listening ? "STARTING" : armed ? "ARMED" : "LISTENING";
        chip.setText(state);
        chip.setTextColor(bg);
        chip.setBackground(pill(!listening ? muted : armed ? danger : accent));
        db.setTextColor(fg);
        heard.setTextColor(muted);
        for (TextView b : new TextView[] { foldBtn, hideBtn, armBtn, openBtn }) b.setTextColor(fg);
        armBtn.setBackground(armed ? pill(accent) : outline());
        armBtn.setTextColor(armed ? bg : fg);
        openBtn.setBackground(outline());
        graph.setColors(accent, muted);
    }

    /* ---------------------------------------------------------------- pieces */

    private TextView text(int sp, boolean bold) {
        TextView t = new TextView(service);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private TextView button(String label, View.OnClickListener click) {
        TextView b = text(12, true);
        b.setText(label);
        b.setPadding(dp(10), dp(4), dp(10), dp(4));
        b.setOnClickListener(click);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.setMarginStart(dp(4));
        b.setLayoutParams(p);
        return b;
    }

    private GradientDrawable pill(int color) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(999));
        return d;
    }

    private GradientDrawable outline() {
        GradientDrawable d = new GradientDrawable();
        d.setColor(Color.TRANSPARENT);
        d.setCornerRadius(dp(999));
        d.setStroke(dp(1), muted);
        return d;
    }

    private static int color(String hex, int fallback) {
        try { return hex == null || hex.isEmpty() ? fallback : Color.parseColor(hex); } catch (Exception e) { return fallback; }
    }

    private int dp(int v) { return Math.round(v * service.getResources().getDisplayMetrics().density); }

    /** Drag by the top row; the place is saved when the finger lifts. A tap still reaches the buttons. */
    private final class Drag implements View.OnTouchListener {
        private int x0, y0;
        private float fx, fy;
        @Override public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: x0 = lp.x; y0 = lp.y; fx = e.getRawX(); fy = e.getRawY(); return true;
                case MotionEvent.ACTION_MOVE:
                    lp.x = x0 + Math.round(e.getRawX() - fx);
                    lp.y = y0 + Math.round(e.getRawY() - fy);
                    if (shown) { try { wm.updateViewLayout(root, lp); } catch (Exception ignored) {} }
                    return true;
                case MotionEvent.ACTION_UP:
                    WatchService.prefs(service).edit().putInt("overlayX", lp.x).putInt("overlayY", lp.y).apply();
                    return true;
                default: return false;
            }
        }
    }

    /** The moving input-level line: newest on the right, louder is higher, a faint baseline under it. */
    private static final class Graph extends View {
        private final float[] levels = new float[HISTORY];
        private int count;
        private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG), base = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();

        Graph(Context c) {
            super(c);
            float d = c.getResources().getDisplayMetrics().density;
            line.setStyle(Paint.Style.STROKE);
            line.setStrokeWidth(2f * d);
            line.setStrokeJoin(Paint.Join.ROUND);
            base.setStrokeWidth(1f * d);
        }

        void setColors(int accent, int muted) { line.setColor(accent); base.setColor(muted); invalidate(); }

        void push(float level) {
            if (count < HISTORY) levels[count++] = level;
            else { System.arraycopy(levels, 1, levels, 0, HISTORY - 1); levels[HISTORY - 1] = level; }
            invalidate();
        }

        @Override protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight();
            c.drawLine(0, h - 1, w, h - 1, base);
            if (count == 0) return;
            float step = w / (HISTORY - 1);
            float x0 = w - step * (count - 1);
            path.reset();
            for (int i = 0; i < count; i++) {
                float x = x0 + i * step, y = h - 2 - levels[i] * (h - 4);
                if (i == 0) path.moveTo(x, y); else path.lineTo(x, y);
            }
            c.drawPath(path, line);
        }
    }
}
