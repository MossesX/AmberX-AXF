package ai.amberx.axf.kernel.plugins

import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.int
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.asset.strOrNull
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * Plugin inventory engine — plugin-inventory@1. The Plugin Manager's model on every port: what each plugin
 * (web console plugin, Android module, library) needs, who provides it, who needs it, and what clashes.
 * Mirrors core/engines/plugins.ts exactly; fixtures: spec/fixtures/plugin-inventory.json (PluginInventoryConformanceTest).
 *
 * Pure: the host gathers facts ([PluginRecord]s) and the engine resolves them. Nothing here reads files or the network.
 * Dependency entries are prefixed by kind (open vocabulary): `service:<capability>`, `plugin:<id>`, anything else is
 * declared but not checked. Other `provides` entries (`view:x`, `settings-tab:x`) are contributions.
 */

public const val PLUGIN_INVENTORY_FRAME: String = "plugin-inventory@1"

public enum class PluginHealth(public val id: String, public val rank: Int) {
    OK("ok", 4), PARTIAL("partial", 2), OFF("off", 3), BLOCKED("blocked", 1), ERROR("error", 0);
    public companion object { public fun parse(s: String?): PluginHealth = entries.firstOrNull { it.id == s } ?: OK }
}

public enum class DependencyKind(public val id: String) { FRAMEWORK("framework"), SERVICE("service"), PLUGIN("plugin"), ENV("env"), SCOPE("scope"), CORE("core"), OTHER("other") }

public enum class DependencyStatus(public val id: String, public val label: String) {
    OK("ok", "satisfied"), MISSING("missing", "missing"), DISABLED("disabled", "provider off"), OPTIONAL_MISSING("optional-missing", "not installed"),
    SET("set", "set"), UNSET("unset", "not set"), GRANTED("granted", "granted"), DECLARED("declared", "declared"),
    UNSUPPORTED("unsupported", "unsupported"), ERROR("error", "error"), NOT_LOADED("not loaded", "not loaded");
    public companion object { public fun parse(s: String?): DependencyStatus? = entries.firstOrNull { it.id == s } }
}

public enum class ConflictSeverity(public val id: String) { INFO("info"), WARN("warn"), ERROR("error") }

public enum class ServerState(public val id: String) { NONE("none"), LOADED("loaded"), ERROR("error"); public companion object { public fun parse(s: String?): ServerState = entries.firstOrNull { it.id == s } ?: NONE } }

/** An environment variable a plugin reads, reported as set / not set — never its value. */
public data class EnvFact(val name: String, val set: Boolean)

/** What a host knows about one plugin before resolution (web: `PluginRecord` in core/engines/plugins.ts). */
public data class PluginRecord(
    /** Host key: the folder (web console), module id (Android), library id (web app). */
    val folder: String,
    val id: String,
    val name: String,
    val version: String = "",
    val apiLevel: Int? = null,
    val targets: List<String> = emptyList(),
    val provides: List<String> = emptyList(),
    val requires: List<String> = emptyList(),
    val optional: List<String> = emptyList(),
    val uiEditor: List<String> = emptyList(),
    val scopes: List<String> = emptyList(),
    val enabled: Boolean = true,
    val error: String? = null,
    val serverPart: Boolean = false,
    val server: ServerState = ServerState.NONE,
    val env: List<EnvFact> = emptyList(),
    val dataDir: String? = null,
    val dataDirProblem: String? = null,
    /** Capabilities it registered live with the host (may differ from `provides`). */
    val services: List<String> = emptyList(),
) {
    public companion object {
        public fun fromJson(o: JsonObject): PluginRecord = PluginRecord(
            folder = o.str("folder"), id = o.str("id"), name = o.str("name"), version = o.str("version"),
            apiLevel = (o["apiLevel"] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.let { o.int("apiLevel") },
            targets = o.strList("targets"), provides = o.strList("provides"), requires = o.strList("requires"), optional = o.strList("optional"),
            uiEditor = o.strList("uiEditor"), scopes = o.strList("scopes"), enabled = o.bool("enabled", true), error = o.strOrNull("error"),
            serverPart = o.bool("serverPart"), server = ServerState.parse(o.strOrNull("server")),
            env = o.objList("env").map { EnvFact(it.str("name"), it.bool("set")) }, dataDir = o.strOrNull("dataDir"), dataDirProblem = o.strOrNull("dataDirProblem"),
            services = o.strList("services"),
        )
    }
}

public data class LiveService(val name: String, val folder: String, val enabled: Boolean)

/** What the host runs: API levels, the target id plugins must name (null = don't check), live capabilities. */
public data class InventoryContext(val apiLevels: List<Int> = listOf(1), val target: String? = null, val live: List<LiveService> = emptyList())

public data class Provider(val folder: String, val name: String, val enabled: Boolean, val live: Boolean)

public data class Dependency(val kind: DependencyKind, val name: String, val required: Boolean, val status: DependencyStatus, val detail: String, val providers: List<Provider>? = null)

public data class Dependent(val folder: String, val name: String, val service: String, val required: Boolean, val enabled: Boolean)

public data class Conflict(val id: String, val kind: String, val key: String, val folders: List<String>, val detail: String, val severity: ConflictSeverity)

public data class PluginInventoryItem(val record: PluginRecord, val dependencies: List<Dependency>, val dependents: List<Dependent>, val health: PluginHealth, val conflicts: List<String>) {
    public val folder: String get() = record.folder
    public val name: String get() = record.name
    public val enabled: Boolean get() = record.enabled
    /** Required dependencies that aren't met. */
    public val blocking: List<Dependency> get() = dependencies.filter { it.required && it.status in BLOCKING }
}

public data class InventoryCounts(val total: Int, val enabled: Int, val errors: Int, val missingDeps: Int, val conflicts: Int, val editors: Int)

public data class PluginInventory(val items: List<PluginInventoryItem>, val conflicts: List<Conflict>, val counts: InventoryCounts) {
    public fun item(folder: String): PluginInventoryItem? = items.firstOrNull { it.folder == folder }
}

private val BLOCKING = setOf(DependencyStatus.MISSING, DependencyStatus.DISABLED, DependencyStatus.UNSUPPORTED)

/** Scope ids → what they mean (open: unknown scopes read "Declared scope."). */
public val SCOPE_NOTES: Map<String, String> = mapOf(
    "ROUTES" to "adds server routes under /api/plugins/<folder>/ (console token on every method, 404 while disabled)",
    "NETWORK" to "makes outbound network calls from the console server",
    "FILES" to "reads or writes files on the console server",
    "SETTINGS" to "adds settings groups or tabs",
    "ASSETS" to "registers assets",
    "ACTIONS" to "registers actions",
    "MENU_ITEMS" to "adds menu or context-menu items",
    "BACKGROUND" to "runs background work in the console server",
    "NOTIFICATIONS" to "sends notifications",
    "DEVICE" to "talks to devices or containers",
    "IDENTITY" to "reads who is signed in",
    "BILLING" to "touches billing",
)

public object PluginInventoryEngine {
    public fun serviceOf(entry: String): String? = if (entry.startsWith("service:")) entry.removePrefix("service:") else null
    public fun pluginOf(entry: String): String? = if (entry.startsWith("plugin:")) entry.removePrefix("plugin:") else null

    /** Capability → plugins that provide it (declared in `provides`, plus whatever registered live). Insertion order matters: it's the fixture's. */
    public fun resolveProviders(records: List<PluginRecord>, live: List<LiveService>): Map<String, List<Provider>> {
        val by = LinkedHashMap<String, MutableList<Provider>>()
        for (r in records) for (p in r.provides) {
            val svc = serviceOf(p) ?: continue
            by.getOrPut(svc) { mutableListOf() }.add(Provider(r.folder, r.name, r.enabled, svc in r.services))
        }
        for (s in live) {
            if (s.name.isEmpty() || s.folder.isEmpty()) continue
            val list = by.getOrPut(s.name) { mutableListOf() }
            if (list.any { it.folder == s.folder }) continue
            val r = records.firstOrNull { it.folder == s.folder }
            list.add(Provider(s.folder, r?.name ?: s.folder, s.enabled, true))
        }
        return by
    }

    private fun envDetail(name: String, plugin: String) = "$plugin reads $name from the host's environment (Settings → Connections or the systems check can set it)."
    private fun enableIt(required: Boolean) = if (required) " or this plugin can't work." else " to turn this feature on."
    private const val OPTIONAL_DETAIL = "Optional: the plugin works without it; the features that use it stay hidden or greyed out."

    /** Everything one plugin needs, with status and who provides it. Same order on every port. */
    public fun dependenciesOf(r: PluginRecord, providers: Map<String, List<Provider>>, records: List<PluginRecord>, ctx: InventoryContext): List<Dependency> {
        val deps = mutableListOf<Dependency>()
        val levels = ctx.apiLevels.sorted()
        deps += Dependency(DependencyKind.FRAMEWORK, "plugin@1 API level ${r.apiLevel?.toString() ?: "?"}", true,
            if (r.apiLevel != null && r.apiLevel in levels) DependencyStatus.OK else DependencyStatus.UNSUPPORTED, "The host runs plugin@1 API level ${levels.joinToString(", ")}.")
        val target = ctx.target
        if (target != null && r.targets.isNotEmpty() && target !in r.targets && "*" !in r.targets) {
            deps += Dependency(DependencyKind.FRAMEWORK, "target $target", true, DependencyStatus.UNSUPPORTED, "plugin.json \"targets\" must include \"$target\" for this host to load it.")
        }
        val seen = HashSet<String>()
        for ((required, entries) in listOf(true to r.requires, false to r.optional)) {
            for (entry in entries) {
                val svc = serviceOf(entry)
                val pid = pluginOf(entry)
                if (pid != null) {
                    if (!seen.add("plugin:$pid")) continue
                    val other = records.firstOrNull { it.id == pid && it.folder != r.folder }
                    val status = when {
                        other == null -> if (required) DependencyStatus.MISSING else DependencyStatus.OPTIONAL_MISSING
                        other.enabled -> DependencyStatus.OK
                        else -> DependencyStatus.DISABLED
                    }
                    val detail = when {
                        other == null -> if (required) "Not installed, so this plugin can't do its job until it is." else OPTIONAL_DETAIL
                        other.enabled -> "Installed: ${other.name}."
                        else -> "${other.name} is installed but switched off. Enable it" + enableIt(required)
                    }
                    deps += Dependency(DependencyKind.PLUGIN, pid, required, status, detail, if (other != null) listOf(Provider(other.folder, other.name, other.enabled, other.enabled)) else emptyList())
                    continue
                }
                if (svc == null) {
                    deps += Dependency(DependencyKind.OTHER, entry, required, DependencyStatus.DECLARED, "Declared in the manifest; the host doesn't check this kind of dependency yet.")
                    continue
                }
                if (!seen.add(svc)) continue
                val provs = (providers[svc] ?: emptyList()).filter { it.folder != r.folder }
                val status = when {
                    provs.any { it.enabled } -> DependencyStatus.OK
                    provs.isNotEmpty() -> DependencyStatus.DISABLED
                    required -> DependencyStatus.MISSING
                    else -> DependencyStatus.OPTIONAL_MISSING
                }
                val who = provs.joinToString(", ") { it.name }.ifEmpty { "no installed plugin" }
                val detail = when (status) {
                    DependencyStatus.OK -> "Provided by $who."
                    DependencyStatus.DISABLED -> "Provided by $who, which is switched off. Enable it" + enableIt(required)
                    else -> if (required) "No installed plugin provides it, so this plugin can't do its job until one is installed." else OPTIONAL_DETAIL
                }
                deps += Dependency(DependencyKind.SERVICE, svc, required, status, detail, provs)
            }
        }
        for (e in r.env) deps += Dependency(DependencyKind.ENV, e.name, false, if (e.set) DependencyStatus.SET else DependencyStatus.UNSET, envDetail(e.name, r.name))
        for (s in r.scopes) deps += Dependency(DependencyKind.SCOPE, s, true, DependencyStatus.GRANTED, SCOPE_NOTES[s.uppercase()] ?: "Declared scope.")
        if (r.serverPart) {
            val status = when (r.server) { ServerState.LOADED -> DependencyStatus.OK; ServerState.ERROR -> DependencyStatus.ERROR; ServerState.NONE -> DependencyStatus.NOT_LOADED }
            deps += Dependency(DependencyKind.CORE, "console API", true, status, "Its server part runs inside the console API and is mounted at /api/plugins/${r.folder}/.")
        }
        return deps
    }

    /** Who needs this plugin: every other plugin requiring a capability it provides, or it by id. */
    public fun dependentsOf(r: PluginRecord, records: List<PluginRecord>): List<Dependent> {
        val mine = (r.provides.mapNotNull(::serviceOf) + r.services).toSet()
        val out = mutableListOf<Dependent>()
        for (other in records) {
            if (other.folder == r.folder) continue
            for ((required, entries) in listOf(true to other.requires, false to other.optional)) for (e in entries) {
                val svc = serviceOf(e)
                val service = if (svc != null && svc in mine) svc else if (pluginOf(e) == r.id) e else null
                if (service != null && out.none { it.folder == other.folder && it.service == service }) out += Dependent(other.folder, other.name, service, required, other.enabled)
            }
        }
        return out
    }

    public fun healthOf(r: PluginRecord, deps: List<Dependency>): PluginHealth = when {
        r.error != null || r.server == ServerState.ERROR -> PluginHealth.ERROR
        deps.any { it.required && it.status in BLOCKING } -> PluginHealth.BLOCKED
        !r.enabled -> PluginHealth.OFF
        deps.any { it.status == DependencyStatus.OPTIONAL_MISSING || it.status == DependencyStatus.UNSET } || r.dataDirProblem != null -> PluginHealth.PARTIAL
        else -> PluginHealth.OK
    }

    /** Read-only clash report: duplicate ids, two providers of one capability, duplicate contributions, shared data folders, two enabled UI editors. */
    public fun conflictsOf(records: List<PluginRecord>): List<Conflict> {
        val out = mutableListOf<Conflict>()
        fun add(kind: String, key: String, folders: List<String>, detail: String, severity: ConflictSeverity = ConflictSeverity.WARN) {
            out += Conflict("$kind:$key", kind, key, folders.distinct().sorted(), detail, severity)
        }
        val byId = LinkedHashMap<String, MutableList<String>>()
        for (r in records) byId.getOrPut(r.id) { mutableListOf() }.add(r.folder)
        for ((pid, fs) in byId) if (fs.size > 1) add("plugin-id", pid, fs, "Two plugins declare the same id; the host can't tell them apart.", ConflictSeverity.ERROR)
        val contrib = LinkedHashMap<String, MutableList<String>>()
        for (r in records) for (p in r.provides) contrib.getOrPut(p) { mutableListOf() }.add(r.folder)
        for ((key, fs) in contrib) {
            if (fs.toSet().size < 2) continue
            val svc = serviceOf(key)
            if (svc != null) add("service", svc, fs, "More than one plugin provides this capability; the last one loaded wins (the host keeps one provider).")
            else add("contribution", key, fs, "Two plugins contribute the same id; the last one installed replaces the other's.")
        }
        val data = LinkedHashMap<String, MutableList<String>>()
        for (r in records) r.dataDir?.let { data.getOrPut(it) { mutableListOf() }.add(r.folder) }
        for ((d, fs) in data) if (fs.size > 1) add("data-dir", d, fs, "Two plugins share a data folder; uninstalling one would delete the other's data.", ConflictSeverity.ERROR)
        val editors = LinkedHashMap<String, MutableList<String>>()
        for (r in records) if (r.enabled) for (kind in r.uiEditor) editors.getOrPut(kind) { mutableListOf() }.add(r.folder)
        for ((kind, fs) in editors) if (fs.size > 1) add("ui-editor", kind, fs, "More than one enabled plugin edits these values. Allowed: the last save wins, and each editor reloads current values when it opens or regains focus.", ConflictSeverity.INFO)
        return out
    }

    public fun counts(items: List<PluginInventoryItem>, conflicts: List<Conflict>): InventoryCounts = InventoryCounts(
        total = items.size,
        enabled = items.count { it.enabled },
        errors = items.count { it.record.error != null },
        missingDeps = items.count { i -> i.dependencies.any { it.required && (it.status == DependencyStatus.MISSING || it.status == DependencyStatus.DISABLED) } },
        conflicts = conflicts.size,
        editors = items.count { it.record.uiEditor.isNotEmpty() },
    )

    /** The whole inventory: records in the order given, resolved against each other and the live services. */
    public fun build(records: List<PluginRecord>, ctx: InventoryContext): PluginInventory {
        val providers = resolveProviders(records, ctx.live)
        val conflicts = conflictsOf(records)
        val items = records.map { r ->
            val deps = dependenciesOf(r, providers, records, ctx)
            PluginInventoryItem(r, deps, dependentsOf(r, records), healthOf(r, deps), conflicts.filter { r.folder in it.folders }.map { it.id })
        }
        return PluginInventory(items, conflicts, counts(items, conflicts))
    }

    /* ---------- graph (the Dependencies view, same columns on every port) ---------- */

    public enum class NodeKind(public val id: String) { PLUGIN("plugin"), SERVICE("service") }
    public enum class EdgeKind(public val id: String) { PROVIDES("provides"), REQUIRES("requires"), OPTIONAL("optional") }
    /** Columns: 0 consumer-only plugins (standalone ones below them) | 1 capabilities | 2 providing plugins. Rows are half-steps (×2). */
    public data class GraphNode(val id: String, val kind: NodeKind, val label: String, val column: Int, val row: Int, val folder: String? = null, val missing: Boolean = false, val providers: Int = 0)
    public data class GraphEdge(val from: String, val to: String, val kind: EdgeKind, val broken: Boolean)
    public data class PluginGraph(val nodes: List<GraphNode>, val edges: List<GraphEdge>, val rows: Int)

    public fun graph(items: List<PluginInventoryItem>, live: List<LiveService>): PluginGraph {
        val providersOf = LinkedHashMap<String, Int>()
        val edges = mutableListOf<GraphEdge>()
        for (i in items) {
            for (p in i.record.provides) { val n = serviceOf(p) ?: continue; providersOf[n] = (providersOf[n] ?: 0) + 1; edges += GraphEdge("p:${i.folder}", "s:$n", EdgeKind.PROVIDES, !i.enabled) }
            for (d in i.dependencies) if (d.kind == DependencyKind.SERVICE) { providersOf.putIfAbsent(d.name, 0); edges += GraphEdge("p:${i.folder}", "s:${d.name}", if (d.required) EdgeKind.REQUIRES else EdgeKind.OPTIONAL, d.status != DependencyStatus.OK) }
        }
        val providers = items.filter { i -> i.record.provides.any { serviceOf(it) != null } }
        val consumers = items.filter { i -> i !in providers && i.dependencies.any { it.kind == DependencyKind.SERVICE } }
        val alone = items.filter { it !in providers && it !in consumers }
        val services = providersOf.keys.sorted()
        val nodes = mutableListOf<GraphNode>()
        (consumers + alone).forEachIndexed { i, r -> nodes += GraphNode("p:${r.folder}", NodeKind.PLUGIN, r.name, 0, i * 2 + if (i >= consumers.size && consumers.isNotEmpty()) 1 else 0, r.folder) }
        services.forEachIndexed { i, s -> nodes += GraphNode("s:$s", NodeKind.SERVICE, s, 1, i * 2, missing = (providersOf[s] ?: 0) == 0 && live.none { it.name == s }, providers = providersOf[s] ?: 0) }
        providers.forEachIndexed { i, r -> nodes += GraphNode("p:${r.folder}", NodeKind.PLUGIN, r.name, 2, i * 2, r.folder) }
        val rows = maxOf((consumers.size + alone.size) * 2 + if (alone.isNotEmpty() && consumers.isNotEmpty()) 1 else 0, services.size * 2, providers.size * 2, 2)
        return PluginGraph(nodes, edges, rows)
    }
}
