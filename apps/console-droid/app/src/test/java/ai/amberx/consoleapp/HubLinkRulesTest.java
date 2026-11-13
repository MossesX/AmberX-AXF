package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.security.SecureRandom;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The axHub device link and the moved device tools: AmberX's AXPP, unchanged on the wire (part 3, s3). */
public class HubLinkRulesTest {
    @Test public void onlyTheOneHubAndItsThreeRoutes() {
        assertEquals("https://axhub.amberxai.com/axpp/v1/next", HubLinkRules.url("next"));
        try { HubLinkRules.url("../admin"); fail(); } catch (IllegalArgumentException expected) { /* refused */ }
    }

    @Test public void deviceIdsAndBackoff() {
        String id = HubLinkRules.newDeviceId(new SecureRandom());
        assertTrue(id.startsWith("console-droid-"));
        assertTrue(HubLinkRules.validDeviceId(id));
        assertFalse(HubLinkRules.validDeviceId("short"));
        assertFalse(HubLinkRules.validDeviceId(null));
        assertEquals(5_000, HubLinkRules.backoff(1));
        assertEquals(60_000, HubLinkRules.backoff(9));
        assertEquals(60_000, HubLinkRules.waitAfter(401, 1));
        assertEquals(15_000, HubLinkRules.waitAfter(500, 2));
    }

    @Test public void helloIsTheAmberxDeviceService() throws Exception {
        JSONArray caps = new JSONArray().put("open-url@1").put("console-wake@1").put("notify@1");
        JSONObject e = HubLinkRules.hello("console-droid-0123456789abcdef", "Pixel 9", "0.3.0", caps, new JSONObject());
        assertEquals("axpp@1", e.getString("protocol"));
        assertEquals("hello", e.getString("kind"));
        JSONObject p = e.getJSONObject("payload");
        assertEquals("console-droid", p.getString("app"));
        assertEquals("amberx", p.getString("service"));
        assertEquals("native-bridge@1", p.getString("bridge"));
        assertEquals(3, p.getJSONArray("capabilities").length());
    }

    @Test public void hubCallsKeepAmberxNames() throws Exception {
        JSONObject env = new JSONObject().put("kind", "call").put("id", "call-1")
            .put("payload", new JSONObject().put("tool", "amberx.open_url").put("arguments", new JSONObject().put("url", "https://console.amberxai.com/")));
        HubLinkRules.HubCall c = HubLinkRules.callOf(env);
        assertEquals("call-1", c.id);
        assertEquals(BridgeContract.OPEN, BridgeContract.tool(c.name));
        assertEquals("https://console.amberxai.com/", c.args.getString("url"));
        // AmberX's AXPP names and axHub's MCP names all land on one bridge tool
        assertEquals(BridgeContract.OPEN, BridgeContract.tool("browser.open"));
        assertEquals(BridgeContract.REC_START, BridgeContract.tool("amberx.recorder_start"));
        assertEquals(BridgeContract.WAKE, BridgeContract.tool("amberx.console_wake"));
        assertEquals(BridgeContract.NOTIFY_SHOW, BridgeContract.tool("amberx.notify"));
        try { HubLinkRules.callOf(new JSONObject().put("kind", "hello")); fail(); } catch (IllegalArgumentException expected) { /* not a call */ }
    }

    @Test public void repliesCarryTheBridgeAnswer() throws Exception {
        JSONObject ok = HubLinkRules.reply("call-1", BridgeContract.result(null, BridgeContract.OPEN, new JSONObject().put("opened", true)), null);
        assertEquals("result", ok.getString("kind"));
        assertEquals("call-1", ok.getString("correlationId"));
        assertTrue(ok.getJSONObject("payload").getJSONObject("data").getBoolean("opened"));

        JSONObject perm = HubLinkRules.reply("call-2", BridgeContract.permissionError(null, BridgeContract.NOTIFY_SHOW,
            java.util.Collections.singletonList(BridgeContract.POST_NOTIFICATIONS)), null);
        assertEquals("error", perm.getString("kind"));
        assertEquals("permission", perm.getJSONObject("payload").getString("code"));
        assertEquals("notifications", perm.getJSONObject("payload").getJSONArray("permissions").getString(0));

        JSONObject none = HubLinkRules.reply("call-3", null, null);
        assertEquals("unavailable", none.getJSONObject("payload").getString("code"));
        assertEquals("deviceId", HubLinkRules.answerBody("d", none).keys().next());
    }

    @Test public void deviceRules() {
        assertEquals("browser", DeviceRules.where(" Browser "));
        assertEquals("app", DeviceRules.where(""));
        assertEquals(ShellRules.HOME, DeviceRules.wakeUrl("", ""));
        assertEquals(ShellRules.HOME, DeviceRules.wakeUrl(null, "https://example.com/"));
        assertTrue(DeviceRules.wakeUrl("panel:phone-app", "").startsWith(ShellRules.HOME + "?axf-open="));
        try { DeviceRules.wakeUrl("javascript:alert(1) x", ""); fail(); } catch (IllegalArgumentException expected) { /* refused */ }
        assertEquals("n1", DeviceRules.noteId("n1", "t"));
        assertEquals(DeviceRules.noteId("", "Build done"), DeviceRules.noteId("bad id!", "Build done"));
    }
}
