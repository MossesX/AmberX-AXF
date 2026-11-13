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
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The approval overlay (Brett, Nov 13 2026: "Build me a overlay that expands with the approval every time one's sent. A
 * little overlay, like a little toolbar, but it expands when I need an approval."). A small floating toolbar over every
 * app that, the moment an approval or a held command arrives, opens into the full card: what, why, the countdown and
 * Approve / Deny (Shelve for held calls); when nothing is left it shrinks back to the toolbar.
 *
 * Its rules and settings are [ApprovalOverlayRules]; the watch service feeds it every approvals read and runs its buttons
 * with the phone's hub session. Colours follow the active skin (the theme tokens the web side sends, light or dark); every
 * setting is reachable without the UI (the native `approvalOverlaySet` / `approvalOverlayState`, the console API, MCP,
 * the CLI and voice). Needs "Display over other apps", like the detection overlay.
 */
final class ApprovalOverlay {
    /** Runs one card button off the main thread; [done] gets whether the hub took it. */
    interface Actor { void act(ApprovalOverlayRules.Item item, String action, java.util.function.Consumer<Boolean> done); }

    private final Context ctx;
    private final Actor actor;
    private final WindowManager wm;
    private final WindowManager.LayoutParams lp;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LinearLayout root, bar, card, buttons;
    private final TextView dot, label, foldBtn, openBtn, kind, pager, what, why, countdown, status;
    private ApprovalOverlayRules.Settings settings = ApprovalOverlayRules.settings(null);
    private List<ApprovalOverlayRules.Item> items = new ArrayList<>();
    /** Ids the card already opened for (or Brett folded away): they don't open it again. */
    private final Set<String> seen = new HashSet<>();
    private boolean shown, expanded, busy;
    private int index;
    private long emptySince;
    private int bg = Color.parseColor("#1e1e24"), fg = Color.parseColor("#f2f2f5"), accent = Color.parseColor("#e8a33d"),
        muted = Color.parseColor("#8a8a96"), danger = Color.parseColor("#e5484d");
    private final Runnable tick = this::onTick;

    ApprovalOverlay(Context ctx, Actor actor) {
        this.ctx = ctx;
        this.actor = actor;
        wm = ctx.getSystemService(WindowManager.class);
        lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);

        root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);

        bar = new LinearLayout(ctx);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        dot = text(12, true);
        dot.setText("●");
        label = text(13, true);
        label.setPadding(dp(6), 0, dp(4), 0);
        foldBtn = button("▾", v -> toggle());
        openBtn = button("Open", v -> openApp());
        bar.addView(dot);
        bar.addView(label);
        bar.addView(foldBtn);
        bar.addView(openBtn);
        bar.setOnTouchListener(new Drag());
        root.addView(bar);

        card = new LinearLayout(ctx);
        card.setOrientation(LinearLayout.VERTICAL);
        LinearLayout head = new LinearLayout(ctx);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        kind = text(11, true);
        pager = button("›", v -> { if (!items.isEmpty()) { index = (index + 1) % items.size(); render(); } });
        head.addView(kind, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
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
        root.addView(card);
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

    /** Every approvals read: what waits now. Opens the card for anything new, shrinks back when nothing is left. */
    void update(List<ApprovalOverlayRules.Item> now) {
        String current = index < items.size() ? items.get(index).id : null;
        items = now;
        index = 0;
        for (int i = 0; current != null && i < items.size(); i++) if (items.get(i).id.equals(current)) index = i;
        if (ApprovalOverlayRules.shouldExpand(settings, items, seen)) {
            // Jump to the newest arrival that opens it.
            for (int i = 0; i < items.size(); i++) {
                ApprovalOverlayRules.Item it = items.get(i);
                if (!seen.contains(it.id) && ApprovalOverlayRules.opensFor(settings, it)) { index = i; break; }
            }
            expanded = true;
        }
        for (ApprovalOverlayRules.Item it : items) seen.add(it.id);
        Set<String> live = new HashSet<>();
        for (ApprovalOverlayRules.Item it : items) live.add(it.id);
        seen.retainAll(live);
        if (items.isEmpty()) { if (emptySince == 0) emptySince = System.currentTimeMillis(); }
        else emptySince = 0;
        render();
    }

    /** Opens the card (true) or folds it to the toolbar (false), from the toolbar, the API or voice. */
    void setExpanded(boolean on) { expanded = on && !items.isEmpty(); render(); }

    boolean expanded() { return expanded; }

    /** State for the API: shown, expanded, the settings and everything waiting. */
    JSONObject state() {
        JSONObject o = settings.toJson();
        JSONArray list = new JSONArray();
        long now = System.currentTimeMillis();
        for (ApprovalOverlayRules.Item it : items) list.put(it.toJson(now));
        try {
            o = new JSONObject().put("settings", o).put("shown", shown).put("expanded", expanded).put("index", index)
                .put("label", ApprovalOverlayRules.toolbarLabel(settings, items, now)).put("items", list);
        } catch (Exception ignored) {}
        return o;
    }

    /** Runs a card action on the item [id] (or the one on the card when null), as the buttons do. */
    void act(String id, String action) {
        for (ApprovalOverlayRules.Item it : items) {
            if ((id == null ? it == current() : it.id.equals(id)) && it.actions.contains(action)) { run(it, action); return; }
        }
    }

    void hide() {
        main.removeCallbacks(tick);
        if (!shown) return;
        try { wm.removeView(root); } catch (Exception ignored) {}
        shown = false;
    }

    /* ---------------------------------------------------------------- drawing */

    private ApprovalOverlayRules.Item current() { return index < items.size() ? items.get(index) : null; }

    private void toggle() {
        if (expanded) { for (ApprovalOverlayRules.Item it : items) seen.add(it.id); expanded = false; }
        else expanded = !items.isEmpty();
        render();
    }

    private void place() {
        boolean start = "start".equals(settings.edge);
        lp.gravity = Gravity.TOP | (start ? Gravity.START : Gravity.END);
        lp.x = dp(8);
        lp.y = Math.round(ctx.getResources().getDisplayMetrics().heightPixels * settings.top / 100f);
        if (shown) { try { wm.updateViewLayout(root, lp); } catch (Exception ignored) {} }
    }

    private void render() {
        long now = System.currentTimeMillis();
        boolean empty = items.isEmpty();
        if (empty && expanded && now - emptySince >= settings.shrinkAfterSec * 1000L) expanded = false;
        boolean want = settings.on && DetectionOverlay.canDraw(ctx) && (!empty || settings.idleVisible || expanded);
        if (!want) { hide(); return; }
        float k = ApprovalOverlayRules.scale(settings.size);
        int pad = Math.round(dp(10) * k);
        root.setPadding(pad, Math.round(dp(6) * k), pad, Math.round(dp(6) * k));
        root.setBackground(panel());
        root.setAlpha(empty && !expanded ? settings.idleOpacity / 100f : 1f);
        sizeText(k);

        ApprovalOverlayRules.Item first = empty ? null : items.get(0);
        boolean urgent = first != null && first.held() && !first.shelved;
        dot.setTextColor(empty ? muted : urgent ? danger : accent);
        label.setText(ApprovalOverlayRules.toolbarLabel(settings, items, now));
        label.setTextColor(fg);
        foldBtn.setText(expanded ? "▾" : "▸");
        foldBtn.setVisibility(empty ? View.GONE : View.VISIBLE);
        for (TextView b : new TextView[] { foldBtn, openBtn, pager }) { b.setTextColor(fg); b.setBackground(outline()); }

        ApprovalOverlayRules.Item it = current();
        if (expanded && it != null) {
            card.setVisibility(View.VISIBLE);
            card.setPadding(0, Math.round(dp(8) * k), 0, 0);
            kind.setText((it.held() ? "HELD COMMAND" : "APPROVAL") + (items.size() > 1 ? " · " + (index + 1) + " of " + items.size() : ""));
            kind.setTextColor(it.held() && !it.shelved ? danger : accent);
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
                TextView b = button(ApprovalOverlayRules.label(a), v -> run(it, a));
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

        if (!shown) {
            place();
            try { wm.addView(root, lp); shown = true; } catch (Exception ignored) { /* permission withdrawn meanwhile */ }
        }
        main.removeCallbacks(tick);
        boolean ticking = urgent || (empty && expanded);
        if (ticking && shown) main.postDelayed(tick, 1000);
    }

    private void onTick() { render(); }

    private void sizeText(float k) {
        dot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12 * k);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13 * k);
        for (TextView b : new TextView[] { foldBtn, openBtn, pager }) {
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

    private void openApp() {
        ApprovalOverlayRules.Item it = current();
        Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (it != null && it.held()) i.putExtra(MainActivity.EXTRA_VETO, it.id);
        try { ctx.startActivity(i); } catch (Exception ignored) {}
    }

    /* ---------------------------------------------------------------- pieces */

    private TextView text(int sp, boolean bold) {
        TextView t = new TextView(ctx);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private TextView button(String text, View.OnClickListener click) {
        TextView b = text(12, true);
        b.setText(text);
        b.setGravity(Gravity.CENTER);
        b.setOnClickListener(click);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.setMarginStart(dp(6));
        b.setLayoutParams(p);
        return b;
    }

    private GradientDrawable panel() {
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(expanded ? 16 : 999));
        d.setStroke(dp(1), muted);
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

    /** Drag the toolbar up or down; the height is saved as a percentage when the finger lifts. A tap still reaches the buttons. */
    private final class Drag implements View.OnTouchListener {
        private int y0;
        private float fy;
        @Override public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: y0 = lp.y; fy = e.getRawY(); return true;
                case MotionEvent.ACTION_MOVE:
                    lp.y = Math.max(0, y0 + Math.round(e.getRawY() - fy));
                    if (shown) { try { wm.updateViewLayout(root, lp); } catch (Exception ignored) {} }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (Math.abs(e.getRawY() - fy) < dp(6)) { toggle(); return true; } // a tap on the label opens or folds it
                    int pct = Math.round(lp.y * 100f / Math.max(1, ctx.getResources().getDisplayMetrics().heightPixels));
                    try { WatchService.setApprovalOverlay(ctx, new JSONObject().put("top", pct)); } catch (Exception ignored) {}
                    return true;
                default: return false;
            }
        }
    }
}
