package {{APPLICATION_ID}}.views

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.theme.AxfTheme
import ai.amberx.axf.ui.theme.LocalAxfActions

@Composable
fun HomeView() {
    val actions = LocalAxfActions.current
    Column(Modifier.padding(AxfTheme.spacing.lg)) {
        AxfCard(title = "{{APP_NAME}}") {
            AxfText("Initialized by the AmberX AXF build engine. Every theme, layout and menu you see is a hot-swappable asset.")
            AxfButton("Next color theme") { actions.dispatch("swap:color-theme:next") }
        }
    }
}
