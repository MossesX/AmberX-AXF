package ai.amberx.axf.voicevault.vault

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Copies a password as sensitive (hidden from the keyboard's clipboard preview on Android 13+) and
 * clears it after a delay. Each copy carries a random tag; when the clipboard visibly holds something
 * else by then it is left alone, and when it can't be read (app in the background) it is cleared.
 */
class SecretClipboard(private val context: Context, private val scope: CoroutineScope) {
    private val cm: ClipboardManager get() = context.getSystemService(ClipboardManager::class.java)
    private var clearJob: Job? = null
    private var tag: String? = null

    /** [clearAfterSec] 0 = never clear. */
    fun copy(label: String, secret: String, clearAfterSec: Int) {
        val t = UUID.randomUUID().toString()
        val clip = ClipData.newPlainText(label, secret)
        clip.description.extras = PersistableBundle().apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            else putBoolean("android.content.extra.IS_SENSITIVE", true)
            putString(TAG_KEY, t)
        }
        cm.setPrimaryClip(clip)
        tag = t
        clearJob?.cancel()
        clearJob = if (clearAfterSec > 0) scope.launch { delay(clearAfterSec * 1000L); clearNow() } else null
    }

    /** Clears our copy now. */
    fun clearNow() {
        clearJob?.cancel(); clearJob = null
        val mine = tag ?: return
        tag = null
        runCatching {
            val desc = cm.primaryClipDescription
            val other = desc != null && desc.extras?.getString(TAG_KEY) != mine
            if (other) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) cm.clearPrimaryClip() else cm.setPrimaryClip(ClipData.newPlainText("", ""))
        }
    }

    private companion object { const val TAG_KEY = "ai.amberx.axf.voicevault.copy" }
}
