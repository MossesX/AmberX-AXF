package ai.amberx.axf.phoneconnect

import ai.amberx.axf.phoneconnect.approvals.Approval
import ai.amberx.axf.phoneconnect.approvals.ApprovalFeed
import ai.amberx.axf.phoneconnect.monitor.AutoRules
import ai.amberx.axf.phoneconnect.overlay.OverlayConfig
import ai.amberx.axf.phoneconnect.overlay.snapX
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OverlayAndRulesTest {
    @Test fun overlayConfigKeepsRangesAndDropsUnsafeActions() {
        val c = OverlayConfig.parse(JSONObject("""{"buttonSize":200,"buttonShape":"star","items":[{"id":"ok","action":"approvals"},{"id":"bad","action":"open:https://evil.com/"}],
            "popups":{"alert":{"enter":"burst","stayMs":-5,"opacity":2}}}"""))
        assertEquals(80, c.buttonSize)
        assertEquals("circle", c.buttonShape)
        assertEquals(listOf("ok"), c.items.map { it.id })
        assertEquals("burst", c.popup("alert").enter)
        assertEquals(0, c.popup("alert").stayMs)
        assertEquals(1f, c.popup("alert").opacity)
        assertEquals("center", OverlayConfig.parse(null).popup("approval").position)
    }

    @Test fun buttonSnapsToTheNearerEdge() {
        assertEquals(0, snapX(100, 50, 1000, true))
        assertEquals(950, snapX(700, 50, 1000, true))
        assertEquals(300, snapX(300, 50, 1000, false))
    }

    private fun a(tool: String, project: String = "", destructive: Boolean = false, personOnly: Boolean = false) =
        Approval("0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9", tool, "t", "", false, 0, listOf("approve", "deny"), destructive, personOnly, project)

    @Test fun autoRulesNeverCoverWhatOnlyBrettApproves() {
        val r = AutoRules.parse(JSONObject("""{"rules":[{"id":"r1","what":"build.*","scope":"project:axf"},{"id":"r2","what":"phone.*","scope":"any"},{"id":"r3","what":"*","scope":"any"}],"never":["vps.run"]}"""))
        assertNotNull(r.approves(a("build.status", "axf")))
        assertNull(r.approves(a("build.status", "other")))
        assertNull(r.approves(a("build.reset", "axf")))
        assertNull(r.approves(a("build.status", "axf", destructive = true)))
        assertNull(r.approves(a("build.status", "axf", personOnly = true)))
        assertNull(r.approves(a("phone.recorder_start")))
        assertNull(r.approves(a("amberx.recorder_start")))
        assertNotNull(r.approves(a("phone.recorder_stop")))
        assertNull(r.approves(a("vps.run")))
    }

    @Test fun feedKeepsOnlyHubApprovals() {
        val id = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9"
        val f = ApprovalFeed.parse(200, """{"pending":[{"id":"$id","tool":"build.deploy","reason":{"title":"Deploy?","description":"Ships the console."},"url":"https://axhub.amberxai.com/auth/admin/approvals/$id"},
            {"id":"not-a-uuid","tool":"x"},{"id":"1b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9","tool":"y","url":"https://evil.example/x"},
            {"id":"2b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9","tool":"vps.run","status":"held","veto":{"secondsLeft":42,"actions":["deny","shelve"]}}]}""")
        assertEquals("ok", f.status)
        assertEquals(2, f.items.size)
        assertEquals("Deploy?", f.items[0].title)
        assertEquals("Ships the console.", f.items[0].why)
        assertEquals(listOf("deny", "shelve"), f.items[1].actions)
        assertEquals(42, f.items[1].secondsLeft)
        assertNull(ApprovalFeed.hubAction(f.items[1], "approve"))
        assertEquals("signed-out", ApprovalFeed.parse(401, "").status)
        assertTrue(ApprovalFeed.parse(500, "").items.isEmpty())
    }
}
