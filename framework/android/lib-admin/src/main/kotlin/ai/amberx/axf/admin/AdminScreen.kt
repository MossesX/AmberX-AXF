package ai.amberx.axf.admin

import ai.amberx.axf.kernel.contract.AuditLog
import ai.amberx.axf.kernel.module.ModuleState
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/** Administration interface: policy + roles, feature flags, modules, audit trail. Real parts read the kernel; the rest are declared placeholders. */
@Composable
public fun AdminScreen(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    val actions = LocalAxfActions.current
    val state = LocalAxfState.current
    if (kernel == null) { AxfEmptyState("Admin unavailable"); return }
    var tick by remember { mutableStateOf(0) }
    val flags = remember(kernel, tick) { kernel.flags.declared().map { it to kernel.flags.isEnabled(it.id) } }
    val modules = remember(kernel, kernel.started) { kernel.modules.info() }
    val audit = remember(kernel, state.rev, tick) { kernel.services.get<AuditLog>()?.recent(50) ?: emptyList() }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Administration", eyebrow = "policy ${state.active["uac-policy"]} · role ${state.role}", description = "Roles, policies, feature flags, modules and the audit trail. User management, content publishing and maintenance mode are declared capabilities.") }
        item { AxfCard(title = "Policy & roles", icon = "shield", actions = { AxfButton("Next policy", { actions.dispatch("swap:uac-policy:next") }, icon = "shield", requires = "uac.manage") }) { Column { for (r in kernel.runtime.policy.roles) AxfListItem(r.label, subtitle = r.permissions.joinToString(), icon = if (r.id == state.role) "check" else "user", onClick = { kernel.runtime.setRole(r.id) }, selected = r.id == state.role) } } }
        item { AxfCard(title = "Feature flags", icon = "flag") { Column { for ((f, on) in flags) AxfSwitch(on, { kernel.flags.set(f.id, it); tick++ }, label = f.id, description = f.description) } } }
        item { AxfCard(title = "Modules", icon = "layers") { Column { for (m in modules) AxfListItem(m.label, subtitle = m.id, icon = if (m.placeholder) "box" else "layers", trailing = { AxfBadge(m.state.name.lowercase(), tone = if (m.state == ModuleState.STARTED) "success" else if (m.state == ModuleState.FAILED) "danger" else "accent") }) } } }
        item { AxfCard(title = "Audit trail", icon = "list") { Column { if (audit.isEmpty()) AxfListItem("No entries yet", icon = "info", subtitle = "Role, policy, flag and module changes are recorded here."); for (a in audit.asReversed()) AxfListItem("${a.action} ${a.target ?: ""}", subtitle = "${a.principal} · ${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date(a.atMillis))}" + if (a.details.isEmpty()) "" else " · " + a.details.entries.joinToString { "${it.key}=${it.value}" }, icon = "clock") } } }
        item { AxfCard(title = "Not built yet", icon = "box") { Column { for (c in listOf("User management (list, invite, suspend, assign role)", "Content / asset publishing to users", "Maintenance mode + announcements", "Remote config editor", "Device / fleet management (MDM)")) AxfListItem(c, icon = "alert", subtitle = "Declared capability") } } }
    }
}
