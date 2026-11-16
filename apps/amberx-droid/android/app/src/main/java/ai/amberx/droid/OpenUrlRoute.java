package ai.amberx.droid;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * open-url-route@1 on the phone (framework/core/open-url-route.mjs is the reference engine): the order AmberX tries to
 * put a page on Brett's screen, and the one result shape every attempt reports.
 *
 * Brett, Nov 16 2026: "It sent a notification, but it didn't open. I have the browser open right now." AmberX used to
 * try one background start and fall back to a notification. Now, in order:
 *   console-tab          the console tab Brett has on screen opens it (POST /api/console-control/navigate)
 *   overlay              AmberX's toolbar expands into its full-screen browser (Display over other apps on)
 *   direct               AmberX starts the browser itself: in front, or exempt because Display over other apps is on
 *   full-screen-intent   a full-screen notice whose trampoline opens the browser (locked phone, or the permission held)
 *   notification         a tap-to-open notification, the last resort, never "opened"
 *
 * Pure (no Android imports): {@code OpenUrlRouteTest} runs it under plain JUnit; {@link AxppLink} does the attempts.
 */
final class OpenUrlRoute {
    private OpenUrlRoute() {}

    static final String SCHEMA = "open-url-route@1";
    static final String RESULT = "open-url-result@1";
    static final String CONSOLE_TAB = "console-tab", OVERLAY = "overlay", DIRECT = "direct", FULL_SCREEN = "full-screen-intent", NOTIFICATION = "notification", NONE = "none";
    static final String[] ROUTES = { CONSOLE_TAB, OVERLAY, DIRECT, FULL_SCREEN, NOTIFICATION };
    static final String NAVIGATE_PATH = "/api/console-control/navigate";

    /** What the phone knows when a page is asked for (the request's `phone` part plus `where`). */
    static final class Phone {
        boolean consoleSignedIn, inFront, overlay, overlayReady, notifications, fullScreenIntent, locked;
        String where = "auto";
    }

    /** Why a route is skipped for this phone, or "" when it is to be tried (= skipReason, phone side). */
    static String skip(String route, Phone p) {
        String w = p.where == null ? "auto" : p.where;
        switch (route) {
            case CONSOLE_TAB:
                if ("overlay".equals(w) || "browser".equals(w)) return "asked-elsewhere";
                return p.consoleSignedIn ? "" : "no-console";
            case OVERLAY:
                if ("console".equals(w)) return "console-only";
                if ("browser".equals(w)) return "asked-elsewhere";
                if (!p.overlay) return "overlay-off";
                return p.overlayReady ? "" : "overlay-not-ready";
            case DIRECT:
                if ("console".equals(w)) return "console-only";
                return p.overlay || p.inFront ? "" : "background-start-blocked";
            case FULL_SCREEN:
                if ("console".equals(w)) return "console-only";
                if (!p.notifications) return "notifications-off";
                return p.fullScreenIntent ? "" : "no-full-screen-intent";
            case NOTIFICATION:
                if ("console".equals(w)) return "console-only";
                return p.notifications ? "" : "notifications-off";
            default:
                return "nothing-left";
        }
    }

    /**
     * The routes to try, in order. One difference from the engine: on the phone the full-screen intent is tried while
     * unlocked too, since its trampoline activity is an allowed start whenever Android grants the permission (the
     * engine's `phone-unlocked` skip is for hosts that only see a banner). The attempt itself reports whether it landed.
     */
    static List<String> order(Phone p) {
        List<String> out = new ArrayList<>();
        for (String r : ROUTES) if (skip(r, p).isEmpty()) out.add(r);
        return out;
    }

    /** The success reason of a route (= successReason). */
    static String successReason(String route) {
        switch (route) {
            case CONSOLE_TAB: return "console-visible";
            case OVERLAY: return "overlay-open";
            case DIRECT: return "direct-start";
            case FULL_SCREEN: return "screen-locked-open";
            case NOTIFICATION: return "tap-to-open";
            default: return "nothing-left";
        }
    }

    /** One attempt: {route, opened, reason} (the reason is the success code when it worked). */
    static final class Attempt {
        final String route; final boolean ok; final String reason;
        Attempt(String route, boolean ok, String reason) { this.route = route; this.ok = ok; this.reason = ok ? successReason(route) : (reason == null || reason.isEmpty() ? "attempt-failed" : reason); }
    }

    /**
     * The open-url-result@1 from the phone's state and its attempts (= settle): skipped routes and failed attempts are
     * in `tried`, every attempt in `attempts` with {route, opened, reason}; a notification is `notified`, never `opened`.
     */
    static JSONObject settle(String url, Phone p, List<Attempt> attempts) throws Exception {
        JSONArray tried = new JSONArray();
        JSONArray each = new JSONArray();
        String won = null;
        boolean failed = false;
        for (String r : ROUTES) {
            if (won != null) break;
            String why = skip(r, p);
            Attempt a = null;
            for (Attempt x : attempts) if (x.route.equals(r)) a = x;
            if (!why.isEmpty() && a == null) { tried.put(new JSONObject().put("route", r).put("outcome", "skipped").put("reason", why)); continue; }
            if (a == null) { tried.put(new JSONObject().put("route", r).put("outcome", "not-tried").put("reason", "")); continue; }
            each.put(new JSONObject().put("route", r).put("opened", a.ok && !NOTIFICATION.equals(r)).put("reason", a.reason));
            if (a.ok) { won = r; tried.put(new JSONObject().put("route", r).put("outcome", "ok").put("reason", a.reason)); }
            else { failed = true; tried.put(new JSONObject().put("route", r).put("outcome", "failed").put("reason", a.reason)); }
        }
        String route = won == null ? NONE : won;
        return new JSONObject().put("$axf", RESULT).put("url", url).put("route", route)
            .put("opened", won != null && !NOTIFICATION.equals(won)).put("notified", NOTIFICATION.equals(won))
            .put("reason", won != null ? successReason(won) : failed ? "attempt-failed" : "nothing-left")
            .put("tried", tried).put("attempts", each);
    }

    /** The console's /navigate answer read as one attempt: opened → ok; anything else → the reason it gave. */
    static Attempt consoleAnswer(int status, String body) {
        try {
            JSONObject j = new JSONObject(body == null ? "" : body);
            if (j.optBoolean("opened")) return new Attempt(CONSOLE_TAB, true, "");
            String why = j.optString("reason", "");
            return new Attempt(CONSOLE_TAB, false, why.isEmpty() || "nothing-left".equals(why) ? (status == 401 || status == 403 ? "no-console" : "attempt-failed") : why);
        } catch (Exception e) {
            // signed out answers a redirect or the sign-in page, not JSON
            return new Attempt(CONSOLE_TAB, false, status >= 300 && status < 400 || status == 401 || status == 403 ? "no-console" : "console-stale");
        }
    }

    /** The body for POST /api/console-control/navigate. */
    static String navigateBody(String url) throws Exception {
        return new JSONObject().put("url", url).put("by", "amberx").toString();
    }
}
