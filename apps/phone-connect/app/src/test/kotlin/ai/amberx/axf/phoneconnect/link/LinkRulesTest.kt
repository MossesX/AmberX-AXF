package ai.amberx.axf.phoneconnect.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkRulesTest {
    @Test fun codes() {
        assertEquals("R6HUG9C9", LinkRules.normalizeCode("r6hu-g9c9"))
        assertNull(LinkRules.normalizeCode("R6HUG9C0")) // 0 is never in a code
        assertNull(LinkRules.normalizeCode("SHORT"))
    }

    @Test fun origins() {
        assertEquals("https://console.amberxai.com", LinkRules.normalizeOrigin(" https://console.amberxai.com/ "))
        assertNull(LinkRules.normalizeOrigin("http://console.amberxai.com"))
        assertNull(LinkRules.normalizeOrigin("https://user@console.amberxai.com"))
        assertNull(LinkRules.normalizeOrigin("https://console.amberxai.com/path"))
    }

    @Test fun overlayUnlessBrowser() {
        assertTrue(LinkRules.wantsOverlay("overlay"))
        assertTrue(LinkRules.wantsOverlay(""))
        assertTrue(LinkRules.wantsOverlay(null))
        assertFalse(LinkRules.wantsOverlay("browser"))
    }

    @Test fun howAPageOpened() {
        assertEquals("console-overlay", LinkRules.consoleHow(true))
        assertEquals("console-app", LinkRules.consoleHow(false))
        // the tap-to-open notification is only the fallback, and it says why
        assertEquals("no-permission", LinkRules.notifiedWhy(false))
        assertEquals("launch-failed", LinkRules.notifiedWhy(true))
    }

    @Test fun openable() {
        assertTrue(LinkRules.openable("https://console.amberxai.com/?x=1"))
        assertFalse(LinkRules.openable("intent://scan/#Intent;end"))
        assertFalse(LinkRules.openable("javascript:alert(1)"))
        assertFalse(LinkRules.openable("https://a:b@console.amberxai.com/"))
    }

    @Test fun backoff() {
        assertEquals(listOf(5, 15, 30, 60, 60), (1..5).map { LinkRules.backoffSeconds(it) })
    }

    /** The same cases as framework/spec/fixtures/phone-connect.json → link (the engine's linkVerdict). */
    @Test fun rejectedTokenEndsTheRetryLoop() {
        assertEquals(LinkRules.Verdict.OK, LinkRules.verdict(200, ""))
        assertEquals(LinkRules.Verdict.OK, LinkRules.verdict(204, ""))
        assertEquals(LinkRules.Verdict.REJECTED, LinkRules.verdict(403, "denied"))
        assertEquals(LinkRules.Verdict.REJECTED, LinkRules.verdict(410, "revoked"))
        assertEquals(LinkRules.Verdict.REJECTED, LinkRules.verdict(409, "unpaired"))
        // a bare 401 / 403 (a proxy or the wall, no wire code) ends it only after three in a row
        assertEquals(LinkRules.Verdict.RETRY, LinkRules.verdict(401, "", 0))
        assertEquals(LinkRules.Verdict.RETRY, LinkRules.verdict(401, "", 1))
        assertEquals(LinkRules.Verdict.REJECTED, LinkRules.verdict(401, "", 2))
        assertEquals(LinkRules.Verdict.REJECTED, LinkRules.verdict(403, "", 2))
    }

    @Test fun everythingElseBacksOffAndRetries() {
        assertEquals(LinkRules.Verdict.HELLO, LinkRules.verdict(404, ""))
        assertEquals(LinkRules.Verdict.RETRY, LinkRules.verdict(503, "unavailable"))
        assertEquals(LinkRules.Verdict.RETRY, LinkRules.verdict(0, "unavailable"))
        assertEquals(LinkRules.Verdict.RETRY, LinkRules.verdict(400, "invalid"))
        assertEquals(LinkRules.Verdict.RETRY, LinkRules.verdict(302, ""))
    }

    @Test fun rejectedWords() {
        assertTrue(LinkRules.rejectedWhy("revoked").contains("revoked"))
        assertTrue(LinkRules.rejectedWhy("").contains("no longer accepts"))
    }

    @Test fun chromeOnlyWhenAsked() {
        assertTrue(LinkRules.wantsChrome("chrome"))
        assertFalse(LinkRules.wantsChrome("default"))
        assertFalse(LinkRules.wantsChrome(""))
        assertFalse(LinkRules.wantsChrome(null))
    }

    @Test fun consoleApproval() {
        assertEquals("https://console.amberxai.com/?axf-open=hub.review:7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
            LinkRules.consoleApproval("https://console.amberxai.com/", "7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"))
        assertNull(LinkRules.consoleApproval("https://console.amberxai.com", "x&axf-open=evil"))
        assertTrue(LinkRules.openable(LinkRules.pairPage("https://console.amberxai.com")))
    }

    @Test fun decisionOutcome() {
        assertEquals("Approved.", LinkRules.decisionOutcome("approve", true))
        assertEquals("Denied.", LinkRules.decisionOutcome("deny", true, "ignored"))
        assertEquals("That request expired. Tap to open it in the console.", LinkRules.decisionOutcome("approve", false, "That request expired."))
        // no answer or a prompt that already ended: never reads as decided
        assertTrue(LinkRules.decisionOutcome("approve", null).contains("Nothing was decided"))
        assertTrue(LinkRules.decisionOutcome("deny", null, "Can't reach the console.").startsWith("Can't reach the console."))
    }

    @Test fun approvalPage() {
        assertEquals("https://axhub.amberxai.com/auth/admin/approvals/7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
            LinkRules.approvalPage("https://axhub.amberxai.com/", "7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"))
        assertNull(LinkRules.approvalPage("https://axhub.amberxai.com", "../../evil"))
    }
}
