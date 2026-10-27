package ai.amberx.axf.axnotes

import android.content.Context
import ai.amberx.axf.axnotes.capture.CaptureController
import ai.amberx.axf.axnotes.capture.LocalTriggerSink
import ai.amberx.axf.axnotes.capture.NoAi
import ai.amberx.axf.axnotes.capture.NoCapture
import ai.amberx.axf.axnotes.capture.ScreenSpeaker
import ai.amberx.axf.axnotes.data.HubEndpoint
import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.axnotes.data.UnwiredHubSync
import ai.amberx.axf.axnotes.model.NoteTriggers
import ai.amberx.axf.axnotes.model.NotesCodec
import ai.amberx.axf.axnotes.model.TriggerDef
import ai.amberx.axf.axnotes.views.Selection
import ai.amberx.axf.data.JsonDocumentStore
import ai.amberx.axf.hub.HubOrigin
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.json.JsonPrimitive

/**
 * AX Notes' own module: the offline notes store (+ axHub sync adapter), the capture flow with its trigger data,
 * routes, actions and the AX Notes settings group. Framework pieces come from the libraries listed in App.kt.
 *
 * App-local seams the parent build wires to libraries (capture/Interfaces.kt): NoteCapture → lib-voice, Speaker →
 * lib-speech, TriggerSink → lib-triggers (triggers@1), NoteAi → lib-ai; data/NotesHubSync → lib-hub data client.
 */
class AppModule(private val context: Context, private val scope: CoroutineScope) : BaseModule(ID, "AX Notes") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.data")
    lateinit var store: NotesStore
        private set
    lateinit var capture: CaptureController
        private set

    override fun register(ctx: ModuleContext) {
        val docs = ctx.service(JsonDocumentStore::class) ?: JsonDocumentStore(null, context)
        val hub = HubOrigin.normalize(ctx.service(Config::class)?.string(KEY_HUB)) ?: HubOrigin.DEFAULT
        // TODO(lib-hub data client): replace UnwiredHubSync with the lib-hub backed adapter (see data/NotesHubSync.kt).
        store = NotesStore(docs, scope, UnwiredHubSync(HubEndpoint(hub)))
        ctx.services.register(NotesStore::class, store, "axnotes.store")
        store.load()
        ctx.services.register(Selection::class, Selection(), "axnotes.selection")

        val runtime = ctx.service(AxfRuntime::class)
        // TODO(lib-voice s6 / lib-speech s8 / lib-triggers s4+s7 / lib-ai s5+s10): swap these placeholders for the library-backed ones.
        capture = CaptureController(store, scope, NoCapture(), ScreenSpeaker(), LocalTriggerSink(), NoAi(), loadTriggers(), { route -> runtime?.navigate(route) })
        ctx.services.register(CaptureController::class, capture, "axnotes.capture")
        capture.start()

        for (r in ROUTES) ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(r.first, r.second, icon = r.third, module = id)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("axnotes.takeNote", ActionMeta("Take a note", module = id)) { _, _ -> runtime?.navigate(Selection.ROUTE_CAPTURE); capture.startDictation() })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("axnotes.sync", ActionMeta("Sync notes with axHub", module = id)) { _, _ -> store.syncNow() })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup(ID, "AX Notes", "edit", id, order = 25,
            description = "Where your notes sync. They are always kept on this phone first.", settings = listOf(
                SettingSpec(KEY_HUB, "axHub address", SettingKind.TEXT, "Notes and lists sync to this hub's ax-notes project data", JsonPrimitive(HubOrigin.DEFAULT), icon = "cloud"),
                SettingSpec("axnotes.syncNow", "Sync now", SettingKind.ACTION, "Send waiting changes and fetch the hub's", target = "axnotes.sync", icon = "refresh"),
            ))))
    }

    /** The shipped trigger data (assets/axnotes/triggers.json); the same set in code if it can't be read. */
    private fun loadTriggers(): List<TriggerDef> =
        runCatching { context.assets.open(TRIGGERS_ASSET).bufferedReader().use { it.readText() } }.getOrNull()?.let { NotesCodec.triggers(it) } ?: NoteTriggers.DEFAULTS

    companion object {
        const val TRIGGERS_ASSET = "axnotes/triggers.json"
        const val ID = "ai.amberx.axf.axnotes"
        const val KEY_HUB = "axnotes.hub"
        val ROUTES: List<Triple<String, String, String>> = listOf(
            Triple("home", "Notes", "edit"),
            Triple("editor", "Note", "edit"),
            Triple("capture", "Speak", "mic"),
        )
    }
}
