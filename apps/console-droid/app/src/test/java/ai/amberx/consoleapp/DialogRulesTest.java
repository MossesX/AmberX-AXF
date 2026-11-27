package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Where a page's confirm() is drawn (the overlay could not show one: Approval rules, Nov 21 2026). */
public class DialogRulesTest {
    @Test public void theActivityKeepsTheWebViewsOwnDialog() {
        assertEquals(DialogRules.ACTIVITY, DialogRules.where(true, true, true));
        assertEquals(DialogRules.ACTIVITY, DialogRules.where(true, true, false));
    }

    @Test public void theOverlayGetsTheShellsDialog() {
        assertEquals(DialogRules.OVERLAY, DialogRules.where(false, true, true));
    }

    @Test public void nowhereToDrawCancels() {
        assertEquals(DialogRules.NONE, DialogRules.where(false, false, true));
        assertEquals(DialogRules.NONE, DialogRules.where(false, true, false));
    }

    @Test public void titleIsThePagesHost() {
        assertEquals("console.amberxai.com", DialogRules.title("https://console.amberxai.com/?x=1"));
        assertEquals("AXF Console", DialogRules.title(""));
        assertEquals("AXF Console", DialogRules.title(null));
        assertEquals("AXF Console", DialogRules.title("not a url"));
    }
}
