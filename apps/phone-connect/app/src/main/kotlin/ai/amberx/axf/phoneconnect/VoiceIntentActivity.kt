package ai.amberx.axf.phoneconnect

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import ai.amberx.axf.phoneconnect.link.PhoneLink
import ai.amberx.axf.phoneconnect.link.PhoneStore

/**
 * Voice command intents → the console (phone.voice): text shared to Phone Connect, or the app's own VOICE action with
 * an EXTRA_TEXT (an Assistant routine, Tasker). The phrase goes over the device token to the console, which runs it like
 * Ctrl+K. Nothing here opens the mic.
 */
class VoiceIntentActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = intent?.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty().take(600)
        val store = PhoneStore(this)
        if (text.isEmpty() || !store.paired) {
            Toast.makeText(this, if (!store.paired) "Pair Phone Connect first." else "Nothing to send.", Toast.LENGTH_SHORT).show()
            finish(); return
        }
        Thread {
            val r = PhoneLink(store).voiceIn(text)
            runOnUiThread {
                Toast.makeText(this, if (r is PhoneLink.Reply.Fail) r.message else "Sent to the console: $text", Toast.LENGTH_SHORT).show()
                finish()
            }
        }.start()
    }

    companion object { const val ACTION_VOICE = "ai.amberx.axf.phoneconnect.VOICE" }
}
