package ai.amberx.axf.console

import android.content.Context
import ai.amberx.axf.data.JsonDocumentStore
import ai.amberx.axf.kernel.asset.AxfJson
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.asset.strOrNull
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/* ---- models: the framework's typed catalog contract (ai.amberx.axf.kernel.catalog = framework/core/catalog.ts) ---- */

typealias Suggestion = ai.amberx.axf.kernel.catalog.CatalogSuggestion
typealias CatalogItem = ai.amberx.axf.kernel.catalog.CatalogItem
typealias CatalogGroup = ai.amberx.axf.kernel.catalog.CatalogGroup
typealias CatalogTab = ai.amberx.axf.kernel.catalog.CatalogTab
typealias Catalog = ai.amberx.axf.kernel.catalog.Catalog
typealias Status = ai.amberx.axf.kernel.catalog.FeatureStatus
typealias TrackerItem = ai.amberx.axf.kernel.catalog.TrackerItem
typealias Tracker = ai.amberx.axf.kernel.catalog.Tracker
typealias BoilerplateScreen = ai.amberx.axf.kernel.catalog.BoilerplateScreen
typealias Boilerplate = ai.amberx.axf.kernel.catalog.Boilerplate
typealias BoilerplateCategory = ai.amberx.axf.kernel.catalog.BoilerplateCategory
/** One parameter a library's install wizard asks for (library.json → params[]). */
typealias LibraryParam = ai.amberx.axf.kernel.catalog.LibraryParam
/** An installable library (library@1): what `axf install <id>` / the console wizard configure. */
typealias InstallableLibrary = ai.amberx.axf.kernel.catalog.LibraryDescriptor
/** A framework library as the Libraries view shows it (from the catalog, library.json and the tracker). */
typealias LibraryCard = ai.amberx.axf.kernel.catalog.LibraryCard

/** A library install or UI-library import the console ran (or recorded for Claude Code when no build engine is configured). kind: install | ui-import */
data class PortRecord(val id: String, val kind: String, val name: String, val source: String, val project: String, val status: String, val createdAt: String, val log: String = "")

/** Everything the console tracks, loaded from the APK (`assets/axf/console`) with local overrides in the document store. */
class ConsoleRepo(private val context: Context, private val docs: JsonDocumentStore?) {
    private val module = "axf.console"
    private val _catalog = MutableStateFlow(Catalog.EMPTY)
    val catalog: StateFlow<Catalog> get() = _catalog
    private val _tracker = MutableStateFlow(Tracker.EMPTY)
    val tracker: StateFlow<Tracker> get() = _tracker
    private val _overrides = MutableStateFlow<Map<String, Status>>(emptyMap())
    /** Local status edits (id → status) on top of tracker.json; exported for status.json. */
    val overrides: StateFlow<Map<String, Status>> get() = _overrides
    private val _checked = MutableStateFlow<Set<String>>(emptySet())
    /** Catalog items (and suggestions) the user has checked in the console. */
    val checked: StateFlow<Set<String>> get() = _checked
    /** The AXF project open in the console (path relative to the build engine's apps root, e.g. `apps/my-app`); installs and UI imports apply to it. */
    private val _project = MutableStateFlow("")
    val project: StateFlow<String> get() = _project
    fun openProject(dir: String) { _project.value = dir.trim(); docs?.write(module, "state", "project", buildJsonObject { put("dir", JsonPrimitive(dir.trim())) }) }
    /** Ported UI kits + installed libraries recorded by the wizards (mirrors what the build engine wrote). */
    private val _ports = MutableStateFlow<List<PortRecord>>(emptyList())
    val ports: StateFlow<List<PortRecord>> get() = _ports
    fun addPort(r: PortRecord) { _ports.update { it.filterNot { x -> x.id == r.id } + r }; docs?.write(module, "ports", r.id, buildJsonObject { put("kind", JsonPrimitive(r.kind)); put("name", JsonPrimitive(r.name)); put("source", JsonPrimitive(r.source)); put("project", JsonPrimitive(r.project)); put("status", JsonPrimitive(r.status)); put("createdAt", JsonPrimitive(r.createdAt)); put("log", JsonPrimitive(r.log)) }) }
    private val _installable = MutableStateFlow<List<InstallableLibrary>>(emptyList())
    val installable: StateFlow<List<InstallableLibrary>> get() = _installable
    private val _boilerplates = MutableStateFlow<List<Boilerplate>>(emptyList())
    val boilerplates: StateFlow<List<Boilerplate>> get() = _boilerplates
    private val _categories = MutableStateFlow<List<BoilerplateCategory>>(emptyList())
    val categories: StateFlow<List<BoilerplateCategory>> get() = _categories
    private val _demos = MutableStateFlow<List<DemoApp>>(emptyList())
    val demos: StateFlow<List<DemoApp>> get() = _demos

    private fun read(path: String): JsonObject? = runCatching { context.assets.open("axf/console/$path").bufferedReader().use { it.readText() } }.getOrNull()?.parseJsonObject()

    fun load() {
        read("catalog/catalog.json")?.let { c -> _catalog.value = Catalog.fromJson(c) }
        read("tracker.json")?.let { t -> _tracker.value = Tracker.fromJson(t) }
        read("catalog/libraries.json")?.let { l -> _installable.value = ai.amberx.axf.kernel.catalog.LibrariesIndex.fromJson(l).items }
        read("boilerplates/index.json")?.let { idx ->
            val index = ai.amberx.axf.kernel.catalog.BoilerplateIndex.fromJson(idx)
            _categories.value = index.categories + BoilerplateCategory("custom", "My boilerplates")
            _boilerplates.value = index.items.map { it.id }.filter { it.isNotEmpty() }.mapNotNull { id -> read("boilerplates/$id/boilerplate.json")?.let { Boilerplate.fromJson(it) } }
        }
        docs?.let { d ->
            _overrides.value = d.list(module, "status").mapNotNull { id -> d.read(module, "status", id).getOrNull()?.strOrNull("status")?.let { id to Status.parse(it) } }.toMap()
            _checked.value = d.read(module, "state", "checked").getOrNull()?.strList("ids")?.toSet() ?: _catalog.value.items.filter { it.recommended }.map { it.id }.toSet()
            _boilerplates.update { it + d.list(module, "boilerplates").mapNotNull { id -> d.read(module, "boilerplates", id).getOrNull()?.let { Boilerplate.fromJson(it) } } }
            _project.value = d.read(module, "state", "project").getOrNull()?.str("dir") ?: ""
            _ports.value = d.list(module, "ports").mapNotNull { id -> d.read(module, "ports", id).getOrNull()?.let { PortRecord(id, it.str("kind"), it.str("name"), it.str("source"), it.str("project"), it.str("status"), it.str("createdAt"), it.str("log")) } }
            _demos.value = d.list(module, "demos").mapNotNull { id -> d.read(module, "demos", id).getOrNull()?.let { DemoApp(id, it.str("library"), it.str("name"), it.str("template", "list-detail"), it.str("status", "planned"), it.str("createdAt")) } }
        }
    }

    /** Every framework library: catalog items that name one, every library.json, every lib-* module in the tracker. */
    fun libraryCards(): List<LibraryCard> = ai.amberx.axf.kernel.catalog.LibraryCards.of(_catalog.value, _installable.value, _tracker.value)
    fun libraryCard(id: String): LibraryCard? = libraryCards().firstOrNull { it.id == id || it.module == id || it.packageName == id }

    fun status(id: String): Status = _overrides.value[id] ?: _tracker.value.byId(id)?.status ?: Status.PLANNED
    fun setStatus(id: String, s: Status) { _overrides.update { it + (id to s) }; docs?.write(module, "status", id, buildJsonObject { put("status", JsonPrimitive(s.id)) }) }
    fun setChecked(id: String, on: Boolean) { _checked.update { if (on) it + id else it - id }; docs?.write(module, "state", "checked", buildJsonObject { put("ids", kotlinx.serialization.json.JsonArray(_checked.value.map { JsonPrimitive(it) })) }) }
    fun isChecked(id: String) = id in _checked.value

    /** Coverage per tab from the effective status (tracker + overrides). */
    fun coverage(tab: String): Map<Status, Int> { val rows = _tracker.value.items.filter { it.tab == tab && it.parent == null }; return Status.entries.associateWith { s -> rows.count { status(it.id) == s } } }

    fun saveBoilerplate(b: Boilerplate) { _boilerplates.update { it.filterNot { x -> x.id == b.id } + b }; docs?.write(module, "boilerplates", b.id, b.toDocument()) }
    fun addDemo(d: DemoApp) { _demos.update { it.filterNot { x -> x.id == d.id } + d }; docs?.write(module, "demos", d.id, buildJsonObject { put("library", JsonPrimitive(d.library)); put("name", JsonPrimitive(d.name)); put("template", JsonPrimitive(d.template)); put("status", JsonPrimitive(d.status)); put("createdAt", JsonPrimitive(d.createdAt)) }) }

    /** status.json fragment for the repo (what `framework/cli/tracker.mjs` reads). */
    fun exportStatusJson(): String = AxfJson.encodeToString(JsonObject.serializer(), JsonObject(_overrides.value.mapValues { (_, s) -> buildJsonObject { put("status", JsonPrimitive(s.id)) } }))
    /** A Claude Code prompt that builds everything checked but not built. */
    fun exportPlan(): String = buildString {
        appendLine("# AXF build plan (exported from the Dev Console)"); appendLine()
        for (tab in _catalog.value.tabs) { val todo = tab.groups.flatMap { it.items }.filter { isChecked(it.id) && status(it.id) != Status.BUILT }; if (todo.isEmpty()) continue
            appendLine("## ${tab.label}"); for (i in todo) { appendLine("- [${status(i.id).id}] ${i.id} — ${i.title}${if (i.note.isNotBlank()) " (" + i.note + ")" else ""}"); for (s in i.suggests) if (isChecked(s.id)) appendLine("    - ${s.id} — ${s.title}") }; appendLine() }
    }
}

data class DemoApp(val id: String, val library: String, val name: String, val template: String, val status: String, val createdAt: String)
