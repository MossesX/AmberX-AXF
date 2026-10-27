package ai.amberx.axf.axnotes.pluginhost

import android.content.Context
import ai.amberx.axf.axnotes.AppModule
import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.platform.AxfLogger
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.Log
import ai.amberx.axf.kernel.platform.NoopLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Creates the installed plugins' entry modules from assets/axnotes/plugins.json. A plugin that fails to load is skipped
 * and logged; with no list (or an empty one) the app runs exactly as without plugins.
 */
class PluginLoader(private val context: Context) {
    val installed: List<PluginEntry> by lazy {
        runCatching { context.assets.open(PluginList.ASSET).bufferedReader().use { it.readText() } }.getOrNull()?.let { PluginList.parse(it) } ?: emptyList()
    }
    val failed: MutableMap<String, String> = LinkedHashMap()

    val plugins: List<AxfModule> by lazy {
        installed.mapNotNull { e ->
            val m = runCatching { Class.forName(e.entry).getDeclaredConstructor().newInstance() }.getOrElse { failed[e.folder] = it.toString(); null }
            when {
                m == null -> null
                m !is AxfModule -> { failed[e.folder] = "${e.entry} is not an AxfModule"; null }
                m.id != e.id -> { failed[e.folder] = "module id ${m.id} doesn't match plugins.json (${e.id})"; null }
                else -> m
            }
        }
    }

    /** The host module first, then every plugin that loaded. */
    fun modules(scope: CoroutineScope): List<AxfModule> = listOf(PluginHostModule(scope, this)) + plugins
}

/**
 * Remembers which plugins were installed; on the first launch after one was removed, deletes what it left on the phone:
 * every KV key under its `<folder>.` prefix and the lists it generated (ids starting with the same prefix).
 */
class PluginHostModule(private val scope: CoroutineScope, private val loader: PluginLoader) : BaseModule(ID, "AX Notes plugins") {
    override val dependsOn: List<String> = listOf(AppModule.ID)

    override suspend fun start(ctx: ModuleContext) {
        val log = Log(ctx.service(AxfLogger::class) ?: NoopLogger, "plugins", module = ID)
        for ((folder, why) in loader.failed) log.w("Plugin $folder didn't load: $why")
        val kv = ctx.service(KeyValueStore::class) ?: return
        val removed = PluginList.removed(PluginList.decodeFolders(kv.get(KEY_INSTALLED)), loader.installed)
        kv.put(KEY_INSTALLED, PluginList.encodeFolders(loader.installed))
        if (removed.isEmpty()) return
        val store = ctx.service(NotesStore::class)
        scope.launch(Dispatchers.IO) {
            for (f in removed) {
                for (k in PluginList.keysOf(f, kv.keys())) kv.remove(k)
                if (store != null) {
                    store.loaded.first { it }
                    for (l in store.lists.value.filter { it.id.startsWith("$f.") }) store.deleteList(l.id)
                }
                log.i("Plugin $f was removed: its data on this phone was deleted")
            }
        }
    }

    companion object {
        const val ID = "ai.amberx.axf.axnotes.pluginhost"
        const val KEY_INSTALLED = "axnotes.pluginhost.installed"
    }
}
