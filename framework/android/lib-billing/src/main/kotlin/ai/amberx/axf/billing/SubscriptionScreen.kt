package ai.amberx.axf.billing

import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Subscription interface: plans from the registered provider (mock today), purchase/restore, entitlement-gated example. */
@Composable
public fun SubscriptionScreen(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    val ents = remember(kernel) { kernel?.services?.get<Entitlements>() }
    if (kernel == null || ents == null) { AxfEmptyState("Billing unavailable", message = "BillingModule is not installed."); return }
    val provider = remember(kernel) { kernel.extensions.get(ExtensionPoints.BILLING_PROVIDERS).filterIsInstance<BillingProvider>().firstOrNull() }
    val state by ents.state.collectAsState()
    var plans by remember { mutableStateOf<List<Plan>>(emptyList()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(provider) { provider?.plans()?.onOk { plans = it } }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Subscription", eyebrow = "provider: ${provider?.label ?: "none"} · active: ${state.active.joinToString().ifEmpty { "none" }}", description = "Entitlements map to feature flags (ent.<id>) so any screen or UAC permission can gate on them. Play Billing replaces the mock provider without changing this screen.", actions = {
            AxfButton("Restore", { scope.launch { provider?.restore()?.onOk { ents.apply(it, provider.id) } } }, icon = "refresh")
            AxfButton("Manage", { scope.launch { provider?.manage()?.onErr { kernel.runtime.toast(it.message, ai.amberx.axf.kernel.runtime.ToastKind.WARNING, "Not built") } } }, icon = "external")
        }) }
        for (p in plans) item(key = p.id) {
            val owned = state.purchases.any { it.plan.id == p.id }
            AxfCard(title = "${p.label} · ${p.price}", icon = "star", actions = { if (owned) AxfBadge("active", tone = "success") else if (p.trialDays > 0) AxfBadge("${p.trialDays}-day trial") }) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { for (f in p.features) AxfText("• $f", muted = true) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!owned) AxfButton(if (p.period == PlanPeriod.FREE) "Choose" else "Subscribe", { scope.launch { provider?.purchase(p)?.onOk { ents.apply(state.purchases + it, provider.id); kernel.runtime.toast("${p.label} active (mock).", ai.amberx.axf.kernel.runtime.ToastKind.SUCCESS) } } }, tone = ButtonTone.PRIMARY, icon = "check")
                }
            }
        }
        item { AxfCard(title = "Gated example", icon = "lock") { if (ents.has("pro")) AxfText("You can see this because the `pro` entitlement is active.") else AxfText("Subscribe to Pro to unlock this block (ent.pro flag).", muted = true) } }
        item { AxfCard(title = "Not built yet", icon = "box") { Column { for (c in listOf("Google Play Billing", "Server-side receipt verification", "Stripe / web billing", "License keys", "Consumables / one-time purchases", "Promo codes & referrals", "Ads adapter")) AxfListItem(c, icon = "alert", subtitle = "Declared capability") } } }
    }
}
