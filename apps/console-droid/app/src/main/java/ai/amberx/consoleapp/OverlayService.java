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
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The floating toolbar over every app (Brett, Nov 13 2026: "keep it floating on top"), ported from AmberX's
 * {@code ApprovalOverlay} and slimmed to what only native code can do. Three states ({@link OverlayRules}):
 *
 * - **Toolbar**: a small bar (console button, approvals badge) at the side of the screen; drag it anywhere, it settles
 *   on the nearer side and remembers the height.
 * - **Approvals**: the approval bar opened out of the toolbar with what waits and an "Open approvals" link to
 *   axHub's approvals page.
 * - **Expanded**: the full-screen console (the app's one WebView, {@link WebHost}) in an overlay window with the
 *   toolbar docked top-left, in front of whatever app was showing. One tap collapses it to the toolbar again.
 *
 * What waits is axHub's live list, read by the shell itself ({@link ApprovalFeed}), never a count kept here. A new
 * item pops its card at once: the overlay expands onto the console's own approval card (Approve / Deny, the
 * countdown) over whatever is on screen, and folds back once nothing waits ({@link OverlayRules#afterFeed}).
 *
 * A foreground service: it keeps the process (and so the console page and its live stream) running while another app
 * is on screen. Everything is reachable without touching it: {@code axfNative.overlay.*} in the page, and the intents
 * {@link #ACTION_VERB} (expand / collapse / toggle / approvals) from deep links and the CLI's adb path.
 */
public class OverlayService extends Service {
    static final String ACTION_VERB = OverlayContract.INTENT_ACTION;
    static final String EXTRA_VERB = OverlayContract.INTENT_EXTRA;
    static final String CHANNEL = "overlay";
    static final int NOTE_ID = 1;

    static OverlayService running;
    static OverlayRules.Config config = new OverlayRules.Config();
    static String state = OverlayRules.TOOLBAR;
    static int waiting, held;
    /** How many approvals waited when the bar was dismissed: it stays closed until a new one arrives. */
    static int dismissedAt;
    static String firstTitle = "";
    /** What waits, one by one (the hub's list; the page's {@code overlayItems} until the hub answers); soonest first. */
    static List<OverlayRules.Item> items = new ArrayList<>();
    static boolean haveItems;
    /** The overlay expanded by itself to show a card: it folds back once nothing waits. A tap on the toolbar clears it. */
    static boolean expandedForCard;
    /** Ids already shown in the bar or dismissed: they don't pop it again. */
    static final Set<String> seen = new HashSet<>();

    private WindowManager wm;
    private LinearLayout toolbar;
    private TextView consoleBtn, badge, label, bar, link, dismiss;
    /** Re-renders the countdowns once a second while a held command counts down. */
    private final Handler tick = new Handler(Looper.getMainLooper());
    private final Runnable ticker = this::everySecond;
    private boolean folding;
    private final Runnable fold = () -> { folding = false; if (OverlayRules.foldsWhenClear(state, expandedForCard, items)) show(OverlayRules.TOOLBAR); };
    /** The screen came back on or the phone was unlocked: the list is read again before anything shows. */
    private final android.content.BroadcastReceiver screen = new android.content.BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { ApprovalFeed.syncNow(); }
    };
    private WindowManager.LayoutParams lp;
    private FrameLayout full;
    private WindowManager.LayoutParams fullLp;

    // ---- control from the app, the bridge and intents ------------------------------------------------------------

    /** Starts the toolbar when it is on and "Display over other apps" is granted. */
    static void startIfWanted(Context c) {
        if (running != null || !config.on || !Perms.has(c, Perms.OVERLAY)) return;
        Intent i = new Intent(c, OverlayService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (IllegalStateException | SecurityException e) {
            // Android 12+ refuses a foreground service start from the background (a process woken by another app's
            // call, e.g. Phone Connect's hand-off): the caller sees running == null and falls back.
            android.util.Log.w("OverlayService", "toolbar not started: " + e);
        }
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
                if (OverlayContract.PASSIVE_VERBS.contains(verb)) return;
                if (OverlayContract.APPROVALS_VERB.equals(verb)) openApprovalsPage(c);
                c.startActivity(new Intent(c, ConsoleActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            }
        }
        expandedForCard = false; // his own move: the overlay stays where he puts it
        if (OverlayContract.DISMISS.equals(verb)) { dismissedAt = waiting; markSeen(); }
        if (OverlayContract.APPROVALS_VERB.equals(verb)) openApprovalsPage(c);
        running.show(OverlayRules.verb(state, verb));
    }

    /** axHub's approvals page in the one WebView (it keeps its place when it already shows). */
    private static void openApprovalsPage(Context c) {
        String page = OverlayRules.approvalsPage(NativeBridge.currentUrl);
        if (page != null) WebHost.open(c, page);
    }

    /**
     * A tap on the toolbar's button: the approvals page while something waits, the console when nothing does (the
     * approvals page an earlier tap left showing gives way to it), and fold when the overlay is expanded.
     */
    private void tapped() {
        String v = OverlayRules.tapVerb(state, waiting);
        String console = OverlayContract.EXPAND.equals(v) ? OverlayRules.consolePage(NativeBridge.currentUrl) : null;
        if (console != null) WebHost.open(this, console);
        verb(this, v);
    }

    /**
     * Opens an approval's card in the console ({@code id}: the hub's id; null: the first one waiting), for a card the
     * overlay pops by itself (a tap goes to axHub's approvals page instead, {@link #openApprovalsPage}). In the running
     * console it opens without a reload (the page runs approvals.view on this event); anywhere else (the offline page,
     * another site) the deep link loads the console on it.
     */
    private static void openApproval(Context c, String id) {
        if (ShellRules.onConsole(NativeBridge.currentUrl)) NativeBridge.emit(OverlayContract.EV_APPROVALS_OPEN, OverlayContract.openJson(id));
        else WebHost.open(c, OverlayContract.approvalsLink() + (id == null ? "" : ":" + id));
    }

    /** New settings from the page (the console's approvals-banner.overlay.* values). */
    static void configure(Context c, Map<String, Object> raw) {
        config = OverlayRules.config(raw);
        SharedPreferences.Editor e = c.getSharedPreferences("overlay", MODE_PRIVATE).edit();
        e.putBoolean("on", config.on).putString("edge", config.edge).putInt("top", config.top).putString("size", config.size)
            .putString("expand", config.expand).putInt("idleOpacity", config.idleOpacity).putString("show", config.show).apply();
        if (!config.on) { stop(c); return; }
        if (running == null) startIfWanted(c); else running.restyle();
    }

    /**
     * The page's count changed: a reason to read the hub's list now. The count itself is only used by a shell that has
     * no list yet (the hub hasn't answered and the page sent no items).
     */
    static void approvals(int count, int heldCount, String title) {
        ApprovalFeed.syncNow();
        if (haveItems || ApprovalFeed.ok()) return;
        waiting = Math.max(0, count);
        held = Math.max(0, heldCount);
        firstTitle = title == null ? "" : title;
        dismissedAt = OverlayRules.dismissedAfter(dismissedAt, waiting);
        if (running != null) running.show(OverlayRules.afterApprovals(state, config, waiting, held, dismissedAt));
    }

    /**
     * The page's items ({@code overlayItems}) changed: a reason to read the hub's list now. They are shown themselves
     * only while the hub hasn't answered the shell (the page then is the one source there is).
     */
    static void pageItems(List<OverlayRules.Item> in) {
        ApprovalFeed.syncNow();
        if (!ApprovalFeed.ok()) items(in);
    }

    /** A reading of the hub's list ({@link ApprovalFeed}): the toolbar shows exactly that. */
    static void feed(ApprovalFeedRules.Result r) {
        List<OverlayRules.Item> next = ApprovalFeedRules.after(items, r, System.currentTimeMillis());
        if (r.ok() || next.size() != items.size()) items(next);
    }

    /**
     * What waits now. The counts and the badge are derived from this list every time, never kept apart from it. An
     * unseen item pops its card: over another app the overlay expands onto the console's approval card; with the app
     * in front the page shows the card itself and the toolbar opens its bar.
     */
    static void items(List<OverlayRules.Item> in) {
        items = OverlayRules.order(in);
        haveItems = true;
        waiting = items.size();
        held = OverlayRules.heldCount(items);
        firstTitle = items.isEmpty() ? "" : items.get(0).title;
        OverlayRules.forget(seen, items);
        dismissedAt = OverlayRules.dismissedAfter(dismissedAt, waiting);
        if (running == null) return;
        if (OverlayRules.EXPANDED.equals(state)) markSeen(); // the console is on screen: he has seen what waits
        boolean pageOnScreen = ContentUpdate.appVisible;
        OverlayRules.Item card = OverlayRules.cardFor(config, items, seen);
        String next = OverlayRules.afterFeed(state, config, items, seen, pageOnScreen);
        running.foldWhenClear();
        if (next.equals(state)) { running.refresh(); return; }
        if (OverlayRules.EXPANDED.equals(next)) {
            expandedForCard = true;
            markSeen();
            openApproval(running, card == null ? null : card.ref());
        }
        running.show(next);
    }

    /** A card the overlay popped by itself is done with (decided, or it ran): fold back shortly, unless something new waits. */
    private void foldWhenClear() {
        boolean clear = OverlayRules.foldsWhenClear(state, expandedForCard, items);
        if (clear == folding) return;
        folding = clear;
        if (clear) tick.postDelayed(fold, OverlayRules.FOLD_AFTER_MS); else tick.removeCallbacks(fold);
    }

    static void markSeen() { for (OverlayRules.Item i : items) seen.add(i.id); }

    /** The toolbar's label: the next countdown or how many wait (from the counts when the page sent no items). */
    static String label() {
        if (haveItems) return OverlayRules.toolbarLabel(config, items, System.currentTimeMillis());
        return waiting > 0 ? waiting + " waiting" : "";
    }

    /** The overlay's state for every API ({@link OverlayContract#stateJson}: the {@code overlay} event, {@code overlayState()}, {@code native.state}). */
    static String stateJson() {
        return OverlayContract.stateJson(running != null, state, waiting, held, dismissedAt, config, label());
    }

    static void loadConfig(Context c) {
        SharedPreferences p = c.getSharedPreferences("overlay", MODE_PRIVATE);
        config.on = p.getBoolean("on", true);
        config.edge = p.getString("edge", "end");
        config.top = p.getInt("top", 30);
        config.size = p.getString("size", "small");
        config.expand = p.getString("expand", "every");
        config.idleOpacity = p.getInt("idleOpacity", 85);
        config.show = p.getString("show", "next");
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
        show(OverlayRules.afterApprovals(OverlayRules.TOOLBAR, config, waiting, held, dismissedAt));
        NativeBridge.emit("overlay", stateJson());
        android.content.IntentFilter woke = new android.content.IntentFilter(Intent.ACTION_SCREEN_ON);
        woke.addAction(Intent.ACTION_USER_PRESENT);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screen, woke, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(screen, woke);
        ApprovalFeed.start(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_VERB.equals(intent.getAction())) verb(this, intent.getStringExtra(EXTRA_VERB));
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        ApprovalFeed.stop();
        try { unregisterReceiver(screen); } catch (IllegalArgumentException ignored) { /* never registered */ }
        tick.removeCallbacks(ticker);
        tick.removeCallbacks(fold);
        closeFull();
        if (toolbar != null && toolbar.isAttachedToWindow()) wm.removeViewImmediate(toolbar);
        running = null;
        state = OverlayRules.TOOLBAR;
        expandedForCard = false;
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
        consoleBtn = button(getString(R.string.overlay_console), v -> tapped());
        badge = button("", v -> verb(this, "approvals"));
        label = button("", v -> verb(this, "approvals"));
        bar = button("", v -> verb(this, "approvals"));
        link = button(getString(R.string.overlay_open_approvals), v -> verb(this, "approvals"));
        link.setPaintFlags(link.getPaintFlags() | android.graphics.Paint.UNDERLINE_TEXT_FLAG);
        dismiss = button(getString(R.string.overlay_dismiss_glyph), v -> verb(this, "dismiss"));
        dismiss.setContentDescription(getString(R.string.overlay_dismiss));
        toolbar.addView(consoleBtn);
        toolbar.addView(badge);
        toolbar.addView(label);
        toolbar.addView(bar);
        toolbar.addView(link);
        toolbar.addView(dismiss);
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
        for (TextView t : new TextView[] { consoleBtn, badge, label, bar, link, dismiss }) {
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
        link.setTextColor(ShellTheme.accent);
        int[] ins = screenInsets();
        int screenH = screenHeight();
        lp.gravity = Gravity.TOP | ("start".equals(config.edge) ? Gravity.START : Gravity.END);
        lp.x = SafeArea.toolbarX(config.edge, ins); // clear of a side cutout or navigation bar (landscape)
        lp.y = SafeArea.toolbarY(config.top, screenH, toolbar.getHeight(), ins);
        if (toolbar.getParent() == full && full != null) {
            int[] d = SafeArea.dock(ins); // docked top-left inside the safe area
            FrameLayout.LayoutParams dl = (FrameLayout.LayoutParams) toolbar.getLayoutParams();
            if (dl != null && (dl.leftMargin != d[0] || dl.topMargin != d[1])) { dl.leftMargin = d[0]; dl.topMargin = d[1]; toolbar.setLayoutParams(dl); }
        }
        toolbar.setAlpha(OverlayRules.opacity(config, waiting) / 100f);
        if (toolbar.isAttachedToWindow() && !OverlayRules.EXPANDED.equals(state)) wm.updateViewLayout(toolbar, lp);
        if (full != null) full.setBackgroundColor(ShellTheme.bg);
    }

    /** The screen's insets {top, right, bottom, left} px for the toolbar window (it has no insets listener of its own). */
    private int[] screenInsets() {
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets i = wm.getCurrentWindowMetrics().getWindowInsets()
                .getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout() | android.view.WindowInsets.Type.ime());
            return new int[] { i.top, i.right, i.bottom, i.left };
        }
        int[] last = Insets.now();
        return new int[] { Math.max(last[0], Insets.safeTopPx), last[1], last[2], last[3] };
    }

    /** The whole screen's height (the overlay window may cover the bars). */
    private int screenHeight() {
        if (Build.VERSION.SDK_INT >= 30) return wm.getCurrentWindowMetrics().getBounds().height();
        return getResources().getDisplayMetrics().heightPixels;
    }

    /** Rotation, a fold, a new cutout side: the toolbar moves back inside the safe area. */
    @Override public void onConfigurationChanged(android.content.res.Configuration c) {
        super.onConfigurationChanged(c);
        restyle();
    }

    /** Moves to a state: toolbar, toolbar + approval bar, or the full-screen console with the toolbar docked. */
    void show(String next) {
        boolean moved = !state.equals(next);
        state = next == null ? OverlayRules.TOOLBAR : next;
        if (!OverlayRules.EXPANDED.equals(state)) expandedForCard = false;
        if (moved) ApprovalFeed.syncNow(); // folded, expanded, back in front: the hub's list is read again
        if (OverlayRules.APPROVALS.equals(state)) markSeen(); // shown once: it doesn't pop the bar again
        render();
        scheduleTick();
        consoleBtn.setText(OverlayRules.EXPANDED.equals(state) ? getString(R.string.overlay_collapse) : getString(R.string.overlay_console));
        if (OverlayRules.EXPANDED.equals(state)) openFull(); else closeFull();
        restyle();
        NativeBridge.emit("overlay", stateJson());
        ContentUpdate.visibility(); // expanded = the console is on screen
    }

    /** The state and counts the page last heard ({@link #refresh}). */
    private String told = "";

    /** The same state with a new reading of the list: the badge, the label and the bar follow; the page hears a new count. */
    private void refresh() {
        render();
        scheduleTick();
        toolbar.setAlpha(OverlayRules.opacity(config, waiting) / 100f);
        String key = state + ":" + waiting + ":" + held;
        if (key.equals(told)) return;
        told = key;
        NativeBridge.emit("overlay", stateJson());
    }

    /** Once a second while a countdown runs: the clock moves, and a command whose countdown ended is looked up again. */
    private void everySecond() {
        long now = System.currentTimeMillis();
        boolean ended = false;
        for (OverlayRules.Item i : items) ended |= i.timed() && now >= i.runsAt;
        if (ended) ApprovalFeed.syncNow();
        List<OverlayRules.Item> live = OverlayRules.unexpired(items, now);
        if (!ApprovalFeed.ok() && live.size() != items.size()) { items(live); return; }
        render();
        scheduleTick();
    }

    /** The badge, the toolbar label and the bar's line (the countdowns): run on every change and once a second. */
    private void render() {
        long now = System.currentTimeMillis();
        String b = OverlayRules.badge(waiting);
        badge.setText(b);
        badge.setVisibility(b.isEmpty() ? View.GONE : View.VISIBLE);
        badge.setContentDescription(getString(R.string.overlay_open_approvals));
        boolean barOn = OverlayRules.APPROVALS.equals(state);
        String l = label();
        label.setText(l);
        // the label shows on the small toolbar; with the bar open the bar says it
        label.setVisibility(!l.isEmpty() && OverlayRules.TOOLBAR.equals(state) ? View.VISIBLE : View.GONE);
        label.setContentDescription(getString(R.string.overlay_open_approvals));
        bar.setText(!barOn ? "" : haveItems ? OverlayRules.barText(items, now) : OverlayRules.barText(waiting, firstTitle));
        bar.setContentDescription(getString(R.string.overlay_open_approvals));
        for (View v : new View[] { bar, link, dismiss }) v.setVisibility(barOn ? View.VISIBLE : View.GONE);
    }

    private void scheduleTick() {
        tick.removeCallbacks(ticker);
        if (OverlayRules.ticking(items)) tick.postDelayed(ticker, 1000);
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
            if (Build.VERSION.SDK_INT >= 30) fullLp.setFitInsetsTypes(0); // the whole screen; Insets keeps the console clear of the bars
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
        toolbar.post(() -> Insets.dockToolbar(toolbar.getHeight())); // measured after layout
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
                    if (moved) { lp.y = SafeArea.clampY(startY + Math.round(e.getRawY() - downY), screenHeight(), toolbar.getHeight(), screenInsets()); wm.updateViewLayout(toolbar, lp); }
                    return moved;
                case MotionEvent.ACTION_UP:
                    if (!moved) return false;
                    int w = getResources().getDisplayMetrics().widthPixels, h = screenHeight();
                    Map<String, Object> m = new java.util.HashMap<>();
                    m.put("on", config.on); m.put("size", config.size); m.put("expand", config.expand); m.put("idleOpacity", config.idleOpacity); m.put("show", config.show);
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
