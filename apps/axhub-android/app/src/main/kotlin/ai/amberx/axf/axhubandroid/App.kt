package ai.amberx.axf.axhubandroid

import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.devtools.DevtoolsModule
import ai.amberx.axf.lock.LockMode
import ai.amberx.axf.lock.LockModule
import ai.amberx.axf.lock.LockWording
import ai.amberx.axf.logging.LoggingModule
import ai.amberx.axf.hub.HubModule
import ai.amberx.axf.hub.cookieCredentials
import ai.amberx.axf.axhubandroid.watch.hubPrefs
import ai.amberx.axf.notifications.NotificationsModule
import ai.amberx.axf.axhubandroid.watch.Alerts
import ai.amberx.axf.axhubandroid.watch.ApprovalWatch
import ai.amberx.axf.work.WorkModule
import ai.amberx.axf.nav.NavModule
import ai.amberx.axf.network.NetworkModule
import ai.amberx.axf.data.DataModule
import ai.amberx.axf.settings.SettingsModule
import ai.amberx.axf.ui.windows.WindowsModule

/**
 * AXHub — builds the kernel from app/src/main/assets/axf (manifest + assets) and these modules.
 * AxfApplication adds the platform + assets modules itself; everything else is listed here so the app
 * decides exactly which libraries it ships (the Dev Console's library picker edits this list).
 */
class App : AxfApplication() {
    val appModule: AppModule by lazy { AppModule(this) }
    // The hub session lives in the WebView: axf.manifest.json → android.secureWindow turns WebView debugging off
    // (AxfApplication) and sets FLAG_SECURE (AxfActivity).

    override fun modules(): List<AxfModule> = listOf(
        DataModule(this), NetworkModule(), NavModule(), SettingsModule(), LoggingModule(), DevtoolsModule(), WindowsModule(),
        LockModule(this, LockWording(groupLabel = "Unlock", groupDescription = "This app holds your hub admin session. Ask for a fingerprint or PIN before it opens.", modeLabel = "Open AXHub with", pinNeeded = "Set a PIN first, then choose PIN."), defaultMode = LockMode.BIOMETRIC),
        // Developer app (decision Oct 20 2026): its look and settings come from axHub's data server, and lib-hub reads
        // approvals, with the hub session the in-app sign-in left in the WebView cookie store (never stored by the
        // library); the app waits for the hub rather than running without it.
        HubModule(hub = hubPrefs(this).base, credentials = cookieCredentials { hubPrefs(this).base }),
        NotificationsModule(this, Alerts.channelSpecs),
        // lib-work: the approval watcher is a registered poll job; the foreground service, back-off and boot restart are the framework's.
        WorkModule(jobs = listOf(ApprovalWatch.job(this))),
        appModule,
    ) + AppModule.placeholders() + WorkModule.placeholders()
}
