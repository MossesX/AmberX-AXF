<!-- memory-chunk@1 source=_claude/memory/docs/harvest/android-security.md tokens=646 -->
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
