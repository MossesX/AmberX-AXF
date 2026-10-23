package ai.amberx.axf.axhubandroid.watch

import ai.amberx.axf.hub.HubApproval
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Auto-approval rules and its notification. Written without a compiler. */
class AutoApproveTest {
    @Test fun offOrEmptyApprovesNothing() {
        assertFalse(AutoApprove.applies(false, "*", "vps.run"))
        assertFalse(AutoApprove.applies(true, "", "vps.run"))
        assertFalse(AutoApprove.applies(true, " , ", "vps.run"))
    }

    @Test fun patterns() {
        val p = AutoApprove.patterns("vps.logs, github.*\n axhub.ping")
        assertEquals(listOf("vps.logs", "github.*", "axhub.ping"), p)
        assertTrue(AutoApprove.matches(p, "vps.logs"))
        assertFalse(AutoApprove.matches(p, "vps.run"))
        assertTrue(AutoApprove.matches(p, "github.repos/get"))
        assertFalse(AutoApprove.matches(p, "githubx.repos/get"))
        assertFalse(AutoApprove.matches(p, "github."))
        assertTrue(AutoApprove.matches(listOf("*"), "vps.run"))
    }

    @Test fun approveEverythingSkipsVpsRun() {
        assertTrue(AutoApprove.applies(false, "", "github.repos/get", all = true))
        assertTrue(AutoApprove.applies(false, "", "vps.logs", all = true))
        assertFalse(AutoApprove.applies(false, "", "vps.run", all = true))
        assertFalse(AutoApprove.applies(false, "", "", all = true))
        assertFalse(AutoApprove.applies(false, "*", "github.repos/get", all = false))
        // the explicit tool list still decides on its own, as before
        assertTrue(AutoApprove.applies(true, "vps.run", "vps.run", all = true))
    }

    @Test fun onlyTheHubsApprovedAnswerCounts() {
        assertTrue(AutoApprove.approvedReply(303, "/auth/admin/approvals/x?ok=approved"))
        assertFalse(AutoApprove.approvedReply(303, "/auth/admin/approvals/x?err=decidedAlready"))
        assertFalse(AutoApprove.approvedReply(303, "/auth/admin/approvals?err=expired"))
        assertFalse(AutoApprove.approvedReply(403, null))
        assertFalse(AutoApprove.approvedReply(200, "?ok=approved"))
    }

    @Test fun notificationSaysAutoApprovalApproved() {
        val a = HubApproval("dfe44a5d-15ab-47bf-8128-9843d37cd6ec", "vps.logs", "vps.logs with arguments {\"lines\":50}", "a", "b", "u")
        val spec = Alerts.autoApprovedSpec(a)
        assertEquals("Auto-approval approved vps.logs", spec.title)
        assertEquals("Auto-approval approved", spec.publicTitle)
        assertFalse("lines" in spec.publicTitle + spec.publicText)
        assertEquals(Alerts.CH_AUTO, spec.channel)
        assertTrue(Alerts.CH_AUTO != Alerts.CH_AUTO_OLD) // a new channel: its alarm sound can't be set on the old one
        assertTrue(spec.tag != Alerts.tag(a.id)) // survives the waiting alert being cleared
    }
}
