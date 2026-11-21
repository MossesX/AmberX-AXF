package ai.amberx.axf.phoneconnect.watch

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Browser
import android.provider.Settings
import ai.amberx.axf.phoneconnect.link.LinkRules

/**
 * Opening a page in the phone's browser and bringing it to the front (browser.open with `where: browser`, and what a tap
 * on a notification opens).
 *
 * Android only lets an app start an activity while it is in front, or when Brett allowed it to "display over other apps"
 * (the documented exemption from the background-start block). In every other case the caller posts a high-priority
 * notification instead, and one tap opens the page.
 */
object Pages {
    fun chromeInstalled(ctx: Context): Boolean = runCatching { ctx.packageManager.getPackageInfo(LinkRules.CHROME, 0); true }.getOrDefault(false)

    /**
     * The VIEW intent for [url]: Chrome when asked for and installed, else the default browser. The application id
     * makes the browser reuse the tab it opened for this app last, so a run of pages does not pile up tabs.
     */
    fun intent(ctx: Context, url: String, chrome: Boolean): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(Browser.EXTRA_APPLICATION_ID, ctx.packageName)
            .apply { if (chrome && chromeInstalled(ctx)) setPackage(LinkRules.CHROME) }

    /** May this app start an activity right now without being in front? */
    fun mayStartFromBackground(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

    /** Opens [url] now. Returns the browser used ("chrome" / "default"), or null when nothing could open it. */
    fun open(ctx: Context, url: String, chrome: Boolean): String? {
        val i = intent(ctx, url, chrome)
        return try {
            ctx.startActivity(i)
            if (i.`package` == LinkRules.CHROME) "chrome" else "default"
        } catch (e: ActivityNotFoundException) {
            null
        } catch (e: SecurityException) {
            null
        }
    }

    /** Android's own screen where Brett allows this app to open pages over other apps. */
    fun overlaySettings(ctx: Context): Intent =
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
