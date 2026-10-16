package ai.amberx.axf.ui

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.contract.MapStrings
import ai.amberx.axf.kernel.contract.Strings
import ai.amberx.axf.kernel.engine.LayoutEngine
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.ui.components.AxfContextMenuHost
import ai.amberx.axf.ui.components.AxfDialogHost
import ai.amberx.axf.ui.components.AxfToastHost
import ai.amberx.axf.ui.studio.builtinDialogs
import ai.amberx.axf.ui.theme.AxfThemeProvider
import ai.amberx.axf.ui.theme.FontRegistry
import ai.amberx.axf.ui.theme.LocalAxfTheme
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString

/**
 * The root of every AXF Compose tree: collects `runtime.state` / `runtime.compiled`, provides every
 * local, applies the theme (Axf + Material bridge), measures the window width into the runtime and
 * renders the overlay hosts (dialogs from `ExtensionPoints.DIALOGS` + built-ins, toasts, context menu).
 */
@Composable
public fun AxfRoot(
    kernel: AxfKernel,
    fonts: FontRegistry = FontRegistry.Default,
    strings: Strings = MapStrings(emptyMap()),
    extraDialogs: Map<String, DialogContribution> = emptyMap(),
    content: @Composable () -> Unit,
): Unit = AxfRoot(kernel.runtime, kernel, fonts, strings, extraDialogs, content)

/** Runtime-only variant for previews and tests (no kernel → no extension-point dialogs). */
@Composable
public fun AxfRoot(
    runtime: AxfRuntime,
    kernel: AxfKernel? = null,
    fonts: FontRegistry = FontRegistry.Default,
    strings: Strings = MapStrings(emptyMap()),
    extraDialogs: Map<String, DialogContribution> = emptyMap(),
    content: @Composable () -> Unit,
) {
    val state by runtime.state.collectAsState()
    val compiled by runtime.compiled.collectAsState()
    val clipboard = LocalClipboardManager.current
    val actions = remember(runtime, clipboard) {
        AxfActions({ spec, payload, extras -> runtime.dispatch(spec, payload, extras) }, { m, k, t -> runtime.toast(m, k, t) }) { text -> clipboard.setText(AnnotatedString(text)) }
    }
    val uac = remember(runtime, state.role, compiled.rev) { AxfUac.of(runtime, state) }
    val dialogs = remember(kernel, compiled.rev, extraDialogs) {
        val fromModules = kernel?.extensions?.get(ExtensionPoints.DIALOGS)?.filterIsInstance<DialogContribution>()?.associateBy { it.id } ?: emptyMap()
        builtinDialogs() + fromModules + extraDialogs
    }

    AxfThemeProvider(compiled.theme, fonts) {
        BoxWithConstraints(Modifier.fillMaxSize().background(LocalAxfTheme.current.colors.bg)) {
            val widthDp = maxWidth.value.toInt()
            LaunchedEffect(widthDp) { runtime.setWindowWidth(widthDp) }
            val layout = remember(compiled, widthDp) { compiled.layouts.getValue(LayoutEngine.windowClass(widthDp, compiled.layout)) }
            CompositionLocalProvider(
                LocalAxfKernel provides kernel,
                LocalAxfRuntime provides runtime,
                LocalAxfState provides state,
                LocalAxfCompiled provides compiled,
                LocalAxfStyles provides compiled.styles,
                LocalAxfLayout provides layout,
                LocalAxfUac provides uac,
                LocalAxfActions provides actions,
                LocalAxfStrings provides strings,
            ) {
                val wm = remember(kernel) { kernel?.services?.get<ai.amberx.axf.kernel.contract.WindowManager>() }
                val tabRenderers = remember(kernel) { kernel?.services?.get<ai.amberx.axf.ui.windows.TabRenderers>() ?: ai.amberx.axf.ui.windows.TabRenderers() }
                CompositionLocalProvider(
                    ai.amberx.axf.ui.kit.LocalAxfUiKits provides ai.amberx.axf.ui.kit.rememberAxfUiKits(),
                    ai.amberx.axf.ui.windows.LocalWindowManager provides wm,
                    ai.amberx.axf.ui.windows.LocalTabRenderers provides tabRenderers,
                ) {
                    Box(Modifier.fillMaxSize()) {
                        content()
                        if (wm != null) ai.amberx.axf.ui.windows.FloatingWindowsHost(wm)
                        AxfToastHost()
                        AxfDialogHost(dialogs)
                        AxfContextMenuHost()
                    }
                }
            }
        }
    }
}
