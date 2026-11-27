package ai.amberx.axf.phoneconnect.recorder

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle

/**
 * Android's own consent for playback capture (MediaProjection), asked on every start: the `consent_required` step of
 * recorder.start. A yes starts [RecordService]; a no answers the waiting command `consent_required`.
 */
class RecordStartActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mpm = getSystemService(MediaProjectionManager::class.java)
        if (mpm == null) { RecordSession.refused("This phone has no screen-capture service."); finish(); return }
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST)
    }

    @Deprecated("Activity result API kept simple for a single translucent prompt")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST && resultCode == RESULT_OK && data != null) {
            startForegroundService(Intent(this, RecordService::class.java).setAction(RecordService.ACTION_START)
                .putExtra(RecordService.EXTRA_CODE, resultCode).putExtra(RecordService.EXTRA_DATA, data))
        } else {
            RecordSession.refused("You said no to recording the phone's sound.")
        }
        finish()
    }

    companion object { private const val REQUEST = 7311 }
}
