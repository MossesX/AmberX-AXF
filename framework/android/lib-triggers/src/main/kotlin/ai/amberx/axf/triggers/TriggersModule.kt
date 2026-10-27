package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionContext
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.triggers.SettingVoiceBinding
import ai.amberx.axf.kernel.triggers.TRIGGERS_CONTRACT
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.settings.SettingsEngine
import ai.amberx.axf.ui.AxfUiPoints
import ai.amberx.axf.ui.ViewContribution
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.VoiceArming
import ai.amberx.axf.voice.VoiceEngine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Outcome of [AxfTriggers.run]. */
public sealed interface TriggerRun {
    public data class Setting(val write: SettingWrite) : TriggerRun
    public data class Action(val result: AxfResult<Unit>) : TriggerRun
    public data class NoHost(val action: String) : TriggerRun
}

/**
 * Typed placeholder: syncing custom triggers and overrides to another device / axHub. Not built: [PlaceholderTriggerSync]
 * always answers NotImplemented(`axf.triggers.sync`).
 */
public interface TriggerSync {
    public suspend fun push(data: TriggerStoreData): AxfResult<Unit>
    public suspend fun pull(): AxfResult<TriggerStoreData>
}

public class PlaceholderTriggerSync : TriggerSync {
    override suspend fun push(data: TriggerStoreData): AxfResult<Unit> = AxfResult.err(AxfFailure.NotImplemented(TriggersModule.CAP_SYNC))
    override suspend fun pull(): AxfResult<TriggerStoreData> = AxfResult.err(AxfFailure.NotImplemented(TriggersModule.CAP_SYNC))
}

/**
 * The `axf.triggers.store` service: the store, setting bindings, the action catalog for the picker, the open context
 * list, a voice bridge factory and [run] for fired commands.
 */
public class AxfTriggers internal constructor(
    public val store: TriggerStore,
    private val settingsAccess: SettingsAccess?,
    private val runtime: AxfRuntime?,
    private val settingsGroups: () -> List<SettingsGroup>,
    private val voice: () -> AxfVoice?,
    /** The kernel registry; its triggers (lib-speech, plugins) are matched by [voiceBridge] alongside the store's. */
    private val registry: TriggerRegistry? = null,
) {
    /** Null when neither lib-settings nor a Config is available. */
    public val bindings: SettingsVoiceBindings? = settingsAccess?.let { SettingsVoiceBindings(store, it) }
    public val sync: TriggerSync = PlaceholderTriggerSync()

    private val _contexts = MutableStateFlow(listOf(TriggerContext(ai.amberx.axf.kernel.triggers.Thresholds.ANY_CONTEXT, "Anywhere")))
    /** Contexts a trigger can be limited to (first = anywhere). */
    public val contexts: StateFlow<List<TriggerContext>> get() = _contexts
    private val extraActions = MutableStateFlow<List<TriggerActionChoice>>(emptyList())

    /** Adds (or relabels) a context, e.g. `registerContext("notes.editor", "Note editor")`. */
    public fun registerContext(id: String, label: String) {
        _contexts.value = _contexts.value.filter { it.id != id } + TriggerContext(id, label)
    }

    /** Adds action choices that aren't on the action bus (actions the host runs itself from [AxfTriggers.run]'s NoHost). */
    public fun registerActions(choices: List<TriggerActionChoice>) {
        val keys = choices.map { it.key }.toSet()
        extraActions.value = extraActions.value.filter { it.key !in keys } + choices
    }

    /** Binds a setting to voice phrases (see [SettingsVoiceBindings.bind]); false when there is no settings API. */
    public fun bindSetting(binding: SettingVoiceBinding, locked: Boolean = false): Boolean { val b = bindings ?: return false; b.bind(binding, locked); return true }

    /** Everything the action picker offers, now: registered extras, the action bus, the settings tab. */
    public fun catalog(): TriggerActionCatalog = TriggerActionCatalog(
        extraActions.value +
            TriggerActionCatalog.fromActions(runtime?.actions?.list() ?: emptyList()) +
            TriggerActionCatalog.fromSettings(settingsGroups()),
    )

    /**
     * Runs a fired command: settings actions through the settings API, everything else on the action bus (payload =
     * the args as JSON, extras["trigger"] = the command).
     */
    public suspend fun run(cmd: TriggerCommand): TriggerRun {
        val b = bindings
        if (b != null && b.handles(cmd)) b.apply(cmd)?.let { return TriggerRun.Setting(it) }
        val rt = runtime ?: return TriggerRun.NoHost(cmd.action)
        if (!rt.actions.has(cmd.action)) return TriggerRun.NoHost(cmd.action)
        return TriggerRun.Action(rt.actions.dispatch(cmd.action, ActionContext(payload = cmd.args.toString(), extras = mapOf("trigger" to cmd))))
    }

    /** Everything a voice bridge matches: the store's triggers (overrides applied) plus registry-only triggers, see [TriggerUnion]. */
    public fun matchable(): List<Trigger> = TriggerUnion.merge(store.triggers(), registry?.list() ?: emptyList())

    /**
     * A voice bridge on lib-voice's engine and the user's listening settings (arming, sensitivity), matching in [context]
     * the store's triggers plus every trigger registered only in the kernel TriggerRegistry (lib-speech's speech
     * controls, plugin triggers); for an id in both, the store's copy (with the user's overrides) wins. The list follows
     * registry changes ([TriggerRegistry.subscribe]); [VoiceTriggerBridge.close] unsubscribes. Null when lib-voice isn't
     * installed. Collect [VoiceTriggerBridge.commands] and pass them to [run].
     */
    public fun voiceBridge(context: () -> String, log: TriggerLogSink? = null, gate: ArmingGate = ArmingGate.PER_TRIGGER, engine: VoiceEngine? = null): VoiceTriggerBridge? {
        val v = voice() ?: return null
        val e = engine ?: v.engine()
        val source = UnionTriggerSource(store, registry)
        return VoiceTriggerBridge(e.results, VoiceArming(v.armingConfig()), source, context, { v.sensitivity }, log = log, gate = gate, onClose = source::close)
    }
}

/**
 * lib-triggers: the user-facing side of triggers@1 — persistence (custom triggers + overrides), the voice bridge,
 * settings voice bindings and the trigger screens. Contributes route `triggers`, action `triggers.open`, a settings link.
 */
public class TriggersModule : BaseModule(ID, "Triggers") {
    override val version: String = VERSION
    override val provides: List<Capability> = listOf(
        Capability(CAP_STORE, "Custom triggers and per-trigger overrides ($TRIGGERS_CONTRACT)"),
        Capability(CAP_VOICE, "lib-voice results into the kernel TriggerMatcher"),
    )
    public lateinit var triggers: AxfTriggers
        private set

    override fun register(ctx: ModuleContext) {
        val kv = ctx.service(KeyValueStore::class) ?: MemoryKeyValueStore()
        val registry = ctx.service(TriggerRegistry::class)
        val store = TriggerStore(kv, registry)
        val settings = ctx.service(SettingsEngine::class)
        val config = ctx.service(ai.amberx.axf.kernel.config.Config::class)
        val access: SettingsAccess? = settings?.let { SettingsEngineAccess(it) } ?: config?.let { ConfigSettingsAccess(it) }
        val runtime = ctx.service(AxfRuntime::class)
        triggers = AxfTriggers(store, access, runtime,
            settingsGroups = { settings?.groups?.value ?: ctx.extensions.contributions(ExtensionPoints.SETTINGS).map { it.value.group } },
            voice = { ctx.service(AxfVoice::class) }, registry = registry)
        ctx.services.register(AxfTriggers::class, triggers, CAP_STORE)
        ctx.services.register(TriggerStore::class, store, "axf.triggers.store.raw")
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "Triggers", icon = "zap", module = id)))
        ctx.extensions.contribute(AxfUiPoints.VIEWS, id, ViewContribution(ROUTE, "Triggers", "zap") { TriggersScreen() })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("triggers.open", ActionMeta("Triggers", module = id)) { _, _ -> runtime?.navigate(ROUTE) })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("triggers", "Triggers", "zap", id, order = 42, description = "Phrases and gestures that run actions.", settings = listOf(
            SettingSpec("axf.triggers.open", "Triggers", SettingKind.LINK, "Add your own, switch triggers off, change how sure a match must be", target = ROUTE, icon = "zap"),
        ))))
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.triggers"
        public const val ROUTE: String = "triggers"
        /** lib-triggers semver. 0.1.0: store, voice bridge, settings bindings, screens. 0.1.1: the bridge also matches registry-only triggers. */
        public const val VERSION: String = "0.1.1"
        /** triggers@1 contract level this module is built on (the module's kernel apiLevel stays the kernel default). */
        public const val TRIGGERS_API_LEVEL: Int = 1
        public const val CAP_STORE: String = "axf.triggers.store"
        public const val CAP_VOICE: String = "axf.triggers.voice"
        public const val CAP_SYNC: String = "axf.triggers.sync"
    }
}
