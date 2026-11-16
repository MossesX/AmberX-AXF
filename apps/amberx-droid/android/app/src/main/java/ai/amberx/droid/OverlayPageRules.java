package ai.amberx.droid;

import java.net.URI;
import org.json.JSONObject;

/**
 * The overlay's full-screen browser, the pure part. The always-on toolbar ({@link ApprovalOverlay}) expands into a
 * full-screen browser with the toolbar docked in its top-left corner, and collapses back with one tap.
 *
 * Brett, Nov 13 2026: "I want it to pop up a full browser window if I want to, if I go to a page. But I want it to be
 * just a floating toolbar unless you call it to open something. When you close the browser, it's just a floating
 * toolbar again." Then (one overlay): every AI "open X" (amberx.open_url, approvals, console pages) goes through the
 * overlay and opens directly, and the AI drives the console inside it while Brett watches.
 *
 * Remote verbs ride the existing AXPP {@code browser.open} (axHub's {@code amberx.open_url}), so no new hub tool is
 * needed: a console URL carrying {@code ?axf-overlay=expand} or {@code ?axf-overlay=collapse} is a verb, not a page.
 * No Android imports, so these run under plain JUnit ({@code OverlayPageRulesTest}).
 */
final class OverlayPageRules {
    private OverlayPageRules() {}

    /** What expanding opens when no page was open yet. */
    static final String HOME = "https://console.amberxai.com/";
    /** Query parameter that turns a {@code browser.open} into an overlay verb. */
    static final String VERB_PARAM = "axf-overlay";
    static final String EXPAND = "expand", COLLAPSE = "collapse", OPEN = "open";
    /** The name the overlay's browser exposes to Brett's own pages (collapse, open, state). */
    static final String BRIDGE = "AmberxOverlay";

    /**
     * What a {@code browser.open} asks of the overlay: {@link #EXPAND} or {@link #COLLAPSE} when the URL carries
     * {@code axf-overlay=<verb>}, else {@link #OPEN} (load the page).
     */
    static String verb(String url) {
        try {
            String q = new URI(url).getRawQuery();
            if (q == null) return OPEN;
            for (String part : q.split("&")) {
                int eq = part.indexOf('=');
                String k = eq < 0 ? part : part.substring(0, eq);
                String v = eq < 0 ? "" : part.substring(eq + 1).toLowerCase(java.util.Locale.ROOT);
                if (VERB_PARAM.equals(k) && (EXPAND.equals(v) || COLLAPSE.equals(v))) return v;
            }
        } catch (Exception ignored) { /* not a URL: a plain open, which the allow-list then refuses */ }
        return OPEN;
    }

    /**
     * True when a {@code browser.open} goes to the overlay: always, when the toolbar is up ([overlayReady]), unless the
     * call explicitly asks for {@code where: "browser"} (Chrome).
     */
    static boolean inOverlay(JSONObject args, boolean overlayReady) {
        String where = args == null ? "" : args.optString("where", "");
        return overlayReady && !"browser".equals(where);
    }

    /** True when a link followed inside the window stays there (Brett's own sites); anything else goes to Chrome. */
    static boolean staysInside(String url) {
        return !OpenUrlRules.linkOr(url, "").isEmpty();
    }

    /** True when the page now showing may call the overlay's bridge (only Brett's own sites). */
    static boolean bridgeAllowed(String currentUrl) {
        return staysInside(currentUrl);
    }

    /** What expanding opens: the last page when there was one, else the console home. */
    static String expandUrl(String last) {
        return OpenUrlRules.linkOr(last, HOME);
    }

    /** The docked toolbar's text: the page's title, else its host. */
    static String title(String url, String pageTitle) {
        if (pageTitle != null && !pageTitle.trim().isEmpty() && !pageTitle.startsWith("http")) return pageTitle.trim();
        try { String h = new URI(url).getHost(); return h == null ? "Page" : h; } catch (Exception e) { return "Page"; }
    }

    /** The back key in the browser: one page back while there is history, else it collapses to the toolbar. */
    static String back(boolean canGoBack) { return canGoBack ? "back" : COLLAPSE; }
}
