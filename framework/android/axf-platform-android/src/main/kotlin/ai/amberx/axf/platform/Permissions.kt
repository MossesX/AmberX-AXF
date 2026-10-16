package ai.amberx.axf.platform

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import ai.amberx.axf.kernel.platform.PermissionGateway
import ai.amberx.axf.kernel.platform.PermissionState
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * What the single activity binds so the [PermissionGateway] can launch the system dialog. Register in
 * `onCreate` (before STARTED) through [AndroidPermissions.bind]; [AxfActivity] does this for you.
 */
public class PermissionHost internal constructor(
    internal val activity: ComponentActivity,
    internal val launcher: ActivityResultLauncher<Array<String>>,
) {
    internal fun showRationale(permission: String): Boolean = ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)
}

/**
 * Runtime permissions through the ActivityResult API. Requests are serialised (one system dialog at a
 * time); without a bound host every request resolves to the current state so callers never hang.
 * Logical ids (`axf.location`) map to platform groups through [groups].
 */
public class AndroidPermissions(private val context: Context, private val groups: Map<String, List<String>> = DEFAULT_GROUPS) : PermissionGateway {
    private var host: PermissionHost? = null
    private var pending: CompletableDeferred<Map<String, Boolean>>? = null
    private val mutex = Mutex()
    private val deniedBefore = mutableSetOf<String>()

    /** Binds an activity. Call from `onCreate`; rebinds safely on configuration change. */
    public fun bind(activity: ComponentActivity): PermissionHost {
        val launcher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result -> pending?.complete(result); pending = null }
        val h = PermissionHost(activity, launcher)
        host = h
        return h
    }

    public fun unbind() { host = null }

    private fun expand(ids: List<String>): List<String> = ids.flatMap { groups[it] ?: listOf(it) }.distinct()

    override fun state(permission: String): PermissionState {
        val perms = expand(listOf(permission))
        if (perms.isEmpty()) return PermissionState.UNKNOWN
        val granted = perms.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
        if (granted) return PermissionState.GRANTED
        val h = host ?: return if (perms.any { it in deniedBefore }) PermissionState.DENIED else PermissionState.UNKNOWN
        val forever = perms.any { it in deniedBefore && !h.showRationale(it) }
        return if (forever) PermissionState.DENIED_FOREVER else if (perms.any { it in deniedBefore }) PermissionState.DENIED else PermissionState.UNKNOWN
    }

    override suspend fun request(permissions: List<String>, rationale: String?): Map<String, PermissionState> {
        val h = host ?: return permissions.associateWith { state(it) }
        val platform = expand(permissions).filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
        if (platform.isEmpty()) return permissions.associateWith { PermissionState.GRANTED }
        val result = mutex.withLock {
            val d = CompletableDeferred<Map<String, Boolean>>()
            pending = d
            h.launcher.launch(platform.toTypedArray())
            d.await()
        }
        for ((p, ok) in result) if (!ok) deniedBefore += p else deniedBefore -= p
        return permissions.associateWith { state(it) }
    }

    override fun openSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
    }

    public companion object {
        /** Logical permission groups every AXF app shares. Apps extend the map. */
        public val DEFAULT_GROUPS: Map<String, List<String>> = mapOf(
            "axf.camera" to listOf("android.permission.CAMERA"),
            "axf.microphone" to listOf("android.permission.RECORD_AUDIO"),
            "axf.location" to listOf("android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"),
            "axf.notifications" to listOf("android.permission.POST_NOTIFICATIONS"),
            "axf.contacts" to listOf("android.permission.READ_CONTACTS"),
            "axf.media" to listOf("android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO"),
        )
    }
}
