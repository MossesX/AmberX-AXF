package ai.amberx.consoleapp;

import java.net.URI;

/**
 * Where a page's own question ({@code alert()}, {@code confirm()}, {@code prompt()}) can be drawn. No Android imports,
 * so it runs under plain JUnit ({@code DialogRulesTest}).
 *
 * The WebView draws these itself only while an activity shows it. In the expanded overlay its context is the overlay
 * service, and the WebView then cancels the dialog without drawing it: {@code confirm()} answers false at once and the
 * page takes that as "no" (Nov 21 2026: Save and Apply the default on Approval rules did nothing from Phone Connect).
 * So in the overlay the shell draws the question in its own overlay window.
 */
final class DialogRules {
    private DialogRules() {}

    /** The WebView's own dialog, the shell's dialog in an overlay window, or nowhere (the question is cancelled). */
    static final String ACTIVITY = "activity", OVERLAY = "overlay", NONE = "none";
    /** The bridge feature name the console looks for ({@code info().features}). */
    static final String FEATURE = "dialogs";

    static final String OK = "OK", CANCEL = "Cancel";

    static String where(boolean activityShowsPage, boolean attached, boolean canDrawOverlays) {
        if (activityShowsPage) return ACTIVITY;
        return attached && canDrawOverlays ? OVERLAY : NONE;
    }

    /** The dialog's title: whose page is asking (its host), like a browser shows it. */
    static String title(String url) {
        try {
            String host = new URI(url == null ? "" : url).getHost();
            return host == null || host.isEmpty() ? "AXF Console" : host;
        } catch (Exception e) { return "AXF Console"; }
    }
}
