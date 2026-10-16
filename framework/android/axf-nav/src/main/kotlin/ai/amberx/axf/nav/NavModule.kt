package ai.amberx.axf.nav

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.Router
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * Registers the router service (`axf.router`) and the `deeplink` / `nav.back` actions. Routes are collected
 * from `ExtensionPoints.ROUTES`; [AxfNavHost] renders them. The kernel's `view` and the nav back-stack stay
 * in sync both ways (runtime.navigate → router; back → runtime.navigate).
 */
public class NavModule : BaseModule(ID, "Navigation") {
    override val provides: List<Capability> = listOf(Capability("axf.router", "Typed routes, deep links, results"))
    public val router: AxfRouter = AxfRouter()

    override fun register(ctx: ModuleContext) {
        ctx.services.register(Router::class, router, "axf.router")
        ctx.services.register(AxfRouter::class, router)
        val runtime = ctx.service(AxfRuntime::class)
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("deeplink", ActionMeta("Open deep link", module = id)) { args, ctx2 ->
            val uri = ctx2.payload ?: args.joinToString(":")
            if (!router.deepLink(uri)) runtime?.toast("No route matches $uri", ai.amberx.axf.kernel.runtime.ToastKind.WARNING, "Deep link")
        })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("nav.back", ActionMeta("Back", module = id)) { _, _ -> router.back() })
        router.bind(runtime, ctx.extensions.get(ExtensionPoints.ROUTES).map { it.route })
        ctx.extensions.onChange(ExtensionPoints.ROUTES) { router.setRoutes(ctx.extensions.get(ExtensionPoints.ROUTES).map { it.route }) }
    }

    public companion object { public const val ID: String = "ai.amberx.axf.nav" }
}

/** Kernel-side router state; the Compose host observes [current] and [pending] and drives NavController. */
public class AxfRouter : Router {
    private var runtime: AxfRuntime? = null
    private val _routes = MutableStateFlow<List<RouteSpec>>(emptyList())
    public val routes: StateFlow<List<RouteSpec>> get() = _routes
    private val _current = MutableStateFlow("home")
    private val _request = MutableStateFlow<NavRequest?>(null)
    /** A navigation the host must perform (consumed by AxfNavHost). */
    public val request: StateFlow<NavRequest?> get() = _request
    private val results = LinkedHashMap<String, JsonElement>()
    private val stack = ArrayDeque<String>()
    public var appId: String = ""

    internal fun bind(rt: AxfRuntime?, routes: List<RouteSpec>) { runtime = rt; appId = rt?.manifest?.appId ?: ""; _current.value = rt?.current?.view ?: "home"; setRoutes(routes) }
    public fun setRoutes(list: List<RouteSpec>) { _routes.value = list.distinctBy { it.id } }
    public fun route(id: String): RouteSpec? = _routes.value.firstOrNull { it.id == id }
    override val current: String get() = _current.value

    override fun navigate(view: String, args: Map<String, String>) {
        if (view == _current.value && args.isEmpty()) return
        stack.addLast(_current.value); while (stack.size > 50) stack.removeFirst()
        _current.value = view
        _request.value = NavRequest(view, args, System.nanoTime())
        runtime?.let { if (it.current.view != view) it.navigate(view) }
    }
    override fun back(): Boolean { val prev = stack.removeLastOrNull() ?: return false; _current.value = prev; _request.value = NavRequest(prev, emptyMap(), System.nanoTime(), pop = true); runtime?.navigate(prev); return true }
    override fun setResult(type: String, value: JsonElement) { results[type] = value }
    override fun consumeResult(type: String): JsonElement? = results.remove(type)
    /** `axf://<appId>/<path>?a=1` or any URI whose path matches a route path pattern. */
    override fun deepLink(uri: String): Boolean {
        val m = Regex("^[a-z]+://([^/]+)/?([^?#]*)(?:\\?([^#]*))?").find(uri) ?: return false
        val path = m.groupValues[2].trim('/')
        val query = m.groupValues[3].split('&').filter { it.contains('=') }.associate { it.substringBefore('=') to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8") }
        for (r in _routes.value) {
            val args = matchPath(r.path, path) ?: continue
            navigate(r.id, args + query)
            return true
        }
        return false
    }
    /** The host tells the router the back stack moved (system back). */
    public fun onHostNavigated(view: String) { if (view != _current.value) { _current.value = view; runtime?.navigate(view) } }
    public fun consumeRequest(r: NavRequest) { if (_request.value === r) _request.value = null }

    public companion object {
        public fun matchPath(pattern: String, path: String): Map<String, String>? {
            val p = pattern.trim('/').split('/'); val s = path.split('/')
            if (p.size != s.size) return null
            val out = LinkedHashMap<String, String>()
            for (i in p.indices) { val seg = p[i]; if (seg.startsWith("{") && seg.endsWith("}")) out[seg.substring(1, seg.length - 1)] = s[i] else if (seg != s[i]) return null }
            return out
        }
    }
}

public data class NavRequest(val view: String, val args: Map<String, String>, val nonce: Long, val pop: Boolean = false)
