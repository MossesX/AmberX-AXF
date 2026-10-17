package ai.amberx.axf.kernel.interop

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Interop contracts (kernel API level 1) — how an AXF app describes what the outside world may do with it.
 * Protocol adapters (MCP, axf-link, the axHub connector, anything later) are modules that map their wire
 * format onto these types. The kernel never imports a protocol; a new protocol is a new module.
 */

/**
 * How far an action may be reached. Default-deny: an action with no [ActionDescriptor] is LOCAL, and
 * LOCAL actions are invisible to every adapter.
 *
 *   LOCAL   this app's own UI and code only
 *   LINKED  also other AXF apps (axf-link, on-device IPC)
 *   REMOTE  also anything arriving through a protocol adapter (MCP clients, axHub, …)
 */
public enum class Exposure { LOCAL, LINKED, REMOTE }

/** What running the action does to the world. Adapters surface this (MCP annotations, confirm prompts). */
public enum class ActionEffect { READ, WRITE, DESTRUCTIVE }

/**
 * The typed, self-describing side of an action. The handler still lives on the action bus (or is a
 * [CallableAction]); this is the contract adapters publish: name, description, JSON Schemas, exposure.
 *
 * `input` / `output` are JSON Schema (2020-12) objects. The kernel itself only checks `required`
 * and top-level primitive `type`s; adapters may validate fully.
 */
public data class ActionDescriptor(
    /** the action-bus id, e.g. `file.save`, `notes.create` */
    val id: String,
    /** one or two sentences an AI or developer can act on */
    val description: String,
    val input: JsonObject = JsonSchemas.EMPTY_OBJECT,
    val output: JsonObject? = null,
    val exposure: Exposure = Exposure.LOCAL,
    val effect: ActionEffect = ActionEffect.WRITE,
    /** extra permission external callers need, on top of the action's own ActionMeta.requires */
    val requires: String? = null,
    /** for plain action-bus handlers: input property names mapped, in order, onto the positional args */
    val argOrder: List<String> = emptyList(),
    /** true: callers get a job id back; progress/result arrive through [JobManager] */
    val longRunning: Boolean = false,
    val idempotent: Boolean = false,
    /** true: the action emits partial results through [ActionCall.progress] */
    val streams: Boolean = false,
    val title: String? = null,
    val tags: List<String> = emptyList(),
    val module: String = "app",
    val since: String = "0.2.0",
    /** non-null: deprecated, with a hint for callers ("use notes.create") */
    val deprecated: String? = null,
) {
    public fun reachableFrom(kind: OriginKind): Boolean = when (kind) {
        OriginKind.UI, OriginKind.APP -> true
        OriginKind.LINKED_APP -> exposure == Exposure.LINKED || exposure == Exposure.REMOTE
        OriginKind.REMOTE -> exposure == Exposure.REMOTE
    }

    public fun toJson(): JsonObject = buildJsonObject {
        put("id", id); put("description", description); title?.let { put("title", it) }
        put("input", input); output?.let { put("output", it) }
        put("exposure", exposure.name.lowercase()); put("effect", effect.name.lowercase())
        requires?.let { put("requires", it) }
        put("longRunning", longRunning); put("idempotent", idempotent); put("streams", streams)
        put("tags", JsonArray(tags.map { JsonPrimitive(it) })); put("module", module); put("since", since)
        deprecated?.let { put("deprecated", it) }
    }
}

/** Describes an event topic external subscribers may receive. Events without a descriptor stay internal. */
public data class EventDescriptor(
    val topic: String,
    val description: String,
    val payload: JsonObject? = null,
    val exposure: Exposure = Exposure.LOCAL,
    /** permission an external subscriber needs */
    val requires: String? = null,
    val module: String = "app",
) {
    public fun reachableFrom(kind: OriginKind): Boolean = when (kind) {
        OriginKind.UI, OriginKind.APP -> true
        OriginKind.LINKED_APP -> exposure != Exposure.LOCAL
        OriginKind.REMOTE -> exposure == Exposure.REMOTE
    }

    public fun toJson(): JsonObject = buildJsonObject {
        put("topic", topic); put("description", description); payload?.let { put("payload", it) }
        put("exposure", exposure.name.lowercase()); requires?.let { put("requires", it) }; put("module", module)
    }
}

/** Tiny JSON Schema helpers so modules can describe inputs without hand-writing JSON. */
public object JsonSchemas {
    public val EMPTY_OBJECT: JsonObject = buildJsonObject { put("type", "object"); put("properties", buildJsonObject { }) }

    /** A property: `prop("string", "Note title")`. */
    public fun prop(type: String, description: String? = null): JsonObject = buildJsonObject { put("type", type); description?.let { put("description", it) } }

    /** An object schema: `obj(mapOf("title" to prop("string")), required = listOf("title"))`. */
    public fun obj(properties: Map<String, JsonObject>, required: List<String> = emptyList(), description: String? = null): JsonObject = buildJsonObject {
        put("type", "object")
        description?.let { put("description", it) }
        put("properties", JsonObject(properties))
        if (required.isNotEmpty()) put("required", JsonArray(required.map { JsonPrimitive(it) }))
    }

    /** Minimal structural check: required keys present, top-level primitive types match. Returns error messages. */
    public fun check(schema: JsonObject, input: JsonObject): List<String> = buildList {
        val required = (schema["required"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
        for (r in required) if (r !in input) add("missing required field \"$r\"")
        val props = schema["properties"] as? JsonObject ?: return@buildList
        for ((k, v) in input) {
            val type = ((props[k] as? JsonObject)?.get("type") as? JsonPrimitive)?.content ?: continue
            val p = v as? JsonPrimitive
            val ok = when (type) {
                "string" -> p != null && p.isString
                "number" -> p != null && !p.isString && p.content.toDoubleOrNull() != null
                "integer" -> p != null && !p.isString && p.content.toLongOrNull() != null
                "boolean" -> p != null && !p.isString && (p.content == "true" || p.content == "false")
                "object" -> v is JsonObject
                "array" -> v is JsonArray
                else -> true
            }
            if (!ok) add("field \"$k\" must be $type")
        }
    }
}
