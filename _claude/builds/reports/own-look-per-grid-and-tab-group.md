# Own look per grid and tab group

Build `own-look-per-grid-and-tab-group` · contract `instance-look@1` · Phase 1 (Fable): design, schema, engine, storage, fixtures.

## Brett asked (Nov 16 2026, verbatim)

> Yeah, build it.

(The item: every grid and every tab group can carry its own look, picked from the skin's tokens, never a raw value.)

## What came before (read for intent, not merged)

Branch `claude/own-token-sets-for-grids-and-tab-groups` (component-tokens@1, PR #654 landed s1; the rest archived). It gave grids
and tab groups their own token families (`--fx-grid-*` 32+ tokens, `--fx-tab-*` 58+) and a per-instance override at
`axf.tokens.instances` = `{ "<family>.<instance>": { values, previous } }`. Two things it did that this build does not:

- it accepted raw CSS in an instance's values (`#ff0000`, `rgb()`, `2px`, `0.5em`), so a tab row could leave the skin;
- it exposed every one of ~100 tokens per instance, which is a token editor, not a "look".

instance-look@1 keeps the families (they are the floor and the CSS the components already read) and puts a small, skin-bound
record on top of them. The legacy per-instance values are migrated where they fit (s4) and otherwise left in place, so nothing is lost.

## Design: the per-instance look record (instance-look@1)

### Scope key: kind + settings id

| Kind | What one instance is | Settings id | Settings key |
|---|---|---|---|
| `tab-group` | one tab row (the framework `TabGroup`) | its chrome instance id (`settings.main`, `ui-review.sections`) | `axf.chrome.tab-group.<id>.look` |
| `grid` | one data grid (`lib-datagrid`, `.fx-table` hosts that give an id) | its settings id (`ui-review.items`, `builds.rows`) | `axf.chrome.grid.<id>.look` |

Scope key string: `<kind>:<id>` (`tab-group:settings.main`, `grid:ui-review.items`). Ids follow the chrome instance id rule
(`[a-z0-9][a-z0-9._:/-]{0,119}`, case kept). Kinds are an open list (`INSTANCE_LOOK_KINDS`): a new kind adds one entry
plus its family binding; nothing else names the kinds.

### The ten keys

| Key | Kind of value | Accepted values | Compiled var | Binds to (family token the CSS already reads) |
|---|---|---|---|---|
| `rowBg` | colour | colour-theme token, `transparent` | `--fx-inst-row-bg` | grid `--fx-grid-row-bg` · tabs `--fx-tab-bg` |
| `rowAltBg` | colour | colour-theme token, `transparent` | `--fx-inst-row-alt-bg` | grid `--fx-grid-row-alt-bg` · tabs (none: a tab row has no zebra) |
| `textSize` | text step | `2xs xs sm md lg xl 2xl` (typography scale) | `--fx-inst-text-size` | grid `--fx-grid-font-size`¹ · tabs `--fx-tab-font-size`¹ |
| `spacing` | space step | `2xs xs sm md lg xl 2xl 3xl 4xl` (density gap) | `--fx-inst-spacing` | grid `--fx-grid-cell-pad-x` · tabs `--fx-tab-gap` |
| `borderW` | border step | `none thin medium thick` (0 / 1× / 2× / 3× `--fx-border-w`) | `--fx-inst-border-w` | grid `--fx-grid-border-w`¹ · tabs `--fx-tab-indicator-size` |
| `borderColor` | colour | colour-theme token, `transparent` | `--fx-inst-border-color` | grid `--fx-grid-line-color` · tabs `--fx-tab-bar-border` |
| `radius` | radius step | `none sm md lg pill` | `--fx-inst-radius` | grid `--fx-grid-radius` · tabs `--fx-tab-radius-pills` and the other per-style radii |
| `hoverBg` | colour | colour-theme token, `transparent` | `--fx-inst-hover-bg` | grid `--fx-grid-hover-bg` · tabs `--fx-tab-hover-bg` |
| `selectedBg` | colour | colour-theme token, `transparent` | `--fx-inst-selected-bg` | grid `--fx-grid-selected-bg` · tabs `--fx-tab-active-bg`, `--fx-tab-pills-active-bg` |
| `selectedFg` | colour | colour-theme token | `--fx-inst-selected-fg` | grid `--fx-grid-selected-text` · tabs `--fx-tab-active-text`, `--fx-tab-pills-active-text` |

¹ new family tokens, added to component-tokens@1 in the phase that wires the CSS (they default to `inherit` / the general token, so nothing moves until set).

**Values are token refs or scaled steps, never raw px or colours.** The validator accepts exactly:

- a colour-theme token name, camel or kebab (`accentSoft`, `accent-soft`, `surface2`, `border`, `muted`, …: the `tokens` list of
  the `color-theme` type in `asset-types.json`, read from the registry, never a list in code) → `var(--fx-accent-soft)`;
  `transparent` is allowed on background keys only (rowBg, rowAltBg, hoverBg, selectedBg, borderColor), never on `selectedFg`;
- a text step → `var(--fx-type-root-<step>)` (× the app font size, so the row scales with the typography asset);
- a space step → `var(--fx-dens-gap-<step>)`;
- a border step → `0` / `var(--fx-border-w)` / `calc(var(--fx-border-w) * 2)` / `calc(var(--fx-border-w) * 3)`;
- a radius step → `0` / `var(--fx-radius-sm|md|lg)` / `999px` (the pill is a fixed shape by rule, Oct 17 2026; it is stored as the word `pill`).

Refused with a message naming the key and what it wants: any number, any px / em / rem / % / vw / vh, `#hex`, `rgb()` / `hsl()` /
`oklch()` / `color-mix()`, CSS colour names (`red`), `var(...)` written by hand, `calc(...)`, anything with `;{}<>`, unknown keys.
A refused value is never written: `normalizeInstanceLook` drops it, `instanceLookErrors` reports it, `setInstanceLookKey` throws.

### Where a value comes from (lowest → highest; child over parent)

1. **Skin tokens** — the look the skin implies for the kind: the style theme's component-tokens@1 `grid` / `tabs` maps, read
   through `lookFromFamilies(kind, styleTheme)`: only the family tokens that bind to a look key, only values that are token refs
   (a skin's raw value stays a family value and is not a look value). Plus the skin's parts for the kind (`parts['tab-group']`)
   when they name a look key. No skin value → the family's `:root` default stands (the component draws as today).
2. **App overrides** — `axf.chrome.<kind>.look`: one record for every instance of the kind in this app (lives in the app's
   app-look@1 document like every `axf.chrome.*` key, so it rides axHub and is per app by default).
3. **Instance look** — `axf.chrome.<kind>.<id>.look`: this one row or grid.

`resolve(skin, app, instance)` → `{ look, source, vars, bind }`:

- `look`: the merged record, key by key, instance over app over skin; only keys someone set;
- `source`: key → `skin` | `app` | `instance` (the dialog shows where each value comes from, like controlled settings);
- `vars`: `--fx-inst-*` for every key in `look`, compiled values only, no `var()` fallbacks;
- `bind`: the family tokens the kind's CSS reads, each set to `var(--fx-inst-*)`, only for keys in `look`. Both maps go on the
  instance's root element as inline style (what `instanceTokenVars` does today), so no stylesheet changes and the cascade stays:
  general tokens → family `:root` defaults → skin's family values → this instance.

Rules the fixtures pin down (s5): an empty instance record (and no app record) resolves to exactly the skin layer ("empty = skin");
`reset()` returns the saved settings with the instance key removed (and with `axf.tokens.instances` untouched: the legacy editor's
values are a different layer); a skin swap under an override keeps the overridden keys and lets every other key follow the new skin;
a raw value is refused and the record is left as it was.

### Storage and migration (s4)

- Keys `CHROME_INSTANCE_LOOK_KEY(kind, id)` = `axf.chrome.<kind>.<id>.look` and `CHROME_KIND_LOOK_KEY(kind)` = `axf.chrome.<kind>.look`
  in `chrome-settings-rules.mjs`; `.look` joins `CHROME_INSTANCE_PICK_SUFFIXES` so a look is never mistaken for a field override
  (`chromeOverrideList`), and `grid` becomes a look kind without becoming a chrome-settings@1 kind (grids have no settings
  interface asset yet; the kind list is the engine's own).
- Migration `migrateLegacyInstanceLooks(saved)`: every `axf.tokens.instances` entry `tabs.<id>` / `grid.<id>` whose family token
  binds to a look key AND whose value is a token ref the look accepts moves into `axf.chrome.<kind>.<id>.look`; the moved keys leave
  the legacy entry; anything that cannot be expressed (a raw colour, a shadow, a weight) stays where it is and keeps applying through
  component-tokens@1. Idempotent; returns `{ settings, moved, kept }` so the console can log what moved. Nothing is dropped.
- Skin coverage: `instance-look` is a registered asset type (so the record shape is in the one registry and a skin can ship named
  looks later); declared `skin: { by: 'reference', via: 'skin' }`: a skin reaches every instance look through the floor it sets
  (its style theme's grid / tabs maps). `check-skin-coverage` counts it covered; the fixture lists it.

### Reaching it without the UI (phase 2 wires the dialogs; the contract is fixed here)

| What | Deep link / UI | REST / MCP / CLI | Voice / console actions |
|---|---|---|---|
| One tab row's look | Tab group settings → Look → "This row's look" (dialog `axf.chrome.settings`) | control@1 target `looks.instances`, path `tab-group.<id>[.<key>]` (list / get / set / reset) | `chrome.look:tab-group:<id>:<key>:<value>`, `chrome.look-reset:tab-group:<id>` |
| One grid's look | Grid header menu → "This grid's look…" (`chrome.look-open:grid:<id>`) | path `grid.<id>[.<key>]` | same actions with `grid` |
| Every instance of a kind in the app | Settings → Appearance → Grids & tab rows | path `tab-group[.<key>]` / `grid[.<key>]` | `chrome.look:tab-group::<key>:<value>` (empty id = the app record) |
| State | the dialog shows value + source per key | `get` returns `resolve()`'s `look` + `source` | AmberX reads the same |

The four surfaces call the same engine functions (`setInstanceLookKey`, `resetInstanceLook`, `resolve`), so they cannot drift.

## Steps

- [x] s1 design notes (this section)
- [ ] s2 schema: `instance-look` in `asset-types.json` (+ skin declaration), `axf schemas`, validators refuse raw px / colours
- [ ] s3 engine `framework/core/engines/instance-look.ts` (pure)
- [ ] s4 storage keys + migration + skin-coverage hook
- [ ] s5 fixtures `framework/spec/fixtures/instance-look.json` + PORTING.md (Kotlin twin deferred)

## Open

- Wiring (phase 2): TabGroup and DataGrid apply `resolve().vars + bind`; the `--fx-grid-font-size`, `--fx-tab-font-size`,
  `--fx-grid-border-w` family tokens and their CSS reads; the settings dialog tab and the grid header entry; control@1
  `looks.instances`; the three UI Review choices for the dialog.
- The legacy per-instance token editor (component-tokens@1 "colours & style (this one)") stays until the look dialog ships; then
  it moves behind the advanced level.
- Kotlin twin: deferred (framework/spec/PORTING.md, s5).
