package ai.amberx.axf.nav

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.components.PlaceholderScreen
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.navArgument
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

/**
 * Renders the registered routes with Navigation Compose and keeps the kernel's `view`, the router and
 * the nav back-stack in sync. `screens` maps route id → composable receiving the route args; routes with
 * no screen (or `placeholder = true`) render [PlaceholderScreen]. Use it as the `main` content of AppShell:
 *
 *   AppShell(views = routes.associate { it.id to { AxfNavHost(router, screens) } })
 *
 * or more simply hand `AxfNavHost.views(router, screens)` to AppShell, which does exactly that.
 */
@Composable
public fun AxfNavHost(router: AxfRouter, screens: Map<String, @Composable (Map<String, String>) -> Unit>, modifier: Modifier = Modifier, start: String = LocalAxfRuntime.current.manifest.startView) {
    val nav: NavHostController = rememberNavController()
    val routes by router.routes.collectAsState()
    val request by router.request.collectAsState()
    val state = LocalAxfState.current
    // kernel view changed by a nav-menu / action → push it
    LaunchedEffect(state.view) { if (state.view != router.current) router.navigate(state.view) }
    LaunchedEffect(request) {
        val r = request ?: return@LaunchedEffect
        val target = if (r.args.isEmpty()) r.view else r.view + "?" + r.args.entries.joinToString("&") { "${it.key}=${java.net.URLEncoder.encode(it.value, "UTF-8")}" }
        runCatching { if (r.pop) nav.popBackStack(r.view, inclusive = false).let { popped -> if (!popped) nav.navigate(target) } else nav.navigate(target) { launchSingleTop = true } }
        router.consumeRequest(r)
    }
    NavHost(nav, startDestination = start, modifier = modifier) {
        val all = (routes.map { it.id } + screens.keys + start).distinct()
        for (id in all) {
            val spec = routes.firstOrNull { it.id == id }
            composable(id + "?args={args}", arguments = listOf(navArgument("args") { type = NavType.StringType; nullable = true; defaultValue = null })) { entry ->
                val args = entry.arguments?.getString("args")?.let { parseArgs(it) } ?: emptyMap()
                val screen = screens[id]
                if (screen != null && spec?.placeholder != true) screen(args) else PlaceholderScreen(spec?.label ?: id)
            }
        }
    }
}

private fun parseArgs(s: String): Map<String, String> = s.split('&').filter { it.contains('=') }.associate { it.substringBefore('=') to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8") }

/** Convenience: every known route id maps to one nav host, so the shell can switch views and the host owns the stack. */
@Composable
public fun rememberNavViews(router: AxfRouter, screens: Map<String, @Composable (Map<String, String>) -> Unit>): Map<String, @Composable () -> Unit> {
    val routes by router.routes.collectAsState()
    val kernel = LocalAxfKernel.current
    return remember(routes, screens, kernel) {
        val ids = (routes.map(RouteSpec::id) + screens.keys).distinct()
        ids.associateWith { { AxfNavHost(router, screens) } }
    }
}
