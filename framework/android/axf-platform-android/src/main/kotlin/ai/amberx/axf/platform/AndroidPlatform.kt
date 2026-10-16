package ai.amberx.axf.platform

import android.content.Context
import android.os.Build
import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.Platform
import ai.amberx.axf.kernel.platform.AxfDispatchers
import ai.amberx.axf.kernel.platform.CounterIdGenerator
import ai.amberx.axf.kernel.platform.HostInfo
import ai.amberx.axf.kernel.platform.LogLevel
import ai.amberx.axf.kernel.platform.NoopTelemetry
import ai.amberx.axf.kernel.platform.SystemClock
import ai.amberx.axf.kernel.platform.Telemetry
import kotlinx.coroutines.Dispatchers
import java.util.Locale

/** Builds the kernel [Platform] from Android services. Everything is replaceable through the parameters. */
public object AndroidPlatform {
    public fun hostInfo(context: Context, appId: String, appVersion: String, debug: Boolean): HostInfo {
        val dm = context.resources.displayMetrics
        return HostInfo(
            port = AxfVersion.PORT,
            osVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            device = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            appId = appId,
            appVersion = appVersion,
            debug = debug,
            locale = Locale.getDefault().toLanguageTag(),
            windowWidthDp = (dm.widthPixels / dm.density).toInt(),
        )
    }

    public fun create(
        context: Context,
        appId: String,
        appVersion: String,
        debug: Boolean,
        telemetry: Telemetry = NoopTelemetry,
        permissions: AndroidPermissions = AndroidPermissions(context.applicationContext),
    ): Platform {
        val app = context.applicationContext
        return Platform(
            clock = SystemClock,
            ids = CounterIdGenerator(SystemClock),
            dispatchers = AxfDispatchers(main = Dispatchers.Main, io = Dispatchers.IO, default = Dispatchers.Default),
            store = SharedPrefsKeyValueStore(app),
            secure = EncryptedSecureStore(app),
            logger = LogcatLogger(if (debug) LogLevel.VERBOSE else LogLevel.INFO),
            telemetry = telemetry,
            permissions = permissions,
            files = AndroidFileLayout(app),
            ledger = SharedPrefsMigrationLedger(app),
            host = hostInfo(app, appId, appVersion, debug),
        )
    }
}
