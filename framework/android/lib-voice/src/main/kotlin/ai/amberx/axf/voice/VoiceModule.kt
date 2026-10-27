package ai.amberx.axf.voice

import android.Manifest
import android.content.Context
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.PermissionGateway
import ai.amberx.axf.kernel.platform.PermissionState
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonPrimitive

/**
 * The voice service every module talks to: command registry with user phrases, speech input, spoken
 * prompts and the user's voice settings. Registered as `axf.voice` by [VoiceModule].
 */
public class AxfVoice internal constructor(context: Context, kv: KeyValueStore?, private val permissions: PermissionGateway?, private val config: () -> Config?, private val voskModel: VoskModelSource = VoskModelSource()) {
    private val appContext: Context = context.applicationContext
    public val commands: VoiceCommands = VoiceCommands(kv)
    public val input: SpeechInput = SpeechInput(context.applicationContext)
    public val speaker: Speaker = Speaker(context.applicationContext)

    private fun setting(key: String): String? = config()?.string(key)
    public val speakPrompts: Boolean get() = setting(SPEAK)?.toBooleanStrictOrNull() ?: true
    public val preferOffline: Boolean get() = setting(OFFLINE)?.toBooleanStrictOrNull() ?: true
    public val allowOnlineSecret: Boolean get() = setting(SECRET_ONLINE)?.toBooleanStrictOrNull() ?: false
    public val language: String? get() = setting(LANGUAGE)?.takeIf { it.isNotBlank() && it != "system" }

    // ---- continuous listening (0.3.0) ----
    public val engineKind: VoiceEngineKind get() = VoiceEngineKind.of(setting(ENGINE))
    /** Sensitivity slider 0..1; see [VoiceSensitivity.confidenceFloor]. */
    public val sensitivity: Float get() = VoiceSensitivity.parse(setting(SENSITIVITY))
    public val echoCancellation: Boolean get() = setting(ECHO)?.toBooleanStrictOrNull() ?: true
    public val noiseSuppression: Boolean get() = setting(NOISE)?.toBooleanStrictOrNull() ?: true
    public val armingPhrases: List<String> get() = ArmingConfig.parsePhrases(setting(ARM_PHRASE)).ifEmpty { listOf(ArmingConfig.DEFAULT_PHRASE) }
    public val alwaysArmed: Boolean get() = setting(ALWAYS_ARMED)?.toBooleanStrictOrNull() ?: false
    public val armTimeoutMs: Long get() = ((setting(ARM_TIMEOUT)?.toDoubleOrNull() ?: (ArmingConfig.DEFAULT_TIMEOUT_MS / 1000.0)) * 1000).toLong().coerceIn(0L, ArmingConfig.MAX_TIMEOUT_MS)
    public val endPhrases: List<String> get() = EndPhrases.parse(setting(END_PHRASES))

    /** Engine options from the user's Voice listening settings. */
    public fun engineOptions(partials: Boolean = true): VoiceEngineOptions =
        VoiceEngineOptions(language = language, sensitivity = sensitivity, echoCancellation = echoCancellation, noiseSuppression = noiseSuppression, partials = partials)

    /** Arming config from the user's settings; give it to a [VoiceArming] (or set [VoiceArming.config] when settings change). */
    public fun armingConfig(): ArmingConfig = ArmingConfig(phrases = armingPhrases, alwaysArmed = alwaysArmed, timeoutMs = armTimeoutMs)

    private val engines = mutableMapOf<VoiceEngineKind, VoiceEngine>()

    /** The engine for [kind] (default: the user's pick), created once and shared. Placeholders for engines not built. */
    @Synchronized
    public fun engine(kind: VoiceEngineKind = engineKind): VoiceEngine = engines.getOrPut(kind) {
        when (kind) {
            VoiceEngineKind.VOSK -> VoskVoiceEngine(appContext, voskModel)
            VoiceEngineKind.ANDROID -> AndroidRecognizerVoiceEngine()
            VoiceEngineKind.CLOUD -> CloudVoiceEngine()
        }
    }

    /**
     * Dictation with the user's engine and settings: asks for the mic, then streams until a stop phrase
     * (default "end note", Settings → Voice listening) or until the collector cancels.
     */
    public suspend fun dictate(endPhrases: List<String> = this.endPhrases): Flow<DictationEvent> {
        if (!ensureMic()) return flowOf(DictationEvent.Ended("", DictationEndReason.FAILED, message = "Microphone permission is off."))
        return engine().dictate(engineOptions(), endPhrases)
    }

    internal fun closeEngines() { synchronized(this) { engines.values.forEach { runCatching { it.close() } }; engines.clear() } }

    public fun hasMic(): Boolean = permissions?.state(Manifest.permission.RECORD_AUDIO) == PermissionState.GRANTED

    /** Asks for the microphone when needed. */
    public suspend fun ensureMic(rationale: String = "The microphone is used to hear your voice commands."): Boolean {
        if (hasMic()) return true
        val p = permissions ?: return false
        return p.request(listOf(Manifest.permission.RECORD_AUDIO), rationale)[Manifest.permission.RECORD_AUDIO] == PermissionState.GRANTED
    }

    /** Speaks [prompt] (when prompts are on), then listens once; [onPartial] gets the words heard so far, live. */
    public suspend fun ask(prompt: String?, secret: Boolean = false, onPartial: ((String) -> Unit)? = null): Heard {
        if (!ensureMic()) return Heard.Failed(-1, "Microphone permission is off.")
        if (prompt != null && speakPrompts) speaker.say(prompt, language)
        return input.listen(ListenOptions(language = language, preferOffline = preferOffline, secret = secret, allowOnlineSecret = allowOnlineSecret, onPartial = onPartial))
    }

    public companion object {
        public const val SPEAK: String = "axf.voice.speakPrompts"
        public const val OFFLINE: String = "axf.voice.preferOffline"
        public const val LANGUAGE: String = "axf.voice.language"
        public const val SECRET_ONLINE: String = "axf.voice.secretOnline"
        public const val ENGINE: String = "axf.voice.engine"
        public const val SENSITIVITY: String = "axf.voice.sensitivity"
        public const val ECHO: String = "axf.voice.echoCancellation"
        public const val NOISE: String = "axf.voice.noiseSuppression"
        public const val ARM_PHRASE: String = "axf.voice.armPhrase"
        public const val ALWAYS_ARMED: String = "axf.voice.alwaysArmed"
        public const val ARM_TIMEOUT: String = "axf.voice.armTimeoutSec"
        public const val END_PHRASES: String = "axf.voice.endPhrases"
    }
}

/**
 * lib-voice: speech in, spoken prompts out, and voice commands whose trigger phrases users record or
 * pick from defaults. Contributes the `voice-triggers` route, a Voice settings group and the
 * `voice.triggers` action. Apps register commands with `voice.commands.register(VoiceCommand(…))`.
 */
public class VoiceModule(private val context: Context, private val voskModel: VoskModelSource = VoskModelSource()) : BaseModule(ID, "Voice") {
    override val version: String = VERSION
    override val provides: List<Capability> = listOf(
        Capability("axf.voice", "Speech input, spoken prompts and voice commands"),
        Capability("android.speech", "Android SpeechRecognizer + TextToSpeech"),
    )
    public lateinit var voice: AxfVoice
        private set

    override fun register(ctx: ModuleContext) {
        voice = AxfVoice(context, ctx.service(KeyValueStore::class), ctx.service(PermissionGateway::class), { ctx.service(Config::class) }, voskModel)
        ctx.services.register(AxfVoice::class, voice, "axf.voice")
        val runtime = ctx.service(AxfRuntime::class)
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "Voice triggers", icon = "mic", module = id)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("voice.triggers", ActionMeta("Voice triggers", module = id)) { _, _ -> runtime?.navigate(ROUTE) })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("voice", "Voice", "mic", id, order = 40, description = "How the app listens and talks back.", settings = listOf(
            SettingSpec("axf.voice.triggers", "Voice triggers", SettingKind.LINK, "Record your own phrases or pick from the defaults", target = ROUTE, icon = "mic"),
            SettingSpec(AxfVoice.SPEAK, "Speak prompts", SettingKind.TOGGLE, "Say questions like \"Which site?\" out loud", JsonPrimitive(true)),
            SettingSpec(AxfVoice.OFFLINE, "Prefer on-device recognition", SettingKind.TOGGLE, "Keeps speech on the phone when an offline language is installed", JsonPrimitive(true)),
            SettingSpec(AxfVoice.SECRET_ONLINE, "Allow online recognition for secrets", SettingKind.TOGGLE, "Off: passwords and codes are only heard by the on-device recognizer (Android 12+ with an offline language); without one you type them", JsonPrimitive(false)),
            SettingSpec(AxfVoice.LANGUAGE, "Speech language", SettingKind.CHOICE, default = JsonPrimitive("system"), options = listOf("system" to "Phone language", "en-US" to "English (US)", "en-GB" to "English (UK)", "es-ES" to "Spanish", "fr-FR" to "French", "de-DE" to "German")),
        ))))
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(listeningGroup(id)))
    }

    override suspend fun stop(ctx: ModuleContext) { if (::voice.isInitialized) { voice.speaker.shutdown(); voice.closeEngines() } }

    public companion object {
        public const val ID: String = "ai.amberx.axf.voice"
        public const val ROUTE: String = "voice-triggers"
        /** lib-voice semver: 0.3.0 added continuous engines, dictation, sensitivity, echo cancellation and arming; 0.3.1 runs Speaker on lib-speech (speech@1). */
        public const val VERSION: String = "0.3.1"

        /** Settings group "Voice listening" (id `voice-listening`): engine, sensitivity, echo, arming, stop phrases. */
        public fun listeningGroup(module: String = ID): SettingsGroup = SettingsGroup("voice-listening", "Voice listening", "mic", module, order = 41, description = "Hands-free listening and dictation.", settings = listOf(
            SettingSpec(AxfVoice.ENGINE, "Engine", SettingKind.CHOICE, "Vosk runs on the phone; the others aren't built yet", JsonPrimitive(VoiceEngineKind.DEFAULT.id), options = VoiceEngineKind.entries.map { it.id to it.label }),
            SettingSpec(AxfVoice.SENSITIVITY, "Sensitivity", SettingKind.SLIDER, "Higher hears less certain speech; lower ignores more noise", JsonPrimitive(VoiceSensitivity.DEFAULT), min = 0.0, max = 1.0, step = 0.05),
            SettingSpec(AxfVoice.ECHO, "Echo cancellation", SettingKind.TOGGLE, "Subtract the phone's own sound from the mic when the phone supports it", JsonPrimitive(true)),
            SettingSpec(AxfVoice.NOISE, "Noise suppression", SettingKind.TOGGLE, "Filter steady background noise when the phone supports it", JsonPrimitive(true)),
            SettingSpec(AxfVoice.ALWAYS_ARMED, "Always armed", SettingKind.TOGGLE, "Act on everything heard, no arming phrase needed", JsonPrimitive(false)),
            SettingSpec(AxfVoice.ARM_PHRASE, "Arming phrase", SettingKind.TEXT, "Say it before a command; separate several with commas", JsonPrimitive(ArmingConfig.DEFAULT_PHRASE)),
            SettingSpec(AxfVoice.ARM_TIMEOUT, "Stay armed (seconds)", SettingKind.NUMBER, "How long after the arming phrase or the last command it keeps listening", JsonPrimitive(ArmingConfig.DEFAULT_TIMEOUT_MS / 1000), min = 0.0, max = ArmingConfig.MAX_TIMEOUT_MS / 1000.0, step = 1.0),
            SettingSpec(AxfVoice.END_PHRASES, "Stop dictation phrase", SettingKind.TEXT, "Say it at the end to finish; separate several with commas", JsonPrimitive(EndPhrases.DEFAULT.joinToString(", "))),
        ))
    }
}
