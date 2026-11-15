package ai.amberx.axf.phoneconnect.overlay

import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.M3Button
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandIn
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.delay

/** Entry animation for a popup, from the console's Overlay settings. */
fun enterOf(name: String, ms: Int): EnterTransition = when (name) {
    "slide-top" -> slideInVertically(tween(ms)) { -it } + fadeIn(tween(ms))
    "burst" -> scaleIn(spring(dampingRatio = 0.45f), initialScale = 0.2f) + fadeIn(tween(ms / 2))
    "circle" -> expandIn(tween(ms), expandFrom = Alignment.Center) + fadeIn(tween(ms))
    "scale" -> scaleIn(tween(ms), initialScale = 0.85f) + fadeIn(tween(ms))
    "bounce" -> slideInVertically(spring(dampingRatio = 0.35f)) { -it / 2 } + fadeIn(tween(ms / 2))
    else -> fadeIn(tween(ms))
}

fun exitOf(name: String, ms: Int): ExitTransition = when (name) {
    "slide-top" -> slideOutVertically(tween(ms)) { -it } + fadeOut(tween(ms))
    "burst", "scale", "bounce" -> scaleOut(tween(ms), targetScale = 0.85f) + fadeOut(tween(ms))
    "circle" -> shrinkOut(tween(ms), shrinkTowards = Alignment.Center) + fadeOut(tween(ms))
    else -> fadeOut(tween(ms))
}

/**
 * One popup: title, text and its actions, acted on in place (Approve / Deny / Shelve for an approval, Open or
 * Dismiss for the rest). It leaves after `stayMs` unless it is an approval with stayMs 0.
 */
@Composable
fun PopupCard(popup: Popup, style: PopupStyle, onAction: (Popup, String) -> Unit, onGone: (Popup) -> Unit) {
    val state = remember(popup.id) { MutableTransitionState(false).apply { targetState = true } }
    LaunchedEffect(popup.id, style.stayMs) { if (style.stayMs > 0) { delay(style.stayMs.toLong()); state.targetState = false } }
    LaunchedEffect(state.currentState, state.isIdle) { if (state.isIdle && !state.currentState) onGone(popup) }
    val width = Axf.space.unit * when (style.size) { "small" -> 32; "large" -> 52; else -> 42 }
    val tone = when (popup.kind) { "approval" -> Axf.colors.accent; "alert" -> Axf.colors.danger; else -> Axf.colors.border }
    AnimatedVisibility(state, enter = enterOf(style.enter, style.speedMs), exit = exitOf(style.exit, style.speedMs)) {
        Column(
            Modifier
                .widthIn(max = width)
                .alpha(style.opacity)
                .padding(Axf.space.one)
                .clip(Axf.shapes.lgShape)
                .background(Axf.colors.surface, Axf.shapes.lgShape)
                .border(Axf.space.borderWidth, tone, Axf.shapes.lgShape)
                .padding(Axf.space.oneHalf)
                .semantics { contentDescription = "${popup.kind}: ${popup.title}" },
            verticalArrangement = Arrangement.spacedBy(Axf.space.one),
        ) {
            AxfText(popup.title, style = Axf.type.titleSmall, maxLines = 2)
            if (popup.body.isNotBlank()) AxfText(popup.body, style = Axf.type.bodySmall, muted = true, maxLines = 6)
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                for (a in popup.actions.ifEmpty { listOf("dismiss") }) {
                    M3Button(LABELS[a] ?: a, onClick = { onAction(popup, a); if (a != "open") state.targetState = false },
                        tone = when (a) { "approve" -> ButtonTone.PRIMARY; "deny" -> ButtonTone.DANGER; else -> ButtonTone.NEUTRAL })
                }
            }
        }
    }
}

val LABELS = mapOf("approve" to "Approve", "deny" to "Deny", "shelve" to "Shelve", "open" to "Open", "dismiss" to "Dismiss")
