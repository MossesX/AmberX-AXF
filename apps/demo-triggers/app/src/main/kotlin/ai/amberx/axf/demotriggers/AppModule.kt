package ai.amberx.axf.demotriggers

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.triggers.SettingPhrase
import ai.amberx.axf.kernel.triggers.SettingVoiceBinding
import ai.amberx.axf.kernel.triggers.TriggerHosting
import ai.amberx.axf.speech.AxfSpeech
import ai.amberx.axf.speech.SpeechSettings
import ai.amberx.axf.triggers.AxfTriggers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * The demo's own module. Registers three permanent voice triggers (lib-triggers' store) whose actions live on the
 * action bus and answer out loud through lib-speech, plus one setting bound to voice ("toggle reading" flips
 * Settings → Speech → Read aloud). The Triggers screen (route `triggers`) comes from lib-triggers.
 */
class AppModule : BaseModule("ai.amberx.axf.demotriggers", "AXF Demo — triggers") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.voice", "ai.amberx.axf.speech", "ai.amberx.axf.triggers")

    override fun register(ctx: ModuleContext) {
        val speech = ctx.service(AxfSpeech::class)
        var count = 0
        fun answer(text: String) { _said.value = text; speech?.say(text) }

        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(ACT_HELLO, ActionMeta("Say hello", module = id)) { _, _ -> answer("Hello! Your trigger fired.") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(ACT_TIME, ActionMeta("Say the time", module = id)) { _, _ -> answer("It's ${LocalTime.now().format(DateTimeFormatter.ofPattern("h:mm a"))}.") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(ACT_COUNT, ActionMeta("Count up", module = id)) { _, _ -> count++; answer("The count is $count.") })

        ctx.service(AxfTriggers::class)?.let { triggers ->
            triggers.store.registerPermanent(id, listOf(
                TriggerHosting.voiceCommand(ACT_HELLO, "Say hello", listOf("hello there", "say hello"), module = id),
                TriggerHosting.voiceCommand(ACT_TIME, "Say the time", listOf("what time is it", "tell me the time"), module = id),
                TriggerHosting.voiceCommand(ACT_COUNT, "Count up", listOf("count up", "one more"), module = id),
            ))
            triggers.registerContext(CONTEXT, "Walkthrough screen")
            triggers.bindSetting(SettingVoiceBinding(SpeechSettings.READ_ALOUD, id, "Read aloud", listOf(SettingPhrase("toggle reading", toggle = true))))
        }
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("home", "Walkthrough", icon = "zap", module = id)))
    }

    companion object {
        const val CONTEXT = "demo.walkthrough"
        const val ACT_HELLO = "demo.hello"
        const val ACT_TIME = "demo.time"
        const val ACT_COUNT = "demo.count"
        private val _said = MutableStateFlow("")
        /** The last thing an action said out loud (shown on the walkthrough screen). */
        val said: StateFlow<String> get() = _said.asStateFlow()
    }
}
