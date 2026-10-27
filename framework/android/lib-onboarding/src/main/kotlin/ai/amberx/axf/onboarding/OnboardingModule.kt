package ai.amberx.axf.onboarding

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.ui.AxfUiPoints
import ai.amberx.axf.ui.ViewContribution

/**
 * lib-onboarding: a reusable first-run permissions flow and the error/recovery state for when a required permission is
 * revoked or a service is stopped. Registers [OnboardingService] as `axf.onboarding` ("done" persisted in the kernel's
 * [KeyValueStore] per app), the `onboarding-status` route + view, and the Setup settings group (link to that page).
 * The app shows the flow itself: `OnboardingGate(spec) { AppShell(…) }` or [OnboardingFlow] on its own route.
 */
public class OnboardingModule(
    private val spec: OnboardingSpec,
    private val wording: SetupWording = SetupWording(),
) : BaseModule(ID, "Onboarding") {
    override val version: String = OnboardingVersion.VERSION
    override val apiLevel: Int = OnboardingVersion.API_LEVEL
    override val provides: List<Capability> = listOf(
        Capability("axf.onboarding", "First-run permissions flow, live permission checks, recovery state"),
    )
    override val optionalDependsOn: List<String> = listOf("ai.amberx.axf.settings")

    public lateinit var service: OnboardingService
        private set

    override fun register(ctx: ModuleContext) {
        // Fails safe: without a KV store "done" is kept in memory only, so the flow shows again on the next start.
        val kv = ctx.service(KeyValueStore::class) ?: MemoryKeyValueStore()
        service = OnboardingService(spec, OnboardingStore(kv))
        ctx.services.register(OnboardingService::class, service, "axf.onboarding")
        ctx.services.register(OnboardingModule::class, this)
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE_STATUS, wording.statusLabel, icon = "shield", module = id)))
        ctx.extensions.contribute(AxfUiPoints.VIEWS, id, ViewContribution(ROUTE_STATUS, wording.statusLabel, "shield") { OnboardingStatusScreen() })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("onboarding", wording.groupLabel, "shield", id, order = 35, description = wording.groupDescription, settings = listOf(
            SettingSpec("axf.onboarding.status", wording.statusLabel, SettingKind.LINK, wording.statusDescription, target = ROUTE_STATUS, icon = "shield"),
        ))))
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.onboarding"
        public const val ROUTE_STATUS: String = "onboarding-status"

        /** Not built yet; typed placeholders so callers get NotImplemented instead of a crash. */
        public fun placeholders(): List<PlaceholderModule> = listOf(
            PlaceholderModule("ai.amberx.axf.onboarding.special", "Special access", listOf(Capability("axf.onboarding.special", "Exact alarms, usage access, notification listener, all-files access (not built)"))),
            PlaceholderModule("ai.amberx.axf.onboarding.web", "Onboarding (web)", listOf(Capability("axf.onboarding.web", "Web twin: camera/mic/notification browser permissions (not built)"))),
            PlaceholderModule("ai.amberx.axf.onboarding.watchdog", "Service watchdog", listOf(Capability("axf.onboarding.watchdog", "Post a notification when a required service stops while the app is closed (not built)"))),
        )
    }
}

/** Words of the Setup settings group and status page. */
public data class SetupWording(
    val groupLabel: String = "Setup",
    val groupDescription: String = "Permissions this app needs and their state.",
    val statusLabel: String = "Permissions & setup",
    val statusDescription: String = "See what's on, fix what's off, or run setup again",
)
