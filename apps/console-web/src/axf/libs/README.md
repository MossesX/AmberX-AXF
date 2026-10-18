# Web libraries

Libraries for the web port (React/TypeScript), one folder each, generated from `framework/library-templates` by
`axf new-library … --ports web` or `axf port-library <slug> --to web`. Each exports `library: AxfWebLibrary`
(`framework/react/library.ts`); apps merge them with `installLibraries(runtime, [...])`.
Type-check them all: `cd framework && npm install && npm run check:libs` (what `axf compile-library` runs).

Every library with UI must conform to the theme engines and follow the naming principles in
`framework/spec/THEMING.md` (prefix `axf-<library>`). CI checks it with `node framework/cli/check-theme.mjs`.

## settings (`ai.amberx.axf.settings`)

Hand-written, schema-driven Settings page (web port of `framework/android/lib-settings`). Tabs: Appearance,
Account & security, Connections, Plugins, About. Other libraries and plugins add to any tab through their
`AxfWebLibrary`: `settings` (groups of `SettingSpec`, rendered as controls), `settingsPanels` (custom UI) or
`settingsTabs` (new tabs). The contract lives in `framework/core/settings.ts` (same shape as the Android
`SettingsGroup` / `SettingSpec`); values persist per app in localStorage, `secret` values never do.
Install it with `installLibraries(rt, [settingsLibrary, ...])`; open it with `app.settings` or `settings.open:<tab>`.

## alerts (`ai.amberx.axf.alerts`)

Developer alerts for any AXF app. Engine: `framework/core/engines/alerts.ts` (alert@1: one alert per key, repeats bump
the count, worse severity escalates, resolved alerts reopen; delivery rules per channel with per-source overrides),
mirrored by the Kotlin kernel's `AlertEngine` and the console server's `alerts.py`; all three replay
`spec/fixtures/alerts.json`. The runtime reports **diagnostics** (`rt.diagnostics`: two modules registering the same asset
id, setting key or settings tab/group/panel, and crashes), which the library turns into alerts.

The library adds the **Alerts** view (action `alerts.open`), keeps the counter `alerts.unread` that toolbar items show
with `badge: "alerts.unread"`, a **Settings → Alerts** tab (where alerts go, sources, ntfy, web push, a test) and catches
page crashes. Where alerts live is a transport: `localTransport()` (this browser, bell only) by default, or the app's own
(the Dev Console's talks to `/api/alerts`). Web push needs the service worker served as a real file:
`alertsServiceWorker()` from `./alerts/vite-plugin.mjs` + `createAlertsLibrary({ transport, serviceWorkerUrl: '/alerts-sw.js' })`.
Self-test: `npx -y tsx framework/spec/check-alerts.mts`.
