package ai.amberx.axf.billing

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.flags.FeatureFlags
import ai.amberx.axf.kernel.flags.Flag
import ai.amberx.axf.kernel.flags.FlagSource
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/* Subscription interface — PLACEHOLDER MODULE. Contracts + mock provider; Google Play Billing / Stripe / license keys are declared capabilities. */

public enum class PlanPeriod { MONTHLY, YEARLY, LIFETIME, FREE }
public data class Plan(val id: String, val label: String, val price: String, val period: PlanPeriod, val entitlements: Set<String>, val trialDays: Int = 0, val features: List<String> = emptyList())
public data class Purchase(val plan: Plan, val since: Long, val until: Long?, val trial: Boolean)
public data class EntitlementState(val active: Set<String>, val purchases: List<Purchase>, val provider: String)

/** Contributed through `ExtensionPoints.BILLING_PROVIDERS` (Play Billing, Stripe, license keys…). */
public interface BillingProvider {
    public val id: String
    public val label: String
    public suspend fun plans(): AxfResult<List<Plan>>
    public suspend fun purchase(plan: Plan): AxfResult<Purchase>
    public suspend fun restore(): AxfResult<List<Purchase>>
    public suspend fun manage(): AxfResult<String>
}

/** Entitlement engine: the set of active entitlement ids, mirrored into feature flags (`ent.<id>`) so UI and UAC can gate on them. */
public class Entitlements(private val flags: FeatureFlags?) {
    private val _state = MutableStateFlow(EntitlementState(emptySet(), emptyList(), "none"))
    public val state: StateFlow<EntitlementState> get() = _state
    public fun has(id: String): Boolean = id in _state.value.active
    public fun apply(purchases: List<Purchase>, provider: String) {
        val active = purchases.filter { it.until == null || it.until > System.currentTimeMillis() }.flatMap { it.plan.entitlements }.toSet()
        _state.value = EntitlementState(active, purchases, provider)
        for (e in active) flags?.set("ent.$e", true, FlagSource.ROLE)
    }
}

public class MockBillingProvider : BillingProvider {
    override val id: String = "mock"
    override val label: String = "Mock store"
    private val owned = mutableListOf<Purchase>()
    override suspend fun plans(): AxfResult<List<Plan>> = AxfResult.ok(listOf(
        Plan("free", "Free", "$0", PlanPeriod.FREE, setOf("core"), features = listOf("All framework features", "Community support")),
        Plan("pro", "Pro", "$4.99/mo", PlanPeriod.MONTHLY, setOf("core", "pro"), trialDays = 7, features = listOf("Pro libraries", "Remote sync", "Priority support")),
        Plan("team", "Team", "$39/yr", PlanPeriod.YEARLY, setOf("core", "pro", "team"), features = listOf("Everything in Pro", "Admin interface", "Audit trail")),
    ))
    override suspend fun purchase(plan: Plan): AxfResult<Purchase> { val p = Purchase(plan, System.currentTimeMillis(), if (plan.period == PlanPeriod.LIFETIME || plan.period == PlanPeriod.FREE) null else System.currentTimeMillis() + 30L * 86_400_000, plan.trialDays > 0); owned.removeAll { it.plan.id == plan.id }; owned += p; return AxfResult.ok(p) }
    override suspend fun restore(): AxfResult<List<Purchase>> = AxfResult.ok(owned.toList())
    override suspend fun manage(): AxfResult<String> = AxfResult.err(AxfFailure.NotImplemented("axf.billing.manage", "Managing subscriptions opens the store's page once Play Billing is wired."))
}

public class BillingModule : PlaceholderModule(ID, "Billing", listOf(Capability("axf.billing", "Subscription interface"), Capability("axf.billing.play", "Google Play Billing"), Capability("axf.billing.stripe"), Capability("axf.billing.license"), Capability("axf.billing.iap"), Capability("axf.billing.promo"), Capability("axf.billing.ads"))) {
    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        val flags = ctx.service(FeatureFlags::class)
        flags?.declare(Flag("ent.pro", "Pro entitlement (from billing)", false, id)); flags?.declare(Flag("ent.team", "Team entitlement (from billing)", false, id))
        ctx.services.register(Entitlements::class, Entitlements(flags), "axf.entitlements")
        ctx.extensions.contribute(ExtensionPoints.BILLING_PROVIDERS, id, MockBillingProvider())
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("subscription", "Subscription", icon = "star", module = id)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("billing.manage", ActionMeta("Manage subscription", module = id)) { _, _ -> runtime?.navigate("subscription") })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("subscription", "Subscription", "star", id, order = 120, settings = listOf(
            SettingSpec("axf.billing.open", "Plans & purchases", SettingKind.LINK, target = "subscription", icon = "star"),
            SettingSpec("axf.billing.restore", "Restore purchases", SettingKind.ACTION, target = "billing.manage", icon = "refresh"),
        ))))
    }
    public companion object { public const val ID: String = "ai.amberx.axf.billing" }
}
