# MENUS — menu-item@2, one item contract for every menu

Status: contract since Nov 10 2026 (build `molly-flagship-skin-premium-sellable-uncluttered` s1, Fable). Reference:
`framework/core/engines/menu-item-rules.mjs` (pure rules, shared by the TS engine, the build engine's validator, the control@1
target `tokens.menu` and the migration) and `framework/core/engines/appmenu.ts` (merge, place, gate, compile). Spec constants:
`framework/schemas/asset-types.json` → `menuItems` (`check-app-menu.mts` keeps the rules module equal to it). Fixture:
`framework/spec/fixtures/app-menu.json`, section `v2` (a port replays the same file). Generated JSON Schemas:
`framework/schemas/json/app-menu.schema.json`, `context-menu.schema.json` (`axf schemas`). Placement on screen is menu-fit@1
(`core/engines/menufit.ts`); this contract is about what an item *is*, shows and does.

Brett (Nov 10 2026): "Access everything, even redundantly. Context menu spot on, completely mapped. Sub menus keep the main menu
short … Choices in the app menu change instantly with status listed beside them. Live info next to entries like the little green
axHub logo, red if not. Hover explains icons."

## One item, five kinds

Every menu in every app (the application menu's drop-downs, their submenus, context-menu targets, live lists, plugins' ⋯ menus
that go through the framework) is a list of the same item. An item is one of five kinds; the kind is **derived from its shape**
(`menuItemKind`) and may be written out as `kind` for readers, in which case it must match:

| Kind | Shape | Shows | Click |
|---|---|---|---|
| `action` | `action` (none = a disabled stub) | icon, label, badge, check mark, shortcut, status slot | closes the menu, dispatches `action` |
| `submenu` | `items` (an `action` too is allowed: the row runs it, the chevron opens the list) | chevron | opens the flyout (desktop) / drills down (phone) |
| `choice` | `setting` (+ `choices`) | the **current value beside the label**; a list of choices with the picked one marked | a pick (or the switch's click) **applies at once**, no dialog |
| `separator` | `separator: true` (`spacer` = a gap) | a rule | – |
| `live-list` | `provider` | chevron; filled on open | opens the list the provider answers |

Precedence when a shape is ambiguous: `separator` › `provider` › `setting` › `items` › action. The validator refuses the
contradictions that matter (`setting` with `provider`, `items` or `checked`; `choices` without `setting`; `cycle` without
`choices`; a `kind` that doesn't match).

Fields on every item (menu-item@1, unchanged): `id` (required), `label`, `icon`, `action`, `shortcut`, `requires` (UAC), `items`,
`separator`, `spacer`, `provider`, `badge`, `checked`, `order` / `before` / `after`. New in @2:

| Field | Meaning |
|---|---|
| `kind` | the kind, written out (optional, checked) |
| `hint` | tooltip of the row and its icon: what it does. Absent: the label. **Every icon in a menu explains itself on hover** (the renderer puts `hint` on the row, the status tooltip on the status icon, "Opens a sub-menu" on the chevron, "Shortcut" on the key cap) |
| `setting` | the settings key a choice setting reads and writes (`rt.settings`) |
| `choices` | `[{ value, label, icon?, hint? }]`, 2 to 24 entries, values unique (string, number or boolean). Without it the item is a **switch** (truthy = on) |
| `cycle` | with `choices`: a click steps to the next choice (wrapping) instead of opening the list |
| `status` | a live status slot: a source string, or `{ source, icon?, tooltip?, tones?, anims? }` |

## Choice settings: change instantly, value beside the entry

A choice item compiles to its key, the current value (`value`), the label to show beside the entry (`valueLabel`: the picked
choice's label; `''` while the setting was never saved; `On` / `Off` for a switch) and its `choices`, each with `on` (is it the
current value, matched loosely on type so a saved `"14"` picks the choice `14`) and the `action` a pick runs:

```
setting.set:<key>:<value>      value = encodeURIComponent(JSON.stringify(v))     (choiceAction / parseChoiceAction)
setting.toggle:<key>           a switch
```

A `cycle` item's own `action` is `setting.set` to the next choice. The runtime registers both actions (s3): `setting.set` writes
the value through `rt.settings.set`, `setting.toggle` flips the truthy state. Nothing else happens: no dialog, no confirm; the
menu re-renders from the setting, so the value beside the entry is the truth, never a copy. A choice item never gets `checked`
(it draws its own check) and an override can't give it a different `action` (its action *is* the setting).

API parity (Brett, Nov 8 2026): the same change is `control set console.settings <key> <value>` through control@1 (REST, MCP,
CLI, voice) — a choice item is a menu face on a setting, not a second store.

## Live status slots: the little green axHub logo, red if not

`status` binds a slot on the row to a source and compiles to what to draw:

```
{ source, state, tone, anim, icon, text, tooltip }
```

Sources: `counter:<name>` (runtime counter; > 0 = on, text = the count) · `setting:<key>` (truthy = on) · `slot:<type>` (chrome
slot shown = on) · `hidden:<type>` (hidden = on) · `source:<id>` (a status source a library or plugin registers at run time:
`rt.registerMenuStatus(id, { read(): { state, text?, icon? }, subscribe(fn) })`, s3; lib-hub registers `hub`). An unregistered
`source:` reads `unknown` and is noted once (`rt.terminal`), never an error.

States and their defaults (asset-types.json → `menuItems.statusTones` / `statusDefaultAnims`; theme tokens only, never a literal
colour):

| State | Tone (`--fx-<tone>`) | Animation | Text |
|---|---|---|---|
| `on` | `success` (green) | none | On |
| `off` | `danger` (red) | none | Off |
| `busy` | `accent` | `pulse` | Working |
| `warn` | `warning` | none | Needs attention |
| `unknown` | `muted` | none | Unknown |

`tones` / `anims` on the item override a state (`{ on: 'warning' }`, `{ on: 'blink' }`; anims: `none` · `pulse` · `spin` ·
`blink`). `icon`: the item's, else the reading's own (the axHub logo), else `circle`. `tooltip` is always set: the item's
`tooltip` (else its label), a colon, the live text — so hovering the icon explains it ("axHub connection: Connected").

## Paths and per-item token overrides

Every compiled item has a stable **path**: `<root>/<menu or target>/<id>/…` — `app-menu/file/exports/json`,
`context-menu/default/copy`, a live list's entries under their provider item (`app-menu/file/recent/<id>`, its More… entry
`…/recent.more`). The path is the key for tests (`data-axf-path`), the right-click item-settings dialog (s4) and the inline-edit
build's element dialog: it is the element-token address of the row (the inline-edit contract's path for a menu item is this
path; its per-element records point here).

Overrides are **design tokens** on that path, one settings key for all of them (shared through the axHub look like every token
set, control-tokens.mjs):

```
axf.tokens.menu  =  { "<path>": { "<token>": value, … }, … }          control@1 target: tokens.menu
```

| Token | Group | Kind | Effect at compile |
|---|---|---|---|
| `label`, `icon`, `hint`, `shortcut` | behaviour | text / icon | replace the item's |
| `action` | behaviour | action spec | replaces the item's (not on a choice or live list) |
| `visible` | behaviour | boolean (default true) | `false` drops the item (and a separator) |
| `order` | behaviour | 0..1000 | re-places siblings: overridden ones by their order, the rest keep their place as a block at 100 |
| `tone`, `iconTone` | appearance | `theme` · `text` · `muted` · `accent` · `info` · `success` · `warning` · `danger` | the row's / icon's colour-theme token |
| `weight` | appearance | `theme` · `regular` · `medium` · `semibold` · `bold` | – |
| `emphasis` | appearance | `none` · `soft` · `outline` · `filled` | a soft / outlined / filled row |
| `size` | appearance | `theme` · `sm` · `md` · `lg` | the type-scale step |

Behaviour tokens change the compiled item; appearance tokens come back on it as `look` (the renderer maps them to
`data-fx-*` attributes styled by the asset tokens; s4). A default value is "as the asset says" and is never stored
(`normalizeMenuOverrides` drops it, as the look@1 and asset-customize@1 stores do). Unknown paths, tokens and values are dropped,
never an error. Helpers: `withMenuOverride(raw, path, token, value | null)`, `withoutMenuOverrides(raw, path, deep?)`,
`listMenuOverrides(raw)` → `[{ path, token, value }]` (the overrides list; the inline-edit build's reset-one-item restores only
that record). The 4 KB appearance cap applies like every token set.

## The compiled item

`compileAppMenu` / `compileProviderItems` / `compileMenuItems` (flat lists: a context-menu target) answer, per item:
`id`, `label`, `kind`, `path`, `hint?`, `icon?`, `action?`, `shortcut?`, `requires?`, `locked`, `origin`, `badge?` / `count?`,
`checked?` / `check?`, `setting?` / `value?` / `valueLabel?` / `choices?` / `cycle?`, `status?`, `look?`, `items?` / `provider?`,
and the live-list row fields (`buttons`, `detail`, `deadline`, `paused`, `expand`, `tag`, `chip`). What compiling needs from the
runtime (`AppMenuEnv`): `gate`, `counter`, `setting`, `hidden`, `providers`, and new `status(id)`, `overrides` (the raw
`axf.tokens.menu` value) and `pathRoot` (`app-menu` default, `context-menu` for context targets).

## Migration (menu-item@1 → @2)

Every @1 definition is valid @2 as it is: the fields are additive and the kind is derived, so nothing is rewritten on load.
`migrateMenuAsset(asset)` (CLI: `axf menus migrate <file>`, s4) rewrites an app-menu or context-menu asset to @2 for readers:
every item gets its explicit `kind`; a check mark bound to a setting on an item with nothing to run (`checked: setting:<k>`, no
`action`, `items` or `provider`) becomes a switch (`setting: k`) — the one place @1 data meant a choice setting; a `kind` that
contradicts the shape is corrected; `data.menuItems: 2` marks the result. It is idempotent and reports one note per change. All 17
framework starters migrate with explicit kinds only (fixture `v2.migration.starters`).

## Validation

`validateMenuItems` (core/validate.ts, build-engine.mjs, through `menuItemV2Errors` in the rules module) names every problem
with its path: unknown or contradicting `kind`, empty `hint`, `setting` with `provider` / `items` / `checked`, `choices` without
`setting`, 1 or 25+ choices, repeated or non-scalar values, empty labels, `cycle` without `choices`, a `status` whose source
isn't one of the five kinds, tones or anims for unknown states or with unknown values. The generated schemas carry the same
constraints (`menuItemV2SchemaProperties`). The fixture's `validation` cases `v2-*` pin the messages; core and CLI must agree.

## What the renderer owes (s2–s4)

- Sub-menus flip left and up to stay on screen (`data-fx-flip` = `left` · `up` · `left up`; the box grows from the corner it
  hangs off); long menus scroll inside the menu and the page is scroll-locked while any menu is open (`menuWheel`,
  `installMenuScrollLock`); keyboard: arrows wrap over every row, ArrowRight / Enter open a submenu with focus on its first row,
  ArrowLeft / Escape close it with focus back on the parent row, Escape at the root closes the menu, hover opens without moving
  focus, and a flip never moves focus (`menuKey`, `nextMenuIndex`; `check-menu-fit.mts`, `check-menu-keys.mts`). Done in s2.
- A choice row shows `valueLabel` beside the label (`.fx-menu__value`), opens its choices as radio rows (`menuitemradio`, the
  picked one checked, `choiceRows`), and a pick applies at once through `setting.set` while the menu **stays open** so the value
  beside the entry shows the change; a switch (`menuitemcheckbox`) flips on click through `setting.toggle`; a `cycle` row
  steps. Context menus get the same rows: `MenuList` compiles its raw items through `rt.compileMenuItems(items, target)`.
  Done in s3 (`check-menu-items.mts`).
- A status slot (`.fx-menu__status`) draws `icon` in `tone` (`data-fx-tone`, theme tokens) with `anim` (`data-fx-anim`: pulse /
  spin / blink from `--fx-motion`, still under reduced motion), `title` + `aria-label` = `tooltip`; sources:
  `rt.registerMenuStatus(id, source | read | reading, module?)` (a `subscribe` re-renders open menus), `rt.setMenuStatus(id,
  reading)` for pushers, `rt.menuStatus(id)`; a module's sources go with `removeAppMenuItems(module)`. lib-hub keeps `hub`
  (`useHubMenuStatus`, mounted by `useHubBannerCount`): connected = on (green), signed out / unreachable = off (red), not an
  admin = warn, checking = busy. Done in s3.
- Every icon has a tooltip: the row's icon (`hint`, else the label), the status slot (its tooltip), the key cap
  ("Shortcut: Ctrl+S"), the sub-menu chevron ("Opens a sub-menu"); the row itself carries `hint` as its title (a lock's reason
  wins). Done in s3.
- Right-click on any row (application menu, context menu, a choice's radio row opens its setting row) closes the menu and
  opens the item-settings dialog on the row's path (`react/components/MenuItemSettings.tsx`, dialog `axf.menu.item`,
  registered by AppShell): tab **Behaviour** (label, icon, hint, action, shortcut, visible, order), tab **Appearance** (text
  colour, icon colour, weight, emphasis, text size: theme tokens only). Each field is a token; typing the inherited value back
  clears it; every changed token has its own reset, **Reset this item** drops them all. Writes go through
  `rt.setMenuToken(path, token, value | null)` / `rt.resetMenuItem(path?, deep?)` into `axf.tokens.menu`, which rides the axHub
  look (an `axf.tokens.` key), so the change reaches every app and open menus re-render at once. `look` renders as
  `data-fx-tone` / `data-fx-icon-tone` / `data-fx-weight` / `data-fx-emphasis` / `data-fx-size` on the row, styled by asset tokens
  only. Done in s4 (`check-menu-settings.mts`).
- The same without the UI: actions `menu.item.settings:<path>` (opens the dialog; `console_action`, voice),
  `menu.item.set:<path>:<token>:<value>` and `menu.item.reset:<path>[:<token>]` (path URI-encoded); REST / MCP / CLI through
  control@1 `tokens.menu` (`path` = `<item path>@<token>`; the console's Token control runner writes the look document). CLI
  `axf menus migrate <asset.json> [--write]` rewrites menu-item@1 assets.

## Ports

Web is the reference. Kotlin (`AppMenuEngine.kt`) is a deferred gap (PORTING.md): derive the same kinds, resolve the same
sources, apply the same tokens from `axf.tokens.menu`; the Kotlin validator stays spec-driven and accepts the new fields.
