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

    @Test fun openable() {
        assertTrue(LinkRules.openable("https://console.amberxai.com/?x=1"))
        assertFalse(LinkRules.openable("intent://scan/#Intent;end"))
        assertFalse(LinkRules.openable("javascript:alert(1)"))
        assertFalse(LinkRules.openable("https://a:b@console.amberxai.com/"))
    }

    @Test fun backoff() {
        assertEquals(listOf(5, 15, 30, 60, 60), (1..5).map { LinkRules.backoffSeconds(it) })
    }

    @Test fun approvalPage() {
        assertEquals("https://axhub.amberxai.com/auth/admin/approvals/7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
            LinkRules.approvalPage("https://axhub.amberxai.com/", "7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"))
        assertNull(LinkRules.approvalPage("https://axhub.amberxai.com", "../../evil"))
    }
}
