package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.asset.AxfJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Appearance engine — the shared appearance document (`appearance@1`) Brett's developer apps keep on the axHub
 * data server (`shared/settings/appearance.json`). Mirrors core/engines/appearance.ts: ids and small values only
 * (asset id per slot, spacing, hidden chrome, a small palette for the hub's own pages), never asset bodies or code.
 * Everything is checked against the app's registry when applied: an id the app doesn't ship keeps the default.
 * Fixtures: spec/fixtures/appearance.json (AppearanceConformanceTest).
 */
public data class AppearanceDocument(
    val slots: Map<String, String> = emptyMap(),
    val spacing: Spacing? = null,
    val hidden: Map<String, Boolean> = emptyMap(),
    /** key → colour literal; `scheme` → light|dark */
    val palette: Map<String, String> = emptyMap(),
    val updatedBy: String? = null,
    val updatedAt: String? = null,
) {
    public fun toJson(): JsonObject = buildJsonObject {
        put("\$axf", JsonPrimitive(AppearanceEngine.FRAME))
        if (slots.isNotEmpty()) put("slots", JsonObject(slots.toSortedMap().mapValues { JsonPrimitive(it.value) }))
        spacing?.let { put("spacing", JsonPrimitive(it.id)) }
        if (hidden.isNotEmpty()) put("hidden", JsonObject(hidden.toSortedMap().mapValues { JsonPrimitive(it.value) }))
        if (palette.isNotEmpty()) put("palette", JsonObject(AppearanceEngine.PALETTE_KEYS.filter { it in palette }.associateWith { JsonPrimitive(palette.getValue(it)) } + (palette["scheme"]?.let { mapOf("scheme" to JsonPrimitive(it)) } ?: emptyMap())))
        updatedBy?.let { put("updatedBy", JsonPrimitive(it)) }
        updatedAt?.let { put("updatedAt", JsonPrimitive(it)) }
    }
    public fun serialize(): String = toJson().toString()
}

/** What a document resolves to inside one app: only values it can apply, plus what was skipped and why. */
public data class ResolvedAppearance(val slots: Map<String, String>, val spacing: Spacing?, val hidden: Map<String, Boolean>, val skipped: List<String>)

/** A change one app saves: keys it touched only; `hidden` null = clear the override. */
public data class AppearanceChange(val slots: Map<String, String> = emptyMap(), val spacing: Spacing? = null, val hidden: Map<String, Boolean?> = emptyMap(), val palette: Map<String, String>? = null)

/** The source's connection state (web: AppearanceSourceState). */
public sealed interface AppearanceSourceState {
    public data object Connecting : AppearanceSourceState
    public data class Ready(val version: String?) : AppearanceSourceState
    public data class Unauthorized(val reason: String) : AppearanceSourceState
    public data class Unreachable(val reason: String, val retryInMs: Long, val attempt: Int) : AppearanceSourceState
}

public object AppearanceEngine {
    public const val FRAME: String = "appearance@1"
    public const val PROJECT: String = "shared"
    public const val PATH: String = "settings/appearance.json"
    public const val MAX_BYTES: Int = 16 * 1024
    public val NEVER: List<String> = listOf(AssetTypes.UAC_POLICY)
    public val PALETTE_KEYS: List<String> = listOf("bg", "fg", "muted", "card", "line", "accent", "danger", "ok")
    private val ID = Regex("^[a-z0-9][a-z0-9-]{0,63}$")
    private val COLOR = Regex("^(#[0-9a-fA-F]{3,8}|rgba?\\(\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*(,\\s*[\\d.]+\\s*)?\\))$")
    private val PALETTE_TOKEN = linkedMapOf("bg" to "bg", "fg" to "text", "muted" to "muted", "card" to "surface", "line" to "border", "accent" to "accent", "danger" to "danger", "ok" to "success")

    public fun slotTypes(types: AssetTypeRegistry): List<String> = types.ids().filter { it !in NEVER }

    /** Parse text; null when it isn't an appearance@1 document (bad JSON, wrong frame, over MAX_BYTES chars). */
    public fun parse(text: String?): AppearanceDocument? {
        if (text == null || text.isBlank() || text.length > MAX_BYTES) return null
        val el = AxfJson.runCatching { parseToJsonElement(text) }.getOrNull() ?: return null
        return normalize(el)
    }

    public fun normalize(raw: JsonElement?): AppearanceDocument? {
        val o = raw as? JsonObject ?: return null
        if ((o["\$axf"] as? JsonPrimitive)?.content != FRAME) return null
        val slots = (o["slots"] as? JsonObject)?.entries?.mapNotNull { (t, v) ->
            val id = (v as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
            if (ID.matches(id) && ID.matches(t) && t !in NEVER) t to id else null
        }?.toMap() ?: emptyMap()
        val spacing = (o["spacing"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { s -> Spacing.entries.firstOrNull { it.id == s } }
        val hidden = (o["hidden"] as? JsonObject)?.entries?.mapNotNull { (t, v) ->
            val b = (v as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.content?.toBooleanStrictOrNull() ?: return@mapNotNull null
            if (ID.matches(t)) t to b else null
        }?.toMap() ?: emptyMap()
        val palette = LinkedHashMap<String, String>()
        (o["palette"] as? JsonObject)?.let { p ->
            for (k in PALETTE_KEYS) { val v = (p[k] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue; if (v.length <= 40 && COLOR.matches(v)) palette[k] = v }
            (p["scheme"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { if (it == "light" || it == "dark") palette["scheme"] = it }
        }
        val by = (o["updatedBy"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.length <= 80 }
        val at = (o["updatedAt"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.length <= 40 }
        return AppearanceDocument(slots, spacing, hidden, palette, by, at)
    }

    /** Check a document against what this app has (`has(type, id)`); unknown ids are skipped, the slot keeps its default. */
    public fun resolve(doc: AppearanceDocument?, types: AssetTypeRegistry, has: (String, String) -> Boolean): ResolvedAppearance {
        if (doc == null) return ResolvedAppearance(emptyMap(), null, emptyMap(), emptyList())
        val slotTypes = slotTypes(types)
        val skipped = ArrayList<String>()
        val slots = LinkedHashMap<String, String>()
        for ((t, id) in doc.slots) {
            if (t !in slotTypes) { skipped += "$t:$id (not a slot here)"; continue }
            if (!has(t, id)) { skipped += "$t:$id (not in this app)"; continue }
            slots[t] = id
        }
        val hidden = LinkedHashMap<String, Boolean>()
        for ((t, v) in doc.hidden) {
            if (types.get(t) == null || !HideEngine.hideable(types, t)) { skipped += "hidden $t (not hideable)"; continue }
            hidden[t] = v
        }
        return ResolvedAppearance(slots, doc.spacing, hidden, skipped)
    }

    /** The palette for the hub's own pages, from a colour theme's `data` (scheme + tokens). */
    public fun paletteFromColorTheme(data: JsonObject?): Map<String, String> {
        val tokens = data?.get("tokens") as? JsonObject ?: return emptyMap()
        val out = LinkedHashMap<String, String>()
        for ((k, token) in PALETTE_TOKEN) { val v = (tokens[token] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue; if (COLOR.matches(v)) out[k] = v }
        (data["scheme"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { if (it == "light" || it == "dark") out["scheme"] = it }
        return out
    }

    /** Merge one app's change into the document, per key (last write wins); keys the change doesn't name stay. */
    public fun merge(base: AppearanceDocument?, change: AppearanceChange, by: String, now: String): AppearanceDocument {
        val b = base ?: AppearanceDocument()
        val hidden = LinkedHashMap(b.hidden)
        for ((t, v) in change.hidden) { if (v == null) hidden.remove(t) else hidden[t] = v }
        val merged = AppearanceDocument(
            slots = b.slots + change.slots,
            spacing = change.spacing ?: b.spacing,
            hidden = hidden,
            palette = change.palette ?: b.palette,
            updatedBy = by.take(80),
            updatedAt = now,
        )
        return normalize(merged.toJson()) ?: AppearanceDocument()
    }

    /** Reconnect backoff: 1 s, 2 s, 4 s … capped at 30 s (same on every port). */
    public fun retryMs(attempt: Int): Long = minOf(30_000L, 1000L shl attempt.coerceIn(0, 5))
}
