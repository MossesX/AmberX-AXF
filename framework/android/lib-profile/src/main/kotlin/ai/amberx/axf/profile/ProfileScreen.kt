package ai.amberx.axf.profile

import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
public fun ProfileScreen(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    val service = remember(kernel) { kernel?.services?.get<ProfileService>() }
    if (kernel == null || service == null) { AxfEmptyState("Profile unavailable", message = "ProfileModule is not installed."); return }
    val saved by service.profile.collectAsState()
    var draft by remember(saved) { mutableStateOf(saved) }
    val scope = rememberCoroutineScope()
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Profile", description = "Stored on this device; sync and avatar capture are declared capabilities not yet built.") }
        item { AxfCard(title = "Details", icon = "user") { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AxfTextField(draft.displayName, { draft = draft.copy(displayName = it) }, Modifier.fillMaxWidth(), label = "Display name")
            AxfTextField(draft.bio, { draft = draft.copy(bio = it) }, Modifier.fillMaxWidth(), label = "Bio", singleLine = false, minLines = 3)
            AxfTextField(draft.contact, { draft = draft.copy(contact = it) }, Modifier.fillMaxWidth(), label = "Contact")
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { for (p in listOf("private", "contacts", "public")) AxfChip(p, selected = draft.privacy == p, onClick = { draft = draft.copy(privacy = p) }) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AxfButton("Save", { scope.launch { service.update(draft); kernel.runtime.toast("Profile saved.", ai.amberx.axf.kernel.runtime.ToastKind.SUCCESS) } }, tone = ButtonTone.PRIMARY, icon = "save")
                AxfButton("Sync", { scope.launch { service.sync().onErr { kernel.runtime.toast(it.message, ai.amberx.axf.kernel.runtime.ToastKind.WARNING, "Not built") } } }, icon = "refresh")
                AxfButton("Avatar", { scope.launch { service.captureAvatar().onErr { kernel.runtime.toast(it.message, ai.amberx.axf.kernel.runtime.ToastKind.WARNING, "Not built") } } }, icon = "camera")
            }
        } } }
        item { AxfCard(title = "Not built yet", icon = "box") { Column { for (c in listOf("Avatar capture/crop", "Sync to the VPS", "Public profile / share card", "Activity history")) AxfListItem(c, icon = "alert", subtitle = "Declared capability") } } }
    }
}
