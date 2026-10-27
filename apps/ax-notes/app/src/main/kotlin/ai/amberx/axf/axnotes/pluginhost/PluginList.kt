package ai.amberx.axf.axnotes.pluginhost

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * AX Notes plugin list (pure). Each plugin is a Gradle module under apps/ax-notes/plugins/<folder>/; its install.mjs
 * adds the include + app dependency (marked `axf-plugin:<folder>`) and its entry in app/src/main/assets/axnotes/plugins.json
 * (`axnotes-plugins@1`, written by lifecycle.mjs). The app creates each entry module by class name ([PluginLoader]).
 */

/** One installed plugin: plugin@1 id, folder, entry module class, and the KV prefix its data on the phone lives under. */
data class PluginEntry(val id: String, val folder: String, val entry: String, val dataPrefix: String)

object PluginList {
    const val FORMAT = "axnotes-plugins@1"
    const val ASSET = "axnotes/plugins.json"
    /** Entry classes are only ever loaded from the plugins package. */
    const val ENTRY_PACKAGE = "ai.amberx.axf.axnotes.plugins."
    private val FOLDER = Regex("^[a-z0-9][a-z0-9-]{0,63}$")
    private val ID = Regex("^[a-z][a-z0-9-]*(\\.[a-z0-9][a-z0-9-]*)+$")
    private val ENTRY = Regex("^ai\\.amberx\\.axf\\.axnotes\\.plugins\\.[a-z0-9_.]+\\.[A-Z][A-Za-z0-9_]*$")
    private val json = Json { ignoreUnknownKeys = true }

    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** The installed plugins; malformed entries and repeated ids / folders are skipped. Never throws. */
    fun parse(text: String): List<PluginEntry> {
        val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return emptyList()
        if (str(root, "\$axf") != FORMAT) return emptyList()
        val out = ArrayList<PluginEntry>()
        for (e in (root["plugins"] as? JsonArray).orEmpty()) {
            val o = e as? JsonObject ?: continue
            val id = str(o, "id") ?: continue
            val folder = str(o, "folder") ?: continue
            val entry = str(o, "entry") ?: continue
            if (!ID.matches(id) || !FOLDER.matches(folder) || !ENTRY.matches(entry)) continue
            // A plugin's data prefix is its folder name + "." (never empty, never another plugin's).
            val prefix = str(o, "dataPrefix")?.takeIf { it == "$folder." } ?: "$folder."
            if (out.any { it.id == id || it.folder == folder }) continue
            out += PluginEntry(id, folder, entry, prefix)
        }
        return out
    }

    /** Recorded as `folder` list in the KV store between launches. */
    fun encodeFolders(entries: List<PluginEntry>): String = JsonArray(entries.map { JsonPrimitive(it.folder) }).toString()
    fun decodeFolders(s: String?): List<String> =
        runCatching { (json.parseToJsonElement(s ?: "[]") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content?.takeIf { f -> FOLDER.matches(f) } } }.getOrNull() ?: emptyList()

    /** Folders installed on an earlier launch that aren't any more: their data on the phone is purged. */
    fun removed(before: List<String>, now: List<PluginEntry>): List<String> = before.filter { f -> now.none { it.folder == f } }.distinct()

    /** KV keys that belong to a removed plugin (its `<folder>.` prefix). */
    fun keysOf(folder: String, keys: Collection<String>): List<String> = keys.filter { it.startsWith("$folder.") }
}
