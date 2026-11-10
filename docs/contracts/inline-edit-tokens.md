# inline-edit-tokens@1 — every framework element has a token address

Status: contract since Nov 10 2026 (build `inline-element-editing-plugin-right-click-any-el`, Phase 1, Fable).
Reference: `apps/console-web/framework/tokens/element-map.mjs` (addresses), `resolve.mjs` (tokens, values, inheritance),
`overrides-store.mjs` + `overrides.schema.json` (inline-override@1, s2), `migrations/2026-11-inline-overrides.mjs` (s2),
`apps/console-web/framework/inline-edit/capture.mjs` (the right-click layer, s3), entry `apps/console-web/framework/index.mjs`.
Checks: `node apps/console-web/framework/test.mjs` (CI). Kotlin twin deferred (Android on hold, `framework/spec/PORTING.md`).

Brett (Nov 10 2026): "Right-click elements right down to the child, it opens a dialog with all the different tokens … edit
every token, notes that it overrides inheritance. A master switch in the main application settings to enable inline edit
mode. Same with navigation menus, toolbars, banners, widgets, every single thing. Part of the plugin gives a monster list
of everything changed from axHub's inheritance, reset them individually to axHub's."

This contract is the part every other piece hangs on: **one stable path per element**, a resolver that answers *every
settable token, its value and where it came from* for the element and each of its parents, and an override record that
fits the axHub look rules. The dialog, the overrides list, the master switch, the API/MCP/CLI/voice surface and the CSS
that applies the overrides are the later phases of the same build and read only what is defined here.

## 1. The path

```
path     = segment ("/" segment)*
segment  = name [":" id]        name  [a-z][a-z0-9-]*      id  [A-Za-z0-9._@-]+ with everything else percent-encoded
root     = the first segment, always with an id: <kind>:<instance>
```

Examples, as the console renders them today:

| Path | What it is |
| --- | --- |
| `app-menu:app` | the application menu bar |
| `app-menu:app/menu:assets` | the Assets menu (its bar button) |
| `app-menu:app/menu:assets/panel` | its open dropdown |
| `app-menu:app/menu:assets/panel/item:cycle` | the Cycle slot row (the `li` and its button share the path) |
| `app-menu:app/menu:assets/panel/item:cycle/submenu/item:next-color/label` | the label of a sub-menu child |
| `nav-menu:app/section:system/item:settings/item:plugins` | a nav sub item under its parent |
| `nav-menu:app/section:system/item:settings/badge` | the count badge on a nav item |
| `toolbar:app/group:edit/item:undo/icon` | the icon of a toolbar button |
| `toolbar:app/widgets:start/widget:status%2Fshipped/body:status/dot` | the dot of a status widget on the toolbar |
| `banner:app/side:right/widget:clock%2Fdigital-12h/clock` | the clock widget on the banner |
| `tab-group:settings/tab:appearance` | one tab of a tab row |
| `dialog:axf.chrome.settings/toolbar:settings-page/group:levels` | a toolbar inside a dialog (nested root → segment) |
| `view:home/card:approvals/title` | a plugin part that opted in (§1.4) |

Rules:

1. **Derived from the markup, never stored.** A path is computed from the element and its ancestors: the outermost root
   (§1.1), then one segment per addressed ancestor (§1.2, §1.3), then the element's own. Nothing is written into the DOM
   beyond the `data-axf-*` ids the components already stamp.
2. **One element, at most one segment** (a dropdown is the exception: `menu:<id>/panel`, two levels at once). An element
   with no segment of its own has **no path of its own**: a hit on it resolves to the nearest addressed ancestor
   (`addressOf(el).own === false`). This is the capture layer's "deepest child" rule: the deepest *addressed* element.
3. **The same segment twice in a row is written once.** A menu row's `li` and its `button` both say `item:<id>`; they are
   one path, and the outermost (`li`) is the element the chain highlights (`addressOf(el).element`).
4. **Structural wrappers contribute nothing** (`ELEMENT_STRUCTURAL`: `fx-menubar__item`, `fx-menu__li`, `fx-nav__sub`,
   `fx-toolbar__group`, `fx-banner__item`, …). They exist for layout; a token on them would be a token on the item.
5. **Ids are stable because the assets are.** An id is the asset's own id (menu, item, group, tab, widget key, nav item,
   section label as a slug), never an index, a label or a DOM position. Renaming an id in an asset is a breaking change
   for overrides on it, like renaming a part (THEMING.md, *Names are stable*).
6. **Nested roots are segments.** The outermost root wins; a root inside it (a toolbar in a dialog, a tab row on a screen)
   is addressed as `<kind>:<instance>` under its parent, so a parent-scope override on the dialog reaches the toolbar.

### 1.1 Roots (`ELEMENT_ROOTS`)

| kind | recognised by | instance from | asset type (tokens) |
| --- | --- | --- | --- |
| `app-menu` | `.fx-menubar` | `data-axf-menubar`, else `app` | app-menu |
| `nav-menu` | `.fx-nav` | `data-axf-nav`, else `app` | nav-menu |
| `toolbar` | `.fx-toolbar` | `data-axf-toolbar`, `data-axf-toolbar-asset`, else `app` | toolbar |
| `banner` | `.fx-banner` | `data-axf-banner`, else `app` | banner |
| `tab-group` | `.fx-tabs`, `.fx-tabgroup__bar` | `data-axf-tab-group`, else `app` | tab-group |
| `context-menu` | `.fx-ctx` | `data-axf-context`, else `app` | context-menu |
| `dialog` | `.fx-dialog` | `data-axf-dialog`, else `app` | dialog |
| `view` | `.fx-main__inner` | `data-axf-view`, else `home` | container |
| `window` | `.fx-window` | `data-axf-window`, else `app` | container |
| any | `data-axf-el-root="<kind>:<instance>"` | the attribute | none (opt-in, §1.4) |

### 1.2 Segments with an id (`ELEMENT_SEGMENTS`, `ELEMENT_CLASS_SEGMENTS`)

| attribute / class | segment | role | stamped by |
| --- | --- | --- | --- |
| `data-axf-menu-btn` | `menu:<id>` | item | Chrome (menu bar button) |
| `data-axf-menu` | `menu:<id>/panel` | group | AppMenu (dropdown) |
| `data-axf-item`, `data-axf-menu-item`, `data-axf-live-row` | `item:<id>` | item | AppMenu `li` + button + separators, MenuList `li`, live rows |
| `data-axf-row-button` | `button:<id>` | item | live row buttons |
| `data-axf-nav-section` | `section:<slug or index>` | group | NavTree, Chrome NavMenu (**new, s1**) |
| `data-axf-nav-item` | `item:<id>` | item | NavTree group + row, Chrome NavMenu (**new, s1**) |
| `data-axf-toolbar-group` | `group:<id>` | group | Chrome ToolbarGroupView (**new, s1**) |
| `data-axf-toolbtn` | `item:<id>` | item | Chrome ToolbarButton (**new, s1**) |
| `data-axf-toolbar-widget`, `data-axf-banner-item`, `data-axf-banner-more` | `widget:<key>` | item | widgets on toolbars and banners |
| `data-axf-tab` | `tab:<value>` | item | TabGroup |
| `.fx-dropdown` → `panel`, `.fx-menu__sub` → `submenu`, `.fx-nav__sheet` → `sheet`, `.fx-nav__head` → `head`, `.fx-menu__details` → `details`, `.fx-banner__more` → `more` | | group | |
| `.fx-banner__side.is-<side>` → `side:<side>`, `.fx-toolbar__widgets.is-<end>` → `widgets:<end>` | | group | |
| `.fx-widget-<type>` → `body:<type>` | | item | every widget body |

### 1.3 Parts (leaf segments, no id)

A class `fx-<block>__<part>` on a known block (`fx-menu`, `fx-nav`, `fx-toolbtn`, `fx-banner`, `fx-tab`, the widget
blocks…) is the part `<part>`, with these aliases: `.fx-icon` → `icon`, `.fx-nav__text` / `.fx-banner__name` /
`.fx-widget-logo__text` → `label`, `.fx-nav__chev` → `chevron`, `.fx-widget-status__dot` → `dot`, `.fx-menu__sep` →
`separator`. The part's **role** decides its token set (§2): `label text shortcut header title name detail hint` → *text*;
`icon chevron dot logo brand check mark` → *icon*; `badge count pop` → *badge*; `separator spacer divider resize` →
*separator*; anything else → *part*.

### 1.4 Opt-in for plugins and apps

Anything the tables don't know carries the canonical markers: `data-axf-el-root="<kind>:<instance>"` on a root and
`data-axf-el="<name>[:<id>]"` on a descendant (`<name>` alone is a part). A plugin never needs the framework to learn its
parts, and the framework never names a plugin folder. Views already count as roots (`view:<id>`), so a plugin part under
a view gets `view:<id>/<its segments>` as soon as it is marked.

## 2. The resolver: every settable token, its value, where it came from

`resolveElementTokens(path, sources)` → `{ $axf: 'inline-edit-tokens@1', path, root, chain: [node…] }`, root first, the
element last. Each node: `{ path, role, kind, instance, type, label, active, tokens: [row…] }`. Each row:

```json
{ "token": "textColor", "label": "Text colour", "group": "Colour", "kind": "color", "default": "theme",
  "value": "accent", "axHubValue": "muted", "overridden": true, "overriddenAt": "toolbar:app",
  "source":       { "layer": "inline", "key": "axf.inline.toolbar:app", "path": "toolbar:app", "scope": "parent", "by": "brett", "at": "2026-11-10T16:00:00Z", "where": "axHub · shared/settings/appearance.json · settings · axf.inline.<root>" },
  "axHubSource":  { "layer": "custom", "key": "axf.custom.toolbar", "where": "this device · …" } }
```

**The settable tokens are asset-customize@1's** (`framework/schemas/customize.json`): text colour, background, border
colour and width, font family / size / weight / spacing / case, line height, padding, item padding, gap, radius, shadow,
opacity, glass, icon set / size / colour, motion, hover, click, focus ring. Every value maps to theme tokens (colours are
colour-theme token ids, sizes are multiples of the style theme), so a theme swap restyles an edited element like
everything else and the engines stay the only thing that emits CSS. `ROLE_TOKENS` filters them by role: a **root** takes
every token its type gets; a **group** drops `location` and `width`; an **item** also drops `alignment`; **text** parts
take the Text and Colour groups; **icon** parts the Icons and Colour groups; a **badge** Text, Colour and Shape; a
**separator** `borderColor opacity padding borderWidth shadow`. A token with `types` (location, itemPadding) stays with
those asset types. Root nodes may carry **extra tokens** the host supplies (`sources.extraTokens(node)`: chrome-settings@1
instance fields as `field.<key>`, nav-style@1 fields as `nav.<path>`), each with its own `source`; they never appear on
children.

**Layers**, lowest first; the highest that names the token gives `value` and `source`; `axHubValue` / `axHubSource` are
the same with the inline layer removed (what a reset returns to):

| layer | what | where it lives |
| --- | --- | --- |
| `theme` | the token's default: "leave it to the theme" | axHub `shared/settings/appearance.json` slots (design package, colour and style theme) |
| `skin` | skin@1 `parts[type]` in force at this place | axHub `shared/settings/looks/<app>.json` |
| `custom` | asset-customize@1 `axf.custom.<type>` (shared or per asset id) | this device only (retired from the hub Nov 1 2026, still applied locally) |
| `extra` | host tokens at a root (chrome fields, nav-style) | named by the host per token |
| `inline` | inline-override@1 records (§3) | axHub `shared/settings/appearance.json` → `settings.axf.inline.<root>` |

Inside the inline layer (`inlineLayer(records, path, activeAsset)`): candidates are `item` records whose path **is** the
path and `parent` records whose path is the path **or an ancestor**; a record with `asset` applies only while that asset
is active in the root's slot. Nearest wins: a deeper path beats a shallower one; at the same path `item` beats `parent`;
at the same place the asset's own record beats the general one. `item` scope is that element only: an item-scoped text
colour on a toolbar button does not reach the icon's row (what CSS inherits visually is the dialog's note, not a token
value). `inlineUnder(records, path)` lists every record on or under a node (the "what is changed here" count).

## 3. Overrides — inline-override@1 (s2, `overrides-store.mjs`, `overrides.schema.json`)

One record per (path, scope, token[, asset]):

```json
{ "$axf": "inline-override@1", "id": "toolbar:app/group:edit/item:undo|item|textColor", "root": "toolbar:app",
  "path": "toolbar:app/group:edit/item:undo", "scope": "item", "token": "textColor", "value": "danger",
  "axHubValue": "accent", "by": "brett", "at": "2026-11-10T16:01:00Z", "reason": "undo should look dangerous",
  "asset": null, "migratedFrom": null }
```

- `scope`: `item` = this element only · `parent` = this element and everything under it.
- `axHubValue`: the value the record replaced (the resolver's `axHubValue` at the time of the set), kept on the record so
  the overrides list can show *from → to* without recomputing, and so a reset is honest about what it returns to.
- **Storage fits the axHub look rules.** Records live in the look setting `axf.inline.<root>` (one key per root:
  `axf.inline.toolbar:app`, `axf.inline.app-menu:app`…), which `isAppearanceSetting` counts (prefix `axf.inline.`,
  `core/engines/designpackage.ts`), so it rides `appearance@1 → settings` like `axf.tokens.*`: per key, last write wins,
  every developer app follows live, 4 KB per key (`APPEARANCE_SETTING_MAX_BYTES`): a set that would not fit is refused by
  name, like control-tokens. Stored compact (`{ "$axf": "inline-overrides@1", "r": { "<path>|<scope>|<token>[@asset]": { v, h, by, at, why? } } }`), expanded to records on read.
- **Resetting one item restores only that record.** `unset(path, token, scope)` deletes exactly one key of one root; the
  other records in that root's setting, the other roots, and every layer under the record are untouched. Nothing re-inherits.
- **Migration** (`migrations/2026-11-inline-overrides.mjs`): existing `axf.custom.<type>` values become `parent` records
  on `<type>:app` (per-asset values keep `asset`); chrome-settings@1 instance overrides `axf.chrome.<type>.<instance>`
  become `parent` records with token `field.<key>` on `<type>:<instance>`; `axf.tokens.*` (control@1 token sets) and
  nav-style accents are not records: they stay their own API targets and are read as layers. The migration is a dry run
  by default (it writes the new keys only when asked and clears the legacy keys only with `clearLegacy`), so nothing
  changes on the hub until the phase that compiles inline records to CSS lands.

## 4. The right-click layer (s3, `inline-edit/capture.mjs`)

- Master switch: device setting `axf.inline-edit.mode` (`INLINE_EDIT_MODE_KEY`, boolean, default off) in the main
  application settings. The layer is **attached only while it is on**; off = no listener at all, the framework's own
  context menu (Overlays.tsx) and the browser's menu behave as before.
- On: one `contextmenu` listener in the **capture phase** on `document`. It hit-tests `elementFromPoint(x, y)` (else the
  event target) and walks up to the deepest addressed element (§1 rule 2). No path (not a framework element, or inside a
  text field / `[data-axf-inline-ignore]`) → it does nothing and the event continues to the app's menu. A path →
  `preventDefault()` + `stopImmediatePropagation()`, then it emits `axf:inline-edit-open` on `document` with
  `{ path, chain, root, role, x, y, element, owners }` where `chain` is every ancestor path from the root down
  (`chainOf(path)`) and `owners` the DOM element for each. Alt + right-click always passes through to the native menu.
- Touch: a long press is **not** captured in this phase (the framework's long-press context menu keeps working); the
  dialog phase adds an "Edit element" row to that menu instead.

## 5. Reach (API, MCP, CLI, voice) — the Opus phase of this build

The contract is designed so every surface is the same command: control@1 gains a target `tokens.inline` with `path` = the
element path and the token after `#` (`toolbar:app/group:edit/item:undo#textColor`), ops `list` (filters `root`, `q`,
`token`, `by`, `scope`), `get` (= `resolveElementTokens`), `set` (value + scope + reason), `reset` (one record; a
root path without a token = every record of that root, confirm required), and `console.dialogs` act `open` on the
inline-edit dialog with `input.arg = <path>` as the deep link. The same runner serves REST `/api/control`, the MCP
`control_*` tools, `axf token inline …` and AmberX. This phase ships no transport; the PR says so.

## 6. Not covered here

Visual CSS inheritance (the dialog's note), the dialog itself, the overrides list UI, the CSS sheet that applies inline
records, and the master switch UI are the next phases. Kotlin twin: deferred (Android on hold); a Compose port would read
the same paths from its own node tree (`Modifier.semantics` test tags carry the ids) and replay `test.mjs`'s cases.
