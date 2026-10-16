# axf-platform-android

Android implementations of every seam in `ai.amberx.axf.kernel.platform`, plus the two base classes an app extends.

| Kernel seam | Implementation |
|---|---|
| `KeyValueStore` | `SharedPrefsKeyValueStore` (synchronous; the kernel reads it on the first frame) |
| `SecureStore` | `EncryptedSecureStore` (androidx.security EncryptedSharedPreferences) |
| `AxfLogger` | `LogcatLogger` |
| `Telemetry` | `NoopTelemetry` (override `AxfApplication.telemetry()`) |
| `PermissionGateway` | `AndroidPermissions` + `PermissionHost` bound by the activity |
| `FileLayout` | `AndroidFileLayout` (`FileArea` → filesDir / cacheDir / external files) |
| `MigrationLedger` | `SharedPrefsMigrationLedger` |
| `HostInfo` | `AndroidPlatform.hostInfo` from `Build` + package info |

`AndroidPlatform.create(context, appId, appVersion, debug)` returns the kernel `Platform`.

Bootstrap:

```kotlin
class MyApp : AxfApplication() { override fun modules() = listOf(SettingsModule(), MyModule()) }
class MainActivity : AxfActivity() { @Composable override fun Content() { AppShell(views = views) } }
```

`AxfApplication` reads `assets/axf/axf.manifest.json`, loads every asset `axf-assets` bundled, builds the kernel synchronously and starts the modules on `appScope`. `AxfActivity` enables edge-to-edge, binds the permission host and renders `Content()` inside `AxfRoot`. The manifest contributes no permissions; feature modules add their own and the app manifest merges them.
