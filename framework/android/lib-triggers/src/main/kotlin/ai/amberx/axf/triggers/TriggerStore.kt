package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.triggers.Thresholds
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerJson
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.kernel.triggers.TriggerSource
import ai.amberx.axf.kernel.triggers.TriggerValidation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * lib-triggers storage (trigger-store@1). Built ON the kernel's triggers@1 contract: [Trigger], [TriggerValidation],
 * [TriggerRegistry] are the kernel's; this file only adds persistence and the permanent/custom merge.
 *
 *  - PERMANENT triggers come from modules at runtime (never stored). The user can override `enabled` (only where the
 *    module allows it), `threshold` and `worksIn`; those overrides are stored by trigger id.
 *  - CUSTOM triggers are made by the user and stored whole (validated through TriggerValidation).
 * Everything lives in one JSON value in the kernel KeyValueStore under [TriggerStore.KEY].
 */

/** A user's change to one trigger. Null fields mean "keep the trigger's own value". */
public data class TriggerOverride(
    val enabled: Boolean? = null,
    val threshold: Double? = null,
    val worksIn: List<String>? = null,
) {
    public val isEmpty: Boolean get() = enabled == null && threshold == null && worksIn == null

    public fun toJson(): JsonObject = JsonObject(buildMap {
        if (enabled != null) put("enabled", JsonPrimitive(enabled))
        if (threshold != null) put("threshold", TriggerJson.number(threshold))
        if (worksIn != null) put("worksIn", JsonArray(worksIn.map(::JsonPrimitive)))
    })

    public companion object {
        /** Lenient: unknown or badly typed fields are dropped; a threshold is clamped. */
        public fun parse(o: JsonObject): TriggerOverride = TriggerOverride(
            enabled = TriggerJson.bool(o, "enabled"),
            threshold = TriggerJson.double(o, "threshold")?.let(Thresholds::clamp),
            worksIn = (o["worksIn"] as? JsonArray)?.let { a -> TriggerJson.strings(a).map { it.trim() }.filter { it.isNotEmpty() } },
        )
    }
}

/** What the store persists. */
public data class TriggerStoreData(
    val custom: List<Trigger> = emptyList(),
    val overrides: Map<String, TriggerOverride> = emptyMap(),
)

/** Pure JSON codec for [TriggerStoreData] (`trigger-store@1`). Invalid custom triggers are skipped, never thrown. */
public object TriggerStoreCodec {
    public const val FORMAT: String = "trigger-store@1"
    private val json = Json { ignoreUnknownKeys = true }

    public fun encode(data: TriggerStoreData): String = JsonObject(mapOf(
        "\$axf" to JsonPrimitive(FORMAT),
        "custom" to JsonArray(data.custom.map { it.toJson() }),
        "overrides" to JsonObject(data.overrides.filterValues { !it.isEmpty }.mapValues { it.value.toJson() }),
    )).toString()

    public fun decode(text: String?): TriggerStoreData {
        if (text.isNullOrBlank()) return TriggerStoreData()
        val root = runCatching { json.parseToJsonElement(text) }.getOrNull() as? JsonObject ?: return TriggerStoreData()
        val custom = ((root["custom"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            TriggerValidation.validate(o).trigger?.takeIf { it.source == TriggerSource.CUSTOM }
        }.distinctBy { it.id }
        val overrides = ((root["overrides"] as? JsonObject) ?: JsonObject(emptyMap())).mapNotNull { (id, v) ->
            val o = v as? JsonObject ?: return@mapNotNull null
            TriggerOverride.parse(o).takeIf { !it.isEmpty }?.let { id to it }
        }.toMap()
        return TriggerStoreData(custom, overrides)
    }
}

/** A permanent trigger as a module registered it, plus whether the user may switch it off. */
public data class PermanentTrigger(val trigger: Trigger, val canDisable: Boolean = true)

/** One row of the merged list: the effective trigger plus what the UI needs to know about it. */
public data class StoredTrigger(
    val trigger: Trigger,
    /** true when the user changed a permanent trigger (there is something to reset) */
    val overridden: Boolean = false,
    /** false for permanent triggers the owning module locked on */
    val canDisable: Boolean = true,
) {
    public val id: String get() = trigger.id
    public val permanent: Boolean get() = trigger.source == TriggerSource.PERMANENT
    /** Only custom triggers can be deleted. */
    public val canDelete: Boolean get() = !permanent
}

/** Pure merge rules (unit-tested): permanent first, in registration order, then custom; a custom id that a permanent trigger owns is dropped. */
public object TriggerMerge {
    public fun apply(t: Trigger, o: TriggerOverride?, canDisable: Boolean = true): Trigger {
        if (o == null) return t
        return t.copy(
            enabled = if (o.enabled != null && (canDisable || o.enabled)) o.enabled else t.enabled,
            threshold = o.threshold?.let(Thresholds::clamp) ?: t.threshold,
            worksIn = o.worksIn ?: t.worksIn,
        )
    }

    public fun merge(permanent: List<PermanentTrigger>, data: TriggerStoreData): List<StoredTrigger> {
        val out = ArrayList<StoredTrigger>()
        val seen = HashSet<String>()
        for (p in permanent) {
            if (!seen.add(p.trigger.id)) continue
            val base = p.trigger.copy(source = TriggerSource.PERMANENT)
            val o = data.overrides[base.id]
            val eff = apply(base, o, p.canDisable)
            out += StoredTrigger(eff, overridden = eff != base, canDisable = p.canDisable)
        }
        for (c in data.custom) {
            if (!seen.add(c.id)) continue
            out += StoredTrigger(c.copy(source = TriggerSource.CUSTOM), overridden = false, canDisable = true)
        }
        return out
    }
}

/**
 * The store every trigger screen and host reads. Thread-safe. [list] is the merged, effective list; when a
 * [registry] is given (the kernel's `axf.triggers.registry` service) every change is mirrored into it, module by module.
 */
public class TriggerStore(
    private val kv: KeyValueStore,
    private val registry: TriggerRegistry? = null,
    private val key: String = KEY,
) {
    private val permanent = LinkedHashMap<String, PermanentTrigger>()
    private var data: TriggerStoreData = TriggerStoreCodec.decode(kv.get(key))
    private val _list = MutableStateFlow<List<StoredTrigger>>(emptyList())
    /** Merged list (permanent with overrides, then custom). */
    public val list: StateFlow<List<StoredTrigger>> get() = _list
    private var mirrored: Set<String> = emptySet()

    init { publish() }

    /** Effective triggers (what the matcher runs). */
    public fun triggers(): List<Trigger> = _list.value.map { it.trigger }

    @Synchronized public fun get(id: String): StoredTrigger? = _list.value.firstOrNull { it.id == id }

    @Synchronized public fun data(): TriggerStoreData = data

    /** A module's permanent triggers; upserted by id. [locked] ids can't be switched off by the user. */
    public fun registerPermanent(module: String, triggers: List<Trigger>, locked: Set<String> = emptySet()) {
        synchronized(this) {
            for (t in triggers) permanent[t.id] = PermanentTrigger(t.copy(module = module, source = TriggerSource.PERMANENT), canDisable = t.id !in locked)
        }
        publish()
    }

    /** Removes every permanent trigger of a module (its stored overrides stay, so they come back with it). */
    public fun unregisterPermanent(module: String): Int {
        val n = synchronized(this) { val gone = permanent.values.filter { it.trigger.module == module }.map { it.trigger.id }; gone.forEach { permanent.remove(it) }; gone.size }
        if (n > 0) publish()
        return n
    }

    /** Adds (or replaces, same id) a custom trigger. Source and module are forced to custom / [CUSTOM_MODULE]. */
    public fun saveCustom(t: Trigger): AxfResult<Trigger> {
        val raw = JsonObject(t.toJson() + mapOf("source" to JsonPrimitive(TriggerSource.CUSTOM.id), "module" to JsonPrimitive(CUSTOM_MODULE)))
        val check = TriggerValidation.validate(raw)
        val v = check.trigger ?: return AxfResult.err(AxfFailure.Validation(check.errors))
        synchronized(this) {
            if (permanent.containsKey(v.id)) return AxfResult.err(AxfFailure.Invalid("\"${v.id}\" belongs to a permanent trigger", "id"))
            data = data.copy(custom = data.custom.filter { it.id != v.id } + v)
            persist()
        }
        publish()
        return AxfResult.ok(v)
    }

    /** A free custom id for [label]: `custom.<slug>`, `custom.<slug>-2`, … */
    @Synchronized public fun newCustomId(label: String): String {
        val slug = label.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(32).ifEmpty { "trigger" }
        val base = slug
        val taken = permanent.keys + data.custom.map { it.id }
        var id = "$CUSTOM_MODULE.$base"
        var n = 2
        while (id in taken) id = "$CUSTOM_MODULE.$base-${n++}"
        return id
    }

    /** Deletes a custom trigger. Permanent triggers can't be deleted (false). */
    public fun removeCustom(id: String): Boolean {
        val ok = synchronized(this) {
            if (permanent.containsKey(id) || data.custom.none { it.id == id }) false
            else { data = data.copy(custom = data.custom.filter { it.id != id }, overrides = data.overrides - id); persist(); true }
        }
        if (ok) publish()
        return ok
    }

    public fun setEnabled(id: String, enabled: Boolean): AxfResult<Trigger> = change(id, TriggerOverride(enabled = enabled))
    public fun setThreshold(id: String, threshold: Double): AxfResult<Trigger> = change(id, TriggerOverride(threshold = Thresholds.clamp(threshold)))
    public fun setWorksIn(id: String, worksIn: List<String>): AxfResult<Trigger> = change(id, TriggerOverride(worksIn = worksIn.map { it.trim() }.filter { it.isNotEmpty() }.distinct()))

    /** Drops a permanent trigger's overrides (back to the module's values). */
    public fun reset(id: String): Boolean {
        val ok = synchronized(this) { if (id !in data.overrides) false else { data = data.copy(overrides = data.overrides - id); persist(); true } }
        if (ok) publish()
        return ok
    }

    /** Applies [o]: an override for a permanent trigger, a direct edit for a custom one. */
    public fun change(id: String, o: TriggerOverride): AxfResult<Trigger> {
        val result: AxfResult<Trigger> = synchronized(this) {
            val p = permanent[id]
            if (p != null) {
                if (o.enabled == false && !p.canDisable) return AxfResult.err(AxfFailure.Invalid("\"$id\" can't be switched off", "enabled"))
                val was = data.overrides[id] ?: TriggerOverride()
                val next = TriggerOverride(o.enabled ?: was.enabled, o.threshold ?: was.threshold, o.worksIn ?: was.worksIn)
                // an override equal to the module's own value is dropped, so "reset" isn't offered for nothing
                val t = p.trigger
                val trimmed = TriggerOverride(
                    next.enabled?.takeIf { it != t.enabled },
                    next.threshold?.takeIf { it != t.threshold },
                    next.worksIn?.takeIf { it != t.worksIn },
                )
                data = data.copy(overrides = if (trimmed.isEmpty) data.overrides - id else data.overrides + (id to trimmed))
                persist()
                AxfResult.ok(TriggerMerge.apply(t, trimmed, p.canDisable))
            } else {
                val c = data.custom.firstOrNull { it.id == id } ?: return AxfResult.err(AxfFailure.NotFound("trigger", id))
                val next = TriggerMerge.apply(c, o)
                data = data.copy(custom = data.custom.map { if (it.id == id) next else it })
                persist()
                AxfResult.ok(next)
            }
        }
        publish()
        return result
    }

    private fun persist() { kv.put(key, TriggerStoreCodec.encode(data)) }

    private fun publish() {
        val merged = synchronized(this) { TriggerMerge.merge(permanent.values.toList(), data) }
        _list.value = merged
        mirror(merged)
    }

    /** Keeps the kernel registry in step: each module's effective triggers replace what it had there. */
    private fun mirror(merged: List<StoredTrigger>) {
        val reg = registry ?: return
        val byModule = merged.map { it.trigger }.groupBy { it.module }
        val modules: Set<String>
        synchronized(this) { modules = mirrored + byModule.keys; mirrored = byModule.keys }
        for (m in modules) {
            reg.unregister(m)
            byModule[m]?.let { reg.register(m, it) }
        }
    }

    public companion object {
        /** KV key the store lives under. */
        public const val KEY: String = "axf.triggers.store"
        /** Module (and id namespace) of every custom trigger. */
        public const val CUSTOM_MODULE: String = "custom"
    }
}
