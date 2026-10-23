# Harvest: android-security (Oct 20–21 2026, Opus)

Branch `harvest/h-android-security`. Harvest plan rows 1, 7, 8, 9 + the lib-voice / cleanup items. Kotlin written
without Gradle/Maven; the pure parts (LockGate, LockModeGuard, PersistedLockout, StoredSecret/SecretKind, PinHasher,
SpokenText) were compiled with kotlinc 2.0.21 (`-Xexplicit-api=strict`) and their tests run locally (21/21). Compose,
Android and app code is compiled by CI only: check the "CI build errors" issue after merge.

## What moved (from → to)

| Item | From | To |
|---|---|---|
| Unlock gate (leave/return/auto-lock, fails closed) | axhub `AppModule.kt` `AppLockGate` + voicevault `VaultSession` (`onBackground`/`onForeground`, away timer, idle loop) | lib-lock `LockGate` + `lockGate(appLock, scope, firstStep, idleMinutes, ready)` |
| Locked card | axhub `views/LockGate.kt` `Gated` + voicevault `views/Common.kt` `UnlockedOnly` | lib-lock `Gated(gate, GateWording, UnlockElsewhere?, onReset?)` (`LockScreens.kt`) |
| One gate around every view | each app wrapped each view by hand | axf-ui `AppShell(viewGuard = { id, content -> … })` |
| Lock-mode guard | voicevault `AppModule.guardLockMode` | lib-lock `LockModeGuard` (pure) wired by `LockModule` for every app; `AppLock.modeProblem(mode, context)` |
| Persisted lockout | voicevault hand-rolled `"failures:until"` + AppLock's copy | lib-lock `PersistedLockout(kv, key)` (same stored format) |
| Hashed secrets | voicevault unlock-code hashing (`PinHasher` + `CodeState`) + AppLock's PIN storage | lib-lock `StoredSecret(secure, key, kind)` + `SecretKind.PIN` / `SecretKind.passphrase(normalize)`; `SecretState` Present/Missing/Error |
| Keystore file store | voicevault `vault/VaultStore.kt` (crypto half) | axf-platform-android `KeystoreFileStore` + `KeystoreFileUnreadable` (VaultStore keeps only the JSON) |
| Sensitive clipboard | voicevault `vault/SecretClipboard.kt` | axf-platform-android `SensitiveClipboard(context, scope, tagKey)` |
| Secure window | `window.setFlags(FLAG_SECURE…)` in both MainActivities; `WebView.setWebContentsDebuggingEnabled(false)` in axhub `App` | manifest `android.secureWindow: true` → `AxfActivity.secureWindow` (FLAG_SECURE before the first frame + WebView debugging off) and `AxfApplication` (WebView debugging off for the process); Kotlin `AndroidManifestInfo.secureWindow` |
| Backup exclusions | axhub's own `app_webview/` rule | android-compose template + voicevault `backup_rules.xml` / `data_extraction_rules.xml` |
| Spoken text | voicevault `vault/SpokenText.kt` | lib-voice `SpokenText` (+ `SpokenTextTest`) |
| Settings view | axhub `SettingsView` (AxfPageHead + SettingsScreen, a double heading) + voicevault `SettingsView` | lib-settings registers `settings` (`AxfUiPoints.VIEWS`) |
| About action | hand-written `help.about` in both apps and the template | lib-settings default `help.about` from the manifest (`<name> <version> on AmberX AXF <fw>.` + `app.about`); apps' own still win |
| Service lookup | `remember(kernel) { kernel?.services?.get<T>() }` | axf-ui `rememberService<T>()` |

## Who uses it now
- **AXHub** (`apps/axhub-android`): `lockGate` + `Gated` via `viewGuard`, `HubReset` (sign out on the hub and phone, then lock off), lock-mode guard (new for AXHub), secure window from the manifest, settings/About from lib-settings, `rememberService<PermissionGateway>()`, nav asset `axhub-nav` (was `blank-nav`).
- **Voice Vault** (`apps/voicevault`): `VaultSession.gate` (`firstStep = true`, idle from its own setting), `PersistedLockout`, `StoredSecret` passphrase, `SensitiveClipboard` (same tag key), `KeystoreFileStore` (same `vault.bin` + alias `voicevault.vault.v1`, so existing vaults open), `SpokenText`, `Gated(…, UnlockElsewhere("home", "Go to Voice"))` via `viewGuard` on every view but Voice, secure window, settings/About from lib-settings.
- **Console (Android)**: `rememberRepo()` = `rememberService<ConsoleRepo>()`.
- **Framework libs**: `SettingsScreen`, `VoiceTriggersScreen`, `PinSetupScreen` use `rememberService`.
- **Template** android-compose: no hand-registered settings view or About; backup rules exclude `app_webview/`.
- **Boilerplate** `voice`: libraries voice + lock, screens Voice / Saved items / Voice triggers / Settings, features `c.voice`, `u.bio` (dropped `c.pilot`: Voice Vault has no screen control), status `built`.

## Deleted
`apps/axhub-android/.../views/LockGate.kt`, `AppLockGate` (in AppModule.kt), axhub `SettingsView`, both apps' `help.about`, voicevault `vault/SecretClipboard.kt`, `vault/SpokenText.kt`, `views/SettingsView.kt`, `UnlockedOnly`, `rememberSession`/`rememberVoice`, `guardLockMode`, the crypto half of `VaultStore`, both hand-set FLAG_SECURE lines, axhub's `WebView.setWebContentsDebuggingEnabled` line.

## Contracts / fixtures
No cross-port engine changed, so no fixtures (gen-fixtures leaves `spec/fixtures` unchanged). New Android-only contracts:
`AxfUiPoints.VIEWS` (`axf.views`, `ViewContribution`; the web port already has `AxfWebLibrary.views`), manifest
`android.secureWindow` and `app.about` (plain JSON keys; the web `AxfManifest` type has no `android` block, so nothing
to mirror there), `LockModule(context, wording, defaultMode)` (**signature change**: the Application is now the first
parameter; `library.json` install line is `LockModule(this)`).

### Why the secure window is a manifest option, not a build option
`framework/schemas/build-options.json` options each write an **asset token** that both ports' engines read (e.g.
`wrapGroups` → `--fx-wrap-groups`). FLAG_SECURE is not visual and has no web meaning: it's a property of the Android
window and the process (WebView debugging). Putting it in a theme asset would let a theme swap or a roll turn a
security flag off. So it's an app option in `axf.manifest.json` → `android.secureWindow` (read by the kernel's
`AndroidManifestInfo`), overridable in code (`AxfActivity.secureWindow`).

## Guards kept or tightened
- **Fails closed** everywhere: no lock service → gate never opens by itself and locks at once on leaving; storage read error is `SecretState.Error`, never "missing"; no activity for the sheet / no PIN → stays locked with a note.
- **Stricter where the copies differed:**
  - AXHub only checked the delay on return; Voice Vault also locked on a timer while away. The gate does both for both apps (AXHub now drops to locked even if never reopened).
  - AXHub had no lock-mode guard; it has Voice Vault's now. The guard also stops a possible revert loop (the write-back is accepted once without re-checking).
  - AXHub's return check skipped a leave at time 0 (`leftAt > 0`); the gate uses an away flag (a unit test caught this).
  - Voice Vault's "Nothing more" still needs the voice code (`firstStep`); AXHub's "Nothing more" opens only once settings have loaded (`ready`).
  - Library views (settings, lock-pin) now go through the app's `viewGuard`, so a view a library adds later can't skip the lock (before, each app had to remember to wrap it).
- Kept as-is: lockout timing (5 free, 30 s doubling, max 15 min) and its stored format; PBKDF2 120k / 16-byte salt / constant-time compare; first 3 distinct heard alternatives only; empty codes never match; sensitive clip flag + tag check; zeroed plaintext buffers; erase deletes the key; vault never in backups; AXHub reset ends the hub session before turning the lock off.
- `AppLock.modeProblem` with no `context` refuses a fingerprint pick (`LockModule()` without the Application can't check the sensor).

## Tests before → after
| Suite | Before | After |
|---|---|---|
| `:lib-lock:testDebugUnitTest` (CI) | 2 | 18 (LockGateTest 10, LockGuardsTest 6, PinHasherTest 2) — run locally with kotlinc: 18/18 |
| `:lib-voice:testDebugUnitTest` (CI) | 4 | 7 (SpokenTextTest 3 run locally: 3/3) |
| `axf validate --framework`, `tracker --check`, `plugins --check`, `project validate --all` (6), `check-theme` | pass | pass |
| `axf validate apps/axhub-android|voicevault|console` | pass | pass |
| `gen-fixtures` | clean | clean |
| `axf init --template android-compose --boilerplate voice` | n/a | passes validation, installs VoiceModule + LockModule(this) |

## Visible changes
No new screens. AXHub's Settings lost a duplicated "Settings" heading; locked-card texts are the same; About toasts now
include the app version. Android screenshots are captured by CI when the branch is pushed.

## Left for later
- `axf.lock.keybound`: `KeystoreFileStore(configureKey = { setUserAuthenticationRequired(true) … })` + `decryptCipher()` in a BiometricPrompt `CryptoObject`.
- System-scheduled clipboard clear (if the app is killed before the timer).
- `apps/console` still registers its own `settings` view (harmless: the app's entry wins) and `LibrariesView` still hand-rolls `BuildEngineClient` lookup (left alone: the catalog-driven LibrariesView group touches that file).
- `applyBoilerplate`'s MainActivity rewrite targets `AppShell(views = mapOf("home" to { HomeView() }))`, which the android-compose template no longer contains, so boilerplate screens aren't wired into the activity (pre-existing; not changed here).
- Web port: `AxfManifest` has no `android` block; add `app.about` to a web default About if wanted.

## Build Pilot adoption (read-only here)
Build Pilot doesn't reference lib-lock or these classes today. When its Android stack generates apps:
1. Emit `LockModule(this, …)` (Application first) when lib-lock is picked; `axf install lock` already writes that.
2. Don't generate a `settings` view or a `help.about` handler; set `app.about` in `axf.manifest.json` instead.
3. For apps holding secrets, set `android.secureWindow: true` in the manifest (no code).
4. Locked apps: `lockGate(...)` in the app module and `AppShell(viewGuard = { _, c -> Gated(gate) { c() } })`.
5. Generated views should use `rememberService<T>()`.
