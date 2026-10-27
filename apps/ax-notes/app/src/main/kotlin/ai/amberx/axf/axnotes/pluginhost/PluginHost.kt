package ai.amberx.axf.axnotes.pluginhost

import android.content.Context
import ai.amberx.axf.axnotes.AppModule
import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.data.JsonDocumentStore
import ai.amberx.axf.data.PreferenceStore
import ai.amberx.axf.data.PrefKey
import ai.amberx.axf.kernel.ai.AI_SESSION_CAPABILITY
import ai.amberx.axf.kernel.ai.AiModeRegistry
import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.ai.PlaceholderAiSessionClient
import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.SettingScope
import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.MenuContribution
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.platform.AxfLogger
import ai.amberx.axf.kernel.platform.FileArea
import ai.amberx.axf.kernel.platform.FileLayout
import ai.amberx.axf.kernel.platform.Log
import ai.amberx.axf.kernel.platform.NoopLogger
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import java.io.File

/**
 * Every AX Notes plugin's entry module implements this. It must have a no-argument constructor (the host creates it
 * from plugins.json), depend on [PluginHostModule.ID] and keep all of its data inside [footprint].
 */
interface AxNotesPlugin : AxfModule {
    val footprint: PluginFootprint
}

/** Reads assets/axnotes/plugins.json and creates the installed plugins' modules. A plugin that fails to load is skipped. */
class PluginHost(private val context: Context) {
    val installed: List<PluginEntry> by lazy {
        runCatching { context.assets.open(PluginList.ASSET).bufferedReader().use { it.readText() } }.getOrNull()?.let { PluginList.parse(it) } ?: emptyList()
    }
    /** Why a listed plugin didn't load (folder → reason); shown in the log at start. */
    val failed: MutableMap<String, String> = LinkedHashMap()

    val plugins: List<AxNotesPlugin> by lazy {
        installed.mapNotNull { e ->
            if (!e.entry.startsWith(PluginList.ENTRY_PACKAGE)) { failed[e.folder] = "entry outside the plugins package"; return@mapNotNull null }
            val m = runCatching { Class.forName(e.entry).getDeclaredConstructor().newInstance() }.getOrElse { failed[e.folder] = it.toString(); null }
            when {
                m == null -> null
                m !is AxNotesPlugin -> { failed[e.folder] = "${e.entry} is not an AxNotesPlugin"; null }
                m.id != e.id || m.footprint.folder != e.folder -> { failed[e.folder] = "id/folder don't match plugins.json"; null }
                !m.footprint.dataModule.startsWith(PluginList.DATA_PREFIX) -> { failed[e.folder] = "data module outside ${PluginList.DATA_PREFIX}"; null }
                else -> m
            }
        }
    }

    /** The host module first, then every plugin that loaded. Empty plugin list → just the host (which purges leftovers). */
    fun modules(scope: CoroutineScope): List<AxfModule> = listOf(PluginHostModule(context, scope, this)) + plugins
}

/**
 * What a plugin uses from the app: the notes store, AI (kernel contract only), its own data folder, settings values,
 * menus (application menu + nav menu), triggers and the purge. Registered as a service by [PluginHostModule].
 */
class PluginKit(private val ctx: ModuleContext, private val context: Context, val scope: CoroutineScope) {
    val store: NotesStore get() = ctx.require(NotesStore::class)
    val runtime: AxfRuntime? get() = ctx.service(AxfRuntime::class)
    private val logger: AxfLogger get() = ctx.service(AxfLogger::class) ?: NoopLogger

    fun log(module: String): Log = Log(logger, module.substringAfterLast('.'), module = module)

    /** The AI session client lib-ai registers; the kernel placeholder (never available) until then. Resolved per call. */
    fun ai(): AiAsk {
        val client = (ctx.services.capability(AI_SESSION_CAPABILITY) as? AiSessionClient) ?: ctx.service(AiSessionClient::class) ?: PlaceholderAiSessionClient
        val modes = ctx.service(AiModeRegistry::class)
        val policy = ctx.service(AiModePolicy::class) ?: AiAsk.LOCAL_POLICY
        return AiAsk(client, { modes?.list() ?: AiModes.BUILTINS }, policy)
    }

    fun data(fp: PluginFootprint): PluginData = PluginData(ctx.service(JsonDocumentStore::class) ?: JsonDocumentStore(null, context), fp.dataModule)

    fun setting(key: String, default: String): String = ctx.service(Config::class)?.string(key)?.takeIf { it.isNotEmpty() } ?: default
    fun settingBool(key: String, default: Boolean): Boolean = ctx.service(Config::class)?.string(key)?.toBooleanStrictOrNull() ?: default

    fun toast(message: String) { runCatching { runtime?.toast(message) } }

    /** Menu hooks: the item goes into both the application menu and the nav menu. */
    fun menus(module: String, items: List<MenuItem>) {
        for (i in items) for (menu in listOf(MENU_APP, MENU_NAV)) ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, module, MenuContribution(menu, item = i))
    }

    /** Registers a plugin's triggers@1 records shipped as an asset (`axnotes-plugin-triggers@1`); returns how many. */
    fun registerTriggers(module: String, asset: String): Int {
        val text = runCatching { context.assets.open(asset).bufferedReader().use { it.readText() } }.getOrNull() ?: return 0
        val triggers = PluginTriggers.parse(text, module)
        if (triggers.isNotEmpty()) ctx.service(TriggerRegistry::class)?.register(module, triggers)
        return triggers.size
    }

    /** Removes everything in [fp] from this phone: data folder, settings, generated lists, triggers. */
    suspend fun purge(fp: PluginFootprint) {
        if (!fp.dataModule.startsWith(PluginList.DATA_PREFIX)) return
        withContext(Dispatchers.IO) {
            val dir = runCatching { ctx.service(FileLayout::class)?.path(FileArea.DATA, fp.dataModule, "") }.getOrNull() ?: File(context.filesDir, "axf/${fp.dataModule}").path
            runCatching { File(dir).deleteRecursively() }
            val prefs = ctx.service(PreferenceStore::class)
            for (k in fp.settingKeys) if (k.startsWith(PluginFootprint.APP_SCOPE)) runCatching { prefs?.remove(PrefKey(k.removePrefix(PluginFootprint.APP_SCOPE), "", SettingScope.APP)) }
        }
        val s = ctx.service(NotesStore::class)
        if (s != null && fp.listIdPrefixes.isNotEmpty()) for (l in s.lists.value.filter { l -> fp.listIdPrefixes.any { l.id.startsWith(it) } }) s.deleteList(l.id)
        ctx.service(TriggerRegistry::class)?.unregister(fp.triggerModule)
    }

    companion object {
        const val MENU_APP = "app-menu"
        const val MENU_NAV = "nav-menu"
    }
}

/** A plugin's own documents (`<data>/<dataModule>/documents/<collection>/<id>.json`). Call from Dispatchers.IO. */
class PluginData(private val docs: JsonDocumentStore, private val module: String) {
    fun read(collection: String, id: String): JsonObject? = docs.read(module, collection, safe(id)).getOrNull()
    fun write(collection: String, id: String, doc: JsonObject) { docs.write(module, collection, safe(id), doc) }
    fun delete(collection: String, id: String): Boolean = docs.delete(module, collection, safe(id))
    fun ids(collection: String): List<String> = docs.list(module, collection)
    private fun safe(id: String) = id.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
}

/**
 * Hosts the plugins: registers [PluginKit], records each loaded plugin's footprint and, on launch, purges the
 * footprint of every plugin that was removed since (data folder, settings, generated lists, triggers).
 */
class PluginHostModule(private val context: Context, private val scope: CoroutineScope, private val host: PluginHost) : BaseModule(ID, "AX Notes plugins") {
    override val dependsOn: List<String> = listOf(AppModule.ID, "ai.amberx.axf.data")

    override fun register(ctx: ModuleContext) {
        ctx.services.register(PluginKit::class, PluginKit(ctx, context, scope), "axnotes.plugins")
    }

    override suspend fun start(ctx: ModuleContext) {
        val kit = ctx.require(PluginKit::class)
        val log = kit.log(ID)
        for ((folder, why) in host.failed) log.w("Plugin $folder didn't load: $why")
        val docs = ctx.service(JsonDocumentStore::class) ?: JsonDocumentStore(null, context)
        scope.launch(Dispatchers.IO) {
            val recorded = docs.list(ID, FOOTPRINTS).mapNotNull { docs.read(ID, FOOTPRINTS, it).getOrNull()?.let(PluginFootprint::parse) }
            val removed = PluginList.removed(recorded, host.installed)
            if (removed.isNotEmpty()) {
                kit.store.loaded.first { it }
                for (fp in removed) {
                    kit.purge(fp)
                    docs.delete(ID, FOOTPRINTS, fp.folder)
                    log.i("Removed plugin ${fp.id}: its data on this phone was deleted")
                }
            }
            for (p in host.plugins) docs.write(ID, FOOTPRINTS, p.footprint.folder, p.footprint.toJson())
        }
    }

    companion object {
        const val ID = "ai.amberx.axf.axnotes.pluginhost"
        const val FOOTPRINTS = "footprints"
    }
}
