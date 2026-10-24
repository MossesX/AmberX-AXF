package ai.amberx.axf.voicevault.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LifecycleResumeEffect
import ai.amberx.axf.kernel.engine.AppearanceSourceState
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voicevault.notes.VoiceNotes
import ai.amberx.axf.voicevault.sync.HubSyncModule
import ai.amberx.axf.voicevault.sync.SyncState

/** Route `hub-sync`: where the look and settings come from, whether axHub answers, sync now / sign in. */
@Composable
fun HubSyncView() {
    val sync = rememberService<HubSyncModule>() ?: run { AxfEmptyState("axHub sync unavailable", icon = "cloud"); return }
    val runtime = LocalAxfRuntime.current
    val look by sync.lookState.collectAsState()
    val mirror by sync.mirror.collectAsState()
    val settings = mirror?.state?.collectAsState()?.value ?: SyncState.Off
    LifecycleResumeEffect(Unit) { sync.refresh(); onPauseOrDispose { } }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead("axHub sync", eyebrow = "Voice Vault", description = "Voice Vault takes the same look and settings as your other apps and devices from ${sync.hub}. Passwords and the unlock code never leave this phone.")
        AxfCard(Modifier.fillMaxWidth(), title = "Look", icon = "palette") {
            when (val s = look) {
                null -> AxfText("Off: Voice Vault keeps its own look.", muted = true)
                is AppearanceSourceState.Ready -> AxfText("Matches axHub.")
                is AppearanceSourceState.Connecting -> AxfText("Connecting…", muted = true)
                is AppearanceSourceState.Unauthorized -> AxfText(s.reason, color = Axf.colors.warning)
                is AppearanceSourceState.Unreachable -> AxfText("${s.reason} The app keeps working; it retries by itself.", color = Axf.colors.warning)
            }
        }
        AxfCard(Modifier.fillMaxWidth(), title = "Settings", icon = "settings") {
            when (val s = settings) {
                SyncState.Off -> AxfText("Off: settings stay on this phone.", muted = true)
                SyncState.Loading -> AxfText("Reading axHub…", muted = true)
                is SyncState.Ready -> AxfText(if (s.updatedAt.isBlank()) "On axHub (nothing saved yet)." else "On axHub, saved ${s.updatedAt}.")
                is SyncState.SignedOut -> AxfText(s.why, color = Axf.colors.warning)
                is SyncState.Unreachable -> AxfText(s.why, color = Axf.colors.warning)
            }
        }
        AxfButton("Sync now", { sync.refresh() }, tone = ButtonTone.PRIMARY, icon = "refresh")
        AxfButton("Sign in to axHub", { runtime.navigate(VoiceNotes.SIGN_IN_ROUTE) }, tone = ButtonTone.GHOST, icon = "user")
        AxfButton("What syncs", { runtime.dispatch("settings.open:voicevault.hubsync") }, tone = ButtonTone.GHOST, icon = "settings")
    }
}
