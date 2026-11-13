package ai.amberx.droid;

import java.net.URI;
import org.json.JSONObject;

/**
 * The overlay's page window, the pure part (Brett, Nov 13 2026: "I want it to pop up a full browser window if I want to,
 * if I go to a page. But I want it to be just a floating toolbar unless you call it to open something. When you close
 * the browser, it's just a floating toolbar again.").
 *
 * The floating toolbar ({@link ApprovalOverlay}) opens into a full-screen browser window only when a page is opened:
 * by Brett (the toolbar's Page button, voice) or by Amber (`amberx.open_url` / `console_show` reach the phone as AXPP
 * {@code browser.open}). Closing it (✕, the back key at the first page, the API) leaves the toolbar again. These rules
 * decide where a page goes, which links stay inside the window and what its title bar says. No Android imports, so
 * they run under plain JUnit ({@code OverlayPageRulesTest}).
 */
final class OverlayPageRules {
    private OverlayPageRules() {}

    /** Where pages Amber opens go: overlay = the toolbar's own browser window; browser = Chrome / the default browser. */
    static final String[] PAGES = { "overlay", "browser" };
    /** What the toolbar's Page button opens when no page was open yet. */
    static final String HOME = "https://console.amberxai.com/";

    /**
     * True when a {@code browser.open} goes to the overlay's window. An explicit {@code where} on the call wins
     * ("overlay" / "browser"); otherwise the overlay takes it when it is on, set to open pages and can draw.
     */
    static boolean inOverlay(ApprovalOverlayRules.Settings s, JSONObject args, boolean overlayReady) {
        String where = args == null ? "" : args.optString("where", "");
        if ("browser".equals(where)) return false;
        if (!overlayReady || s == null || !s.on) return false;
        return "overlay".equals(where) || "overlay".equals(s.pages);
    }

    /** True when a link followed inside the window stays there (Brett's own sites); anything else goes to Chrome. */
    static boolean staysInside(String url) {
        return !OpenUrlRules.linkOr(url, "").isEmpty();
    }

    /** What the Page button opens: the last page when there was one, else the console home. */
    static String pageButtonUrl(String last) {
        return OpenUrlRules.linkOr(last, HOME);
    }

    /** The title bar's text: the page's title, else its host. */
    static String title(String url, String pageTitle) {
        if (pageTitle != null && !pageTitle.trim().isEmpty() && !pageTitle.startsWith("http")) return pageTitle.trim();
        try { String h = new URI(url).getHost(); return h == null ? "Page" : h; } catch (Exception e) { return "Page"; }
    }

    /** The back key in the window: one page back while there is history, else it closes the window. */
    static String back(boolean canGoBack) { return canGoBack ? "back" : "close"; }
}
