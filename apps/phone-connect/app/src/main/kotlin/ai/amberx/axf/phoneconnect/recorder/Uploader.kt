package ai.amberx.axf.phoneconnect.recorder

import android.content.Context
import android.util.Base64
import ai.amberx.axf.hub.HubCredential
import ai.amberx.axf.hub.cookieCredentials
import ai.amberx.axf.phoneconnect.link.PhoneStore
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Sends closed parts to axHub (port of AmberX's OutputRecordUploader): the hub's data server, project
 * `amberx-recordings`, `output-recorder/parts/<id>/<nnnn>.json` (audio-part@1, base64 slices of 44 000 bytes) and then
 * `output-recorder/recordings/<id>.json` (audio-recording@1 with the session's group, session and note), confirmed by
 * reading the index back; the local file goes only after that. Uses the phone's hub session (the pairing sign-in).
 */
object Uploader {
    private const val PROJECT = "amberx-recordings"
    private const val PART_BYTES = 44_000
    private val JSON = "application/json".toMediaType()
    private val worker = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).readTimeout(30, TimeUnit.SECONDS).build()

    fun queue(ctx: Context, file: File, part: Int, startedAt: Long, endedAt: Long) {
        val meta = JSONObject().put("file", file.name).put("part", part).put("startedAt", RecordService.iso(startedAt)).put("endedAt", RecordService.iso(endedAt))
            .put("durationMs", endedAt - startedAt).put("session", RecordSession.session).put("group", RecordSession.group).put("note", RecordSession.note)
        File(file.parentFile, "${file.name}.json").writeText(meta.toString())
        kick(ctx)
    }

    fun pending(ctx: Context): List<File> = File(ctx.filesDir, "recorder").listFiles { f -> f.name.endsWith(".m4a") }?.sortedBy { it.name } ?: emptyList()

    fun kick(ctx: Context) {
        val app = ctx.applicationContext
        worker.execute {
            RecordSession.queue = pending(app).size
            for (f in pending(app)) if (!runCatching { send(app, f) }.getOrDefault(false)) break
            RecordSession.queue = pending(app).size
        }
    }

    private fun send(ctx: Context, f: File): Boolean {
        val metaFile = File(f.parentFile, "${f.name}.json")
        val m = runCatching { JSONObject(metaFile.readText()) }.getOrDefault(JSONObject())
        val hub = PhoneStore(ctx).hub.trimEnd('/')
        val cookie = (cookieCredentials { hub }.current() as? HubCredential.SessionCookie)?.cookie ?: return false
        val id = f.name.removeSuffix(".m4a")
        val size = f.length()
        val parts = ((size + PART_BYTES - 1) / PART_BYTES).toInt()
        val buf = ByteArray(PART_BYTES)
        RandomAccessFile(f, "r").use { raf ->
            for (n in 0 until parts) {
                raf.seek(n.toLong() * PART_BYTES)
                val len = minOf(PART_BYTES.toLong(), size - n.toLong() * PART_BYTES).toInt()
                raf.readFully(buf, 0, len)
                val doc = JSONObject().put("\$axf", "audio-part@1").put("id", id).put("n", n).put("b64", Base64.encodeToString(buf, 0, len, Base64.NO_WRAP))
                if (!put(hub, "output-recorder/parts/$id/${String.format("%04d", n)}.json", doc, cookie)) return false
            }
        }
        val sha = sha256(f)
        val index = JSONObject().put("\$axf", "audio-recording@1").put("id", id).put("name", m.optString("session").ifBlank { "Phone audio" } + " - part" + m.optInt("part", 1))
            .put("startedAt", m.optString("startedAt")).put("endedAt", m.optString("endedAt")).put("durationMs", m.optLong("durationMs"))
            .put("bytes", size).put("mime", "audio/mp4").put("kbps", 32).put("channels", 1).put("device", PhoneStore(ctx).deviceId)
            .put("parts", parts).put("partBytes", PART_BYTES).put("sha256", sha).put("uploadedAt", RecordService.iso(System.currentTimeMillis()))
            .put("part", m.optInt("part", 1)).put("deleted", false)
        for (k in listOf("group", "session", "note")) if (m.optString(k).isNotBlank()) index.put(k, m.optString(k))
        if (!put(hub, "output-recorder/recordings/$id.json", index, cookie)) return false
        val back = http.newCall(Request.Builder().url("$hub/data/$PROJECT/output-recorder/recordings/$id.json").header("Cookie", cookie).get().build()).execute().use { r ->
            if (r.code != 200) null else runCatching { JSONObject(r.body?.string() ?: "") }.getOrNull()
        } ?: return false
        if (back.optInt("parts") != parts || back.optLong("bytes") != size || back.optString("sha256") != sha) return false
        f.delete(); metaFile.delete()
        return true
    }

    private fun put(hub: String, path: String, doc: JSONObject, cookie: String): Boolean =
        http.newCall(Request.Builder().url("$hub/data/$PROJECT/$path").header("Cookie", cookie).header("Origin", hub)
            .put(doc.toString().toRequestBody(JSON)).build()).execute().use { it.code == 200 }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input -> val b = ByteArray(65536); while (true) { val n = input.read(b); if (n <= 0) break; md.update(b, 0, n) } }
        return md.digest().joinToString("") { String.format("%02x", it.toInt() and 0xff) }
    }
}
