package ai.amberx.axf.network

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.KernelFlags
import ai.amberx.axf.kernel.config.ConfigLayer
import ai.amberx.axf.kernel.flags.FeatureFlags
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.platform.AxfLogger
import ai.amberx.axf.kernel.platform.FileArea
import ai.amberx.axf.kernel.platform.FileLayout
import ai.amberx.axf.kernel.platform.Log
import ai.amberx.axf.kernel.platform.NoopLogger
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Cache
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Registers [AxfHttp] (`axf.http`), [WebSocketClient] factory and the remote-config fetcher. */
public class NetworkModule : BaseModule(ID, "Network") {
    override val provides: List<Capability> = listOf(Capability("axf.http", "HTTP client with retries, cache and auth seam"), Capability("axf.websocket"), Capability("axf.remoteConfig"))
    override fun register(ctx: ModuleContext) {
        val files = ctx.service(FileLayout::class)
        val cacheDir = files?.path(FileArea.CACHE, "axf.network", "http")?.let(::File)
        val http = AxfHttp(cacheDir, ctx.service(AxfLogger::class) ?: NoopLogger)
        ctx.services.register(AxfHttp::class, http, "axf.http")
        ctx.services.register(RemoteConfig::class, RemoteConfig(http, ctx), "axf.remoteConfig")
    }
    override suspend fun start(ctx: ModuleContext) {
        val flags = ctx.service(FeatureFlags::class) ?: return
        if (flags.isEnabled(KernelFlags.REMOTE_CONFIG.id)) ctx.service(RemoteConfig::class)?.refresh()
    }
    public companion object { public const val ID: String = "ai.amberx.axf.network" }
}

/** Supplies auth headers per request (lib-accounts registers one). */
public fun interface AuthProvider { public fun headers(url: String): Map<String, String> }

public data class HttpResponse(val code: Int, val body: String, val headers: Map<String, String>) {
    public val ok: Boolean get() = code in 200..299
    public fun json(): JsonObject? = body.let { ai.amberx.axf.kernel.asset.parseJsonObjectOf(it) }
}

/**
 * OkHttp wrapper: retries with exponential backoff on 5xx/IO, disk cache, pluggable auth, progress-free
 * simple calls. Every call returns AxfResult with Unavailable for retryable failures so QueryClient retries.
 */
public class AxfHttp(cacheDir: File?, private val logger: AxfLogger, public var auth: AuthProvider? = null, public var baseUrl: String = "") {
    private val log = Log(logger, "AxfHttp", module = "axf.network")
    public val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
        .apply { if (cacheDir != null) cache(Cache(cacheDir.apply { mkdirs() }, 20L * 1024 * 1024)) }
        .addInterceptor(Interceptor { chain ->
            val b = chain.request().newBuilder().header("User-Agent", "AmberX-AXF/${ai.amberx.axf.kernel.AxfVersion.FRAMEWORK} android")
            auth?.headers(chain.request().url.toString())?.forEach { (k, v) -> b.header(k, v) }
            chain.proceed(b.build())
        })
        .build()

    private fun resolve(url: String) = if (url.startsWith("http")) url else baseUrl.trimEnd('/') + "/" + url.trimStart('/')

    public suspend fun get(url: String, headers: Map<String, String> = emptyMap(), retries: Int = 2): AxfResult<HttpResponse> = execute(Request.Builder().url(resolve(url)).apply { headers.forEach { (k, v) -> header(k, v) } }.build(), retries)
    public suspend fun post(url: String, body: String, contentType: String = "application/json", headers: Map<String, String> = emptyMap(), retries: Int = 0): AxfResult<HttpResponse> =
        execute(Request.Builder().url(resolve(url)).post(body.toRequestBody(contentType.toMediaType())).apply { headers.forEach { (k, v) -> header(k, v) } }.build(), retries)
    public suspend fun put(url: String, body: String, contentType: String = "application/json"): AxfResult<HttpResponse> = execute(Request.Builder().url(resolve(url)).put(body.toRequestBody(contentType.toMediaType())).build(), 0)
    public suspend fun delete(url: String): AxfResult<HttpResponse> = execute(Request.Builder().url(resolve(url)).delete().build(), 0)
    public suspend fun getJson(url: String): AxfResult<JsonObject> = get(url).flatMap { r -> r.json()?.let { AxfResult.ok(it) } ?: AxfResult.err(AxfFailure.Invalid("Response is not a JSON object")) }

    public suspend fun execute(request: Request, retries: Int): AxfResult<HttpResponse> {
        var attempt = 0
        while (true) {
            val r = once(request)
            val retry = r is AxfResult.Err && r.failure.retryable && attempt < retries
            if (!retry) return r
            attempt++; delay(500L * (1 shl attempt))
            log.d("retry ${request.url} ($attempt)")
        }
    }

    private suspend fun once(request: Request): AxfResult<HttpResponse> = try {
        val resp = await(client.newCall(request))
        val body = withContext(Dispatchers.IO) { resp.body?.string() ?: "" }
        val out = HttpResponse(resp.code, body, resp.headers.names().associateWith { resp.header(it) ?: "" })
        if (resp.code >= 500) AxfResult.err(AxfFailure.Unavailable("HTTP ${resp.code}")) else if (resp.code >= 400) AxfResult.err(AxfFailure.Invalid("HTTP ${resp.code}: ${body.take(200)}")) else AxfResult.ok(out)
    } catch (e: IOException) { AxfResult.err(AxfFailure.Unavailable(e.message ?: "network error", cause = e)) }

    private suspend fun await(call: Call): Response = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) { cont.resume(response) }
        })
    }

    /** Download to a file (used by asset packs and the devtools). */
    public suspend fun download(url: String, dest: File, onProgress: ((Long, Long) -> Unit)? = null): AxfResult<File> = try {
        val resp = await(client.newCall(Request.Builder().url(resolve(url)).build()))
        if (!resp.isSuccessful) AxfResult.err(AxfFailure.Unavailable("HTTP ${resp.code}")) else withContext(Dispatchers.IO) {
            val total = resp.body?.contentLength() ?: -1L
            dest.parentFile?.mkdirs()
            resp.body!!.byteStream().use { input -> dest.outputStream().use { out -> val buf = ByteArray(64 * 1024); var n: Int; var done = 0L; while (input.read(buf).also { n = it } > 0) { out.write(buf, 0, n); done += n; onProgress?.invoke(done, total) } } }
            AxfResult.ok(dest)
        }
    } catch (e: IOException) { AxfResult.err(AxfFailure.Unavailable(e.message ?: "download failed", cause = e)) }

    public fun webSocket(url: String, listener: WebSocketClient.Listener): WebSocketClient = WebSocketClient(client, resolve(url), listener)
}

/** Thin websocket wrapper with reconnect. */
public class WebSocketClient(private val client: OkHttpClient, private val url: String, private val listener: Listener) {
    public interface Listener { public fun onOpen() {}; public fun onMessage(text: String); public fun onClosed(code: Int, reason: String) {}; public fun onFailure(t: Throwable) {} }
    private var socket: WebSocket? = null
    public var autoReconnect: Boolean = true
    public fun connect() {
        socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { listener.onOpen() }
            override fun onMessage(webSocket: WebSocket, text: String) { listener.onMessage(text) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { listener.onClosed(code, reason) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { listener.onFailure(t); if (autoReconnect) Thread { Thread.sleep(3000); connect() }.start() }
        })
    }
    public fun send(text: String): Boolean = socket?.send(text) ?: false
    public fun close() { autoReconnect = false; socket?.close(1000, "bye"); socket = null }
}

/** Fetches `<baseUrl>/axf/config.json` → `{ "flags": {...}, "config": {...} }` and applies it to the kernel. */
public class RemoteConfig(private val http: AxfHttp, private val ctx: ModuleContext) {
    public var url: String = "axf/config.json"
    public suspend fun refresh(): AxfResult<Unit> = http.getJson(url).map { o ->
        val flags = ctx.service(FeatureFlags::class)
        (o["flags"] as? JsonObject)?.let { f -> flags?.applyRemote(f.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.content?.toBooleanStrictOrNull()?.let { k to it } }.toMap()) }
        (o["config"] as? JsonObject)?.let { c -> ctx.service(ai.amberx.axf.kernel.config.Config::class)?.load(c, ConfigLayer.REMOTE) }
        ctx.service(AxfKernel::class)?.log?.i("remote config applied")
        Unit
    }
}
