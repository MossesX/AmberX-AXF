package ai.amberx.axf.axnotes

import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.overlay.OverlayModule
import ai.amberx.axf.overlay.OverlayNotification
import ai.amberx.axf.onboarding.OnboardingModule
import ai.amberx.axf.ai.AiModule
import ai.amberx.axf.triggers.TriggersModule
import ai.amberx.axf.speech.SpeechModule
import ai.amberx.axf.voice.VoiceModule
import ai.amberx.axf.notifications.NotificationsModule
import ai.amberx.axf.devtools.DevtoolsModule
import ai.amberx.axf.devtools.PluginManagerModule
import ai.amberx.axf.logging.LoggingModule
import ai.amberx.axf.nav.NavModule
import ai.amberx.axf.network.NetworkModule
import ai.amberx.axf.data.DataModule
import ai.amberx.axf.settings.SettingsModule
import ai.amberx.axf.ui.windows.WindowsModule
import ai.amberx.axf.hub.HubModule
import ai.amberx.axf.hub.cookieCredentials
import ai.amberx.axf.axnotes.axf.AiSetup
import ai.amberx.axf.axnotes.axf.OverlaySetup
import ai.amberx.axf.axnotes.host.PluginHost
import ai.amberx.axf.axnotes.service.MicService

/**
 * AX Notes — builds the kernel from app/src/main/assets/axf (manifest + assets) and these modules.
 * AxfApplication adds the platform + assets modules itself; everything else is listed here so the app
 * decides exactly which libraries it ships (the Dev Console's library picker edits this list).
 *
 * Libraries (build ax-notes s13): notifications, voice (Vosk engine), speech (TTS reader), triggers (triggers@1 store +
 * voice bridge), AI (sessions on axHub), onboarding (first-run permissions) and the overlay pill. Every one is optional
 * for AppModule: remove a module here and its seam falls back to the stand-in.
 *
 * Plugins (apps/ax-notes/plugins/) are not named here: [PluginHost] loads whatever assets/axnotes/plugins.json lists.
 */
class App : AxfApplication() {
    val plugins: PluginHost by lazy { PluginHost(this) }
    val appModule: AppModule by lazy { AppModule(this, appScope, plugins) }

    override fun modules(): List<AxfModule> = listOf(
        DataModule(this), NetworkModule(), NavModule(), SettingsModule(), LoggingModule(), DevtoolsModule(), PluginManagerModule(), WindowsModule(),
        NotificationsModule(this, listOf(MicService.CHANNEL)),
        VoiceModule(this),
        SpeechModule(this),
        TriggersModule(),
        AiModule(assistant = AiSetup.assistant, prefix = ai.amberx.axf.ai.AiWire.prefixFor(AiSetup.plugin)),
        OnboardingModule(AppModule.ONBOARDING),
        OverlayModule(this, OverlayNotification(R.drawable.ic_axnotes_notification, "AX Notes", "The AX Notes pill is on", MainActivity::class.java), showOnStart = OverlaySetup.showOnStart),
        appModule,
    ) + plugins.load() + developerModules()

    /**
     * Developer app (manifest `developer: { hub }`, `axf init --developer`): look + settings from axHub's data server with
     * the hub session the waiting screen's sign-in leaves in the WebView cookie store; waits for the hub otherwise.
     * An ordinary app has no `developer` in its manifest and gets nothing here.
     */
    private fun developerModules(): List<AxfModule> = manifest().developer?.let { d -> listOf(HubModule(hub = d.hub, credentials = cookieCredentials { d.hub })) } ?: emptyList()
}
