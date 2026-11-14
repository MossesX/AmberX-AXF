package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.Test;

/**
 * Pins the overlay contract ({@code overlay@1}) so no part of the console app, and no later step of part 2, renames a
 * state, verb, setting, event or bridge method without the console side ({@code nativeRules.mjs}) and the help moving
 * with it.
 */
public class OverlayContractTest {
    @Test public void statesAndVerbsAreTheOnesTheConsoleKnows() {
        assertEquals("overlay@1", OverlayContract.VERSION);
        assertEquals(Arrays.asList("toolbar", "approvals", "expanded"), OverlayContract.STATES);
        assertEquals(Arrays.asList("expand", "collapse", "toggle", "approvals", "dismiss"), OverlayContract.VERBS);
        assertEquals(Arrays.asList("expand", "collapse"), OverlayContract.URL_VERBS);
        assertTrue(OverlayContract.VERBS.containsAll(OverlayContract.URL_VERBS));
        assertTrue(OverlayContract.VERBS.containsAll(OverlayContract.PASSIVE_VERBS));
        // the rules and the device link use the same words
        assertEquals(OverlayContract.TOOLBAR, OverlayRules.TOOLBAR);
        assertEquals(OverlayContract.APPROVALS, OverlayRules.APPROVALS);
        assertEquals(OverlayContract.EXPANDED, OverlayRules.EXPANDED);
        assertEquals(OverlayContract.EXPAND, DeviceRules.EXPAND);
        assertEquals(OverlayContract.COLLAPSE, DeviceRules.COLLAPSE);
        assertEquals(OverlayContract.URL_PARAM, DeviceRules.VERB_PARAM);
    }

    @Test public void everyVerbMovesTheRules() {
        for (String v : OverlayContract.VERBS) {
            assertTrue(v, OverlayContract.isVerb(v));
            assertTrue(v, OverlayContract.STATES.contains(OverlayRules.verb(OverlayContract.TOOLBAR, v)));
        }
        assertTrue(OverlayContract.isVerb("EXPAND"));
        assertFalse(OverlayContract.isVerb("open"));
        assertFalse(OverlayContract.isVerb(""));
        assertFalse(OverlayContract.isVerb(null));
        assertEquals("overlay verbs: expand, collapse, toggle, approvals, dismiss", OverlayContract.verbsHelp());
    }

    @Test public void bridgeMethodsAndEvents() {
        assertEquals(Arrays.asList("overlay", "overlayState", "overlayConfigure", "overlayApprovals"), OverlayContract.METHODS);
        assertEquals(Arrays.asList("overlay", "overlay.moved", "approvals.open", "permissions"), OverlayContract.EVENTS);
    }

    @Test public void settingsAreTheConsolesApprovalsBannerOnes() {
        assertEquals("approvals-banner.overlay.", OverlayContract.SETTING_PREFIX);
        assertEquals(OverlayContract.SETTING_PREFIX, OverlayRules.PREFIX);
        assertEquals(Arrays.asList("on", "edge", "top", "size", "expand", "idleOpacity"), OverlayContract.SETTINGS);
        assertEquals("approvals-banner.overlay.edge", OverlayContract.settingKey("edge"));
        // the defaults and ranges the rules clamp to
        OverlayRules.Config c = OverlayRules.config(null);
        assertEquals(OverlayContract.TOP_DEFAULT, c.top);
        assertEquals(OverlayContract.IDLE_OPACITY_DEFAULT, c.idleOpacity);
        assertEquals(OverlayContract.EDGES.get(0), c.edge);
        assertEquals(OverlayContract.SIZES.get(0), c.size);
        assertEquals(OverlayContract.EXPANDS.get(0), c.expand);
        java.util.Map<String, Object> m = new java.util.HashMap<>();
        m.put("top", 500); m.put("idleOpacity", 0);
        c = OverlayRules.config(m);
        assertEquals(OverlayContract.TOP_MAX, c.top);
        assertEquals(OverlayContract.IDLE_OPACITY_MIN, c.idleOpacity);
        for (String e : OverlayContract.EDGES) { m.put("edge", e); assertEquals(e, OverlayRules.config(m).edge); }
        for (String s : OverlayContract.SIZES) { m.put("size", s); assertEquals(s, OverlayRules.config(m).size); }
        for (String x : OverlayContract.EXPANDS) { m.put("expand", x); assertEquals(x, OverlayRules.config(m).expand); }
    }

    @Test public void fourWaysInNameTheSameThing() {
        assertEquals("native.overlay:expand", OverlayContract.action("expand"));
        assertEquals("native.permission", OverlayContract.ACTION_PERMISSION);
        assertEquals("native.state", OverlayContract.ACTION_STATE);
        assertEquals("panel:phone-app", OverlayContract.CONTROL_ADDRESS);
        assertEquals("approvals.view", OverlayContract.APPROVALS_TARGET);
        assertEquals(OverlayContract.APPROVALS_TARGET, OverlayRules.APPROVALS_PAGE);
        assertEquals("axf-console://open/approvals.view", OverlayContract.approvalsLink());
        assertEquals(ShellRules.HOME + "?axf-open=approvals.view", ShellRules.deepLink(OverlayContract.approvalsLink()));
        assertEquals("overlay", OverlayContract.PERMISSION);
        assertEquals("android.permission.SYSTEM_ALERT_WINDOW", OverlayContract.ANDROID_PERMISSION);
        assertEquals("ai.amberx.consoleapp.OVERLAY", OverlayContract.INTENT_ACTION);
        assertEquals("adb shell am start-foreground-service -n ai.amberx.consoleapp/.OverlayService -a ai.amberx.consoleapp.OVERLAY --es verb toggle", OverlayContract.adb("Toggle"));
        assertNull(OverlayContract.adb("open"));
        // a console URL carrying the verb is a verb, not a page
        assertEquals("expand", DeviceRules.verb("https://console.amberxai.com/?axf-overlay=expand"));
    }

    @Test public void stateJsonCarriesEveryKeyOnce() {
        OverlayRules.Config c = new OverlayRules.Config();
        String j = OverlayContract.stateJson(true, "approvals", 2, 1, 0, c);
        assertEquals("{\"running\":true,\"state\":\"approvals\",\"waiting\":2,\"held\":1,\"dismissedAt\":0,\"on\":true,\"edge\":\"end\",\"top\":30,\"size\":\"small\",\"expand\":\"every\",\"idleOpacity\":85}", j);
        for (String k : OverlayContract.STATE_KEYS) {
            String key = "\"" + k + "\":";
            assertTrue(k, j.contains(key));
            assertEquals(k, j.indexOf(key), j.lastIndexOf(key));
        }
        // an unknown state and negative counts never leak into the answer
        String bad = OverlayContract.stateJson(false, "weird", -1, -2, -3, c);
        assertTrue(bad.contains("\"state\":\"toolbar\""));
        assertTrue(bad.contains("\"waiting\":0,\"held\":0,\"dismissedAt\":0"));
    }
}
