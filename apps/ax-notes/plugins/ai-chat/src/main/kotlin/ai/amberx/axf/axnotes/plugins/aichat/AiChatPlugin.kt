package ai.amberx.axf.axnotes.plugins.aichat

import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoint
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.MenuContribution
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.ui.AxfUiPoints
import ai.amberx.axf.ui.ViewContribution
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.JsonPrimitive

/**
 * Plugin ai-chat (plugin@1 `ai.amberx.axf.axnotes.ai-chat`, step s15 of build ax-notes): voice or text chat with Claude.
 *
 *  - in-app screen: route + view `ai-chat`; overlay mini screen: a [ViewContribution] on [MINI_SCREENS] the host puts
 *    into lib-overlay's `setMiniContent` (the plugin never touches the overlay itself);
 *  - streamed replies over an ai.chat session (ai-modes@1 on `axf.ai.session`), optional read-aloud via speech@1;
 *  - voice: "ask Claude …", "chat mode", "stop" as triggers@1 data ([ChatTriggers]); save a reply as a note;
 *  - settings: its own sub-tab `ai-chat` under Settings → Plugins; menu hooks in the application menu, the nav menu and
 *    the long-press menu; "Remove plugin data" clears everything it stored on the phone.
 * The app never imports this class: it loads it by name from plugins.json (see install.mjs) and runs fine without it.
 */
class AiChatPlugin : BaseModule(ID, "AI chat") {
    override val version: String = "0.1.0"
    override val optionalDependsOn: List<String> = listOf("ai.amberx.axf.settings")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var chat: ChatController? = null
    private var runtime: AxfRuntime? = null
    private var triggers: TriggerRegistry? = null

    override fun register(ctx: ModuleContext) {
        val host = PluginHost(ctx, PREFIX)
        val c = ChatController(host, scope)
        chat = c
        runtime = ctx.service(AxfRuntime::class)
        ctx.services.register(ChatController::class, c, CAPABILITY)

        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "Chat with Claude", icon = "message", module = id)))
        ctx.extensions.contribute(AxfUiPoints.VIEWS, id, ViewContribution(ROUTE, "Chat with Claude", "message") { AiChatScreen(compact = false) })
        ctx.extensions.contribute(MINI_SCREENS, id, ViewContribution(MINI_ID, "Claude", "message") { AiChatScreen(compact = true) })

        fun action(aid: String, label: String, params: Boolean = false, fn: (String?) -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(aid, ActionMeta(label, module = id, params = params)) { _, a -> fn(a.payload) })
        action(ChatTriggers.ACTION_OPEN, "Chat with Claude") { p ->
            if (ChatTriggers.flag(PluginHost.parseObject(p), "voice")) c.setInput(InputMode.VOICE)
            runtime?.navigate(ROUTE)
        }
        action(ChatTriggers.ACTION_ASK, "Ask Claude", params = true) { p -> ChatTriggers.textArg(PluginHost.parseObject(p))?.let { c.send(it) } }
        action(ChatTriggers.ACTION_SAY, "Say to Claude (chat mode)", params = true) { p -> ChatTriggers.textArg(PluginHost.parseObject(p))?.let { c.send(it) } }
        action(ChatTriggers.ACTION_STOP, "Stop Claude") { p -> c.stop(close = ChatTriggers.flag(PluginHost.parseObject(p), "close")) }
        action(ChatTriggers.ACTION_SAVE, "Save Claude's reply as a note") {
            val ok = c.save()
            runtime?.toast(if (ok) "Reply saved as a note." else if (!c.canSaveNotes()) "This app can't save notes from plugins." else "No reply to save yet.", if (ok) ToastKind.SUCCESS else ToastKind.WARNING)
        }
        action(ACTION_CLEAR, "New chat with Claude") { c.clear() }
        action(ACTION_PURGE, "Remove AI chat data") {
            c.clear()
            val n = host.purge()
            runtime?.toast("AI chat data removed ($n item${if (n == 1) "" else "s"}).", ToastKind.SUCCESS)
        }

        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup(TAB, "AI chat", "message", id, order = 50, tab = TAB,
            description = "Chat with Claude in the overlay's mini screen or on its own screen. Say \"ask Claude …\", \"chat mode\" or \"stop\".", settings = listOf(
                SettingSpec(PREFIX + ChatController.KEY_READ_ALOUD, "Read replies aloud", SettingKind.TOGGLE, "Speak each finished reply (needs a speech provider)", JsonPrimitive(false), icon = "volume"),
                SettingSpec("${PREFIX}open", "Open the chat", SettingKind.ACTION, target = ChatTriggers.ACTION_OPEN, icon = "message"),
                SettingSpec("${PREFIX}clear", "New chat", SettingKind.ACTION, "Ends the current session on the hub", target = ACTION_CLEAR, icon = "refresh"),
                SettingSpec("${PREFIX}purge", "Remove plugin data", SettingKind.ACTION, "Deletes everything AI chat stored on this phone (run before uninstalling)", target = ACTION_PURGE, icon = "trash"),
            ))))

        // menu hooks (application menu + nav menu on; plus the long-press menu); all leave with the module
        val item = MenuItem(ROUTE, "Chat with Claude", "message", action = ChatTriggers.ACTION_OPEN)
        ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("app-menu", "default", item))
        ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("nav-menu", "default", item))
        runtime?.addContextItems(AxfRuntime.ContextContribution("$id.default", id, "default", 60, listOf(item)))

        triggers = ctx.service(TriggerRegistry::class)
        triggers?.register(id, ChatTriggers.all(id))
    }

    override suspend fun stop(ctx: ModuleContext) {
        chat?.detach()
        triggers?.unregister(id)
        runtime?.removeContextItems(id)
    }

    companion object {
        const val ID: String = "ai.amberx.axf.axnotes.ai-chat"
        const val CAPABILITY: String = "axnotes.ai-chat"
        const val PREFIX: String = "ai-chat."
        const val TAB: String = "ai-chat"
        const val ROUTE: String = "ai-chat"
        const val MINI_ID: String = "ai-chat.mini"
        const val ACTION_CLEAR: String = "ai-chat.clear"
        const val ACTION_PURGE: String = "ai-chat.purge"

        /** Mini-screen contributions; the host shows the one it picks in lib-overlay's mini screen. */
        val MINI_SCREENS: ExtensionPoint<ViewContribution> = ExtensionPoint("axnotes.mini-screens", ViewContribution::class, "Composables a plugin offers for the overlay's mini screen")
    }
}
