package ai.amberx.axf.notifications

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule

/**
 * lib-notifications: fills the platform's `android.notifications` placeholder (declared by `AndroidPlatformModule`) and
 * registers [AxfNotifications] as `axf.notifications`. [channels] are created when the module registers, so a service that
 * starts before the UI still finds them (apps that post from a boot receiver call [AxfNotifications.channels] themselves).
 */
public class NotificationsModule(
    private val context: android.content.Context,
    private val channels: List<ChannelSpec> = emptyList(),
) : BaseModule(ID, "Notifications") {
    override val provides: List<Capability> = listOf(
        Capability("axf.notifications", "Channels, permission checks, ongoing + private-lock-screen alerts, post/cancel by tag"),
        Capability("android.notifications", "Android notifications (NotificationCompat)"),
    )

    override fun register(ctx: ModuleContext) {
        if (channels.isNotEmpty()) runCatching { AxfNotifications.channels(context, channels) }
        ctx.services.register(AxfNotifications::class, AxfNotifications, "axf.notifications")
        ctx.services.register(NotificationsModule::class, this, "android.notifications")
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.notifications"

        /** What isn't built yet: alert@1 deliveries wired to this device, push (FCM / UnifiedPush), scheduled notifications. */
        public fun placeholders(): List<PlaceholderModule> = listOf(
            PlaceholderModule("ai.amberx.axf.notifications.alerts", "Alerts on this device", listOf(Capability("axf.notifications.alerts", "alert@1 deliveries posted as device notifications (hook: AxfNotifications.deliverAlert)"))),
            PlaceholderModule("ai.amberx.axf.notifications.push", "Push", listOf(Capability("axf.notifications.push", "FCM / UnifiedPush / hub push"))),
            PlaceholderModule("ai.amberx.axf.notifications.schedule", "Scheduled notifications", listOf(Capability("axf.notifications.schedule", "Exact/inexact alarms (with the work scheduler, x.work)"))),
        )
    }
}
