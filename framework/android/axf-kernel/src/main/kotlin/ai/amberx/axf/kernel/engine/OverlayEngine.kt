package ai.amberx.axf.kernel.engine

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Overlay engine (asset type `overlay`, overlay@1): the floating pill drawn over other apps — status chips + one quick
 * action, a tappable log panel (lines with a confidence and a tag; tap one to tune what produced it), the collapsed strip
 * shown while the overlay is hidden (the last few lines, each alive for `lineMs`) and the mini-screen host any app fills.
 *
 * Same rules as the web reference engine (framework/core/engines/overlay.ts + overlay-rules.mjs): normalising and
 * validating the asset, clamping sizes and positions to the screen, log trimming, strip line expiry, chip state and the
 * user's `axf.overlay.*` settings over the asset. Fixture spec/fixtures/overlay.json, replayed by OverlayConformanceTest.
 * Pure Kotlin: the Android host (lib-overlay: window, service, Compose) sits on top of it. Generalised from the detection
 * overlay of Brett's hands-free YouTube controller (its OverlayView / MiniLogView / TunePopup); nothing app-specific here.
 *
 * Written without a compiler (Android work on hold; CI runs :axf-kernel:test).
 */
public data class OverlayChip(val id: String, val label: String, val offLabel: String, val tone: String, val offTone: String, val icon: String, val on: Boolean) {
    public fun toJson(): JsonObject = JsonObject(linkedMapOf(
        "id" to JsonPrimitive(id), "label" to JsonPrimitive(label), "offLabel" to JsonPrimitive(offLabel), "tone" to JsonPrimitive(tone),
        "offTone" to JsonPrimitive(offTone), "icon" to JsonPrimitive(icon), "on" to JsonPrimitive(on),
    ))
}

public data class OverlayRange(val min: Int, val max: Int, val default: Int) {
    public fun toJson(): JsonObject = JsonObject(linkedMapOf("min" to JsonPrimitive(min), "max" to JsonPrimitive(max), "default" to JsonPrimitive(default)))
}

public data class OverlayPill(val title: String, val chips: List<OverlayChip>, val quickAction: String)
public data class OverlayLog(val show: Boolean, val maxLines: Int, val showConfidence: Boolean)
public data class OverlayStrip(val show: Boolean, val maxLines: Int, val lineMs: Int)
public data class OverlayMini(val defaultOpen: Boolean, val width: OverlayRange, val height: OverlayRange)
public data class OverlaySizeLimits(val minWidth: Int, val maxWidth: Int, val minHeight: Int, val maxHeight: Int, val maxScreenWidthPct: Int, val maxScreenHeightPct: Int)

public data class OverlayData(
    val pill: OverlayPill,
    val log: OverlayLog,
    val strip: OverlayStrip,
    val mini: OverlayMini,
    val opacity: Double,
    val positionLock: Boolean,
    val size: OverlaySizeLimits,
) {
    public fun toJson(): JsonObject = JsonObject(linkedMapOf(
        "pill" to JsonObject(linkedMapOf("title" to JsonPrimitive(pill.title), "chips" to JsonArray(pill.chips.map { it.toJson() }), "quickAction" to JsonPrimitive(pill.quickAction))),
        "log" to JsonObject(linkedMapOf("show" to JsonPrimitive(log.show), "maxLines" to JsonPrimitive(log.maxLines), "showConfidence" to JsonPrimitive(log.showConfidence))),
        "strip" to JsonObject(linkedMapOf("show" to JsonPrimitive(strip.show), "maxLines" to JsonPrimitive(strip.maxLines), "lineMs" to JsonPrimitive(strip.lineMs))),
        "mini" to JsonObject(linkedMapOf("defaultOpen" to JsonPrimitive(mini.defaultOpen), "width" to mini.width.toJson(), "height" to mini.height.toJson())),
        "opacity" to OverlayEngine.number(opacity),
        "positionLock" to JsonPrimitive(positionLock),
        "size" to JsonObject(linkedMapOf(
            "minWidth" to JsonPrimitive(size.minWidth), "maxWidth" to JsonPrimitive(size.maxWidth), "minHeight" to JsonPrimitive(size.minHeight), "maxHeight" to JsonPrimitive(size.maxHeight),
            "maxScreenWidthPct" to JsonPrimitive(size.maxScreenWidthPct), "maxScreenHeightPct" to JsonPrimitive(size.maxScreenHeightPct),
        )),
    ))
}

/** One log line. `confidence` 0–1 or null; `ref` = what produced it (a trigger id, a job id …), what tap-to-tune gets back. */
public data class OverlayLogLine(val text: String, val confidence: Double?, val tag: String, val at: Long, val ref: String) {
    public fun toJson(): JsonObject = JsonObject(linkedMapOf(
        "text" to JsonPrimitive(text), "confidence" to (confidence?.let { OverlayEngine.number(it) } ?: JsonNull), "tag" to JsonPrimitive(tag), "at" to JsonPrimitive(at), "ref" to JsonPrimitive(ref),
    ))
    public companion object {
        public fun fromJson(o: JsonObject): OverlayLogLine = OverlayLogLine(
            OverlayEngine.strOf(o["text"]) ?: "", OverlayEngine.numOf(o["confidence"]), OverlayEngine.strOf(o["tag"]) ?: "",
            OverlayEngine.numOf(o["at"])?.toLong() ?: 0L, OverlayEngine.strOf(o["ref"]) ?: "",
        )
    }
}

public data class ResolvedChip(val id: String, val text: String, val tone: String, val icon: String, val on: Boolean) {
    public fun toJson(): JsonObject = JsonObject(linkedMapOf("id" to JsonPrimitive(id), "text" to JsonPrimitive(text), "tone" to JsonPrimitive(tone), "icon" to JsonPrimitive(icon), "on" to JsonPrimitive(on)))
}

public data class OverlayScreen(val width: Int, val height: Int)
public data class OverlaySize(val width: Int, val height: Int) {
    public fun toJson(): JsonObject = JsonObject(linkedMapOf("width" to JsonPrimitive(width), "height" to JsonPrimitive(height)))
}
public data class OverlayPoint(val x: Int, val y: Int) {
    public fun toJson(): JsonObject = JsonObject(linkedMapOf("x" to JsonPrimitive(x), "y" to JsonPrimitive(y)))
}

public object OverlayEngine {
    public const val TYPE: String = "overlay"

    /** Settings keys (namespaced; same on every port). Values are strings as settings stores keep them. */
    public object Settings {
        /** `w,h` in dp — the user's resize of the mini window */
        public const val SIZE: String = "axf.overlay.size"
        /** `x,y` in px — where the user dragged the pill */
        public const val POSITION: String = "axf.overlay.position"
        public const val OPACITY: String = "axf.overlay.opacity"
        public const val POSITION_LOCK: String = "axf.overlay.positionLock"
        public const val LOG: String = "axf.overlay.log"
        public const val STRIP: String = "axf.overlay.strip"
        public const val MINI: String = "axf.overlay.mini"
        public val ALL: Map<String, String> = linkedMapOf("size" to SIZE, "position" to POSITION, "opacity" to OPACITY, "positionLock" to POSITION_LOCK, "log" to LOG, "strip" to STRIP, "mini" to MINI)
    }

    /** Hard bounds every number is clamped into (the asset's own limits live inside these). Same values as OVERLAY_LIMITS. */
    public object Limits {
        public const val OPACITY_MIN: Double = 0.2
        public const val OPACITY_MAX: Double = 1.0
        public const val OPACITY_DEFAULT: Double = 0.92
        public const val LOG_LINES_MIN: Int = 1
        public const val LOG_LINES_MAX: Int = 50
        public const val LOG_LINES_DEFAULT: Int = 5
        public const val STRIP_LINES_MIN: Int = 1
        public const val STRIP_LINES_MAX: Int = 6
        public const val STRIP_LINES_DEFAULT: Int = 3
        public const val STRIP_MS_MIN: Int = 500
        public const val STRIP_MS_MAX: Int = 30000
        public const val STRIP_MS_DEFAULT: Int = 3000
        public const val WIDTH_MIN: Int = 48
        public const val WIDTH_MAX: Int = 1200
        public const val HEIGHT_MIN: Int = 32
        public const val HEIGHT_MAX: Int = 1600
        public const val SCREEN_PCT_MIN: Int = 20
        public const val SCREEN_PCT_MAX: Int = 100
        public const val CHIPS_MAX: Int = 6
        public const val LABEL_MAX: Int = 24
        public const val TAG_MAX: Int = 24
        public const val LINE_TEXT_MAX: Int = 200
        public const val LOG_KEEP_MAX: Int = 200
        /** The fixture's `limits` object (TS key names). */
        public fun toJson(): JsonObject = JsonObject(linkedMapOf(
            "opacityMin" to number(OPACITY_MIN), "opacityMax" to number(OPACITY_MAX), "opacityDefault" to number(OPACITY_DEFAULT),
            "logLinesMin" to JsonPrimitive(LOG_LINES_MIN), "logLinesMax" to JsonPrimitive(LOG_LINES_MAX), "logLinesDefault" to JsonPrimitive(LOG_LINES_DEFAULT),
            "stripLinesMin" to JsonPrimitive(STRIP_LINES_MIN), "stripLinesMax" to JsonPrimitive(STRIP_LINES_MAX), "stripLinesDefault" to JsonPrimitive(STRIP_LINES_DEFAULT),
            "stripMsMin" to JsonPrimitive(STRIP_MS_MIN), "stripMsMax" to JsonPrimitive(STRIP_MS_MAX), "stripMsDefault" to JsonPrimitive(STRIP_MS_DEFAULT),
            "widthMin" to JsonPrimitive(WIDTH_MIN), "widthMax" to JsonPrimitive(WIDTH_MAX), "heightMin" to JsonPrimitive(HEIGHT_MIN), "heightMax" to JsonPrimitive(HEIGHT_MAX),
            "screenPctMin" to JsonPrimitive(SCREEN_PCT_MIN), "screenPctMax" to JsonPrimitive(SCREEN_PCT_MAX),
            "chipsMax" to JsonPrimitive(CHIPS_MAX), "labelMax" to JsonPrimitive(LABEL_MAX), "tagMax" to JsonPrimitive(TAG_MAX), "lineTextMax" to JsonPrimitive(LINE_TEXT_MAX), "logKeepMax" to JsonPrimitive(LOG_KEEP_MAX),
        ))
    }

    public val CHIP_TONES: List<String> = listOf("neutral", "success", "warning", "danger", "accent", "muted", "info")
    /** Chip tone → theme colour token (same table the status widget uses). */
    public val CHIP_TONE_TOKEN: Map<String, String> = linkedMapOf("neutral" to "text", "success" to "success", "warning" to "warning", "danger" to "danger", "accent" to "accent", "muted" to "muted", "info" to "info")
    private val CHIP_ID = Regex("^[a-z0-9][a-z0-9._-]*$")
    private val PAIR = Regex("^\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*$")

    /* ---------- JSON readers (the web engine's typeof rules: a string number is not a number, a number is not a bool) ---------- */

    internal fun numOf(e: JsonElement?): Double? = (e as? JsonPrimitive)?.takeUnless { it.isString || it is JsonNull }?.doubleOrNull?.takeIf { it.isFinite() }
    internal fun boolOf(e: JsonElement?): Boolean? = (e as? JsonPrimitive)?.takeUnless { it.isString || it is JsonNull }?.booleanOrNull
    internal fun strOf(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun objOf(e: JsonElement?): JsonObject? = e as? JsonObject
    /** Numbers print like JavaScript's: whole values without a fraction. */
    public fun number(d: Double): JsonPrimitive = if (d == Math.floor(d) && d.isFinite() && Math.abs(d) < 1e15) JsonPrimitive(d.toLong()) else JsonPrimitive(d)
    private fun numText(d: Double): String = number(d).content
    private fun clamp(v: Double, lo: Double, hi: Double): Double = Math.min(hi, Math.max(lo, v))
    private fun roundInt(v: Double): Int = Math.round(v).toInt()
    private fun numIn(e: JsonElement?, lo: Int, hi: Int, d: Int): Int { val n = numOf(e) ?: return d; return roundInt(clamp(n, lo.toDouble(), hi.toDouble())) }
    private fun boolIn(e: JsonElement?, d: Boolean): Boolean = boolOf(e) ?: d
    private fun text(e: JsonElement?, max: Int, d: String = ""): String = strOf(e)?.take(max) ?: d

    private fun range(raw: JsonElement?, lo: Int, hi: Int, dMin: Int, dMax: Int, dDef: Int): OverlayRange {
        val r = objOf(raw)
        var min = numIn(r?.get("min"), lo, hi, dMin)
        var max = numIn(r?.get("max"), lo, hi, dMax)
        if (max < min) { val t = min; min = max; max = t }
        val def = numIn(r?.get("default"), min, max, dDef.coerceIn(min, max))
        return OverlayRange(min, max, def)
    }

    public fun normalizeChip(raw: JsonElement?): OverlayChip? {
        val o = objOf(raw) ?: return null
        val id = strOf(o["id"])?.takeIf { CHIP_ID.matches(it) } ?: return null
        val tone = strOf(o["tone"])?.takeIf { it in CHIP_TONES } ?: "success"
        val offTone = strOf(o["offTone"])?.takeIf { it in CHIP_TONES } ?: "muted"
        return OverlayChip(id, text(o["label"], Limits.LABEL_MAX, id), text(o["offLabel"], Limits.LABEL_MAX), tone, offTone, text(o["icon"], 40), boolIn(o["on"], false))
    }

    /** Tolerant: anything missing or odd becomes its default, every number is clamped, chips without an id are dropped. */
    public fun normalize(raw: JsonElement?): OverlayData {
        val d = objOf(raw)
        val pill = objOf(d?.get("pill"))
        val log = objOf(d?.get("log"))
        val strip = objOf(d?.get("strip"))
        val mini = objOf(d?.get("mini"))
        val size = objOf(d?.get("size"))
        val chips = ArrayList<OverlayChip>()
        val seen = HashSet<String>()
        (pill?.get("chips") as? JsonArray)?.forEach { c ->
            val chip = normalizeChip(c)
            if (chip != null && seen.add(chip.id) && chips.size < Limits.CHIPS_MAX) chips += chip
        }
        var minWidth = numIn(size?.get("minWidth"), Limits.WIDTH_MIN, Limits.WIDTH_MAX, 120)
        var maxWidth = numIn(size?.get("maxWidth"), Limits.WIDTH_MIN, Limits.WIDTH_MAX, 480)
        if (maxWidth < minWidth) { val t = minWidth; minWidth = maxWidth; maxWidth = t }
        var minHeight = numIn(size?.get("minHeight"), Limits.HEIGHT_MIN, Limits.HEIGHT_MAX, 48)
        var maxHeight = numIn(size?.get("maxHeight"), Limits.HEIGHT_MIN, Limits.HEIGHT_MAX, 640)
        if (maxHeight < minHeight) { val t = minHeight; minHeight = maxHeight; maxHeight = t }
        val opacity = numOf(d?.get("opacity"))?.let { Math.round(clamp(it, Limits.OPACITY_MIN, Limits.OPACITY_MAX) * 100) / 100.0 } ?: Limits.OPACITY_DEFAULT
        return OverlayData(
            pill = OverlayPill(text(pill?.get("title"), 40), chips, text(pill?.get("quickAction"), 80)),
            log = OverlayLog(boolIn(log?.get("show"), true), numIn(log?.get("maxLines"), Limits.LOG_LINES_MIN, Limits.LOG_LINES_MAX, Limits.LOG_LINES_DEFAULT), boolIn(log?.get("showConfidence"), true)),
            strip = OverlayStrip(boolIn(strip?.get("show"), true), numIn(strip?.get("maxLines"), Limits.STRIP_LINES_MIN, Limits.STRIP_LINES_MAX, Limits.STRIP_LINES_DEFAULT), numIn(strip?.get("lineMs"), Limits.STRIP_MS_MIN, Limits.STRIP_MS_MAX, Limits.STRIP_MS_DEFAULT)),
            mini = OverlayMini(boolIn(mini?.get("defaultOpen"), false), range(mini?.get("width"), minWidth, maxWidth, minWidth, maxWidth, 220), range(mini?.get("height"), minHeight, maxHeight, minHeight, maxHeight, 260)),
            opacity = opacity,
            positionLock = boolIn(d?.get("positionLock"), false),
            size = OverlaySizeLimits(minWidth, maxWidth, minHeight, maxHeight, numIn(size?.get("maxScreenWidthPct"), Limits.SCREEN_PCT_MIN, Limits.SCREEN_PCT_MAX, 90), numIn(size?.get("maxScreenHeightPct"), Limits.SCREEN_PCT_MIN, Limits.SCREEN_PCT_MAX, 80)),
        )
    }

    /** Validation messages (same wording as overlay-rules.mjs). Strict where normalising is lenient. */
    public fun errors(raw: JsonElement?): List<String> {
        val d = objOf(raw) ?: return listOf("data must be an object")
        val e = ArrayList<String>()
        fun numField(path: String, o: JsonObject, k: String, lo: Double, hi: Double) {
            if (k !in o) return
            val n = numOf(o[k])
            if (n == null || n < lo || n > hi) e += "$path must be a number from ${numText(lo)} to ${numText(hi)}"
        }
        fun boolField(path: String, o: JsonObject, k: String) { if (k in o && boolOf(o[k]) == null) e += "$path must be true or false" }
        val pill = objOf(d["pill"])
        if (pill == null) e += "data.pill must be an object"
        else {
            val chips = pill["chips"] as? JsonArray
            if (chips == null) e += "data.pill.chips must be a list"
            else {
                if (chips.size > Limits.CHIPS_MAX) e += "data.pill.chips: at most ${Limits.CHIPS_MAX} chips"
                val ids = HashSet<String>()
                chips.forEachIndexed { i, c ->
                    val o = objOf(c)
                    val id = o?.let { strOf(it["id"]) }?.takeIf { CHIP_ID.matches(it) }
                    if (o == null || id == null) { e += "data.pill.chips[$i].id must be an id (lowercase letters, digits, . _ -)"; return@forEachIndexed }
                    if (!ids.add(id)) e += "data.pill.chips[$i].id \"$id\" repeats"
                    if ("tone" in o && strOf(o["tone"]) !in CHIP_TONES) e += "data.pill.chips[$i].tone must be one of: ${CHIP_TONES.joinToString(", ")}"
                    if ("offTone" in o && strOf(o["offTone"]) !in CHIP_TONES) e += "data.pill.chips[$i].offTone must be one of: ${CHIP_TONES.joinToString(", ")}"
                    if ("label" in o && strOf(o["label"]) == null) e += "data.pill.chips[$i].label must be a string"
                }
            }
            if ("quickAction" in pill && strOf(pill["quickAction"]) == null) e += "data.pill.quickAction must be an action spec string"
        }
        val log = objOf(d["log"])
        if (log == null) e += "data.log must be an object"
        else { boolField("data.log.show", log, "show"); numField("data.log.maxLines", log, "maxLines", Limits.LOG_LINES_MIN.toDouble(), Limits.LOG_LINES_MAX.toDouble()); boolField("data.log.showConfidence", log, "showConfidence") }
        val strip = objOf(d["strip"])
        if (strip == null) e += "data.strip must be an object"
        else { boolField("data.strip.show", strip, "show"); numField("data.strip.maxLines", strip, "maxLines", Limits.STRIP_LINES_MIN.toDouble(), Limits.STRIP_LINES_MAX.toDouble()); numField("data.strip.lineMs", strip, "lineMs", Limits.STRIP_MS_MIN.toDouble(), Limits.STRIP_MS_MAX.toDouble()) }
        val mini = objOf(d["mini"])
        if (mini == null) e += "data.mini must be an object"
        else {
            boolField("data.mini.defaultOpen", mini, "defaultOpen")
            for ((k, lo, hi) in listOf(Triple("width", Limits.WIDTH_MIN, Limits.WIDTH_MAX), Triple("height", Limits.HEIGHT_MIN, Limits.HEIGHT_MAX))) {
                if (k !in mini) continue
                val r = objOf(mini[k])
                if (r == null) { e += "data.mini.$k must be { min, max, default }"; continue }
                numField("data.mini.$k.min", r, "min", lo.toDouble(), hi.toDouble()); numField("data.mini.$k.max", r, "max", lo.toDouble(), hi.toDouble()); numField("data.mini.$k.default", r, "default", lo.toDouble(), hi.toDouble())
                val mn = numOf(r["min"]); val mx = numOf(r["max"])
                if (mn != null && mx != null && mn > mx) e += "data.mini.$k.min must not be above max"
            }
        }
        numField("data.opacity", d, "opacity", Limits.OPACITY_MIN, Limits.OPACITY_MAX)
        boolField("data.positionLock", d, "positionLock")
        if ("size" in d) {
            val s = objOf(d["size"])
            if (s == null) e += "data.size must be an object"
            else {
                numField("data.size.minWidth", s, "minWidth", Limits.WIDTH_MIN.toDouble(), Limits.WIDTH_MAX.toDouble()); numField("data.size.maxWidth", s, "maxWidth", Limits.WIDTH_MIN.toDouble(), Limits.WIDTH_MAX.toDouble())
                numField("data.size.minHeight", s, "minHeight", Limits.HEIGHT_MIN.toDouble(), Limits.HEIGHT_MAX.toDouble()); numField("data.size.maxHeight", s, "maxHeight", Limits.HEIGHT_MIN.toDouble(), Limits.HEIGHT_MAX.toDouble())
                numField("data.size.maxScreenWidthPct", s, "maxScreenWidthPct", Limits.SCREEN_PCT_MIN.toDouble(), Limits.SCREEN_PCT_MAX.toDouble()); numField("data.size.maxScreenHeightPct", s, "maxScreenHeightPct", Limits.SCREEN_PCT_MIN.toDouble(), Limits.SCREEN_PCT_MAX.toDouble())
            }
        }
        return e
    }

    /* ---------- geometry ---------- */

    /** The largest window the asset allows on this screen (dp). */
    public fun maxSize(d: OverlayData, screen: OverlayScreen): OverlaySize = OverlaySize(
        Math.max(d.size.minWidth, Math.min(d.size.maxWidth, Math.floor(screen.width * d.size.maxScreenWidthPct / 100.0).toInt())),
        Math.max(d.size.minHeight, Math.min(d.size.maxHeight, Math.floor(screen.height * d.size.maxScreenHeightPct / 100.0).toInt())),
    )

    /** A requested window size clamped into the asset's limits and the screen. Junk (0×0, null) becomes the mini defaults. */
    public fun clampSize(d: OverlayData, wantedWidth: Double?, wantedHeight: Double?, screen: OverlayScreen): OverlaySize {
        val mx = maxSize(d, screen)
        val w = if (wantedWidth == null || !wantedWidth.isFinite() || wantedWidth <= 0) d.mini.width.default.toDouble() else wantedWidth
        val h = if (wantedHeight == null || !wantedHeight.isFinite() || wantedHeight <= 0) d.mini.height.default.toDouble() else wantedHeight
        return OverlaySize(
            roundInt(clamp(w, Math.min(d.size.minWidth, mx.width).toDouble(), mx.width.toDouble())),
            roundInt(clamp(h, Math.min(d.size.minHeight, mx.height).toDouble(), mx.height.toDouble())),
        )
    }
    public fun clampSize(d: OverlayData, wanted: OverlaySize?, screen: OverlayScreen): OverlaySize = clampSize(d, wanted?.width?.toDouble(), wanted?.height?.toDouble(), screen)

    /** The mini screen's size: its own range, then the window limits. */
    public fun miniSize(d: OverlayData, wantedWidth: Double?, wantedHeight: Double?, screen: OverlayScreen): OverlaySize {
        val w = if (wantedWidth == null || !wantedWidth.isFinite() || wantedWidth <= 0) d.mini.width.default.toDouble() else wantedWidth
        val h = if (wantedHeight == null || !wantedHeight.isFinite() || wantedHeight <= 0) d.mini.height.default.toDouble() else wantedHeight
        return clampSize(d, clamp(w, d.mini.width.min.toDouble(), d.mini.width.max.toDouble()), clamp(h, d.mini.height.min.toDouble(), d.mini.height.max.toDouble()), screen)
    }
    public fun miniSize(d: OverlayData, wanted: OverlaySize?, screen: OverlayScreen): OverlaySize = miniSize(d, wanted?.width?.toDouble(), wanted?.height?.toDouble(), screen)

    /** Keeps a window of `size` on the screen: a position dragged off the edge (or saved from a bigger screen) comes back. */
    public fun clampPosition(x: Double?, y: Double?, size: OverlaySize, screen: OverlayScreen): OverlayPoint = OverlayPoint(
        roundInt(clamp(x?.takeIf { it.isFinite() } ?: 0.0, 0.0, Math.max(0, screen.width - size.width).toDouble())),
        roundInt(clamp(y?.takeIf { it.isFinite() } ?: 0.0, 0.0, Math.max(0, screen.height - size.height).toDouble())),
    )
    public fun clampPosition(p: OverlayPoint?, size: OverlaySize, screen: OverlayScreen): OverlayPoint = clampPosition(p?.x?.toDouble(), p?.y?.toDouble(), size, screen)

    /** May the user drag it? The setting (`"true"` / `"false"`) wins over the asset; anything else leaves the asset's say. */
    public fun canDrag(d: OverlayData, setting: String?): Boolean = !(when (setting) { "true" -> true; "false" -> false; else -> d.positionLock })
    public fun canDrag(d: OverlayData, lock: Boolean): Boolean = !lock

    /* ---------- log ---------- */

    public fun logLine(text: String?, confidence: Double?, tag: String?, at: Long, ref: String? = ""): OverlayLogLine = OverlayLogLine(
        (text ?: "").take(Limits.LINE_TEXT_MAX),
        confidence?.takeIf { it.isFinite() }?.let { Math.round(clamp(it, 0.0, 1.0) * 10000) / 10000.0 },
        (tag ?: "").take(Limits.TAG_MAX), at, (ref ?: "").take(80),
    )

    /** Adds a line and keeps the newest `maxLines` (oldest first). */
    public fun addLogLine(lines: List<OverlayLogLine>, line: OverlayLogLine, maxLines: Int): List<OverlayLogLine> = trimLog(lines + line, maxLines)

    public fun trimLog(lines: List<OverlayLogLine>, maxLines: Int): List<OverlayLogLine> {
        val n = maxLines.coerceIn(Limits.LOG_LINES_MIN, Limits.LOG_KEEP_MAX)
        return if (lines.size <= n) lines.toList() else lines.subList(lines.size - n, lines.size).toList()
    }

    /** "85.0%" — one decimal, same on every port. */
    public fun confidenceText(confidence: Double?): String {
        if (confidence == null) return ""
        val v = Math.round(confidence * 1000) / 10.0
        return String.format(java.util.Locale.ROOT, "%.1f", v) + "%"
    }

    /** The text a log line shows: `text · 85.0% · tag` (parts left out when empty or when confidence is hidden). */
    public fun logLineText(line: OverlayLogLine, showConfidence: Boolean): String {
        val parts = ArrayList<String>()
        parts += line.text
        if (showConfidence && line.confidence != null) parts += confidenceText(line.confidence)
        if (line.tag.isNotEmpty()) parts += line.tag
        return parts.filter { it.isNotEmpty() }.joinToString(" · ")
    }

    /** Opacity for the i-th oldest of n lines: the newest full, each older one a step dimmer, never under 0.35. */
    public fun logLineFade(index: Int, count: Int): Double {
        val age = Math.max(0, count - 1 - index)
        return Math.max(0.35, Math.round((1 - age * 0.15) * 100) / 100.0)
    }

    /* ---------- collapsed strip ---------- */

    /** The lines the strip shows at `now`: those added inside `lineMs`, newest `maxLines`, oldest first. */
    public fun stripLines(lines: List<OverlayLogLine>, now: Long, maxLines: Int, lineMs: Int): List<OverlayLogLine> {
        val alive = lines.filter { now - it.at >= 0 && now - it.at < lineMs }
        return if (alive.size <= maxLines) alive else alive.subList(alive.size - maxLines, alive.size)
    }
    public fun stripLines(lines: List<OverlayLogLine>, now: Long, strip: OverlayStrip): List<OverlayLogLine> = stripLines(lines, now, strip.maxLines, strip.lineMs)

    /** Ms until the next strip line expires (≥ 16, so a timer never spins), or null when nothing is showing. */
    public fun nextStripExpiry(lines: List<OverlayLogLine>, now: Long, maxLines: Int, lineMs: Int): Long? {
        val alive = stripLines(lines, now, maxLines, lineMs)
        if (alive.isEmpty()) return null
        return Math.max(16L, alive.minOf { it.at + lineMs - now })
    }
    public fun nextStripExpiry(lines: List<OverlayLogLine>, now: Long, strip: OverlayStrip): Long? = nextStripExpiry(lines, now, strip.maxLines, strip.lineMs)

    /* ---------- chips ---------- */

    /** Chips with their current state applied: `states` (id → on) over each chip's own starting state; a null entry counts as absent. */
    public fun resolveChips(chips: List<OverlayChip>, states: Map<String, Boolean?>): List<ResolvedChip> = chips.map { c ->
        val on = states[c.id] ?: c.on
        ResolvedChip(c.id, if (on || c.offLabel.isEmpty()) c.label else c.offLabel, if (on) c.tone else c.offTone, c.icon, on)
    }

    public fun setChip(states: Map<String, Boolean?>, id: String, on: Boolean): Map<String, Boolean> {
        val out = LinkedHashMap<String, Boolean>()
        for ((k, v) in states) if (v != null) out[k] = v
        out[id] = on
        return out
    }

    public fun chipToneToken(tone: String): String = CHIP_TONE_TOKEN[tone] ?: "text"

    /* ---------- settings over the asset ---------- */

    /** The user's own choices (settings values as strings) over the asset's data. Unknown or junk values leave the asset's value. */
    public fun withSettings(d: OverlayData, values: Map<String, String?>): OverlayData {
        fun b(k: String, cur: Boolean): Boolean = when (values[k]) { "true" -> true; "false" -> false; else -> cur }
        val op = values[Settings.OPACITY]
        val opN = op?.trim()?.takeIf { it.isNotEmpty() }?.toDoubleOrNull()?.takeIf { it.isFinite() }
        val opacity = if (opN == null) d.opacity else Math.round(clamp(opN, Limits.OPACITY_MIN, Limits.OPACITY_MAX) * 100) / 100.0
        val size = parseSize(values[Settings.SIZE])
        return d.copy(
            pill = d.pill.copy(chips = d.pill.chips.map { it.copy() }),
            log = d.log.copy(show = b(Settings.LOG, d.log.show)),
            strip = d.strip.copy(show = b(Settings.STRIP, d.strip.show)),
            mini = d.mini.copy(
                defaultOpen = b(Settings.MINI, d.mini.defaultOpen),
                width = d.mini.width.copy(default = if (size != null) roundInt(clamp(size.first, d.mini.width.min.toDouble(), d.mini.width.max.toDouble())) else d.mini.width.default),
                height = d.mini.height.copy(default = if (size != null) roundInt(clamp(size.second, d.mini.height.min.toDouble(), d.mini.height.max.toDouble())) else d.mini.height.default),
            ),
            opacity = opacity,
            positionLock = b(Settings.POSITION_LOCK, d.positionLock),
        )
    }

    /** `w,h` → (w, h) as doubles, or null for anything else (zero or negative sizes included). */
    public fun parseSize(raw: String?): Pair<Double, Double>? {
        val m = PAIR.matchEntire(raw ?: return null) ?: return null
        val w = m.groupValues[1].toDouble(); val h = m.groupValues[2].toDouble()
        return if (w > 0 && h > 0) w to h else null
    }
    public fun serializeSize(width: Double, height: Double): String = "${Math.round(width)},${Math.round(height)}"
    public fun serializeSize(s: OverlaySize): String = "${s.width},${s.height}"

    /** `x,y` → (x, y), or null. */
    public fun parsePosition(raw: String?): Pair<Double, Double>? {
        val m = PAIR.matchEntire(raw ?: return null) ?: return null
        return m.groupValues[1].toDouble() to m.groupValues[2].toDouble()
    }
    public fun serializePosition(x: Double, y: Double): String = "${Math.round(x)},${Math.round(y)}"
    public fun serializePosition(p: OverlayPoint): String = "${p.x},${p.y}"
}
