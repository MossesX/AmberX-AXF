package ai.amberx.axf.phoneconnect.watch

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.util.Log
import org.json.JSONObject

/**
 * The hand-off to the AXF Console app's floating overlay (console-overlay@1; the console app's side is
 * `apps/console-droid/.../PhoneConnectProvider.java` and `PhoneConnectRules.java`, whose JUnit test checks these names).
 *
 * One synchronous `ContentResolver.call`: the console app loads the page in its one console WebView and expands the
 * floating toolbar over whatever is on screen. Null when it can't (not installed, its overlay off or not allowed to
 * draw over other apps, a page outside its sites): browser.open then opens the page itself, as before.
 */
object ConsoleOverlay {
    const val AUTHORITY = "ai.amberx.consoleapp.overlay"
    const val OPEN = "open"
    const val EXTRA_WHERE = "where"

    /** The console app's answer with `how = console-overlay`, or null to open the page here. */
    fun open(ctx: Context, url: String, where: String): JSONObject? {
        val extras = Bundle().apply { putString(EXTRA_WHERE, where) }
        // not installed (IllegalArgumentException: unknown authority) or the call failed: open it here
        val r: Bundle = runCatching { ctx.contentResolver.call(Uri.parse("content://$AUTHORITY"), OPEN, url, extras) }.getOrNull()
            ?: return null
        if (!r.getBoolean("ok", false)) {
            Log.i("ConsoleOverlay", "console app declined: ${r.getString("code")} ${r.getString("message")}")
            return null
        }
        return runCatching { JSONObject(r.getString("json") ?: "{}") }.getOrNull()?.put("opened", true)?.put("how", "console-overlay")
    }
}
