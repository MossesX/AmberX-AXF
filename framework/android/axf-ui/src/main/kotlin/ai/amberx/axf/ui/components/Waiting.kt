package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.engine.AppearanceSourceState
import ai.amberx.axf.ui.Axf
import ai.amberx.axf.ui.kit.AxfButton
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Waiting screen for developer apps (runtime `attachAppearanceSource`): shown instead of the app while axHub's data
 * server hasn't answered (web: react/components/Waiting.tsx). Themed by the app's defaults; says what is unreachable,
 * the next try, and offers Retry. No "run anyway": a developer app doesn't run without the hub.
 */
@Composable
public fun AxfWaitingForHub(state: AppearanceSourceState, hub: String?, onRetry: () -> Unit, onSignIn: (() -> Unit)? = null) {
    val theme = Axf.theme
    val unauthorized = state is AppearanceSourceState.Unauthorized
    val detail = when (state) {
        is AppearanceSourceState.Connecting -> "Loading this app's settings from the hub…"
        is AppearanceSourceState.Unauthorized -> state.reason
        is AppearanceSourceState.Unreachable -> "${state.reason}\nTry ${state.attempt} failed · next try in ${(state.retryInMs / 1000).coerceAtLeast(1)} s"
        is AppearanceSourceState.Ready -> ""
    }
    Column(Modifier.fillMaxSize().padding(theme.spacing.two), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        AxfCard(Modifier.widthIn(max = 480.dp), title = if (unauthorized) "Sign in to axHub" else "Waiting for axHub", icon = if (unauthorized) "lock" else "clock") {
            AxfText("This app keeps its settings and its look on axHub${if (hub != null) " ($hub)" else ""}. It starts once the hub answers.")
            if (detail.isNotEmpty()) AxfText(detail, muted = true)
            AxfButton("Retry now", onClick = onRetry, icon = "refresh", tone = ButtonTone.PRIMARY)
            if (unauthorized && onSignIn != null) AxfButton("Sign in on the hub", onClick = onSignIn, icon = "external")
            AxfText("No local copy is used on purpose: every developer app follows the one shared look.", muted = true, style = Axf.type.bodySmall)
        }
    }
}
