package ai.amberx.axf.kernel.agents

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/*
 * Agent definitions — agent-definition@1 (kernel API level 1). Mirrors the web reference framework/core/agents.ts
 * section for section; conformance fixtures spec/fixtures/agents.json (AgentsConformanceTest).
 *
 * One format for AI agents and their parts (persona, lingo, skills, tools, workflows, training, memory config) so
 * every AXF app loads the same agents. The kernel ships the data model, the validator, the system-prompt composer,
 * the memory text engine (tokens, BM25, chunking, trimming), workflow template filling, router parsing and the
 * add-on risk rules — pure Kotlin, no model, network or storage. A host (module/plugin) provides the runtime under
 * capability `axf.agents`; [PlaceholderAgentRuntime] is the kernel default until one does.
 *
 * Written without a compiler (no Maven access here): Android CI compiles and runs the conformance test.
 */

public const val AGENT_CONTRACT: String = "agent-definition@1"
public const val AGENT_ADDON_TAG: String = "agent-addon@1"
public const val AGENT_LIBRARY_ITEM_TAG: String = "agent-library-item@1"
public const val AGENT_MEMORY_TAG: String = "agent-memory@1"
public const val AGENTS_CAPABILITY: String = "axf.agents"

public object AgentVocab {
    public val COLLECTIONS: List<String> = listOf("agents", "skills", "personas", "lingo", "tools", "workflows", "training")
    public val ADDON_SECTIONS: List<String> = listOf("personas", "lingo", "skills", "tools", "agents", "workflows", "training")
    public val MEMORY_TYPES: List<String> = listOf("none", "buffer", "summary", "keyword", "vector", "hybrid")
    public val MEMORY_KINDS: List<String> = listOf("fact", "episode", "summary", "knowledge", "note")
    public val MEMORY_RECORD_MODES: List<String> = listOf("episodes", "facts", "both", "off")
    public val TOOL_KINDS: List<String> = listOf("builtin", "http", "mcp", "prompt", "agent", "workflow")
    public val HTTP_METHODS: List<String> = listOf("GET", "POST", "PUT", "PATCH", "DELETE")
    public val WORKFLOW_MODES: List<String> = listOf("sequential", "parallel", "router", "critic")
    public val TRAINING_SOURCE_TYPES: List<String> = listOf("firecrawl-scrape", "firecrawl-crawl", "firecrawl-search", "url", "repo", "text", "mcp-resource", "mcp-tool")
    public val TRAINING_SCHEDULES: List<String> = listOf("manual", "hourly", "daily", "weekly")
    public val SCHEDULE_SECONDS: Map<String, Long> = mapOf("hourly" to 3600L, "daily" to 86400L, "weekly" to 7 * 86400L)
    public val MEMORY_TOOL_NAMES: List<String> = listOf("memory_search", "memory_save")
    public const val MEMORY_SECTION: String = "## Memory\nYou have persistent memory across conversations. Relevant items are provided; use memory_search for more and memory_save for durable facts the user would want remembered."
    public const val TOOLS_SECTION_PREFIX: String = "## Tools\nUse your tools when they help; read before you claim. Tools: "
    public val ID: Regex = Regex("^[a-z0-9][a-z0-9._-]{0,63}$")
    public val TOOL_NAME: Regex = Regex("^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
    public val ADDON_ID: Regex = Regex("^[a-z0-9][a-z0-9-]{1,47}$")
}

/** Size caps shared by every port (characters, or items). */
public object AgentLimits {
    public const val NAME: Int = 120; public const val DESCRIPTION: Int = 1000; public const val INSTRUCTIONS: Int = 30000
    public const val LIST_ITEMS: Int = 200; public const val LIST_ITEM: Int = 400; public const val GLOSSARY: Int = 300
    public const val EXAMPLES: Int = 30; public const val EXAMPLE: Int = 4000; public const val SAMPLES: Int = 20; public const val VOICE: Int = 200
    public const val STEPS: Int = 40; public const val SOURCES: Int = 40; public const val MEMORY_TEXT: Int = 8000; public const val TAGS: Int = 10
    public const val TAG: Int = 30; public const val WORKFLOW_LOOPS: Int = 6; public const val DELEGATION_DEPTH: Int = 3
}

public object MemoryDefaults {
    public const val TYPE: String = "hybrid"; public const val TOP_K: Int = 6; public const val WINDOW: Int = 8; public const val MAX_ITEMS: Int = 2000
    public const val RECORD: String = "both"; public const val DECAY_DAYS: Int = 0; public const val MIN_SCORE: Double = 0.0
}

public object TrainingDefaults {
    public const val CHUNK_SIZE: Int = 1200; public const val OVERLAP: Int = 120; public const val CHUNK_MIN: Int = 300; public const val CHUNK_MAX: Int = 6000; public const val OVERLAP_MAX: Int = 1000
}

/* ---------------------------------------------------------------- data model */

public data class AgentVoice(val provider: String = "", val voiceId: String = "", val hint: String = "")
public data class AgentModel(val profile: String? = null, val model: String? = null, val temperature: Double? = null, val maxTokens: Int? = null)
public data class AgentMemoryConfig(
    val type: String? = null, val record: String? = null, val topK: Int? = null, val window: Int? = null, val maxItems: Int? = null,
    val decayDays: Int? = null, val scope: String? = null, val embedProfile: String? = null, val minScore: Double? = null,
)
public data class ResolvedMemory(
    val type: String, val scope: String, val topK: Int, val window: Int, val maxItems: Int, val record: String, val decayDays: Int, val embedProfile: String, val minScore: Double,
)
public data class AgentDef(
    val id: String? = null, val name: String = "", val icon: String? = null, val description: String? = null, val enabled: Boolean = true,
    val personaId: String = "", val lingoIds: List<String> = emptyList(), val skillIds: List<String> = emptyList(), val toolIds: List<String> = emptyList(),
    val delegates: List<String> = emptyList(), val instructions: String? = null, val model: AgentModel? = null, val memory: AgentMemoryConfig? = null,
    val voice: AgentVoice? = null, val tags: List<String> = emptyList(),
)
public data class SkillExample(val input: String, val output: String)
public data class SkillDef(
    val id: String? = null, val name: String = "", val description: String? = null, val instructions: String? = null, val triggers: List<String> = emptyList(),
    val examples: List<SkillExample> = emptyList(), val toolIds: List<String> = emptyList(), val tags: List<String> = emptyList(),
)
public data class PersonaDef(
    val id: String? = null, val name: String = "", val role: String? = null, val voice: String? = null, val tone: String? = null, val traits: List<String> = emptyList(),
    val rules: List<String> = emptyList(), val samples: List<String> = emptyList(), val voiceSlot: AgentVoice? = null, val tags: List<String> = emptyList(),
)
public data class GlossaryEntry(val term: String, val meaning: String)
public data class LingoDef(
    val id: String? = null, val name: String = "", val description: String? = null, val style: String? = null, val glossary: List<GlossaryEntry> = emptyList(),
    val phrases: List<String> = emptyList(), val avoid: List<String> = emptyList(), val tags: List<String> = emptyList(),
)
public data class ToolDef(
    val id: String? = null, val name: String, val kind: String, val config: JsonObject, val parameters: JsonObject, val description: String = "",
    val dangerous: Boolean = false, val enabled: Boolean = true, val tags: List<String> = emptyList(),
)
public data class WorkflowStep(val id: String, val agentId: String, val prompt: String? = null, val label: String? = null, val `when`: String? = null, val memory: Boolean? = null)
public data class WorkflowDef(
    val id: String? = null, val name: String = "", val description: String? = null, val mode: String = "sequential", val steps: List<WorkflowStep> = emptyList(),
    val routerAgentId: String? = null, val synthAgentId: String? = null, val maxLoops: Int? = null, val tags: List<String> = emptyList(),
)
public data class TrainingSource(val type: String, val raw: JsonObject)
public data class TrainingDef(
    val id: String? = null, val name: String? = null, val agentId: String, val sources: List<TrainingSource>, val chunkSize: Int = TrainingDefaults.CHUNK_SIZE,
    val overlap: Int = TrainingDefaults.OVERLAP, val replace: Boolean = true, val schedule: String = "manual", val tags: List<String> = emptyList(), val autoRun: Boolean? = null,
)
public data class MemoryItem(
    val id: String, val kind: String, val text: String, val tags: List<String> = emptyList(), val source: String = "", val jobId: String = "",
    val createdAt: Long, val hits: Int = 0, val lastUsed: Long? = null, val vector: List<Double>? = null,
)

/** What a validator may consult: the ids that exist, the builtin tools the host knows, extra registry entries. Open registries. */
public data class AgentContext(
    val known: Map<String, Set<String>> = emptyMap(),
    /** builtin name → (description, parameter schema) */
    val builtins: Map<String, Pair<String, JsonObject>>? = null,
    val memoryTypes: List<String> = AgentVocab.MEMORY_TYPES,
    val toolKinds: List<String> = AgentVocab.TOOL_KINDS,
    val sourceTypes: List<String> = AgentVocab.TRAINING_SOURCE_TYPES,
) {
    public fun has(collection: String, id: String): Boolean = known[collection]?.contains(id) ?: true
}

public data class AgentValidation(val errors: List<String>, val warnings: List<String>, val item: JsonObject) {
    public val ok: Boolean get() = errors.isEmpty()
}

/* ---------------------------------------------------------------- json helpers */

private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.let { if (it.isString) it.content else it.content }
private fun JsonElement?.text(max: Int): String = when (this) { null, JsonNull -> ""; is JsonPrimitive -> content.take(max); else -> toString().take(max) }
private fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.let { it.doubleOrNull ?: it.content.toDoubleOrNull() }
private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonElement?.isBlankish(): Boolean = this == null || this is JsonNull || ((this as? JsonPrimitive)?.content == "")
private fun jsonStr(s: String): JsonPrimitive = JsonPrimitive(s)
private fun jsonList(xs: List<String>): JsonArray = JsonArray(xs.map { JsonPrimitive(it) })

public object AgentJson {
    /** A newline-separated string or an array becomes a trimmed, non-empty list (capped). */
    public fun toLines(v: JsonElement?, maxItems: Int = AgentLimits.LIST_ITEMS, maxLen: Int = AgentLimits.LIST_ITEM): List<String> {
        val raw: List<String> = when (v) {
            is JsonPrimitive -> if (v.isString) v.content.split("\n") else listOf(v.content)
            is JsonArray -> v.map { e -> when (e) { is JsonPrimitive -> e.content; JsonNull -> ""; else -> e.toString() } }
            else -> emptyList()
        }
        return raw.map { it.trim() }.filter { it.isNotEmpty() }.take(maxItems).map { it.take(maxLen) }
    }

    public fun voice(v: JsonElement?): AgentVoice {
        val o = v.obj() ?: return AgentVoice()
        return AgentVoice(o["provider"].text(AgentLimits.VOICE), o["voiceId"].text(AgentLimits.VOICE), o["hint"].text(AgentLimits.VOICE))
    }

    public fun voiceJson(v: AgentVoice): JsonObject = JsonObject(mapOf("provider" to jsonStr(v.provider), "voiceId" to jsonStr(v.voiceId), "hint" to jsonStr(v.hint)))

    public fun tags(v: JsonElement?): List<String>? {
        if (v == null) return null
        val src: JsonElement = if (v is JsonPrimitive && v.isString) JsonArray(v.content.split(",").map { JsonPrimitive(it) }) else if (v is JsonArray) v else JsonArray(emptyList())
        return toLines(src, AgentLimits.TAGS, AgentLimits.TAG)
    }
}

/* ---------------------------------------------------------------- validation */

public object AgentValidator {
    private val SECRET_HEADER = Regex("(?:bearer\\s+\\S{12,}|sk-|key)", RegexOption.IGNORE_CASE)
    private val URL = Regex("^https?://")
    private val SKIP = setOf("createdAt", "updatedAt", "origin")

    private fun refs(ctx: AgentContext, coll: String, ids: JsonElement?, self: String, warnings: MutableList<String>, what: String): List<String> {
        val out = mutableListOf<String>()
        for (raw in AgentJson.toLines(ids)) {
            if (raw == self) continue
            if (!ctx.has(coll, raw)) { warnings += "dropped unknown $what $raw"; continue }
            if (raw !in out) out += raw
        }
        return out
    }

    /** Same checks, messages and normalisation as `validateAgentItem` in core/agents.ts. */
    public fun validate(collection: String, raw: JsonElement?, ctx: AgentContext = AgentContext()): AgentValidation {
        val errors = mutableListOf<String>()
        val warnings = mutableListOf<String>()
        val src = raw.obj() ?: return AgentValidation(listOf("an item must be a JSON object"), warnings, JsonObject(emptyMap()))
        if (collection !in AgentVocab.COLLECTIONS) return AgentValidation(listOf("no collection $collection"), warnings, JsonObject(emptyMap()))
        val item = LinkedHashMap<String, JsonElement>()
        for ((k, v) in src) if (k !in SKIP) item[k] = v
        val idRaw = item["id"]
        if (idRaw != null && !idRaw.isBlankish()) {
            val id = idRaw.text(Int.MAX_VALUE).trim()
            if (!AgentVocab.ID.matches(id)) errors += "ids are lowercase letters, digits, dots, dashes and underscores (1–64 characters)"
            item["id"] = jsonStr(id)
        } else item.remove("id")
        val self = item["id"].str() ?: ""
        if (collection != "training") {
            val name = item["name"].text(AgentLimits.NAME + 1).trim()
            if (name.isEmpty()) errors += "a name is required"
            else if (name.length > AgentLimits.NAME) errors += "name can be at most ${AgentLimits.NAME} characters"
            item["name"] = jsonStr(name)
        }
        if (item.containsKey("description")) item["description"] = jsonStr(item["description"].text(AgentLimits.DESCRIPTION))
        AgentJson.tags(item["tags"])?.let { item["tags"] = jsonList(it) } ?: item.remove("tags")

        when (collection) {
            "agents" -> {
                val m = LinkedHashMap(item["memory"].obj() ?: JsonObject(emptyMap()))
                m["type"]?.str()?.takeIf { it.isNotEmpty() }?.let { if (it !in ctx.memoryTypes) errors += "memory type must be one of ${ctx.memoryTypes.joinToString(", ")}" }
                m["record"]?.str()?.takeIf { it.isNotEmpty() }?.let { if (it !in AgentVocab.MEMORY_RECORD_MODES) errors += "memory record is episodes, facts, both or off" }
                m["scope"]?.let { if (!it.isBlankish() && !AgentVocab.ID.matches(it.text(Int.MAX_VALUE))) errors += "memory scope must look like an id" }
                for (k in listOf("topK", "window", "maxItems", "decayDays")) {
                    val v = m[k]
                    if (v != null && !v.isBlankish()) {
                        val n = v.num()
                        if (n == null || n < 0) errors += "memory $k must be a number" else m[k] = JsonPrimitive(floor(n).toLong())
                    } else m.remove(k)
                }
                item["memory"] = JsonObject(m)
                item["skillIds"] = jsonList(refs(ctx, "skills", item["skillIds"], "", warnings, "skill"))
                item["lingoIds"] = jsonList(refs(ctx, "lingo", item["lingoIds"], "", warnings, "lingo pack"))
                item["toolIds"] = jsonList(refs(ctx, "tools", item["toolIds"], "", warnings, "tool"))
                item["delegates"] = jsonList(refs(ctx, "agents", item["delegates"], self, warnings, "delegate"))
                val persona = item["personaId"].text(AgentLimits.NAME)
                if (persona.isNotEmpty() && !ctx.has("personas", persona)) { warnings += "dropped unknown persona $persona"; item["personaId"] = jsonStr("") } else item["personaId"] = jsonStr(persona)
                item["instructions"]?.let { val s = it.text(Int.MAX_VALUE); item["instructions"] = jsonStr(s); if (s.length > AgentLimits.INSTRUCTIONS) errors += "instructions can be at most ${AgentLimits.INSTRUCTIONS} characters" }
                item["enabled"]?.let { item["enabled"] = JsonPrimitive((it as? JsonPrimitive)?.booleanOrNull != false) }
                item["voice"]?.let { v -> if (v !is JsonNull) { if (v !is JsonObject) errors += "voice is an object {provider, voiceId, hint} or null" else item["voice"] = AgentJson.voiceJson(AgentJson.voice(v)) } }
                item["model"]?.let { mv ->
                    val mo = mv.obj()
                    if (mo == null) errors += "model is an object {profile, model, temperature, max_tokens}"
                    else {
                        val out = LinkedHashMap<String, JsonElement>()
                        mo["profile"]?.takeIf { !it.isBlankish() }?.let { out["profile"] = jsonStr(it.text(AgentLimits.NAME)) }
                        mo["model"]?.takeIf { !it.isBlankish() }?.let { out["model"] = jsonStr(it.text(AgentLimits.NAME)) }
                        mo["temperature"]?.takeIf { !it.isBlankish() }?.let { val t = it.num(); if (t == null || t < 0 || t > 2) errors += "temperature is between 0 and 2" else out["temperature"] = JsonPrimitive(t) }
                        mo["max_tokens"]?.takeIf { !it.isBlankish() }?.let { val n = it.num(); if (n == null || n < 1) errors += "max_tokens is a positive number" else out["max_tokens"] = JsonPrimitive(floor(n).toLong()) }
                        item["model"] = JsonObject(out)
                    }
                }
            }
            "personas" -> {
                for (k in listOf("role", "voice", "tone")) item[k]?.let { item[k] = jsonStr(it.text(AgentLimits.DESCRIPTION)) }
                item["traits"] = jsonList(AgentJson.toLines(item["traits"])); item["rules"] = jsonList(AgentJson.toLines(item["rules"]))
                item["samples"] = jsonList(AgentJson.toLines(item["samples"], AgentLimits.SAMPLES, AgentLimits.EXAMPLE))
                item["voiceSlot"]?.let { v -> if (v !is JsonNull) { if (v !is JsonObject) errors += "voiceSlot is an object {provider, voiceId, hint} or null" else item["voiceSlot"] = AgentJson.voiceJson(AgentJson.voice(v)) } }
            }
            "skills" -> {
                item["instructions"]?.let { val s = it.text(Int.MAX_VALUE); item["instructions"] = jsonStr(s); if (s.length > AgentLimits.INSTRUCTIONS) errors += "instructions can be at most ${AgentLimits.INSTRUCTIONS} characters" }
                item["triggers"] = jsonList(AgentJson.toLines(item["triggers"]))
                val ex = (item["examples"] as? JsonArray)?.filterIsInstance<JsonObject>()?.take(AgentLimits.EXAMPLES) ?: emptyList()
                item["examples"] = JsonArray(ex.map { JsonObject(mapOf("input" to jsonStr(it["input"].text(AgentLimits.EXAMPLE)), "output" to jsonStr(it["output"].text(AgentLimits.EXAMPLE)))) })
                item["toolIds"] = jsonList(refs(ctx, "tools", item["toolIds"], "", warnings, "tool"))
            }
            "lingo" -> {
                item["style"]?.let { item["style"] = jsonStr(it.text(AgentLimits.DESCRIPTION)) }
                val g = (item["glossary"] as? JsonArray)?.filterIsInstance<JsonObject>()?.take(AgentLimits.GLOSSARY) ?: emptyList()
                item["glossary"] = JsonArray(g.map { GlossaryEntry(it["term"].text(AgentLimits.LIST_ITEM), it["meaning"].text(AgentLimits.LIST_ITEM)) }.filter { it.term.isNotEmpty() }
                    .map { JsonObject(mapOf("term" to jsonStr(it.term), "meaning" to jsonStr(it.meaning))) })
                item["phrases"] = jsonList(AgentJson.toLines(item["phrases"])); item["avoid"] = jsonList(AgentJson.toLines(item["avoid"]))
            }
            "tools" -> {
                val name = item["name"].str() ?: ""
                if (!AgentVocab.TOOL_NAME.matches(name)) errors += "tool name must be a function name: letters, digits, underscores (e.g. get_weather)"
                val kind = item["kind"].str()?.takeIf { it.isNotEmpty() } ?: "builtin"
                if (kind !in ctx.toolKinds) errors += "tool kind must be one of ${ctx.toolKinds.joinToString(", ")}"
                val cfg = LinkedHashMap(item["config"].obj() ?: JsonObject(emptyMap()))
                var params: JsonElement? = item["parameters"]
                if (kind == "builtin") {
                    val b = cfg["builtin"].str() ?: ""
                    val builtins = ctx.builtins
                    if (builtins != null && b !in builtins) errors += "unknown builtin; choose one of ${builtins.keys.joinToString(", ")}"
                    else if (b.isEmpty()) errors += "builtin tools name which builtin they run"
                    val spec = builtins?.get(b)
                    if ((params == null || params is JsonNull) && spec != null) params = spec.second
                    if (item["description"].isBlankish() && spec != null && spec.first.isNotEmpty()) item["description"] = jsonStr(spec.first)
                }
                if (kind == "http") {
                    if (!URL.containsMatchIn(cfg["url"].str() ?: "")) errors += "http tools need a URL starting with http:// or https://"
                    val method = (cfg["method"].str()?.takeIf { it.isNotEmpty() } ?: "GET").uppercase()
                    if (method !in AgentVocab.HTTP_METHODS) errors += "unsupported method" else cfg["method"] = jsonStr(method)
                    for ((k, v) in cfg["headers"].obj() ?: JsonObject(emptyMap())) {
                        val s = (v as? JsonPrimitive)?.takeIf { it.isString }?.content
                        if (s == null) { errors += "header values must be strings (use env:VAR for secrets)"; continue }
                        if (!s.startsWith("env:") && SECRET_HEADER.containsMatchIn(s) && k.lowercase() in listOf("authorization", "x-api-key", "api-key")) errors += "put secrets in an environment variable: set header $k to env:MY_VAR"
                    }
                }
                if (kind == "mcp" && (!URL.containsMatchIn(cfg["url"].str() ?: "") || cfg["tool"].isBlankish())) errors += "mcp tools need a server URL and the remote tool name"
                if (kind == "prompt" && (cfg["template"].str() ?: "").isBlank()) errors += "prompt tools need a template"
                if (kind == "agent") { val a = cfg["agentId"]; if (a.isBlankish()) errors += "agent tools need the agent to delegate to" else if (!ctx.has("agents", a.text(Int.MAX_VALUE))) errors += "unknown agent ${a.text(Int.MAX_VALUE)}" }
                if (kind == "workflow") { val w = cfg["workflowId"]; if (w.isBlankish()) errors += "workflow tools need a workflow" else if (!ctx.has("workflows", w.text(Int.MAX_VALUE))) errors += "unknown workflow ${w.text(Int.MAX_VALUE)}" }
                if (params == null || params is JsonNull) params = JsonObject(mapOf("type" to jsonStr("object"), "properties" to JsonObject(emptyMap())))
                if (params !is JsonObject || params["type"].str() != "object") errors += "parameters must be a JSON Schema object ({type: object, properties: {...}})"
                item["name"] = jsonStr(name); item["kind"] = jsonStr(kind); item["config"] = JsonObject(cfg); item["parameters"] = params
                item["description"] = jsonStr(item["description"].text(AgentLimits.DESCRIPTION))
                item["dangerous"] = JsonPrimitive((item["dangerous"] as? JsonPrimitive)?.booleanOrNull == true)
                item["enabled"]?.let { item["enabled"] = JsonPrimitive((it as? JsonPrimitive)?.booleanOrNull != false) }
            }
            "workflows" -> {
                val mode = item["mode"].str()?.takeIf { it.isNotEmpty() } ?: "sequential"
                if (mode !in AgentVocab.WORKFLOW_MODES) errors += "mode is sequential, parallel, router or critic"
                item["mode"] = jsonStr(mode)
                val steps = (item["steps"] as? JsonArray)?.filterIsInstance<JsonObject>()?.take(AgentLimits.STEPS) ?: emptyList()
                val outSteps = steps.mapIndexed { i, s ->
                    val sid = (s["id"].str()?.takeIf { it.isNotEmpty() } ?: "s${i + 1}").replace(Regex("[^a-zA-Z0-9_-]"), "").take(40).ifEmpty { "s${i + 1}" }
                    val agentId = s["agentId"].str() ?: ""
                    if (agentId.isEmpty() || !ctx.has("agents", agentId)) errors += "step $sid: unknown agent $agentId"
                    val o = LinkedHashMap<String, JsonElement>(); o["id"] = jsonStr(sid); o["agentId"] = jsonStr(agentId)
                    s["prompt"]?.let { o["prompt"] = jsonStr(it.text(AgentLimits.INSTRUCTIONS)) }
                    s["label"]?.let { o["label"] = jsonStr(it.text(AgentLimits.NAME)) }
                    s["when"]?.let { o["when"] = jsonStr(it.text(AgentLimits.DESCRIPTION)) }
                    s["memory"]?.let { o["memory"] = JsonPrimitive((it as? JsonPrimitive)?.booleanOrNull != false) }
                    JsonObject(o)
                }
                item["steps"] = JsonArray(outSteps)
                val ids = outSteps.map { it["id"].str() }
                if (ids.toSet().size != ids.size) errors += "step ids must be unique"
                if (mode == "router") { val r = item["routerAgentId"]; if (r.isBlankish()) errors += "router workflows need a router agent" else if (!ctx.has("agents", r.text(Int.MAX_VALUE))) errors += "unknown router agent ${r.text(Int.MAX_VALUE)}" }
                if (mode == "parallel") { val s = item["synthAgentId"]; if (!s.isBlankish() && !ctx.has("agents", s.text(Int.MAX_VALUE))) errors += "unknown merge agent ${s.text(Int.MAX_VALUE)}" }
                if (mode == "critic" && outSteps.size < 2) errors += "critic workflows need a writer step and a reviewer step"
                val ml = item["maxLoops"]
                if (ml != null && !ml.isBlankish()) { val n = ml.num(); if (n == null || n < 1) errors += "maxLoops is a positive number" else item["maxLoops"] = JsonPrimitive(min(floor(n).toLong(), AgentLimits.WORKFLOW_LOOPS.toLong())) } else item.remove("maxLoops")
            }
            "training" -> {
                val agentId = item["agentId"].str() ?: ""
                if (agentId.isEmpty()) errors += "a training job trains one agent: choose it" else if (!ctx.has("agents", agentId)) errors += "unknown agent $agentId"
                item["agentId"] = jsonStr(agentId)
                item["name"]?.let { item["name"] = jsonStr(it.text(AgentLimits.NAME)) }
                val srcs = (item["sources"] as? JsonArray)?.filterIsInstance<JsonObject>()?.take(AgentLimits.SOURCES) ?: emptyList()
                if (srcs.isEmpty()) errors += "add at least one source"
                item["sources"] = JsonArray(srcs.map { s ->
                    val t = s["type"].str() ?: ""
                    val o = LinkedHashMap(s); o["type"] = jsonStr(t)
                    if (t !in ctx.sourceTypes) { errors += "unknown source type $t"; return@map JsonObject(o) }
                    if (t in listOf("firecrawl-scrape", "firecrawl-crawl", "url", "mcp-resource", "mcp-tool") && !URL.containsMatchIn(s["url"].str() ?: "")) errors += "$t sources need a URL starting with http:// or https://"
                    if (t == "firecrawl-search" && (s["query"].str() ?: "").isBlank()) errors += "firecrawl-search sources need a query"
                    if (t == "repo") { val p = AgentJson.toLines(s["paths"]); o["paths"] = jsonList(p); if (p.isEmpty()) errors += "repo sources need at least one file glob" }
                    if (t == "text" && (s["text"].str() ?: "").isBlank()) errors += "text sources need text"
                    if (t == "mcp-resource" && s["uri"].isBlankish()) errors += "mcp-resource sources need the resource uri"
                    if (t == "mcp-tool" && s["tool"].isBlankish()) errors += "mcp-tool sources need the tool name"
                    s["tokenEnv"]?.let { o["tokenEnv"] = jsonStr(it.text(AgentLimits.NAME)) }
                    s["include"]?.let { o["include"] = jsonList(AgentJson.toLines(it)) }
                    JsonObject(o)
                })
                val sched = item["schedule"].str()?.takeIf { it.isNotEmpty() } ?: "manual"
                if (sched !in AgentVocab.TRAINING_SCHEDULES) errors += "schedule is manual, hourly, daily or weekly"
                item["schedule"] = jsonStr(sched)
                val cs = item["chunkSize"].num() ?: TrainingDefaults.CHUNK_SIZE.toDouble()
                item["chunkSize"] = JsonPrimitive(max(TrainingDefaults.CHUNK_MIN, min(if (cs > 0) floor(cs).toInt() else TrainingDefaults.CHUNK_SIZE, TrainingDefaults.CHUNK_MAX)))
                val ov = item["overlap"].num() ?: TrainingDefaults.OVERLAP.toDouble()
                item["overlap"] = JsonPrimitive(max(0, min(if (ov >= 0) floor(ov).toInt() else TrainingDefaults.OVERLAP, TrainingDefaults.OVERLAP_MAX)))
                item["replace"] = JsonPrimitive((item["replace"] as? JsonPrimitive)?.booleanOrNull != false)
                item["autoRun"]?.let { item["autoRun"] = JsonPrimitive((it as? JsonPrimitive)?.booleanOrNull == true) }
            }
        }
        return AgentValidation(errors, warnings, JsonObject(item))
    }

    public fun validateAddon(raw: JsonElement?): Pair<List<String>, JsonObject?> {
        val errors = mutableListOf<String>()
        val o = raw.obj() ?: return listOf("an add-on must be a JSON object") to null
        if (o["\$axf"].str() != AGENT_ADDON_TAG) errors += "not an agent add-on (expected \"\$axf\": \"$AGENT_ADDON_TAG\")"
        if (!AgentVocab.ADDON_ID.matches(o["id"].str() ?: "")) errors += "add-on id must be lowercase letters, digits and dashes (2–48 characters)"
        val provides = o["provides"].obj()
        if (provides == null) errors += "add-on has nothing in provides"
        else for ((k, v) in provides) {
            if (k == "memory") { if (v !is JsonObject) errors += "provides.memory maps agent ids to lists of items"; continue }
            if (k !in AgentVocab.ADDON_SECTIONS) errors += "unknown section provides.$k"
            else if (v !is JsonArray) errors += "provides.$k must be a list"
            else for (it in v) if (it !is JsonObject || !AgentVocab.ID.matches(it["id"].str() ?: "")) errors += "every item in provides.$k needs a valid id"
        }
        return errors to (if (errors.isEmpty()) o else null)
    }
}

/* ---------------------------------------------------------------- memory config + text engine */

public object AgentMemory {
    public fun resolve(agentId: String?, m: AgentMemoryConfig?, defaults: ResolvedMemory? = null): ResolvedMemory {
        val d = defaults ?: ResolvedMemory(MemoryDefaults.TYPE, "", MemoryDefaults.TOP_K, MemoryDefaults.WINDOW, MemoryDefaults.MAX_ITEMS, MemoryDefaults.RECORD, MemoryDefaults.DECAY_DAYS, "", MemoryDefaults.MIN_SCORE)
        val c = m ?: AgentMemoryConfig()
        fun num(v: Int?, fb: Int) = if (v == null || v <= 0) fb else v
        return ResolvedMemory(
            type = c.type?.takeIf { it.isNotEmpty() } ?: d.type, scope = c.scope?.takeIf { it.isNotEmpty() } ?: agentId ?: "",
            topK = num(c.topK, d.topK), window = num(c.window, d.window), maxItems = num(c.maxItems, d.maxItems), record = c.record?.takeIf { it.isNotEmpty() } ?: d.record,
            decayDays = if ((c.decayDays ?: 0) > 0) c.decayDays!! else d.decayDays, embedProfile = c.embedProfile ?: "", minScore = if ((c.minScore ?: 0.0) > 0) c.minScore!! else d.minScore,
        )
    }

    private val WORD = Regex("[a-z0-9][a-z0-9_.+#-]*")
    private val STOP: Set<String> = "a an the and or but if then else of to in on at for with by from is are was were be been being it its this that these those i you he she we they me my your our their as not no do does did have has had can could will would should may might just so than too very what which who whom how when where why all any some such own same other into over under again further once here there about out up down off".split(" ").toSet()

    /** Lower-case word tokens without stop words or single characters (same on every port). */
    public fun tokens(text: String): List<String> = WORD.findAll(text.lowercase()).map { it.value }.filter { it !in STOP && it.length > 1 }.toList()

    /** BM25 ranking: (score rounded to 6 decimals, index) pairs, best first, zero scores dropped. */
    public fun bm25(query: String, docs: List<Pair<String, List<String>>>, k1: Double = 1.4, b: Double = 0.75): List<Pair<Double, Int>> {
        val q = tokens(query)
        if (q.isEmpty() || docs.isEmpty()) return emptyList()
        val toks = docs.map { (text, tags) -> tokens("$text ${tags.joinToString(" ")}") }
        val avg = toks.sumOf { it.size }.toDouble() / max(1, toks.size)
        val df = HashMap<String, Int>()
        for (t in toks) for (w in t.toSet()) df[w] = (df[w] ?: 0) + 1
        val n = docs.size
        val out = mutableListOf<Pair<Double, Int>>()
        toks.forEachIndexed { i, t ->
            val tf = HashMap<String, Int>()
            for (w in t) tf[w] = (tf[w] ?: 0) + 1
            var s = 0.0
            for (w in q) {
                val f = tf[w] ?: continue
                val d = df[w] ?: 0
                val idf = ln(1 + (n - d + 0.5) / (d + 0.5))
                s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * t.size / max(1.0, avg)))
            }
            if (s > 0) out += ((s * 1e6).roundToLong() / 1e6) to i
        }
        return out.sortedWith(compareByDescending<Pair<Double, Int>> { it.first }.thenBy { it.second })
    }

    /** Split on headings/paragraphs into ~size-character chunks with a little overlap. */
    public fun chunk(text: String, size: Int = TrainingDefaults.CHUNK_SIZE, overlap: Int = TrainingDefaults.OVERLAP): List<String> {
        val t = text.trim().replace(Regex("\n{3,}"), "\n\n")
        if (t.length <= size) return if (t.isEmpty()) emptyList() else listOf(t)
        val paras = t.split(Regex("\n(?=#{1,6} )|\n\n"))
        val out = mutableListOf<String>()
        var cur = ""
        for (p0 in paras) {
            var p = p0
            if (cur.length + p.length + 2 <= size) { cur = if (cur.isEmpty()) p else "$cur\n\n$p"; continue }
            if (cur.isNotEmpty()) out += cur
            while (p.length > size) { out += p.substring(0, size); p = p.substring(size - overlap) }
            cur = (if (out.isNotEmpty() && overlap > 0) out.last().takeLast(overlap) + "\n" else "") + p
        }
        if (cur.isNotBlank()) out += cur
        return out
    }

    /** Which items to forget first when a store is over `maxItems`: episodes, then the least used, then the oldest. */
    public fun trim(items: List<MemoryItem>, maxItems: Int): List<MemoryItem> {
        if (items.size <= maxItems) return items
        val sorted = items.sortedWith(compareBy<MemoryItem> { if (it.kind != "episode") 1 else 0 }.thenBy { it.hits }.thenBy { it.createdAt })
        return sorted.drop(sorted.size - maxItems)
    }
}

/* ---------------------------------------------------------------- system prompt + workflows */

public data class ComposeInput(
    val agentId: String, val name: String? = null, val description: String? = null, val instructions: String? = null,
    val persona: PersonaDef? = null, val skills: List<SkillDef> = emptyList(), val lingo: List<LingoDef> = emptyList(),
    val extras: List<String> = emptyList(), val memory: Boolean = false, val tools: List<String> = emptyList(),
)

public object AgentPrompts {
    /** The system prompt every port builds for an agent, section by section (= `composeSystemPrompt`). */
    public fun compose(input: ComposeInput): String {
        val parts = mutableListOf("You are ${input.name?.takeIf { it.isNotEmpty() } ?: input.agentId}." + (input.description?.takeIf { it.isNotEmpty() }?.let { " $it" } ?: ""))
        input.persona?.let { p ->
            val bits = mutableListOf(p.role?.takeIf { it.isNotEmpty() }?.let { "Role: $it" } ?: "", p.voice?.takeIf { it.isNotEmpty() }?.let { "Voice: $it" } ?: "", p.tone?.takeIf { it.isNotEmpty() }?.let { "Tone: $it" } ?: "")
            if (p.traits.isNotEmpty()) bits += "Traits: " + p.traits.joinToString(", ")
            var txt = "## Persona\n" + bits.filter { it.isNotEmpty() }.joinToString("\n")
            if (p.rules.isNotEmpty()) txt += "\nRules:\n" + p.rules.joinToString("\n") { "- $it" }
            if (p.samples.isNotEmpty()) txt += "\nSample replies (match this way of talking, not their content):\n" + p.samples.take(5).joinToString("\n") { "- $it" }
            parts += txt
        }
        if (input.skills.isNotEmpty()) {
            var txt = "## Skills"
            for (s in input.skills) {
                txt += "\n\n### ${s.name}\n${(s.instructions ?: "").trim()}"
                if (s.triggers.isNotEmpty()) txt += "\nUse when: ${s.triggers.joinToString(", ")}"
                for (ex in s.examples.take(3)) if (ex.input.isNotEmpty()) txt += "\nExample — input: ${ex.input.take(400)}\n          output: ${ex.output.take(600)}"
            }
            parts += txt
        }
        if (input.lingo.isNotEmpty()) {
            var txt = "## Lingo"
            for (l in input.lingo) {
                l.style?.takeIf { it.isNotEmpty() }?.let { txt += "\nStyle: $it" }
                if (l.glossary.isNotEmpty()) txt += "\nGlossary (use these terms exactly):\n" + l.glossary.take(80).joinToString("\n") { "- ${it.term}: ${it.meaning}" }
                if (l.phrases.isNotEmpty()) txt += "\nPreferred phrasing: " + l.phrases.take(30).joinToString("; ")
                if (l.avoid.isNotEmpty()) txt += "\nAvoid: " + l.avoid.take(30).joinToString("; ")
            }
            parts += txt
        }
        input.instructions?.trim()?.takeIf { it.isNotEmpty() }?.let { parts += "## Instructions\n$it" }
        for (e in input.extras) if (e.isNotBlank()) parts += e.trim()
        if (input.memory) parts += AgentVocab.MEMORY_SECTION
        if (input.tools.isNotEmpty()) parts += AgentVocab.TOOLS_SECTION_PREFIX + input.tools.joinToString(", ")
        return parts.joinToString("\n\n")
    }

    private val STEP_REF = Regex("\\{\\{\\s*steps\\.([a-zA-Z0-9_-]+)\\s*\\}\\}")
    private val ARG_REF = Regex("\\{\\{\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\}\\}")
    private val JSON_BLOB = Regex("\\{[\\s\\S]*\\}")

    /** Fill `{{input}}`, `{{previous}}` and `{{steps.<id>}}` in a step prompt. */
    public fun fillWorkflow(tpl: String, input: String, steps: Map<String, String>, previous: String): String =
        STEP_REF.replace(tpl.replace("{{input}}", input).replace("{{previous}}", previous)) { steps[it.groupValues[1]] ?: "" }

    /** The step ids a router agent picked (`{"steps": [...]}` anywhere in its reply), limited to real steps. */
    public fun parseRouterPick(reply: String, stepIds: List<String>): List<String> {
        val m = JSON_BLOB.find(reply) ?: return emptyList()
        val j = runCatching { ai.amberx.axf.kernel.asset.AxfJson.parseToJsonElement(m.value) as? JsonObject }.getOrNull() ?: return emptyList()
        val picked = (j["steps"] as? JsonArray)?.map { (it as? JsonPrimitive)?.content ?: it.toString() } ?: return emptyList()
        return stepIds.filter { it in picked }
    }

    /** Fill a tool template `{{arg}}` from arguments; non-strings are JSON, URL mode percent-encodes. */
    public fun fillTool(template: String, args: Map<String, JsonElement>, url: Boolean = false): String = ARG_REF.replace(template) { m ->
        val v = args[m.groupValues[1]]
        val s = when (v) { null, JsonNull -> ""; is JsonPrimitive -> if (v.isString) v.content else v.toString(); else -> v.toString() }
        if (url) encode(s) else s
    }

    /** encodeURIComponent: everything but A–Z a–z 0–9 - _ . ! ~ * ' ( ) is percent-encoded as UTF-8. */
    private fun encode(s: String): String {
        val keep = "-_.!~*'()"
        val sb = StringBuilder()
        for (b in s.encodeToByteArray()) {
            val c = b.toInt() and 0xff
            val ch = c.toChar()
            if ((ch in 'A'..'Z') || (ch in 'a'..'z') || (ch in '0'..'9') || ch in keep) sb.append(ch) else sb.append('%').append(c.toString(16).uppercase().padStart(2, '0'))
        }
        return sb.toString()
    }
}

/* ---------------------------------------------------------------- add-on risks */

public object AddonRisks {
    /** What a tool record could do with the host's secrets or private network. */
    public fun tool(tool: JsonObject, label: String = ""): List<String> {
        val out = mutableListOf<String>()
        val cfg = tool["config"].obj() ?: JsonObject(emptyMap())
        val who = if (label.isEmpty()) "" else "$label: "
        for ((k, v) in cfg["headers"].obj() ?: JsonObject(emptyMap())) { val s = (v as? JsonPrimitive)?.takeIf { it.isString }?.content; if (s != null && s.startsWith("env:")) out += "${who}header $k reads environment variable ${s.substring(4)}" }
        if ((cfg["allowPrivate"] as? JsonPrimitive)?.booleanOrNull == true) out += "${who}may call private/internal addresses"
        cfg["tokenEnv"]?.takeIf { !it.isBlankish() }?.let { out += "${who}sends environment variable ${it.text(Int.MAX_VALUE)} to ${cfg["url"]?.text(Int.MAX_VALUE) ?: "its server"}" }
        return out
    }

    public fun addon(bundle: JsonObject): List<String> {
        val out = mutableListOf<String>()
        val provides = bundle["provides"].obj() ?: return out
        for (t in (provides["tools"] as? JsonArray)?.filterIsInstance<JsonObject>() ?: emptyList()) out += tool(t, "tool ${(t["name"] ?: t["id"]).text(Int.MAX_VALUE)}")
        for (j in (provides["training"] as? JsonArray)?.filterIsInstance<JsonObject>() ?: emptyList())
            for (s in (j["sources"] as? JsonArray)?.filterIsInstance<JsonObject>() ?: emptyList())
                s["tokenEnv"]?.takeIf { !it.isBlankish() }?.let { out += "training ${j["id"].text(Int.MAX_VALUE)}: sends environment variable ${it.text(Int.MAX_VALUE)} to ${s["url"].text(Int.MAX_VALUE)}" }
        return out
    }

    /** The same tool without env-var headers, private access and MCP tokens (what an untrusted import keeps). */
    public fun stripTool(tool: JsonObject): JsonObject {
        val cfg = LinkedHashMap(tool["config"].obj() ?: JsonObject(emptyMap()))
        cfg["headers"] = JsonObject((cfg["headers"].obj() ?: JsonObject(emptyMap())).filterNot { (_, v) -> (v as? JsonPrimitive)?.let { it.isString && it.content.startsWith("env:") } == true })
        cfg.remove("allowPrivate"); cfg.remove("tokenEnv")
        return JsonObject(LinkedHashMap(tool).also { it["config"] = JsonObject(cfg) })
    }

    public fun stripAddon(bundle: JsonObject): JsonObject {
        val provides = LinkedHashMap(bundle["provides"].obj() ?: JsonObject(emptyMap()))
        provides["tools"] = JsonArray(((provides["tools"] as? JsonArray)?.filterIsInstance<JsonObject>() ?: emptyList()).map { stripTool(it) })
        provides["training"]?.let { tr ->
            provides["training"] = JsonArray((tr as? JsonArray)?.map { j ->
                val jo = j as? JsonObject ?: return@map j
                val srcs = (jo["sources"] as? JsonArray)?.map { s -> (s as? JsonObject)?.let { so -> JsonObject(so.filterKeys { it != "tokenEnv" }) } ?: s }
                JsonObject(LinkedHashMap(jo).also { m -> if (srcs != null) m["sources"] = JsonArray(srcs) })
            } ?: emptyList())
        }
        return JsonObject(LinkedHashMap(bundle).also { it["provides"] = JsonObject(provides) })
    }
}

/* ---------------------------------------------------------------- runtime contract (hosts implement it) */

public data class AgentSummary(val id: String, val name: String, val icon: String = "user", val description: String = "", val origin: String = "user", val dangerous: Boolean = false)
public data class ToolSpec(val name: String, val description: String, val parameters: JsonObject)
public data class WriteMode(val containers: List<String>, val snapshots: Boolean)
public data class ResolvedAgent(
    val id: String, val name: String?, val icon: String, val description: String, val systemPrompt: String, val model: AgentModel,
    val tools: List<ToolSpec>, val memoryType: String, val voice: AgentVoice? = null, val writeMode: WriteMode? = null,
)

/** Capability `axf.agents`: what a chat host needs from an agent runtime (the console's `axf.agents@1` service has the same methods). */
public interface AgentRuntime {
    public suspend fun listAgents(): AxfResult<List<AgentSummary>>
    public suspend fun getAgent(id: String): AxfResult<ResolvedAgent?>
    public suspend fun memoryContext(id: String, query: String): AxfResult<String>
    public suspend fun runTool(id: String, name: String, args: JsonObject, ctx: Map<String, Any?> = emptyMap()): AxfResult<String>
    public suspend fun recordTurn(id: String, userText: String, reply: String, meta: Map<String, String> = emptyMap()): AxfResult<Unit>
}

/** Kernel default until a module provides agents: lists nothing, never pretends to run anything. */
public object PlaceholderAgentRuntime : AgentRuntime {
    override suspend fun listAgents(): AxfResult<List<AgentSummary>> = AxfResult.ok(emptyList())
    override suspend fun getAgent(id: String): AxfResult<ResolvedAgent?> = AxfResult.ok(null)
    override suspend fun memoryContext(id: String, query: String): AxfResult<String> = AxfResult.ok("")
    override suspend fun runTool(id: String, name: String, args: JsonObject, ctx: Map<String, Any?>): AxfResult<String> = AxfResult.err(AxfFailure.NotImplemented(AGENTS_CAPABILITY))
    override suspend fun recordTurn(id: String, userText: String, reply: String, meta: Map<String, String>): AxfResult<Unit> = AxfResult.ok(Unit)
}
