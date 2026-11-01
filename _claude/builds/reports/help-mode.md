# Help mode — report (Nov 1 2026, Opus, headless VPS)

Brett: "the system is getting deep… a HELP MODE switch: when it's on, the app teaches me how to use it, with tooltips
everywhere. Off = no tooltips, no clutter." Built in the framework, so every app on AmberX has it.

Branch `claude/help-mode`, pushed to `main` (Brett's brief). Orchestrator build `help-mode` (profile Main framework,
7 Opus steps, complete). Change log `chg-20261101-12d6ac8565`.

## What it does

- **The switch:** a **?** in the menu bar of every app (lights up while on), **F1** / **Ctrl+Shift+H**, **Help → Help
  mode** (every app's Help menu also gets *Show this screen's intro* and *Show all screen intros again*), **Settings →
  About → Help mode**, and AmberX voice ("help mode on / off", "show me / hide the tooltips"). Remembered per device
  (setting `axf.help.mode`, `scope: 'device'`; lib-hubsync now never mirrors device-scope settings or Help mode's keys
  to the hub, so axHub web and AmberX keep it per device too).
- **Tooltips everywhere:** every button, menu item, toolbar button, nav item, tab, switch, checkbox, field, slider,
  header cell, link and banner is tagged with a stable help id. Desktop: hover. Phone: a small **?** badge on every
  visible control (tap it), or long-press the control (the control is not tapped). Tooltips sit beside the control,
  never over it; tap anywhere (or Escape) to close. A normal tap still works in Help mode.
- **No help yet:** a control without help shows a dashed "No help yet" tooltip with its id and lands on
  `rt.missingHelp()` (run time) and the coverage report (static).
- **What is this?** in every tooltip opens a small panel: longer text, a thing to try, a link, related screens.
- **Screen intros:** first time on a screen with Help mode on, a 2–4 step card with the part outlined (Next / Back /
  Skip, "Don't show intros again"). Steps are walkthrough@1-shaped (`{ say, target, do }`, `introToWalkthrough`), so
  Molly guide can play them.
- **Look:** theme tokens only (`.fx-help-*` in `framework/ui/axf.css`); check-theme + theme-swap green.

## How it's built

| Piece | Where |
|---|---|
| help@1 rules (ids, validators, index, intros, coverage, ratchet) — one file for both validators, the runtime, React and the CLI | `framework/core/engines/help-rules.mjs` (+ `.d.mts`), typed face `help.ts` |
| Asset type `help` (collection: every pack in force, never rolled, never a shared look slot, no Appearance pick) | `framework/schemas/asset-types.json`, `types.ts`, `validate.ts` (`collectionType`), `build-engine.mjs`, `defaults.json`, schema `help.schema.json` |
| Runtime: `helpMode` / `setHelpMode`, `helpIndex`, `addHelp`, `helpFor`, `helpIntro`, `explainHelp`; actions `help.mode`, `help.intro`, `help.intros.reset`, `help.explain`; Help menu contribution | `framework/core/runtime.ts` |
| React layer (in AppShell, both normal and page mode) + `HelpModeButton` in the menu bar | `framework/react/components/Help.tsx`, `AppShell.tsx`, `Chrome.tsx` |
| Ids from what a control does: `data-axf-action` on menu items + toolbar buttons, `data-axf-view-link` on nav items, `data-help` on approve / deny / details / Watch live / menu-row buttons | `MenuList.tsx`, `Chrome.tsx`, `AppMenu.tsx`, `WatchLive.tsx`, `libs/approvals` |
| Plugin hook: `AxfWebLibrary.help`; console plugins ship `help.json` beside `plugin.json` (plugin@1 `help`), loaded while the plugin runs, gone with it | `framework/react/library.ts`, `apps/console-web/src/plugins.ts`, `plugins/_template/help.json`, plugins README |
| Settings group | `framework/libs/settings` (About tab) |
| Coverage: scan, drafts, sync, report, `--check` ratchet | `framework/cli/help-coverage.mjs`, ratchet `framework/spec/help-coverage.json`, CI step in `android.yml` |

Help ids: `data-help` → `action:<spec>` (then `action:<base>`) → `view:<id>` (also for `nav:<id>`) → `banner:` /
`menu:` / `column:` → the label slug with counts dropped ("Approve now (3)" → `approve-now`); `<screen>/<id>` overrides
first. Lookup falls back from the action to the label, so written help for a word covers it everywhere.

## Coverage (static scan; `node framework/cli/help-coverage.mjs`)

| Scope | Controls | With help | Hand-written | Drafts | Coverage | Screen intros |
|---|---:|---:|---:|---:|---:|---:|
| Framework chrome (every app) | 111 | 111 | 111 | 0 | 100% | 3 |
| Dev Console + 47 plugins | 1140 | 1140 | 473 | 667 | 100% | 15 |
| axHub web | 163 | 163 | 163 | 0 | 100% | 7 |

- Packs: `framework.json` (283 entries, hand-written: chrome, Help mode, standard menus/actions, approvals rows, Watch
  live, banners, windows, terminal, Settings, the ~90 shared verbs), `console.json` (166 hand-written + 12 intros:
  every console screen, Builds + Steps, orchestrator, profiles, Build manager, approvals banner, UI Review +
  Screenshots + groups, Breakroom/HR, keys, systems check, push banner, codebase changes, Plan Studio), `axhub.json`
  (68 + 4 intros: approvals with who asked / Approve now / Deny / details, request page, log, Go pass, users, account,
  handoff), and a `help.json` in 44 console plugins.
- Drafts are written from the code (labels, verbs, plugin descriptions) and flagged `draft: true` (tooltip border
  dashed, "plain-English edit still to come" in the panel). Hand-edited drafts: approvals banner, orchestrator, build
  profiles, UI Review, agent swarm, terminal, AI keys, Plan Studio, push banner, systems check, codebase changes,
  Build manager (141 entries).
- Ratchet (CI fails below it): per scope percent, covered count and written count.
- Full list: `_claude/builds/reports/help-coverage.md`.

Not counted statically: controls whose label exists only at run time (live lists, counts in names). The Help layer
still names them and shows "No help yet"; `rt.missingHelp()` lists them on the page.

## Tests

- `framework/spec/check-help.mts` — 208 checks: registration (types, optional, order, collection, never rolled, not a
  look slot), fixture replay (`spec/fixtures/help.json`: slugs, ids, packs, index, resolve, intros, coverage, ratchet,
  errors), both validators agree, every shipped pack validates in both validators, apps carry the framework pack
  unchanged, intros for the main console screens, voice phrases, runtime switch / actions / Help menu / plugin packs /
  intro once + replay + reset / What is this?, `help-coverage --check`.
- `framework/spec/check-help-mode.mts` — 43 checks in jsdom on the real AppShell: off = nothing tagged or drawn; ?
  switch lights up; F1 / Ctrl+Shift+H; ids (label slug with count dropped, action, icon button, switch row); intro
  first time, Next, Got it, never again on that screen, target outlined; hover tooltip with text, not over the
  control, dismiss by tapping anywhere; No help yet + missing list; What is this? opens / closes; long-press shows
  the tooltip and leaves the control untapped; a short tap still works; phone ? badges only for visible controls,
  tapping a badge leaves the control alone; tooltip placement unit tests.
- `framework/spec/check-hubsync.mts` — +1: device-scope settings and Help mode never ride the hub mirror.
- Local run of the android.yml test block (job 1 + the console job's web/Python block): everything I touched passes,
  plus theme-swap and interface-scope (Playwright on the built console), check-theme, check-controls,
  check-plugin-pages, menu-reach, the plugin lifecycle loop (clean worktree), AmberX test (2109), four app builds
  (tsc + Vite: console-web, axhub-web, amberx-droid, walkthrough-studio).
- Fail here and on a clean `origin/main` the same way (environment, not this build): `tracker.mjs --check` and
  `plugins.mjs --check` (they read the hub's shared data under /projects), session-checkin test (Node 20 here, CI is
  22). Python tests and the Android/Kotlin jobs weren't run (no change there; CI runs them).

## Screenshots

15 shots (phone + desktop) in **UI Review → Screenshots**, group **"Help mode - Nov 1"**: Home intro, hover tooltip,
? badges on a phone, tapping a badge, What is this?, and the Builds, UI Review, Breakroom and Settings intros (sent
with `framework/cli/shot.mjs --console` from inside the console container). Shot with the console's hub source off
(the headless browser can't reach axHub), so the look is the local default.

## Also changed

- `framework/cli/rebuild-shots.mjs`: page load timeout 30 s → 120 s (a cold Vite dev server on the VPS takes longer),
  and `AXF_SHOTS_DEBUG=1` echoes the page's console errors.
- `install_steps.md` → **Part K: Help mode** (steps 32–35). `framework/spec/PORTING.md` → Help mode entry (Android
  twin deferred: Kotlin `HelpRules` replaying `help.json`, the setting + actions, a Compose help layer).
- Re-baked console-web, axhub-web, amberx-droid, walkthrough-studio. Patches paused (its baked copy untouched); demo
  keeps its old baked framework (as before).

## Known gaps

- 667 console entries are still drafts (readable, but templated). Edit them in each plugin's `help.json`; the
  `written` ratchet keeps the hand-written number from falling.
- AmberX web (amberx-droid) and Walkthrough Studio get the switch, the framework pack and "No help yet" for their own
  controls; they have no app pack yet and aren't counted scopes (add a scope to `SCOPES` in `help-coverage.mjs`).
- Not submitted to the UI Review approve/reject queue: the brief asked for Screenshots via `shot.mjs`. Brett can *Send
  to review* from the group.
- Build profile: headless, so I couldn't ask; recorded under Main framework.
