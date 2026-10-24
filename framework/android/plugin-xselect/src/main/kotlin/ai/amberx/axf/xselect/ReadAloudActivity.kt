package ai.amberx.axf.xselect

import android.app.AlertDialog
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.widget.Toast
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.readaloud.QueuePolicy
import ai.amberx.axf.readaloud.ReadAloud
import ai.amberx.axf.readaloud.TextChunker
import ai.amberx.axf.readaloud.TextPrep
import ai.amberx.axf.selection.ProcessTextActivity
import ai.amberx.axf.selection.SelectedText
import ai.amberx.axf.selection.SelectionRules
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * What every X Select menu entry opens (one activity, an activity-alias per entry). Translucent and gone at once:
 * waits (≤ 1.5 s) for the app's settings to load on a cold start, asks first for a very long text when that's set,
 * gives the start feedback (note, vibration, chime) and hands the text to [ReadAloud], which keeps reading after
 * this closes.
 */
public class ReadAloudActivity : ProcessTextActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private fun service(): XSelectService? = runCatching { AxfApplication.from(this).kernel.services.get(XSelectService::class) }.getOrNull()

    override fun maxChars(): Int = service()?.number(XSelectSettings.SELECTION_CAP, SelectionRules.DEFAULT_MAX_CHARS.toDouble())?.toInt() ?: SelectionRules.DEFAULT_MAX_CHARS

    override fun onSelectedText(selection: SelectedText) {
        if (selection.isEmpty) { Toast.makeText(this, "Nothing to read", Toast.LENGTH_SHORT).show(); return }
        keepOpen()
        scope.launch {
            runCatching { withTimeoutOrNull(1_500) { AxfApplication.from(this@ReadAloudActivity).ready.first { it } } }
            val svc = service()
            val confirmOver = svc?.number(XSelectSettings.CONFIRM_OVER, 0.0)?.toInt() ?: 0
            if (confirmOver > 0 && selection.text.length > confirmOver) confirm(selection, svc) else { start(selection, svc); finishQuietly() }
        }
    }

    private fun confirm(selection: SelectedText, svc: XSelectService?) {
        val words = SelectionRules.words(selection.text)
        AlertDialog.Builder(this)
            .setTitle("Read ${"%,d".format(words)} words aloud?")
            .setMessage(SelectionRules.preview(selection.text, 140))
            .setPositiveButton("Read") { _, _ -> start(selection, svc); finishQuietly() }
            .setNegativeButton("Cancel") { _, _ -> finishQuietly() }
            .setOnCancelListener { finishQuietly() }
            .show()
    }

    private fun start(selection: SelectedText, svc: XSelectService?) {
        val e = XSelectMenu.entry(entry)
        val prefs = ReadAloud.prefs()
        var text = if (e.spell) XSelectMenu.spelled(selection.text) else selection.text
        val title = SelectionRules.preview(selection.text, 60)
        if (svc?.bool(XSelectSettings.SAY_TITLE, false) == true) text = "$title.\n\n$text"
        if (svc?.bool(XSelectSettings.ANNOUNCE, false) == true) {
            val pieces = TextChunker.chunk(TextPrep.prepare(text, prefs), prefs)
            text = XSelectMenu.intro(SelectionRules.words(text), TextChunker.estimateMs(pieces, prefs.rateFor(text.length, e.slow))) + "\n\n" + text
        }
        ReadAloud.read(applicationContext, text, title, slow = e.slow, source = "xselect.menu.${e.alias}", policy = if (e.readNext) QueuePolicy.NEXT else null)
        feedback(svc, selection, e)
    }

    private fun feedback(svc: XSelectService?, selection: SelectedText, entry: MenuEntry) {
        if (svc == null) return
        if (svc.bool(XSelectSettings.TOAST_START, true)) {
            val what = if (entry.readNext) "Reading next" else if (selection.truncated) "Reading the first ${"%,d".format(selection.text.length)} characters" else entry.label
            Toast.makeText(applicationContext, "$what · ${"%,d".format(SelectionRules.words(selection.text))} words", Toast.LENGTH_SHORT).show()
        }
        if (svc.bool(XSelectSettings.VIBRATE, false)) runCatching {
            @Suppress("DEPRECATION") val v = getSystemService(VIBRATOR_SERVICE) as Vibrator
            val ms = svc.number(XSelectSettings.VIBRATE_MS, 30.0).toLong().coerceIn(5, 400)
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)) else @Suppress("DEPRECATION") v.vibrate(ms)
        }
        if (svc.bool(XSelectSettings.CHIME, false)) runCatching {
            val vol = svc.number(XSelectSettings.CHIME_VOLUME, 60.0).toInt().coerceIn(0, 100)
            val tone = ToneGenerator(AudioManager.STREAM_MUSIC, vol)
            tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 180)
            android.os.Handler(mainLooper).postDelayed({ tone.release() }, 400)
        }
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
