package ai.amberx.axf.kernel.runtime

import ai.amberx.axf.kernel.asset.AssetTypes

public enum class ToastKind { INFO, SUCCESS, WARNING, DANGER }
public data class Toast(val id: Long, val kind: ToastKind, val title: String?, val message: String, val atMillis: Long)
public data class DialogState(val id: String, val props: Map<String, String> = emptyMap())
public data class ContextState(val x: Float, val y: Float, val target: String, val payload: String? = null)

/**
 * The single immutable state of an AXF app (Foundations: f.state). Serializable (see [AxfState.persisted])
 * so the shell survives process death. Mirrors the web port's AxfState field for field.
 */
public data class AxfState(
    /** active asset id per slot (type → id); optional Android types may be absent */
    val active: Map<String, String>,
    val role: String,
    val view: String,
    val dialog: DialogState? = null,
    val toasts: List<Toast> = emptyList(),
    val context: ContextState? = null,
    /** increments on every state change */
    val rev: Long = 0,
    /** increments on every successful hot-swap */
    val swaps: Long = 0,
    val windowWidthDp: Int = 0,
    /** A short message popping out of a banner attachment (key = `type:id`); the UI layer calls dismissBannerPopup after it. */
    val bannerPopup: BannerPopup? = null,
) {
    public fun active(type: String): String? = active[type]
    public val colorTheme: String get() = active.getValue(AssetTypes.COLOR_THEME)
    public val layout: String get() = active.getValue(AssetTypes.LAYOUT)
}

/** The on-disk part of the state (hot-swap choices + role), identical to the web port's localStorage payload. */
public data class Persisted(val active: Map<String, String>, val role: String?, val defaults: Map<String, String>? = null) {
    public fun toJson(): String = kotlinx.serialization.json.buildJsonObject {
        put("active", kotlinx.serialization.json.JsonObject(active.mapValues { kotlinx.serialization.json.JsonPrimitive(it.value) }))
        role?.let { put("role", kotlinx.serialization.json.JsonPrimitive(it)) }
        defaults?.let { d -> put("defaults", kotlinx.serialization.json.JsonObject(d.mapValues { kotlinx.serialization.json.JsonPrimitive(it.value) })) }
    }.toString()
    public companion object {
        public fun fromJson(text: String?): Persisted? = text?.let { ai.amberx.axf.kernel.asset.AxfJson.runCatching { parseToJsonElement(it) as kotlinx.serialization.json.JsonObject }.getOrNull() }?.let { o ->
            Persisted(ai.amberx.axf.kernel.asset.strMap(o, "active"), ai.amberx.axf.kernel.asset.strOrNull(o, "role"), if (o.containsKey("defaults")) ai.amberx.axf.kernel.asset.strMap(o, "defaults") else null)
        }
    }
}

/** See AxfState.bannerPopup (web: AxfState.bannerPopup). */
public data class BannerPopup(val key: String, val text: String, val durationMs: Long = 5000)
