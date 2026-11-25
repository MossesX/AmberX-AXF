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
view:plan-studio-2/function:plan-studio-2.focus
```

| Kind | What it names | `id` |
|---|---|---|
| `view` | a screen (a view the shell renders, a plugin's tab page) | the view id (`builds`, `settings`, `plan-studio-2`) |
| `tab` | a row of tabs, or one tab of it: `tab:<row>` is the row, `tab:<row>=<value>` one tab | the TabGroup's settings id, with `=<tab value>` for one tab |
| `subtab` | a tab row nested in a tab (Settings → Plugins → Skins: `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=skins`); the framework TabGroup picks `subtab` by itself when it renders inside another tab's panel | the same as `tab` |
| `setting` | one setting with a value (toggle, text, number, choice, …) | the settings key (`axf.display.fontScale`) |
| `button` | a button, icon button or menu item that does one thing | the button's id, else its label slug (`save`, `restore-defaults`) |
| `function` | a registered action, with or without an argument | the action id (`plan-studio-2.focus`, `settings.open`) |
| `plugin` | an installed plugin | the plugin id (its folder name is never used) |
| `grid` | a table or grid, or a list of steps | the grid's id (`queue`, `shipped`) |
| `row` | one row of the grid above it | the row id the grid gives it |
| `step` | one step of a build (or of any row that has steps) | the step id (`s3`) |
| `panel` | a titled card / section / settings group or panel | the anchor id (`settings-group:axf.display`) |
| `scroll` | a scroll container by name (the main pane is `scroll:main`) | the container's id |
| `toolbar` | a page toolbar (page-toolbar@1, `framework/core/engines/toolbar-actions.ts`); its buttons sit under it: `toolbar:gate.auto-lander/button:run` | the toolbar's settings id (`<scope id>[.<slot>]`: `gate`, `gate.auto-lander`; the frame toolbar is `app`) |

Rules:

- A segment is `kind:id`; `kind` is one of the thirteen above (`CONSOLE_CONTROL_KINDS`, append-only; `toolbar` appended Nov 17 2026); `id` is 1 to 160 characters,
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

### Hidden assets (hidden-assets@1)

Hiding a piece of chrome (a tab group, toolbar, banner, navigation menu, the menu bar, a widget) and bringing it back is on the
screen in three places, and each one is addressable without per-view code. A piece is `<kind>:<id>`: the kind is one the runtime
lists (`rt.hideableKinds()`), the id is the piece's chrome instance id (`app` for the chrome an app draws once; a widget's id is
`<type>:<id>`). Inside an address a `/` in the id is written `%2F`; inside a button id `:` and `/` are dots.

| Where | Address | Kind | What a verb does |
|---|---|---|---|
| The Assets menu-bar entry (every app; `installAssetsMenu`) | `button:menu.assets` | button | `press` opens the menu: Hidden items… (the count as a badge), Unhide all, Hide ▸ |
| The Assets panel (`<AssetsMenu />`) | `panel:assets-menu` | panel | `state` reads its text; `focus` scrolls to it; `data-axf-hidden-count` on the element is the count |
| ↳ Hidden items… | `panel:assets-menu/button:assets.hidden-items` | button | `press` runs `chrome.hidden` (opens the Hidden list); its label carries the count |
| ↳ Unhide all | `panel:assets-menu/button:assets.unhide-all` | button | `press` runs `chrome.unhideAll`; disabled while nothing is hidden; needs `assets.swap` |
| ↳ the visible pieces | `panel:assets-menu/grid:assets-hide` | grid | `list` under it answers one row per piece on screen that can be hidden |
| ↳ one visible piece | `…/grid:assets-hide/row:<kind>:<id>` | row | `focus` scrolls to it; `state` reads its name (`Toolbar: Page tools`) |
| ↳ its Hide button | `…/row:<kind>:<id>/button:assets.hide.<kind>.<id>` | button | `press` runs `chrome.hide:<kind>:<id>`; needs `assets.swap` |
| The Hidden list (Settings → Appearance → Hidden, dialog `axf.hidden-assets`) | `panel:hidden-assets` | panel | `state` / `focus`; `data-axf-hidden-count` is the count |
| ↳ what is hidden | `panel:hidden-assets/grid:hidden-assets` | grid | `list` answers one row per hidden piece, grouped by kind |
| ↳ one hidden piece | `…/grid:hidden-assets/row:<kind>:<id>` | row | `focus` / `state` (name, the asset it was drawn with, when and by whom it was hidden) |
| ↳ its Unhide button | `button:hidden.unhide.<kind>.<id>` | button | `press` runs `chrome.unhide:<kind>:<id>`; needs `assets.swap` |
| ↳ Unhide all | `button:hidden.unhide-all` | button | `press` runs `chrome.unhideAll` (the list asks once first: press again); needs `assets.swap` |

Short forms resolve as everywhere: `button:assets.unhide-all`, `row:toolbar:page.tools`, `button:hidden.unhide-all`. Rows exist
only while their piece is on screen (Assets panel) or hidden (Hidden list), so a `not_found` on a row means the piece is not in
that state; `nearest` names the rows that are.

Nothing here owns state. Every press ends in one of the four console actions, which call the runtime (`rt.hide`, `rt.unhide`,
`rt.unhideAll`, `rt.hidden`; the list is in the app's look document), so a caller with no console open uses the same actions
through `console.actions`, or the REST / MCP / CLI surface for hidden assets, and gets the same result:

| Action | Does |
|---|---|
| `chrome.hidden` | opens the Hidden list (the dialog `axf.hidden-assets`, else Settings → Appearance) |
| `chrome.hide:<kind>:<id>` | hides one piece in this app (everything after the kind is the id, so a widget is `chrome.hide:widget:<type>:<id>`) |
| `chrome.unhide:<kind>:<id>` | shows it again |
| `chrome.unhideAll` | shows every hidden piece again |

The menu's own rows are app-menu items (`data-axf-menu-item`): `axf-assets-hidden`, `axf-assets-unhide-all`, `axf-assets-hide`
and, in the live list under Hide ▸ (provider `axf.hideable`), `axf-assets-hide:<kind>:<id>`. They are in the search index (kind
`menu`), so `search` finds "Hidden items" and "Unhide all" and answers the action to run.

### Scroll maths

`ScrollState` is `{ container, top, left, height, extent, atTop, atBottom, fraction }`: `height` is the visible height, `extent`
the scrollable height, `fraction` = `top / max(1, extent − height)` rounded to three places. The reference `scrollStep(state,
{dir, amount}, line)` is pure: `up` / `down` move `amount` px (a fraction ≤ 1 means that fraction of `height`; default 1/3 of it),
`page-*` move `height − line` (line = one row height, the density token), `top` → 0, `bottom` → `extent − height`; every result is
clamped to `[0, extent − height]`. Every port reproduces the fixture rows.

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
- Page toolbars (page-toolbar@1, Nov 17 2026): every toolbar a page draws from a toolbar asset is `toolbar:<settings id>` and each
  of its buttons `toolbar:<settings id>/button:<id>`; `state` on the toolbar answers its look and every button (enabled, visible,
  pressed, badge, action, inMore), `press` on a button runs it through the same engine the click uses (a destructive button needs
  `confirm`). Shortcuts: REST `GET /api/console-control/toolbars[?view=]`, `GET …/toolbars/<id>`, `POST …/toolbars/<id>/press
  {button, value?, confirm?}`; MCP `console_control_toolbar {toolbar?, button?, value?, confirm?, open?, view?}`; control@1 target
  `console.toolbars` (list / get / act press | open); CLI `axf console toolbar list [--view v] | get <id> | press <id> <button> [--confirm]`;
  voice "press run now on the auto-lander toolbar", "what's on the gate rules toolbar".

Delivery, mailbox, `recent` / `all`, acks, wake through AmberX and the `status` field are console-commands' (CONTROL.md →
Console). A console acks a console-control command with its answer envelope, so the caller gets the state it asked for.
