# Harvest plan — pull libraries, plugins and assets out of AXF apps (Oct 20 2026)

Brett asked (Oct 20 2026) to take every app built on AXF and contribute back to the framework. Order: the six
overlapping Fable rebuilds first (banner+widgets, plugin-manager, ai-assistant, agent-manager, lib-mcp, then Build Pilot
agents), then this harvest on Opus. PilotX, ShipX, ActiveX stay out (not AXF apps).

Decisions (Oct 20 2026):
- Shared Python server helpers go in a new package `framework/python/axf_server/` (kept apart from `axf_libs`, which
  holds kernel-registered app libraries).
- lib-hub: Opus first slice now (axHub approvals feed `GET /auth/admin/approvals.json` as defined by axHub decision #85,
  hub address rules, session state, approval/app URLs, origin-locked web view; web + Android). The full hub protocol
  contract (AXPP) stays parked for Fable.

## Ranked shortlist (from the read-only survey)

| # | Candidate (sources) | Target | Ports | Model | Effort |
|---|---|---|---|---|---|
| 1 | Unlock gate + auto-lock + `Gated{}` + lock-mode guard + persisted lockout (axhub `AppModule.kt` AppLockGate, `views/LockGate.kt`; voicevault `VaultSession` auto-lock, `guardLockMode`, code lockout) | lib-lock | Android | Opus | M |
| 2 | Wall signature + Caller (console `server/wall.py` ≈ Build Pilot `server/main.py` 86-142) | `axf_server/wall` | Python | Opus | S–M |
| 3 | Atomic private JSON (~12 copies) + safe no-redirect HTTP (6+ copies) | `axf_server/storage`, `axf_server/http` | Python | Opus | S |
| 4 | Console client + token file (BP `console()`/`console_raw()`/`console_token()`, console `current_token`) | `axf_server/console_client` | Python | Opus | S–M |
| 5 | Notification channels/builders, private lock-screen text, canPost/canFullScreen (axhub `watch/Alerts.kt`) | lib-notifications (fills `android.notifications`) | Android | Opus | M |
| 6 | Hub address + session + approvals feed (axhub `hub/HubClient.kt`, `HubState.kt` ≈ approvals-banner TS) + origin-locked WebView + hub APK download | lib-hub first slice | Android + web | Opus slice | M–L |
| 7 | Keystore AES-GCM file store (voicevault `vault/VaultStore.kt`) | axf-platform-android `KeystoreFileStore` | Android | Opus | S–M |
| 8 | Sensitive auto-clearing clipboard (voicevault `vault/SecretClipboard.kt`) | axf-platform-android | Android | Opus | S |
| 9 | Secure window (FLAG_SECURE, WebView debugging off, backup exclusions) | AxfActivity option + template rules | Android | Opus | S |
| 10 | SSE reader (3 copies) + token store/call/ApiError/TokenDialog (console, BP, 8 plugin api.ts) | `framework/core/sse.ts` + web lib `ai.amberx.axf.apiclient`; console `pluginApi()` | Web | Opus | S/M |
| 11 | GitHub REST helpers (app_ci, app_catalog, main._gh, systems-check, wizard.mjs, claude-project.mjs) | lib-github (`x.lib.github`) | Python + Node | Opus | M–L |
| 12 | Form controls Switch/Field/TextField/SelectField/ChoiceGrid/Note (BP `src/pilot/ui.tsx`, hand-rolled switches) + LibraryParamField (3 copies) | framework/react Controls (+ axf-ui) | Web (+Android) | Opus | M |
| 13 | Typed catalog models (console Android `ConsoleRepo.kt`, console-web `api.ts`, BP `contract.ts`) + catalog-driven LibrariesView | `framework/core/catalog.ts` + Kotlin `kernel.catalog` | Web + Android | Opus | M |
| 14 | Plugin package checks in Python (BP `server/plugin_install.py` ≈ `plugin-catalog.mjs`) | `axf_server/plugin_package` + shared fixture | Python | Opus | S–M |
| 15 | Deploy: wall labels + Coolify run + auto-update cron (install-console.sh ≈ BP deploy/install.sh) | `framework/deploy/` helpers + "web + FastAPI behind the wall" boilerplate | Shell | Opus | M |
| 16 | `uac-policy/hub-accounts` starter (from console-access) | `framework/assets/uac-policy/` | All | Opus | S |
| 17 | Markdown component (systems-check, ai-assistant) | framework/react | Web | Opus | S |
| 18 | Foreground polling service + boot restart (axhub `watch/ApprovalWatchService.kt`) | x.work / android.work | Android | Fable (plan) | L |

Cleanups: rename axhub `nav-menu/blank-nav` → `axhub-nav`; Build Pilot's edited `icon-rail`/`pill-tabs`/`sidebar-list`
→ `pilot-nav`; console Android LibrariesView reads the catalog; `voice` boilerplate gains lib-voice + lib-lock;
`rememberService<T>()` in axf-ui; default `settings` view + About action from lib-settings.
Deferred: VoiceDialog flow (Fable-leaning, wait for a second voice app), change-batch card (one host), console-search
toolbar starter (after widget rebuild).
