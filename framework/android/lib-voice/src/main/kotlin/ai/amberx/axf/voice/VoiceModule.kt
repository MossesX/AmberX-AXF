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
import kotlinx.serialization.json.JsonPrimitive

/**
 * The voice service every module talks to: command registry with user phrases, speech input, spoken
 * prompts and the user's voice settings. Registered as `axf.voice` by [VoiceModule].
 */
public class AxfVoice internal constructor(context: Context, kv: KeyValueStore?, private val permissions: PermissionGateway?, private val config: () -> Config?) {
    public val commands: VoiceCommands = VoiceCommands(kv)
    public val input: SpeechInput = SpeechInput(context.applicationContext)
    public val speaker: Speaker = Speaker(context.applicationContext)

    private fun setting(key: String): String? = config()?.string(key)
    public val speakPrompts: Boolean get() = setting(SPEAK)?.toBooleanStrictOrNull() ?: true
    public val preferOffline: Boolean get() = setting(OFFLINE)?.toBooleanStrictOrNull() ?: true
    public val allowOnlineSecret: Boolean get() = setting(SECRET_ONLINE)?.toBooleanStrictOrNull() ?: false
    public val language: String? get() = setting(LANGUAGE)?.takeIf { it.isNotBlank() && it != "system" }

    public fun hasMic(): Boolean = permissions?.state(Manifest.permission.RECORD_AUDIO) == PermissionState.GRANTED

    /** Asks for the microphone when needed. */
    public suspend fun ensureMic(rationale: String = "The microphone is used to hear your voice commands."): Boolean {
        if (hasMic()) return true
        val p = permissions ?: return false
        return p.request(listOf(Manifest.permission.RECORD_AUDIO), rationale)[Manifest.permission.RECORD_AUDIO] == PermissionState.GRANTED
    }

    /** Speaks [prompt] (when prompts are on), then listens once. */
    public suspend fun ask(prompt: String?, secret: Boolean = false): Heard {
        if (!ensureMic()) return Heard.Failed(-1, "Microphone permission is off.")
        if (prompt != null && speakPrompts) speaker.say(prompt, language)
        return input.listen(ListenOptions(language = language, preferOffline = preferOffline, secret = secret, allowOnlineSecret = allowOnlineSecret))
    }

    public companion object {
        public const val SPEAK: String = "axf.voice.speakPrompts"
        public const val OFFLINE: String = "axf.voice.preferOffline"
        public const val LANGUAGE: String = "axf.voice.language"
        public const val SECRET_ONLINE: String = "axf.voice.secretOnline"
    }
}

/**
 * lib-voice: speech in, spoken prompts out, and voice commands whose trigger phrases users record or
 * pick from defaults. Contributes the `voice-triggers` route, a Voice settings group and the
 * `voice.triggers` action. Apps register commands with `voice.commands.register(VoiceCommand(…))`.
 */
public class VoiceModule(private val context: Context) : BaseModule(ID, "Voice") {
    override val provides: List<Capability> = listOf(
        Capability("axf.voice", "Speech input, spoken prompts and voice commands"),
        Capability("android.speech", "Android SpeechRecognizer + TextToSpeech"),
    )
    public lateinit var voice: AxfVoice
        private set

    override fun register(ctx: ModuleContext) {
        voice = AxfVoice(context, ctx.service(KeyValueStore::class), ctx.service(PermissionGateway::class)) { ctx.service(Config::class) }
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
    }

    override suspend fun stop(ctx: ModuleContext) { if (::voice.isInitialized) voice.speaker.shutdown() }

    public companion object {
        public const val ID: String = "ai.amberx.axf.voice"
        public const val ROUTE: String = "voice-triggers"
    }
}
