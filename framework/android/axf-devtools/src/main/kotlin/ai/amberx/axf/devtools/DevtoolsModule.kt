package ai.amberx.axf.devtools

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.KernelFlags
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingScope
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.engine.ParsedAction
import ai.amberx.axf.kernel.event.AxfEvent
import ai.amberx.axf.kernel.event.EventBus
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.network.AxfHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Developer console: records every action and event, exposes the kernel status, asset inspector and
 * build-engine client, contributes the `devtools` route + settings group. Gated by flag `axf.devtools`.
 */
public class DevtoolsModule : BaseModule(ID, "Developer tools") {
    override val provides: List<Capability> = listOf(Capability("axf.devtools", "Inspector, action log, build-engine client"), Capability("axf.buildEngine", "init / validate / new-asset / new-module over HTTP (VPS) or NotImplemented"))
    override val dependsOn: List<String> = listOf("ai.amberx.axf.network")
    public val recorder: ActionRecorder = ActionRecorder()

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        runtime?.actions?.intercept { parsed, _ -> recorder.record(parsed); false }
        ctx.service(EventBus::class)?.let { recorder.attach(it) }
        ctx.services.register(ActionRecorder::class, recorder, "axf.devtools.recorder")
        val http = ctx.service(AxfHttp::class)
        ctx.services.register(BuildEngineClient::class, if (http != null) HttpBuildEngineClient(http) else NotImplementedBuildEngine, "axf.buildEngine")
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("devtools", "Developer tools", icon = "bug", module = id, requires = "dev.tools")))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("dev.console", ActionMeta("Developer console", "dev.tools", module = id)) { _, _ -> runtime?.navigate("devtools") })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("developer", "Developer", "bug", id, order = 900, settings = listOf(
            SettingSpec("axf.devtools.enabled", "Developer tools", SettingKind.TOGGLE, "Show the developer console and inspector", JsonPrimitive(true), SettingScope.DEVICE),
            SettingSpec("axf.devServer", "Dev server URL", SettingKind.TEXT, "Live-reload assets from `axf dev` on your computer, e.g. http://192.168.1.10:7070", JsonPrimitive(""), SettingScope.DEVICE),
            SettingSpec("axf.hotReload", "Hot reload assets", SettingKind.TOGGLE, "Poll the dev server and re-register changed assets", JsonPrimitive(false), SettingScope.DEVICE),
            SettingSpec("axf.buildEngine.url", "Build engine URL", SettingKind.TEXT, "HTTP endpoint of the AXF build engine on the VPS", JsonPrimitive(""), SettingScope.DEVICE),
            SettingSpec("axf.devtools.open", "Open developer console", SettingKind.ACTION, target = "dev.console", icon = "terminal", requires = "dev.tools"),
        ))))
    }

    override suspend fun start(ctx: ModuleContext) {
        val kernel = ctx.service(AxfKernel::class) ?: return
        if (kernel.flags.isEnabled(KernelFlags.HOT_RELOAD.id)) {
            val url = kernel.config.string("axf.devServer")?.takeIf { it.isNotBlank() } ?: return
            ctx.service(AxfHttp::class)?.let { http -> HotReloader(http, kernel, url).start(kernel.scope) }
        }
    }

    public companion object { public const val ID: String = "ai.amberx.axf.devtools" }
}

public data class ActionRecord(val atMillis: Long, val spec: String, val id: String)

/** Ring buffers of actions and events for the console. */
public class ActionRecorder(private val limit: Int = 300) {
    private val _actions = MutableStateFlow<List<ActionRecord>>(emptyList())
    public val actions: StateFlow<List<ActionRecord>> get() = _actions
    private var bus: EventBus? = null
    public fun record(p: ParsedAction) { _actions.update { (it + ActionRecord(System.currentTimeMillis(), (listOf(p.id) + p.args).joinToString(":"), p.id)).takeLast(limit) } }
    public fun attach(b: EventBus) { bus = b }
    public fun events(): List<AxfEvent> = bus?.history() ?: emptyList()
    public fun clear() { _actions.value = emptyList() }
}

/** The build engine as seen from the device. Mirrors framework/cli/build-engine.mjs; an HTTP driver on the VPS fronts it. */
public interface BuildEngineClient {
    public suspend fun validate(appDir: String): AxfResult<JsonObject>
    public suspend fun init(dir: String, name: String, template: String, modules: List<String>): AxfResult<JsonObject>
    public suspend fun newAsset(appDir: String, type: String, id: String, from: String?): AxfResult<JsonObject>
    public suspend fun newModule(name: String, label: String, capabilities: List<String>): AxfResult<JsonObject>
    public suspend fun newDemo(library: String): AxfResult<JsonObject>
    public suspend fun listModules(): AxfResult<JsonObject>
    /** `GET /libraries` — installable libraries (framework/android/<module>/library.json) with their wizard parameters. */
    public suspend fun listLibraries(): AxfResult<JsonObject>
    /** `POST /install` — run a library's install script against an app with the wizard's answers. */
    public suspend fun install(appDir: String, library: String, params: JsonObject): AxfResult<JsonObject>
    /** `POST /import-ui` — port a third-party UI library into a new AXF kit (clone → refactor to tokens → save → apply to `appDir`). */
    public suspend fun importUi(body: JsonObject): AxfResult<JsonObject>
    public val available: Boolean
}

public object NotImplementedBuildEngine : BuildEngineClient {
    private fun <T> no(): AxfResult<T> = AxfResult.err(AxfFailure.NotImplemented("axf.buildEngine", "Set the build engine URL in Settings → Developer to run the engine on your VPS."))
    override suspend fun validate(appDir: String): AxfResult<JsonObject> = no()
    override suspend fun init(dir: String, name: String, template: String, modules: List<String>): AxfResult<JsonObject> = no()
    override suspend fun newAsset(appDir: String, type: String, id: String, from: String?): AxfResult<JsonObject> = no()
    override suspend fun newModule(name: String, label: String, capabilities: List<String>): AxfResult<JsonObject> = no()
    override suspend fun newDemo(library: String): AxfResult<JsonObject> = no()
    override suspend fun listModules(): AxfResult<JsonObject> = no()
    override suspend fun listLibraries(): AxfResult<JsonObject> = no()
    override suspend fun install(appDir: String, library: String, params: JsonObject): AxfResult<JsonObject> = no()
    override suspend fun importUi(body: JsonObject): AxfResult<JsonObject> = no()
    override val available: Boolean = false
}

/** Talks to `framework/cli/serve.mjs` (HTTP driver of the build engine) at `baseUrl`. */
public class HttpBuildEngineClient(private val http: AxfHttp, public var baseUrl: String = "") : BuildEngineClient {
    override val available: Boolean get() = baseUrl.isNotBlank()
    private suspend fun call(path: String, body: JsonObject): AxfResult<JsonObject> {
        if (!available) return NotImplementedBuildEngine.validate("")
        return http.post("${baseUrl.trimEnd('/')}/$path", body.toString()).flatMap { r -> r.json()?.let { AxfResult.ok(it) } ?: AxfResult.err(AxfFailure.Invalid("Engine returned no JSON")) }
    }
    override suspend fun validate(appDir: String): AxfResult<JsonObject> = call("validate", buildJsonObject { put("dir", JsonPrimitive(appDir)) })
    override suspend fun init(dir: String, name: String, template: String, modules: List<String>): AxfResult<JsonObject> = call("init", buildJsonObject { put("dir", JsonPrimitive(dir)); put("name", JsonPrimitive(name)); put("template", JsonPrimitive(template)); put("modules", kotlinx.serialization.json.JsonArray(modules.map { JsonPrimitive(it) })) })
    override suspend fun newAsset(appDir: String, type: String, id: String, from: String?): AxfResult<JsonObject> = call("new-asset", buildJsonObject { put("dir", JsonPrimitive(appDir)); put("type", JsonPrimitive(type)); put("id", JsonPrimitive(id)); from?.let { put("from", JsonPrimitive(it)) } })
    override suspend fun newModule(name: String, label: String, capabilities: List<String>): AxfResult<JsonObject> = call("new-module", buildJsonObject { put("name", JsonPrimitive(name)); put("label", JsonPrimitive(label)); put("capabilities", kotlinx.serialization.json.JsonArray(capabilities.map { JsonPrimitive(it) })) })
    override suspend fun newDemo(library: String): AxfResult<JsonObject> = call("new-demo", buildJsonObject { put("library", JsonPrimitive(library)) })
    override suspend fun listModules(): AxfResult<JsonObject> = http.getJson("${baseUrl.trimEnd('/')}/modules")
    override suspend fun listLibraries(): AxfResult<JsonObject> = http.getJson("${baseUrl.trimEnd('/')}/libraries")
    override suspend fun importUi(body: JsonObject): AxfResult<JsonObject> = call("import-ui", body)
    override suspend fun install(appDir: String, library: String, params: JsonObject): AxfResult<JsonObject> = call("install", buildJsonObject { put("dir", JsonPrimitive(appDir)); put("library", JsonPrimitive(library)); put("params", params) })
}

/** Polls `axf dev` (`/assets.json` once, then `/events?since=rev`) and re-registers changed assets live. */
public class HotReloader(private val http: AxfHttp, private val kernel: AxfKernel, private val baseUrl: String) {
    private var rev = 0L
    public fun start(scope: CoroutineScope): Job = scope.launch {
        http.getJson("${baseUrl.trimEnd('/')}/assets.json").onOk { o ->
            rev = (o["rev"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0
            (o["assets"] as? kotlinx.serialization.json.JsonArray)?.forEach { (it as? JsonObject)?.let { raw -> kernel.registry.register(raw, ai.amberx.axf.kernel.asset.AssetSource.REMOTE) } }
            kernel.runtime.recompile()
            kernel.runtime.toast("Connected to dev server", ai.amberx.axf.kernel.runtime.ToastKind.SUCCESS, "Hot reload")
        }
        while (true) {
            val r = http.get("${baseUrl.trimEnd('/')}/events?since=$rev", retries = 0)
            val o = r.getOrNull()?.json()
            if (o == null) { kotlinx.coroutines.delay(3000); continue }
            rev = (o["rev"] as? JsonPrimitive)?.content?.toLongOrNull() ?: rev
            var changed = 0
            for (c in (o["changed"] as? kotlinx.serialization.json.JsonArray) ?: continue) {
                val type = ((c as? JsonObject)?.get("type") as? JsonPrimitive)?.content ?: continue
                val id = (c["id"] as? JsonPrimitive)?.content ?: continue
                if ((c["action"] as? JsonPrimitive)?.content == "removed") { kernel.registry.remove(type, id); changed++; continue }
                http.getJson("${baseUrl.trimEnd('/')}/assets/$type/$id.json").onOk { raw -> if (kernel.registry.register(raw, ai.amberx.axf.kernel.asset.AssetSource.REMOTE).ok) changed++ }
            }
            if (changed > 0) { kernel.runtime.recompile(); kernel.runtime.toast("$changed asset(s) reloaded", ai.amberx.axf.kernel.runtime.ToastKind.INFO, "Hot reload") }
        }
    }
}
