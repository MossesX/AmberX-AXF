package ai.amberx.consoleapp;

import java.net.URI;
import java.util.Locale;

/**
 * The console shell's pure rules: which pages stay inside the app, where it starts, and how a deep link becomes a
 * console URL. No Android imports, so it runs under plain JUnit ({@code ShellRulesTest}).
 *
 * Brett, Nov 13 2026: "make the console an Android app, just a wrapper for the web app, keep it floating on top".
 * The app is the live web console (https://console.amberxai.com/) in a WebView; native code only does what Android
 * requires (overlay, notifications, mic, recorder, open_url, wake, permissions).
 */
final class ShellRules {
    private ShellRules() {}

    /** The live console. Every page the shell shows comes from here, so a console deploy updates the app. */
    static final String HOME = "https://console.amberxai.com/";
    /** Brett's own domains: the only pages that stay inside the app and may reach the native bridge. */
    static final String[] DOMAINS = { "amberxai.com" };
    /** The custom scheme for deep links: {@code axf-console://open/<target>}. */
    static final String SCHEME = "axf-console";
    static final int MAX_URL = 2000;
    /** The console's deep-link parameter for a console-control@1 address (apps/console-web/src/native). */
    static final String OPEN_PARAM = "axf-open";

    /** The URL if the shell may load it inside the app, else throws with a message the caller can show. */
    static String allowed(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) throw new IllegalArgumentException("url is required.");
        if (s.length() > MAX_URL) throw new IllegalArgumentException("url is too long.");
        URI u;
        try { u = new URI(s); } catch (Exception e) { throw new IllegalArgumentException("url isn't a valid address."); }
        if (!"https".equalsIgnoreCase(u.getScheme())) throw new IllegalArgumentException("Only https pages can be opened.");
        if (u.getRawUserInfo() != null) throw new IllegalArgumentException("url can't carry a user name or password.");
        if (u.getPort() != -1 && u.getPort() != 443) throw new IllegalArgumentException("url can't name a port.");
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        if (!ownDomain(host)) throw new IllegalArgumentException("The console app only opens Brett's own sites (" + String.join(", ", DOMAINS) + "), not \"" + host + "\".");
        return u.toString();
    }

    /** {@link #allowed} or {@code fallback} when it isn't. */
    static String linkOr(String raw, String fallback) {
        try { return allowed(raw); } catch (IllegalArgumentException e) { return fallback; }
    }

    static boolean ownDomain(String host) {
        if (host == null || host.isEmpty() || host.endsWith(".")) return false;
        for (String d : DOMAINS) if (host.equals(d) || host.endsWith("." + d)) return true;
        return false;
    }

    /** True when a link followed inside the WebView stays there; anything else goes to the phone's browser. */
    static boolean staysInside(String url) {
        return !linkOr(url, "").isEmpty();
    }

    /** True when the page now showing may call {@code window.axfNative} (only Brett's own sites). */
    static boolean bridgeAllowed(String currentUrl) {
        return staysInside(currentUrl);
    }

    /** True when the page now showing is the console itself (it runs the console's actions; the hub's pages don't). */
    static boolean onConsole(String currentUrl) {
        String home = HOME.substring(0, HOME.length() - 1);
        String u = linkOr(currentUrl, "");
        return u.equals(home) || u.startsWith(HOME) || u.startsWith(home + "?") || u.startsWith(home + "#");
    }

    /**
     * What an incoming link opens. {@code https://…amberxai.com/…} opens as is; {@code axf-console://open/<target>}
     * (a console-control@1 address, the console_open target, e.g. {@code settings.plugins}) becomes
     * {@code ?axf-open=<address>}, which the console runs through its control executor on load;
     * {@code axf-console://search/<words>} the search palette ({@code ?axf-cmd=search&q=}). Anything else: home.
     */
    static String deepLink(String raw) {
        if (raw == null || raw.trim().isEmpty()) return HOME;
        String s = raw.trim();
        if (s.regionMatches(true, 0, SCHEME + "://", 0, SCHEME.length() + 3)) {
            String rest = s.substring(SCHEME.length() + 3);
            int slash = rest.indexOf('/');
            String verb = (slash < 0 ? rest : rest.substring(0, slash)).toLowerCase(Locale.ROOT);
            String arg = slash < 0 ? "" : rest.substring(slash + 1);
            if (arg.endsWith("/")) arg = arg.substring(0, arg.length() - 1);
            arg = decode(arg);
            if ("search".equals(verb) && !arg.isEmpty()) return HOME + "?axf-cmd=search&q=" + encode(arg);
            if ("open".equals(verb) && !arg.isEmpty()) return HOME + "?" + OPEN_PARAM + "=" + encode(arg);
            return HOME;
        }
        return linkOr(s, HOME);
    }

    /**
     * True when a link is the running console page's to open, with no reload: the console already shows
     * ({@link #onConsole}) and the link is the console's own root carrying only hints ({@code axf-open=<address>},
     * {@code axf-cmd=<queued command>}). The search palette's link ({@code axf-cmd=search}), a hard refresh
     * ({@code axf-refresh}) and every other path or site are loaded as before.
     *
     * Brett, Nov 23 2026: "Every time you try to load a screen, it refreshes and loads the main console first." A
     * wake or a show used to load its link into the WebView whatever was showing, so the page started again at its
     * home screen and the screen that was asked for came late or never.
     */
    static boolean inPage(String currentUrl, String url) {
        if (!onConsole(currentUrl)) return false;
        String u = linkOr(url, "");
        if (!onConsole(u)) return false;
        try {
            URI x = new URI(u);
            String path = x.getRawPath();
            if (path != null && !path.isEmpty() && !"/".equals(path)) return false;
            String q = x.getRawQuery();
            if (q == null) return true;
            for (String part : q.split("&")) {
                int eq = part.indexOf('=');
                String k = eq < 0 ? part : part.substring(0, eq);
                String v = eq < 0 ? "" : part.substring(eq + 1);
                if ("axf-refresh".equals(k) || ("axf-cmd".equals(k) && "search".equals(v))) return false;
            }
            return true;
        } catch (Exception e) { return false; }
    }

    /** How long the page has to say it took a link ({@link #handOffScript}) before the shell loads it instead. */
    static final long HAND_OFF_MS = 1_500;

    /**
     * The script that hands a link to the running page ({@code window.axfNative.open(url)},
     * apps/console-web/src/native/axfNative.ts). It evaluates to {@code true} only when the page took the link; a
     * console from before this (no {@code open}), or a page still starting, answers anything else and the shell loads
     * the link as it always did.
     */
    static String handOffScript(String url) {
        return "(function(){try{return !!(window.axfNative&&window.axfNative.open&&window.axfNative.open(" + jsString(url) + "))}catch(e){return false}})()";
    }

    /** A JavaScript string literal (quotes, backslashes, line ends and {@code <} escaped). */
    static String jsString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : (s == null ? "" : s).toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20 || ch == '<' || ch == 0x2028 || ch == 0x2029) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }

    /** The back key: one page back while there is history, else leave the app (the overlay stays). */
    static String back(boolean canGoBack) { return canGoBack ? "back" : "leave"; }

    static String encode(String s) {
        try { return java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20"); } catch (Exception e) { return ""; }
    }

    static String decode(String s) {
        try { return java.net.URLDecoder.decode(s.replace("+", "%2B"), "UTF-8"); } catch (Exception e) { return s; }
    }
}
