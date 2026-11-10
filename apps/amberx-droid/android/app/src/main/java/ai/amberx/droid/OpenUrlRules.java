package ai.amberx.droid;

import java.net.URI;
import java.util.Locale;
import org.json.JSONObject;

/**
 * Console wake (Nov 3 2026), the pure part: which pages the hub may ask AmberX to open (`amberx.open_url`, AXPP command
 * {@code browser.open}, capability {@code open-url@1}). A console command from a Claude session found no open Dev
 * Console, so the console server asks axHub to open https://console.amberxai.com/?axf-cmd=&lt;id&gt; on Brett's phone.
 *
 * Only Brett's own domains: https, host {@code amberxai.com} or a subdomain of it, no user info, the default port. Every
 * other URL is refused here even if the hub sent it (axHub checks the same list). No Android imports, so it runs
 * under plain JUnit ({@code OpenUrlRulesTest}); {@link AxppLink} does the opening.
 */
final class OpenUrlRules {
    private OpenUrlRules() {}

    static final String OPEN = "browser.open";
    static final String CAPABILITY = "open-url@1";
    static final String[] DOMAINS = { "amberxai.com" };
    static final String CHROME = "com.android.chrome";
    static final int MAX_URL = 2000;

    /** The URL if AmberX may open it, else throws with a message the hub shows. */
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
        if (!ownDomain(host)) throw new IllegalArgumentException("AmberX only opens Brett's own sites (" + String.join(", ", DOMAINS) + "), not \"" + host + "\".");
        return u.toString();
    }

    /** An alert's link when AmberX may open it, else {@code fallback} (a console alert's tap never leaves Brett's sites). */
    static String linkOr(String raw, String fallback) {
        try { return allowed(raw); } catch (IllegalArgumentException e) { return fallback; }
    }

    static boolean ownDomain(String host) {
        if (host == null || host.isEmpty() || host.endsWith(".")) return false;
        for (String d : DOMAINS) if (host.equals(d) || host.endsWith("." + d)) return true;
        return false;
    }

    /** {@code chrome} (default: Chrome when it is installed, else the default browser) or {@code default}. */
    static String browserOf(JSONObject args) {
        String b = args == null ? "" : args.optString("browser", "chrome");
        return "default".equals(b) ? "default" : "chrome";
    }

    /** True for the commands this class answers. */
    static boolean known(String tool) {
        return OPEN.equals(tool);
    }

    /* ---------------------------------------------------------------- the hub's card for an open_url call */

    /** The hub tool the console's wake calls (axHub's `amberx` device service). */
    static final String HUB_TOOL = "amberx.open_url";
    private static final java.util.regex.Pattern SUMMARY_URL = java.util.regex.Pattern.compile("\"url\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");

    /**
     * The page an axHub approval or held call for {@link #HUB_TOOL} opens (its `args` / `arguments` url, else the url in
     * its summary), or null for any other call or a URL AmberX may not open. With a page, the card's tap opens that page
     * in the browser instead of the AmberX app (Brett, Nov 10 2026: "It says a command is waiting for you. I clicked
     * it. I'm in the AmberX app.").
     */
    static String pageOf(String tool, JSONObject entry) {
        if (!HUB_TOOL.equals(tool) || entry == null) return null;
        String raw = "";
        for (String k : new String[] { "args", "arguments" }) {
            JSONObject a = entry.optJSONObject(k);
            if (a != null && !a.optString("url", "").isEmpty()) { raw = a.optString("url", ""); break; }
        }
        if (raw.isEmpty()) {
            java.util.regex.Matcher m = SUMMARY_URL.matcher(entry.optString("summary", ""));
            if (m.find()) raw = m.group(1).replace("\\/", "/").replace("\\\"", "\"").replace("\\\\", "\\");
        }
        try { return raw.isEmpty() ? null : allowed(raw); } catch (IllegalArgumentException e) { return null; }
    }

    /* ---------------------------------------------------------------- opened from a tap: the call doesn't open it again */

    /** How long a page opened from a tap counts as open (each wake URL carries its own command id). */
    static final long TAPPED_MS = 10 * 60_000L;
    private static final java.util.Map<String, Long> tapped = new java.util.HashMap<>();

    /** The page was opened from a notification tap at {@code now}. */
    static synchronized void markTapped(String url, long now) {
        tapped.entrySet().removeIf(e -> now - e.getValue() > TAPPED_MS);
        if (url != null) tapped.put(url, now);
    }

    /** True when the same page was opened from a tap less than {@link #TAPPED_MS} before {@code now}. */
    static synchronized boolean wasTapped(String url, long now) {
        Long at = url == null ? null : tapped.get(url);
        return at != null && now - at >= 0 && now - at <= TAPPED_MS;
    }
}
