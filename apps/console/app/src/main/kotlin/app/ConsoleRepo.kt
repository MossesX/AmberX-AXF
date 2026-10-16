package ai.amberx.axf.console

import android.content.Context
import ai.amberx.axf.data.JsonDocumentStore
import ai.amberx.axf.kernel.asset.AxfJson
import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.int
import ai.amberx.axf.kernel.asset.obj
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.asset.strMap
import ai.amberx.axf.kernel.asset.strOrNull
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/* ---- models mirrored from framework/catalog/*.json, tracker.json and framework/boilerplates ---- */

data class Suggestion(val id: String, val title: String)
data class CatalogItem(val id: String, val title: String, val note: String, val tag: String, val recommended: Boolean, val suggests: List<Suggestion>, val tab: String, val group: String)
data class CatalogGroup(val id: String, val label: String, val items: List<CatalogItem>)
data class CatalogTab(val id: String, val label: String, val groups: List<CatalogGroup>)
data class Catalog(val frameworkVersion: String, val tabs: List<CatalogTab>) { val items: List<CatalogItem> get() = tabs.flatMap { t -> t.groups.flatMap { it.items } } }

enum class Status { BUILT, PARTIAL, PLACEHOLDER, PLANNED; companion object { fun parse(s: String?) = entries.firstOrNull { it.name.equals(s, true) } ?: PLANNED } }
data class TrackerItem(val id: String, val tab: String, val group: String, val parent: String?, val title: String, val tag: String, val status: Status, val wave: Int, val module: String?, val notes: String)
data class Tracker(val generatedAt: String, val items: List<TrackerItem>) { fun byId(id: String) = items.firstOrNull { it.id == id } }

data class BoilerplateScreen(val id: String, val label: String, val kind: String)
data class Boilerplate(val id: String, val name: String, val category: String, val description: String, val features: List<String>, val screens: List<BoilerplateScreen>, val modules: List<String>, val defaults: Map<String, String>, val status: String, val source: String) {
    fun toJson(): JsonObject = buildJsonObject {
        put("\$axf", JsonPrimitive("boilerplate@1")); put("id", JsonPrimitive(id)); put("name", JsonPrimitive(name)); put("category", JsonPrimitive(category)); put("description", JsonPrimitive(description))
        put("features", kotlinx.serialization.json.JsonArray(features.map { JsonPrimitive(it) }))
        put("screens", kotlinx.serialization.json.JsonArray(screens.map { s -> buildJsonObject { put("id", JsonPrimitive(s.id)); put("label", JsonPrimitive(s.label)); put("kind", JsonPrimitive(s.kind)) } }))
        put("modules", kotlinx.serialization.json.JsonArray(modules.map { JsonPrimitive(it) }))
        put("defaults", JsonObject(defaults.mapValues { JsonPrimitive(it.value) })); put("status", JsonPrimitive(status)); put("source", JsonPrimitive(source))
    }
    companion object {
        fun fromJson(o: JsonObject) = Boilerplate(o.str("id"), o.str("name"), o.str("category", "starter"), o.str("description"), o.strList("features"),
            o.objList("screens").map { BoilerplateScreen(it.str("id"), it.str("label"), it.str("kind", "custom")) }, o.strList("modules"), o.strMap("defaults"), o.str("status", "planned"), o.str("source", "amberx"))
    }
}
data class BoilerplateCategory(val id: String, val label: String)

/** Everything the console tracks, loaded from the APK (`assets/axf/console/**`) with local overrides in the document store. */
class ConsoleRepo(private val context: Context, private val docs: JsonDocumentStore?) {
    private val module = "axf.console"
    private val _catalog = MutableStateFlow(Catalog("0.2.0", emptyList()))
    val catalog: StateFlow<Catalog> get() = _catalog
    private val _tracker = MutableStateFlow(Tracker("", emptyList()))
    val tracker: StateFlow<Tracker> get() = _tracker
    private val _overrides = MutableStateFlow<Map<String, Status>>(emptyMap())
    /** Local status edits (id → status) on top of tracker.json; exported for status.json. */
    val overrides: StateFlow<Map<String, Status>> get() = _overrides
    private val _checked = MutableStateFlow<Set<String>>(emptySet())
    /** Catalog items (and suggestions) the user has checked in the console. */
    val checked: StateFlow<Set<String>> get() = _checked
    private val _boilerplates = MutableStateFlow<List<Boilerplate>>(emptyList())
    val boilerplates: StateFlow<List<Boilerplate>> get() = _boilerplates
    private val _categories = MutableStateFlow<List<BoilerplateCategory>>(emptyList())
    val categories: StateFlow<List<BoilerplateCategory>> get() = _categories
    private val _demos = MutableStateFlow<List<DemoApp>>(emptyList())
    val demos: StateFlow<List<DemoApp>> get() = _demos

    private fun read(path: String): JsonObject? = runCatching { context.assets.open("axf/console/$path").bufferedReader().use { it.readText() } }.getOrNull()?.parseJsonObject()

    fun load() {
        read("catalog/catalog.json")?.let { c ->
            _catalog.value = Catalog(c.str("frameworkVersion", "0.2.0"), c.objList("tabs").map { t -> CatalogTab(t.str("id"), t.str("label"), t.objList("groups").map { g -> CatalogGroup(g.str("id"), g.str("label"), g.objList("items").map { i -> CatalogItem(i.str("id"), i.str("title"), i.str("note"), i.str("tag"), i.bool("recommended"), i.objList("suggests").map { s -> Suggestion(s.str("id"), s.str("title")) }, t.str("id"), g.str("id")) }) }) })
        }
        read("tracker.json")?.let { t -> _tracker.value = Tracker(t.str("generatedAt"), t.objList("items").map { i -> TrackerItem(i.str("id"), i.str("tab"), i.str("group"), i.strOrNull("parent"), i.str("title"), i.str("tag"), Status.parse(i.strOrNull("status")), int(i, "wave", 3), i.strOrNull("module"), i.str("notes")) }) }
        read("boilerplates/index.json")?.let { idx ->
            _categories.value = idx.objList("categories").map { BoilerplateCategory(it.str("id"), it.str("label")) } + BoilerplateCategory("custom", "My boilerplates")
            _boilerplates.value = idx.objList("items").mapNotNull { it.strOrNull("id") }.mapNotNull { id -> read("boilerplates/$id/boilerplate.json")?.let(Boilerplate::fromJson) }
        }
        docs?.let { d ->
            _overrides.value = d.list(module, "status").mapNotNull { id -> d.read(module, "status", id).getOrNull()?.strOrNull("status")?.let { id to Status.parse(it) } }.toMap()
            _checked.value = d.read(module, "state", "checked").getOrNull()?.strList("ids")?.toSet() ?: _catalog.value.items.filter { it.recommended }.map { it.id }.toSet()
            _boilerplates.update { it + d.list(module, "boilerplates").mapNotNull { id -> d.read(module, "boilerplates", id).getOrNull()?.let(Boilerplate::fromJson) } }
            _demos.value = d.list(module, "demos").mapNotNull { id -> d.read(module, "demos", id).getOrNull()?.let { DemoApp(id, it.str("library"), it.str("name"), it.str("template", "list-detail"), it.str("status", "planned"), it.str("createdAt")) } }
        }
    }

    fun status(id: String): Status = _overrides.value[id] ?: _tracker.value.byId(id)?.status ?: Status.PLANNED
    fun setStatus(id: String, s: Status) { _overrides.update { it + (id to s) }; docs?.write(module, "status", id, buildJsonObject { put("status", JsonPrimitive(s.name.lowercase())) }) }
    fun setChecked(id: String, on: Boolean) { _checked.update { if (on) it + id else it - id }; docs?.write(module, "state", "checked", buildJsonObject { put("ids", kotlinx.serialization.json.JsonArray(_checked.value.map { JsonPrimitive(it) })) }) }
    fun isChecked(id: String) = id in _checked.value

    /** Coverage per tab from the effective status (tracker + overrides). */
    fun coverage(tab: String): Map<Status, Int> { val rows = _tracker.value.items.filter { it.tab == tab && it.parent == null }; return Status.entries.associateWith { s -> rows.count { status(it.id) == s } } }

    fun saveBoilerplate(b: Boilerplate) { _boilerplates.update { it.filterNot { x -> x.id == b.id } + b }; docs?.write(module, "boilerplates", b.id, b.toJson()) }
    fun addDemo(d: DemoApp) { _demos.update { it.filterNot { x -> x.id == d.id } + d }; docs?.write(module, "demos", d.id, buildJsonObject { put("library", JsonPrimitive(d.library)); put("name", JsonPrimitive(d.name)); put("template", JsonPrimitive(d.template)); put("status", JsonPrimitive(d.status)); put("createdAt", JsonPrimitive(d.createdAt)) }) }

    /** status.json fragment for the repo (what `framework/cli/tracker.mjs` reads). */
    fun exportStatusJson(): String = AxfJson.encodeToString(JsonObject.serializer(), JsonObject(_overrides.value.mapValues { (_, s) -> buildJsonObject { put("status", JsonPrimitive(s.name.lowercase())) } }))
    /** A Claude Code prompt that builds everything checked but not built. */
    fun exportPlan(): String = buildString {
        appendLine("# AXF build plan (exported from the Dev Console)"); appendLine()
        for (tab in _catalog.value.tabs) { val todo = tab.groups.flatMap { it.items }.filter { isChecked(it.id) && status(it.id) != Status.BUILT }; if (todo.isEmpty()) continue
            appendLine("## ${tab.label}"); for (i in todo) { appendLine("- [${status(i.id).name.lowercase()}] ${i.id} — ${i.title}${if (i.note.isNotBlank()) " (" + i.note + ")" else ""}"); for (s in i.suggests) if (isChecked(s.id)) appendLine("    - ${s.id} — ${s.title}") }; appendLine() }
    }
}

data class DemoApp(val id: String, val library: String, val name: String, val template: String, val status: String, val createdAt: String)
