package ai.amberx.axf.phoneconnect

import ai.amberx.axf.phoneconnect.approvals.LockScreen
import ai.amberx.axf.phoneconnect.commands.OpenUrlRules
import ai.amberx.axf.phoneconnect.notify.Channels
import androidx.core.app.NotificationCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The lock screen names nothing; the phone opens only Brett's own https pages (the same cases as the console's fixture). */
class LockScreenAndUrlTest {
    @Test fun lockScreenShowsOnlyApprovalWaiting() {
        assertEquals("Approval waiting", LockScreen.publicText(Channels.APPROVALS))
        assertEquals("Alert", LockScreen.publicText(Channels.ALERTS))
        assertEquals("Phone Connect", LockScreen.publicText(Channels.FYI))
        for (c in Channels.TYPES) assertEquals(NotificationCompat.VISIBILITY_PRIVATE, LockScreen.visibility(c))
    }

    private fun refused(url: String) = runCatching { OpenUrlRules.allowed(url) }.isFailure

    @Test fun opensOwnHttpsPages() {
        assertEquals("https://console.amberxai.com/?axf-cmd=abc", OpenUrlRules.allowed("https://console.amberxai.com/?axf-cmd=abc"))
        assertEquals("https://amberxai.com", OpenUrlRules.allowed("https://amberxai.com"))
        assertTrue(OpenUrlRules.allowed("https://axhub.amberxai.com/auth/admin/approvals/0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9").startsWith("https://axhub."))
    }

    @Test fun refusesEverythingElse() {
        for (u in listOf("http://console.amberxai.com/", "https://amberxai.com.evil.example/", "https://console.amberxai.com:8443/", "https://brett:pw@console.amberxai.com/",
            "https://github.com/MossesX/AmberX-AXF/pull/712", "intent://scan/#Intent;scheme=zxing;end", "file:///etc/passwd", "javascript:alert(1)", "", "not a url",
            "https://console.amberxai.com/?q=" + "a".repeat(2000))) assertTrue(u.take(60), refused(u))
    }

    @Test fun ownDomainIsExact() {
        assertTrue(OpenUrlRules.ownDomain("console.amberxai.com"))
        assertFalse(OpenUrlRules.ownDomain("amberxai.com."))
        assertFalse(OpenUrlRules.ownDomain("notamberxai.com"))
        assertEquals("default", OpenUrlRules.browserOf("default"))
        assertEquals("chrome", OpenUrlRules.browserOf("anything"))
    }
}
