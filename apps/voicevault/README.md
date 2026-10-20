# Voice Vault

Voice-driven password vault for Android, built on **AmberX AXF 0.2.0** (`android-compose` template, `voice` boilerplate). It is the first app to define two framework libraries: **lib-voice** and **lib-lock**.

## How it works

1. **First run:** choose an unlock code — say it twice (or type it twice). Only a salted PBKDF2 hash is kept.
2. **Unlock:** open the app and say the code. Then the second step from Settings → Unlock, if any: *Voice code only*, *Voice code + fingerprint* or *Voice code + PIN*.
3. **Store:** say "store password" → "Which site?" → say it ("gmail dot com" becomes `gmail.com`) → "Say the password" → both land in editable fields → fix anything misheard → **Save**.
4. **Retrieve:** say "retrieve password" → say the site → a banner at the top shows the site name → say "confirm" or tap **Confirm** → the password is copied (marked sensitive) and cleared from the clipboard after 30 s (Settings).
5. **Triggers:** Settings → Voice → Voice triggers (also in the nav). Every command has defaults; switch them off, **Record** your own (tap what the recognizer heard) or type one. Commands: store, retrieve, confirm, cancel, lock.

## Security

- Vault = AES-256-GCM with a non-exportable Android Keystore key, in `noBackupFilesDir/vault.bin` (never in cloud backups or device transfers), written atomically.
- Entries are in memory only while unlocked; locking drops them. Locks when the app leaves the foreground (or after the delay in Settings → Unlock), after idle time (Settings → Voice Vault) and on "lock".
- Unlock code and PIN: salted PBKDF2-HMAC-SHA256 (120k rounds) in the Keystore-backed secure store. Wrong codes and PINs lock out with a doubling delay.
- Passwords and the unlock code are recognised with the **on-device** recognizer when the phone has one (Android 12+ with an offline language); otherwise the phone's speech service may use the network. Typing always works instead.
- Passwords are never spoken back, logged or shown in notes. Screens are excluded from screenshots and the recents preview (`FLAG_SECURE`).
- Settings, saved sites and triggers open only while the vault is unlocked, so the second step can't be switched off from a locked phone.
- Known limits: anyone who hears the unlock code can say it (use the fingerprint or PIN step); the fingerprint gates the app, the data key itself doesn't require it yet (`axf.lock.keybound` placeholder); listening happens only while the app is open (no always-on wake word yet).

## Build

```bash
gradle :app:assembleDebug          # needs JDK 17 + Android SDK 35; CI builds it (artifact voicevault-debug.apk)
node ../../framework/cli/axf.mjs validate .
```

| Path | Purpose |
| --- | --- |
| `app/src/main/kotlin/.../vault/VaultSession.kt` | The voice flow state machine (unlock → store / retrieve → confirm) |
| `vault/VaultStore.kt` | Encrypted vault file + Keystore key |
| `vault/SecretClipboard.kt` | Sensitive copy + auto-clear |
| `views/HomeView.kt` | Voice screen, top banner, edit form |
| `views/VaultListView.kt`, `UnlockCodeView.kt` | Saved sites, unlock code |
| `AppModule.kt` | Voice commands with default triggers, settings group, routes |
