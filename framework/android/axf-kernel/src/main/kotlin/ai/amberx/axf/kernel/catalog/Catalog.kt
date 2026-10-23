package ai.amberx.axf.kernel.catalog

import ai.amberx.axf.kernel.asset.obj
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.asset.strMap
import ai.amberx.axf.kernel.asset.strOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/*
 * Typed catalog models — the framework's own data files as one contract for every port. Mirrors framework/core/catalog.ts
 * (same names, same defaults); both replay spec/fixtures/catalog.json (CatalogConformanceTest).
 *
 *   catalog@1      framework/catalog/catalog.json      feature catalog: tabs → groups → items (+ suggestions)
 *   status         framework/catalog/status.json       id → { status, wave, module, notes }
 *   tracker@1      tracker.json                         catalog × status, flattened
 *   library@1      framework/{android,libs,python}/<lib>/library.json
 *   libraries@1    framework/catalog/libraries.json    every library@1, merged by id
 *   boilerplate@1  framework/boilerplates/<id>/boilerplate.json
 *   boilerplates@1 framework/boilerplates/index.json
 *
 * Pure: parsers take parsed JSON, nothing here reads files. `toJson()` writes the same shape the TS parsers produce
 * (optional fields left out when absent), which is what the fixture compares.
 */

/* ================================================================== helpers */

private fun JsonObject.isArray(key: String): Boolean = this[key] is JsonArray
private fun JsonObject.intOr(key: String, default: Int): Int {
    val p = this[key] as? JsonPrimitive ?: return default
    if (p.isString) return default
    val d = p.doubleOrNull ?: return default
    return if (d.isFinite()) d.toInt() else default
}
private fun JsonObject.numOrNull(key: String): Double? {
    val p = this[key] as? JsonPrimitive ?: return null
    if (p.isString) return null
    return p.doubleOrNull?.takeIf { it.isFinite() }
}
private fun JsonObject.boolStrict(key: String): Boolean = (this[key] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull ?: false
private fun strings(v: List<String>): JsonArray = JsonArray(v.map { JsonPrimitive(it) })
private fun jobj(vararg pairs: Pair<String, JsonElement?>): JsonObject = JsonObject(pairs.filter { it.second != null }.associate { it.first to it.second!! })
private fun js(v: String?): JsonElement? = v?.let { JsonPrimitive(it) }
/** Whole numbers as integers (6, not 6.0), like JSON written by Node. */
internal fun numJson(d: Double): JsonPrimitive = if (d % 1.0 == 0.0 && d >= Long.MIN_VALUE.toDouble() && d <= Long.MAX_VALUE.toDouble()) JsonPrimitive(d.toLong()) else JsonPrimitive(d)

/* ================================================================== catalog@1 */

public data class CatalogSuggestion(val id: String, val title: String) {
    public fun toJson(): JsonObject = jobj("id" to js(id), "title" to js(title))
}

/** A catalog item that names a framework library (modules tab). */
public data class CatalogLibraryRef(val module: String, val id: String? = null, val label: String? = null, val description: String? = null, val features: List<String>? = null) {
    public fun toJson(): JsonObject = jobj("module" to js(module), "id" to js(id), "label" to js(label), "description" to js(description), "features" to features?.let { strings(it) })
    public companion object {
        public fun fromJson(o: JsonObject?): CatalogLibraryRef? {
            if (o == null || o.str("module").isEmpty()) return null
            return CatalogLibraryRef(o.str("module"), o.strOrNull("id"), o.strOrNull("label"), o.strOrNull("description"), if (o.isArray("features")) o.strList("features") else null)
        }
    }
}

public data class CatalogItem(
    val id: String, val title: String, val note: String, val tag: String, val recommended: Boolean, val suggests: List<CatalogSuggestion>,
    /** From the enclosing tab/group (not stored in catalog.json). */
    val tab: String, val group: String,
    val library: CatalogLibraryRef? = null,
) {
    public fun toJson(): JsonObject = jobj(
        "id" to js(id), "title" to js(title), "note" to js(note), "tag" to js(tag), "recommended" to JsonPrimitive(recommended),
        "suggests" to JsonArray(suggests.map { it.toJson() }), "tab" to js(tab), "group" to js(group), "library" to library?.toJson(),
    )
}

public data class CatalogGroup(val id: String, val label: String, val items: List<CatalogItem>) {
    public fun toJson(): JsonObject = jobj("id" to js(id), "label" to js(label), "items" to JsonArray(items.map { it.toJson() }))
}

public data class CatalogTab(val id: String, val label: String, val groups: List<CatalogGroup>) {
    public fun toJson(): JsonObject = jobj("id" to js(id), "label" to js(label), "groups" to JsonArray(groups.map { it.toJson() }))
}

public data class Catalog(val frameworkVersion: String, val tabs: List<CatalogTab>, val generatedAt: String? = null) {
    /** Every item, in catalog order. */
    public val items: List<CatalogItem> get() = tabs.flatMap { t -> t.groups.flatMap { it.items } }
    public fun toJson(): JsonObject = jobj("frameworkVersion" to js(frameworkVersion), "tabs" to JsonArray(tabs.map { it.toJson() }), "generatedAt" to js(generatedAt))

    public companion object {
        public val EMPTY: Catalog = Catalog("0.2.0", emptyList())
        public fun fromJson(c: JsonObject): Catalog = Catalog(
            frameworkVersion = c.str("frameworkVersion", "0.2.0"),
            tabs = c.objList("tabs").map { t ->
                CatalogTab(t.str("id"), t.str("label"), t.objList("groups").map { g ->
                    CatalogGroup(g.str("id"), g.str("label"), g.objList("items").map { i ->
                        CatalogItem(i.str("id"), i.str("title"), i.str("note"), i.str("tag"), i.boolStrict("recommended"),
                            i.objList("suggests").map { x -> CatalogSuggestion(x.str("id"), x.str("title")) }, t.str("id"), g.str("id"),
                            CatalogLibraryRef.fromJson(i.obj("library")))
                    })
                })
            },
            generatedAt = c.strOrNull("generatedAt"),
        )
    }
}

/* ================================================================== status + tracker@1 */

public enum class FeatureStatus(public val id: String) {
    BUILT("built"), PARTIAL("partial"), PLACEHOLDER("placeholder"), PLANNED("planned");
    public companion object {
        /** Unknown text reads as planned, like the tracker. */
        public fun parse(s: String?): FeatureStatus = entries.firstOrNull { it.id.equals(s, ignoreCase = true) } ?: PLANNED
    }
}

public data class StatusEntry(val status: FeatureStatus, val wave: Int, val module: String?, val notes: String) {
    public fun toJson(): JsonObject = JsonObject(mapOf("status" to JsonPrimitive(status.id), "wave" to JsonPrimitive(wave), "module" to (module?.let { JsonPrimitive(it) } ?: JsonNull), "notes" to JsonPrimitive(notes)))
}

public object StatusMap {
    /** status.json → id → entry (`note` read as `notes`; unknown status → planned). */
    public fun fromJson(o: JsonObject): Map<String, StatusEntry> = o.entries.associate { (id, v) ->
        val e = v as? JsonObject ?: JsonObject(emptyMap())
        id to StatusEntry(FeatureStatus.parse(e.strOrNull("status")), e.intOr("wave", 3), e.strOrNull("module"), e.strOrNull("notes") ?: e.str("note"))
    }
    public fun toJson(m: Map<String, StatusEntry>): JsonObject = JsonObject(m.mapValues { it.value.toJson() })
}

public data class TrackerItem(val id: String, val tab: String, val group: String, val parent: String?, val title: String, val tag: String, val status: FeatureStatus, val wave: Int, val module: String?, val notes: String) {
    public fun toJson(): JsonObject = jobj(
        "id" to js(id), "tab" to js(tab), "group" to js(group), "title" to js(title), "tag" to js(tag), "status" to JsonPrimitive(status.id),
        "wave" to JsonPrimitive(wave), "module" to (module?.let { JsonPrimitive(it) } ?: JsonNull), "notes" to js(notes), "parent" to js(parent),
    )
}

public data class Tracker(val generatedAt: String, val items: List<TrackerItem>, val summary: Map<String, Map<String, Int>> = emptyMap(), val frameworkVersion: String? = null) {
    public fun byId(id: String): TrackerItem? = items.firstOrNull { it.id == id }
    public fun toJson(): JsonObject = jobj(
        "generatedAt" to js(generatedAt), "summary" to JsonObject(summary.mapValues { (_, v) -> JsonObject(v.mapValues { JsonPrimitive(it.value) }) }),
        "items" to JsonArray(items.map { it.toJson() }), "frameworkVersion" to js(frameworkVersion),
    )
    public companion object {
        public val EMPTY: Tracker = Tracker("", emptyList())
        public fun fromJson(t: JsonObject): Tracker = Tracker(
            generatedAt = t.str("generatedAt"),
            items = t.objList("items").map { i ->
                TrackerItem(i.str("id"), i.str("tab"), i.str("group"), i.strOrNull("parent"), i.str("title"), i.str("tag"), FeatureStatus.parse(i.strOrNull("status")), i.intOr("wave", 3), i.strOrNull("module"), i.str("notes"))
            },
            summary = (t.obj("summary") ?: JsonObject(emptyMap())).entries.associate { (tab, v) ->
                tab to ((v as? JsonObject)?.entries?.mapNotNull { (k, n) -> (n as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull?.let { k to it.toInt() } }?.toMap() ?: emptyMap())
            },
            frameworkVersion = t.strOrNull("frameworkVersion"),
        )
    }
}

/* ================================================================== library@1 + libraries@1 */

/**
 * A library.json `params[]` entry as the catalog reads and writes it (keeps "no choices" apart from an empty list so
 * `toJson` round-trips). The wizard rules are the one library@1 contract, [ai.amberx.axf.kernel.library.LibraryParams]
 * (= core/library.ts, fixture library-params.json); this class only delegates to it.
 */
public data class LibraryParam(val key: String, val label: String, val type: String, val required: Boolean, val default: JsonElement?, val help: String?, val choices: List<String>?, val min: Double?, val max: Double?) {
    /** The same parameter as the library@1 contract type (what `AxfLibraryParamField` takes). */
    public fun asLibraryParam(): ai.amberx.axf.kernel.library.LibraryParam =
        ai.amberx.axf.kernel.library.LibraryParam(key, label, type, required, default?.takeUnless { it is JsonNull }, help, choices.orEmpty(), min, max)

    /** The default as wizard text (lists comma-joined). */
    public val defaultText: String get() = asLibraryParam().defaultText

    /** Wizard answer (text) → the typed JSON the installer expects; null when blank or not a number. */
    public fun toJson(text: String): JsonElement? = asLibraryParam().toJson(text)

    /** Why a wizard answer is refused, or null. */
    public fun validate(text: String): String? = asLibraryParam().validate(text)

    public fun toJson(): JsonObject = jobj(
        "key" to js(key), "label" to js(label), "type" to js(type), "required" to (if (required) JsonPrimitive(true) else null),
        "default" to default?.takeUnless { it is JsonNull }, "help" to js(help), "choices" to choices?.let { strings(it) },
        "min" to min?.let { numJson(it) }, "max" to max?.let { numJson(it) },
    )

    public companion object {
        private val TYPES = setOf("text", "list", "bool", "number", "choice")
        public fun fromJson(o: JsonObject): LibraryParam {
            val type = o.str("type", "text")
            return LibraryParam(o.str("key"), o.str("label"), if (type in TYPES) type else "text", o.boolStrict("required"), o["default"]?.takeUnless { it is JsonNull },
                o.strOrNull("help"), if (o.isArray("choices")) o.strList("choices") else null, o.numOrNull("min"), o.numOrNull("max"))
        }
    }
}

public data class LibraryInstall(val gradle: String? = null, val module: String? = null, val import: String? = null, val routes: List<String>? = null) {
    public fun toJson(): JsonObject = jobj("gradle" to js(gradle), "module" to js(module), "import" to js(import), "routes" to routes?.let { strings(it) })
}

public data class LibraryPort(val status: String, val dir: String? = null, val note: String? = null, val checkedAt: String? = null) {
    public fun toJson(): JsonObject = jobj("status" to js(status), "dir" to js(dir), "note" to js(note), "checkedAt" to js(checkedAt))
}

public data class LibraryPlaceholder(val capability: String, val note: String) {
    public fun toJson(): JsonObject = jobj("capability" to js(capability), "note" to js(note))
}

/** library@1: one installable library. */
public data class LibraryDescriptor(
    val id: String, val module: String, val name: String, val description: String, val features: List<String>, val dependsOn: List<String>,
    val manifestKey: String, val params: List<LibraryParam>, val install: LibraryInstall? = null, val ports: Map<String, LibraryPort>? = null,
    val placeholders: List<LibraryPlaceholder>? = null, val template: String? = null, val port: JsonObject? = null,
) {
    /** Short name: `voice` for lib-voice. */
    public val slug: String get() = module.removePrefix("lib-")

    public fun toJson(): JsonObject = jobj(
        "id" to js(id), "module" to js(module), "name" to js(name), "description" to js(description), "features" to strings(features), "dependsOn" to strings(dependsOn),
        "manifestKey" to js(manifestKey), "params" to JsonArray(params.map { it.toJson() }), "install" to install?.toJson(),
        "ports" to ports?.let { p -> JsonObject(p.mapValues { it.value.toJson() }) }, "placeholders" to placeholders?.let { l -> JsonArray(l.map { it.toJson() }) },
        "template" to js(template), "port" to port,
    )

    public companion object {
        public fun fromJson(o: JsonObject): LibraryDescriptor {
            val module = o.str("module")
            val ins = o.obj("install")
            return LibraryDescriptor(
                id = o.str("id"), module = module, name = o.str("name"), description = o.str("description"), features = o.strList("features"), dependsOn = o.strList("dependsOn"),
                manifestKey = o.str("manifestKey", "libraries.${module.removePrefix("lib-")}"), params = o.objList("params").map { LibraryParam.fromJson(it) },
                install = ins?.let { LibraryInstall(it.strOrNull("gradle"), it.strOrNull("module"), it.strOrNull("import"), if (it.isArray("routes")) it.strList("routes") else null) },
                ports = o.obj("ports")?.entries?.associate { (k, v) -> val p = v as? JsonObject ?: JsonObject(emptyMap()); k to LibraryPort(p.str("status"), p.strOrNull("dir"), p.strOrNull("note"), p.strOrNull("checkedAt")) },
                placeholders = if (o.isArray("placeholders")) o.objList("placeholders").map { LibraryPlaceholder(it.str("capability"), it.str("note")) } else null,
                template = o.strOrNull("template"), port = o.obj("port"),
            )
        }
    }
}

public data class LibrariesIndex(val generatedAt: String, val items: List<LibraryDescriptor>) {
    public fun toJson(): JsonObject = jobj("generatedAt" to js(generatedAt), "items" to JsonArray(items.map { it.toJson() }))
    public companion object {
        /** libraries.json (libraries@1); a bare `{ items }` reads the same. */
        public fun fromJson(o: JsonObject): LibrariesIndex = LibrariesIndex(o.str("generatedAt"), o.objList("items").map { LibraryDescriptor.fromJson(it) })
    }
}

/* ================================================================== boilerplate@1 + boilerplates@1 */

public data class BoilerplateScreen(val id: String, val label: String, val kind: String) {
    public fun toJson(): JsonObject = jobj("id" to js(id), "label" to js(label), "kind" to js(kind))
}

/** A library a boilerplate installs: by id alone (`"browser"`) or with wizard answers. */
public data class BoilerplateLibraryPick(val library: String, val params: JsonObject? = null, val bare: Boolean = false) {
    public fun toJson(): JsonElement = if (bare) JsonPrimitive(library) else jobj("library" to js(library), "params" to params)
}

public data class BoilerplateScreenshot(val file: String, val screen: String? = null, val caption: String? = null) {
    public fun toJson(): JsonObject = jobj("file" to js(file), "screen" to js(screen), "caption" to js(caption))
}

public data class Boilerplate(
    val id: String, val name: String, val category: String, val description: String, val features: List<String>, val screens: List<BoilerplateScreen>,
    val modules: List<String>, val defaults: Map<String, String>, val status: String, val source: String,
    val libraries: List<BoilerplateLibraryPick> = emptyList(), val screenshots: List<BoilerplateScreenshot> = emptyList(),
) {
    public val libraryIds: List<String> get() = libraries.map { it.library }

    /** The parsed shape (what the fixture compares). */
    public fun toJson(): JsonObject = jobj(
        "id" to js(id), "name" to js(name), "category" to js(category), "description" to js(description), "features" to strings(features),
        "screens" to JsonArray(screens.map { it.toJson() }), "modules" to strings(modules), "defaults" to JsonObject(defaults.mapValues { JsonPrimitive(it.value) }),
        "status" to js(status), "source" to js(source),
        "libraries" to libraries.takeIf { it.isNotEmpty() }?.let { l -> JsonArray(l.map { it.toJson() }) },
        "screenshots" to screenshots.takeIf { it.isNotEmpty() }?.let { l -> JsonArray(l.map { it.toJson() }) },
    )

    /** boilerplate.json as written to disk (`$axf: boilerplate@1` first). */
    public fun toDocument(): JsonObject = JsonObject(mapOf<String, JsonElement>("\$axf" to JsonPrimitive("boilerplate@1")) + toJson())

    public companion object {
        public fun fromJson(o: JsonObject): Boilerplate = Boilerplate(
            id = o.str("id"), name = o.str("name"), category = o.str("category", "starter"), description = o.str("description"), features = o.strList("features"),
            screens = o.objList("screens").map { BoilerplateScreen(it.str("id"), it.str("label"), it.str("kind", "custom")) }, modules = o.strList("modules"),
            defaults = o.strMap("defaults"), status = o.str("status", "planned"), source = o.str("source", "amberx"),
            libraries = ((o["libraries"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { e ->
                when {
                    e is JsonPrimitive && e.isString -> BoilerplateLibraryPick(e.content, bare = true)
                    e is JsonObject && e.str("library").isNotEmpty() -> BoilerplateLibraryPick(e.str("library"), e.obj("params"))
                    else -> null
                }
            },
            screenshots = o.objList("screenshots").filter { it.str("file").isNotEmpty() }.map { BoilerplateScreenshot(it.str("file"), it.strOrNull("screen"), it.strOrNull("caption")) },
        )
    }
}

public data class BoilerplateCategory(val id: String, val label: String) {
    public fun toJson(): JsonObject = jobj("id" to js(id), "label" to js(label))
}

public data class BoilerplateSummary(
    val id: String, val name: String, val category: String, val description: String, val status: String, val source: String,
    val features: Int? = null, val screens: Int? = null, val modules: List<String>? = null, val libraries: List<String>? = null,
) {
    public fun toJson(): JsonObject = jobj(
        "id" to js(id), "name" to js(name), "category" to js(category), "description" to js(description), "status" to js(status), "source" to js(source),
        "features" to features?.let { JsonPrimitive(it) }, "screens" to screens?.let { JsonPrimitive(it) }, "modules" to modules?.let { strings(it) }, "libraries" to libraries?.let { strings(it) },
    )
}

public data class BoilerplateIndex(val categories: List<BoilerplateCategory>, val items: List<BoilerplateSummary>) {
    public fun toJson(): JsonObject = jobj("categories" to JsonArray(categories.map { it.toJson() }), "items" to JsonArray(items.map { it.toJson() }))
    public companion object {
        public fun fromJson(o: JsonObject): BoilerplateIndex = BoilerplateIndex(
            o.objList("categories").map { BoilerplateCategory(it.str("id"), it.str("label")) },
            o.objList("items").map { i ->
                BoilerplateSummary(i.str("id"), i.str("name"), i.str("category", "starter"), i.str("description"), i.str("status", "planned"), i.str("source", "amberx"),
                    i.numOrNull("features")?.toInt(), i.numOrNull("screens")?.toInt(), if (i.isArray("modules")) i.strList("modules") else null, if (i.isArray("libraries")) i.strList("libraries") else null)
            },
        )
    }
}

/* ================================================================== catalog-driven library list */

/** One framework library as the library pickers show it. `id` is the short slug (`voice` for lib-voice). */
public data class LibraryCard(
    val id: String, val module: String, val packageName: String, val label: String, val description: String, val features: List<String>,
    /** a library@1 exists for it (the install wizard can add it to an app) */
    val installable: Boolean,
    /** catalog | library | tracker: where the card came from first */
    val source: String,
) {
    public fun toJson(): JsonObject = jobj(
        "id" to js(id), "module" to js(module), "packageName" to js(packageName), "label" to js(label), "description" to js(description),
        "features" to strings(features), "installable" to JsonPrimitive(installable), "source" to js(source),
    )
}

public object LibraryCards {
    private val LIB_MODULE = Regex("^lib-[a-z0-9][a-z0-9-]*$")
    private fun slugOf(pkg: String): String = pkg.removePrefix("lib-")
    private fun moduleIdOf(pkg: String): String = "ai.amberx.axf.${slugOf(pkg).replace('-', '.')}"

    private class Draft(val id: String, var module: String, val packageName: String, val label: String, val description: String, val features: MutableList<String>, var installable: Boolean, val source: String) {
        fun add(more: List<String>) { for (f in more) if (f !in features) features.add(f) }
        fun build(): LibraryCard = LibraryCard(id, module, packageName, label, description, features.toList(), installable, source)
    }

    /**
     * Every framework library, from the data (no hard-coded list): (1) catalog items with a `library` ref, in catalog
     * order; (2) every library@1 (merged into its catalog card, else a new card); (3) every `lib-*` module the tracker
     * names that is still missing, with that module's tracker items as its features.
     */
    public fun of(catalog: Catalog, libraries: List<LibraryDescriptor>, tracker: Tracker? = null): List<LibraryCard> {
        val cards = ArrayList<Draft>()
        val byPkg = HashMap<String, Draft>()
        for (item in catalog.items) {
            val ref = item.library ?: continue
            if (byPkg.containsKey(ref.module)) continue
            val parts = item.title.split(" — ")
            val head = parts.first()
            val rest = parts.drop(1).joinToString(" — ")
            val module = ref.id ?: if (item.note.startsWith("ai.amberx.axf.")) item.note else moduleIdOf(ref.module)
            val d = Draft(slugOf(ref.module), module, ref.module, ref.label ?: head, ref.description ?: rest, (ref.features ?: emptyList()).distinct().toMutableList(), false, "catalog")
            cards.add(d); byPkg[ref.module] = d
        }
        for (lib in libraries) {
            if (lib.module.isEmpty()) continue
            val have = byPkg[lib.module]
            if (have != null) { have.installable = true; if (lib.id.isNotEmpty()) have.module = lib.id; have.add(lib.features); continue }
            val d = Draft(slugOf(lib.module), lib.id.ifEmpty { moduleIdOf(lib.module) }, lib.module, lib.name.ifEmpty { lib.module }, lib.description, lib.features.distinct().toMutableList(), true, "library")
            cards.add(d); byPkg[lib.module] = d
        }
        for (t in tracker?.items ?: emptyList()) {
            val pkg = t.module ?: continue
            if (!LIB_MODULE.matches(pkg)) continue
            var d = byPkg[pkg]
            if (d == null) { d = Draft(slugOf(pkg), moduleIdOf(pkg), pkg, pkg, "", ArrayList(), false, "tracker"); cards.add(d); byPkg[pkg] = d }
            if (d.source == "tracker") d.add(listOf(t.id))
        }
        return cards.map { it.build() }
    }
}
