package ai.amberx.axf.phoneconnect.recorder

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import ai.amberx.axf.phoneconnect.watch.Notifier
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Audio output recorder (port of AmberX's OutputRecordService, recorder@1): what the phone plays, through
 * AudioPlaybackCapture (MediaProjection, Android 10+), never the microphone. 48 kHz capture → mono AAC-LC 32 kbps → one
 * MediaMuxer per 30-minute part; each closed part is queued for axHub ([Uploader]). Calls and apps that opt out of
 * capture are silent. The opt-in mic track of AmberX ("Record my mic too") is not ported yet.
 */
class RecordService : Service() {
    @Volatile private var stopping = false
    private var pump: Thread? = null
    private var projection: MediaProjection? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start(intent)
            ACTION_STOP -> { stopping = true; if (pump == null) stopSelf() }
            else -> if (!RecordSession.running) stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun start(intent: Intent) {
        Notifier.channels(this)
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0
        ServiceCompat.startForeground(this, NOTE, note("Recording the phone's sound"), type)
        if (Build.VERSION.SDK_INT < 29) { RecordSession.refused("Recording the phone's sound needs Android 10 or later."); stopSelf(); return }
        val mpm = getSystemService(MediaProjectionManager::class.java)
        val code = intent.getIntExtra(EXTRA_CODE, 0)
        @Suppress("DEPRECATION") val data: Intent? = intent.getParcelableExtra(EXTRA_DATA)
        val p = if (mpm != null && data != null) runCatching { mpm.getMediaProjection(code, data) }.getOrNull() else null
        if (p == null) { RecordSession.refused("Android didn't hand over the capture."); stopSelf(); return }
        projection = p
        stopping = false
        RecordSession.started(iso(System.currentTimeMillis()))
        pump = Thread({ record(p) }, "phone-recorder").also { it.start() }
    }

    @Suppress("MissingPermission") // RECORD_AUDIO is asked for by the pairing screen before a start can reach here
    private fun record(p: MediaProjection) {
        val cfg = AudioPlaybackCaptureConfiguration.Builder(p)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME).addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build()
        val fmt = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build()
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT).coerceAtLeast(4096)
        val rec = runCatching { AudioRecord.Builder().setAudioFormat(fmt).setBufferSizeInBytes(min * 4).setAudioPlaybackCaptureConfig(cfg).build() }.getOrNull()
        if (rec == null) { RecordSession.refused("Android refused the playback capture (the mic permission is needed for it)."); finishUp(); return }
        rec.startRecording()
        val buf = ByteArray(min)
        var part: Part? = null
        try {
            while (!stopping) {
                val cur = part?.takeUnless { it.full() } ?: run { part?.close(this); RecordSession.parts++; Part.open(this, RecordSession.parts).also { part = it } }
                val n = rec.read(buf, 0, buf.size)
                if (n > 0) cur.write(buf, n)
            }
        } finally {
            runCatching { rec.stop() }; rec.release()
            part?.close(this)
            finishUp()
        }
    }

    private fun finishUp() {
        runCatching { projection?.stop() }
        projection = null
        pump = null
        RecordSession.stopped()
        Uploader.kick(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun note(text: String) = NotificationCompat.Builder(this, Notifier.CH_LINK)
        .setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle(RecordSession.session.ifBlank { "Phone audio" })
        .setContentText(text).setOngoing(true).setContentIntent(Notifier.appIntent(this)).build()

    /** One 30-minute part: AAC encoder → MP4 muxer, timestamps from the samples written. */
    private class Part(val file: File, val n: Int, val startedAt: Long) {
        private val codec: MediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        private val muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        private var track = -1
        private var samples = 0L
        private val info = MediaCodec.BufferInfo()

        init {
            val f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RATE, 1)
            f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            f.setInteger(MediaFormat.KEY_BIT_RATE, KBPS * 1000)
            f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
            codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
        }

        fun full(): Boolean = samples >= RATE.toLong() * PART_SECONDS

        fun write(pcm: ByteArray, len: Int, eos: Boolean = false) {
            var off = 0
            while (off < len || eos) {
                val i = codec.dequeueInputBuffer(10_000)
                if (i >= 0) {
                    val inb = codec.getInputBuffer(i) ?: break
                    val take = minOf(inb.remaining(), len - off)
                    inb.put(pcm, off, take)
                    val us = samples * 1_000_000L / RATE
                    codec.queueInputBuffer(i, 0, take, us, if (eos && off + take >= len) MediaCodec.BUFFER_FLAG_END_OF_STREAM else 0)
                    samples += take / 2
                    off += take
                    if (eos && off >= len) { drain(true); return }
                }
                drain(false)
            }
        }

        private fun drain(end: Boolean) {
            var idle = 0
            while (true) {
                val o = codec.dequeueOutputBuffer(info, if (end) 10_000 else 0)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (track < 0) { track = muxer.addTrack(codec.outputFormat); muxer.start() }
                    continue
                }
                if (o < 0) { if (!end || ++idle > 100) return; continue }
                val out = codec.getOutputBuffer(o)
                val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                if (out != null && track >= 0 && info.size > 0 && !config) muxer.writeSampleData(track, out, info)
                codec.releaseOutputBuffer(o, false)
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
            }
        }

        fun close(svc: RecordService) {
            runCatching { write(ByteArray(0), 0, eos = true) }
            runCatching { codec.stop() }; codec.release()
            runCatching { if (track >= 0) muxer.stop() }; runCatching { muxer.release() }
            if (track >= 0 && file.length() > 0) Uploader.queue(svc, file, n, startedAt, System.currentTimeMillis())
            else file.delete()
        }

        companion object {
            fun open(svc: RecordService, n: Int): Part {
                val dir = File(svc.filesDir, "recorder").apply { mkdirs() }
                val now = System.currentTimeMillis()
                return Part(File(dir, "${stamp(now)}-part$n.m4a"), n, now)
            }
        }
    }

    companion object {
        const val ACTION_START = "ai.amberx.axf.phoneconnect.recorder.START"
        const val ACTION_STOP = "ai.amberx.axf.phoneconnect.recorder.STOP"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        private const val NOTE = 7311
        private const val RATE = 48_000
        private const val KBPS = 32
        const val PART_SECONDS = 30 * 60

        fun iso(ms: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(ms))
        fun stamp(ms: Long): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(ms))
    }
}
