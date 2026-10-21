package ai.amberx.axf.axhubandroid

import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.devtools.DevtoolsModule
import android.webkit.WebView
import ai.amberx.axf.lock.LockMode
import ai.amberx.axf.lock.LockModule
import ai.amberx.axf.lock.LockWording
import ai.amberx.axf.logging.LoggingModule
import ai.amberx.axf.nav.NavModule
import ai.amberx.axf.network.NetworkModule
import ai.amberx.axf.data.DataModule
import ai.amberx.axf.settings.SettingsModule
import ai.amberx.axf.ui.windows.WindowsModule
import ai.amberx.axf.hub.HubModule
import ai.amberx.axf.hub.cookieCredentials
import ai.amberx.axf.axhubandroid.hub.WatchPrefs

/**
 * AXHub — builds the kernel from app/src/main/assets/axf (manifest + assets) and these modules.
 * AxfApplication adds the platform + assets modules itself; everything else is listed here so the app
 * decides exactly which libraries it ships (the Dev Console's library picker edits this list).
 */
class App : AxfApplication() {
    val appModule: AppModule by lazy { AppModule(this) }

    override fun onCreate() {
        super.onCreate()
        WebView.setWebContentsDebuggingEnabled(false) // the hub session lives in the WebView
    }

    override fun modules(): List<AxfModule> = listOf(
        DataModule(this), NetworkModule(), NavModule(), SettingsModule(), LoggingModule(), DevtoolsModule(), WindowsModule(),
        LockModule(LockWording(groupLabel = "Unlock", groupDescription = "This app holds your hub admin session. Ask for a fingerprint or PIN before it opens.", modeLabel = "Open AXHub with"), defaultMode = LockMode.BIOMETRIC),
        // Developer app (decision Oct 20 2026): its look and settings come from axHub's data server, read with the hub
        // session the in-app sign-in left in the WebView cookie store; the app waits for the hub rather than running without it.
        HubModule(hub = WatchPrefs(this).base, credentials = cookieCredentials { WatchPrefs(this).base }),
        appModule,
    ) + AppModule.placeholders()
}
