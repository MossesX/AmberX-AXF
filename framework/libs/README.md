# Web libraries

Libraries for the web port (React/TypeScript), one folder each, generated from `framework/library-templates` by
`axf new-library … --ports web` or `axf port-library <slug> --to web`. Each exports `library: AxfWebLibrary`
(`framework/react/library.ts`); apps merge them with `installLibraries(runtime, [...])`.
Type-check them all: `cd framework && npm install && npm run check:libs` (what `axf compile-library` runs).

## settings (`ai.amberx.axf.settings`)

Hand-written, schema-driven Settings page (web port of `framework/android/lib-settings`). Tabs: Appearance,
Account & security, Connections, Plugins, About. Other libraries and plugins add to any tab through their
`AxfWebLibrary`: `settings` (groups of `SettingSpec`, rendered as controls), `settingsPanels` (custom UI) or
`settingsTabs` (new tabs). The contract lives in `framework/core/settings.ts` (same shape as the Android
`SettingsGroup` / `SettingSpec`); values persist per app in localStorage, `secret` values never do.
Install it with `installLibraries(rt, [settingsLibrary, ...])`; open it with `app.settings` or `settings.open:<tab>`.
