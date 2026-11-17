# EDIT UI — edit-ui@1, inline-edit anything while Ctrl is held

Status: contract since Nov 17 2026 (build `edit-ui-mode-inline-edit-anything-active`, Fable phase). Brett, Nov 17 2026:
"I need a way to inline edit anything. We need an Edit UI. When Edit UI is on, it only works when I'm also holding down
Control."

Reference engine: `framework/core/engines/edit-ui.ts` (pure state machine + owner resolution) and
`framework/core/engines/edit-ui-undo.ts` (undo stack). Constants and JSON Schemas: `framework/core/engines/edit-ui-rules.mjs`
→ registry snapshot `framework/schemas/edit-ui.json`, schemas `schemas/json/edit-ui-target.schema.json`,
`edit-ui-op.schema.json`, `edit-ui-undo.schema.json` (written by `axf schemas`). Fixture: `framework/spec/fixtures/edit-ui.json`
(`gen-fixtures.mts`; check `framework/spec/check-edit-ui.mts`). Runtime: `rt.editUi` (`framework/core/runtime.ts`) with the
owner adapters in `framework/core/edit-ui-owners.ts`. Kotlin twin deferred (PORTING.md; Android on hold).

## What it is

Edit UI is a mode. Off, the app is the app. On, nothing changes either, until Ctrl is held: while Ctrl is down every
editable thing under the pointer shows its edit affordance, and a click (or Enter) opens an inline editor on it. Letting
go of Ctrl ends the mode at once: an open editor is cancelled, nothing is saved. On a phone, where there is no Ctrl, a
long-press on the thing stands in for "Ctrl + click" and the editor stays open until it is committed or cancelled.

Everything an edit saves goes through an **owner**: the place that thing's value really lives. The asset system owns
looks (tokens, asset properties, hidden chrome); a data source owns data (grid cells). The Edit UI never writes
anywhere else, so a value edited inline is the same value the Settings panel, the Skin editor, control@1, the REST
API and the CLI see, and undo re-applies through the same owner.

## The toggle

| Setting | Kind | Default | Scope | Where |
| --- | --- | --- | --- | --- |
| `axf.editUi.enabled` | toggle | `false` | user | Settings → General → Edit UI (group `axf.editUi`); address `setting:axf.editUi.enabled` |

The setting is per user and per app, never part of the look (it is not sent to axHub; the hub look has nothing to say
about who is editing). A plugin or a library cannot turn it on; only the user, through the setting, its address or the
`editui.on` / `editui.off` / `editui.toggle` actions. Turning it off while an edit is open cancels that edit (never
records) and leaves the undo stack alone.

## The gate

Four states, one engine (`edit-ui.ts`, `reduceEditUi(state, event)`):

| State | Meaning |
| --- | --- |
| `off` | the setting is off. Ctrl does nothing. Long-press does nothing. |
| `armed` | the setting is on, Ctrl is not held. The app looks and acts as normal. |
| `held` | Ctrl is down. Editable targets are highlighted; a click (or Enter) on one begins an edit. |
| `editing` | an inline editor is open on one target (`state.edit`: the target, its owner, the value before, the gate used). |

Events and transitions (anything not listed is ignored and leaves the state as it was):

| Event | From | To | Notes |
| --- | --- | --- | --- |
| `enable` | `off` | `armed` | the setting went on |
| `disable` | any | `off` | the setting went off; an open edit is cancelled (`cancelled: true` in the result), never recorded |
| `ctrl-down` | `armed` | `held` | `off` ignores it: Edit UI off = Ctrl does nothing |
| `ctrl-up` | `held` | `armed` | |
| `ctrl-up` | `editing` (gate `ctrl`) | `armed` | the open edit is cancelled, never recorded (Brett: it only works while Control is held) |
| `window-blur` | `held` / `editing` | `armed` | the window lost focus: treated as Ctrl released (keyup never arrives) |
| `long-press` `{ target }` | `armed` | `editing` (gate `touch`) | phone / touch: the press is the gate; `ctrl-up` is ignored while gate is `touch` |
| `begin` `{ target, before }` | `held` | `editing` (gate `ctrl`) | refused in `off` / `armed` (`not-held`), in `editing` (`busy`), or when the owner is `read-only` (its reason) |
| `commit` `{ after }` | `editing` | `held` (gate `ctrl`) / `armed` (gate `touch`) | emits one edit op; equal before/after is a no-op commit (nothing recorded) |
| `cancel` (Esc, click away) | `editing` | `held` (gate `ctrl`) / `armed` (gate `touch`) | never recorded |

The reducer is pure and returns `{ state, op?, refused?, cancelled? }`; the runtime applies the op through the owner
and records it (see Undo). The long-press threshold and the highlight are the renderer's business (`--fx-motion-*`,
`--fx-accent` outline, from assets); the engine only sees the events.

## Edit targets

A target says *what* is being edited (`edit-ui-target@1`). Five kinds; every kind is open to more fields later:

| Kind | Shape | Example |
| --- | --- | --- |
| `text` | `{ kind: 'text', id, assetType?, assetId?, path?, source?, record?, field? }` | a menu label (`assetType: 'app-menu'`, `path: 'menus.0.items.2.label'`); a record's name (`source: 'builds'`, `record: 'b1'`, `field: 'title'`) |
| `cell` | `{ kind: 'cell', source, record, field }` | one grid cell |
| `column` | `{ kind: 'column', grid, column, prop: 'label' \| 'width' \| 'order' \| 'hide' }` | a column header |
| `property` | `{ kind: 'property', assetType, assetId, instance?, prop: 'size' \| 'colour' \| 'icon' \| 'order' \| 'hide' \| 'label', path? }` | a toolbar's size, a button's colour, a tab's icon, a nav item's order, a banner hidden |
| `token` | `{ kind: 'token', slot, path, assetId? }` | one look token (`slot: 'tokens.theme'`, `path: 'accent'`) |

`id` on `text` is the element's console-control address when it has one (`button:…`, `tab:…`), so the same thing
is reached by voice and REST. Unknown kinds and unknown `prop` values are refused by `validateTarget` (never thrown).

## Owners

`resolveOwner(target, ctx)` is pure: it decides where an edit saves from the target and a context the runtime hands it
(what exists, what is writable, what is locked). The answer is `edit-ui-owner@1`: `{ kind, key?, reason? }`.

| Owner kind | What it writes | How (runtime adapter, `edit-ui-owners.ts`) |
| --- | --- | --- |
| `asset-token` | a look token: `token` targets, and `property` `size` / `colour` | control@1 token overrides: `axf.tokens.<slot>` (`withTokenOverride`), or `axf.tokens.instances` for a component instance's family tokens (`INSTANCE_TOKENS_KEY`) |
| `asset-property` | a field of an asset instance: `property` `icon` / `order` / `label`, `text` targets that come from an asset, every `column` prop (`label` / `width` / `order` / `hide`: a column lives in its grid instance, it is not chrome, so its hide is the grid's own column override `axf.grid.<grid>.columns`, not a Hidden-list entry) | the chrome instance override `axf.chrome.<kind>.<instance>` (chrome-settings@1) for chrome kinds; otherwise the asset override through the look writer (`runtime.changeLook` → app-look@1 `extras`); a swap of a whole slot stays `runtime.swap` |
| `hidden-assets` | `property` `hide` | the hide-any-asset contract (below) |
| `data` | `cell` targets, and `text` targets with a `source` | a registered data-source writer (`rt.editUi.registerDataSource(source, writer)`); without one the owner is `read-only` with `no-writer` |
| `read-only` | nothing | the refusal and its reason go back to the UI as a toast; `begin` is refused |

Refusal reasons (`EDIT_UI_REASONS`): `off`, `not-held`, `busy`, `bad-target`, `unknown-asset`, `unknown-source`,
`no-writer`, `code-text` (a string written in code, no owner), `locked` (appearance locked, `axf.lock.appearance` /
`axf.lock.hubskin`: looks come from axHub), `permission` (the role lacks `assets.swap` for look owners or the source's
own permission for data), `owner-unavailable` (the owner adapter is not registered in this app yet), `nothing-to-undo`,
`nothing-to-redo`.

Precedence inside `resolveOwner`: a bad target first; then a lock or a missing permission; then the kind table above.
A text target with both `assetType` and `source` is an asset edit (the asset is what is drawn).

## Hide / unhide shares the hide-any-asset contract

Hiding through the Edit UI is not a second way to hide. `property` targets with `prop: 'hide'` resolve to the
`hidden-assets` owner, which is the engine of build `rebuild-fresh-main-hide-any-asset` (`framework/core/engines/hidden-assets.ts`:
`hide(look, target)`, `unhide(look, target)`, `isHidden`, `listHidden`; the per-app list in app-look@1 with entries
`{ kind, id, assetRef?, hiddenAt, by }`; runtime `rt.hide` / `rt.unhide` / `rt.hidden`). An Edit UI hide writes one such
entry with `by: 'edit-ui'`; undo calls `unhide` on the same entry; the Hidden list shows it like any other hidden thing
and its Unhide works on it too. Hideable kinds are that contract's (the chrome-settings kinds plus `widget`), never a
list of this engine's own. Until that build lands the adapter is not registered and the owner answers `read-only` /
`owner-unavailable` with the build's name in the reason; nothing else changes.

## Undo

Every committed edit is one record (`edit-ui-undo@1`):

```json
{ "$axf": "edit-ui-undo@1", "id": "e-0001", "at": "2026-11-17T15:00:00.000Z", "by": "user",
  "target": { "kind": "property", "assetType": "toolbar", "assetId": "main", "prop": "size" },
  "owner": { "kind": "asset-token", "key": "axf.tokens.instances" },
  "before": 32, "after": 40 }
```

`edit-ui-undo.ts` keeps a pure stack `{ entries, cursor }` (`pushEdit`, `undo`, `redo`, `canUndo`, `canRedo`,
`EDIT_UI_UNDO_MAX` = 100; older entries fall off the bottom). `undo` returns the entry whose `before` the runtime
re-applies through `entry.owner`; `redo` re-applies `after`. A commit after an undo drops the redo tail. Nothing is
recorded for a cancel (Esc, Ctrl released, window blur, setting off) or a no-op commit. Undo and redo are the actions
`editui.undo` / `editui.redo` (Ctrl+Z / Ctrl+Shift+Z while `held`); the stack is per app and per session, not saved.

## API (every surface the same)

| What | UI | Actions / console-control | REST · MCP · CLI · voice |
| --- | --- | --- | --- |
| Toggle | Settings → General → Edit UI | `setting:axf.editUi.enabled` (`set`), `editui.on` / `editui.off` / `editui.toggle` | `/api/console-control` with that address; `console_control_set`; `axf console set setting:axf.editUi.enabled on`; "turn on edit mode" |
| State | the highlight while held | `editui.state` → `{ $axf: 'edit-ui-state@1', mode, gate, edit?, undo: { canUndo, canRedo, depth } }` | same action over each transport |
| One edit without the UI | — | `editui.set:<target-json>:<value>` (resolves the owner, applies, records; refused with the reason when read-only) | same |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z while held | `editui.undo` / `editui.redo` | same |

The Opus phase of the build wires the actions, the React gate (`useEditUi`, the `Editable` wrapper on labels, grid
cells, column headers and chrome) and the four transports; this phase ships the contract, the engines, the fixture and
`rt.editUi`.

## Expansion

New target kinds and new `prop` values are added to `EDIT_UI_TARGET_KINDS` / `EDIT_UI_PROPS` in `edit-ui-rules.mjs` and
the owner table in `resolveOwner`; new owners are new adapter kinds registered on `rt.editUi.registerOwner(kind, adapter)`.
Nothing in a target, an op or an undo entry is closed (`additionalProperties` stays open on the data parts).
