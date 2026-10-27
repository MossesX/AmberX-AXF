package ai.amberx.axf.axnotes

import android.content.Context
import ai.amberx.axf.ai.AiModule
import ai.amberx.axf.ai.AiService
import ai.amberx.axf.axnotes.capture.CaptureController
import ai.amberx.axf.axnotes.capture.CaptureState
import ai.amberx.axf.axnotes.capture.HubNoteAi
import ai.amberx.axf.axnotes.capture.LocalTriggerSink
import ai.amberx.axf.axnotes.capture.MicForeground
import ai.amberx.axf.axnotes.capture.NoAi
import ai.amberx.axf.axnotes.capture.NoCapture
import ai.amberx.axf.axnotes.capture.NoteAi
import ai.amberx.axf.axnotes.capture.NoteCapture
import ai.amberx.axf.axnotes.capture.ScreenSpeaker
import ai.amberx.axf.axnotes.capture.Speaker
import ai.amberx.axf.axnotes.capture.SpeechSpeaker
import ai.amberx.axf.axnotes.capture.StoreTriggerSink
import ai.amberx.axf.axnotes.capture.TriggerData
import ai.amberx.axf.axnotes.capture.TriggerSink
import ai.amberx.axf.axnotes.capture.VoiceLoop
import ai.amberx.axf.axnotes.data.HubEndpoint
import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.axnotes.data.UnwiredHubSync
import ai.amberx.axf.axnotes.host.PluginHost
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.axnotes.model.NoteTriggers
import ai.amberx.axf.axnotes.model.NotesCodec
import ai.amberx.axf.axnotes.model.TriggerDef
import ai.amberx.axf.axnotes.overlay.NotesOverlay
import ai.amberx.axf.axnotes.service.MicService
import ai.amberx.axf.axnotes.views.Selection
import ai.amberx.axf.data.JsonDocumentStore
import ai.amberx.axf.data.PreferenceStore
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
import ai.amberx.axf.kernel.module.ExtensionRegistry
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.notifications.NotificationsModule
import ai.amberx.axf.onboarding.OnboardingModule
import ai.amberx.axf.onboarding.OnboardingSpec
import ai.amberx.axf.onboarding.OnboardingWording
import ai.amberx.axf.onboarding.PermissionRequest
import ai.amberx.axf.overlay.OverlayHost
import ai.amberx.axf.overlay.OverlayModule
import ai.amberx.axf.settings.SettingsEngine
import ai.amberx.axf.speech.AxfSpeech
import ai.amberx.axf.speech.SpeechModule
import ai.amberx.axf.speech.SpeechTriggers
import ai.amberx.axf.triggers.AxfTriggers
import ai.amberx.axf.triggers.TriggersModule
import ai.amberx.axf.triggers.VoiceTriggerBridge
import ai.amberx.axf.ui.ViewContribution
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.VoiceArming
import ai.amberx.axf.voice.VoiceModule
import ai.amberx.axf.voice.VoiceResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * AX Notes' own module: the offline notes store (+ axHub sync adapter), the capture flow with its trigger data,
 * routes, actions, the AX Notes settings group, the overlay content and the plugin host hooks.
 *
 * Each app-local seam (capture/Interfaces.kt) gets its library when that library's module is installed and keeps its
 * stand-in otherwise, so the app runs with any library or plugin missing (plain voice notes + read-back on screen):
 *   NoteCapture → lib-voice (VoiceLoop: engine + dictate, MicService keeps it alive in the background)
 *   Speaker     → lib-speech (AxfSpeech reading queue)
 *   TriggerSink → lib-triggers (trigger store, permanent triggers from assets/axnotes/triggers.json) + the kernel
 *                 TriggerRegistry, matched by lib-triggers' VoiceTriggerBridge (log → the overlay)
 *   NoteAi      → lib-ai (AiService, mode ai.chat)
 *   NotesHubSync stays UnwiredHubSync: there is no lib-hub data client yet (Settings shows that sync is off).
 */
class AppModule(private val context: Context, private val scope: CoroutineScope, val plugins: PluginHost) : BaseModule(ID, "AX Notes") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.data")
    override val optionalDependsOn: List<String> = listOf(
        NotificationsModule.ID, VoiceModule.ID, SpeechModule.ID, TriggersModule.ID, AiModule.ID, OverlayModule.ID, OnboardingModule.ID,
    )

    lateinit var store: NotesStore
        private set
    lateinit var capture: CaptureController
        private set
    /** The library-backed pieces (null when the library isn't installed). */
    var voiceLoop: VoiceLoop? = null
        private set
    var hubAi: HubNoteAi? = null
        private set
    var notesOverlay: NotesOverlay? = null
        private set
    private var bridge: VoiceTriggerBridge? = null
    private var storeSink: StoreTriggerSink? = null
    private var speech: AxfSpeech? = null
    private var triggers: AxfTriggers? = null
    private var runtime: AxfRuntime? = null
    private var kv: KeyValueStore? = null
    private var config: Config? = null
    private var extensions: ExtensionRegistry? = null

    override fun register(ctx: ModuleContext) {
        val docs = ctx.service(JsonDocumentStore::class) ?: JsonDocumentStore(null, context)
        config = ctx.service(Config::class)
        val hub = HubOrigin.normalize(config?.string(KEY_HUB)) ?: HubOrigin.DEFAULT
        // No lib-hub data client exists yet (PORTING.md "lib-hubstore … Kotlin twin deferred"): every change stays queued
        // on the phone, and Settings → AX Notes says sync is off.
        store = NotesStore(docs, scope, UnwiredHubSync(HubEndpoint(hub)))
        ctx.services.register(NotesStore::class, store, "axnotes.store")
        store.load()
        ctx.services.register(Selection::class, Selection(), "axnotes.selection")
        ctx.services.register(PluginHost::class, plugins, "axnotes.plugins")
        extensions = ctx.extensions
        ctx.extensions.declare(PluginHost.MINI_SCREENS)

        val rt = ctx.service(AxfRuntime::class)
        runtime = rt
        kv = ctx.service(KeyValueStore::class)
        val voice = ctx.service(AxfVoice::class)
        speech = ctx.service(AxfSpeech::class)
        triggers = ctx.service(AxfTriggers::class)
        val registry = ctx.service(TriggerRegistry::class)
        val ai = ctx.service(AiService::class)
        val overlay = ctx.service(OverlayHost::class)

        // ---- seams: library when installed, stand-in otherwise
        val loop = voice?.let { VoiceLoop(it, scope, micForeground()) }
        voiceLoop = loop
        val noteCapture: NoteCapture = loop ?: NoCapture()
        val speaker: Speaker = speech?.let { SpeechSpeaker(it) } ?: ScreenSpeaker()
        val sink: TriggerSink = triggers?.let { t -> StoreTriggerSink(t, ID).also { storeSink = it } } ?: LocalTriggerSink()
        hubAi = ai?.let { HubNoteAi(it, kv) }
        val noteAi: NoteAi = hubAi ?: NoAi()

        capture = CaptureController(store, scope, noteCapture, speaker, sink, noteAi, loadTriggers(), { route -> rt?.navigate(route) })
        ctx.services.register(CaptureController::class, capture, "axnotes.capture")
        if (loop != null) {
            ctx.services.register(VoiceLoop::class, loop, "axnotes.voice-loop")
            loop.attach(capture)
            loop.speaking = { (speaker as? SpeechSpeaker)?.speaking == true }
            MicService.onStopRequest = { loop.releaseAll() }
        }

        // ---- speech@1 controls ("pause", "skip"…) live in the trigger store too, so their thresholds persist
        triggers?.store?.registerPermanent(SpeechModule.ID, SpeechTriggers.all(SpeechModule.ID))

        // ---- overlay (lib-overlay): chips, log, threshold card, mini screen, quick action
        if (overlay != null) notesOverlay = NotesOverlay(
            overlay, scope, capture, loop, store,
            aiReply = hubAi?.reply ?: kotlinx.coroutines.flow.MutableStateFlow<String?>(null),
            aiOn = { hubAi?.available == true },
            armed = { bridge?.decider?.arming?.isArmed(System.currentTimeMillis()) == true },
            triggers = triggers, registry = registry,
            miniScreens = { extensions?.get(PluginHost.MINI_SCREENS) ?: emptyList<ViewContribution>() },
        )

        // ---- the trigger host: lib-voice results → lib-triggers bridge on the kernel registry (app + speech + plugins)
        val t = triggers
        if (loop != null && voice != null && t != null) {
            val b = VoiceTriggerBridge(
                results = voice.engine().results,
                arming = VoiceArming(voice.armingConfig()),
                triggers = { registry?.list()?.filter { it.kind == TriggerKinds.VOICE } ?: t.store.triggers() },
                context = { triggerContext() },
                sensitivity = { voice.sensitivity },
                log = { e -> notesOverlay?.log(e) },
            )
            bridge = b
            loop.router = VoiceLoop.Router { r -> route(b, voice, r) }
        }

        for (r in ROUTES) ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(r.first, r.second, icon = r.third, module = id)))
        registerActions(ctx, rt)
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(settingsGroup(overlay != null, loop != null)))
        capture.start()
    }

    override suspend fun start(ctx: ModuleContext) {
        // Uninstalled plugins: their KV data and saved settings go. lib-settings' PreferenceStore has no raw-key remove
        // (remove() only takes scoped PrefKeys), so saved values are blanked: an empty value reads as the default.
        val prefs = ctx.service(PreferenceStore::class)
        val gone = plugins.purgeRemoved(kv) { prefix ->
            val p = prefs ?: return@purgeRemoved
            for (k in p.snapshot().keys) if (k.startsWith(prefix)) p.setRaw(k, "")
        }
        if (gone.isNotEmpty()) runtime?.toast("Removed the data of ${gone.size} uninstalled plugin(s).", ToastKind.INFO)
        notesOverlay?.install()
        val settings = ctx.service(SettingsEngine::class)
        settings?.onChange { key, value -> if (key == KEY_HANDS_FREE) voiceLoop?.setHandsFree((value as? JsonPrimitive)?.content == "true") }
        if ((settings?.bool(KEY_HANDS_FREE) ?: config?.bool(KEY_HANDS_FREE)) == true) voiceLoop?.setHandsFree(true)
    }

    override suspend fun stop(ctx: ModuleContext) {
        notesOverlay?.uninstall()
        voiceLoop?.releaseAll()
        MicService.onStopRequest = null
    }

    // ---------------------------------------------------------------- voice → triggers

    /**
     * The trigger context: a plugin's mini screen showing in the open overlay (`<ctx>.mini` → `<ctx>`, e.g. ai-chat's
     * chat), else the current route (the chat screen's route is `ai-chat` too). Free speech goes to `<context>.say`.
     */
    private fun triggerContext(): String = notesOverlay?.miniContext() ?: runtime?.current?.view ?: Selection.ROUTE_HOME

    /** One final utterance outside dictation: the bridge decides (log → overlay); a fired command runs; else free speech. */
    private fun route(b: VoiceTriggerBridge, voice: AxfVoice, r: VoiceResult) {
        val cfg = voice.armingConfig()
        if (b.decider.arming.config != cfg) b.decider.arming.config = cfg
        val step = b.process(r)
        val fired = step.fired
        if (fired != null) { runCommand(fired); return }
        if (step.entry.dropped != null) return
        // Nothing matched: the current screen may take free speech (`<route>.say`, e.g. a plugin's chat mode).
        val rt = runtime ?: return
        val say = triggerContext() + PluginHost.SAY_SUFFIX
        if (rt.actions.has(say)) rt.dispatch(say, JsonObject(mapOf("text" to JsonPrimitive(r.text))).toString())
    }

    /** A fired trigger: AX Notes' own → the controller; speech@1 controls → the reader; the rest → lib-triggers' run (action bus / settings). */
    private fun runCommand(cmd: TriggerCommand) {
        val sp = speech
        if (sp != null && sp.player.active && !cmd.action.startsWith("speech.")) return // never act on our own read-back
        if (storeSink?.deliver(cmd) == true) return
        if (sp?.handle(cmd) == true) return
        val t = triggers ?: return
        scope.launch { runCatching { t.run(cmd) } }
    }

    // ---------------------------------------------------------------- actions

    private fun registerActions(ctx: ModuleContext, rt: AxfRuntime?) {
        fun action(aid: String, label: String, params: Boolean = false, fn: (String?) -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(aid, ActionMeta(label, module = id, params = params)) { _, a -> fn(a.payload) })
        action("axnotes.takeNote", "Take a note") { rt?.navigate(Selection.ROUTE_CAPTURE); capture.startDictation() }
        action(ACTION_DICTATION, "Start or stop dictating a note") { if (capture.state.value is CaptureState.Dictating) capture.finishDictation() else capture.startDictation() }
        action(ACTION_HANDS_FREE, "Listen hands-free on or off") { voiceLoop?.let { it.setHandsFree(!it.handsFree) } ?: rt?.toast("Voice isn't installed in this build.", ToastKind.WARNING) }
        action(ACTION_OVERLAY, "Show the AX Notes overlay") {
            val o = ctx.service(OverlayHost::class)
            if (o == null) rt?.toast("The overlay isn't installed in this build.", ToastKind.WARNING)
            else if (!o.canDraw()) { rt?.toast("Allow AX Notes to draw over other apps first.", ToastKind.INFO); o.requestPermission() }
            else { notesOverlay?.install(); o.show() }
        }
        action("axnotes.sync", "Sync notes with axHub") {
            if (!store.sync.ready) rt?.toast("axHub sync is off in this version: notes stay on this phone (${store.pending.value} change(s) waiting).", ToastKind.INFO)
            store.syncNow()
        }
        // triggers@1: every AX Notes trigger fires this; custom triggers can too (payload = the command args).
        action(TriggerData.ACTION, "AX Notes voice command", params = true) { p ->
            val args = parseObject(p) ?: return@action
            storeSink?.deliver(TriggerCommand("", TriggerData.ACTION, args))
        }
        // Plugin host actions (PluginHost): save a note for a plugin; the announcement plugins watch.
        action(PluginHost.ACTION_SAVE_NOTE, "Save a note (from a plugin)", params = true) { p ->
            val o = parseObject(p) ?: return@action
            val text = str(o, "text")
            if (text.isBlank()) return@action
            val source = when (str(o, "source").lowercase()) { "voice" -> NoteSource.VOICE; "typed" -> NoteSource.TYPED; else -> NoteSource.AI }
            val tags = (o["tags"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
            store.createNote(text, title = str(o, "title").ifBlank { null }, categoryName = str(o, "category").ifBlank { null }, tags = tags, source = source)
        }
        action(PluginHost.ACTION_NOTE_SAVED, "A note was saved (plugins watch this)", params = true) { }
        store.onCreated = { n -> announce(n) }
    }

    private fun announce(n: Note) {
        val rt = runtime ?: return
        scope.launch { runCatching { rt.dispatch(PluginHost.ACTION_NOTE_SAVED, NotesCodec.noteJson(n).toString()) } }
        notesOverlay?.note("Saved: ${n.title}", "note")
    }

    // ---------------------------------------------------------------- settings

    private fun settingsGroup(hasOverlay: Boolean, hasVoice: Boolean): SettingsGroup = SettingsGroup(ID, "AX Notes", "edit", id, order = 25,
        description = "Notes are kept on this phone. Sync with axHub is OFF in this version (no hub data client yet): changes wait on the phone.",
        settings = buildList {
            if (hasVoice) add(SettingSpec(KEY_HANDS_FREE, "Listen hands-free", SettingKind.TOGGLE, "Keep the microphone on for voice commands, also in the background (a notification shows while it listens)", JsonPrimitive(false), icon = "mic"))
            if (hasOverlay) add(SettingSpec("axnotes.overlay.show", "Show the AX Notes overlay", SettingKind.ACTION, "The pill over other apps: what was heard, your last note, the mic button", target = ACTION_OVERLAY, icon = "layers"))
            add(SettingSpec(KEY_SYNC_STATE, "axHub sync: off", SettingKind.ACTION, "Not wired yet: there is no lib-hub data client. Notes and lists stay on this phone and are queued for later.", target = "axnotes.sync", icon = "cloud"))
            add(SettingSpec(KEY_HUB, "axHub address (for later)", SettingKind.TEXT, "Where notes will sync once sync is wired (project ax-notes data)", JsonPrimitive(HubOrigin.DEFAULT), icon = "cloud"))
        })

    // ---------------------------------------------------------------- helpers

    private fun micForeground(): MicForeground = object : MicForeground {
        override fun start(): Boolean = MicService.start(context)
        override fun stop() { MicService.stop(context) }
    }

    /** The shipped trigger data (assets/axnotes/triggers.json); the same set in code if it can't be read. */
    private fun loadTriggers(): List<TriggerDef> =
        runCatching { context.assets.open(TRIGGERS_ASSET).bufferedReader().use { it.readText() } }.getOrNull()?.let { NotesCodec.triggers(it) } ?: NoteTriggers.DEFAULTS

    private fun parseObject(s: String?): JsonObject? = s?.let { runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull() }
    private fun str(o: JsonObject, k: String): String = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()

    companion object {
        const val TRIGGERS_ASSET = "axnotes/triggers.json"
        const val ID = "ai.amberx.axf.axnotes"
        const val KEY_HUB = "axnotes.hub"
        const val KEY_HANDS_FREE = "axnotes.listen.handsFree"
        const val KEY_SYNC_STATE = "axnotes.sync.state"
        const val ACTION_DICTATION = "axnotes.dictation"
        const val ACTION_HANDS_FREE = "axnotes.handsFree"
        const val ACTION_OVERLAY = "axnotes.overlay"
        private val json = Json { ignoreUnknownKeys = true }

        val ROUTES: List<Triple<String, String, String>> = listOf(
            Triple("home", "Notes", "edit"),
            Triple("editor", "Note", "edit"),
            Triple("capture", "Speak", "mic"),
            Triple("lists", "Lists", "list"),
            Triple("list", "List", "list"),
            Triple("todo-item", "To-do", "check-circle"),
        )

        /** lib-onboarding: what AX Notes asks for on first run, in order, and why. */
        val ONBOARDING: OnboardingSpec = OnboardingSpec(
            appId = "ax-notes", appName = "AX Notes",
            requests = listOf(
                PermissionRequest.microphone("Hears your notes and voice commands. Speech is recognised on the phone."),
                PermissionRequest.notifications("Shows that AX Notes is listening while it runs in the background.", required = false),
                PermissionRequest.overlay("Shows the AX Notes pill over other apps: what it heard, your last note, the mic button.", required = false),
                PermissionRequest.battery("Stops battery saving from cutting off hands-free listening."),
            ),
            wording = OnboardingWording(headline = "Notes, hands-free.", intro = "Say “take a note”, talk, say “end note”. AX Notes needs the microphone for that; the rest is optional."),
        )
    }
}
