package {{PACKAGE}}

import ai.amberx.axf.kernel.platform.PermissionGateway
import ai.amberx.axf.kernel.platform.PermissionState

/** Wraps the platform permission for this capability; the real device API calls go in here. */
public class {{CLASS}}Capability(private val permissions: PermissionGateway?) {
    public val permission: String = "{{P_PERMISSION}}"
    public fun state(): PermissionState = permissions?.state(permission) ?: PermissionState.UNKNOWN
    public suspend fun request(): PermissionState = permissions?.request(listOf(permission), "{{LABEL}} needs this to work")?.get(permission) ?: PermissionState.UNKNOWN
    public fun openSettings() { permissions?.openSettings() }
}
