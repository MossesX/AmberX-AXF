package ai.amberx.axf.admin

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.contract.AuditEntry
import ai.amberx.axf.kernel.contract.AuditLog
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SessionProvider
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.event.KernelEvent
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/* Administration interface — PLACEHOLDER MODULE: audit trail from kernel events (real), admin screen over roles/flags/modules, declared capabilities for user management, content publishing, maintenance mode, MDM. */

public interface AdminService {
    public suspend fun listUsers(): AxfResult<List<String>>
    public suspend fun setUserRole(userId: String, role: String): AxfResult<Unit>
    public suspend fun setMaintenance(on: Boolean, message: String): AxfResult<Unit>
    public suspend fun publishAssets(ids: List<String>): AxfResult<Unit>
}
public object NotImplementedAdmin : AdminService {
    private fun <T> no(c: String): AxfResult<T> = AxfResult.err(AxfFailure.NotImplemented("axf.admin.$c"))
    override suspend fun listUsers(): AxfResult<List<String>> = no("users")
    override suspend fun setUserRole(userId: String, role: String): AxfResult<Unit> = no("users")
    override suspend fun setMaintenance(on: Boolean, message: String): AxfResult<Unit> = no("maintenance")
    override suspend fun publishAssets(ids: List<String>): AxfResult<Unit> = no("content")
}

public class AdminModule : PlaceholderModule(ID, "Administration", listOf(Capability("axf.admin", "Administration interface"), Capability("axf.admin.users"), Capability("axf.admin.content"), Capability("axf.admin.maintenance"), Capability("axf.admin.mdm"))) {
    override fun register(ctx: ModuleContext) {
        ctx.services.register(AdminService::class, NotImplementedAdmin, "axf.admin")
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("admin", "Administration", icon = "shield", module = id, requires = "uac.manage")))
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("admin", "Administration", "shield", id, order = 850, settings = listOf(
            SettingSpec("axf.admin.open", "Open administration", SettingKind.LINK, target = "admin", icon = "shield", requires = "uac.manage"),
            SettingSpec("axf.admin.audit", "Keep audit trail", SettingKind.TOGGLE, "Record role, policy, flag and module changes", JsonPrimitive(true), requires = "uac.manage"),
        ))))
    }
    override suspend fun start(ctx: ModuleContext) {
        val kernel = ctx.service(AxfKernel::class) ?: return
        val audit = ctx.service(AuditLog::class) ?: return
        val session = ctx.service(SessionProvider::class)
        kernel.scope.launch {
            kernel.events.events.collect { e ->
                val who = session?.current?.principal?.id ?: "anonymous"
                when (e) {
                    is KernelEvent.RoleChanged -> audit.record(AuditEntry(System.currentTimeMillis(), who, "role.change", e.to, mapOf("from" to e.from), id))
                    is KernelEvent.FlagChanged -> audit.record(AuditEntry(System.currentTimeMillis(), who, "flag.change", e.flag, mapOf("enabled" to e.enabled.toString()), id))
                    is KernelEvent.ModuleStateChanged -> audit.record(AuditEntry(System.currentTimeMillis(), who, "module.${e.state.lowercase()}", e.module, emptyMap(), id))
                    is KernelEvent.AssetSwapped -> if (e.type == "uac-policy") audit.record(AuditEntry(System.currentTimeMillis(), who, "policy.change", e.to, mapOf("from" to (e.from ?: "")), id))
                    else -> {}
                }
            }
        }
    }
    public companion object { public const val ID: String = "ai.amberx.axf.admin" }
}
