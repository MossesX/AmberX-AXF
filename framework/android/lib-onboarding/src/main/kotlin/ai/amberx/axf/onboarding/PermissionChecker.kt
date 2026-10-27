package ai.amberx.axf.onboarding

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * Reads the live grant state of [PermissionRequest]s and builds the hand-off intents. Stateless; call
 * [snapshot] again whenever the app resumes (the composables do this for you).
 */
public class PermissionChecker(context: Context) {
    private val app: Context = context.applicationContext

    public companion object {
        public const val BATTERY_PERMISSION: String = "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
    }

    /** The Android runtime permission behind [kind], or null when it isn't a runtime dialog (or not needed on this SDK). */
    public fun runtimePermission(kind: PermissionKind): String? = when (kind) {
        PermissionKind.MICROPHONE -> Manifest.permission.RECORD_AUDIO
        PermissionKind.CAMERA -> Manifest.permission.CAMERA
        PermissionKind.NOTIFICATIONS -> if (Build.VERSION.SDK_INT >= 33) Manifest.permission.POST_NOTIFICATIONS else null
        else -> null
    }

    public fun isGranted(request: PermissionRequest): Boolean = runCatching {
        when (request.kind) {
            PermissionKind.MICROPHONE, PermissionKind.CAMERA -> has(runtimePermission(request.kind)!!)
            PermissionKind.NOTIFICATIONS -> runtimePermission(request.kind)?.let { has(it) } ?: true
            PermissionKind.OVERLAY -> Settings.canDrawOverlays(app)
            PermissionKind.ACCESSIBILITY -> accessibilityEnabled(request.serviceClass ?: return@runCatching false)
            PermissionKind.BATTERY -> (app.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(app.packageName)
        }
    }.getOrDefault(false)

    /** Grant map for every request of [spec], keyed by [OnboardingRules.key]. */
    public fun snapshot(spec: OnboardingSpec): Map<GrantKey, Boolean> = spec.requests.associate { OnboardingRules.key(it) to isGranted(it) }

    /**
     * True when this package's [serviceClass] is listed in ENABLED_ACCESSIBILITY_SERVICES. Entries are parsed as
     * component names, so both `pkg/.Short` and `pkg/pkg.Full` forms match (the ported check used a substring).
     */
    public fun accessibilityEnabled(serviceClass: String): Boolean {
        val enabled = Settings.Secure.getString(app.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val want = ComponentName(app.packageName, serviceClass)
        return enabled.split(':').any { entry -> ComponentName.unflattenFromString(entry.trim())?.let { it == want } ?: false }
    }

    /** The settings page for a SYSTEM_SETTINGS / GUIDED_SETTINGS request; null for runtime dialogs. */
    public fun settingsIntent(request: PermissionRequest): Intent? = when (request.kind) {
        PermissionKind.OVERLAY -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${app.packageName}"))
        PermissionKind.ACCESSIBILITY -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        // The direct dialog needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the app's manifest (not declared by this
        // library: it is a Play-policy permission); without it, the general battery-optimisation list opens.
        PermissionKind.BATTERY -> if (declares(BATTERY_PERMISSION)) Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${app.packageName}"))
            else Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        else -> null
    }?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** App details page: the fallback when a runtime permission was denied permanently. */
    public fun appDetailsIntent(): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Opens the settings page for [request] (or the app details page); false when nothing could be opened. */
    public fun openSettings(context: Context, request: PermissionRequest): Boolean {
        val primary = settingsIntent(request) ?: appDetailsIntent()
        return runCatching { context.startActivity(primary); true }.getOrElse {
            // Some OEMs hide the battery dialog: fall back to the general list, then the app page.
            val fallback = if (request.kind == PermissionKind.BATTERY) Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) else appDetailsIntent()
            runCatching { context.startActivity(fallback); true }.getOrDefault(false)
        }
    }

    /** Recovery state right now (heartbeats from [ServiceHeartbeat]). */
    public fun recovery(spec: OnboardingSpec, onboardingDone: Boolean): RecoveryState =
        RecoveryState.evaluate(spec, onboardingDone, snapshot(spec), ServiceHeartbeat.alive.value)

    /** True when the app's merged manifest declares [permission]. */
    public fun declares(permission: String): Boolean = runCatching {
        @Suppress("DEPRECATION")
        val info = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS)
        info.requestedPermissions?.contains(permission) == true
    }.getOrDefault(false)

    private fun has(permission: String): Boolean = ContextCompat.checkSelfPermission(app, permission) == PackageManager.PERMISSION_GRANTED
}
