# Full voice and AI control of everything in the console — Phase 1 (Opus)

Build: `full-voice-and-ai-control-of-everything-in-the-console-before-the-android-app` · branch
`claude/full-voice-and-ai-control-of-everything-in-the-console-before-the-android-app` · Nov 13 2026.

## What already existed (reused, not rebuilt)

control@1 console domain (`framework/core/engines/console-commands.mjs`): screens, dialogs, settings tabs and every registered
action are reported by each open console and reachable through REST `/api/control`, MCP `console_*` / `control_*`, the CLI
`axf control …` and voice (AmberX → Amber → the same MCP tools). Plugin commands auto-expose every plugin route and web action.
Menus, toolbars, context menus and buttons all run registered actions, so they are already covered by `console.actions`.

## s1 — down to the single field

The gap was single settings: only tabs were reachable, values were not readable and nothing set one field.

- Catalog kind `field` (additive to console-catalog@1): key, tab, setting kind, current value as text, options, min / max.
  Secrets carry `secret: true` and never their value.
- `console.settings`: `act open` with a key, `field:<key>`, `<tab>/<key>` or the setting's name opens its tab scrolled to it
  (a tab of the same name still wins); `get` reads the value; `list` with `q` lists matching fields after the tabs.
- `settings.set:<key>:<value>` (settings library action, effect write): on/off/toggle, numbers in range, choices by value,
  comma lists, text with colons. The setting's own `requires` applies. The console client checks the value first, so a refused
  value comes back in the ack message, not only as a toast.
- The console re-sends its catalog shortly after any setting changes, so `get` after `set` reads the new value.
- `consoleResolveField`, `consoleFieldValue`, `CONSOLE_FIELD_TYPES` in the engine; synced into the baked copies of console-web,
  axhub-web, molly and amberx-droid (walkthrough-studio and demo get it on their next rebake).

## s2 — find by content, down to the item

- `plan-core.mjs`: `parseFind` ("jump to the plan about X, the step that mentions Y" → plan words, item words, item kind),
  `planUnits` (steps, the six lists, comments, body paragraphs), `findInPlans` (ranked hits, each with its `focus`),
  `parseFocus`.
- Server: `find` op, `GET /api/plugins/plan-studio/find?q=|plan=&item=&kind=&limit=`; CLI `plans.mjs find <words>
  [--plan] [--item] [--kind]`.
- Web: `plan-studio.focus:<focus>` opens the plan and scrolls to the item (steps and list items carry `data-plan-item`;
  comments and body fall back to their section), which stays marked (token outline) until the next find. Words that are not a
  plan id go through `find` and open the best hit.

## How each one is reached

| Feature | REST | MCP | CLI | Voice |
|---|---|---|---|---|
| Open one setting | `POST /api/control/console.settings/<key>/act/open` | `console_settings` / `control_act` | `axf control act console.settings "text size" open` | "open text size settings" → Amber → `console_settings` |
| Read one setting | `GET /api/control/console.settings/field:<key>` | `control_get` | `axf control get console.settings field:<key>` | same, through `control_get` |
| Set one setting | `POST /api/control/console.actions/settings.set/act/run` input.args | `console_action settings.set:<key>:<value>` | `axf control act console.actions settings.set run --args <key>:<value>` | "turn help mode on" → `console_action` |
| Find a plan item | `GET /api/plugins/plan-studio/find?q=…` · `/api/control/plan-studio/find` | `plan-studio_find`, `plugin_read` | `axf plan-studio find --q …` · `plans.mjs find …` | "jump to the plan about X, the step that mentions Y" → `plan-studio_find` / `console_open` |
| Open it on screen | `console.screens` act open `plan-studio` input.focus | `console_open "plan-studio <focus or words>"`, `console_show` | `axf control act console.screens plan-studio open --focus <focus>` | same |

## Tests

- `npx -y tsx framework/spec/check-console-commands.mts` — 101 checks (field catalog, resolve, get, list, values, settings.set).
- `npx -y tsx framework/spec/check-control.mts` — 369 checks (snapshot regenerated for the doc line).
- `npx -y tsx apps/console-web/plugins/plan-studio/test.mjs` — 27 checks (new: parse, find, focus, API op); `test.py` 15.
- console-web `tsc --noEmit` clean; check-theme, check-controls, plugin-commands check clean.

## Open

- UI Review shots (Plan Studio with a found step marked, desktop + phone) not taken in this session: no built console in
  reach within the step budget. The PR stays a draft until they are in UI Review.
- Builds (orchestrator) already deep-link to a build (`build:<id>`); find by content inside build steps and notes is the
  natural next step (same `findInPlans` shape over builds@1).
- Kotlin twin of the field catalog / `consoleFieldValue`: deferred (Android on hold), recorded in framework/spec/PORTING.md.
