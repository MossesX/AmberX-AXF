package ai.amberx.axf.lock

import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.SecureStore
import kotlinx.serialization.json.JsonPrimitive

/** Wording of the App lock settings group, so each app can say what the second step follows. */
public data class LockWording(
    val groupLabel: String = "App lock",
    val groupDescription: String = "A second step before the app opens.",
    val modeLabel: String = "Unlock with",
    val none: String = "Nothing more",
    val biometric: String = "Fingerprint / face",
    val pin: String = "PIN",
)

/**
 * lib-lock: second-step unlock (fingerprint/face or PIN) with lockout and auto-lock timing. Fills the
 * platform's `android.biometric` placeholder. Contributes the App lock settings group and the
 * `lock-pin` route (set or change the PIN).
 */
public class LockModule(private val wording: LockWording = LockWording(), private val defaultMode: LockMode = LockMode.NONE) : BaseModule(ID, "App lock") {
    override val provides: List<Capability> = listOf(
        Capability("axf.lock", "Second-step unlock: biometric or PIN"),
        Capability("android.biometric", "BiometricPrompt (strong biometrics)"),
    )
    public lateinit var lock: AppLock
        private set

    override fun register(ctx: ModuleContext) {
        lock = AppLock(ctx.service(SecureStore::class), ctx.service(KeyValueStore::class), defaultMode) { ctx.service(Config::class) }
        ctx.services.register(AppLock::class, lock, "axf.lock")
        ctx.services.register(LockModule::class, this, "android.biometric")
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "PIN", icon = "lock", module = id)))
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("lock", wording.groupLabel, "lock", id, order = 30, description = wording.groupDescription, settings = listOf(
            SettingSpec(AppLock.MODE, wording.modeLabel, SettingKind.CHOICE, default = JsonPrimitive(defaultMode.id), options = listOf(LockMode.NONE.id to wording.none, LockMode.BIOMETRIC.id to wording.biometric, LockMode.PIN.id to wording.pin), icon = "shield"),
            SettingSpec("axf.lock.pin", "Set or change PIN", SettingKind.LINK, "Needed when unlocking with a PIN", target = ROUTE, icon = "lock"),
            SettingSpec(AppLock.AUTO, "Lock again after leaving the app", SettingKind.CHOICE, default = JsonPrimitive("0"), options = listOf("0" to "Right away", "1" to "1 min", "5" to "5 min", "15" to "15 min"), icon = "clock"),
        ))))
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.lock"
        public const val ROUTE: String = "lock-pin"
    }
}
