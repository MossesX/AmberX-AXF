package ai.amberx.axf.notifications

import ai.amberx.axf.kernel.alerts.AlertCenter
import ai.amberx.axf.kernel.alerts.AlertInput
import ai.amberx.axf.kernel.alerts.AlertRules
import ai.amberx.axf.kernel.alerts.ChannelRule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The alert@1 → device notification hook (pure). Written without a compiler (CI runs :lib-notifications:testDebugUnitTest). */
class AlertNotificationsTest {
    private val rules = AlertRules(mapOf("bell" to ChannelRule("info"), AlertNotifications.DEVICE_CHANNEL to ChannelRule("warning")))

    @Test fun onlyDeviceTargetsBecomeNotifications() {
        val c = AlertCenter(rules, now = { 1_000L })
        assertNull(AlertNotifications.plan(c.raise(AlertInput("ci", "info", "Build ok")), 7))
        val spec = assertNotNull(AlertNotifications.plan(c.raise(AlertInput("ci", "error", "Build failed", body = "line one\nline two")), 7))
        assertEquals(AlertNotifications.CH_ALERTS_URGENT, spec.channel)
        assertEquals("Build failed", spec.title)
        assertEquals("line one", spec.text)
        assertTrue(spec.tag.startsWith("alert:"))
    }

    @Test fun lockScreenTextStaysPrivate() {
        val c = AlertCenter(rules, now = { 1_000L })
        val spec = assertNotNull(AlertNotifications.plan(c.raise(AlertInput("deploy", "warning", "Secret thing", body = "token=abc")), 7))
        assertEquals("Alert", spec.publicTitle)
        assertTrue("Secret" !in spec.publicTitle + spec.publicText && "token" !in spec.publicText)
        assertEquals(AlertNotifications.CH_ALERTS, spec.channel)
        assertTrue(AlertNotifications.channels.all { it.lockScreen == LockScreen.PRIVATE })
    }

    @Test fun repeatsNeverRingTheDevice() {
        val c = AlertCenter(rules, now = { 1_000L })
        c.raise(AlertInput("ci", "error", "Build failed"))
        assertNull(AlertNotifications.plan(c.raise(AlertInput("ci", "error", "Build failed")), 7))
    }

    @Test fun placeholdersAreDeclared() {
        assertEquals(listOf("axf.notifications.alerts", "axf.notifications.push", "axf.notifications.schedule"), NotificationsModule.placeholders().flatMap { m -> m.provides.map { it.id } })
    }
}
