package ai.amberx.axf.phoneconnect.watch

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import ai.amberx.axf.phoneconnect.link.LinkRules
import org.json.JSONObject

/**
 * The hand-off to the AXF Console app (console-overlay@1; the console app's side is
 * `apps/console-droid/.../PhoneConnectProvider.java` and `PhoneConnectRules.java`, whose JUnit test checks these names).
 *
 * [open] is one synchronous `ContentResolver.call`: the console app loads the page in its one console WebView and
 * shows it over whatever is on screen, in its expanded overlay or, with the toolbar off, as the app itself. It
 * answers only once the page is really there. When the console app may not come to the front by itself (it lacks
 * "Display over other apps") but this app may, [launch] starts the console activity from here on the page. In every
 * other case browser.open opens the page in the browser.
 */
object ConsoleOverlay {
    const val AUTHORITY = "ai.amberx.consoleapp.overlay"
    const val OPEN = "open"
    const val STATE = "state"
    const val EXTRA_WHERE = "where"
    const val PACKAGE = "ai.amberx.consoleapp"
    const val ACTIVITY = "ai.amberx.consoleapp.ConsoleActivity"
    /** The console app's refusal when it lacks "Display over other apps": this app may still start it ([launch]). */
    const val NO_OVERLAY = "no_overlay"
    /** No console app on the phone (or one too old to answer). */
    const val ABSENT = "absent"

    /** [json] is the console app's answer when the page opened there; otherwise [code] says why it did not. */
    class Answer(val json: JSONObject?, val code: String)

    private fun call(ctx: Context, method: String, arg: String?, extras: Bundle?): Bundle? =
        // not installed (IllegalArgumentException: unknown authority) or the call failed: null
        runCatching { ctx.contentResolver.call(Uri.parse("content://$AUTHORITY"), method, arg, extras) }.getOrNull()

    /** Asks the console app to show [url]. The result's `how` is `console-overlay` or `console-app`. */
    fun open(ctx: Context, url: String, where: String): Answer {
        val r = call(ctx, OPEN, url, Bundle().apply { putString(EXTRA_WHERE, where) }) ?: return Answer(null, ABSENT)
        if (!r.getBoolean("ok", false)) {
            Log.i("ConsoleOverlay", "console app declined: ${r.getString("code")} ${r.getString("message")}")
            return Answer(null, r.getString("code") ?: "")
        }
        val json = runCatching { JSONObject(r.getString("json") ?: "{}") }.getOrNull() ?: return Answer(null, "")
        return Answer(json.put("opened", true).put("how", LinkRules.consoleHow(json.optBoolean("overlay", false))), "")
    }

    /** Whether the console app is on screen right now; null when it can't say (not installed, an older build). */
    fun visible(ctx: Context): Boolean? {
        val r = call(ctx, STATE, null, null)?.takeIf { it.getBoolean("ok", false) } ?: return null
        val json = runCatching { JSONObject(r.getString("json") ?: "{}") }.getOrNull() ?: return null
        return if (json.has("visible")) json.optBoolean("visible") else null
    }

    /**
     * Starts the console activity on [url] from this app (which must be in front or allowed to display over other
     * apps) and waits until the console app says it is on screen. Null when it did not come up: Android drops a
     * blocked start without raising anything, so only the console app's own word counts.
     */
    fun launch(ctx: Context, url: String): JSONObject? {
        val i = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setClassName(PACKAGE, ACTIVITY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(i) } catch (e: ActivityNotFoundException) { return null } catch (e: SecurityException) { return null }
        val end = SystemClock.elapsedRealtime() + LinkRules.FRONT_WAIT_MS
        var seen = visible(ctx)
        while (seen == false && SystemClock.elapsedRealtime() < end) { Thread.sleep(150); seen = visible(ctx) }
        if (seen != true) return null
        return JSONObject().put("opened", true).put("how", LinkRules.consoleHow(false)).put("via", "phone-connect")
    }
}
