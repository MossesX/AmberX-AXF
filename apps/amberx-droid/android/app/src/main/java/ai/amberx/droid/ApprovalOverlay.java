package ai.amberx.droid;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The one AmberX overlay: an always-on floating toolbar over every app that spawns the approval bar when something
 * waits and expands into a full-screen browser that Amber drives.
 *
 * - **Toolbar.** On screen whenever the overlay is on and "Display over other apps" is granted, including after a
 *   restart (the watch service keeps it up). Drag it anywhere: it settles on the nearer side and remembers the height.
 *   Because this window is always visible, Android counts AmberX as in the foreground, so pages open from the
 *   background without a notification tap ({@link AxppLink}).
 * - **Approval bar.** When an approval, a held command's countdown or a confirm waits, the bar opens out of the toolbar:
 *   what it is, why, the countdown and Approve / Deny (Shelve for held calls); it folds back when nothing is left.
 * - **Full-screen browser.** A tap on the toolbar, {@code overlay.expand}, {@code overlay.open} or any AI open request
 *   expands it into a full-screen browser (the app's own cookie jar, so signed in to the console and axHub) with the
 *   toolbar docked in the top-left corner: back, reload, Chrome and collapse. The console inside it is a live console,
 *   so Amber drives it through console-command@1 / control@1 while Brett watches. One tap collapses it to the toolbar.
 *   Only Brett's own sites load inside ({@link OverlayPageRules}); other links go to Chrome.
 *
 * Its rules and settings are {@link ApprovalOverlayRules} and {@link OverlayPageRules}; the watch service feeds it every
 * approvals read and runs its buttons with the phone's hub session. Colours follow the active skin (the theme tokens the
 * web side sends). Everything is reachable without the UI: the native {@code approvalOverlaySet / State / Command}, the
 * console API, MCP, the CLI and voice ({@code overlay.expand}, {@code overlay.collapse}, {@code overlay.open}).
 */
final class ApprovalOverlay {
    /** Runs one approval button off the main thread; [done] gets whether the hub took it. */
    interface Actor { void act(ApprovalOverlayRules.Item item, String action, java.util.function.Consumer<Boolean> done); }

    private final Context ctx;
    private final Actor actor;
    private final WindowManager wm;
    private final WindowManager.LayoutParams lp;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LinearLayout root, bar, card, buttons;
    private final TextView dot, label, foldBtn, expandBtn, backBtn, reloadBtn, outBtn, collapseBtn, kind, detailsBtn, pager, what, why, countdown, status;
    /** The full-screen browser: null while it is just the toolbar. */
    private WebView web;
    private String pageUrl = "", pageTitle = "";
    /** The page showing now, for the bridge (read off the main thread). */
    private volatile String liveUrl = "";
    private volatile int waitingCount;
    /** Whether the window was last laid out as the browser (full screen) or the toolbar. */
    private boolean placedBrowser;
    private ApprovalOverlayRules.Settings settings = ApprovalOverlayRules.settings(null);
    private List<ApprovalOverlayRules.Item> items = new ArrayList<>();
    /** Ids the approval bar already opened for (or Brett folded away): they don't open it again. */
    private final Set<String> seen = new HashSet<>();
    private boolean shown, barOpen, busy;
    private int index;
    private long emptySince;
    private int bg = Color.parseColor("#1e1e24"), fg = Color.parseColor("#f2f2f5"), accent = Color.parseColor("#e8a33d"),
        muted = Color.parseColor("#8a8a96"), danger = Color.parseColor("#e5484d");
    private final Runnable tick = this::render;

    ApprovalOverlay(Context ctx, Actor actor) {
        this.ctx = ctx;
        this.actor = actor;
        wm = ctx.getSystemService(WindowManager.class);
        lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);

        root = new LinearLayout(ctx) {
            // The back key reaches the window only while the browser is open (then it is focusable): back a page, else collapse.
            @Override public boolean dispatchKeyEvent(KeyEvent e) {
                if (web != null && e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
                    if (e.getAction() == KeyEvent.ACTION_UP) {
                        if ("back".equals(OverlayPageRules.back(web.canGoBack()))) web.goBack(); else collapse();
                    }
                    return true;
                }
                return super.dispatchKeyEvent(e);
            }
        };
        root.setOrientation(LinearLayout.VERTICAL);

        bar = new LinearLayout(ctx);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        dot = text(12, true);
        dot.setText("●");
        label = text(13, true);
        label.setPadding(dp(6), 0, dp(4), 0);
        label.setSingleLine(true);
        label.setEllipsize(TextUtils.TruncateAt.END);
        foldBtn = button("▸", "Approval bar", v -> toggleBar());
        expandBtn = button("⤢", "Expand to full screen", v -> expand());
        backBtn = button("‹", "Back", v -> { if (web != null && web.canGoBack()) web.goBack(); });
        reloadBtn = button("↻", "Reload", v -> { if (web != null) web.reload(); });
        outBtn = button("Chrome", "Open in Chrome", v -> { String u = pageUrl; collapse(); openOutside(u); });
        collapseBtn = button("⤡", "Collapse to the toolbar", v -> collapse());
        bar.addView(dot);
        bar.addView(label);
        for (TextView b : new TextView[] { foldBtn, expandBtn, backBtn, reloadBtn, outBtn, collapseBtn }) bar.addView(b);
        bar.setOnTouchListener(new Drag());
        root.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        card = new LinearLayout(ctx);
        card.setOrientation(LinearLayout.VERTICAL);
        LinearLayout head = new LinearLayout(ctx);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        kind = text(11, true);
        detailsBtn = button("Details", "Open it in AmberX", v -> openApp());
        pager = button("›", "Next waiting", v -> { if (!items.isEmpty()) { index = (index + 1) % items.size(); render(); } });
        head.addView(kind, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        head.addView(detailsBtn);
        head.addView(pager);
        card.addView(head);
        what = text(14, true);
        what.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        what.setMaxLines(4);
        what.setEllipsize(TextUtils.TruncateAt.END);
        card.addView(what);
        why = text(12, false);
        why.setMaxLines(3);
        why.setEllipsize(TextUtils.TruncateAt.END);
        card.addView(why);
        countdown = text(13, true);
        card.addView(countdown);
        buttons = new LinearLayout(ctx);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        card.addView(buttons);
        status = text(11, false);
        card.addView(status);
        root.addView(card, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        card.setVisibility(View.GONE);
    }

    /* ---------------------------------------------------------------- inputs */

    void setSettings(ApprovalOverlayRules.Settings s) {
        settings = s;
        place();
        render();
    }

    void setColors(JSONObject c) {
        if (c == null) return;
        bg = color(c.optString("bg"), bg);
        fg = color(c.optString("fg"), fg);
        accent = color(c.optString("accent"), accent);
        muted = color(c.optString("muted"), muted);
        danger = color(c.optString("danger"), danger);
        render();
    }

    /** Every approvals read: what waits now. Opens the approval bar for anything new, folds it when nothing is left. */
    void update(List<ApprovalOverlayRules.Item> now) {
        String current = index < items.size() ? items.get(index).id : null;
        items = now;
        waitingCount = now.size();
        index = 0;
        for (int i = 0; current != null && i < items.size(); i++) if (items.get(i).id.equals(current)) index = i;
        if (ApprovalOverlayRules.shouldExpand(settings, items, seen)) {
            // Jump to the newest arrival that opens it.
            for (int i = 0; i < items.size(); i++) {
                ApprovalOverlayRules.Item it = items.get(i);
                if (!seen.contains(it.id) && ApprovalOverlayRules.opensFor(settings, it)) { index = i; break; }
            }
            barOpen = true;
        }
        for (ApprovalOverlayRules.Item it : items) seen.add(it.id);
        Set<String> live = new HashSet<>();
        for (ApprovalOverlayRules.Item it : items) live.add(it.id);
        seen.retainAll(live);
        if (items.isEmpty()) { if (emptySince == 0) emptySince = System.currentTimeMillis(); }
        else emptySince = 0;
        render();
    }

    /** Opens (true) or folds (false) the approval bar, from the toolbar, the API or voice. */
    void setBarOpen(boolean on) { barOpen = on && !items.isEmpty(); render(); }

    /** True while the toolbar window is on screen (what lets AmberX start pages from the background). */
    boolean shown() { return shown; }

    /** State for the API: shown, expanded (full-screen browser), the approval bar, the settings and everything waiting. */
    JSONObject state() {
        JSONArray list = new JSONArray();
        long now = System.currentTimeMillis();
        for (ApprovalOverlayRules.Item it : items) list.put(it.toJson(now));
        JSONObject o = new JSONObject();
        try {
            o.put("settings", settings.toJson()).put("shown", shown).put("expanded", web != null).put("approvalBar", barOpen)
                .put("index", index).put("label", ApprovalOverlayRules.toolbarLabel(settings, items, now)).put("items", list)
                .put("browser", new JSONObject().put("url", web != null ? pageUrl : "")
                    .put("title", web != null ? OverlayPageRules.title(pageUrl, pageTitle) : "").put("last", pageUrl));
        } catch (Exception ignored) {}
        return o;
    }

    /** Runs an approval action on the item [id] (or the one on the bar when null), as the buttons do. */
    void act(String id, String action) {
        for (ApprovalOverlayRules.Item it : items) {
            if ((id == null ? it == current() : it.id.equals(id)) && it.actions.contains(action)) { run(it, action); return; }
        }
    }

    void hide() {
        main.removeCallbacks(tick);
        dropWeb();
        if (!shown) return;
        try { wm.removeView(root); } catch (Exception ignored) {}
        shown = false;
    }

    /* ---------------------------------------------------------------- the full-screen browser */

    /** The page the browser showed last (what expanding reopens), empty when none. */
    String lastPage() { return pageUrl; }

    /** True while the toolbar is expanded into the full-screen browser. */
    boolean expanded() { return web != null; }

    /** Expands into the full-screen browser on the last page (else the console). */
    boolean expand() { return open(OverlayPageRules.expandUrl(pageUrl)); }

    /**
     * Expands into the full-screen browser on one of Brett's pages (the toolbar docks in the top-left corner). The URL
     * must pass {@link OpenUrlRules#allowed}; returns false when the overlay can't show (off, or not allowed to draw).
     */
    boolean open(String url) {
        String u = OpenUrlRules.allowed(url);
        if (!settings.on || !DetectionOverlay.canDraw(ctx)) return false;
        if (web == null) {
            web = newWeb();
            root.addView(web, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        }
        pageUrl = u;
        liveUrl = u;
        pageTitle = "";
        web.loadUrl(u);
        render();
        changed();
        return shown;
    }

    /** Collapses the browser: just the floating toolbar again (the last page is kept for the next expand). */
    void collapse() {
        if (web == null) return;
        dropWeb();
        render();
        changed();
    }

    private void dropWeb() {
        if (web == null) return;
        WebView w = web;
        web = null;
        liveUrl = "";
        try { root.removeView(w); w.stopLoading(); w.destroy(); } catch (Exception ignored) {}
        CookieManager.getInstance().flush();
    }

    @android.annotation.SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    private WebView newWeb() {
        WebView w = new WebView(ctx);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true); // Brett's own web apps (console, axHub); navigation stays on his sites below
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        // The console inside can collapse the overlay or open another of Brett's pages (overlay.collapse / overlay.open
        // run there when Amber drives it); every call checks the page showing is one of his sites.
        w.addJavascriptInterface(new Bridge(), OverlayPageRules.BRIDGE);
        w.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String u = req.getUrl().toString();
                if (OverlayPageRules.staysInside(u)) return false;
                openOutside(u); // a link off Brett's sites: Chrome, the browser stays as it is
                return true;
            }
            @android.annotation.TargetApi(26)
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // The page's renderer died: collapse to the toolbar instead of taking AmberX down.
                main.post(() -> {
                    if (view == web) collapse();
                    else { try { view.destroy(); } catch (Exception ignored) {} }
                });
                return true;
            }
            @Override public void doUpdateVisitedHistory(WebView view, String u, boolean reload) {
                if (view == web) liveUrl = u == null ? "" : u;
            }
            @Override public void onPageFinished(WebView view, String u) {
                if (view != web) return;
                liveUrl = u == null ? "" : u;
                if (OverlayPageRules.staysInside(u)) pageUrl = u;
                render();
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override public void onReceivedTitle(WebView view, String t) {
                if (view != web) return;
                pageTitle = t == null ? "" : t;
                render();
            }
        });
        return w;
    }

    /** What the console inside the browser may call (window.AmberxOverlay). Runs on a WebView thread. */
    private final class Bridge {
        @JavascriptInterface public void collapse() {
            if (OverlayPageRules.bridgeAllowed(liveUrl)) main.post(ApprovalOverlay.this::collapse);
        }
        @JavascriptInterface public void open(String url) {
            if (!OverlayPageRules.bridgeAllowed(liveUrl) || !OverlayPageRules.staysInside(url)) return;
            main.post(() -> { try { ApprovalOverlay.this.open(url); } catch (IllegalArgumentException ignored) {} });
        }
        @JavascriptInterface public String state() {
            if (!OverlayPageRules.bridgeAllowed(liveUrl)) return "{}";
            try { return new JSONObject().put("expanded", true).put("url", liveUrl).put("waiting", waitingCount).toString(); }
            catch (Exception e) { return "{}"; }
        }
    }

    private void openOutside(String url) {
        if (url == null || url.isEmpty()) return;
        Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { ctx.startActivity(i); } catch (Exception ignored) {}
    }

    private void changed() { AmberxNativePlugin.approvalOverlayChanged(state()); }

    /* ---------------------------------------------------------------- drawing */

    private ApprovalOverlayRules.Item current() { return index < items.size() ? items.get(index) : null; }

    private void toggleBar() {
        if (barOpen) { for (ApprovalOverlayRules.Item it : items) seen.add(it.id); barOpen = false; }
        else barOpen = !items.isEmpty();
        render();
    }

    private void place() {
        if (web != null) {
            // Full-screen browser: the whole screen, focusable so the keyboard and the back key reach the page.
            lp.gravity = Gravity.TOP | Gravity.START;
            lp.x = 0;
            lp.y = 0;
            lp.width = WindowManager.LayoutParams.MATCH_PARENT;
            lp.height = WindowManager.LayoutParams.MATCH_PARENT;
            lp.flags = 0;
        } else {
            lp.width = WindowManager.LayoutParams.WRAP_CONTENT;
            lp.height = WindowManager.LayoutParams.WRAP_CONTENT;
            lp.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
            boolean start = "start".equals(settings.edge);
            lp.gravity = Gravity.TOP | (start ? Gravity.START : Gravity.END);
            lp.x = dp(8);
            lp.y = Math.round(screenH() * settings.top / 100f);
        }
        if (shown) { try { wm.updateViewLayout(root, lp); } catch (Exception ignored) {} }
    }

    private void render() {
        long now = System.currentTimeMillis();
        boolean empty = items.isEmpty();
        if (empty && barOpen && now - emptySince >= settings.shrinkAfterSec * 1000L) barOpen = false;
        boolean browser = web != null;
        // Always on screen while it is on: the visible window is what keeps AmberX able to open pages.
        if (!settings.on || !DetectionOverlay.canDraw(ctx)) { hide(); return; }
        float k = ApprovalOverlayRules.scale(settings.size);
        int pad = Math.round(dp(10) * k);
        root.setPadding(browser ? 0 : pad, Math.round(dp(6) * k), browser ? 0 : pad, browser ? 0 : Math.round(dp(6) * k));
        root.setBackground(panel(browser ? 0 : dp(barOpen ? 16 : 999), browser ? Color.TRANSPARENT : muted));
        root.setAlpha(empty && !barOpen && !browser ? settings.idleOpacity / 100f : 1f);
        // Docked in the top-left corner over the browser; the toolbar itself when collapsed.
        bar.setBackground(browser ? panel(dp(999), muted) : null);
        bar.setPadding(browser ? pad : 0, browser ? Math.round(dp(4) * k) : 0, browser ? Math.round(dp(6) * k) : 0, browser ? Math.round(dp(4) * k) : 0);
        ((LinearLayout.LayoutParams) bar.getLayoutParams()).setMarginStart(browser ? dp(8) : 0);
        sizeText(k);

        ApprovalOverlayRules.Item first = empty ? null : items.get(0);
        boolean urgent = first != null && first.held() && !first.shelved;
        dot.setTextColor(empty ? muted : urgent ? danger : accent);
        String approvals = ApprovalOverlayRules.toolbarLabel(settings, items, now);
        label.setText(browser ? OverlayPageRules.title(pageUrl, pageTitle) + (empty ? "" : " · " + approvals) : approvals);
        label.setTextColor(fg);
        label.setMaxWidth(Math.round(dp(browser ? 180 : 220) * k));
        foldBtn.setText(barOpen ? "▾" : "▸");
        foldBtn.setVisibility(empty ? View.GONE : View.VISIBLE);
        expandBtn.setVisibility(browser ? View.GONE : View.VISIBLE);
        for (TextView b : new TextView[] { backBtn, reloadBtn, outBtn, collapseBtn }) b.setVisibility(browser ? View.VISIBLE : View.GONE);
        backBtn.setEnabled(browser && web.canGoBack());
        backBtn.setAlpha(browser && web.canGoBack() ? 1f : 0.4f);
        for (TextView b : new TextView[] { foldBtn, expandBtn, backBtn, reloadBtn, outBtn, collapseBtn, detailsBtn, pager }) { b.setTextColor(fg); b.setBackground(outline()); }

        ApprovalOverlayRules.Item it = current();
        if (barOpen && it != null) {
            card.setVisibility(View.VISIBLE);
            card.setPadding(browser ? pad : 0, Math.round(dp(8) * k), browser ? pad : 0, browser ? Math.round(dp(8) * k) : 0);
            card.setBackground(browser ? panel(dp(16), muted) : null);
            LinearLayout.LayoutParams cl = (LinearLayout.LayoutParams) card.getLayoutParams();
            cl.setMarginStart(browser ? dp(8) : 0);
            cl.topMargin = browser ? dp(6) : 0;
            kind.setText((it.held() ? "HELD COMMAND" : "APPROVAL") + (items.size() > 1 ? " · " + (index + 1) + " of " + items.size() : ""));
            kind.setTextColor(it.held() && !it.shelved ? danger : accent);
            detailsBtn.setVisibility(it.held() ? View.VISIBLE : View.GONE);
            pager.setVisibility(items.size() > 1 ? View.VISIBLE : View.GONE);
            what.setText(it.what);
            what.setTextColor(fg);
            what.setMaxWidth(Math.round(dp(280) * k));
            why.setText(it.why);
            why.setVisibility(it.why.isEmpty() ? View.GONE : View.VISIBLE);
            why.setTextColor(muted);
            why.setMaxWidth(Math.round(dp(280) * k));
            countdown.setText(ApprovalOverlayRules.countdown(it, now));
            countdown.setTextColor(it.held() && !it.shelved ? danger : fg);
            countdown.setPadding(0, Math.round(dp(4) * k), 0, Math.round(dp(6) * k));
            buttons.removeAllViews();
            for (String a : it.actions) {
                TextView b = button(ApprovalOverlayRules.label(a), ApprovalOverlayRules.label(a), v -> run(it, a));
                b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13 * k);
                b.setPadding(Math.round(dp(14) * k), Math.round(dp(6) * k), Math.round(dp(14) * k), Math.round(dp(6) * k));
                boolean yes = "approve".equals(a) || "approve-now".equals(a);
                boolean no = "deny".equals(a) || "decline".equals(a);
                b.setBackground(yes ? pill(accent) : no ? pill(danger) : outline());
                b.setTextColor(yes || no ? bg : fg);
                b.setEnabled(!busy);
                buttons.addView(b);
            }
            status.setTextColor(muted);
            status.setVisibility(status.getText().length() == 0 ? View.GONE : View.VISIBLE);
        } else card.setVisibility(View.GONE);

        if (!shown || browser != placedBrowser) { placedBrowser = browser; place(); }
        if (!shown) {
            try { wm.addView(root, lp); shown = true; } catch (Exception ignored) { /* permission withdrawn meanwhile */ }
        }
        main.removeCallbacks(tick);
        boolean ticking = urgent || (empty && barOpen);
        if (ticking && shown) main.postDelayed(tick, 1000);
    }

    private void sizeText(float k) {
        dot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12 * k);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13 * k);
        for (TextView b : new TextView[] { foldBtn, expandBtn, backBtn, reloadBtn, outBtn, collapseBtn, detailsBtn, pager }) {
            b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12 * k);
            b.setPadding(Math.round(dp(10) * k), Math.round(dp(4) * k), Math.round(dp(10) * k), Math.round(dp(4) * k));
        }
        kind.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11 * k);
        what.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14 * k);
        why.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12 * k);
        countdown.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13 * k);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11 * k);
    }

    /* ---------------------------------------------------------------- actions */

    private void run(ApprovalOverlayRules.Item it, String action) {
        if (busy) return;
        busy = true;
        status.setText("Sending…");
        render();
        actor.act(it, action, ok -> main.post(() -> {
            busy = false;
            if (ok) {
                List<ApprovalOverlayRules.Item> left = new ArrayList<>();
                for (ApprovalOverlayRules.Item x : items) if (!x.id.equals(it.id) || "shelve".equals(action)) left.add(x);
                status.setText("shelve".equals(action) ? "Shelved." : "");
                update(left);
            } else {
                status.setText("Didn't go through: signed out of axHub or it was decided elsewhere.");
                render();
            }
        }));
    }

    /** A held call's full veto screen in AmberX. */
    private void openApp() {
        ApprovalOverlayRules.Item it = current();
        Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (it != null && it.held()) i.putExtra(MainActivity.EXTRA_VETO, it.id);
        collapse();
        try { ctx.startActivity(i); } catch (Exception ignored) {}
    }

    /* ---------------------------------------------------------------- pieces */

    private TextView text(int sp, boolean bold) {
        TextView t = new TextView(ctx);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private TextView button(String text, String description, View.OnClickListener click) {
        TextView b = text(12, true);
        b.setText(text);
        b.setContentDescription(description);
        b.setGravity(Gravity.CENTER);
        b.setOnClickListener(click);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.setMarginStart(dp(6));
        b.setLayoutParams(p);
        return b;
    }

    private GradientDrawable panel(int radius, int stroke) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(radius);
        if (stroke != Color.TRANSPARENT) d.setStroke(dp(1), stroke);
        return d;
    }

    private GradientDrawable pill(int c) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(c);
        d.setCornerRadius(dp(999));
        return d;
    }

    private GradientDrawable outline() {
        GradientDrawable d = pill(Color.TRANSPARENT);
        d.setStroke(dp(1), muted);
        return d;
    }

    private static int color(String hex, int fallback) {
        try { return hex == null || hex.isEmpty() ? fallback : Color.parseColor(hex); } catch (Exception e) { return fallback; }
    }

    private int dp(int v) { return Math.round(v * ctx.getResources().getDisplayMetrics().density); }

    private int screenW() { return ctx.getResources().getDisplayMetrics().widthPixels; }

    private int screenH() { return ctx.getResources().getDisplayMetrics().heightPixels; }

    /**
     * Drag the toolbar anywhere; when the finger lifts it settles on the nearer side and the side and height are saved.
     * A tap expands it into the full-screen browser (over the browser, a tap on the docked toolbar opens or folds the
     * approval bar). The buttons take their own taps.
     */
    private final class Drag implements View.OnTouchListener {
        private int x0, y0;
        private float fx, fy;
        private boolean moved;
        @Override public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    x0 = lp.x; y0 = lp.y; fx = e.getRawX(); fy = e.getRawY(); moved = false;
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    if (web != null) return true; // full screen: nothing to drag
                    float dx = e.getRawX() - fx, dy = e.getRawY() - fy;
                    if (!moved && Math.abs(dx) < dp(6) && Math.abs(dy) < dp(6)) return true;
                    moved = true;
                    boolean start = (lp.gravity & Gravity.HORIZONTAL_GRAVITY_MASK) == Gravity.START
                        || (lp.gravity & Gravity.HORIZONTAL_GRAVITY_MASK) == Gravity.LEFT;
                    lp.x = Math.max(0, x0 + Math.round(start ? dx : -dx));
                    lp.y = Math.max(0, y0 + Math.round(dy));
                    if (shown) { try { wm.updateViewLayout(root, lp); } catch (Exception ignored) {} }
                    return true;
                }
                case MotionEvent.ACTION_UP: {
                    if (!moved) {
                        if (web != null) toggleBar(); else expand();
                        return true;
                    }
                    boolean start = "start".equals(settings.edge);
                    int w = root.getWidth();
                    int left = start ? lp.x : screenW() - lp.x - w;
                    try {
                        WatchService.setApprovalOverlay(ctx, new JSONObject()
                            .put("edge", ApprovalOverlayRules.snapEdge(left, w, screenW()))
                            .put("top", ApprovalOverlayRules.topPercent(lp.y, screenH())));
                    } catch (Exception ignored) {}
                    return true;
                }
                default: return false;
            }
        }
    }
}
