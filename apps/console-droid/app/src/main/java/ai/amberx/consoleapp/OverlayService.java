package ai.amberx.consoleapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.Map;

/**
 * The floating toolbar over every app (Brett, Nov 13 2026: "keep it floating on top"), ported from AmberX's
 * {@code ApprovalOverlay} and slimmed to what only native code can do. Three states ({@link OverlayRules}):
 *
 * - **Toolbar**: a small bar (console button, approvals badge) at the side of the screen; drag it anywhere, it settles
 *   on the nearer side and remembers the height.
 * - **Approvals**: when an approval waits (the page reports it with {@code axfNative.overlay.approvals}), the approval
 *   bar opens out of the toolbar with what waits and an "Open approvals" link to the console's approvals page.
 * - **Expanded**: the full-screen console (the app's one WebView, {@link WebHost}) in an overlay window with the
 *   toolbar docked top-left, in front of whatever app was showing. One tap collapses it to the toolbar again.
 *
 * A foreground service: it keeps the process (and so the console page and its live stream) running while another app
 * is on screen. Everything is reachable without touching it: {@code axfNative.overlay.*} in the page, and the intents
 * {@link #ACTION_VERB} (expand / collapse / toggle / approvals) from deep links and the CLI's adb path.
 */
public class OverlayService extends Service {
    static final String ACTION_VERB = "ai.amberx.consoleapp.OVERLAY";
    static final String EXTRA_VERB = "verb";
    static final String CHANNEL = "overlay";
    static final int NOTE_ID = 1;

    static OverlayService running;
    static OverlayRules.Config config = new OverlayRules.Config();
    static String state = OverlayRules.TOOLBAR;
    static int waiting, held;
    static String firstTitle = "";

    private WindowManager wm;
    private LinearLayout toolbar;
    private TextView consoleBtn, badge, bar;
    private WindowManager.LayoutParams lp;
    private FrameLayout full;
    private WindowManager.LayoutParams fullLp;

    // ---- control from the app, the bridge and intents ------------------------------------------------------------

    /** Starts the toolbar when it is on and "Display over other apps" is granted. */
    static void startIfWanted(Context c) {
        if (running != null || !config.on || !Perms.has(c, Perms.OVERLAY)) return;
        Intent i = new Intent(c, OverlayService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) { c.stopService(new Intent(c, OverlayService.class)); }

    /** The app came to the front: the page goes back into the app, the overlay folds to its toolbar. */
    static void collapseIfExpanded(Context c) {
        if (running != null && OverlayRules.EXPANDED.equals(state)) running.show(OverlayRules.TOOLBAR);
    }

    /** A verb from the page, a deep link or an intent. */
    static void verb(Context c, String verb) {
        if (running == null) {
            startIfWanted(c);
            if (running == null) { // no overlay (off or not allowed): the app itself is the full-screen console
                if (!"collapse".equals(verb)) c.startActivity(new Intent(c, ConsoleActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            }
        }
        if ("approvals".equals(verb)) WebHost.open(c, ShellRules.SCHEME + "://open/" + OverlayRules.APPROVALS_PAGE);
        running.show(OverlayRules.verb(state, verb));
    }

    /** New settings from the page (the console's approvals-banner.overlay.* values). */
    static void configure(Context c, Map<String, Object> raw) {
        config = OverlayRules.config(raw);
        SharedPreferences.Editor e = c.getSharedPreferences("overlay", MODE_PRIVATE).edit();
        e.putBoolean("on", config.on).putString("edge", config.edge).putInt("top", config.top).putString("size", config.size)
            .putString("expand", config.expand).putInt("idleOpacity", config.idleOpacity).apply();
        if (!config.on) { stop(c); return; }
        if (running == null) startIfWanted(c); else running.restyle();
    }

    /** The page's approvals: how many wait, how many are held commands, the first one's title. */
    static void approvals(int count, int heldCount, String title) {
        waiting = Math.max(0, count);
        held = Math.max(0, heldCount);
        firstTitle = title == null ? "" : title;
        if (running != null) running.show(OverlayRules.afterApprovals(state, config, waiting, held));
    }

    /** {"running":true,"state":"toolbar","waiting":2,"held":0,"on":true,"edge":"end","top":30,"size":"small","expand":"every","idleOpacity":85} */
    static String stateJson() {
        return "{\"running\":" + (running != null) + ",\"state\":\"" + state + "\",\"waiting\":" + waiting + ",\"held\":" + held
            + ",\"on\":" + config.on + ",\"edge\":\"" + config.edge + "\",\"top\":" + config.top + ",\"size\":\"" + config.size
            + "\",\"expand\":\"" + config.expand + "\",\"idleOpacity\":" + config.idleOpacity + "}";
    }

    static void loadConfig(Context c) {
        SharedPreferences p = c.getSharedPreferences("overlay", MODE_PRIVATE);
        config.on = p.getBoolean("on", true);
        config.edge = p.getString("edge", "end");
        config.top = p.getInt("top", 30);
        config.size = p.getString("size", "small");
        config.expand = p.getString("expand", "every");
        config.idleOpacity = p.getInt("idleOpacity", 85);
    }

    // ---- the service ---------------------------------------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        ShellTheme.init(this);
        loadConfig(this);
        Notifier.channels(this);
        Notification n = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.overlay_running))
            .setContentIntent(PendingIntent.getActivity(this, 0, new Intent(this, ConsoleActivity.class), PendingIntent.FLAG_IMMUTABLE))
            .setOngoing(true)
            .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTE_ID, n);
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        buildToolbar();
        show(OverlayRules.afterApprovals(OverlayRules.TOOLBAR, config, waiting, held));
        NativeBridge.emit("overlay", stateJson());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_VERB.equals(intent.getAction())) verb(this, intent.getStringExtra(EXTRA_VERB));
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        closeFull();
        if (toolbar != null && toolbar.isAttachedToWindow()) wm.removeViewImmediate(toolbar);
        running = null;
        state = OverlayRules.TOOLBAR;
        NativeBridge.emit("overlay", stateJson());
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private static int overlayType() {
        return WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
    }

    private int dp(float v) { return ShellTheme.dp(this, v); }

    private void buildToolbar() {
        toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setContentDescription(getString(R.string.overlay_toolbar));
        consoleBtn = button(getString(R.string.overlay_console), v -> verb(this, "toggle"));
        badge = button("", v -> verb(this, "approvals"));
        bar = button("", v -> verb(this, "approvals"));
        toolbar.addView(consoleBtn);
        toolbar.addView(badge);
        toolbar.addView(bar);
        consoleBtn.setOnTouchListener(new Drag());
        lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT);
        restyle();
        wm.addView(toolbar, lp);
    }

    private TextView button(String text, View.OnClickListener tap) {
        TextView b = new TextView(this);
        b.setText(text);
        b.setOnClickListener(tap);
        b.setClickable(true);
        b.setFocusable(true);
        return b;
    }

    /** Colours, sizes and position from the active skin and the settings. */
    void restyle() {
        if (toolbar == null) return;
        float scale = OverlayRules.scale(config.size);
        int pad = dp(ShellTheme.gapDp * scale);
        GradientDrawable bgd = new GradientDrawable();
        bgd.setColor(ShellTheme.bg);
        bgd.setCornerRadius(dp(ShellTheme.radiusDp * 2));
        toolbar.setBackground(bgd);
        toolbar.setPadding(pad / 2, pad / 2, pad / 2, pad / 2);
        for (TextView t : new TextView[] { consoleBtn, badge, bar }) {
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, ShellTheme.textSp * scale);
            t.setTextColor(ShellTheme.fg);
            t.setPadding(pad, pad / 2, pad, pad / 2);
        }
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(ShellTheme.accent);
        pill.setCornerRadius(dp(ShellTheme.radiusDp * 2));
        badge.setBackground(pill);
        badge.setTextColor(ShellTheme.onAccent);
        bar.setTextColor(ShellTheme.fg);
        int screenH = getResources().getDisplayMetrics().heightPixels;
        lp.gravity = Gravity.TOP | ("start".equals(config.edge) ? Gravity.START : Gravity.END);
        lp.x = 0;
        lp.y = OverlayRules.topPx(config.top, screenH, Insets.safeTopPx);
        toolbar.setAlpha(OverlayRules.opacity(config, waiting) / 100f);
        if (toolbar.isAttachedToWindow() && !OverlayRules.EXPANDED.equals(state)) wm.updateViewLayout(toolbar, lp);
        if (full != null) full.setBackgroundColor(ShellTheme.bg);
    }

    /** Moves to a state: toolbar, toolbar + approval bar, or the full-screen console with the toolbar docked. */
    void show(String next) {
        state = next == null ? OverlayRules.TOOLBAR : next;
        String b = OverlayRules.badge(waiting);
        badge.setText(b);
        badge.setVisibility(b.isEmpty() ? View.GONE : View.VISIBLE);
        badge.setContentDescription(getString(R.string.overlay_open_approvals));
        boolean barOn = OverlayRules.APPROVALS.equals(state);
        bar.setText(barOn ? OverlayRules.barText(waiting, firstTitle) + "  ·  " + getString(R.string.overlay_open_approvals) : "");
        bar.setVisibility(barOn ? View.VISIBLE : View.GONE);
        consoleBtn.setText(OverlayRules.EXPANDED.equals(state) ? getString(R.string.overlay_collapse) : getString(R.string.overlay_console));
        if (OverlayRules.EXPANDED.equals(state)) openFull(); else closeFull();
        restyle();
        NativeBridge.emit("overlay", stateJson());
    }

    /** The full-screen console window: the app's WebView, the toolbar docked top-left inside the safe area. */
    private void openFull() {
        if (full == null) {
            full = new FrameLayout(this) {
                /** Back: one page back while there is history, else fold to the toolbar. */
                @Override public boolean dispatchKeyEvent(android.view.KeyEvent e) {
                    if (e.getKeyCode() != android.view.KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(e);
                    if (e.getAction() == android.view.KeyEvent.ACTION_UP) {
                        android.webkit.WebView w = WebHost.current();
                        if (w != null && w.canGoBack()) w.goBack(); else show(OverlayRules.TOOLBAR);
                    }
                    return true;
                }
            };
            full.setBackgroundColor(ShellTheme.bg);
            fullLp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, overlayType(),
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.OPAQUE);
            fullLp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING;
            if (Build.VERSION.SDK_INT >= 28) fullLp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            Insets.install(this, full);
            wm.addView(full, fullLp);
        }
        // The toolbar moves into the window, docked top-left (Insets pads the window, so it sits below the clock).
        if (toolbar.getParent() != full) {
            // a view added to the WindowManager has a ViewRootImpl parent, not a ViewGroup
            if (!(toolbar.getParent() instanceof android.view.ViewGroup) && toolbar.isAttachedToWindow()) wm.removeViewImmediate(toolbar);
            FrameLayout.LayoutParams dock = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.START);
            full.addView(toolbar, dock);
        }
        WebHost.attach(full, this);
        toolbar.bringToFront();
        Insets.dockToolbar(toolbar.getHeight());
    }

    private void closeFull() {
        if (full == null) return;
        WebHost.detach(full);
        if (toolbar.getParent() == full) { full.removeView(toolbar); wm.addView(toolbar, lp); }
        if (full.isAttachedToWindow()) wm.removeViewImmediate(full);
        full = null;
        Insets.dockToolbar(0);
    }

    /** Drag the toolbar by its console button; a short touch is a tap. Settles on the nearer side, remembers the height. */
    private final class Drag implements View.OnTouchListener {
        float downX, downY; int startY; boolean moved;

        @Override public boolean onTouch(View v, MotionEvent e) {
            if (OverlayRules.EXPANDED.equals(state)) return false;
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: downX = e.getRawX(); downY = e.getRawY(); startY = lp.y; moved = false; return false;
                case MotionEvent.ACTION_MOVE:
                    if (Math.abs(e.getRawY() - downY) > dp(6) || Math.abs(e.getRawX() - downX) > dp(6)) moved = true;
                    if (moved) { lp.y = Math.max(Insets.safeTopPx, startY + Math.round(e.getRawY() - downY)); wm.updateViewLayout(toolbar, lp); }
                    return moved;
                case MotionEvent.ACTION_UP:
                    if (!moved) return false;
                    int w = getResources().getDisplayMetrics().widthPixels, h = getResources().getDisplayMetrics().heightPixels;
                    Map<String, Object> m = new java.util.HashMap<>();
                    m.put("on", config.on); m.put("size", config.size); m.put("expand", config.expand); m.put("idleOpacity", config.idleOpacity);
                    m.put("edge", OverlayRules.edgeAfterDrag(Math.round(e.getRawX()), w));
                    m.put("top", OverlayRules.topAfterDrag(lp.y, h));
                    configure(OverlayService.this, m);
                    // the page saves the new place into approvals-banner.overlay.edge / .top (the console's own settings)
                    NativeBridge.emit("overlay.moved", "{\"edge\":\"" + config.edge + "\",\"top\":" + config.top + "}");
                    return true;
                default: return false;
            }
        }
    }

    /** Notification channel for the running toolbar (low importance: no sound, no peeking). */
    static void channel(NotificationManager nm) {
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Floating toolbar", NotificationManager.IMPORTANCE_MIN));
    }
}
