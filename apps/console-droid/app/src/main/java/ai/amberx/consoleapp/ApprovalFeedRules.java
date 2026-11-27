package ai.amberx.consoleapp;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What axHub's approvals feed ({@code GET /auth/admin/approvals.json}) means for the floating toolbar: the list of
 * waiting items, read by the shell itself ({@link ApprovalFeed}). No Android imports, so it runs under plain JUnit
 * ({@code ApprovalFeedRulesTest}).
 *
 * The toolbar used to hold whatever the console page last told it. The page only reads the feed while it is on screen,
 * so with another app in front nothing arrived (no pop), and once the page was hidden or showed another site the last
 * count stayed (a badge that never cleared). The feed is axHub's live list; the shell reads it on its own clock and the
 * toolbar shows exactly that.
 *
 * The same reading rules as the console's lib-hub ({@code framework/libs/hub/hub.ts interpretFeed},
 * {@code veto.ts vetoOf / splitFeed}), kept to what the toolbar shows: the id, held or approval, the title, when a held
 * command runs. Ids are the ones the page uses ({@code held:<id>}, {@code approval:<id>}).
 */
final class ApprovalFeedRules {
    private ApprovalFeedRules() {}

    static final String FEED_PATH = "/auth/admin/approvals.json";
    static final String OK = "ok", SIGNED_OUT = "signed-out", NOT_ADMIN = "not-admin", UNREACHABLE = "unreachable";
    /** The feed has not been read yet. */
    static final String IDLE = "idle";
    static final int MAX_ITEMS = 50;
    static final int MAX_BYTES = 256 * 1024;
    static final int MAX_COUNTDOWN_S = 24 * 60 * 60;

    /** How often the feed is read: quickly while something waits (so a decision clears the badge), slowly with the screen off. */
    static final long POLL_WAITING_MS = 2_000, POLL_IDLE_MS = 4_000, POLL_SCREEN_OFF_MS = 30_000;

    private static final Pattern APPROVAL_ID = Pattern.compile("^[0-9a-f-]{36}$");
    private static final String[] LINKS = { "url", "approvalUrl", "denyUrl", "approveNowUrl", "shelveUrl", "streamUrl" };

    /** One reading of the feed. */
    static final class Result {
        final String status;
        final List<OverlayRules.Item> items;

        Result(String status, List<OverlayRules.Item> items) { this.status = status; this.items = items; }

        boolean ok() { return OK.equals(status); }
    }

    static Result empty(String status) { return new Result(status, new ArrayList<>()); }

    static long pollMs(int waiting, boolean screenOn) {
        if (waiting > 0) return POLL_WAITING_MS;
        return screenOn ? POLL_IDLE_MS : POLL_SCREEN_OFF_MS;
    }

    /**
     * What a reply means: 401 → signed-out, 403 → not-admin, 200 → the list (a body saying {@code signedIn: false} /
     * {@code admin: false} maps the same way), anything else (a redirect too) → unreachable. Held commands first
     * (entries with {@code status: "held"} and {@code veto}, and {@code held[]}), then the calls waiting for an approval.
     */
    static Result parse(String hub, int httpStatus, String body, long now) {
        if (httpStatus == 401) return empty(SIGNED_OUT);
        if (httpStatus == 403) return empty(NOT_ADMIN);
        if (httpStatus != 200) return empty(UNREACHABLE);
        JSONObject j;
        try { j = new JSONObject(body == null ? "" : body); } catch (Exception e) { return empty(UNREACHABLE); }
        if (Boolean.FALSE.equals(j.opt("signedIn"))) return empty(SIGNED_OUT);
        if (Boolean.FALSE.equals(j.opt("admin"))) return empty(NOT_ADMIN);

        List<OverlayRules.Item> out = new ArrayList<>();
        Set<String> heldIds = new HashSet<>();
        JSONArray pending = j.optJSONArray("pending"), held = j.optJSONArray("held");
        for (int i = 0; pending != null && i < pending.length(); i++) {
            JSONObject p = pending.optJSONObject(i);
            if (p != null && "held".equals(str(p, "status")) && p.optJSONObject("veto") != null) addHeld(hub, p, now, heldIds, out);
        }
        for (int i = 0; held != null && i < held.length(); i++) addHeld(hub, held.optJSONObject(i), now, heldIds, out);

        Set<String> ids = new HashSet<>();
        int kept = 0;
        for (int i = 0; pending != null && i < pending.length() && kept < MAX_ITEMS; i++) {
            JSONObject p = pending.optJSONObject(i);
            if (p == null) continue;
            String id = str(p, "id");
            if (!isApprovalId(id) || ids.contains(id) || !isHub(hub, str(p, "url")) || !linksOnHub(hub, p)) continue;
            ids.add(id);
            kept++;
            if (heldIds.contains(id)) continue;
            String tool = orElse(str(p, "tool"), "call");
            out.add(new OverlayRules.Item(OverlayContract.APPROVAL_KIND + ":" + id, OverlayContract.APPROVAL_KIND, title(p, "Run " + tool), 0, false));
        }
        return new Result(OK, out);
    }

    /** A held command from a feed entry; skipped without a real id, with a link off the hub, or without veto timing. */
    private static void addHeld(String hub, JSONObject p, long now, Set<String> heldIds, List<OverlayRules.Item> out) {
        if (p == null || heldIds.size() >= MAX_ITEMS) return;
        String id = str(p, "id");
        if (!isApprovalId(id) || heldIds.contains(id)) return;
        if (!linksOnHub(hub, p)) return;
        JSONObject v = p.optJSONObject("veto") != null ? p.optJSONObject("veto") : p; // a push carries the timing at the top
        Double left = num(v, "secondsLeft");
        long at = time(str(v, "runsAt"));
        if (left == null && at < 0) return;
        heldIds.add(id); // decided or not, it is a held command: it never also counts as an approval
        if (Boolean.TRUE.equals(v.opt("approvedNow"))) return; // Brett approved it: it runs, nothing waits for him
        long seconds = Math.max(0, Math.min(MAX_COUNTDOWN_S, Math.round(left != null ? left : (at - now) / 1000.0)));
        boolean shelved = "shelved".equals(str(v, "state")) || "shelved".equals(str(p, "phase"));
        String tool = orElse(str(p, "tool"), "vps.run");
        out.add(new OverlayRules.Item(OverlayContract.HELD_KIND + ":" + id, OverlayContract.HELD_KIND, title(p, tool), now + seconds * 1000, shelved));
    }

    /**
     * The list to show after a reading. A good reading is the list, whatever was shown before. Without one (signed
     * out, unreachable) the last list stays, minus the held commands whose countdown is over: they have run.
     */
    static List<OverlayRules.Item> after(List<OverlayRules.Item> last, Result r, long now) {
        return r.ok() ? r.items : OverlayRules.unexpired(last, now);
    }

    /** True when every link an entry carries points at the hub: one that doesn't is never shown as something to decide. */
    private static boolean linksOnHub(String hub, JSONObject p) {
        for (String k : LINKS) if (p.opt(k) instanceof String && !isHub(hub, (String) p.opt(k))) return false;
        return true;
    }

    static boolean isApprovalId(String id) { return id != null && APPROVAL_ID.matcher(id).matches(); }

    /** True when {@code url} points at exactly the hub's origin (https, same host, the default port, no user info). */
    static boolean isHub(String hub, String url) {
        try {
            URI b = new URI(hub), u = new URI(url == null ? "" : url);
            if (!"https".equalsIgnoreCase(u.getScheme()) || u.getRawUserInfo() != null || u.getHost() == null) return false;
            if (u.getPort() != -1 && u.getPort() != 443) return false;
            return u.getHost().equalsIgnoreCase(b.getHost());
        } catch (Exception e) { return false; }
    }

    private static String title(JSONObject p, String fallback) {
        String t = str(p, "title");
        JSONObject reason = p.optJSONObject("reason");
        if ((t == null || t.trim().isEmpty()) && reason != null) t = str(reason, "title");
        t = t == null ? "" : t.replaceAll("[\\u0000-\\u001f\\u007f]+", " ").trim();
        if (t.isEmpty()) t = fallback;
        return t.length() > 200 ? t.substring(0, 200) : t;
    }

    private static String str(JSONObject o, String k) { return o.opt(k) instanceof String ? (String) o.opt(k) : null; }

    private static String orElse(String v, String fallback) { return v == null || v.isEmpty() ? fallback : v; }

    private static Double num(JSONObject o, String k) {
        Object v = o.opt(k);
        if (!(v instanceof Number)) return null;
        double d = ((Number) v).doubleValue();
        return Double.isNaN(d) || Double.isInfinite(d) ? null : d;
    }

    /** Epoch ms of an ISO time, or -1. */
    private static long time(String iso) {
        if (iso == null || iso.isEmpty()) return -1;
        try { return Instant.parse(iso).toEpochMilli(); } catch (Exception e) { return -1; }
    }
}
