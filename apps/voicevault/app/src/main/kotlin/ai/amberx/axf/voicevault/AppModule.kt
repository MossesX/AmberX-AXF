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
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.lock.AppLock
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.VoiceCommand
import ai.amberx.axf.voicevault.vault.Cmd
import ai.amberx.axf.voicevault.vault.Keys
import ai.amberx.axf.voicevault.vault.VaultSession
import ai.amberx.axf.voicevault.notes.VoiceNotes
import ai.amberx.axf.voicevault.voice.VoiceControl
import ai.amberx.axf.settings.SettingsEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.json.JsonPrimitive

/**
 * Voice Vault's own module: the voice commands (with default triggers users can replace), the vault
 * session, routes and the Voice Vault settings group. Everything else comes from framework libraries
 * (lib-voice, lib-lock with its lock-mode guard, lib-settings with the settings view and About).
 */
class AppModule(private val context: Context, private val scope: CoroutineScope) : BaseModule("ai.amberx.axf.voicevault", "Voice Vault") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.voice", "ai.amberx.axf.lock")
    lateinit var session: VaultSession
        private set
    lateinit var notes: VoiceNotes
        private set
    lateinit var control: VoiceControl
        private set

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        val voice = ctx.service(AxfVoice::class)
        voice?.commands?.apply {
            register(VoiceCommand(Cmd.WAKE, "Global trigger", listOf("hey vault", "voice vault", "open vault"), "Heard while the app is in the background: pops Voice Vault open to unlock.", GROUP, order = 5))
            register(VoiceCommand(Cmd.STORE, "Store password", listOf("store password", "save password", "set password", "new password", "add password"), "Starts saving a site and its password.", GROUP, order = 10))
            register(VoiceCommand(Cmd.RETRIEVE, "Retrieve password", listOf("retrieve password", "recover password", "get password", "find password"), "Finds a saved site and copies its password after you confirm.", GROUP, order = 20))
            register(VoiceCommand(Cmd.CONFIRM, "Confirm", listOf("confirm", "yes", "copy it"), "Copies the password shown in the banner.", GROUP, order = 30))
            register(VoiceCommand(Cmd.CANCEL, "Cancel", listOf("cancel", "no", "never mind"), "Backs out of the current step.", GROUP, order = 40))
            register(VoiceCommand(Cmd.LOCK, "Lock", listOf("lock vault", "lock it", "lock"), "Locks the vault right away.", GROUP, order = 50))
        }
        session = VaultSession(context, scope, voice, ctx.service(AppLock::class), ctx.service(SecureStore::class), ctx.service(KeyValueStore::class), (context as AxfApplication).ready) { ctx.service(Config::class) }
        ctx.services.register(VaultSession::class, session, "voicevault.session")
        // Voice notes: the listener for the console's Voice notes setup on axHub (separate from the vault).
        notes = VoiceNotes(scope, voice, { ctx.service(Config::class) }, VoiceNotes.DEVICE)
        ctx.services.register(VoiceNotes::class, notes, "voicevault.notes")
        // Voice control: the microphone switch, which triggers are on, your own voice actions, quiet hours, heard log.
        control = VoiceControl(context, scope, voice, ctx.service(KeyValueStore::class), { ctx.service(Config::class) }, { ctx.service(SettingsEngine::class) }, { runtime }, { session }, { notes })
        session.control = control
        ctx.services.register(VoiceControl::class, control, "voicevault.control")
        control.start()

        for (r in listOf(RouteSpec("home", "Voice", icon = "mic", module = id), RouteSpec("vault", "Saved sites", icon = "lock", module = id), RouteSpec(UNLOCK_CODE_ROUTE, "Unlock code", icon = "shield", module = id),
            RouteSpec(VoiceNotes.ROUTE, "Voice notes", icon = "edit", module = id), RouteSpec(VoiceControl.ROUTE, "Voice actions", icon = "mic", module = id), RouteSpec(VoiceNotes.SIGN_IN_ROUTE, "Sign in to axHub", icon = "user", module = id)))
            ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(r))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("vault.allowPopup", ActionMeta("Let it pop open", module = id)) { _, _ -> ai.amberx.axf.voicevault.background.WakeListener.openPopupSettings(context) })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("vault.lock", ActionMeta("Lock now", module = id)) { _, _ -> session.lock(clearClipboard = true); runtime?.navigate("home") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("vault.micOff", ActionMeta("Turn the microphone off", module = id)) { _, _ -> control.setMicOff(true) })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("vault.micOn", ActionMeta("Turn the microphone on", module = id)) { _, _ -> control.setMicOff(false) })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("notes.take", ActionMeta("Take a voice note", module = id)) { _, _ -> notes.takeNow() })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("voicevault.notes", "Voice notes", "edit", id, order = 26, description = "Notes you say, filed into the lists you set up in the Dev Console (kept on axHub).", settings = listOf(
            SettingSpec(VoiceNotes.KEY_LISTEN, "Listen for voice notes", SettingKind.TOGGLE, "Hear your start triggers in the background too (screen off included), then take the note", JsonPrimitive(true), icon = "mic"),
            SettingSpec("voicevault.notes.open", "Voice notes", SettingKind.LINK, "What you can say, your lists, the last note", target = VoiceNotes.ROUTE, icon = "edit"),
            SettingSpec("voicevault.notes.signIn", "Sign in to axHub", SettingKind.LINK, "The notes and their setup live on axHub", target = VoiceNotes.SIGN_IN_ROUTE, icon = "user"),
            SettingSpec(VoiceNotes.KEY_HUB, "axHub address", SettingKind.TEXT, "Where the setup and notes live", JsonPrimitive("https://axhub.amberxai.com"), icon = "cloud"),
        ))))
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("voicevault", "Voice Vault", "lock", id, order = 25, description = "How the vault listens and handles copied passwords.", settings = listOf(
            SettingSpec(UNLOCK_CODE_ROUTE, "Unlock code", SettingKind.LINK, "Record or type the phrase that opens the vault", target = UNLOCK_CODE_ROUTE, icon = "shield"),
            SettingSpec(VoiceControl.KEY_MIC_OFF, "Microphone off", SettingKind.TOGGLE, "Voice Vault doesn't listen at all: not on the Voice screen, not in the background. This phone only, never synced", JsonPrimitive(false), icon = "mic"),
            SettingSpec("voicevault.voiceActions", "Voice actions and trigger switches", SettingKind.LINK, "Switch each trigger on or off, record your own voice actions, see what it heard", target = VoiceControl.ROUTE, icon = "mic"),
            SettingSpec(Keys.BACKGROUND, "Listen in the background", SettingKind.TOGGLE, "While Voice Vault runs but isn't on screen (screen off too), listen only for your global trigger, then pop the app open", JsonPrimitive(true), icon = "bell"),
            SettingSpec("voice-triggers", "Global trigger and commands", SettingKind.LINK, "Set the words that open the app and the ones it obeys", target = "voice-triggers", icon = "mic"),
            SettingSpec(VoiceControl.KEY_QUIET, "Quiet hours", SettingKind.TOGGLE, "The background listener stops between these times every day", JsonPrimitive(false), icon = "clock"),
            SettingSpec(VoiceControl.KEY_QUIET_FROM, "Quiet from", SettingKind.CHOICE, default = JsonPrimitive("22:00"), options = HOURS, icon = "clock"),
            SettingSpec(VoiceControl.KEY_QUIET_TO, "Quiet until", SettingKind.CHOICE, default = JsonPrimitive("7:00"), options = HOURS, icon = "clock"),
            SettingSpec(VoiceControl.KEY_LOG_ON, "Keep a heard list", SettingKind.TOGGLE, "Note each trigger that matched (only the trigger, never anything else you said), on the Voice actions screen", JsonPrimitive(true), icon = "eye"),
            SettingSpec("voicevault.allowPopup", "Let it pop open", SettingKind.ACTION, "Android permission so the trigger can open the app over whatever you're doing", target = "vault.allowPopup", icon = "external"),
            SettingSpec(Keys.HANDS_FREE, "Hands-free", SettingKind.TOGGLE, "Listen by itself while the Voice screen is open (off = tap the mic)", JsonPrimitive(true), icon = "mic"),
            SettingSpec(Keys.SHOW_SPEECH, "Show what you say", SettingKind.TOGGLE, "Show your words live while you talk, and passwords in plain text (off = hidden as dots)", JsonPrimitive(true), icon = "eye"),
            SettingSpec(Keys.CLIPBOARD, "Clear copied password after", SettingKind.CHOICE, default = JsonPrimitive("30"), options = listOf("15" to "15 s", "30" to "30 s", "60" to "1 min", "0" to "Never"), icon = "copy"),
            SettingSpec(Keys.IDLE, "Lock when not used for", SettingKind.CHOICE, default = JsonPrimitive("5"), options = listOf("1" to "1 min", "5" to "5 min", "15" to "15 min", "0" to "Never"), icon = "clock"),
            SettingSpec("voicevault.lockNow", "Lock now", SettingKind.ACTION, target = "vault.lock", icon = "lock"),
        ))))
    }

    companion object {
        const val GROUP = "Voice Vault"
        const val UNLOCK_CODE_ROUTE = "unlock-code"
        private val HOURS: List<Pair<String, String>> = (0..23).map { "$it:00" to "%d:00".format(it) }
    }
}
