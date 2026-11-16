package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

/**
 * open-url-route@1 on the phone: the route order for mocked permissions (the cases of
 * framework/spec/fixtures/open-url-phone-order.json, which check-open-url-route.mjs holds against the reference
 * engine), settle, and the console's answer.
 */
public class OpenUrlRouteTest {
    private static OpenUrlRoute.Phone phone(boolean console, boolean inFront, boolean overlay, boolean overlayReady, boolean notifications, boolean fsi, boolean locked, String where) {
        OpenUrlRoute.Phone p = new OpenUrlRoute.Phone();
        p.consoleSignedIn = console; p.inFront = inFront; p.overlay = overlay; p.overlayReady = overlayReady;
        p.notifications = notifications; p.fullScreenIntent = fsi; p.locked = locked; p.where = where;
        return p;
    }

    private static void order(String id, OpenUrlRoute.Phone p, String... want) {
        assertEquals(id, Arrays.asList(want), OpenUrlRoute.order(p));
    }

    @Test
    public void orderForMockedPermissions() {
        order("brett-nov-16", phone(true, false, false, false, true, true, false, "auto"), "console-tab", "full-screen-intent", "notification");
        order("signed-out-nothing-granted", phone(false, false, false, false, true, false, false, "auto"), "notification");
        order("overlay-granted-toolbar-up", phone(true, false, true, true, true, true, false, "auto"), "console-tab", "overlay", "direct", "full-screen-intent", "notification");
        order("overlay-granted-toolbar-off", phone(false, false, true, false, true, false, false, "auto"), "direct", "notification");
        order("amberx-in-front", phone(false, true, false, false, true, true, false, "auto"), "direct", "full-screen-intent", "notification");
        order("locked-idle", phone(true, false, false, false, true, true, true, "auto"), "console-tab", "full-screen-intent", "notification");
        order("notifications-off", phone(false, false, false, false, false, true, false, "auto"));
        order("asked-for-browser", phone(true, false, true, true, true, true, false, "browser"), "direct", "full-screen-intent", "notification");
        order("asked-for-console", phone(true, false, true, true, true, true, false, "console"), "console-tab");
    }

    @Test
    public void notificationIsNeverOpened() throws Exception {
        OpenUrlRoute.Phone p = phone(true, false, false, false, true, true, false, "auto");
        List<OpenUrlRoute.Attempt> a = new ArrayList<>();
        a.add(new OpenUrlRoute.Attempt("console-tab", false, "console-behind"));
        a.add(new OpenUrlRoute.Attempt("full-screen-intent", false, "phone-unlocked"));
        a.add(new OpenUrlRoute.Attempt("notification", true, ""));
        JSONObject r = OpenUrlRoute.settle("https://console.amberxai.com/", p, a);
        assertEquals("notification", r.getString("route"));
        assertFalse(r.getBoolean("opened"));
        assertTrue(r.getBoolean("notified"));
        assertEquals("tap-to-open", r.getString("reason"));
        assertEquals(3, r.getJSONArray("attempts").length());
        assertEquals("console-behind", r.getJSONArray("attempts").getJSONObject(0).getString("reason"));
        assertEquals("skipped", r.getJSONArray("tried").getJSONObject(1).getString("outcome")); // overlay off
        assertEquals("overlay-off", r.getJSONArray("tried").getJSONObject(1).getString("reason"));
    }

    @Test
    public void consoleTabWinsAndStops() throws Exception {
        OpenUrlRoute.Phone p = phone(true, false, false, false, true, true, false, "auto");
        List<OpenUrlRoute.Attempt> a = new ArrayList<>();
        a.add(new OpenUrlRoute.Attempt("console-tab", true, ""));
        JSONObject r = OpenUrlRoute.settle("https://console.amberxai.com/", p, a);
        assertEquals("console-tab", r.getString("route"));
        assertTrue(r.getBoolean("opened"));
        assertEquals("console-visible", r.getString("reason"));
        assertEquals(1, r.getJSONArray("tried").length());
    }

    @Test
    public void silentDropFallsThrough() throws Exception {
        OpenUrlRoute.Phone p = phone(false, false, true, false, true, true, false, "auto");
        List<OpenUrlRoute.Attempt> a = new ArrayList<>();
        a.add(new OpenUrlRoute.Attempt("direct", false, "background-start-blocked"));
        a.add(new OpenUrlRoute.Attempt("full-screen-intent", true, ""));
        JSONObject r = OpenUrlRoute.settle("https://console.amberxai.com/", p, a);
        assertEquals("full-screen-intent", r.getString("route"));
        assertTrue(r.getBoolean("opened"));
        assertEquals("failed", r.getJSONArray("tried").getJSONObject(2).getString("outcome"));
    }

    @Test
    public void consoleAnswers() {
        assertTrue(OpenUrlRoute.consoleAnswer(200, "{\"opened\":true,\"route\":\"console-tab\"}").ok);
        assertEquals("console-behind", OpenUrlRoute.consoleAnswer(503, "{\"opened\":false,\"reason\":\"console-behind\",\"fallThrough\":true}").reason);
        assertEquals("no-console", OpenUrlRoute.consoleAnswer(302, "<html>sign in</html>").reason);
        assertEquals("console-stale", OpenUrlRoute.consoleAnswer(502, "bad gateway").reason);
    }

    @Test
    public void openPagesVerbs() {
        assertEquals("grant", OpenUrlRules.pagesVerb("https://console.amberxai.com/?axf-open-pages=grant"));
        assertEquals("state", OpenUrlRules.pagesVerb("https://console.amberxai.com/?a=1&axf-open-pages=STATE"));
        assertEquals("", OpenUrlRules.pagesVerb("https://console.amberxai.com/?axf-open-pages=delete"));
        assertEquals("", OpenUrlRules.pagesVerb("https://console.amberxai.com/"));
        assertTrue(OpenUrlRules.known(OpenUrlRules.PAGES_STATE) && OpenUrlRules.known(OpenUrlRules.PAGES_TEST));
    }
}
