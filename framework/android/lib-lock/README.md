# lib-lock

Second-step unlock for any AXF Android app: fingerprint/face or a PIN, after whatever the app uses first.

```kotlin
override fun modules() = listOf(/* … */ LockModule(LockWording(modeLabel = "After your voice code")), AppModule())

val lock = kernel.services.get<AppLock>()!!
val result = lock.authenticate(activity, "Unlock") { previous -> /* show PinPrompt, return digits or null */ }
if (result == LockResult.Passed) …
```

- **AppLock** (`axf.lock`): `mode` (none / biometric / pin, setting `axf.lock.mode`), `autoLockMinutes` (`axf.lock.autoLock`), `setPin(pin, current)`, `checkPin`, `biometric(activity, title)`, `authenticate(…)`.
- PINs: 4–12 digits, stored only as `pbkdf2$iterations$salt$hash` (PBKDF2-HMAC-SHA256, 120k rounds) in the secure store; changing one needs the current PIN. 5 free tries, then 30 s, 60 s, 120 s… (max 15 min), persisted.
- Biometrics: `BIOMETRIC_STRONG` only. `AxfActivity` is a `FragmentActivity` (since this library), so `LocalContext.current.findFragmentActivity()` works in any AXF app.
- UI: `PinPrompt(…)` card, `PinSetupScreen()` on route `lock-pin`, settings group **App lock**.
- Wording is per app (`LockWording`).

Not built: Keystore keys bound to the fingerprint (`axf.lock.keybound` placeholder). The lock gates the UI.
