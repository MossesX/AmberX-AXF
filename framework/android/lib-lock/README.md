# lib-lock

App lock for any AXF Android app: fingerprint/face or a PIN after whatever the app uses first, the gate that keeps
screens shut while locked, auto-lock, a persisted lockout and hashed secrets.

```kotlin
// App.kt
override fun modules() = listOf(/* … */ LockModule(this, LockWording(modeLabel = "After your voice code")), AppModule())

// AppModule.register(): a gate that starts locked and locks again after leaving (Settings → App lock delay)
gate = lockGate(ctx.service(AppLock::class), scope, ready = (context as AxfApplication).ready)

// MainActivity: every view, the app's and the libraries' (settings, lock-pin), behind the lock
override fun onStart() { super.onStart(); app.appScope.launch { app.ready.first { it }; gate.onReturn() } }
override fun onStop() { gate.onLeave(); super.onStop() }
AppShell(views = views, viewGuard = { _, content -> Gated(gate, GateWording(title = "Locked"), onReset = { wipeThenTurnLockOff() }) { content() } })
```

- **AppLock** (`axf.lock`): `mode` (none / biometric / pin, setting `axf.lock.mode`), `autoLockMinutes` (`axf.lock.autoLock`),
  `setPin(pin, current)`, `checkPin`, `biometric(activity, title)`, `authenticate(…)`, `modeProblem(mode, context)`.
- **LockGate** (pure, unit-tested): starts locked; `unlock`, `lockNow(reason)`, `onLeave`/`onReturn` (auto-lock delay; with a
  scope it also locks on a timer while away), `touch`/`checkIdle` (idle lock), `onLock { reason -> }`. **Fails closed:** no
  lock service = never opens by itself and a 0 delay. `firstStep = true` for apps whose own first step always comes first
  (Voice Vault's spoken code): then "Nothing more" never opens by itself either. `lockGate(lock, …)` builds one from AppLock.
- **Gated(gate, wording, elsewhere?, onReset?)**: the locked card. Runs the configured step in place (waits for settings,
  BiometricPrompt, `PinPrompt` with lockout), or with `UnlockElsewhere(route, label)` links to the app's own unlock screen.
  `onReset` adds "Can't unlock?" (two taps); it must remove what the lock protected before turning the lock off.
- **Lock-mode guard** (`LockModeGuard`, wired by `LockModule`): picking PIN without a saved PIN, or fingerprint without a usable
  sensor, puts Settings → App lock back to the previous choice (never weaker), warns, and opens the PIN screen for PIN.
  Pass the Application to `LockModule(context)`; without it a fingerprint pick is refused.
- **PersistedLockout(kv, key)**: a `Lockout` (5 free tries, then 30 s, 60 s, 120 s… max 15 min) saved after every change as
  `failures:lockedUntil` (the format used before, so saved lockouts carry over).
- **StoredSecret(secure, key, kind)** + **SecretKind**: a secret kept only as `pbkdf2$iterations$salt$hash` (PBKDF2-HMAC-SHA256,
  120k rounds) in the secure store. `SecretKind.PIN` (4–12 digits), `SecretKind.passphrase(normalize)` for spoken codes
  (Voice Vault: `SecretKind.passphrase(SpokenText::code)`); open for more kinds. `state()` is Present / Missing / **Error**
  (a read error is never "missing").
- Biometrics: `BIOMETRIC_STRONG` only. `AxfActivity` is a `FragmentActivity`, so `LocalContext.current.findFragmentActivity()` works.
- UI: `PinPrompt(…)`, `PinSetupScreen()` (registered as view `lock-pin`, no app wiring needed), settings group **App lock**.
- Wording is per app (`LockWording`, `GateWording`).

Not built: Keystore keys bound to the fingerprint (`axf.lock.keybound` placeholder). The lock gates the UI. Hook:
`KeystoreFileStore(configureKey = { it.setUserAuthenticationRequired(true) … })` in axf-platform-android plus its
`decryptCipher()` in a BiometricPrompt `CryptoObject`.
