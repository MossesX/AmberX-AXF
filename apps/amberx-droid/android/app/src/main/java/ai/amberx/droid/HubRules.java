package ai.amberx.droid;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The hub rules the native side needs, the same as lib-hub's (framework/libs/hub/hub.ts) and the AXHub app's
 * AutoApprove: a hub is an https origin only, an approval id is a uuid and its page is rebuilt from it (a link in a reply
 * is never used), redirects are never followed, replies are capped at 256 KB. Pure Java apart from the HTTP calls.
 */
final class HubRules {
    private HubRules() {}

    /** The one hub this build talks to (= the web side's manifest `developer.hub`); every hub call is held to it. */
    static final String HUB = "https://axhub.amberxai.com";
    static final int FEED_MAX_BYTES = 256 * 1024;
    static final int FEED_MAX_ITEMS = 50;
    static final String FEED_PATH = "/auth/admin/approvals.json";
    static final String APPROVALS_PATH = "/auth/admin/approvals";
    private static final Pattern APPROVAL_ID = Pattern.compile("^[0-9a-f-]{36}$");
    /** The hub's JSON API for its own pages (axHub decision #96): the session (with its CSRF value) and one request. */
    static final String SESSION_PATH = "/auth/api/session";
    static final String API_APPROVALS_PATH = "/auth/api/approvals";
    private static final Pattern CSRF = Pattern.compile("\"csrf\"\\s*:\\s*\"([A-Za-z0-9_\\-]{8,200})\"");
    /** "Approve everything" never covers a root shell on the VPS (Brett, Oct 22 2026). */
    static final Set<String> NOT_IN_ALL = Set.of("vps.run");

    /** https://host[:port] or null. */
    static String normalize(String raw) {
        if (raw == null) return null;
        try {
            URI u = new URI(raw.trim());
            if (!"https".equals(u.getScheme()) || u.getHost() == null || u.getUserInfo() != null) return null;
            return "https://" + u.getHost().toLowerCase(Locale.ROOT) + (u.getPort() > 0 && u.getPort() != 443 ? ":" + u.getPort() : "");
        } catch (Exception e) {
            return null;
        }
    }

    /** True when [url] is on exactly the hub's origin. */
    static boolean isHub(String hub, String url) {
        String h = normalize(hub);
        String u = normalize(url);
        return h != null && h.equals(u);
    }

    static String approvalUrl(String hub, String id) {
        return id != null && APPROVAL_ID.matcher(id).matches() ? hub + APPROVALS_PATH + "/" + id : null;
    }

    /** Where [id] is decided: the hub's JSON route, or null for anything that isn't a request id. */
    static String approvalApiUrl(String hub, String id) {
        return id != null && APPROVAL_ID.matcher(id).matches() ? hub + API_APPROVALS_PATH + "/" + id : null;
    }

    /** The CSRF value from the hub's `/auth/api/session` answer (signed in), or null. */
    static String csrfFromSession(String json) {
        if (json == null || !json.contains("\"signedIn\":true")) return null;
        Matcher m = CSRF.matcher(json);
        return m.find() ? m.group(1) : null;
    }

    static final class Approval {
        final String id, tool, summary, url;
        Approval(String id, String tool, String summary, String url) { this.id = id; this.tool = tool; this.summary = summary; this.url = url; }
    }

    static final class Feed {
        final String status; // ok | signed-out | not-admin | unreachable
        final int count;
        final List<Approval> pending;
        Feed(String status, int count, List<Approval> pending) { this.status = status; this.count = count; this.pending = pending; }
    }

    static Feed interpret(String hub, int status, String body) {
        List<Approval> none = new ArrayList<>();
        if (status == 401) return new Feed("signed-out", 0, none);
        if (status == 403) return new Feed("not-admin", 0, none);
        if (status != 200) return new Feed("unreachable", 0, none);
        try {
            JSONObject j = new JSONObject(body);
            if (j.has("signedIn") && !j.optBoolean("signedIn", true)) return new Feed("signed-out", 0, none);
            if (j.has("admin") && !j.optBoolean("admin", true)) return new Feed("not-admin", 0, none);
            JSONArray arr = j.optJSONArray("pending");
            List<Approval> out = new ArrayList<>();
            Set<String> ids = new LinkedHashSet<>();
            for (int i = 0; arr != null && i < arr.length() && out.size() < FEED_MAX_ITEMS; i++) {
                JSONObject p = arr.optJSONObject(i);
                if (p == null) continue;
                String id = p.optString("id", null);
                String url = approvalUrl(hub, id);
                if (url == null || ids.contains(id) || !isHub(hub, p.optString("url", ""))) continue;
                ids.add(id);
                out.add(new Approval(id, cap(p.optString("tool", "call"), 120), cap(p.optString("summary", ""), 600), url));
            }
            int count = Math.max(out.size(), Math.max(0, Math.min(1_000_000, j.optInt("count", out.size()))));
            return new Feed("ok", count, out);
        } catch (Exception e) {
            return new Feed("unreachable", 0, none);
        }
    }

    private static String cap(String s, int n) { return s.length() > n ? s.substring(0, n) : s; }

    /* ---------------------------------------------------------------- Dev Console alerts (alert@1, GET <console>/api/alerts) */

    /** The Dev Console AmberX reads alerts from (builds, CI, deploys, systems check). Brett, Oct 28 2026: every push comes from AmberX. */
    static final String CONSOLE = "https://console.amberxai.com";
    static final String ALERTS_PATH = "/api/alerts";
    /** Only these severities make a sound; info alerts stay in the console. */
    static final Set<String> LOUD = Set.of("critical", "error", "warning");

    static final class ConsoleAlert {
        final String key, stamp, title, body, severity;
        ConsoleAlert(String key, String stamp, String title, String body, String severity) { this.key = key; this.stamp = stamp; this.title = title; this.body = body; this.severity = severity; }
    }
    static final class Alerts {
        /** open, loud alerts (one stamp per key + lastAt: a repeat of the same alert alerts again) */
        final List<ConsoleAlert> open;
        /** keys resolved or read since: their notification is taken away */
        final Set<String> closed;
        Alerts(List<ConsoleAlert> open, Set<String> closed) { this.open = open; this.closed = closed; }
    }

    /** The console's alerts reply, or null when it isn't one (signed out = a redirect or HTML, not 200 JSON). */
    static Alerts consoleAlerts(int status, String body) {
        if (status != 200 || body == null) return null;
        try {
            JSONArray arr = new JSONObject(body).optJSONArray("alerts");
            if (arr == null) return null;
            List<ConsoleAlert> open = new ArrayList<>();
            Set<String> closed = new LinkedHashSet<>();
            Set<String> keys = new HashSet<>();
            for (int i = 0; i < arr.length() && open.size() < FEED_MAX_ITEMS; i++) {
                JSONObject a = arr.optJSONObject(i);
                if (a == null) continue;
                String key = a.optString("key", "");
                if (key.isEmpty() || key.length() > 200) continue;
                if (a.optBoolean("resolved") || a.optBoolean("ack")) { closed.add(key); continue; }
                String sev = a.optString("severity", "info");
                if (!LOUD.contains(sev) || !keys.add(key)) continue;
                open.add(new ConsoleAlert(key, key + "@" + a.optLong("lastAt"), cap(a.optString("title", "Console alert"), 200), cap(a.optString("body", ""), 600), sev));
            }
            return new Alerts(open, closed);
        } catch (Exception e) {
            return null;
        }
    }

    /* ---------------------------------------------------------------- auto-approval (the AXHub app's rules) */

    static List<String> patterns(String raw) {
        Set<String> out = new LinkedHashSet<>();
        if (raw != null) for (String p : raw.split("[,\\s;]+")) if (!p.isEmpty() && out.size() < 50) out.add(p.trim());
        return new ArrayList<>(out);
    }

    static boolean matches(List<String> patterns, String tool) {
        for (String p : patterns) {
            if (p.equals("*")) return true;
            if (p.endsWith(".*") && tool.startsWith(p.substring(0, p.length() - 1)) && tool.length() > p.length() - 1) return true;
            if (p.equals(tool)) return true;
        }
        return false;
    }

    static boolean autoApproves(boolean on, boolean all, String raw, String tool) {
        return (all && !tool.isEmpty() && !NOT_IN_ALL.contains(tool)) || (on && matches(patterns(raw), tool));
    }

    /** The hub answers a successful decision with 200 and `{"ok":true,"result":"approved",…}`. */
    static boolean approvedReply(int code, String body) {
        return code == 200 && body != null && body.contains("\"ok\":true") && body.contains("\"result\":\"approved\"");
    }

    /* ---------------------------------------------------------------- HTTP (cookie from Android's store) */

    static final class Reply {
        final int status; final String body; final String location; final String etag;
        Reply(int status, String body, String location, String etag) { this.status = status; this.body = body; this.location = location; this.etag = etag; }
    }

    static Reply get(String url, String cookie) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10_000); c.setReadTimeout(10_000); c.setUseCaches(false);
            c.setRequestProperty("Accept", "application/json, text/html");
            c.setRequestProperty("Accept-Encoding", "identity");
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = in == null ? "" : readLimited(in, FEED_MAX_BYTES);
            return new Reply(code, body, c.getHeaderField("Location"), c.getHeaderField("ETag"));
        } finally {
            c.disconnect();
        }
    }

    static final int PUT_MAX_BYTES = 64 * 1024;

    /** Writes only to the hub's data server (`/data/...`): no other hub path takes a PUT from the app. */
    static boolean isDataPath(String hub, String url) {
        return isHub(hub, url) && url.startsWith(hub + "/data/") && !url.contains("..");
    }

    /** PUT a JSON document to the hub's data server with the hub session (hub as Origin, If-Match kept, no redirects). */
    static Reply put(String hub, String url, String body, String ifMatch, String cookie) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        if (!isDataPath(hub, url)) throw new IOException("not the hub's data server");
        if (bytes.length > PUT_MAX_BYTES) throw new IOException("document too large");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10_000); c.setReadTimeout(10_000); c.setUseCaches(false);
            c.setRequestMethod("PUT"); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Origin", hub);
            if (ifMatch != null && !ifMatch.isEmpty()) c.setRequestProperty("If-Match", ifMatch);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            c.getOutputStream().write(bytes);
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String reply = in == null ? "" : readLimited(in, FEED_MAX_BYTES);
            return new Reply(code, reply, c.getHeaderField("Location"), c.getHeaderField("ETag"));
        } finally {
            c.disconnect();
        }
    }

    /**
     * Approves [id] through the hub's JSON API with the hub session (CSRF value from `/auth/api/session`, hub as Origin,
     * no redirects), the same route the hub's own pages use. True only on the hub's "approved" answer.
     */
    static boolean approve(String hub, String id, String cookie) {
        String url = approvalApiUrl(hub, id);
        if (url == null || cookie == null || !isHub(HUB, hub)) return false;
        try {
            Reply session = get(hub + SESSION_PATH, cookie);
            String csrf = session.status == 200 ? csrfFromSession(session.body) : null;
            if (csrf == null) return false;
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            try {
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(10_000); c.setReadTimeout(10_000); c.setUseCaches(false);
                c.setRequestMethod("POST"); c.setDoOutput(true);
                c.setRequestProperty("Cookie", cookie);
                c.setRequestProperty("Origin", hub);
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("Accept", "application/json");
                c.setRequestProperty("X-AxHub-CSRF", csrf);
                c.getOutputStream().write("{\"action\":\"approve\"}".getBytes(StandardCharsets.UTF_8));
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                return approvedReply(code, in == null ? "" : readLimited(in, FEED_MAX_BYTES));
            } finally {
                c.disconnect();
            }
        } catch (Exception e) {
            return false;
        }
    }

    static String readLimited(InputStream in, int max) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) {
                if (out.size() + n > max) throw new IOException("reply too large");
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        }
    }
}
