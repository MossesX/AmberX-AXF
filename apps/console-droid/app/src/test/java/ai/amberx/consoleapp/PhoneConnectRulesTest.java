package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.junit.Test;

public class PhoneConnectRulesTest {
    @Test public void onlyPhoneConnectAndThisAppMayCall() {
        assertNull(PhoneConnectRules.refuse("ai.amberx.axf.phoneconnect", "open"));
        assertNull(PhoneConnectRules.refuse("ai.amberx.consoleapp", "state"));
        assertEquals(PhoneConnectRules.DENIED, PhoneConnectRules.refuse("com.example.other", "open"));
        assertEquals(PhoneConnectRules.DENIED, PhoneConnectRules.refuse(null, "open"));
        assertEquals(PhoneConnectRules.DENIED, PhoneConnectRules.refuse("", "open"));
    }

    @Test public void onlyKnownMethods() {
        assertEquals(PhoneConnectRules.VALIDATION, PhoneConnectRules.refuse("ai.amberx.axf.phoneconnect", "decide"));
        assertEquals(PhoneConnectRules.VALIDATION, PhoneConnectRules.refuse("ai.amberx.axf.phoneconnect", null));
    }

    @Test public void browserAndNoOverlayGoBackToPhoneConnect() {
        assertNull(PhoneConnectRules.handOff("overlay", true, true));
        assertNull(PhoneConnectRules.handOff("", true, true));
        assertNull(PhoneConnectRules.handOff(null, true, true));
        assertEquals(PhoneConnectRules.BROWSER, PhoneConnectRules.handOff("browser", true, true));
        assertEquals(PhoneConnectRules.NO_OVERLAY, PhoneConnectRules.handOff("overlay", true, false));
        assertEquals(PhoneConnectRules.NO_OVERLAY, PhoneConnectRules.handOff("overlay", false, false));
    }

    /** The permission alone is enough: with the toolbar off the app itself comes to the front, no notification tap. */
    @Test public void permissionWithoutToolbarOpensTheApp() {
        assertNull(PhoneConnectRules.handOff("overlay", false, true));
        assertEquals("console-app", PhoneConnectRules.how(false));
        assertEquals("console-overlay", PhoneConnectRules.how(true));
    }

    /** "Opened" is only said once the page is on screen: a start Android held back is a failure, not a yes. */
    @Test public void openedOnlyWhenOnScreen() {
        assertTrue(PhoneConnectRules.front(true, false));
        assertTrue(PhoneConnectRules.front(false, true));
        assertFalse(PhoneConnectRules.front(false, false));
        assertFalse(PhoneConnectRules.message(PhoneConnectRules.UNAVAILABLE).isEmpty());
    }

    @Test public void everyCodeSaysWhy() {
        for (String code : new String[] { PhoneConnectRules.DENIED, PhoneConnectRules.VALIDATION, PhoneConnectRules.NO_OVERLAY, PhoneConnectRules.BROWSER })
            assertFalse(code, PhoneConnectRules.message(code).isEmpty());
    }

    @Test public void authorityIsThePackagesOwn() {
        assertEquals("ai.amberx.consoleapp.overlay", PhoneConnectRules.AUTHORITY);
        assertTrue(PhoneConnectRules.CALLERS.contains(OverlayContract.PACKAGE));
    }

    /** The manifest registers the provider under the authority Phone Connect calls. */
    @Test public void manifestDeclaresTheProvider() throws Exception {
        String m = read(Paths.get("src/main/AndroidManifest.xml"));
        assertTrue(m.contains("android:name=\".PhoneConnectProvider\""));
        assertTrue(m.contains("android:authorities=\"" + PhoneConnectRules.AUTHORITY + "\""));
    }

    /** Phone Connect's twin (ConsoleOverlay.kt) and manifest use the same names, so the hand-off can't drift. */
    @Test public void phoneConnectTwinMatches() throws Exception {
        Path pc = Paths.get("../../phone-connect/app/src/main");
        String kt = read(pc.resolve("kotlin/ai/amberx/axf/phoneconnect/watch/ConsoleOverlay.kt"));
        assertTrue(kt.contains("AUTHORITY = \"" + PhoneConnectRules.AUTHORITY + "\""));
        assertTrue(kt.contains("OPEN = \"" + PhoneConnectRules.OPEN + "\""));
        assertTrue(kt.contains("EXTRA_WHERE = \"" + PhoneConnectRules.EXTRA_WHERE + "\""));
        assertTrue(kt.contains("\"" + PhoneConnectRules.K_OK + "\"") && kt.contains("\"" + PhoneConnectRules.K_JSON + "\""));
        assertTrue(kt.contains("STATE = \"" + PhoneConnectRules.STATE + "\""));
        assertTrue(kt.contains("NO_OVERLAY = \"" + PhoneConnectRules.NO_OVERLAY + "\""));
        assertTrue(kt.contains("ACTIVITY = \"" + OverlayContract.PACKAGE + ".ConsoleActivity\""));
        String rules = read(pc.resolve("kotlin/ai/amberx/axf/phoneconnect/link/LinkRules.kt"));
        assertTrue(rules.contains("\"" + PhoneConnectRules.HOW_OVERLAY + "\"") && rules.contains("\"" + PhoneConnectRules.HOW_APP + "\""));
        String manifest = read(pc.resolve("AndroidManifest.xml"));
        assertTrue(manifest.contains("<package android:name=\"" + OverlayContract.PACKAGE + "\""));
        String gradle = read(Paths.get("../../phone-connect/app/build.gradle.kts"));
        assertTrue(gradle.contains("applicationId = \"" + PhoneConnectRules.PHONE_CONNECT + "\""));
    }

    private static String read(Path p) throws Exception {
        return new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
    }
}
