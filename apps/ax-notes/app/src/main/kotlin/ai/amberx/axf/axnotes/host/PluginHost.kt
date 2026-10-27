package ai.amberx.axf.axnotes.host

import android.content.Context
import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.kernel.module.ExtensionPoint
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.ui.ViewContribution
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * App-side plugin host. AX Notes plugins (apps/ax-notes/plugins/<folder>/, plugin@1, kind `module`) are Gradle modules
 * their own install.mjs wires in; each one adds a row to `assets/axnotes/plugins.json` (`axnotes-plugins@1`). The app
 * never names a plugin class in code: [load] instantiates every listed `entry` by name and skips what isn't there, so the
 * app builds and runs the same with every plugin removed (no list, or a class missing from the APK).
 *
 * Plugins talk to the app only through generic hooks:
 *  - kernel extension points: routes, views, actions, menu items, settings groups (a group with `tab = <plugin tab>`
 *    is that plugin's sub-tab under Settings → Plugins), triggers in the kernel TriggerRegistry (the app's voice
 *    host matches them, context = the current route);
 *  - [MINI_SCREENS]: composables for the overlay's mini screen (one tab each);
 *  - host actions on the action bus: [ACTION_SAVE_NOTE] (payload `{title?, text, tags?, category?, source?}`) and
 *    [ACTION_NOTE_SAVED] (dispatched after every new note with the note as JSON; plugins watch it with a
 *    non-consuming interceptor), and free speech: when nothing matched and the current route `<r>` has an action
 *    `<r>.say`, the heard text goes there as `{text}` (e.g. ai-chat's chat mode).
 * A plugin keeps its device data under KV keys (and saved settings) starting with its `dataPrefix`; [purgeRemoved]
 * clears them for plugins that are no longer listed.
 */
class PluginHost(private val context: Context) {
    /** One row of plugins.json. */
    data class Entry(val id: String, val folder: String, val entry: String, val dataPrefix: String, val version: String)

    /** What happened to a listed plugin at start. */
    data class Loaded(val entry: Entry, val module: AxfModule?, val error: String?) {
        val ok: Boolean get() = module != null
    }

    private var loaded: List<Loaded> = emptyList()
    val plugins: List<Loaded> get() = loaded
    /** Module ids of the plugins that loaded (their settings groups belong in Settings → Plugins). */
    val moduleIds: Set<String> get() = loaded.mapNotNull { it.module?.id }.toSet()

    fun entries(): List<Entry> = parse(runCatching { context.assets.open(LIST_ASSET).bufferedReader().use { it.readText() } }.getOrNull())

    /** The listed plugins as kernel modules (call once, from App.modules()). Never throws. */
    fun load(): List<AxfModule> {
        loaded = entries().map { e -> instantiate(e) }
        return loaded.mapNotNull { it.module }
    }

    private fun instantiate(e: Entry): Loaded = try {
        val cls = Class.forName(e.entry)
        if (!AxfModule::class.java.isAssignableFrom(cls)) Loaded(e, null, "${e.entry} isn't an AxfModule")
        else {
            val ctorContext = cls.constructors.firstOrNull { it.parameterTypes.size == 1 && it.parameterTypes[0].isAssignableFrom(Context::class.java) }
            val instance = if (ctorContext != null) ctorContext.newInstance(context.applicationContext) else cls.getDeclaredConstructor().newInstance()
            Loaded(e, instance as AxfModule, null)
        }
    } catch (t: Throwable) {
        Loaded(e, null, "${t.javaClass.simpleName}: ${t.message ?: e.entry}")
    }

    /**
     * Deletes the device data of plugins that were listed on an earlier start and aren't any more: KV keys under their
     * `dataPrefix` here, saved settings under the same prefix through [clearSettings] (the caller has the preference
     * store). Then remembers the current list. Returns id → prefix of what it cleaned up.
     */
    suspend fun purgeRemoved(kv: KeyValueStore?, clearSettings: suspend (prefix: String) -> Unit = {}): Map<String, String> {
        val store = kv ?: return emptyMap()
        val now = entries().associate { it.id to it.dataPrefix }
        val before = decodeKnown(store.get(KEY_KNOWN))
        val gone = before.filterKeys { it !in now }.filterValues { it.length >= MIN_PREFIX }
        for ((_, prefix) in gone) {
            store.keys().filter { it.startsWith(prefix) }.forEach { store.remove(it) }
            runCatching { clearSettings(prefix) }
        }
        store.put(KEY_KNOWN, encodeKnown(now))
        return gone
    }

    companion object {
        const val LIST_ASSET: String = "axnotes/plugins.json"
        const val FORMAT: String = "axnotes-plugins@1"
        const val KEY_KNOWN: String = "axnotes.plugins.known"
        const val ACTION_SAVE_NOTE: String = "axnotes.notes.save"
        const val ACTION_NOTE_SAVED: String = "axnotes.notes.saved"
        /** Free speech goes to `<route>.say` when the current route has one. */
        const val SAY_SUFFIX: String = ".say"
        /** A prefix shorter than this ("a.") is never purged: too likely to hit someone else's keys. */
        private const val MIN_PREFIX = 3

        /** Mini-screen contributions (id, title, icon, content); the overlay shows one tab per contribution. */
        val MINI_SCREENS: ExtensionPoint<ViewContribution> = ExtensionPoint("axnotes.mini-screens", ViewContribution::class, "Composables a plugin offers for the overlay's mini screen")

        private val json = Json { ignoreUnknownKeys = true }
        private fun str(o: JsonObject, k: String): String = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()

        /** Pure: plugins.json → entries (rows without an id or entry class are dropped). */
        fun parse(text: String?): List<Entry> {
            val root = text?.let { runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull() } ?: return emptyList()
            val rows = root["plugins"] as? JsonArray ?: return emptyList()
            return rows.mapNotNull { r ->
                val o = r as? JsonObject ?: return@mapNotNull null
                val id = str(o, "id"); val entry = str(o, "entry")
                if (id.isBlank() || entry.isBlank()) null
                else Entry(id, str(o, "folder").ifBlank { id.substringAfterLast('.') }, entry, str(o, "dataPrefix"), str(o, "version").ifBlank { "0.0.0" })
            }.distinctBy { it.id }
        }

        fun encodeKnown(m: Map<String, String>): String = JsonObject(m.mapValues { JsonPrimitive(it.value) }).toString()
        fun decodeKnown(s: String?): Map<String, String> =
            (s?.let { runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull() } ?: JsonObject(emptyMap()))
                .mapNotNull { (k, v) -> (v as? JsonPrimitive)?.content?.let { k to it } }.toMap()
    }
}
