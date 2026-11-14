package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONObject;
import org.junit.Test;

/** Mic switch, Android's mic permission and permission requests (part 3, s4). */
public class MicRulesTest {
    @Test public void statusSaysWhichGateIsClosed() throws Exception {
        assertEquals("ok", MicRules.status(true, true).getString("reason"));
        assertTrue(MicRules.status(true, true).getBoolean("available"));
        assertEquals("switched_off", MicRules.status(false, true).getString("reason"));
        assertEquals("no_permission", MicRules.status(true, false).getString("reason"));
        assertFalse(MicRules.status(true, false).getBoolean("available"));
    }

    @Test public void micSetNeedsARealBoolean() throws Exception {
        assertTrue(MicRules.onOf(new JSONObject().put("on", true)));
        assertTrue(MicRules.onOf(BridgeContract.argsFor("mic.on", null)));
        assertFalse(MicRules.onOf(BridgeContract.argsFor("mic.off", null)));
        try { MicRules.onOf(new JSONObject().put("on", "yes")); fail(); } catch (IllegalArgumentException expected) { /* bad_args */ }
        try { MicRules.onOf(null); fail(); } catch (IllegalArgumentException expected) { /* bad_args */ }
    }

    @Test public void permissionNames() throws Exception {
        assertEquals("mic", MicRules.permissionOf(new JSONObject().put("permission", "Microphone")));
        assertEquals("notifications", MicRules.permissionOf(new JSONObject().put("permission", "notify")));
        assertEquals("overlay", MicRules.permissionOf(new JSONObject().put("permission", "overlay")));
        try { MicRules.permissionOf(new JSONObject().put("permission", "camera")); fail(); } catch (IllegalArgumentException expected) { /* not ours */ }
        // every requestable key is one the contract knows
        for (String k : MicRules.REQUESTABLE) assertTrue(k, BridgeContract.permissionKeys().contains(k));
    }

    @Test public void webCaptureNeedsOwnSiteAndSwitch() {
        assertTrue(MicRules.webCaptureAllowed(true, true));
        assertFalse(MicRules.webCaptureAllowed(false, true));
        assertFalse(MicRules.webCaptureAllowed(true, false));
    }

    @Test public void requestAnswers() throws Exception {
        JSONObject r = MicRules.requested("mic", false, true);
        assertEquals("mic", r.getString("permission"));
        assertTrue(r.getBoolean("asked"));
        assertFalse(r.getBoolean("granted"));
    }
}
