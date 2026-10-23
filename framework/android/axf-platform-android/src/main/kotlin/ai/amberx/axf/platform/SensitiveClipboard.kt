package ai.amberx.axf.platform

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
 * Copies a secret marked sensitive (hidden from the keyboard's clipboard preview on Android 13+; the same extra on
 * older versions for keyboards that read it) and clears it after a delay. Each copy carries a random tag: when the
 * clipboard visibly holds something else by then it is left alone; when it can't be read (app in the background) it
 * is cleared. Harvested from Voice Vault (Oct 2026).
 */
public class SensitiveClipboard(private val context: Context, private val scope: CoroutineScope, private val tagKey: String = DEFAULT_TAG_KEY) {
    private val cm: ClipboardManager get() = requireNotNull(context.getSystemService(ClipboardManager::class.java))
    private var clearJob: Job? = null
    private var tag: String? = null

    /** True while our last copy hasn't been cleared yet. */
    public val holdsCopy: Boolean get() = tag != null

    /** [clearAfterSec] 0 = never clear. */
    public fun copy(label: String, secret: String, clearAfterSec: Int) {
        val t = UUID.randomUUID().toString()
        val clip = ClipData.newPlainText(label, secret)
        clip.description.extras = PersistableBundle().apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            else putBoolean("android.content.extra.IS_SENSITIVE", true)
            putString(tagKey, t)
        }
        cm.setPrimaryClip(clip)
        tag = t
        clearJob?.cancel()
        clearJob = if (clearAfterSec > 0) scope.launch { delay(clearAfterSec * 1000L); clearNow() } else null
    }

    /** Clears our copy now (never someone else's). */
    public fun clearNow() {
        clearJob?.cancel(); clearJob = null
        val mine = tag ?: return
        tag = null
        runCatching {
            val desc = cm.primaryClipDescription
            val other = desc != null && desc.extras?.getString(tagKey) != mine
            if (other) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) cm.clearPrimaryClip() else cm.setPrimaryClip(ClipData.newPlainText("", ""))
        }
    }

    public companion object { public const val DEFAULT_TAG_KEY: String = "ai.amberx.axf.clipboard.copy" }
}
