package ai.amberx.yo.views

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.theme.Axf

@Composable
fun HomeView() {
    val actions = LocalAxfActions.current
    Column(Modifier.padding(Axf.space.two)) {
        AxfCard(title = "Yo") {
            AxfText("Initialized by the AmberX AXF build engine. Every theme, layout and menu you see is a hot-swappable asset.")
            AxfButton("Next color theme", { actions.dispatch("swap:color-theme:next") }, icon = "palette")
        }
    }
}
