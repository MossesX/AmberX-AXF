package ai.amberx.axf.speech

import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.speech.SPEECH_CAPABILITY
import ai.amberx.axf.kernel.speech.SpeakOptions
import ai.amberx.axf.kernel.speech.SpeechProvider
import ai.amberx.axf.kernel.speech.SpeechVoice
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * The speaking service every module talks to (`AxfSpeech`, next to the `axf.speech` [SpeechProvider]): one
 * [SpeechPlayer] for the app, the user's [SpeechSettings], and the reader's spoken controls.
 *
 * ```kotlin
 * val speech = ctx.require(AxfSpeech::class)
 * speech.read("Your note was saved.")      // only when Read aloud is on
 * speech.say("Locked.")                     // always, interrupts
 * speech.handle(triggerCommand)             // "pause", "skip", "faster", … from the trigger host
 * ```
 */
public class AxfSpeech(
    public val provider: SpeechProvider,
    private val settingsSource: () -> SpeechSettings,
    scope: CoroutineScope,
    focus: SpeechFocus = SpeechFocus.NONE,
) {
    public val settings: SpeechSettings get() = settingsSource()
    public val player: SpeechPlayer = SpeechPlayer(provider, scope, settingsSource().rate, focus = focus, defaults = { settingsSource().speakOptions() })

    /** Reads [text] when Read aloud is on (queued after what is being read); null when it is off. */
    public fun read(text: String, opts: SpeakOptions? = null, next: Boolean = false): String? {
        val s = settings
        if (!s.readAloud) return null
        syncRate(s)
        return player.enqueue(text, opts, next)
    }

    /** Stops what is being read and says [text] now, whatever Read aloud says. */
    public fun say(text: String, opts: SpeakOptions? = null): String {
        syncRate(settings)
        return player.say(text, opts)
    }

    /** Runs a speech action (`speech.pause`, `speech.skip`, …); false when [action] isn't one. */
    public fun command(action: String): Boolean {
        val e = SpeechCommands.event(action) ?: return false
        player.dispatch(e)
        return true
    }

    /** A fired trigger from the trigger host; false when it isn't one of the reader's. */
    public fun handle(cmd: TriggerCommand): Boolean = command(cmd.action)

    public suspend fun voices(): AxfResult<List<SpeechVoice>> = provider.voices()

    public suspend fun available(): Boolean = provider.available()

    /** A new reading session starts at the user's speed (a "faster" mid-session lasts until the queue is over). */
    private fun syncRate(s: SpeechSettings) {
        if (!player.active && !player.state.value.paused && player.state.value.rate != s.rate) player.setRate(s.rate)
    }
}

/**
 * lib-speech (speech@1, the speaking side; listening stays in lib-voice): registers the Android TextToSpeech
 * provider as `axf.speech` (replacing the kernel placeholder), [AxfSpeech] + its [SpeechPlayer], the Speech
 * settings group, one action per spoken control and the matching permanent voice triggers in the kernel
 * TriggerRegistry. `axf.speech.hq` stays a typed placeholder ([HqSpeechProvider]).
 */
public class SpeechModule(
    private val context: Context,
    /** the provider to register; default: Android TextToSpeech */
    private val provider: ((Context) -> SpeechProvider)? = null,
    /** contexts the reader's voice triggers work in (empty = anywhere) */
    private val triggerContexts: List<String> = emptyList(),
) : BaseModule(ID, "Speech") {
    override val version: String = VERSION
    override val provides: List<Capability> = listOf(
        Capability(SPEECH_CAPABILITY, "Speaks text: Android TextToSpeech provider, a reading queue with spoken controls"),
        Capability("android.tts", "Android TextToSpeech"),
    )
    public lateinit var speech: AxfSpeech
        private set
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun register(ctx: ModuleContext) {
        val p = provider?.invoke(context) ?: AndroidTtsProvider(context)
        val settings: () -> SpeechSettings = { val c = ctx.service(Config::class); SpeechSettings.from { k -> c?.string(k) } }
        speech = AxfSpeech(p, settings, scope, AndroidAudioFocus(context, duck = { settings().duck }))
        ctx.services.register(SpeechProvider::class, p, SPEECH_CAPABILITY)
        ctx.services.register(AxfSpeech::class, speech)
        ctx.services.register(SpeechPlayer::class, speech.player)
        ctx.services.declarePlaceholder(HqSpeechProvider.CAPABILITY)
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SpeechSettings.group(id)))
        for (c in SpeechCommands.ALL) {
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(c.action, ActionMeta(c.label, module = id)) { _, _ -> speech.command(c.action) })
        }
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(SAY_ACTION, ActionMeta("Say", module = id, params = true)) { args, _ ->
            val text = args.joinToString(" ").trim()
            if (text.isNotEmpty()) speech.say(text)
        })
        ctx.service(TriggerRegistry::class)?.register(id, SpeechTriggers.all(id, triggerContexts))
    }

    override suspend fun stop(ctx: ModuleContext) {
        if (::speech.isInitialized) {
            speech.player.stop()
            (speech.provider as? AndroidTtsProvider)?.shutdown()
        }
        ctx.service(TriggerRegistry::class)?.unregister(id)
        scope.cancel()
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.speech"
        /** lib-speech semver. 0.1.0: Android TTS provider, SpeechPlayer over the kernel queue, focus, settings, triggers. */
        public const val VERSION: String = "0.1.0"
        /** kernel API level lib-speech is built against (speech@1 = kernel API level 1) */
        public const val API_LEVEL: Int = 1
        /** `speech.say:<text>`: says the text now */
        public const val SAY_ACTION: String = "speech.say"
    }
}
