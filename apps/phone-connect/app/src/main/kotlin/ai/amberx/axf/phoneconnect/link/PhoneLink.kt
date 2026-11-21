package ai.amberx.axf.phoneconnect.link

import android.os.Build
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The phone's side of the link (PHONE-CONNECT.md → The link): one console origin, https only, redirects never followed,
 * replies capped at 256 KB. After the claim every call carries `Authorization: Bearer tok_…` and `X-AXPP: axpp@1`.
 */
class PhoneLink(private val store: PhoneStore, private val http: OkHttpClient = client()) {

    sealed class Reply {
        data class Ok(val json: JSONObject) : Reply()
        object NoContent : Reply()
        /** [coded] = the answer carried a wire error code; false when a proxy or the sign-in wall answered instead of the plugin. */
        data class Fail(val code: String, val message: String, val retryable: Boolean, val status: Int = 0, val coded: Boolean = true) : Reply() {
            /** What the watch does about it (LinkRules.verdict); [uncoded] = bare 401 / 403 answers in a row before this one. */
            fun verdict(uncoded: Int = 0): LinkRules.Verdict = LinkRules.verdict(status, if (coded) code else "", uncoded)
            val bareRefusal: Boolean get() = !coded && status in LinkRules.REJECTED_STATUSES
        }
    }

    /** The device as the console sees it (name, app, capabilities, last known capability state). */
    fun deviceJson(capabilityState: JSONObject? = null): JSONObject = JSONObject()
        .put("deviceId", store.deviceId)
        .put("name", "${Build.MANUFACTURER} ${Build.MODEL}".take(80))
        .put("app", "phone-connect-droid")
        .put("appVersion", APP_VERSION)
        .put("platform", "android")
        .put("capabilities", JSONArray(LinkRules.CAPABILITIES))
        .apply { if (capabilityState != null) put("capabilityState", capabilityState) }

    /**
     * claim (personOnly): the code plus Brett's own hub session cookie, sent once, to the console's wall. The answer
     * carries the device token exactly once; it goes straight into the encrypted store.
     */
    fun claim(code: String, hubCookie: String): Reply {
        val body = JSONObject().put("code", code).put("device", deviceJson())
        val r = call(Request.Builder().url("${store.origin}${LinkRules.BASE_PATH}/pair/confirm")
            .header("Cookie", hubCookie).header("Origin", store.origin)
            .post(body.toString().toRequestBody(JSON)).build())
        if (r is Reply.Ok) {
            val tok = r.json.optString("token")
            if (!LinkRules.isToken(tok)) return Reply.Fail("unexpected", "The console answered without a device token.", false)
            store.token = tok
        }
        return r
    }

    fun hello(capabilityState: JSONObject? = null): Reply = device("POST", "hello", JSONObject().put("device", deviceJson(capabilityState)))
    fun next(waitS: Int = LinkRules.POLL_WAIT_S): Reply = device("GET", "next?wait=$waitS", null)
    fun ack(id: String, status: String): Reply = device("POST", "ack", JSONObject().put("protocol", LinkRules.PROTOCOL).put("correlationId", id).put("status", status))
    fun result(id: String, payload: JSONObject, state: JSONObject? = null, tap: String? = null): Reply = device("POST", "answer", JSONObject()
        .put("protocol", LinkRules.PROTOCOL).put("kind", "result").put("correlationId", id).put("payload", payload)
        .apply { if (state != null) put("state", state); if (tap != null) put("by", JSONObject().put("kind", "person").put("tap", tap)) })
    fun voiceIn(text: String): Reply = device("POST", "voice-in", JSONObject().put("text", text))
    fun error(id: String, code: String, message: String): Reply = device("POST", "answer", JSONObject()
        .put("protocol", LinkRules.PROTOCOL).put("kind", "error").put("correlationId", id)
        .put("error", JSONObject().put("code", code).put("message", message)))

    private fun device(method: String, path: String, body: JSONObject?): Reply {
        val tok = store.token ?: return Reply.Fail("unpaired", "This phone is not paired: enter a code from the console.", false)
        val b = Request.Builder().url("${store.origin}${LinkRules.BASE_PATH}/device/$path")
            .header("Authorization", "Bearer $tok").header(LinkRules.HEADER, LinkRules.PROTOCOL)
        if (method == "POST") b.post((body ?: JSONObject()).toString().toRequestBody(JSON)) else b.get()
        return call(b.build())
    }

    private fun call(req: Request): Reply = try {
        http.newCall(req).execute().use { res ->
            if (res.code == 204) return Reply.NoContent
            val text = res.body?.let { readCapped(it.byteStream()) } ?: ""
            val json = runCatching { JSONObject(text) }.getOrNull() ?: JSONObject()
            if (res.isSuccessful) return Reply.Ok(json)
            if (res.isRedirect) return Reply.Fail("denied", "The console tried to redirect; redirects are never followed.", false, res.code, coded = false)
            val e = json.optJSONObject("error")
            val code = e?.optString("code").orEmpty()
            Reply.Fail(code.ifEmpty { if (res.code >= 500) "unavailable" else "unexpected" },
                e?.optString("message").orEmpty().ifEmpty { "The console answered ${res.code}." },
                e?.optBoolean("retryable", res.code >= 500) ?: (res.code >= 500), res.code, coded = code.isNotEmpty())
        }
    } catch (e: IOException) {
        Reply.Fail("unavailable", "Can't reach the console (${e.javaClass.simpleName}).", true)
    }

    private fun readCapped(input: java.io.InputStream): String {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            if (out.size() > LinkRules.REPLY_MAX_BYTES) throw IOException("reply over 256 KB")
        }
        return out.toString("UTF-8")
    }

    companion object {
        const val APP_VERSION = "0.3.0"
        private val JSON = "application/json".toMediaType()
        fun client(): OkHttpClient = OkHttpClient.Builder()
            .followRedirects(false).followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout((LinkRules.POLL_WAIT_S + 15).toLong(), TimeUnit.SECONDS)
            .build()
    }
}
