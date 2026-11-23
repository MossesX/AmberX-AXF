package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * A tap on the floating toolbar (Brett, Nov 23 2026: "When there's notifications on the overlay and I click it, it
 * should bring me to the approvals, not to the console"): the approvals page while something waits, the console when
 * nothing does.
 */
public class OverlayTapTest {
    private static final String APPROVALS = "https://axhub.amberxai.com/auth/admin/approvals";

    @Test public void aTapWithSomethingWaitingOpensTheApprovalsPage() {
        assertEquals("approvals", OverlayRules.tapVerb(OverlayRules.TOOLBAR, 2));
        assertEquals("approvals", OverlayRules.tapVerb(OverlayRules.APPROVALS, 1));
        // the verb opens the overlay on axHub's approvals page, one of Brett's own sites
        assertEquals(OverlayRules.EXPANDED, OverlayRules.verb(OverlayRules.TOOLBAR, OverlayRules.tapVerb(OverlayRules.TOOLBAR, 2)));
        assertEquals(APPROVALS, OverlayContract.APPROVALS_URL);
        assertEquals(APPROVALS, OverlayRules.approvalsPage(ShellRules.HOME));
        assertEquals(APPROVALS, OverlayRules.approvalsPage(""));
        assertEquals(APPROVALS, OverlayRules.approvalsPage(null));
        assertTrue(ShellRules.staysInside(OverlayContract.APPROVALS_URL));
    }

    @Test public void aTapWithNothingWaitingOpensTheConsole() {
        assertEquals("expand", OverlayRules.tapVerb(OverlayRules.TOOLBAR, 0));
        assertEquals("expand", OverlayRules.tapVerb(OverlayRules.TOOLBAR, -1));
        // whatever console page shows stays; only the approvals page an earlier tap left gives way to the console
        assertNull(OverlayRules.consolePage(ShellRules.HOME));
        assertNull(OverlayRules.consolePage(ShellRules.HOME + "?axf-open=settings.plugins"));
        assertEquals(ShellRules.HOME, OverlayRules.consolePage(APPROVALS));
        assertEquals(ShellRules.HOME, OverlayRules.consolePage(APPROVALS + "/3bd88d9d-1c6d-47cb-b3ea-5fc29cb166cb"));
    }

    @Test public void aTapOnTheExpandedOverlayFoldsItWhateverWaits() {
        assertEquals("collapse", OverlayRules.tapVerb(OverlayRules.EXPANDED, 0));
        assertEquals("collapse", OverlayRules.tapVerb(OverlayRules.EXPANDED, 3));
        assertEquals(OverlayRules.TOOLBAR, OverlayRules.verb(OverlayRules.EXPANDED, OverlayRules.tapVerb(OverlayRules.EXPANDED, 3)));
    }

    @Test public void theApprovalsPageAlreadyShowingKeepsItsPlace() {
        assertNull(OverlayRules.approvalsPage(APPROVALS));
        assertNull(OverlayRules.approvalsPage(APPROVALS + "?tab=held"));
        assertNull(OverlayRules.approvalsPage(APPROVALS + "/3bd88d9d-1c6d-47cb-b3ea-5fc29cb166cb"));
        assertTrue(OverlayRules.onApprovalsPage(APPROVALS + "#top"));
        // look-alikes are not the approvals page
        assertFalse(OverlayRules.onApprovalsPage(APPROVALS + "-old"));
        assertFalse(OverlayRules.onApprovalsPage("https://axhub.amberxai.com/auth/admin"));
        assertFalse(OverlayRules.onApprovalsPage("https://evil.example/auth/admin/approvals"));
    }
}
