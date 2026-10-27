package ai.amberx.axf.demovoice

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.VoiceCommand

/**
 * The demo's own module: two screens (Dictation, Hands-free) and three voice commands whose phrases the user can
 * change in Settings → Voice → Voice triggers (lib-voice's VoiceTriggersScreen).
 */
class AppModule : BaseModule("ai.amberx.axf.demovoice", "AXF Demo — voice") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.voice")

    override fun register(ctx: ModuleContext) {
        ctx.service(AxfVoice::class)?.commands?.apply {
            register(VoiceCommand(CMD_HELLO, "Hello", listOf("hello", "say hello"), "Answers on the Hands-free screen.", GROUP, id, order = 10))
            register(VoiceCommand(CMD_TIME, "What time is it", listOf("what time is it", "time"), "Shows the time.", GROUP, id, order = 20))
            register(VoiceCommand(CMD_CLEAR, "Clear", listOf("clear the list", "clear"), "Empties the heard list.", GROUP, id, order = 30))
        }
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("home", "Dictation", icon = "edit", module = id)))
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(HANDS_FREE_ROUTE, "Hands-free", icon = "mic", module = id)))
    }

    companion object {
        const val GROUP = "Voice demo"
        const val HANDS_FREE_ROUTE = "hands-free"
        const val CMD_HELLO = "demo.hello"
        const val CMD_TIME = "demo.time"
        const val CMD_CLEAR = "demo.clear"
    }
}
