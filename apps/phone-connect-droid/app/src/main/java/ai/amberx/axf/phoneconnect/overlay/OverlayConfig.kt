package ai.amberx.axf.phoneconnect.overlay

import org.json.JSONObject

/**
 * What the overlay looks like and does, as the console's Overlay settings send it (phone-overlay@1). The phone only
 * applies it; anything missing or out of range falls back to the defaults here. Pure: parsed from JSON, unit tested.
 */
data class ToolbarItem(val id: String, val kind: String, val icon: String, val label: String, val action: String)

data class PopupStyle(
    val position: String = "top",          // top, bottom, center, top-left, top-right, bottom-left, bottom-right, from-button
    val enter: String = "slide-top",       // slide-top, burst, circle, fade, scale, bounce
    val exit: String = "fade",
    val speedMs: Int = 260,
    val size: String = "medium",           // small, medium, large
    val stayMs: Int = 8000,                // 0 = until acted on
    val sound: Boolean = false,
    val vibrate: Boolean = true,
    val opacity: Float = 1f,
)

data class OverlayConfig(
    val items: List<ToolbarItem> = DEFAULT_ITEMS,
    val popups: Map<String, PopupStyle> = mapOf(
        "approval" to PopupStyle(position = "center", enter = "scale", stayMs = 0, sound = true),
        "alert" to PopupStyle(position = "top", enter = "slide-top", stayMs = 10000, sound = true),
        "notification" to PopupStyle(position = "top", enter = "fade", stayMs = 6000),
    ),
    val buttonSize: Int = 56,              // dp, 40..80
    val buttonShape: String = "circle",    // circle, rounded, square
    val edgeSnap: Boolean = true,
    val autoCollapseMs: Int = 6000,        // 0 = never
    val toolbarOpacity: Float = 1f,
) {
    fun popup(kind: String): PopupStyle = popups[kind] ?: PopupStyle()

    companion object {
        const val FRAME = "phone-overlay@1"
        val POSITIONS = setOf("top", "bottom", "center", "top-left", "top-right", "bottom-left", "bottom-right", "from-button")
        val ANIMATIONS = setOf("slide-top", "burst", "circle", "fade", "scale", "bounce")
        val SIZES = setOf("small", "medium", "large")
        val SHAPES = setOf("circle", "rounded", "square")
        val KINDS = setOf("button", "widget")
        /** Actions the toolbar may run on the phone; anything else is dropped. */
        val ACTIONS = Regex("^(open:https://([a-z0-9-]+\\.)*amberxai\\.com(/[^\\s]*)?|approvals|recorder|recorder:start|recorder:stop|notifications|build-status|collapse)$")
        val DEFAULT_ITEMS = listOf(
            ToolbarItem("approvals", "button", "check", "Approvals", "approvals"),
            ToolbarItem("recorder", "button", "mic", "Recorder", "recorder"),
            ToolbarItem("notifications", "button", "bell", "Notifications", "notifications"),
            ToolbarItem("build", "widget", "hammer", "Build", "build-status"),
            ToolbarItem("console", "button", "monitor", "Console", "open:https://console.amberxai.com/"),
        )

        fun parse(json: JSONObject?): OverlayConfig {
            if (json == null) return OverlayConfig()
            val d = OverlayConfig()
            val items = json.optJSONArray("items")?.let { arr ->
                (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let(::item) }.distinctBy { it.id }.take(12)
            }?.takeIf { it.isNotEmpty() } ?: d.items
            val popups = d.popups.toMutableMap()
            json.optJSONObject("popups")?.let { p ->
                for (k in listOf("approval", "alert", "notification")) p.optJSONObject(k)?.let { popups[k] = style(it, popups[k] ?: PopupStyle()) }
            }
            return OverlayConfig(
                items = items, popups = popups,
                buttonSize = json.optInt("buttonSize", d.buttonSize).coerceIn(40, 80),
                buttonShape = json.optString("buttonShape").takeIf { it in SHAPES } ?: d.buttonShape,
                edgeSnap = json.optBoolean("edgeSnap", d.edgeSnap),
                autoCollapseMs = json.optInt("autoCollapseMs", d.autoCollapseMs).coerceIn(0, 60000),
                toolbarOpacity = json.optDouble("toolbarOpacity", d.toolbarOpacity.toDouble()).toFloat().coerceIn(0.3f, 1f),
            )
        }

        private fun item(o: JSONObject): ToolbarItem? {
            val id = o.optString("id").takeIf { it.matches(Regex("^[a-z0-9-]{1,40}$")) } ?: return null
            val action = o.optString("action").takeIf { ACTIONS.matches(it) } ?: return null
            return ToolbarItem(id, o.optString("kind").takeIf { it in KINDS } ?: "button", o.optString("icon").take(40).ifBlank { "box" }, o.optString("label").take(40).ifBlank { id }, action)
        }

        private fun style(o: JSONObject, d: PopupStyle) = PopupStyle(
            position = o.optString("position").takeIf { it in POSITIONS } ?: d.position,
            enter = o.optString("enter").takeIf { it in ANIMATIONS } ?: d.enter,
            exit = o.optString("exit").takeIf { it in ANIMATIONS } ?: d.exit,
            speedMs = o.optInt("speedMs", d.speedMs).coerceIn(80, 2000),
            size = o.optString("size").takeIf { it in SIZES } ?: d.size,
            stayMs = o.optInt("stayMs", d.stayMs).coerceIn(0, 120000),
            sound = o.optBoolean("sound", d.sound),
            vibrate = o.optBoolean("vibrate", d.vibrate),
            opacity = o.optDouble("opacity", d.opacity.toDouble()).toFloat().coerceIn(0.3f, 1f),
        )

    }
}

/** Where the button sits after a drag: snapped to the nearer side edge when edge snapping is on. Pure. */
fun snapX(x: Int, buttonPx: Int, screenPx: Int, snap: Boolean): Int {
    val clamped = x.coerceIn(0, (screenPx - buttonPx).coerceAtLeast(0))
    if (!snap) return clamped
    return if (clamped + buttonPx / 2 < screenPx / 2) 0 else (screenPx - buttonPx).coerceAtLeast(0)
}
