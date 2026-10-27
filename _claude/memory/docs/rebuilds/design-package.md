# AmberX Design Package + Behaviour theme (Opus, Oct 27 2026)

Pending `design-package` · branch `rebuild/design-package-opus` · model Opus (Fable suggested; Fable rebuild parked as
`design-package-fable`). Replaces the Appearance package (appearance-package@1, Oct 25 2026).

## What changed
- **Removed:** asset type `appearance-package`, engine `core/engines/appearancepackage.ts` (moved to
  `designpackage.ts`), `spec/check-appearance-package.mts`, its JSON schema, every `appearance-package/` folder, and the
  console's Appearance package drop-down (Settings → Appearance → Look from axHub).
- **Added:**
  - type `design-package` (design-package@1, label "AmberX Design Package"): `style-theme`, `color-theme`, `layout`,
    `behavior-theme` (asset ids), optional `extras` {slots, spacing, hidden, settings} = everything the appearance
    package held, so a saved look loses nothing.
  - type `behavior-theme` (behavior-theme@1): `motion` (speed, easing, reduced, entrance), `interaction` (hover, press,
    focus ring, cursor, long-press, double-tap, drag threshold), `windows` (dialog / pop-up / drawer open, backdrop,
    snap + grid, stack, minimize, close on backdrop / Esc), `feedback` (toast position + time, sound, vibration,
    confirm before delete, busy cursor). Compiles to root vars (`--fx-ease`, `--fx-motion`, `--fx-longpress-ms` …) and
    `data-fx-*` attributes in `ui/axf.css`. Starters: `standard` (default; changes nothing: `theme`/`asset` values
    follow the style theme and the dialog / pop-up assets), `calm`, `snappy`, `minimal-motion`, `playful`.
  - Runtime: `captureDesignPackage`, `applyDesignPackage`, `appliedDesignPackage`, `behavior()`, `confirmDelete()`,
    `feedback()`; action `design.package:<id>`. Long-press, drag start, backdrop close, Esc close and toast time now
    read the behaviour theme.
  - Settings → Appearance: **AmberX Design Package** panel on top (every package with its four themes, Apply, Save the
    current look, Restore default appearance); every other Appearance panel and group sits in one collapsible
    **Everything else** container (closed by default).
- **Migrated:** framework + console `amberx`, every app's `fresh` → design packages 2.0.0 (themes lifted out, behaviour
  `standard`, the rest in `extras`). Setting `axf.appearance.package` is read once and moved to `axf.appearance.design`.
  Old names (`applyAppearancePackage`, action `appearance.package`) stay as aliases.
- **Manifests:** framework defaults and the five web apps name `behavior-theme: standard`; all five re-baked.

## Tests
check-design-package 197 (new; replaces check-appearance-package 24) · check-settings-ui 31 · check-customize 131 ·
check-appearance 80 · check-widgets 241 · check-embed 422 · check-banner-hide 58 · check-looktokens 195 · theme +
controls checks · validate --framework (101 assets) · five apps typecheck + build · axhub-web 177, amberx-droid 160,
walkthrough 38, menu-reach 205.

## Gaps
Android twin deferred (PORTING.md). Not screenshot-verified (the console waits for axHub in the build sandbox).
Behaviour `windows.stack` / `minimize` / `snap` and `feedback.busyCursor` are stored and exposed through
`rt.behavior()` but the window manager doesn't read them yet: the Fable rebuild wires them in.
