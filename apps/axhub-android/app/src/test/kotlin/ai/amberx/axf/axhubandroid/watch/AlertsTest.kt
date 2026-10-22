package ai.amberx.axf.axhubandroid.watch

import ai.amberx.axf.hub.HubFeedStatus
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.notifications.LockScreen
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * AXHub on lib-hub + lib-notifications: the approval alert keeps the lock screen private, the approval channel is private,
 * and a feed item's link is the hub's own page for that id. (The address/feed rules themselves are tested in lib-hub
 * against the shared fixture.) Written without a compiler.
 */
class AlertsTest {
    private val id = "dfe44a5d-15ab-47bf-8128-9843d37cd6ec"

    @Test fun lockScreenOnlySaysApprovalWaiting() {
        val feed = HubRules.interpretFeed(HubRules.DEFAULT, 200, """{"signedIn":true,"admin":true,"count":1,"pending":[{"id":"$id","tool":"vps.run","summary":"vps.run with arguments {\"command\":\"docker rm ollama\"}","createdAt":"a","expiresAt":"b","url":"${HubRules.DEFAULT}/auth/admin/approvals/$id"}]}""")
        assertEquals(HubFeedStatus.OK, feed.status)
        val a = feed.pending.single()
        assertEquals("${HubRules.DEFAULT}/auth/admin/approvals/$id", a.url)
        val spec = Alerts.approvalSpec(a, fullScreen = true)
        assertEquals("Approval waiting", spec.publicTitle)
        assertEquals("Unlock to review", spec.publicText)
        assertFalse("docker" in spec.publicTitle + spec.publicText)
        assertTrue("docker" in spec.text)
        assertEquals(Alerts.tag(id), spec.tag)
        assertEquals(Alerts.CH_APPROVAL, spec.channel)
    }

    @Test fun approvalChannelIsPrivate() {
        val ch = Alerts.channelSpecs.single { it.id == Alerts.CH_APPROVAL }
        assertEquals(LockScreen.PRIVATE, ch.lockScreen)
    }
}
