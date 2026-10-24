package ai.amberx.axf.readaloud

import android.content.Context
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.SettingsContribution

/**
 * lib-readaloud as a module (`axf.readaloud`). With [settingsPrefix] it also contributes the read-aloud settings groups
 * under that prefix in [settingsTab] and points [ReadAloud] at them; a plugin that brings its own groups (X Select)
 * passes null and calls [ReadAloud.configure] itself. Actions `readaloud.stop|toggle|next|previous|faster|slower`.
 */
public class ReadAloudModule(
    private val context: Context,
    private val settingsPrefix: String? = "axf.readaloud.",
    private val settingsTab: String? = null,
) : BaseModule(ID, "Read aloud") {
    override val provides: List<Capability> = listOf(
        Capability("axf.readaloud", "Read any text aloud: cleanup, chunking, queue, foreground playback with controls"),
        Capability("android.tts", "Android TextToSpeech"),
    )

    override fun register(ctx: ModuleContext) {
        val app = context.applicationContext
        ctx.services.register(ReadAloud::class, ReadAloud, "axf.readaloud")
        settingsPrefix?.let { prefix ->
            ReadAloud.configure(prefix) { key -> ctx.service(Config::class)?.string(key) }
            for (g in ReadAloudSettings.groups(prefix, settingsTab, id)) ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(g))
        }
        fun action(name: String, label: String, run: (Context) -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("readaloud.$name", ActionMeta(label, module = id)) { _, _ -> run(app) })
        action("stop", "Stop reading aloud") { ReadAloud.stop(it) }
        action("toggle", "Pause or resume reading") { ReadAloud.toggle(it) }
        action("next", "Next sentence") { ReadAloud.next(it) }
        action("previous", "Previous sentence") { ReadAloud.previous(it) }
        action("faster", "Read faster") { ReadAloud.faster(it) }
        action("slower", "Read slower") { ReadAloud.slower(it) }
    }

    override suspend fun stop(ctx: ModuleContext) { ReadAloud.stop(context.applicationContext) }

    public companion object { public const val ID: String = "ai.amberx.axf.readaloud" }
}
