package ai.amberx.axf.notifications

import ai.amberx.axf.kernel.alerts.AlertChange
import ai.amberx.axf.kernel.alerts.AlertEvent
import ai.amberx.axf.kernel.alerts.AlertSeverity

/** How loud a channel is (maps to `NotificationManager.IMPORTANCE_*`). */
public enum class ChannelImportance { MIN, LOW, DEFAULT, HIGH }

/** What the lock screen may show for a channel's notifications. */
public enum class LockScreen {
    /** Everything (only for notifications without anything private in them, e.g. "Watching"). */
    PUBLIC,
    /** Only the public version (its own title/text); the real content after unlock. The default for alerts. */
    PRIVATE,
    /** Nothing at all. */
    SECRET,
}

/**
 * A notification channel an app or library declares (created once; Android keeps the user's changes after that).
 * [lockScreen] null = no channel override (each notification's own visibility applies).
 */
public data class ChannelSpec(
    val id: String,
    val name: String,
    val importance: ChannelImportance = ChannelImportance.DEFAULT,
    val description: String = "",
    val lockScreen: LockScreen? = LockScreen.PRIVATE,
    val vibrate: Boolean = false,
    val showBadge: Boolean = true,
)

/** The quiet, ongoing "watching" notification a foreground service shows. Shown on the lock screen: keep it free of secrets. */
public data class OngoingSpec(
    val channel: String,
    val title: String,
    val text: String,
    val smallIcon: Int,
)

/**
 * A loud alert. The lock screen only ever shows [publicTitle] / [publicText] (the notification is VISIBILITY_PRIVATE with a
 * public version); [title] / [text] / [bigText] appear after unlock. Full screen only when [fullScreen] is asked for *and*
 * Android allows it ([AxfNotifications.canFullScreen]). Posted under [tag] (id 0), so it can be cancelled by tag.
 */
public data class AlertSpec(
    val channel: String,
    val tag: String,
    val title: String,
    val text: String,
    val smallIcon: Int,
    val bigText: String? = null,
    val publicTitle: String = "Alert waiting",
    val publicText: String = "Unlock to review",
    val fullScreen: Boolean = false,
    val actionLabel: String? = null,
    val autoCancel: Boolean = true,
)

/** A non-urgent notice on a quiet channel, posted under a numeric id. */
public data class NoticeSpec(
    val channel: String,
    val id: Int,
    val title: String,
    val text: String,
    val smallIcon: Int,
    val autoCancel: Boolean = true,
)

/**
 * The hook for alert@1 deliveries (the framework alerts library, kernel `AlertCenter`): how one [AlertChange] would become
 * a device notification. Pure, so it is tested without Android. Not wired yet: an app (or the future Android alerts library)
 * subscribes `AlertCenter.onChange` and posts through [AxfNotifications.deliverAlert] when the change targets
 * [DEVICE_CHANNEL]. Capability placeholder `axf.notifications.alerts`.
 */
public object AlertNotifications {
    /** The alert@1 delivery channel name for "a notification on this device" (rules: `channels.device`). */
    public const val DEVICE_CHANNEL: String = "device"
    public const val CH_ALERTS: String = "axf.alerts"
    public const val CH_ALERTS_URGENT: String = "axf.alerts.urgent"

    /** The two channels alert deliveries use (urgent = error and worse). */
    public val channels: List<ChannelSpec> = listOf(
        ChannelSpec(CH_ALERTS, "Alerts", ChannelImportance.DEFAULT, "Developer alerts from this app", LockScreen.PRIVATE),
        ChannelSpec(CH_ALERTS_URGENT, "Urgent alerts", ChannelImportance.HIGH, "Errors and critical alerts", LockScreen.PRIVATE, vibrate = true),
    )

    /** The notification for [change], or null when it doesn't target this device (repeats never do: alert@1 sends them to the bell only). */
    public fun plan(change: AlertChange, smallIcon: Int): AlertSpec? {
        if (DEVICE_CHANNEL !in change.targets) return null
        if (change.event == AlertEvent.REPEAT) return null
        val a = change.alert
        val urgent = a.severity.rank >= AlertSeverity.ERROR.rank
        val prefix = when (change.event) { AlertEvent.ESCALATED -> "Worse: "; AlertEvent.REOPENED -> "Again: "; else -> "" }
        return AlertSpec(
            channel = if (urgent) CH_ALERTS_URGENT else CH_ALERTS,
            tag = "alert:${a.key}",
            title = (prefix + a.title).take(120),
            text = a.body.lineSequence().firstOrNull()?.take(160).orEmpty(),
            bigText = a.body.take(600).ifEmpty { null },
            smallIcon = smallIcon,
            publicTitle = if (urgent) "Urgent alert" else "Alert",
            publicText = "Unlock to see it",
        )
    }
}
