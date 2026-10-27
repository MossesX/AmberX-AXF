package ai.amberx.axf.axnotes.pluginhost

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import ai.amberx.axf.kernel.triggers.Trigger

/*
 * AX Notes plugin host (pure part). AX Notes plugins live in apps/ax-notes/plugins/<folder>/ (plugin@1 manifest, Kotlin
 * sources, assets, tests, install.mjs + uninstall.mjs). The installed set is app/src/main/assets/axnotes/plugins.json
 * (`axnotes-plugins@1`): Gradle compiles only the plugins listed there, and the app instantiates their entry modules
 * from the same file ([PluginHost]). With the list empty (or the file gone) the app runs exactly as without plugins.
 */

/** One installed plugin: plugin@1 id, its folder under apps/ax-notes/plugins, and its entry module class. */
data class PluginEntry(val id: String, val folder: String, val entry: String)

/**
 * What a plugin leaves on the phone. The host records it every launch; when a plugin is no longer installed, the host
 * purges everything listed here on the next launch (and a plugin's own "Remove plugin data" action does the same).
 */
data class PluginFootprint(
    val id: String,
    val folder: String,
    /** JsonDocumentStore module folder that holds all of the plugin's own data. */
    val dataModule: String,
    /** The plugin's setting keys. Each starts with `app.` ([PluginFootprint.APP_SCOPE]) so the host can delete it. */
    val settingKeys: List<String> = emptyList(),
    /** Ids of lists the plugin generates (deleted with it). Notes and lists it made for the user are kept. */
    val listIdPrefixes: List<String> = emptyList(),
    /** Module id its triggers@1 records are registered under. */
    val triggerModule: String = id,
) {
    fun toJson(): JsonObject = JsonObject(linkedMapOf(
        "\$axf" to JsonPrimitive(FORMAT), "id" to JsonPrimitive(id), "folder" to JsonPrimitive(folder), "dataModule" to JsonPrimitive(dataModule),
        "settingKeys" to JsonArray(settingKeys.map(::JsonPrimitive)), "listIdPrefixes" to JsonArray(listIdPrefixes.map(::JsonPrimitive)),
        "triggerModule" to JsonPrimitive(triggerModule),
    ))

    companion object {
        const val FORMAT = "axnotes-plugin-footprint@1"
        /** Setting keys of plugins start with this (PreferenceStore stores `<scope>.<name>`, so `app.x` = scope APP, name `x`). */
        const val APP_SCOPE = "app."

        fun parse(o: JsonObject): PluginFootprint? {
            val id = J.str(o, "id") ?: return null
            val folder = J.str(o, "folder") ?: return null
            val data = J.str(o, "dataModule") ?: return null
            if (!PluginList.isFolder(folder) || !data.startsWith(PluginList.DATA_PREFIX)) return null
            return PluginFootprint(id, folder, data, J.strings(o["settingKeys"]).filter { it.startsWith(APP_SCOPE) },
                J.strings(o["listIdPrefixes"]).filter { it.length >= 4 }, J.str(o, "triggerModule") ?: id)
        }
    }
}

object PluginList {
    const val FORMAT = "axnotes-plugins@1"
    const val ASSET = "axnotes/plugins.json"
    /** Every plugin's data module starts with this, so a purge can never reach the app's own data. */
    const val DATA_PREFIX = "ai.amberx.axf.axnotes.plugin."
    /** Entry classes are only ever loaded from the plugins package. */
    const val ENTRY_PACKAGE = "ai.amberx.axf.axnotes.plugins."
    private val FOLDER = Regex("^[a-z0-9][a-z0-9-]{0,63}$")
    private val ID = Regex("^[a-z][a-z0-9-]*(\\.[a-z0-9][a-z0-9-]*)+$")
    private val ENTRY = Regex("^ai\\.amberx\\.axf\\.axnotes\\.plugins\\.[a-z0-9_.]+\\.[A-Z][A-Za-z0-9_]*$")
    private val json = Json { ignoreUnknownKeys = true; isLenient = false }

    fun isFolder(s: String): Boolean = FOLDER.matches(s)

    /** The installed plugins; malformed entries and repeated ids / folders are skipped. Never throws. */
    fun parse(text: String): List<PluginEntry> {
        val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return emptyList()
        if (J.str(root, "\$axf") != FORMAT) return emptyList()
        val out = ArrayList<PluginEntry>()
        for (e in (root["installed"] as? JsonArray).orEmpty()) {
            val o = e as? JsonObject ?: continue
            val id = J.str(o, "id") ?: continue
            val folder = J.str(o, "folder") ?: continue
            val entry = J.str(o, "entry") ?: continue
            if (!ID.matches(id) || !FOLDER.matches(folder) || !ENTRY.matches(entry)) continue
            if (out.any { it.id == id || it.folder == folder }) continue
            out += PluginEntry(id, folder, entry)
        }
        return out
    }

    /** Footprints recorded on an earlier launch whose plugin isn't installed any more: the host purges these. */
    fun removed(recorded: List<PluginFootprint>, installed: List<PluginEntry>): List<PluginFootprint> =
        recorded.filter { r -> installed.none { it.id == r.id } }
}

/** triggers@1 records a plugin ships (`{ "$axf": "axnotes-plugin-triggers@1", "triggers": [ … ] }`). Pure. */
object PluginTriggers {
    const val FORMAT = "axnotes-plugin-triggers@1"
    private val json = Json { ignoreUnknownKeys = true }

    /** Valid records owned by [module]; anything that doesn't validate (or claims another module) is dropped. */
    fun parse(text: String, module: String): List<Trigger> {
        val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return emptyList()
        if (J.str(root, "\$axf") != FORMAT) return emptyList()
        return J.objects(root["triggers"], 100).mapNotNull { Trigger.parse(it) }.filter { it.module == module }
    }
}
