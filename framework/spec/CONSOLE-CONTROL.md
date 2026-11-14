# CONSOLE-CONTROL — console-control@1, one address and ten verbs for everything the console shows

Status: contract since Nov 13 2026 (build `full-api-and-voice-control-of-the-entire-console-every-tab-screen-setting-bu`, Fable).
Reference: `framework/core/engines/console-control-rules.mjs` (pure: the grammar, the verbs, the wire codes, the JSON Schema; shared by
the build engine, the console server and the CLI) and `framework/core/engines/console-control.ts` (parse, format, validate, resolve,
scroll maths). Snapshot: `framework/schemas/console-control.json` (`check-console-control.mts` keeps it equal); JSON Schemas
`framework/schemas/json/console-control*.schema.json` (`axf schemas`). Fixture: `framework/spec/fixtures/console-control.json`.
Kotlin twin deferred (Android on hold, PORTING.md). Target registry on the web: `framework/react/controlTargets.ts`; scroll:
`framework/react/scrollControl.ts`.

## Why

Brett (Nov 13 2026): "full API and voice control of the entire console: every tab, screen, setting, button, function and plugin
(incl. enable / disable plugins); scroll up / down; bring any row or step of any table or grid into focus; search screens and
everything loaded and pull it into focus." control@1 (CONTROL.md) already opens screens, settings tabs and dialogs and runs
registered actions by name. What it can't do is name *one thing on a screen*: the third tab of a tab row, the Save button on a
card, one row of a grid, one step of a build, the scroll position of the pane under the pointer. console-control@1 adds that:
**one address grammar** that names any piece of UI, and **ten verbs** that read or drive it. Every transport (REST, MCP, CLI,
AmberX voice) carries the same command; the open console answers it from its target registry (what is on the page right now).

It rides on control@1's console domain: the command is delivered to the open console the same way (`console.actions run
console-control:<json>`, mailbox, `recent` / `all` / client id, acks), gated by the same permissions, and a console reports its
targets as catalog items of kind `target` next to its screens, settings and fields, so `console_list` and `console_open` find
them too. A REST / MCP / CLI call never fails because the UI is missing: `not_found` names the nearest addresses it does know.

## The address

An address is a path of `kind:id` segments separated by `/`, outermost first:

```
view:builds
view:builds/tab:pipeline
view:builds/tab:pipeline/grid:queue/row:full-api-and-voice-control
view:builds/tab:pipeline/grid:queue/row:full-api-and-voice-control/step:s3
view:settings/tab:plugins/subtab:skins/setting:axf.skins.active
view:settings/tab:appearance/button:restore-defaults
plugin:skins
view:plan-studio/function:plan-studio.focus
```

| Kind | What it names | `id` |
|---|---|---|
| `view` | a screen (a view the shell renders, a plugin's tab page) | the view id (`builds`, `settings`, `plan-studio`) |
| `tab` | a row of tabs, or one tab of it: `tab:<row>` is the row, `tab:<row>=<value>` one tab | the TabGroup's settings id, with `=<tab value>` for one tab |
| `subtab` | a tab row nested in a tab (Settings → Plugins → Skins: `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=skins`); the framework TabGroup picks `subtab` by itself when it renders inside another tab's panel | the same as `tab` |
| `setting` | one setting with a value (toggle, text, number, choice, …) | the settings key (`axf.display.fontScale`) |
| `button` | a button, icon button or menu item that does one thing | the button's id, else its label slug (`save`, `restore-defaults`) |
| `function` | a registered action, with or without an argument | the action id (`plan-studio.focus`, `settings.open`) |
| `plugin` | an installed plugin | the plugin id (its folder name is never used) |
| `grid` | a table or grid, or a list of steps | the grid's id (`queue`, `shipped`) |
| `row` | one row of the grid above it | the row id the grid gives it |
| `step` | one step of a build (or of any row that has steps) | the step id (`s3`) |
| `panel` | a titled card / section / settings group or panel | the anchor id (`settings-group:axf.display`) |
| `scroll` | a scroll container by name (the main pane is `scroll:main`) | the container's id |

Rules:

- A segment is `kind:id`; `kind` is one of the twelve above (`CONSOLE_CONTROL_KINDS`, append-only); `id` is 1 to 160 characters,
  any character but `/` (a `/` inside an id is written `%2F`, a literal `%` as `%25`; `formatAddress` encodes, `parseAddress` decodes).
- Order is outermost first and each kind may follow only its parents (`CONSOLE_CONTROL_PARENTS`): `row` under `grid`, `step` under
  `row` or `grid`, `grid` also under `row` (a grid inside a row's detail), `subtab` under `tab` (or a deeper `subtab`), everything else under `view` or at the top. The reference parser refuses the wrong order
  with `invalid`, naming the segment.
- An address need not be complete: `button:save` alone means "the Save button on the screen that is open"; `row:<id>` alone means
  "that row in any grid on this screen". The resolver matches the trailing segments against the registry, so a voice command can
  say the short form and a script the full form, and both land on the same target. A short form that matches more than one target
  answers `ambiguous` with every candidate's full address.
- Text form: the path above. Object form: `{ path: [{ kind, id }, …] }`. `parseAddress(text)` and `formatAddress(parts)` are inverse
  on every fixture row. Case: kinds are lower case; ids keep their case but match case-insensitively.
- A tab is `tab:<row>=<value>`: `open` on it switches the row to that tab; `state` on `tab:<row>` reads the current value and the
  tabs. The `=` form is the only id with structure; everything else is opaque.
- Words: `search` takes free text, not an address. Everything else takes an address (or `null` for the current screen / the
  active scroll container).

## The command

```json
{ "$axf": "console-control@1", "verb": "focus", "address": "view:builds/tab:pipeline/grid:queue/row:full-api-and-voice-control/step:s3",
  "by": "claude", "reason": "show Brett the running step" }
```

| Field | Meaning |
|---|---|
| `verb` | one of the ten below |
| `address` | the target (text or object form); `search` leaves it out; `scroll` and `state` may leave it out (the screen / container in front) |
| `value` | `set`: the new value (`true`/`false`/`"toggle"` for a toggle, a number, a choice value, text, a list) · `press`: the argument of a function that takes one |
| `scroll` | `scroll`: `{ dir: up \| down \| page-up \| page-down \| top \| bottom \| to, amount?: number (px, or a fraction ≤ 1 of the viewport), to?: address }` |
| `query` | `search`: the words; `kinds?` narrows to kinds; `limit?` (default 12, max 50) |
| `options` | `focus`: `{ select?: boolean (default true), expand?: boolean, highlightMs?: number (default 1800) }` · `open`: `{ highlight?: boolean }` |
| `by`, `reason` | who and why; audited on every verb that changes anything |

### Verbs

| Verb | Effect | What it does | Answer |
|---|---|---|---|
| `open` | navigate | brings the target onto the screen: navigates to the view, switches the tab / sub-tab, opens the settings tab scrolled to the setting or panel, expands the row, flashes it | `{ opened: <full address>, view }` |
| `state` | read | reads the target: a view's title and which tabs it has, a tab row's value and tabs, a setting's value / type / options / min / max, a button's label / disabled / busy, a plugin's enabled / health, a grid's row count and selection, a row's fields and expanded, a step's status, a scroll container's position and extent (`ScrollState`) | `{ state }` |
| `press` | write | presses a button, runs a function (with `value` as its argument), toggles a tab's close / fold button named as a button | `{ pressed, result? }` |
| `set` | write | sets a setting's value; the setting's own rules apply (`requires`, range, choices; `consoleFieldValue` parsing); sets a tab row to a tab value; sets a grid's selection to a row id | `{ changed: [address], value }` |
| `scroll` | navigate | scrolls the named container (or the active one): `up` / `down` by `amount` (default one third of the viewport), `page-up` / `page-down` by one viewport less one line, `top`, `bottom`, `to` an address inside it | `{ scroll: ScrollState }` |
| `focus` | navigate | the row / step / setting / button is scrolled into view (centre), selected if the grid supports it, expanded when `expand`, highlighted through theme tokens for `highlightMs`, and given keyboard focus; works on virtualised rows (the grid is told to materialise the row first) | `{ focused: <full address>, scroll: ScrollState }` |
| `search` | read | searches the console's search index and every registered target (labels, keywords, the addresses themselves) and answers ranked hits with their addresses, so the next command can `focus` or `open` one | `{ hits: [{ address, kind, label, detail?, score }] }` |
| `plugin.enable` | write | turns a plugin on (the Plugin Manager's own enable path, so its install hook runs) | `{ plugin, enabled: true }` |
| `plugin.disable` | write | turns a plugin off; a plugin that cannot be disabled (a core one, one another plugin needs) answers `invalid` naming why | `{ plugin, enabled: false }` |
| `list` | read | every target on the screen in front (or under an address): full address, kind, label, keywords; what `search` searches | `{ targets: [...] }` |

Effects are control@1's: `read` and `navigate` need `control.console.read` / `control.console.navigate`; `press` and `set` are
`control.console.write` (plus whatever the button or setting itself `requires`); `plugin.*` is `control.plugins.write`. No verb is
destructive by itself: a button that deletes carries its own `confirm` and the gate asks for the confirm token (CONTROL.md
→ Deletes need confirm), the same two-step flow.

### The target registry

The open console keeps a registry of **targets**: everything rendered right now that has an address. A target is

```json
{ "address": "view:builds/tab:pipeline/grid:queue/row:abc", "kind": "row", "label": "Full API and voice control", "keywords": ["fable", "running"],
  "requires": "builds.read", "can": ["open", "state", "focus", "set"], "parent": "view:builds/tab:pipeline/grid:queue" }
```

`can` lists the verbs it answers. Views register through the shell, TabGroup rows register themselves and every tab, Button
registers from its `id` / label, settings rows register from their key, DataGrid registers every row (and tells the registry how to
materialise a virtualised one), the build step list registers every step, plugins register from the Plugin Manager's list. A
plugin never writes per-view code for this: it gets addresses from the framework controls it already uses. Only a bespoke control
needs `useControlTarget` (or the `data-axf-target="<address>"` attribute, which the registry picks up from the DOM and resolves with
`press` = click, `state` = text / aria state, `focus` = scroll + flash).

A snapshot of the registry (`{ $axf: 'console-control-targets@1', view, targets: [...] }`) is what the engine resolves against,
what the console reports to the server (as catalog items of kind `target`), and what `list` answers.

### Scroll maths

`ScrollState` is `{ container, top, left, height, extent, atTop, atBottom, fraction }`: `height` is the visible height, `extent`
the scrollable height, `fraction` = `top / max(1, extent − height)` rounded to three places. The reference `scrollStep(state,
{dir, amount}, line)` is pure: `up` / `down` move `amount` px (a fraction ≤ 1 means that fraction of `height`; default 1/3 of it),
`page-*` move `height − line` (line = one row height, the density token), `top` → 0, `bottom` → `extent − height`; every result is
clamped to `[0, extent − height]`. Every port reproduces the fixture rows.

## Fields and buttons on any screen

Added Nov 13 2026 (build `full-voice-api-control-type-fields-press`). Brett: "the most important thing is full voice control
for API so I can build, control absolutely everything, don't even have to touch the phone at all". Registered targets cover the
framework controls that opt in. Everything else on the **surface in front** (the topmost open dialog, else the main pane, plus any
open menu or listbox) is discovered from the page by `framework/react/fieldControl.ts` and registered under the same kinds, so no
transport and no schema changes:

| On the page | Address | `set` | `press` |
|---|---|---|---|
| the open dialog | `view:<v>/panel:dialog:<dialog id>` | | |
| text, number, email, url, date, textarea, contenteditable | `<surface>/setting:field.<id>` | types the value (native setter + `input` / `change`, so React sees it) | |
| select | `…/setting:field.<id>` | picks by value, then label (exact, starts with, contains) | |
| switch, checkbox | `…/setting:field.<id>` | `on` / `off` / `toggle` (yes, true, 1, check …) | |
| radio group, ChoiceGrid | `…/setting:field.<id>` | picks one option by value or label; a multiple group takes a list or `a, b` | |
| button, icon button, menu item, tab, link button | `<surface>/button:<id>` | | clicks it |

`<surface>` is `view:<v>` or the dialog's address; `<id>` is the control's `data-axf-id`, `name` or non-generated `id`, else the
slug of its label (a repeat gets `-2`, `-3`). Labels are the accessible name (aria-label, aria-labelledby, `<label for>`, the
framework Field's label, placeholder). A registered target always wins over a discovered one at the same element or address.
`state` on a field answers `type`, `value`, `required`, `options`, `placeholder` and the field's error; a password's value is
never read back (`••••`), a file field can't be set. Elements under `data-axf-control-skip` are never discovered. The registry
re-discovers the surface before every command, so a wizard's next page is addressable the moment it renders.

### Reading the screen back

`state` with no address answers `state.report` (`ScreenReport`; `state.screen` stays the view id): `view`, `title`, `dialog { id, title, address } | null`,
`surface`, `headings`, `fields [{ address, id, label, type, value, required, disabled, options?, placeholder?, error? }]`,
`buttons [{ address, id, label, role, disabled, selected? }]` and `text` (the surface's visible text, 1200 characters at most), so
a voice assistant can say what is open and check what it typed before it presses Create.

### Decisions hands-free

A deciding press (approve, deny, reject, veto, shelve, decide, sign off: by the button's word or the inventory's `personOnly`) is
Brett's own decision. It is refused (`denied`, `requires: person`) for every caller **except Brett's own signed-in session**: a
person signed in to axHub as an admin on his browser or phone (the wall caller), never the shared console token that agents, scripts
and MCP connectors hold (`owner_of` in `server/console_control_api.py`). From that session the press runs (REST `/do`, `/fill`
submit, `/voice` "approve", "veto it", "deny"), the answer carries `decidedBy: owner:<name>` and the audit line records it, so
a veto countdown or a confirm in front of him is approved by voice with no tap. In-console voice runs in his own session too.
A claude.ai chat reaches the console through the shared token today, so it still can't decide: an owner OAuth identity on the MCP
connector is the gap (report of the build).

### Voice

`console-control-voice.mjs` (Python twin `console_control.voice_intent`) adds: "type <text> into <field>", "enter <text> in
<field>", "fill <field> with <text>" (the text keeps its case: matched on the raw words), "what's on screen" / "read the screen" /
"where am I" / "what can I press" (`{ verb: state, screen: true }`, answered with `screenLine` from `state.report`), "approve [<x>]" / "veto it" /
"deny" / "reject <x>" / "sign off" (`decision`), one-word presses (submit, next, create, save, continue, finish, done, confirm,
cancel, back, close, ok, apply, send, start, retry), and "what can I say" (`{ verb: state, help: true }`: `VOICE_HELP`, no command runs). Fixture rows in `spec/fixtures/console-control-voice.json`.

## Answers

Success: `{ $axf: 'console-control@1', ok: true, verb, address?: <full address>, …data, audit? }` with `data` per verb as in the
table; writes carry `audit { by, reason, at }`. Failure: `{ $axf, ok: false, code, message, … }` with a wire code from INTEROP.md:

| Code | When | Extra |
|---|---|---|
| `invalid` | a bad verb, a malformed address (bad kind, bad order, empty id), a field the verb does not take, a plugin that can't be disabled | `field?`, `segment?` |
| `not_found` | the address names nothing on the screen (after a short form was tried) | `nearest: [addresses]` (up to 5, by label similarity) |
| `ambiguous` | a short address matches several targets | `candidates: [addresses]` |
| `denied` | the caller lacks the permission the verb or the target needs | `requires` |
| `validation` | a value a setting refuses, an amount out of range, a `to` outside the container | every problem named |
| `unavailable` | the target is there but cannot act now (a disabled button, a busy one, a locked setting) | `because` |
| `confirmation_required` | a destructive button pressed without its confirm token | `confirm` |
| `not_implemented` | the target does not answer this verb (`can` lacks it) | `can` |
| `unexpected` | anything else |  |

`ambiguous` is new to INTEROP's list and is added there by this contract; unknown codes still read as `unexpected`.

## Transports (same command on all four)

- REST: `POST /api/console-control` with the command; `GET /api/console-control/targets?view=` lists; `GET /api/console-control/state?address=`;
  the generic `POST /api/control` with `target: console.actions, action: run, path: console-control, input: <command>` is the same call.
- MCP: `console_control {verb, address?, value?, scroll?, query?, options?}` plus the shortcuts `console_focus {address}`,
  `console_press {address, value?}`, `console_set {address, value}`, `console_scroll {dir, amount?, container?, to?}`,
  `console_search {query, kinds?}`, `console_plugin {id, enabled}`; `console_open` and `console_show` accept an address as their target.
  Read / navigate tools carry `readOnlyHint: true` (navigation never waits for a veto: CONTROL.md policy table).
- CLI: `axf console <verb> <address> [--value v] [--dir down --amount 0.5] [--query words]`, e.g. `axf console focus "grid:queue/row:abc"`,
  `axf console scroll down`, `axf console plugin.disable plugin:skins`.
- Voice (AmberX): the assistant maps "scroll down", "press save", "open the pipeline tab", "show me step three of the running
  build", "turn the skins plugin off", "find <words>" to the same commands through `console_control`; a short address is enough.

Delivery, mailbox, `recent` / `all`, acks, wake through AmberX and the `status` field are console-commands' (CONTROL.md →
Console). A console acks a console-control command with its answer envelope, so the caller gets the state it asked for.
