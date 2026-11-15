# Console app: wake-word voice listener, voice approvals, every console command by voice

Build `console-app-wake-word-voice-listener` · branch `claude/console-app-wake-word-voice-listener` · PR #643.
Phase 1 (Fable): s1, s2. Phase 2 (Opus): s3 to s11.

Brett (2026-11-13 18:44): "set a listener in the console Android app; say a trigger and approve, it lists everything
needing approval one at a time and I say approve or deny, or approve all pending; change the veto timer to two hours by
voice; every custom command the console could need in wizard format with an entry, pipelines, create a new project named
Gizmo Johnson"

## What shipped

New console plugin `apps/console-web/plugins/wake-listener` (wake-listener@1). See its README for the details.

- s1: always-on wake-word listener. Several wake phrases, an off switch, a mic light on the banner. It uses the native
  bridge's on-device recognizer when the bridge offers `listener.*` tools, else the browser's.
- s2: voice catalog (every console action, plugin command, control@1 target and pipeline command) and the spoken wizard.
- s3 to s8 and s10 were covered by the s1/s2 code and ticked in phase 2:
  - s4: the wake reply.
  - s5: approvals one at a time (approve / deny / skip / what is it / approve all / deny all, confirmed by voice).
  - s6: "set the veto timer to two hours" grants a 120-minute veto pass and reads it back first.
  - s8: confirm lines.
  - s10: "create a new project named Gizmo Johnson" runs `project-wizard/run`.
- s9 (this session):
  - The **Voice commands** list in Settings → Plugins → Wake listener: searchable, with custom phrases. This is s7's
    screen, which the s1/s2 code did not have.
  - `settings.custom` and `withCustom`: custom phrases match first and `{field}` slots work.
  - `buildCatalog` makes every destructive command wait for a spoken yes.
  - REST, MCP and CLI for custom phrases, plus the `wake-listener.commands` deep link and a menu item.
  - Help entries, README, and the feature `cx.wakelistener` in catalog.json / status.json (partial).
  - Control inventory regenerated.

## API

| Reach | How |
| --- | --- |
| Deep link | `settings.open:wake-listener`, `wake-listener.open`, `wake-listener.commands` |
| REST | `/api/plugins/wake-listener`: settings, on, off, state, catalog, match, custom, custom/remove |
| MCP | `wake-listener_*`: settings, set, on, off, state, catalog, match, custom, custom-add, custom-remove, heard, approvals, wizard, cancel, toggle, open, commands |
| CLI | `listener.mjs settings | set | on | off | phrases | state | hear | match | catalog | custom`; `axf wake-listener …` |
| Voice | the catalog itself; `wake-listener.heard:<phrase>` from AmberX |

## Checks

- Passing: `test.mjs` 93/93, plugin-lifecycle, plugin-commands (7 reads · 14 commands), check-theme, check-controls,
  check-toolbars, check-chrome-assets, check-console-control, help-coverage 100%, console `tsc`.
- Failing: `console-control-parity` passes 13 of 14 cases. The 14th fails on `fetch failed`: there is no network in
  this sandbox.

## Open

- **Android twin deferred.** The `listener.*` bridge tools, the foreground service and the offline recognizer are
  recorded in `framework/spec/PORTING.md`. Until they exist, the console app's WebView has no recognizer. Everything
  works from a desktop browser and through `wake-listener.heard`.
- **"Veto timer" is the control@1 veto pass.** The hub's own 90-second hold has no console API in this repo.
- **No UI Review shots.** This headless session has no console token. The Voice commands panel and the settings tab
  need desktop and phone shots after the branch is deployed.
