<!-- memory-chunk@1 source=_claude/memory/docs/harvest/android-security.md lines=77-83 tokens=207 -->
## Left for later
- `axf.lock.keybound`: `KeystoreFileStore(configureKey = { setUserAuthenticationRequired(true) … })` + `decryptCipher()` in a BiometricPrompt `CryptoObject`.
- System-scheduled clipboard clear (if the app is killed before the timer).
- `apps/console` still registers its own `settings` view (harmless: the app's entry wins) and `LibrariesView` still hand-rolls `BuildEngineClient` lookup (left alone: the catalog-driven LibrariesView group touches that file).
- `applyBoilerplate`'s MainActivity rewrite targets `AppShell(views = mapOf("home" to { HomeView() }))`, which the android-compose template no longer contains, so boilerplate screens aren't wired into the activity (pre-existing; not changed here).
- Web port: `AxfManifest` has no `android` block; add `app.about` to a web default About if wanted.
