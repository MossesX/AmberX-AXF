package ai.amberx.axf.kernel.contract

import kotlinx.coroutines.flow.StateFlow

/*
 * Session / principal contract (kernel API level 1). The kernel's UAC engine knows the current *role*;
 * this seam says *who* holds it, so accounts, profile, billing entitlements and audit share one notion
 * of the signed-in person instead of inventing three. lib-accounts implements [SessionProvider] and
 * sets the UAC role from the principal; the kernel ships [AnonymousSession] until it does.
 */

public data class Principal(
    /** stable id from the auth provider, or "anonymous" */
    val id: String,
    val displayName: String? = null,
    val email: String? = null,
    val avatarUrl: String? = null,
    /** UAC role ids this principal may act as; the first is the default */
    val roles: List<String> = emptyList(),
    /** entitlement ids from billing/licensing (`billing.pro`, `feature.gps`); UAC permissions may require them */
    val entitlements: Set<String> = emptySet(),
    val provider: String = "anonymous",
    /** tokens never live here; they stay in SecureStore under the provider's key */
    val attributes: Map<String, String> = emptyMap(),
) {
    public val isAnonymous: Boolean get() = id == ANONYMOUS
    public fun has(entitlement: String): Boolean = entitlement in entitlements
    public companion object { public const val ANONYMOUS: String = "anonymous" }
}

public enum class SessionState { SIGNED_OUT, SIGNING_IN, SIGNED_IN, LOCKED, EXPIRED }

public data class Session(val principal: Principal, val state: SessionState, val startedAtMillis: Long = 0, val expiresAtMillis: Long? = null, val device: String? = null)

/** Capability id `axf.session`. */
public interface SessionProvider {
    public val session: StateFlow<Session>
    public val current: Session get() = session.value
    public suspend fun signOut()
    /** Re-validate tokens / refresh; implementations may no-op. */
    public suspend fun refresh(): Boolean
    /** Lock the UI (biometric/PIN) without signing out. */
    public suspend fun lock()
}

/** Default provider: nobody signed in; the UAC default role applies. */
public class AnonymousSession(startedAtMillis: Long = 0) : SessionProvider {
    private val flow = kotlinx.coroutines.flow.MutableStateFlow(Session(Principal(Principal.ANONYMOUS), SessionState.SIGNED_OUT, startedAtMillis))
    override val session: StateFlow<Session> get() = flow
    override suspend fun signOut() {}
    override suspend fun refresh(): Boolean = true
    override suspend fun lock() {}
}

/** Audit hook every library can call; lib-admin persists it, the kernel default keeps the last entries in memory. */
public data class AuditEntry(val atMillis: Long, val principal: String, val action: String, val target: String? = null, val details: Map<String, String> = emptyMap(), val module: String = "app")
public interface AuditLog { public fun record(entry: AuditEntry); public fun recent(limit: Int = 100): List<AuditEntry> }
public class MemoryAuditLog(private val limit: Int = 500) : AuditLog {
    private val entries = ArrayDeque<AuditEntry>()
    override fun record(entry: AuditEntry) { entries.addLast(entry); while (entries.size > limit) entries.removeFirst() }
    override fun recent(limit: Int): List<AuditEntry> = entries.toList().takeLast(limit)
}
