package ai.amberx.consoleapp;

import android.app.Activity;
import android.content.Context;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import java.util.List;
import org.json.JSONObject;

/**
 * Four console slots at the same time (console app part 3, s6), the Android side of {@link SlotRules}: up to four
 * WebViews in one {@link FrameLayout}, each with its own {@code window.axfNative}, laid out by {@link SlotRules#frames}
 * and saved in the app's preferences. Tools on every slot's bridge: {@code slots.status|open|close|focus}; every
 * change is the {@code slots} event in every slot.
 *
 * Wiring in {@code ConsoleActivity} (part 1's file): build the host once with the container the WebView sat in and a
 * {@link Factory} that does what {@code onCreate} did for the one WebView (part 1's {@code WebHost} settings,
 * {@code DeviceBridge.attach}, {@code DeviceTools/MicTools.register}), then {@code host.restore()}. In
 * {@code WebHost.onPermissionRequest} use {@link #micAllowed} next to {@code MicTools.webCaptureAllowed}; on back, call
 * {@link #focusedWeb()} instead of the single WebView.
 */
final class SlotHost {
    /** Builds one slot's WebView with its bridge attached and its tools registered (part 1's WebHost setup). */
    interface Factory { DeviceBridge create(int slot); }

    private final Activity activity;
    private final FrameLayout container;
    private final Factory factory;
    private final DeviceBridge[] bridges = new DeviceBridge[SlotRules.MAX];
    private SlotRules.State state = SlotRules.State.initial();
    static volatile SlotHost current;

    SlotHost(Activity activity, FrameLayout container, Factory factory) {
        this.activity = activity;
        this.container = container;
        this.factory = factory;
        container.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> { if (r - l != or - ol || b - t != ob - ot) layout(); });
        current = this;
    }

    /** Opens the slots saved last time (slot 1 at least). */
    void restore() {
        apply(SlotRules.decode(activity.getSharedPreferences(HubLink.PREFS, Context.MODE_PRIVATE).getString(SlotRules.PREF_SLOTS, null)), false);
    }

    void destroy() {
        for (int i = 0; i < SlotRules.MAX; i++) drop(i + 1);
        if (current == this) current = null;
    }

    /* ------------------------------------------------------------------ tools */

    private void register(DeviceBridge b) {
        b.register(BridgeContract.SLOTS_STATUS, args -> SlotRules.status(state));
        b.register(BridgeContract.SLOTS_OPEN, args -> apply(SlotRules.open(state, args), true));
        b.register(BridgeContract.SLOTS_CLOSE, args -> apply(SlotRules.close(state, args), true));
        b.register(BridgeContract.SLOTS_FOCUS, args -> apply(SlotRules.focus(state, args), true));
    }

    /** Makes the screen match a new state, saves it and tells every slot. Runs on the main thread (bridge tools do). */
    private JSONObject apply(SlotRules.State next, boolean announce) {
        SlotRules.State prev = state;
        state = next;
        for (int slot = 1; slot <= SlotRules.MAX; slot++) {
            String url = next.urls[slot - 1];
            if (url == null) { drop(slot); continue; }
            DeviceBridge b = bridges[slot - 1];
            if (b == null) {
                b = factory.create(slot);
                bridges[slot - 1] = b;
                register(b);
                final int s = slot;
                b.web().setOnTouchListener((View v, MotionEvent e) -> {
                    if (e.getActionMasked() == MotionEvent.ACTION_DOWN && state.focused != s) {
                        try { apply(new SlotRules.State(state.urls, s), true); } catch (Exception ignored) { /* stays as it was */ }
                    }
                    return false;
                });
                container.addView(b.web());
                b.web().loadUrl(url);
            } else if (!url.equals(prev.urls[slot - 1])) {
                b.web().loadUrl(url);
            }
        }
        DeviceBridge focused = bridges[next.focused - 1];
        if (focused != null) { focused.makeCurrent(); focused.web().requestFocus(); }
        layout();
        activity.getSharedPreferences(HubLink.PREFS, Context.MODE_PRIVATE).edit().putString(SlotRules.PREF_SLOTS, SlotRules.encode(next)).apply();
        JSONObject status = SlotRules.status(next);
        if (announce && focused != null) focused.emit(BridgeContract.EV_SLOTS, status);
        return status;
    }

    private void drop(int slot) {
        DeviceBridge b = bridges[slot - 1];
        if (b == null) return;
        bridges[slot - 1] = null;
        b.detach();
        container.removeView(b.web());
        b.web().destroy();
    }

    private void layout() {
        int w = container.getWidth(), h = container.getHeight();
        if (w == 0 || h == 0) return;
        List<int[]> frames = SlotRules.frames(state, w, h);
        for (int[] f : frames) {
            DeviceBridge b = bridges[f[0] - 1];
            if (b == null) continue;
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(f[3] - f[1], f[4] - f[2]);
            lp.leftMargin = f[1];
            lp.topMargin = f[2];
            b.web().setLayoutParams(lp);
        }
    }

    /* ------------------------------------------------------------------ for part 1's code */

    /** The slot a WebView sits in (1-4), or 0. */
    int slotOf(WebView web) {
        for (int i = 0; i < SlotRules.MAX; i++) if (bridges[i] != null && bridges[i].web() == web) return i + 1;
        return 0;
    }

    /** One mic, one listener: only the focused slot's page may capture audio. */
    boolean micAllowed(WebView web) { return SlotRules.micAllowed(state, slotOf(web)); }

    WebView focusedWeb() {
        DeviceBridge b = bridges[state.focused - 1];
        return b == null ? null : b.web();
    }
}
