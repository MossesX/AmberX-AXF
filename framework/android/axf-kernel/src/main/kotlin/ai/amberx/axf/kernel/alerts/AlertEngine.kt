package ai.amberx.axf.kernel.alerts

import kotlinx.serialization.json.JsonPrimitive

/**
 * Alerts engine — developer alerts for any AXF app (alert@1). Mirrors core/engines/alerts.ts exactly
 * (fixtures: spec/fixtures/alerts.json, checked by ConformanceTest):
 *  - one alert per key (default `source:title`); a raise of a known key bumps count and time, escalates to a worse
 *    severity, reopens a resolved alert; events `new` / `repeat` / `escalated` / `reopened`;
 *  - delivery rules per channel (lowest severity, per-source overrides, `off`); repeats reach only the bell;
 *  - diagnostics (asset / setting / contribution conflicts, crashes) become alerts the same way on every port.
 * Pure: pass `now` (epoch ms) in. [AlertCenter] is the small stateful wrapper.
 */
public enum class AlertSeverity(public val id: String) {
    INFO("info"), SUCCESS("success"), WARNING("warning"), ERROR("error"), CRITICAL("critical");

    public val rank: Int get() = ordinal

    public companion object {
        public fun parseOrNull(s: String?): AlertSeverity? = entries.firstOrNull { it.id == s }
        public fun parse(s: String?): AlertSeverity = parseOrNull(s) ?: INFO
    }
}

public enum class AlertEvent(public val id: String) { NEW("new"), REPEAT("repeat"), ESCALATED("escalated"), REOPENED("reopened") }

public data class AlertInput(
    val source: String,
    val severity: String,
    val title: String,
    val body: String? = null,
    val key: String? = null,
    val link: String? = null,
    val meta: Map<String, JsonPrimitive> = emptyMap(),
)

public data class Alert(
    val id: String,
    val key: String,
    val source: String,
    val severity: AlertSeverity,
    val title: String,
    val body: String,
    val link: String,
    val meta: Map<String, JsonPrimitive>,
    val firstAt: Long,
    val lastAt: Long,
    val count: Int,
    val ack: Boolean,
    val resolved: Boolean,
    val resolvedAt: Long?,
)

/** `min` is a severity id or `off`. */
public data class ChannelRule(val min: String, val sources: Map<String, String> = emptyMap())
public data class AlertRules(val channels: Map<String, ChannelRule>)

public data class AlertResult(val list: List<Alert>, val alert: Alert, val event: AlertEvent)

public sealed interface Diagnostic {
    public data class AssetConflict(val type: String, val id: String, val was: String, val now: String) : Diagnostic
    public data class SettingConflict(val key: String, val was: String, val now: String) : Diagnostic
    public data class ContributionConflict(val what: String, val id: String, val was: String, val now: String) : Diagnostic
    public data class Crash(val where: String, val message: String, val detail: String? = null) : Diagnostic
}

public object AlertEngine {
    public val DEFAULT_RULES: AlertRules = AlertRules(mapOf("bell" to ChannelRule("info"), "ntfy" to ChannelRule("error"), "webpush" to ChannelRule("error")))
    public const val LIMIT: Int = 500
    private const val TITLE_MAX = 200
    private const val BODY_MAX = 2000
    private const val KEY_MAX = 200

    private fun rank(s: String): Int = AlertSeverity.parseOrNull(s)?.rank ?: 0
    private fun clip(s: String?, n: Int) = (s ?: "").take(n)

    public fun key(source: String, title: String, key: String? = null): String {
        val k = key?.trim()?.takeIf { it.isNotEmpty() } ?: "${source.trim()}:${title.trim()}"
        return k.take(KEY_MAX)
    }

    public fun apply(list: List<Alert>, input: AlertInput, now: Long): AlertResult {
        val key = key(input.source, input.title, input.key)
        val severity = AlertSeverity.parse(input.severity)
        val i = list.indexOfFirst { it.key == key }
        val alert: Alert
        val event: AlertEvent
        if (i < 0) {
            alert = Alert(key, key, input.source, severity, clip(input.title, TITLE_MAX), clip(input.body, BODY_MAX), input.link ?: "", LinkedHashMap(input.meta), now, now, 1, false, false, null)
            event = AlertEvent.NEW
        } else {
            val old = list[i]
            val worse = severity.rank > old.severity.rank
            event = if (old.resolved) AlertEvent.REOPENED else if (worse) AlertEvent.ESCALATED else AlertEvent.REPEAT
            alert = old.copy(
                severity = if (old.resolved || worse) severity else old.severity,
                title = clip(input.title, TITLE_MAX).ifEmpty { old.title },
                body = if (input.body != null) clip(input.body, BODY_MAX) else old.body,
                link = input.link ?: old.link,
                meta = LinkedHashMap(old.meta).apply { putAll(input.meta) },
                firstAt = if (old.resolved) now else old.firstAt,
                lastAt = now,
                count = if (old.resolved) 1 else old.count + 1,
                ack = if (event == AlertEvent.REPEAT) old.ack else false,
                resolved = false,
                resolvedAt = null,
            )
        }
        val next = if (i < 0) list + alert else list.mapIndexed { j, a -> if (j == i) alert else a }
        return AlertResult(trim(next), alert, event)
    }

    public fun resolve(list: List<Alert>, keys: Collection<String>, now: Long): List<Alert> =
        list.map { if (it.key in keys && !it.resolved) it.copy(resolved = true, resolvedAt = now, ack = true) else it }

    /** `ids == null` acknowledges every alert. */
    public fun ack(list: List<Alert>, ids: Collection<String>?): List<Alert> =
        list.map { if (!it.ack && (ids == null || it.id in ids)) it.copy(ack = true) else it }

    public fun dismiss(list: List<Alert>, ids: Collection<String>): List<Alert> = list.filter { it.id !in ids }

    public fun unread(list: List<Alert>): Int = list.count { !it.ack && !it.resolved }

    public fun sort(list: List<Alert>): List<Alert> =
        list.sortedWith(compareBy<Alert> { if (it.resolved) 1 else 0 }.thenByDescending { it.lastAt }.thenBy { it.key })

    public fun trim(list: List<Alert>, limit: Int = LIMIT): List<Alert> {
        if (list.size <= limit) return list
        fun tier(a: Alert) = if (a.resolved) 0 else if (a.ack) 1 else 2
        val drop = list.sortedWith(compareBy<Alert>({ tier(it) }, { it.lastAt }, { it.key })).take(list.size - limit).map { it.key }.toSet()
        return list.filter { it.key !in drop }
    }

    public fun channelMin(rules: AlertRules, channel: String, source: String): String {
        val r = rules.channels[channel] ?: return "off"
        return r.sources[source] ?: r.min
    }

    public fun targets(severity: AlertSeverity, source: String, event: AlertEvent, rules: AlertRules = DEFAULT_RULES): List<String> {
        val out = mutableListOf<String>()
        for (channel in rules.channels.keys.sorted()) {
            val min = channelMin(rules, channel, source)
            if (min == "off" || severity.rank < rank(min)) continue
            if (event == AlertEvent.REPEAT && channel != "bell") continue
            out += channel
        }
        return out
    }

    public fun ntfyPriority(severity: AlertSeverity): Int = when (severity) {
        AlertSeverity.INFO, AlertSeverity.SUCCESS -> 2
        AlertSeverity.WARNING -> 3
        AlertSeverity.ERROR -> 4
        AlertSeverity.CRITICAL -> 5
    }

    private fun s(v: String) = JsonPrimitive(v)

    public fun fromDiagnostic(d: Diagnostic): AlertInput = when (d) {
        is Diagnostic.AssetConflict -> AlertInput("conflicts", "warning", "Two ${d.type} assets share the id \"${d.id}\"", "The ${d.now} copy replaced the ${d.was} one. Give one of them another id.", "conflict:asset:${d.type}/${d.id}", null, linkedMapOf("type" to s(d.type), "id" to s(d.id), "was" to s(d.was), "now" to s(d.now)))
        is Diagnostic.SettingConflict -> AlertInput("conflicts", "warning", "Two modules use the setting \"${d.key}\"", "${d.was} and ${d.now} read and write the same value. Prefix setting keys with the module id.", "conflict:setting:${d.key}", null, linkedMapOf("key" to s(d.key), "was" to s(d.was), "now" to s(d.now)))
        is Diagnostic.ContributionConflict -> AlertInput("conflicts", "warning", "Two modules add the ${d.what} \"${d.id}\"", "${d.now} replaced the one from ${d.was}.", "conflict:${d.what}:${d.id}", null, linkedMapOf("what" to s(d.what), "id" to s(d.id), "was" to s(d.was), "now" to s(d.now)))
        is Diagnostic.Crash -> AlertInput("crashes", "error", "Crash in ${d.where}", if (d.detail != null) "${d.message}\n${d.detail}" else d.message, "crash:${d.where}:${d.message.take(120)}", null, linkedMapOf("where" to s(d.where)))
    }
}

/** The runtime's own reports (conflicts, crashes); the last 100 are kept for late subscribers. */
public class Diagnostics {
    private val recentList = ArrayDeque<Diagnostic>()
    private val listeners = mutableListOf<(Diagnostic) -> Unit>()

    public val recent: List<Diagnostic> get() = recentList.toList()

    public fun report(d: Diagnostic) {
        recentList.addLast(d)
        if (recentList.size > 100) recentList.removeFirst()
        listeners.toList().forEach { runCatching { it(d) } }
    }

    public fun subscribe(replay: Boolean = false, fn: (Diagnostic) -> Unit): () -> Unit {
        if (replay) recent.forEach(fn)
        listeners += fn
        return { listeners -= fn }
    }
}

public data class AlertChange(val alert: Alert, val event: AlertEvent, val targets: List<String>)

/** Holds a list, applies [AlertEngine], tells listeners. */
public class AlertCenter(public var rules: AlertRules = AlertEngine.DEFAULT_RULES, alerts: List<Alert> = emptyList(), private val now: () -> Long = { System.currentTimeMillis() }) {
    private var items: List<Alert> = AlertEngine.trim(alerts)
    private val listeners = mutableListOf<() -> Unit>()
    private val changes = mutableListOf<(AlertChange) -> Unit>()

    public val list: List<Alert> get() = AlertEngine.sort(items)
    public val unread: Int get() = AlertEngine.unread(items)

    public fun raise(input: AlertInput): AlertChange {
        val r = AlertEngine.apply(items, input, now())
        items = r.list
        val change = AlertChange(r.alert, r.event, AlertEngine.targets(r.alert.severity, r.alert.source, r.event, rules))
        changes.toList().forEach { it(change) }
        emit()
        return change
    }

    public fun resolve(keys: Collection<String>) { items = AlertEngine.resolve(items, keys, now()); emit() }
    public fun ack(ids: Collection<String>?) { items = AlertEngine.ack(items, ids); emit() }
    public fun dismiss(ids: Collection<String>) { items = AlertEngine.dismiss(items, ids); emit() }
    public fun replace(alerts: List<Alert>) { items = AlertEngine.trim(alerts); emit() }

    public fun subscribe(fn: () -> Unit): () -> Unit { listeners += fn; return { listeners -= fn } }
    public fun onChange(fn: (AlertChange) -> Unit): () -> Unit { changes += fn; return { changes -= fn } }

    private fun emit() { listeners.toList().forEach { it() } }
}
