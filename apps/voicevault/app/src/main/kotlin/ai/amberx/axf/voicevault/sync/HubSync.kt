package ai.amberx.axf.voicevault.sync

import ai.amberx.axf.hub.HubAppearanceSource
import ai.amberx.axf.hub.HubCredential
import ai.amberx.axf.hub.HubCredentials
import ai.amberx.axf.hub.HubOrigin
import ai.amberx.axf.hub.cookieCredentials
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.AppearanceChange
import ai.amberx.axf.kernel.engine.AppearanceSourceState
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AppearanceEvent
import ai.amberx.axf.kernel.runtime.AppearanceSource
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.settings.SettingsEngine
import ai.amberx.axf.voicevault.notes.HubTables
import ai.amberx.axf.voicevault.notes.VoiceNotes
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * axHub sync for Voice Vault — the Kotlin twin of the framework's web lib-hubsync (`framework/libs/hubsync`), kept in
 * app code while Android framework work is on hold (PORTING.md). Two parts, each switchable in Settings → axHub sync:
 *
 * - **Look:** the shared appearance document every developer app reads (`shared/settings/appearance.json`), so Voice
 *   Vault has the same colour theme, style, layout and spacing as the console, Pilot and axHub. Mode `follow` (default)
 *   never blocks the app — a vault must open without the hub; `required` waits like a developer app; `off` = its own look.
 * - **Settings:** every value on the Settings screen (hub-settings@1, `shared/settings/apps/voice-vault.json`), the same
 *   on every device. Secrets, links, actions and these connection switches never go; nothing from the vault ever does
 *   (passwords and the unlock code live in the secure store, which this never reads).
 *
 * Hub session = the sign-in Voice notes already uses (lib-hub cookie store); hub address = Settings → Voice notes →
 * axHub address. Redirects are never followed. App data stays on the phone (the vault is the data).
 */
object HubSyncRules {
    const val PROJECT = "shared"
    const val KEY_LOOK = "voicevault.hubsync.look"
    const val KEY_SETTINGS = "voicevault.hubsync.settings"
    const val ROUTE = "hub-sync"
    /** Settings that belong to this phone alone (its microphone switch), never mirrored to axHub. */
    const val DEVICE_ONLY = "voicevault.device."
    val LOOKS = listOf("required", "follow", "off")
    private val NAME = Regex("^[a-z0-9][a-z0-9._-]{0,63}$", RegexOption.IGNORE_CASE)

    fun look(raw: String?): String = raw?.takeIf { it in LOOKS } ?: "follow"
    fun settingsFile(appId: String): String = "settings/apps/${if (NAME.matches(appId) && ".." !in appId) appId else "app"}.json"

    /** Same mapping as web `followState`: the runtime always sees Ready, so the app never waits. */
    fun followState(real: AppearanceSourceState): AppearanceSourceState = AppearanceSourceState.Ready((real as? AppearanceSourceState.Ready)?.version)

    /** Which settings go to the hub: every declared one except secrets, links, actions and the device-only switches. */
    fun mirrored(spec: SettingSpec): Boolean = spec.kind != SettingKind.SECRET && spec.kind != SettingKind.LINK && spec.kind != SettingKind.ACTION &&
        !spec.key.startsWith("voicevault.hubsync.") && !spec.key.startsWith(DEVICE_ONLY) && spec.key != VoiceNotes.KEY_HUB

    /** A stored value as the hub keeps it (typed like the web): toggles → boolean, numbers → number, else text. */
    fun toHub(spec: SettingSpec?, value: JsonElement): JsonElement {
        val p = value as? JsonPrimitive ?: return value
        return when (spec?.kind) {
            SettingKind.TOGGLE -> p.booleanOrNull?.let { JsonPrimitive(it) } ?: p.content.toBooleanStrictOrNull()?.let { JsonPrimitive(it) } ?: p
            SettingKind.NUMBER, SettingKind.SLIDER -> p.doubleOrNull?.let { d -> if (d == Math.floor(d) && !d.isInfinite()) JsonPrimitive(d.toLong()) else JsonPrimitive(d) } ?: p
            else -> if (p.isString) p else JsonPrimitive(p.content)
        }
    }

    /** Equal as settings (the phone stores text, the hub typed values). */
    fun same(a: JsonElement?, b: JsonElement?): Boolean = (a as? JsonPrimitive)?.content == (b as? JsonPrimitive)?.content && (a == null) == (b == null)

    fun mergeDoc(base: JsonObject?, change: Map<String, JsonElement?>, by: String, now: String): JsonObject {
        val values = LinkedHashMap((base?.get("values") as? JsonObject) ?: emptyMap())
        for ((k, v) in change) if (v == null) values.remove(k) else values[k] = v
        return buildJsonObject { put("\$axf", HubTables.SETTINGS_FORMAT); put("values", JsonObject(values)); put("updatedAt", now); put("updatedBy", by.take(80)) }
    }
    fun valuesOf(doc: JsonElement?): Map<String, JsonElement> {
        val o = doc as? JsonObject ?: return emptyMap()
        if ((o["\$axf"] as? JsonPrimitive)?.content != HubTables.SETTINGS_FORMAT) return emptyMap()
        return (o["values"] as? JsonObject) ?: emptyMap()
    }
}

/** A look source that never makes the app wait (web `FollowSource`); [real] keeps what the hub said for the status screen. */
class FollowSource(private val inner: AppearanceSource) : AppearanceSource {
    private val _real = MutableStateFlow(inner.state())
    val real: StateFlow<AppearanceSourceState> = _real.asStateFlow()
    override val origin: String? get() = inner.origin
    override fun state(): AppearanceSourceState = HubSyncRules.followState(_real.value)
    override fun subscribe(listener: (AppearanceEvent) -> Unit): () -> Unit = inner.subscribe { ev ->
        if (ev is AppearanceEvent.State) { _real.value = ev.state; listener(AppearanceEvent.State(HubSyncRules.followState(ev.state))) } else listener(ev)
    }
    override fun start() = inner.start()
    override fun stop() = inner.stop()
    override fun refresh() = inner.refresh()
    override fun save(change: AppearanceChange) = inner.save(change)
}

sealed interface SyncState {
    data object Off : SyncState
    data object Loading : SyncState
    data class Ready(val updatedAt: String) : SyncState
    data class SignedOut(val why: String) : SyncState
    data class Unreachable(val why: String) : SyncState
}

/** The Settings screen's values in one hub-settings@1 document: the hub's copy wins at start, every save goes back. */
class HubSettingsMirror(hub: String, private val credentials: HubCredentials, private val appId: String, private val engine: SettingsEngine, private val scope: CoroutineScope) {
    private val origin = HubOrigin.normalize(hub) ?: throw IllegalArgumentException("The hub address must be https")
    private val url = "$origin/data/${HubSyncRules.PROJECT}/${HubSyncRules.settingsFile(appId)}"
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private val io = Mutex()
    private var tag: String? = null
    private var doc: JsonObject? = null
    private var applying = false
    private var off: (() -> Unit)? = null
    private val _state = MutableStateFlow<SyncState>(SyncState.Loading)
    val state: StateFlow<SyncState> = _state.asStateFlow()

    private class Refused(val signedOut: Boolean, msg: String) : Exception(msg)
    private fun Request.Builder.auth(): Request.Builder = when (val c = credentials.current()) {
        is HubCredential.SessionCookie -> header("Cookie", c.cookie)
        is HubCredential.Bearer -> header("Authorization", "Bearer ${c.token}")
        null -> throw Refused(true, "Sign in to axHub first (Settings → Voice notes → Sign in to axHub).")
    }

    private suspend fun read(): JsonObject? = withContext(Dispatchers.IO) {
        val res = runCatching { http.newCall(Request.Builder().url(url).header("Accept", "application/json").auth().get().build()).execute() }
            .getOrElse { if (it is Refused) throw it; throw Refused(false, "Can't reach axHub (${it.message?.take(100)}).") }
        res.use { r ->
            if (r.code == 404) { tag = null; return@withContext null }
            if (r.code == 401 || r.code == 403) throw Refused(true, "Signed out of axHub (${r.code}). Sign in again.")
            if (!r.isSuccessful) throw Refused(false, "axHub answered ${r.code}.")
            tag = r.header("ETag")
            runCatching { HubTables.json.parseToJsonElement(r.body?.string().orEmpty()) as? JsonObject }.getOrNull()
        }
    }

    private suspend fun write(body: JsonObject): Boolean = withContext(Dispatchers.IO) {
        val text = body.toString()
        require(text.length <= HubTables.FILE_MAX) { "Settings are over axHub's 64 KB limit" }
        val b = Request.Builder().url(url).header("Content-Type", "application/json").auth()
        tag?.let { b.header("If-Match", it) }
        val res = runCatching { http.newCall(b.put(text.toRequestBody("application/json".toMediaType())).build()).execute() }
            .getOrElse { if (it is Refused) throw it; throw Refused(false, "Can't reach axHub (${it.message?.take(100)}).") }
        res.use { r ->
            if (r.code == 409 || r.code == 412) return@withContext false
            if (r.code == 401 || r.code == 403) throw Refused(true, "Signed out of axHub (${r.code}). Sign in again.")
            if (!r.isSuccessful) throw Refused(false, "axHub answered ${r.code}.")
            tag = r.header("ETag"); true
        }
    }

    private fun fail(e: Throwable) { _state.value = if (e is Refused && e.signedOut) SyncState.SignedOut(e.message ?: "") else SyncState.Unreachable(e.message ?: "axHub didn't answer") }

    fun start() {
        off = engine.onChange { key, value -> if (!applying) engine.spec(key)?.takeIf(HubSyncRules::mirrored)?.let { push(mapOf(key to HubSyncRules.toHub(it, value))) } }
        refresh()
    }
    fun stop() { off?.invoke(); off = null; _state.value = SyncState.Off }

    /** Re-read the hub and apply its values (fresh on resume). */
    fun refresh() { scope.launch { io.withLock {
        _state.value = SyncState.Loading
        runCatching { read() }.onFailure(::fail).onSuccess { d ->
            doc = d
            val values = HubSyncRules.valuesOf(d)
            applying = true
            try {
                for (g in engine.groups.value) for (s in g.settings) if (HubSyncRules.mirrored(s)) values[s.key]?.let { v -> if (!HubSyncRules.same(engine.get(s.key), v)) engine.set(s.key, v) }
            } finally { applying = false }
            _state.value = SyncState.Ready((d?.get("updatedAt") as? JsonPrimitive)?.content.orEmpty())
        }
    } } }

    private fun push(change: Map<String, JsonElement?>) { scope.launch { io.withLock {
        runCatching {
            repeat(4) {
                val next = HubSyncRules.mergeDoc(doc, change, appId, java.time.Instant.now().toString())
                if (write(next)) { doc = next; _state.value = SyncState.Ready(java.time.Instant.now().toString()); return@runCatching }
                doc = read()
            }
            throw Refused(false, "Settings kept changing on axHub; try again.")
        }.onFailure(::fail)
    } } }
}

/** Voice Vault's axHub sync: settings group, status route, look source + settings mirror (started once settings are loaded). */
class HubSyncModule(private val scope: CoroutineScope) : BaseModule("ai.amberx.axf.voicevault.hubsync", "axHub sync") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings")
    private var ctx: ModuleContext? = null
    private var look: AppearanceSource? = null
    private val _mirror = MutableStateFlow<HubSettingsMirror?>(null)
    val mirror: StateFlow<HubSettingsMirror?> = _mirror.asStateFlow()
    private val _look = MutableStateFlow<AppearanceSourceState?>(null)
    /** What the hub said about the look (null = look off). */
    val lookState: StateFlow<AppearanceSourceState?> = _look.asStateFlow()
    private var lookOff: (() -> Unit)? = null

    val hub: String get() = HubOrigin.normalize(ctx?.service(SettingsEngine::class)?.string(VoiceNotes.KEY_HUB)) ?: HubOrigin.DEFAULT

    override fun register(ctx: ModuleContext) {
        this.ctx = ctx
        ctx.services.register(HubSyncModule::class, this, "voicevault.hubsync")
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(HubSyncRules.ROUTE, "axHub sync", icon = "cloud", module = id)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("hubsync.now", ActionMeta("Sync with axHub now", module = id)) { _, _ -> refresh() })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("voicevault.hubsync", "axHub sync", "cloud", id, order = 24,
            description = "Same look and settings as every other app and device, kept on axHub. Your passwords never leave this phone.", settings = listOf(
                SettingSpec(HubSyncRules.KEY_LOOK, "Look from axHub", SettingKind.CHOICE, "Colours, style, layout and spacing shared with the console, Pilot and axHub", JsonPrimitive("follow"),
                    options = listOf("follow" to "Follow axHub", "required" to "Always (wait for axHub)", "off" to "Off"), icon = "palette"),
                SettingSpec(HubSyncRules.KEY_SETTINGS, "Settings on axHub", SettingKind.TOGGLE, "These settings are the same on every device (secrets never)", JsonPrimitive(true), icon = "settings"),
                SettingSpec("voicevault.hubsync.open", "Sync status", SettingKind.LINK, "Connection, what syncs, sync now", target = HubSyncRules.ROUTE, icon = "cloud"),
                SettingSpec("voicevault.hubsync.signIn", "Sign in to axHub", SettingKind.LINK, "Uses the axHub address under Voice notes", target = VoiceNotes.SIGN_IN_ROUTE, icon = "user"),
            ))))
    }

    override suspend fun init(ctx: ModuleContext) {
        val engine = ctx.service(SettingsEngine::class) ?: return
        engine.onChange { key, _ -> if (key == HubSyncRules.KEY_LOOK || key == HubSyncRules.KEY_SETTINGS || key == VoiceNotes.KEY_HUB) scope.launch { restart() } }
        restart()
    }

    fun refresh() { look?.refresh(); _mirror.value?.refresh() }

    private fun restart() {
        val c = ctx ?: return
        val engine = c.service(SettingsEngine::class) ?: return
        val runtime = c.service(AxfRuntime::class) ?: return
        lookOff?.invoke(); lookOff = null
        if (look != null) { runtime.detachAppearanceSource(); look = null }
        _mirror.value?.stop(); _mirror.value = null
        val appId = runtime.manifest.appId
        val creds = cookieCredentials { hub }
        when (HubSyncRules.look(engine.string(HubSyncRules.KEY_LOOK))) {
            "off" -> _look.value = null
            "required" -> HubAppearanceSource(hub = hub, appId = appId, credentials = creds).also { s ->
                lookOff = s.subscribe { if (it is AppearanceEvent.State) _look.value = it.state }; look = s; runtime.attachAppearanceSource(s)
            }
            else -> FollowSource(HubAppearanceSource(hub = hub, appId = appId, credentials = creds)).also { s ->
                lookOff = s.subscribe { if (it is AppearanceEvent.State) _look.value = s.real.value }; look = s; runtime.attachAppearanceSource(s); _look.value = s.real.value
            }
        }
        if (engine.bool(HubSyncRules.KEY_SETTINGS, true)) _mirror.value = HubSettingsMirror(hub, creds, appId, engine, scope).also { it.start() }
    }
}
