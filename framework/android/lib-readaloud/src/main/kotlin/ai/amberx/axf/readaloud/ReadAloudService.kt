package ai.amberx.axf.readaloud

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Foreground playback for [ReadAloud]: one TextToSpeech engine, the queue, pauses between utterances, audio focus,
 * headphones-unplugged / screen-off / sleep-timer stops and the notification with controls. Everything runs on the
 * main thread; TTS callbacks are posted to it. Stops itself when the queue is empty.
 */
public class ReadAloudService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ttsEngine: String? = null
    private var ready = false
    private var pendingStart = false
    private var prefs = ReadAloudPrefs.DEFAULT
    private var seq = 0L
    private var readTimes = 0
    private var focusRequest: AudioFocusRequest? = null
    private var pausedByFocus = false
    private var receiversOn = false
    private var foreground = false
    private var retriesLeft = 0
    private val audio by lazy { getSystemService(AUDIO_SERVICE) as AudioManager }
    private val notifications by lazy { getSystemService(NOTIFICATION_SERVICE) as NotificationManager }
    private val sleep = Runnable { stopAll() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        prefs = ReadAloud.prefs()
        when (intent?.action) {
            ReadAloud.ACTION_READ -> {
                ensureForeground()
                val text = intent.getStringExtra(ReadAloud.EXTRA_TEXT).orEmpty()
                val title = intent.getStringExtra(ReadAloud.EXTRA_TITLE).orEmpty()
                val slow = intent.getBooleanExtra(ReadAloud.EXTRA_SLOW, false)
                val policy = intent.getStringExtra(ReadAloud.EXTRA_POLICY)?.let { id -> QueuePolicy.entries.firstOrNull { it.id == id } } ?: prefs.queue
                enqueue(text, title, slow, intent.getStringExtra(ReadAloud.EXTRA_SOURCE).orEmpty(), policy)
            }
            ReadAloud.ACTION_PAUSE -> pause(false)
            ReadAloud.ACTION_RESUME -> resume()
            ReadAloud.ACTION_TOGGLE -> if (ReadAloud.state.value.paused) resume() else pause(false)
            ReadAloud.ACTION_STOP -> stopAll()
            ReadAloud.ACTION_NEXT -> jump(true)
            ReadAloud.ACTION_PREV -> jump(false)
            ReadAloud.ACTION_FASTER -> changeRate(+prefs.rateStep)
            ReadAloud.ACTION_SLOWER -> changeRate(-prefs.rateStep)
            ReadAloud.ACTION_SKIP_ITEM -> finishItem(false)
            ReadAloud.ACTION_VOICES -> { engine(); publishVoices(); if (!ReadAloud.state.value.active) main.postDelayed({ if (!ReadAloud.state.value.active) stopSelf() }, prefs.initTimeoutMs.toLong()) }
            else -> if (!ReadAloud.state.value.active) stopSelf()
        }
        return START_NOT_STICKY
    }

    /* ---------- queue ---------- */

    private fun enqueue(text: String, title: String, slow: Boolean, source: String, policy: QueuePolicy) {
        val now = System.currentTimeMillis()
        val item = ReadAloudPlan.item(text, prefs, ++seq, title.ifBlank { TextChunker.chunk(text.take(200), prefs).firstOrNull()?.text?.take(60) ?: "Text" }, slow, source, now)
        if (item == null) {
            ReadAloud.update { it.copy(error = if (text.isBlank()) "Nothing to read." else "That text is longer than the limit (${prefs.maxChars} characters).") }
            if (!ReadAloud.state.value.active) stopAll()
            return
        }
        val wasIdle = ReadAloud.state.value.queue.isIdle
        val replacing = !wasIdle && policy == QueuePolicy.REPLACE
        ReadAloud.update { it.copy(queue = it.queue.add(item, policy, prefs.queueSize, prefs.history, now), error = null) }
        if (wasIdle || replacing) { readTimes = 0; ReadAloud.update { it.copy(rate = item.rate) }; startCurrent(prefs.startDelayMs.toLong()) } else notifyState()
        armSleep()
    }

    private fun startCurrent(delayMs: Long = 0) {
        val st = ReadAloud.state.value
        if (st.queue.current == null) { stopAll(); return }
        ReadAloud.update { it.copy(speaking = true, paused = false, word = null) }
        requestFocus(); registerReceivers(); notifyState()
        val go = Runnable { if (ready) speakAt(ReadAloud.state.value.queue.position) else { pendingStart = true; engine() } }
        tts?.stop()
        if (delayMs > 0) main.postDelayed(go, delayMs) else go.run()
    }

    private fun finishItem(finished: Boolean) {
        val now = System.currentTimeMillis()
        if (finished) {
            readTimes++
            if (ReadAloudPlan.shouldRepeat(prefs, readTimes)) { ReadAloud.update { it.copy(queue = it.queue.seek(0)) }; startCurrent(prefs.paragraphPauseMs.toLong()); return }
        }
        readTimes = 0
        ReadAloud.update { it.copy(queue = it.queue.finish(finished, prefs.history, now), word = null) }
        val next = ReadAloud.state.value.queue.current
        if (next == null) stopAll() else { ReadAloud.update { it.copy(rate = next.rate) }; startCurrent(prefs.paragraphPauseMs.toLong()) }
    }

    /* ---------- speaking ---------- */

    private fun engine(): TextToSpeech? {
        val want = prefs.engine.ifBlank { null }
        if (tts != null && want == ttsEngine) return tts
        runCatching { tts?.shutdown() }
        ready = false; ttsEngine = want; retriesLeft = prefs.retries
        val t = TextToSpeech(applicationContext, { status -> main.post { onEngineReady(status == TextToSpeech.SUCCESS) } }, want)
        t.setOnUtteranceProgressListener(listener)
        tts = t
        main.postDelayed({ if (!ready && tts === t) { ReadAloud.update { it.copy(error = "The text-to-speech engine didn't start.", speaking = false) }; notifyState() } }, prefs.initTimeoutMs.toLong())
        return t
    }

    private fun onEngineReady(ok: Boolean) {
        ready = ok
        if (!ok) { ReadAloud.update { it.copy(error = "The text-to-speech engine didn't start.", speaking = false) }; notifyState(); return }
        publishVoices()
        if (pendingStart) { pendingStart = false; speakAt(ReadAloud.state.value.queue.position) }
    }

    private fun publishVoices() {
        val t = tts ?: return
        if (!ready) return
        val voices = runCatching { t.voices.orEmpty().map { VoiceInfo(it.name, it.locale.toLanguageTag(), it.quality, it.isNetworkConnectionRequired, !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) }.sortedWith(compareBy({ it.language }, { -it.quality }, { it.name })) }.getOrDefault(emptyList())
        val engines = runCatching { t.engines.map { EngineInfo(it.name, it.label) } }.getOrDefault(emptyList())
        ReadAloud.update { it.copy(voices = voices, engines = engines, defaultEngine = runCatching { t.defaultEngine }.getOrDefault("") ?: "") }
    }

    private fun configureEngine(t: TextToSpeech, rate: Double) {
        t.setAudioAttributes(attributes())
        t.setSpeechRate(rate.toFloat())
        t.setPitch(prefs.pitch.toFloat())
        val lang = prefs.language.takeIf { it.isNotBlank() && it != "system" }?.let { Locale.forLanguageTag(it) }
        val voices = runCatching { t.voices.orEmpty() }.getOrDefault(emptySet())
        val named = prefs.voice.takeIf { it.isNotBlank() }?.let { n -> voices.firstOrNull { it.name == n } }
        val picked = named ?: lang?.let { l ->
            voices.filter { it.locale.language == l.language && (l.country.isEmpty() || it.locale.country == l.country) }
                .filter { prefs.allowNetworkVoices || !it.isNetworkConnectionRequired }
                .filter { it.quality >= prefs.minQuality }
                .filter { !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
                .sortedWith(compareBy({ if (prefs.preferOffline && it.isNetworkConnectionRequired) 1 else 0 }, { -it.quality }))
                .firstOrNull()
        }
        when {
            picked != null -> runCatching { t.setVoice(picked) }
            lang != null -> runCatching { t.setLanguage(lang) }
            else -> runCatching { t.setLanguage(Locale.getDefault()) }
        }
    }

    private fun speakAt(index: Int) {
        val t = tts ?: engine() ?: return
        val st = ReadAloud.state.value
        val item = st.queue.current ?: return
        val u = item.utterances.getOrNull(index) ?: run { finishItem(true); return }
        ReadAloud.update { it.copy(queue = it.queue.seek(index), speaking = true, paused = false, word = null) }
        configureEngine(t, st.rate)
        val params = Bundle().apply {
            putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, (prefs.volume / 100.0).toFloat())
            putFloat(TextToSpeech.Engine.KEY_PARAM_PAN, prefs.pan.toFloat())
        }
        val r = t.speak(u.text, TextToSpeech.QUEUE_FLUSH, params, uid(item.id, index, false))
        if (r != TextToSpeech.SUCCESS) onUtteranceError()
        notifyState()
    }

    private fun uid(item: Long, index: Int, silence: Boolean) = "${if (silence) "s" else "u"}-$item-$index"

    private val listener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}
        override fun onDone(utteranceId: String?) { main.post { onDone(utteranceId) } }
        @Deprecated("Deprecated in Java") override fun onError(utteranceId: String?) { main.post { onUtteranceError() } }
        override fun onError(utteranceId: String?, errorCode: Int) { main.post { onUtteranceError() } }
        override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
            main.post { if (utteranceId != null && utteranceId.startsWith("u-")) ReadAloud.update { it.copy(word = start until end) } }
        }
    }

    private fun onDone(id: String?) {
        val st = ReadAloud.state.value
        val item = st.queue.current ?: return
        if (st.paused || id == null) return
        val parts = id.split('-')
        if (parts.size != 3 || parts[1].toLongOrNull() != item.id) return
        val index = parts[2].toIntOrNull() ?: return
        if (index != st.queue.position) return
        val u = item.utterances.getOrNull(index)
        if (parts[0] == "u" && u != null && u.pauseAfterMs > 0) {
            tts?.playSilentUtterance(u.pauseAfterMs.toLong(), TextToSpeech.QUEUE_ADD, uid(item.id, index, true)); return
        }
        if (index + 1 < item.utterances.size) speakAt(index + 1) else finishItem(true)
    }

    private fun onUtteranceError() {
        if (retriesLeft > 0) { retriesLeft--; main.postDelayed({ speakAt(ReadAloud.state.value.queue.position) }, 400); return }
        ReadAloud.update { it.copy(error = "The voice couldn't read part of the text; skipped it.") }
        val st = ReadAloud.state.value
        val item = st.queue.current ?: return
        retriesLeft = prefs.retries
        if (st.queue.position + 1 < item.utterances.size) speakAt(st.queue.position + 1) else finishItem(true)
    }

    /* ---------- controls ---------- */

    private fun pause(byFocus: Boolean) {
        if (!ReadAloud.state.value.active || ReadAloud.state.value.paused) return
        pausedByFocus = byFocus
        tts?.stop()
        ReadAloud.update { it.copy(paused = true, speaking = false) }
        if (!byFocus) abandonFocus()
        notifyState()
    }

    private fun resume() {
        if (!ReadAloud.state.value.active) return
        pausedByFocus = false
        ReadAloud.update { it.copy(paused = false, speaking = true) }
        requestFocus()
        if (ready) speakAt(ReadAloud.state.value.queue.position) else { pendingStart = true; engine() }
    }

    private fun jump(forward: Boolean) {
        val st = ReadAloud.state.value
        val item = st.queue.current ?: return
        val at = TextChunker.skip(item.utterances, st.queue.position, forward, prefs.skipUnit)
        if (forward && at == st.queue.position && at == item.utterances.lastIndex) { finishItem(false); return }
        ReadAloud.update { it.copy(queue = it.queue.seek(at)) }
        if (st.paused) notifyState() else speakAt(at)
    }

    private fun changeRate(delta: Double) {
        val r = ReadAloudRanges.RATE.clamp(ReadAloud.state.value.rate + delta)
        ReadAloud.update { it.copy(rate = Math.round(r * 100) / 100.0) }
        if (!ReadAloud.state.value.paused) speakAt(ReadAloud.state.value.queue.position) else notifyState()
    }

    private fun stopAll() {
        main.removeCallbacksAndMessages(null)
        runCatching { tts?.stop() }
        ReadAloud.update { it.copy(queue = it.queue.clear(prefs.history, System.currentTimeMillis()), speaking = false, paused = false, word = null, sleepAt = 0L) }
        abandonFocus(); unregisterReceivers()
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        foreground = false
        stopSelf()
    }

    private fun armSleep() {
        main.removeCallbacks(sleep)
        if (prefs.sleepMinutes > 0) {
            val ms = prefs.sleepMinutes * 60_000L
            main.postDelayed(sleep, ms)
            ReadAloud.update { it.copy(sleepAt = System.currentTimeMillis() + ms) }
        } else ReadAloud.update { it.copy(sleepAt = 0L) }
    }

    /* ---------- audio focus + receivers ---------- */

    private fun attributes(): AudioAttributes = AudioAttributes.Builder()
        .setUsage(when (prefs.usage) {
            AudioUsage.MEDIA -> AudioAttributes.USAGE_MEDIA
            AudioUsage.ACCESSIBILITY -> AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY
            AudioUsage.ASSISTANT -> AudioAttributes.USAGE_ASSISTANT
            AudioUsage.NAVIGATION -> AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE
            AudioUsage.NOTIFICATION -> AudioAttributes.USAGE_NOTIFICATION
            AudioUsage.ALARM -> AudioAttributes.USAGE_ALARM
        })
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        main.post {
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> when (prefs.onFocusLoss) {
                    FocusLoss.PAUSE -> pause(true)
                    FocusLoss.STOP -> stopAll()
                    FocusLoss.KEEP -> Unit
                }
                AudioManager.AUDIOFOCUS_GAIN -> if (pausedByFocus && prefs.resumeAfterFocus) resume()
            }
        }
    }

    private fun requestFocus() {
        if (prefs.focus == FocusMode.NONE || focusRequest != null || Build.VERSION.SDK_INT < 26) return
        val gain = if (prefs.focus == FocusMode.DUCK_OTHERS) AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK else AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        val req = AudioFocusRequest.Builder(gain).setAudioAttributes(attributes()).setOnAudioFocusChangeListener(focusListener, main).build()
        focusRequest = req
        runCatching { audio.requestAudioFocus(req) }
    }

    private fun abandonFocus() {
        val req = focusRequest ?: return
        if (Build.VERSION.SDK_INT >= 26) runCatching { audio.abandonAudioFocusRequest(req) }
        focusRequest = null
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                AudioManager.ACTION_AUDIO_BECOMING_NOISY -> if (prefs.pauseOnUnplug) pause(false)
                Intent.ACTION_SCREEN_OFF -> if (prefs.stopOnScreenOff) stopAll()
            }
        }
    }

    private fun registerReceivers() {
        if (receiversOn) return
        val f = IntentFilter().apply { addAction(AudioManager.ACTION_AUDIO_BECOMING_NOISY); addAction(Intent.ACTION_SCREEN_OFF) }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, f, RECEIVER_NOT_EXPORTED) else @Suppress("UnspecifiedRegisterReceiverFlag") registerReceiver(receiver, f)
        receiversOn = true
    }

    private fun unregisterReceivers() { if (receiversOn) { runCatching { unregisterReceiver(receiver) }; receiversOn = false } }

    /* ---------- notification ---------- */

    private fun ensureForeground() {
        if (foreground) return
        if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Read aloud", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false); description = "What's being read aloud, with controls" })
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(NOTIFICATION_ID, n)
        foreground = true
    }

    private fun notifyState() { if (foreground) runCatching { notifications.notify(NOTIFICATION_ID, buildNotification()) } }

    private fun pending(action: String, code: Int): PendingIntent =
        PendingIntent.getService(this, code, ReadAloud.command(this, action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun buildNotification(): Notification {
        val st = ReadAloud.state.value
        val item = st.queue.current
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
        val title = item?.title?.ifBlank { null } ?: ReadAloud.notificationTitle
        val sentence = st.utterance?.text?.takeIf { prefs.showSentence }
        val status = when { st.error != null -> st.error; st.paused -> "Paused"; !ready -> "Starting the voice…"; else -> "Reading · ${st.rate}×" }
        b.setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle(title)
            .setContentText(sentence ?: status)
            .setSubText(if (prefs.showProgress && item != null) "${(st.queue.progress() * 100).toInt()}% · ${st.queue.position + 1}/${item.utterances.size}" + (if (st.queue.next.isNotEmpty()) " · ${st.queue.next.size} next" else "") else null)
            .setOngoing(st.active && !st.paused)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
        if (sentence != null) b.setStyle(Notification.BigTextStyle().bigText(sentence).setSummaryText(status))
        if (prefs.showProgress && item != null) b.setProgress(1000, (st.queue.progress() * 1000).toInt(), false)
        ReadAloud.openApp?.let { b.setContentIntent(PendingIntent.getActivity(this, 1, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)) }
        b.setDeleteIntent(pending(ReadAloud.ACTION_STOP, 9))
        fun act(icon: Int, label: String, action: String, code: Int) = b.addAction(Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, icon), label, pending(action, code)).build())
        val toggleIcon = if (st.paused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause
        val toggleLabel = if (st.paused) "Resume" else "Pause"
        when (prefs.controls) {
            ControlsMode.FULL -> {
                act(android.R.drawable.ic_media_previous, "Back", ReadAloud.ACTION_PREV, 2)
                act(toggleIcon, toggleLabel, ReadAloud.ACTION_TOGGLE, 3)
                act(android.R.drawable.ic_media_next, "Next", ReadAloud.ACTION_NEXT, 4)
                act(android.R.drawable.ic_media_rew, "Slower", ReadAloud.ACTION_SLOWER, 5)
                act(android.R.drawable.ic_media_ff, "Faster", ReadAloud.ACTION_FASTER, 6)
            }
            ControlsMode.COMPACT -> {
                act(toggleIcon, toggleLabel, ReadAloud.ACTION_TOGGLE, 3)
                act(android.R.drawable.ic_menu_close_clear_cancel, "Stop", ReadAloud.ACTION_STOP, 7)
            }
            ControlsMode.NONE -> Unit
        }
        return b.build()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        abandonFocus(); unregisterReceivers()
        runCatching { tts?.stop(); tts?.shutdown() }
        tts = null; ready = false
        if (ReadAloud.state.value.active) ReadAloud.update { it.copy(queue = it.queue.clear(prefs.history, System.currentTimeMillis()), speaking = false, paused = false, word = null) }
        super.onDestroy()
    }

    private companion object {
        const val CHANNEL = "axf-readaloud"
        const val NOTIFICATION_ID = 0x5EAD
    }
}
