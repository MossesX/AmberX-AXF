package ai.amberx.axf.accounts

import ai.amberx.axf.kernel.contract.Principal
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.Session
import ai.amberx.axf.kernel.contract.SessionProvider
import ai.amberx.axf.kernel.contract.SessionState
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
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
import ai.amberx.axf.kernel.runtime.ToastKind
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonPrimitive

/*
 * User account interface — PLACEHOLDER MODULE. The contracts below are the real ones every later
 * implementation must satisfy; the module ships a mock provider so the console can exercise the flows,
 * and declares the capabilities the real library will fill (email/password, OAuth, passkeys, biometrics,
 * sessions, recovery, GDPR export/delete).
 */

public enum class AuthMethod { PASSWORD, OAUTH, MAGIC_LINK, API_KEY, PASSKEY, BIOMETRIC, GUEST }
public data class Credentials(val method: AuthMethod, val identifier: String = "", val secret: String = "", val provider: String? = null)

/** Contributed through `ExtensionPoints.AUTH_PROVIDERS`. */
public interface AuthProvider {
    public val id: String
    public val label: String
    public val methods: Set<AuthMethod>
    public suspend fun signIn(c: Credentials): AxfResult<Principal>
    public suspend fun signUp(c: Credentials, profile: Map<String, String> = emptyMap()): AxfResult<Principal>
    public suspend fun signOut(principal: Principal): AxfResult<Unit>
    public suspend fun recover(identifier: String): AxfResult<Unit>
}

/** Account-level operations beyond sign-in; placeholders return NotImplemented until built. */
public interface AccountService {
    public suspend fun listSessions(): AxfResult<List<Session>>
    public suspend fun revokeSession(device: String): AxfResult<Unit>
    public suspend fun enableTwoFactor(): AxfResult<String>
    public suspend fun exportData(): AxfResult<String>
    public suspend fun deleteAccount(): AxfResult<Unit>
    public suspend fun switchAccount(id: String): AxfResult<Principal>
}

/** Mock provider: any identifier signs in; `admin@…` gets the admin role, everyone else `user`. */
public class MockAuthProvider : AuthProvider {
    override val id: String = "mock"
    override val label: String = "Mock (no server)"
    override val methods: Set<AuthMethod> = setOf(AuthMethod.PASSWORD, AuthMethod.GUEST)
    override suspend fun signIn(c: Credentials): AxfResult<Principal> = if (c.method == AuthMethod.GUEST) AxfResult.ok(Principal("guest", "Guest", roles = listOf("guest"), provider = id))
        else if (c.identifier.isBlank()) AxfResult.err(AxfFailure.Invalid("Enter an email or name", "identifier")) else AxfResult.ok(Principal("mock:${c.identifier}", c.identifier.substringBefore('@'), c.identifier.takeIf { '@' in it }, roles = listOf(if (c.identifier.startsWith("admin")) "admin" else "user"), provider = id))
    override suspend fun signUp(c: Credentials, profile: Map<String, String>): AxfResult<Principal> = signIn(c)
    override suspend fun signOut(principal: Principal): AxfResult<Unit> = AxfResult.ok(Unit)
    override suspend fun recover(identifier: String): AxfResult<Unit> = AxfResult.ok(Unit)
}

/** The kernel SessionProvider backed by whichever AuthProvider signed the user in; sets the UAC role from the principal. */
public class AccountSession(private val runtime: AxfRuntime?) : SessionProvider {
    private val flow = MutableStateFlow(Session(Principal(Principal.ANONYMOUS), SessionState.SIGNED_OUT))
    override val session: StateFlow<Session> get() = flow
    private var provider: AuthProvider? = null
    public suspend fun signIn(p: AuthProvider, c: Credentials): AxfResult<Principal> {
        flow.value = flow.value.copy(state = SessionState.SIGNING_IN)
        return p.signIn(c).onOk { principal -> provider = p; flow.value = Session(principal, SessionState.SIGNED_IN, System.currentTimeMillis()); principal.roles.firstOrNull()?.let { runtime?.setRole(it) } }
            .onErr { flow.value = flow.value.copy(state = SessionState.SIGNED_OUT) }
    }
    override suspend fun signOut() { provider?.signOut(flow.value.principal); flow.value = Session(Principal(Principal.ANONYMOUS), SessionState.SIGNED_OUT); runtime?.let { it.setRole(it.policy.defaultRole) } }
    override suspend fun refresh(): Boolean = true
    override suspend fun lock() { flow.value = flow.value.copy(state = SessionState.LOCKED) }
    public fun unlock() { if (flow.value.state == SessionState.LOCKED) flow.value = flow.value.copy(state = SessionState.SIGNED_IN) }
}

public object NotImplementedAccounts : AccountService {
    private fun <T> no(c: String): AxfResult<T> = AxfResult.err(AxfFailure.NotImplemented("axf.accounts.$c"))
    override suspend fun listSessions(): AxfResult<List<Session>> = no("sessions")
    override suspend fun revokeSession(device: String): AxfResult<Unit> = no("sessions")
    override suspend fun enableTwoFactor(): AxfResult<String> = no("twoFactor")
    override suspend fun exportData(): AxfResult<String> = no("gdpr")
    override suspend fun deleteAccount(): AxfResult<Unit> = no("gdpr")
    override suspend fun switchAccount(id: String): AxfResult<Principal> = no("multiAccount")
}

public class AccountsModule : PlaceholderModule(ID, "Accounts", listOf(
    Capability("axf.accounts", "User account interface"), Capability("axf.accounts.oauth"), Capability("axf.accounts.passkeys"), Capability("axf.accounts.biometric"),
    Capability("axf.accounts.sessions"), Capability("axf.accounts.twoFactor"), Capability("axf.accounts.gdpr"), Capability("axf.accounts.multiAccount"),
)) {
    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        val session = AccountSession(runtime)
        ctx.services.register(SessionProvider::class, session, "axf.session")
        ctx.services.register(AccountSession::class, session)
        ctx.services.register(AccountService::class, NotImplementedAccounts, "axf.accounts")
        ctx.extensions.contribute(ExtensionPoints.AUTH_PROVIDERS, id, MockAuthProvider())
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("account", "Account", icon = "user", module = id)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("account.signin", ActionMeta("Sign in", module = id)) { _, _ -> runtime?.navigate("account") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("account.signout", ActionMeta("Sign out", module = id)) { _, _ -> runtime?.toast("Sign-out runs through the account screen.", ToastKind.INFO) })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("account", "Account", "user", id, order = 100, settings = listOf(
            SettingSpec("axf.account.open", "Manage account", SettingKind.LINK, target = "account", icon = "user"),
            SettingSpec("axf.account.autoLock", "Auto-lock", SettingKind.CHOICE, "Require biometrics/PIN after inactivity (placeholder)", JsonPrimitive("never"), options = listOf("never" to "Never", "1" to "1 min", "5" to "5 min", "30" to "30 min")),
        ))))
    }
    public companion object { public const val ID: String = "ai.amberx.axf.accounts" }
}
