package ai.amberx.axf.voicevault

import android.content.Context
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
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.lock.AppLock
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.VoiceCommand
import ai.amberx.axf.voicevault.vault.Cmd
import ai.amberx.axf.voicevault.vault.Keys
import ai.amberx.axf.voicevault.vault.VaultSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.json.JsonPrimitive

/**
 * Voice Vault's own module: the voice commands (with default triggers users can replace), the vault
 * session, routes and the Voice Vault settings group. Everything else comes from framework libraries
 * (lib-voice, lib-lock, lib-settings).
 */
class AppModule(private val context: Context, private val scope: CoroutineScope) : BaseModule("ai.amberx.axf.voicevault", "Voice Vault") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.voice", "ai.amberx.axf.lock")
    lateinit var session: VaultSession
        private set

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        val voice = ctx.service(AxfVoice::class)
        voice?.commands?.apply {
            register(VoiceCommand(Cmd.STORE, "Store password", listOf("store password", "save password", "set password", "new password", "add password"), "Starts saving a site and its password.", GROUP, order = 10))
            register(VoiceCommand(Cmd.RETRIEVE, "Retrieve password", listOf("retrieve password", "recover password", "get password", "find password"), "Finds a saved site and copies its password after you confirm.", GROUP, order = 20))
            register(VoiceCommand(Cmd.CONFIRM, "Confirm", listOf("confirm", "yes", "copy it"), "Copies the password shown in the banner.", GROUP, order = 30))
            register(VoiceCommand(Cmd.CANCEL, "Cancel", listOf("cancel", "no", "never mind"), "Backs out of the current step.", GROUP, order = 40))
            register(VoiceCommand(Cmd.LOCK, "Lock", listOf("lock vault", "lock it", "lock"), "Locks the vault right away.", GROUP, order = 50))
        }
        session = VaultSession(context, scope, voice, ctx.service(AppLock::class), ctx.service(SecureStore::class)) { ctx.service(Config::class) }
        ctx.services.register(VaultSession::class, session, "voicevault.session")

        for (r in listOf(RouteSpec("home", "Voice", icon = "mic", module = id), RouteSpec("vault", "Saved sites", icon = "lock", module = id), RouteSpec(UNLOCK_CODE_ROUTE, "Unlock code", icon = "shield", module = id)))
            ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(r))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("vault.lock", ActionMeta("Lock now", module = id)) { _, _ -> session.lock(); runtime?.navigate("home") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("help.about", ActionMeta("About")) { _, _ ->
            runtime?.toast("Voice Vault on AmberX AXF 0.2.0. Passwords stay encrypted on this phone.", ToastKind.INFO, "About")
        })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("voicevault", "Voice Vault", "lock", id, order = 25, description = "How the vault listens and handles copied passwords.", settings = listOf(
            SettingSpec(UNLOCK_CODE_ROUTE, "Unlock code", SettingKind.LINK, "Record or type the phrase that opens the vault", target = UNLOCK_CODE_ROUTE, icon = "shield"),
            SettingSpec(Keys.HANDS_FREE, "Hands-free", SettingKind.TOGGLE, "Listen by itself while the Voice screen is open (off = tap the mic)", JsonPrimitive(true), icon = "mic"),
            SettingSpec(Keys.CLIPBOARD, "Clear copied password after", SettingKind.CHOICE, default = JsonPrimitive("30"), options = listOf("15" to "15 s", "30" to "30 s", "60" to "1 min", "0" to "Never"), icon = "copy"),
            SettingSpec(Keys.IDLE, "Lock when not used for", SettingKind.CHOICE, default = JsonPrimitive("5"), options = listOf("1" to "1 min", "5" to "5 min", "15" to "15 min", "0" to "Never"), icon = "clock"),
            SettingSpec("voicevault.lockNow", "Lock now", SettingKind.ACTION, target = "vault.lock", icon = "lock"),
        ))))
    }

    companion object {
        const val GROUP = "Voice Vault"
        const val UNLOCK_CODE_ROUTE = "unlock-code"
    }
}
