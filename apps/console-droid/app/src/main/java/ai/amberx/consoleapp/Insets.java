package ai.amberx.consoleapp;

import android.content.Context;
import android.os.Build;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowInsets;
import java.util.WeakHashMap;

/**
 * The safe area (Brett, Nov 13 2026: "AmberX's banner was behind the camera, the clock and the notification panel").
 * The shell draws edge to edge, reads the status bar, display cutout (notch, punch hole), navigation bar and keyboard
 * from {@link WindowInsets} and hands them to the console as the --fx-safe-top / -right / -bottom / -left tokens
 * (framework/ui/axf.css, where they otherwise come from env(safe-area-inset-*)). The console pads its frame (every top
 * bar, banner, toolbar), its bottom nav, sheets and toasts with them.
 *
 * Belt and braces: until the page says it pads itself ({@code axfNative.insetsHandled(true)}, sent by the console once
 * it has applied the tokens), the shell pads the WebView's window instead, so an old console or the offline page is
 * never drawn under the clock or the camera either. Portrait and landscape: the cutout and the navigation bar can be on
 * any side, so all four sides are read every time the insets change (rotation, keyboard, split screen).
 */
final class Insets {
    private Insets() {}

    /** Last insets per window root, in px: {top, right, bottom, left}. */
    private static final WeakHashMap<View, int[]> perRoot = new WeakHashMap<>();
    /** The status bar / cutout height of the last window, for the floating toolbar (never placed above it). */
    static int safeTopPx;
    /** The overlay's docked toolbar height in px (the console starts below it while the overlay is expanded). */
    private static int dockPx;
    private static boolean pageHandles;
    private static View currentRoot;
    private static float density = 1f;

    /** Listens to {@code root}'s window insets. */
    static void install(Context c, View root) {
        density = c.getResources().getDisplayMetrics().density;
        root.setOnApplyWindowInsetsListener((v, in) -> {
            perRoot.put(v, read(in));
            if (v == currentRoot || currentRoot == null) { currentRoot = v; apply(); }
            return WindowInsets.CONSUMED;
        });
        root.requestApplyInsets();
    }

    /** {top, right, bottom, left} px: status bar + cutout, navigation bar, keyboard; the larger of each per side. */
    static int[] read(WindowInsets in) {
        int t, r, b, l;
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
            t = bars.top; r = bars.right; l = bars.left; b = Math.max(bars.bottom, ime.bottom);
        } else {
            t = in.getSystemWindowInsetTop(); r = in.getSystemWindowInsetRight(); b = in.getSystemWindowInsetBottom(); l = in.getSystemWindowInsetLeft();
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cut = in.getDisplayCutout();
                if (cut != null) {
                    t = Math.max(t, cut.getSafeInsetTop()); r = Math.max(r, cut.getSafeInsetRight());
                    b = Math.max(b, cut.getSafeInsetBottom()); l = Math.max(l, cut.getSafeInsetLeft());
                }
            }
        }
        return new int[] { t, r, b, l };
    }

    /** The WebView moved into {@code root}'s window: its insets are the ones that count now. */
    static void attached(View root) {
        currentRoot = root;
        apply();
        root.requestApplyInsets();
    }

    static void pageHandles(boolean handles) {
        pageHandles = handles;
        apply();
    }

    static void dockToolbar(int heightPx) {
        dockPx = Math.max(0, heightPx);
        apply();
    }

    private static int[] now() {
        int[] i = currentRoot == null ? null : perRoot.get(currentRoot);
        return i == null ? new int[4] : i;
    }

    /** Pads the window (when the page doesn't) and pushes the tokens to the page. */
    static void apply() {
        int[] i = now();
        safeTopPx = i[0];
        int top = i[0] + dockPx;
        if (currentRoot != null) {
            if (pageHandles) currentRoot.setPadding(0, dockPx, 0, 0); // the docked toolbar's strip is the shell's
            else currentRoot.setPadding(i[3], top, i[1], i[2]);
        }
        push();
    }

    /** The insets in CSS px: {"top":24,"right":0,"bottom":16,"left":0,"dock":0,"pageHandles":true}. */
    static String json() {
        int[] i = now();
        return "{\"top\":" + css(i[0]) + ",\"right\":" + css(i[1]) + ",\"bottom\":" + css(i[2]) + ",\"left\":" + css(i[3])
            + ",\"dock\":" + css(dockPx) + ",\"pageHandles\":" + pageHandles + "}";
    }

    private static int css(int px) { return Math.round(px / density); }

    /**
     * Sets the tokens on {@code <html>}. While the shell pads the window the page's own insets are 0 (the WebView is
     * already clear of the bars); once the page handles them it gets the real sizes. Also an {@code insets} event.
     */
    static void push() {
        if (!ShellRules.bridgeAllowed(NativeBridge.currentUrl)) return;
        int[] i = pageHandles ? now() : new int[4];
        WebHost.js(InsetsCss.script(css(i[0]), css(i[1]), css(i[2]), css(i[3])));
        NativeBridge.emit("insets", json());
    }
}
