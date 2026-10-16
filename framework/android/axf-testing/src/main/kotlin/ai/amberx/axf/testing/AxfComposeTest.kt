package ai.amberx.axf.testing

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.ui.AxfRoot
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.ComposeContentTestRule

/** Sets Compose content wrapped in AxfRoot(kernel) so components find their locals. */
public fun ComposeContentTestRule.setAxfContent(kernel: AxfKernel, content: @Composable () -> Unit) {
    setContent { AxfRoot(kernel = kernel) { content() } }
}
