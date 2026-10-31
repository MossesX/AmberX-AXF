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
                // A held veto call (veto@1) isn't waiting for an approval: no alert, never auto-approved ([VetoAlerts]).
                if ("held".equals(p.optString("status", ""))) continue;
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

    /* ---------------------------------------------------------------- veto@1 held calls (= lib-hub veto.ts) */

    private static final Pattern JOB_ID = Pattern.compile("^[A-Za-z0-9_-]{1,80}$");
    private static final Pattern SUMMARY_COMMAND = Pattern.compile("\"command\":\"((?:[^\"\\\\]|\\\\.)*)\"");
    static final int VETO_WARNING_SECONDS = 30;

    /** The owner's actions on a held call (decision 102 Deny; 104 Approve now, Shelve), in button order. */
    static final String[] VETO_ACTIONS = { "deny", "approve-now", "shelve" };

    /** One held call: the hub runs it when [secondsLeft] (read at [readAt], local ms) reaches 0 unless it is denied. */
    static final class Veto {
        final String id, jobId, tool, title, command, url;
        final int secondsLeft;
        final long readAt;
        /** Decision 104: countdown paused until Approve now or Deny; approved (runs at once, no more notices). */
        final boolean shelved, approvedNow;
        /** What the owner may do now (a hub before 104: Deny only). */
        final List<String> actions;
        Veto(String id, String jobId, String tool, String title, String command, String url, int secondsLeft, long readAt) {
            this(id, jobId, tool, title, command, url, secondsLeft, readAt, false, false, java.util.Collections.singletonList("deny"));
        }
        Veto(String id, String jobId, String tool, String title, String command, String url, int secondsLeft, long readAt, boolean shelved, boolean approvedNow, List<String> actions) {
            this.id = id; this.jobId = jobId; this.tool = tool; this.title = title; this.command = command; this.url = url;
            this.secondsLeft = secondsLeft; this.readAt = readAt; this.shelved = shelved; this.approvedNow = approvedNow; this.actions = actions;
        }
        /** Local time (ms) it runs at (while shelved: when it would have, had it not been). */
        long runsAtLocal() { return readAt + secondsLeft * 1000L; }
        boolean can(String action) { return actions.contains(action); }
    }

    static boolean isVetoAction(String action) {
        for (String a : VETO_ACTIONS) if (a.equals(action)) return true;
        return false;
    }

    /** `POST` address of one owner action, rebuilt from the id; null for anything else. */
    static String vetoActionUrl(String hub, String id, String action) {
        return id != null && APPROVAL_ID.matcher(id).matches() && isVetoAction(action) ? hub + API_APPROVALS_PATH + "/" + id + "/" + action : null;
    }

    static String vetoDenyUrl(String hub, String id) { return vetoActionUrl(hub, id, "deny"); }

    /** The actions list of an entry, filtered and in button order; absent = Deny only. */
    static List<String> vetoActionsOf(JSONArray a) {
        List<String> out = new ArrayList<>();
        if (a == null) { out.add("deny"); return out; }
        Set<String> got = new HashSet<>();
        for (int i = 0; i < a.length(); i++) got.add(a.optString(i, ""));
        for (String x : VETO_ACTIONS) if (got.contains(x)) out.add(x);
        return out;
    }

    static Veto veto(String hub, JSONObject p, long now) {
        if (p == null) return null;
        String id = p.optString("id", null);
        String url = approvalUrl(hub, id);
        if (url == null) return null;
        for (String k : new String[] { "url", "approvalUrl", "denyUrl", "approveNowUrl", "shelveUrl", "streamUrl" }) {
            if (p.has(k) && !isHub(hub, p.optString(k, ""))) return null;
        }
        JSONObject v = p.optJSONObject("veto");
        if (v == null) v = p;
        int left;
        if (v.has("secondsLeft")) left = (int) Math.round(v.optDouble("secondsLeft", 0));
        else {
            try { left = (int) Math.ceil((java.time.Instant.parse(v.optString("runsAt", "")).toEpochMilli() - now) / 1000.0); }
            catch (Exception e) { return null; }
        }
        left = Math.max(0, Math.min(24 * 3600, left));
        String job = p.optString("jobId", "");
        String tool = cap(p.optString("tool", "vps.run"), 120);
        JSONObject reason = p.optJSONObject("reason");
        String title = p.optString("title", reason != null ? reason.optString("title", tool) : tool);
        String command = p.optString("command", "");
        JSONObject args = p.optJSONObject("args");
        if (command.isEmpty() && args != null) command = args.optString("command", "");
        if (command.isEmpty()) {
            Matcher m = SUMMARY_COMMAND.matcher(p.optString("summary", ""));
            if (m.find()) command = m.group(1).replace("\\\"", "\"").replace("\\\\", "\\");
        }
        boolean shelved = "shelved".equals(v.optString("state", "")) || "shelved".equals(p.optString("phase", ""));
        boolean approvedNow = v.optBoolean("approvedNow", false);
        JSONArray acts = v.optJSONArray("actions");
        if (acts == null) acts = p.optJSONArray("actions");
        return new Veto(id, JOB_ID.matcher(job).matches() ? job : null, tool, cap(title.isEmpty() ? tool : title, 200), cap(command, 2000), url, left, now,
            shelved, approvedNow, vetoActionsOf(acts));
    }

    /** Every held call in a feed reply: `pending` entries with `status: "held"` + a `veto` object, and `held[]`. */
    static List<Veto> vetoes(String hub, String body, long now) {
        List<Veto> out = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        try {
            JSONObject j = new JSONObject(body);
            for (String key : new String[] { "pending", "held" }) {
                JSONArray arr = j.optJSONArray(key);
                for (int i = 0; arr != null && i < arr.length() && out.size() < FEED_MAX_ITEMS; i++) {
                    JSONObject p = arr.optJSONObject(i);
                    if (p == null) continue;
                    if ("pending".equals(key) && !("held".equals(p.optString("status", "")) && p.optJSONObject("veto") != null)) continue;
                    Veto v = veto(hub, p, now);
                    if (v != null && ids.add(v.id)) out.add(v);
                }
            }
        } catch (Exception ignored) { /* not a feed */ }
        return out;
    }

    /** Phase of a held call [secondsLeft] before it runs: held, warning (≤ 30 s), running (0). */
    static String vetoPhase(int secondsLeft) {
        return secondsLeft <= 0 ? "running" : secondsLeft <= VETO_WARNING_SECONDS ? "warning" : "held";
    }

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
    /**
     * Deny a held call (veto@1) with the phone's hub session: the session's CSRF value, then
     * `POST /auth/api/approvals/<id>/deny` with the hub as Origin. Returns the hub's status (200 = denied), -1 when it
     * couldn't be sent (signed out, not a request id).
     */
    static int deny(String hub, String id, String cookie) { return act(hub, id, "deny", cookie); }

    /**
     * Deny, Approve now or Shelve a held call (decisions 102, 104) with the phone's hub session: the session's CSRF value,
     * then `POST /auth/api/approvals/<id>/<action>` with the hub as Origin. The hub's status (200 = done), -1 when it
     * couldn't be sent (signed out, not a request id, not an action).
     */
    static int act(String hub, String id, String action, String cookie) {
        String url = vetoActionUrl(hub, id, action);
        if (url == null || cookie == null || !isHub(HUB, hub)) return -1;
        try {
            Reply session = get(hub + SESSION_PATH, cookie);
            String csrf = session.status == 200 ? csrfFromSession(session.body) : null;
            if (csrf == null) return -1;
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
                c.getOutputStream().write("{}".getBytes(StandardCharsets.UTF_8));
                return c.getResponseCode();
            } finally {
                c.disconnect();
            }
        } catch (Exception e) {
            return -1;
        }
    }

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
