package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.Arrays;
import org.json.JSONObject;
import org.junit.Test;

/** The native bridge contract (native-bridge@1): one vocabulary for the page, axHub, the console API, the CLI and voice. */
public class BridgeContractTest {
    @Test public void everyHubNameMapsOntoOneTool() {
        assertEquals(BridgeContract.OPEN, BridgeContract.tool("amberx.open_url"));
        assertEquals(BridgeContract.OPEN, BridgeContract.tool("browser.open"));
        assertEquals(BridgeContract.OPEN, BridgeContract.tool(" Open_URL "));
        assertEquals(BridgeContract.REC_START, BridgeContract.tool("amberx.recorder_start"));
        assertEquals(BridgeContract.REC_STOP, BridgeContract.tool("recorder.stop"));
        assertEquals(BridgeContract.REC_STATUS, BridgeContract.tool("recorder_status"));
        assertEquals(BridgeContract.WAKE, BridgeContract.tool("console_wake"));
        assertEquals(BridgeContract.WAKE, BridgeContract.tool("amberx.console_wake"));
        assertEquals(BridgeContract.NOTIFY_SHOW, BridgeContract.tool("notify"));
        assertEquals(BridgeContract.MIC_SET, BridgeContract.tool("mic.on"));
        assertEquals(BridgeContract.INFO, BridgeContract.tool("version"));
        assertNull(BridgeContract.tool("recorder.mic"));
        assertNull(BridgeContract.tool(""));
        assertNull(BridgeContract.tool(null));
        for (String t : BridgeContract.TOOLS) assertEquals(t, BridgeContract.tool(t));
    }

    @Test public void hubNamesAreAmberXsSoAxHubKeepsWorking() {
        assertEquals("amberx.open_url", BridgeContract.hubName(BridgeContract.OPEN));
        assertEquals("amberx.recorder_start", BridgeContract.hubName(BridgeContract.REC_START));
        assertEquals("amberx.recorder_stop", BridgeContract.hubName(BridgeContract.REC_STOP));
        assertEquals("amberx.recorder_status", BridgeContract.hubName(BridgeContract.REC_STATUS));
        assertEquals("amberx.console_wake", BridgeContract.hubName(BridgeContract.WAKE));
        assertEquals("amberx.notify", BridgeContract.hubName(BridgeContract.NOTIFY_SHOW));
        assertEquals("amberx.mic_status", BridgeContract.hubName(BridgeContract.MIC_STATUS));
        assertNull(BridgeContract.hubName(BridgeContract.PERM_REQUEST)); // page only
        // every hub name round-trips onto its tool
        for (String t : BridgeContract.HUB_TOOLS) assertEquals(t, BridgeContract.tool(BridgeContract.hubName(t)));
    }

    @Test public void theHubGetsNoPromptsOrPhoneSettings() {
        assertTrue(BridgeContract.hubTool(BridgeContract.OPEN));
        assertTrue(BridgeContract.hubTool(BridgeContract.REC_START));
        assertTrue(BridgeContract.hubTool(BridgeContract.WAKE));
        assertTrue(BridgeContract.hubTool(BridgeContract.NOTIFY_SHOW));
        assertFalse(BridgeContract.hubTool(BridgeContract.PERM_REQUEST));
        assertFalse(BridgeContract.hubTool(BridgeContract.MIC_SET));
        assertEquals(Arrays.asList(BridgeContract.REC_START), BridgeContract.NEVER_AUTO);
    }

    @Test public void micOnOffCarryTheirArgument() throws Exception {
        assertTrue(BridgeContract.argsFor("mic.on", null).getBoolean("on"));
        assertFalse(BridgeContract.argsFor("mic.off", new JSONObject().put("on", true)).getBoolean("on"));
        assertFalse(BridgeContract.argsFor("mic.set", new JSONObject()).has("on"));
    }

    @Test public void capabilitiesKeepAmberXsAndAddTheShellsOwn() {
        assertEquals("recorder@1", BridgeContract.capabilityOf(BridgeContract.REC_START));
        assertEquals("open-url@1", BridgeContract.capabilityOf(BridgeContract.OPEN));
        assertEquals("console-wake@1", BridgeContract.capabilityOf(BridgeContract.WAKE));
        assertEquals("mic@1", BridgeContract.capabilityOf(BridgeContract.MIC_SET));
        assertEquals("notify@1", BridgeContract.capabilityOf(BridgeContract.NOTIFY_CANCEL));
        assertNull(BridgeContract.capabilityOf(BridgeContract.PING));
        assertTrue(BridgeContract.CAPABILITIES_ALL.containsAll(Arrays.asList("recorder@1", "open-url@1")));
        assertEquals("console-droid", BridgeContract.APP);
    }

    @Test public void permissions() throws Exception {
        assertEquals(Arrays.asList("mic", "notifications", "overlay"), BridgeContract.permissionKeys());
        assertEquals(BridgeContract.RECORD_AUDIO, BridgeContract.permission("mic"));
        assertEquals(BridgeContract.RECORD_AUDIO, BridgeContract.permission(BridgeContract.RECORD_AUDIO));
        assertEquals("overlay", BridgeContract.permissionKey(BridgeContract.DRAW_OVER));
        assertNull(BridgeContract.permission("camera"));
        assertNull(BridgeContract.permissionKey("android.permission.CAMERA"));

        assertEquals(Arrays.asList(BridgeContract.POST_NOTIFICATIONS), BridgeContract.permissionsFor(BridgeContract.REC_START, new JSONObject()));
        assertEquals(Arrays.asList(BridgeContract.POST_NOTIFICATIONS, BridgeContract.RECORD_AUDIO), BridgeContract.permissionsFor(BridgeContract.REC_START, new JSONObject().put("mic", true)));
        assertEquals(Arrays.asList(BridgeContract.RECORD_AUDIO), BridgeContract.permissionsFor(BridgeContract.MIC_SET, new JSONObject().put("on", true)));
        assertTrue(BridgeContract.permissionsFor(BridgeContract.MIC_SET, new JSONObject().put("on", false)).isEmpty());
        assertEquals(Arrays.asList(BridgeContract.POST_NOTIFICATIONS), BridgeContract.permissionsFor(BridgeContract.NOTIFY_SHOW, null));
        assertTrue(BridgeContract.permissionsFor(BridgeContract.OPEN, null).isEmpty());
        assertTrue(BridgeContract.permissionsFor(BridgeContract.WAKE, null).isEmpty());
    }

    @Test public void callsFromThePage() throws Exception {
        BridgeContract.Call c = BridgeContract.parse("{\"id\":\"c1-abc\",\"tool\":\"amberx.recorder_start\",\"args\":{\"session_name\":\"x\"}}");
        assertEquals("c1-abc", c.id);
        assertEquals(BridgeContract.REC_START, c.tool);
        assertEquals("amberx.recorder_start", c.name);
        assertEquals("x", c.args.getString("session_name"));
        assertEquals(0, BridgeContract.parse("{\"id\":\"a\",\"tool\":\"bridge.ping\"}").args.length());
        assertTrue(BridgeContract.parse("{\"id\":\"a\",\"tool\":\"mic.on\"}").args.getBoolean("on"));

        assertEquals("k", BridgeContract.idOf("{\"id\":\"k\",\"tool\":\"nope\"}"));
        assertNull(BridgeContract.idOf("not json"));
        assertNull(BridgeContract.idOf("{\"id\":7}"));

        String[] bad = {
            null, "", "[]", "nope",
            "{\"tool\":\"bridge.ping\"}",                     // no id
            "{\"id\":\"\",\"tool\":\"bridge.ping\"}",         // empty id
            "{\"id\":\"a b\",\"tool\":\"bridge.ping\"}",      // id with a space
            "{\"id\":\"a\",\"tool\":\"recorder.mic\"}",       // unknown tool
            "{\"id\":\"a\"}",                                 // no tool
            "{\"id\":\"a\",\"tool\":\"bridge.ping\",\"args\":[1]}", // args not an object
        };
        for (String b : bad) {
            try { BridgeContract.parse(b); fail("accepted " + b); } catch (IllegalArgumentException expected) { assertFalse(expected.getMessage().isEmpty()); }
        }
        StringBuilder huge = new StringBuilder("{\"id\":\"a\",\"tool\":\"bridge.ping\",\"args\":{\"x\":\"");
        for (int i = 0; i < BridgeContract.MAX_CALL; i++) huge.append('x');
        try { BridgeContract.parse(huge.append("\"}}").toString()); fail(); } catch (IllegalArgumentException expected) { assertTrue(expected.getMessage().contains("too long")); }
    }

    @Test public void answersAndEvents() throws Exception {
        JSONObject ok = BridgeContract.result("c1", BridgeContract.PING, new JSONObject().put("pong", true));
        assertEquals("c1", ok.getString("id"));
        assertEquals(BridgeContract.PING, ok.getString("tool"));
        assertTrue(ok.getBoolean("ok"));
        assertTrue(ok.getJSONObject("data").getBoolean("pong"));
        assertEquals(0, BridgeContract.result("c2", BridgeContract.PING, null).getJSONObject("data").length());

        JSONObject err = BridgeContract.error("c1", BridgeContract.OPEN, BridgeContract.E_BAD_ARGS, "url is required.");
        assertFalse(err.getBoolean("ok"));
        assertEquals("bad_args", err.getJSONObject("error").getString("code"));
        assertEquals("url is required.", err.getJSONObject("error").getString("message"));
        assertTrue(BridgeContract.error(null, null, BridgeContract.E_UNKNOWN, "x").isNull("id"));
        try { BridgeContract.error("c1", BridgeContract.OPEN, "boom", "x"); fail(); } catch (IllegalArgumentException expected) { /* codes are fixed */ }

        JSONObject perm = BridgeContract.permissionError("c3", BridgeContract.REC_START, Arrays.asList(BridgeContract.RECORD_AUDIO, BridgeContract.POST_NOTIFICATIONS));
        assertEquals("permission", perm.getJSONObject("error").getString("code"));
        assertEquals("mic", perm.getJSONObject("error").getJSONArray("permissions").getString(0));
        assertEquals("notifications", perm.getJSONObject("error").getJSONArray("permissions").getString(1));
        assertTrue(perm.getJSONObject("error").getString("message").contains("mic, notifications"));

        assertEquals("bad_args", BridgeContract.codeFor(new IllegalArgumentException("x")));
        assertEquals("permission", BridgeContract.codeFor(new SecurityException("x")));
        assertEquals("not_implemented", BridgeContract.codeFor(new UnsupportedOperationException("x")));
        assertEquals("unavailable", BridgeContract.codeFor(new RuntimeException("x")));

        JSONObject ev = BridgeContract.event(BridgeContract.EV_LINK, new JSONObject().put("up", true));
        assertEquals("link", ev.getString("event"));
        assertTrue(ev.getJSONObject("data").getBoolean("up"));
        try { BridgeContract.event("boom", null); fail(); } catch (IllegalArgumentException expected) { /* events are fixed */ }
    }

    @Test public void onlyBrettsSitesGetTheBridge() {
        assertTrue(BridgeContract.allowedFrom("https://console.amberxai.com/?axf-open=settings"));
        assertFalse(BridgeContract.allowedFrom("file:///android_asset/offline.html"));
        assertFalse(BridgeContract.allowedFrom("https://example.com/"));
        assertFalse(BridgeContract.allowedFrom(null));
    }

    @Test public void thePageSideScript() throws Exception {
        String js = BridgeContract.script();
        assertTrue(js.contains("window.axfNative="));
        assertTrue(js.contains("window.axfBridgeHost"));
        assertTrue(js.contains("\"native-bridge@1\""));
        assertTrue(js.contains("\"axf-native\""));
        assertTrue(js.contains("\"axf-native-ready\""));
        assertTrue(js.contains("host.call(JSON.stringify("));
        assertTrue(js.startsWith("(function(){") && js.endsWith("})();"));

        String d = BridgeContract.deliver(BridgeContract.result("c1", BridgeContract.PING, new JSONObject().put("line", "a b")));
        assertTrue(d.startsWith("window.dispatchEvent(new CustomEvent(\"axf-native\",{detail:{"));
        assertFalse(d.contains(" "));
        assertTrue(d.contains("\\u2028"));
        assertTrue(d.endsWith("}));"));
    }
}
