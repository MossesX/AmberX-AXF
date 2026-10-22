package ai.amberx.axf.lock

import android.content.Context
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
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.settings.SettingsEngine
import ai.amberx.axf.ui.AxfUiPoints
import ai.amberx.axf.ui.ViewContribution
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/** Wording of the App lock settings group, so each app can say what the second step follows. */
public data class LockWording(
    val groupLabel: String = "App lock",
    val groupDescription: String = "A second step before the app opens.",
    val modeLabel: String = "Unlock with",
    val none: String = "Nothing more",
    val biometric: String = "Fingerprint / face",
    val pin: String = "PIN",
    /** Shown when PIN is picked before a PIN is saved (the PIN screen opens next). */
    val pinNeeded: String = "Set a PIN first, then choose $pin.",
)

/**
 * lib-lock: second-step unlock (fingerprint/face or PIN) with lockout and auto-lock timing. Fills the
 * platform's `android.biometric` placeholder. Contributes the App lock settings group, the `lock-pin`
 * route and its view, and the lock-mode guard: picking PIN without a saved PIN, or fingerprint without a
 * usable sensor, is put back to the previous choice with a warning. [context] (the Application) is needed
 * to check the sensor; without it a fingerprint pick is refused (fails closed).
 */
public class LockModule(
    private val context: Context? = null,
    private val wording: LockWording = LockWording(),
    private val defaultMode: LockMode = LockMode.NONE,
) : BaseModule(ID, "App lock") {
    override val provides: List<Capability> = listOf(
        Capability("axf.lock", "Second-step unlock: biometric or PIN"),
        Capability("android.biometric", "BiometricPrompt (strong biometrics)"),
    )
    override val optionalDependsOn: List<String> = listOf("ai.amberx.axf.settings")
    public lateinit var lock: AppLock
        private set
    private val guard = LockModeGuard()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun register(ctx: ModuleContext) {
        lock = AppLock(ctx.service(SecureStore::class), ctx.service(KeyValueStore::class), defaultMode) { ctx.service(Config::class) }
        ctx.services.register(AppLock::class, lock, "axf.lock")
        ctx.services.register(LockModule::class, this, "android.biometric")
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "PIN", icon = "lock", module = id)))
        ctx.extensions.contribute(AxfUiPoints.VIEWS, id, ViewContribution(ROUTE, "PIN", "lock") { PinSetupScreen() })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("lock", wording.groupLabel, "lock", id, order = 30, description = wording.groupDescription, settings = listOf(
            SettingSpec(AppLock.MODE, wording.modeLabel, SettingKind.CHOICE, default = JsonPrimitive(defaultMode.id), options = listOf(LockMode.NONE.id to wording.none, LockMode.BIOMETRIC.id to wording.biometric, LockMode.PIN.id to wording.pin), icon = "shield"),
            SettingSpec("axf.lock.pin", "Set or change PIN", SettingKind.LINK, "Needed when unlocking with a PIN", target = ROUTE, icon = "lock"),
            SettingSpec(AppLock.AUTO, "Lock again after leaving the app", SettingKind.CHOICE, default = JsonPrimitive("0"), options = listOf("0" to "Right away", "1" to "1 min", "5" to "5 min", "15" to "15 min"), icon = "clock"),
        ))))
        guardModes(ctx)
    }

    override suspend fun start(ctx: ModuleContext) { guard.start(lock.mode) }

    private fun guardModes(ctx: ModuleContext) {
        val settings = ctx.service(SettingsEngine::class) ?: return
        val runtime = ctx.service(AxfRuntime::class)
        settings.onChange { key, value ->
            if (key != AppLock.MODE) return@onChange
            val mode = LockMode.of((value as? JsonPrimitive)?.content)
            scope.launch {
                when (val d = guard.onPicked(mode) { m -> lock.modeProblem(m, context, wording.pinNeeded) }) {
                    LockModeGuard.Decision.Accept -> Unit
                    is LockModeGuard.Decision.Revert -> {
                        settings.set(AppLock.MODE, JsonPrimitive(d.back.id))
                        runtime?.toast(d.problem, ToastKind.WARNING, wording.groupLabel)
                        if (mode == LockMode.PIN) runtime?.navigate(ROUTE)
                    }
                }
            }
        }
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.lock"
        public const val ROUTE: String = "lock-pin"
    }
}
