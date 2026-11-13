# Stop the Molly guide popping up; Molly → Gizmo (Nov 13 2026)

Build `stop-the-molly-guide-from-popping-up-and-talking-every-time-the-console-loads-n`, phase 1, Opus. Branch `claude/stop-the-molly-guide-from-popping-up-and-talking-every-time-the-console-loads-n`.

## What changed
- **No auto-open (s1).** The console's guide (`apps/console-web/plugins/molly-guide`) polled kept walkthroughs and played the newest one by itself. Auto-open was on by default. Now a pure `pollDecision` (`web/walkthrough.ts`) decides each poll:
  first read after a load only learns the newest seq; auto-open is opt-in (`molly-guide.autoOpen`, default **off**, must be exactly `true`);
  even with it on, a walkthrough made before the page loaded (or without a time) never opens. So a reload, a second tab or Molly's warm Console frame can't replay one and start talking.
  The guide opens only on Help → Ask Gizmo to show me…, `gizmo.ask`, `gizmo.replay` or the Try-it sample.
- **Molly → Gizmo (s2).** The guide asks agent `gizmo` (the old `molly` add-on only as a fallback while Gizmo is off). Labels, menu, window title, settings tab, help entries, plugin.json, glossary, AmberX server messages and the AmberX walkthrough narration (script.mjs, stack.mjs, seed) name Gizmo.
  Actions `gizmo.ask` / `gizmo.replay` / `gizmo.next` / `gizmo.prev` / `gizmo.close`; the `molly.*` actions stay as hidden aliases. Folder, setting keys, tab kind and the `/api/ai/molly` route keep their names so saved settings, data and links still work.
  Fixed a stray quote in `molly-guide/hooks.mjs` that made it fail to parse (the uninstall hook).
- **Android twin (s3).** No native twin exists; AmberX on Android runs the web app, so its texts follow. The native rule is recorded as a deferred gap in `framework/spec/PORTING.md`.

## API
- Deep link: `settings.open:molly-guide` (console_open / console_show), the guide window via `gizmo.ask[:<question>]`.
- Actions (console API / MCP console actions / CLI / AmberX voice through console commands): `gizmo.ask`, `gizmo.replay`, `gizmo.next`, `gizmo.prev`, `gizmo.close` (+ `molly.*` aliases).
- Settings, readable and settable through the console settings API: `molly-guide.autoOpen`, `molly-guide.speak`, `molly-guide.runSteps`.
- REST: `POST /api/plugins/molly-guide/ask`, `GET /api/plugins/molly-guide/walkthroughs?after=<seq>`.

## Checks
- `npx tsx apps/console-web/plugins/molly-guide/test.mts` 18/18 (9 new poll cases); `python3 apps/console-web/plugins/molly-guide/test.py` 21/21 (Gizmo first, Molly fallback, neither = 503).
- `apps/amberx-droid/server/test_server.py` 172 passed. Console `tsc --noEmit` clean.
- check-theme, check-controls, check-toolbars, check-chrome-assets, `plugin-lifecycle check molly-guide`: pass.

## Not done
- No UI Review shots: the console only starts against axHub, which this sandbox can't reach. The visible change is label text and one default switched off. Shots after deploy.
- The recorded AmberX walkthrough video still says Molly until it is re-recorded (Settings → Plugins → Gizmo guide → Re-record).
