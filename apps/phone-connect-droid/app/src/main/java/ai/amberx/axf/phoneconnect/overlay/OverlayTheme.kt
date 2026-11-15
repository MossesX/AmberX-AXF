package ai.amberx.axf.phoneconnect.overlay

import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.ui.LocalAxfStyles
import ai.amberx.axf.ui.theme.AxfThemeProvider
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

/**
 * The console's live skin for an overlay window: the compiled theme and component styles from the kernel, which the
 * hub keeps current. No app shell, no waiting screen: an overlay never blocks the phone while the hub is away.
 */
@Composable
fun OverlayTheme(context: Context, content: @Composable () -> Unit) {
    val runtime = (context.applicationContext as AxfApplication).kernel.runtime
    val compiled by runtime.compiled.collectAsState()
    AxfThemeProvider(compiled.theme) {
        CompositionLocalProvider(LocalAxfStyles provides compiled.styles, content = content)
    }
}
