<!-- memory-chunk@1 source=_claude/memory/docs/harvest/android-security.md tokens=156 -->
## Build Pilot adoption (read-only here)
Build Pilot doesn't reference lib-lock or these classes today. When its Android stack generates apps:
1. Emit `LockModule(this, …)` (Application first) when lib-lock is picked; `axf install lock` already writes that.
2. Don't generate a `settings` view or a `help.about` handler; set `app.about` in `axf.manifest.json` instead.
3. For apps holding secrets, set `android.secureWindow: true` in the manifest (no code).
4. Locked apps: `lockGate(...)` in the app module and `AppShell(viewGuard = { _, c -> Gated(gate) { c() } })`.
5. Generated views should use `rememberService<T>()`.
