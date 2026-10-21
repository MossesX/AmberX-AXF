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

Secure building blocks (harvested from Voice Vault, Oct 2026):

- **`KeystoreFileStore(context, fileName, keyAlias)`**: one encrypted file, AES-256-GCM with a non-exportable Android Keystore key,
  written atomically to `noBackupFilesDir` (never backed up or transferred). `read { bytes -> }` zeroes the plaintext after,
  `write`, `erase()` deletes the file **and** its key, `KeystoreFileUnreadable` when the key was reset or the file damaged (never
  read as "empty"). `configureKey` / `decryptCipher()` are the hook for lib-lock's `axf.lock.keybound` (fingerprint per decrypt).
- **`SensitiveClipboard(context, scope)`**: copies a secret flagged sensitive (API 33+ `EXTRA_IS_SENSITIVE`, the same extra before),
  tagged per copy, cleared after `clearAfterSec` only if the clipboard still holds our copy; `clearNow()`.
- **Secure window**: `android.secureWindow: true` in `axf.manifest.json` (or override `AxfActivity.secureWindow`) sets FLAG_SECURE
  on the activity before the first frame and turns WebView debugging off (in `AxfApplication` too, before any WebView).
  The android-compose template's backup rules exclude `axf.secure.xml` and `app_webview/`.
