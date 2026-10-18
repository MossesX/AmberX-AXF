package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.obj
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Banner engine (asset type `banner`): the thin permanent bar across the top of the screen and the assets it holds.
 * Same rules as the web reference engine (framework/core/engines/banner.ts); fixtures in spec/fixtures/banner.json.
 * A banner shows the app logo and hosts attachments of the attachable types (badge, clock) on its left, center or right,
 * from the asset's own `attach` list and from modules at run time; a run-time attachment with the same type + id replaces
 * the asset's own. Unknown types, bad sides and assets that don't exist are skipped.
 */
public data class BannerAttachment(val type: String, val id: String, val at: String, val order: Double? = null, val origin: String? = null) {
    val key: String get() = BannerEngine.key(type, id)
}

public data class PlacedAttachment(val key: String, val type: String, val id: String, val at: String, val order: Double, val origin: String)

public data class BannerData(val height: Double?, val surface: String, val logoShow: Boolean, val logoText: String, val attach: List<BannerAttachment>, val divider: Boolean) {
    public companion object {
        public fun fromJson(o: JsonObject): BannerData = BannerData(
            height = (o["height"] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull,
            surface = o.str("surface", "flat"),
            logoShow = o.obj("logo")?.bool("show", true) ?: true,
            logoText = o.obj("logo")?.str("text", "") ?: "",
            attach = o.objList("attach").map { BannerAttachment(it.str("type"), it.str("id"), it.str("at"), (it["order"] as? JsonPrimitive)?.takeUnless { p -> p.isString }?.doubleOrNull) },
            divider = o.bool("divider", true),
        )
    }
}

public data class ClockData(val format: String, val seconds: Boolean, val date: String, val timezone: String? = null, val mono: Boolean = true) {
    public companion object {
        public fun fromJson(o: JsonObject): ClockData = ClockData(o.str("format", "24h"), o.bool("seconds", false), o.str("date", "none"), o.strOrNull("timezone"), o.bool("mono", true))
    }
}

public data class BadgeData(val icon: String, val label: String, val tone: String, val shape: String, val tooltip: String? = null, val link: String? = null) {
    public companion object {
        public fun fromJson(o: JsonObject): BadgeData = BadgeData(o.str("icon", "star"), o.str("label"), o.str("tone", "neutral"), o.str("shape", "pill"), o.strOrNull("tooltip"), o.strOrNull("link"))
    }
}

/** Clock parts in the clock's time zone (the UI layer fills them from the platform clock). weekday 0 = Sunday, month 1-12. */
public data class ClockParts(val year: Int, val month: Int, val day: Int, val weekday: Int, val hour: Int, val minute: Int, val second: Int)

public object BannerEngine {
    public val ATTACHABLE: List<String> = listOf("badge", "clock")
    public val SIDES: List<String> = listOf("left", "center", "right")
    public const val HEIGHT_MIN: Int = 16
    public const val HEIGHT_MAX: Int = 48
    public const val HEIGHT_THIN: Int = 24
    public val TONE_TOKEN: Map<String, String> = linkedMapOf("neutral" to "text", "success" to "success", "warning" to "warning", "danger" to "danger", "accent" to "accent", "muted" to "muted")

    public fun key(type: String, id: String): String = "$type:$id"

    /** Banner height in px/dp (0 when there's no banner or it's hidden). */
    public fun height(b: BannerData?, hidden: Boolean = false): Int {
        if (b == null || hidden) return 0
        val n = b.height?.takeIf { it.isFinite() }?.let { Math.floor(it + 0.5).toInt() } ?: HEIGHT_THIN
        return n.coerceIn(HEIGHT_MIN, HEIGHT_MAX)
    }

    /** Same `--fx-banner-h` variable the web port emits. */
    public fun vars(b: BannerData?, hidden: Boolean = false): Map<String, String> = mapOf("--fx-banner-h" to "${height(b, hidden)}px")

    /** Where every attachment goes. [has] says whether that asset exists. */
    public fun place(b: BannerData?, extra: List<BannerAttachment>, has: (String, String) -> Boolean): Map<String, List<PlacedAttachment>> {
        val byKey = LinkedHashMap<String, PlacedAttachment>()
        fun add(a: BannerAttachment, fallbackOrder: Double, origin: String) {
            if (a.type !in ATTACHABLE || a.at !in SIDES || !has(a.type, a.id)) return
            val order = a.order?.takeIf { it.isFinite() } ?: fallbackOrder
            // a later entry with the same key replaces the earlier one (each side is sorted afterwards)
            byKey[a.key] = PlacedAttachment(a.key, a.type, a.id, a.at, order, a.origin ?: origin)
        }
        b?.attach?.forEachIndexed { i, a -> add(a, i * 10.0, "asset") }
        extra.forEachIndexed { i, a -> add(a, 1000.0 + i * 10, "runtime") }
        return SIDES.associateWith { side -> byKey.values.filter { it.at == side }.sortedWith(compareBy<PlacedAttachment> { it.order }.thenBy { it.key }) }
    }

    public fun toneToken(tone: String): String = TONE_TOKEN[tone] ?: "text"

    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    private val DAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
    private fun two(n: Int) = n.toString().padStart(2, '0')

    /** "Sun Oct 18 18:20", "6:20:05 PM", … — the same text on every port. */
    public fun formatClock(c: ClockData, t: ClockParts): String {
        val sec = if (c.seconds) ":${two(t.second)}" else ""
        val time = if (c.format == "12h") "${if (t.hour % 12 == 0) 12 else t.hour % 12}:${two(t.minute)}$sec ${if (t.hour < 12) "AM" else "PM"}"
            else "${two(t.hour)}:${two(t.minute)}$sec"
        val md = "${MONTHS[((t.month - 1) % 12 + 12) % 12]} ${t.day}"
        val date = when (c.date) { "short" -> md; "weekday" -> "${DAYS[((t.weekday % 7) + 7) % 7]} $md"; else -> "" }
        return if (date.isNotEmpty()) "$date $time" else time
    }
}
