<!-- memory-chunk@1 source=_claude/memory/docs/harvest/android-security.md tokens=319 -->
## Who uses it now
- **AXHub** (`apps/axhub-android`): `lockGate` + `Gated` via `viewGuard`, `HubReset` (sign out on the hub and phone, then lock off), lock-mode guard (new for AXHub), secure window from the manifest, settings/About from lib-settings, `rememberService<PermissionGateway>()`, nav asset `axhub-nav` (was `blank-nav`).
- **Voice Vault** (`apps/voicevault`): `VaultSession.gate` (`firstStep = true`, idle from its own setting), `PersistedLockout`, `StoredSecret` passphrase, `SensitiveClipboard` (same tag key), `KeystoreFileStore` (same `vault.bin` + alias `voicevault.vault.v1`, so existing vaults open), `SpokenText`, `Gated(…, UnlockElsewhere("home", "Go to Voice"))` via `viewGuard` on every view but Voice, secure window, settings/About from lib-settings.
- **Console (Android)**: `rememberRepo()` = `rememberService<ConsoleRepo>()`.
- **Framework libs**: `SettingsScreen`, `VoiceTriggersScreen`, `PinSetupScreen` use `rememberService`.
- **Template** android-compose: no hand-registered settings view or About; backup rules exclude `app_webview/`.
- **Boilerplate** `voice`: libraries voice + lock, screens Voice / Saved items / Voice triggers / Settings, features `c.voice`, `u.bio` (dropped `c.pilot`: Voice Vault has no screen control), status `built`.
