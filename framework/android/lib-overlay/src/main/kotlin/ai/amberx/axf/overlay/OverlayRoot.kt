package ai.amberx.axf.overlay

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.ui.AxfActions
import ai.amberx.axf.ui.AxfUac
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfLayout
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.LocalAxfStyles
import ai.amberx.axf.ui.LocalAxfUac
import ai.amberx.axf.ui.kit.LocalAxfUiKits
import ai.amberx.axf.ui.kit.rememberAxfUiKits
import ai.amberx.axf.ui.theme.AxfThemeProvider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember

/**
 * The root of an overlay window's Compose tree: the same theme (engine-compiled tokens, hot-swapped with the app) and
 * locals `AxfRoot` provides, without the parts that belong to the app's own window — no window-width measurement into the
 * runtime (the pill is small and must not change the app's layout class), no dialog / toast / context-menu hosts, no
 * waiting screen. Framework components (AxfChip, AxfIconButton, AxfText …) work inside it as they do in the app.
 */
@Composable
internal fun OverlayRoot(runtime: AxfRuntime, kernel: AxfKernel?, content: @Composable () -> Unit) {
    val state by runtime.state.collectAsState()
    val compiled by runtime.compiled.collectAsState()
    val actions = remember(runtime) { AxfActions({ spec, payload, extras -> runtime.dispatch(spec, payload, extras) }, { m, k, t -> runtime.toast(m, k, t) }, null) }
    val uac = remember(runtime, state.role, compiled.rev) { AxfUac.of(runtime, state) }
    // the overlay is a phone-width-class surface whatever the app's window is; the layout only feeds components that ask for one
    val layout = remember(compiled) { compiled.layoutFor(360) }
    AxfThemeProvider(compiled.theme) {
        CompositionLocalProvider(
            LocalAxfKernel provides kernel,
            LocalAxfRuntime provides runtime,
            LocalAxfState provides state,
            LocalAxfCompiled provides compiled,
            LocalAxfStyles provides compiled.styles,
            LocalAxfLayout provides layout,
            LocalAxfUac provides uac,
            LocalAxfActions provides actions,
        ) {
            CompositionLocalProvider(LocalAxfUiKits provides rememberAxfUiKits()) { content() }
        }
    }
}
