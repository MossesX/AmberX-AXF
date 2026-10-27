# lib-onboarding

First-run permissions flow and the error/recovery state for any AXF Android app. Ported and generalised from ActiveX's
onboarding (welcome → permissions → accessibility hand-off → battery + done, and its "service stopped" screen).
Library API level 1, version 0.1.0 (`OnboardingVersion`).

```kotlin
// One spec per app: what it asks for, in order, and why.
val spec = OnboardingSpec(
    appId = "ax-notes", appName = "AX Notes",
    requests = listOf(
        PermissionRequest.microphone("Hears your notes. Audio stays on the phone."),
        PermissionRequest.overlay("Shows the note bubble over other apps."),
        PermissionRequest.accessibility(NotesAccessibilityService::class.java.name, "Reads the app you're in for context.", required = false),
        PermissionRequest.notifications("Keeps the listener running with a visible status."),
        PermissionRequest.battery("Stops Android killing the listener."),
    ),
    wording = OnboardingWording(headline = "Notes, hands-free.", intro = "…", checklistNote = "Google warns that accessibility services can read the screen. That's expected."),
)

// App.kt
override fun modules() = listOf(/* … */ OnboardingModule(spec))

// MainActivity: flow until done, then the app with a recovery banner / screen
OnboardingGate(spec) { AppShell(views = views) }

// The app's AccessibilityService reports liveness (drives "service stopped"):
override fun onServiceConnected() { ServiceHeartbeat.up(javaClass.name) }
override fun onDestroy() { ServiceHeartbeat.down(javaClass.name); super.onDestroy() }
```

- **OnboardingSpec** — `appId`, `appName`, `requests` (order = checklist order), `wording` (`OnboardingWording`, every
  string), `version` (raise it to ask again after adding a requirement), `ordered` (rows light up in turn).
- **PermissionRequest** — `microphone`, `camera`, `notifications`, `overlay`, `accessibility(serviceClass)`, `battery`
  (optional by default); `required` items block Continue/Start and are blocking in recovery.
- **OnboardingRules** (pure) — `steps`, `next`/`back`, `rows`, `canContinue`, `canFinish`, `missing`, `key`, `defaultGuide`.
- **OnboardingStore(kv)** — "done" per app as the completed spec version (`axf.onboarding.<appId>.done`).
- **OnboardingService** (`axf.onboarding`) — spec + store + observable `done`; `markDone()`, `reset()`.
- **PermissionChecker(context)** — `isGranted`, `snapshot(spec)`, `accessibilityEnabled(class)`, `settingsIntent`,
  `openSettings`, `recovery(spec, done)`.
- **RecoveryState** (pure `evaluate`) — `Ok` / `NeedsAttention(issues)` with `REVOKED` or `SERVICE_STOPPED`;
  a service never seen by `ServiceHeartbeat` is unknown, not stopped.
- **Compose** — `OnboardingFlow(spec, onDone)`, `OnboardingGate(spec) { }`, `RecoveryBanner`, `RecoveryScreen`,
  `rememberGrants`, `rememberRecoveryState`, `rememberPermissionActions`, `OnboardingStatusScreen` (route
  `onboarding-status`, linked from Settings → Setup). Tokens only (`Axf.colors/space/shapes/type`).

The library declares no permissions: the app's manifest declares what its spec asks for. The direct battery dialog needs
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` in the app's manifest; without it the general battery list opens instead. A
runtime permission denied for good opens the app's details page.

Placeholders: `axf.onboarding.special` (exact alarms, usage access…), `axf.onboarding.web`, `axf.onboarding.watchdog`.
Written without a compiler; tests: `:lib-onboarding:testDebugUnitTest` (`OnboardingRulesTest`).
