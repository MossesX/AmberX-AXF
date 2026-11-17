# Own look per grid and tab group

Build `own-look-per-grid-and-tab-group` · contract `instance-look@1` · Phase 1 (Fable): design, schema, engine, storage, fixtures · Phase 2 (Opus): wiring, dialogs, API, tests, review.

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

## Steps (phase 1, Fable: all done)

- [x] s1 design notes (this section)
- [x] s2 schema: `instance-look` in `asset-types.json` (reference via skin), `axf schemas` → `schemas/json/instance-look.schema.json` (every key an enum), both validators call `instanceLookErrors` (`core/engines/instance-look-rules.mjs`); `core/types.ts` registers the type
- [x] s3 engine `framework/core/engines/instance-look.ts` (pure): `lookFromFamilies`, `resolveInstanceLook`, `instanceLookStyle`, `setInstanceLookKey`, `writeInstanceLook`, `resetInstanceLook`, `instanceLookList`, `resolveFromSettings`
- [x] s4 `CHROME_LOOK_KINDS`, `CHROME_INSTANCE_LOOK_KEY`, `CHROME_KIND_LOOK_KEY` in chrome-settings rules (`.look` is a pick suffix, never an asset with edits); `migrateLegacyInstanceLooks` + the runtime runs it once per profile; skin-coverage `referenceErrors` / `referencedTypes` and the CI assertions in `check-skin-coverage`
- [x] s5 fixture `framework/spec/fixtures/instance-look.json` (14 resolve cases: skin only, empty = skin, partial, full, app then instance, skin swap under an override, raw values dropped, nothing; value grammar table; settings write / read / reset / list; 9 refusals; migration) + `spec/check-instance-look.mts` (797 checks, wired in `android.yml`); PORTING.md row with the Kotlin twin deferred

## Checks

`check-instance-look` (797), `check-skin-coverage` (56 types, 0 uncovered), `check-skin` (hub default / runtime scopes / axHub only), `check-skin-config`, `check-chrome-settings` (304), `check-component-tokens` (90 tokens), `check-asset-overrides`, `check-agent-card` (type order), `check-tab-group`, `check-customize`, `check-demo`, `check-brand`, `shared-assets check --all`, `check-ci-scope`; `tsc --strict` over `core/index.ts` + `core/runtime.ts` clean.

## Migration note

The migration moves a legacy per-row value only when it binds to a look key, is a token ref, and the look record does not already hold that key. A raw colour, a shadow, a weight, a px length, or a token the record already covers stays in `axf.tokens.instances` and keeps applying through component-tokens@1; the console log line says how many moved and how many were kept.

## Phase 2 (Opus): what shipped

**Result:** every framework tab row (`TabGroup`) and every framework grid (lib-datagrid `DataGrid`) draws its own look when one is
set, follows the skin when not, and can be reset to the skin with one undo, from the UI and from every API.

- **s6 TabGroup** reads `runtime.instanceLook('tab-group', id)` (skin's style-theme maps with token overrides → `axf.chrome.tab-group.look`
  → `axf.chrome.tab-group.<id>.look`) through `react/instanceLook.ts` (`useInstanceLook`): the root gets the `--fx-inst-*` vars, the bound
  `--fx-tab-*` family tokens and `data-fx-inst="<keys set>"`. `axf.css` has tab-group rules gated on `[data-fx-inst~='<key>']` that read only
  `--fx-inst-*`; an unset key falls through to the family tokens (the skin cascade). No `var()` fallbacks. New family tokens
  `tabs.fontSize`, `grid.fontSize`, `grid.borderW` (defaults `inherit` / `--fx-border-w`: nothing moves until set).
- **s7 DataGrid** the same; every grid line reads `--fx-grid-border-w`, text reads `--fx-grid-font-size`; spacing moves column gap and
  inline padding only. The column template is set after the look, so cell widths stay the columns' own (pinned in the check and the e2e).
- **s8 grid is a chrome kind** (`chrome-settings-rules`: target `grid`, header prefix `axf-grid-header:<id>`, many, no moves, one
  instance-only field Compact rows). It has no asset type of its own: `CHROME_PICK_TYPE.grid = 'instance-look'`, so **Change grid look…**
  copies a named look into the grid's record. Default `settings/chrome-grid` + per-app copies (backfill: console-web, axhub-web,
  amberx-droid, molly, expenses). **Move** is not offered on a grid: it has nowhere to move.
- **s9 Look section** (`InstanceLookPanel`): a framework `SelectField` per key offering only what the rules accept, "Skin" to drop a key,
  the source of each value, a live sample drawn with the resolved look (the instance on screen restyles as you pick), Show it, **Reset to
  skin** (danger, confirm) and **Undo reset**. Levels: `levelOf.instanceLook` and `look.<key>` in both settings assets (row, selected, text
  size, spacing at Simple; the rest at Basic). The legacy per-row token editor moved to Developer.
- **s10–s12 API** (below), **s13** re-bake, **s14** tests, **s15** review.

## How each feature is reached

| Feature | Deep link / UI | REST | MCP | CLI | Voice / console actions |
|---|---|---|---|---|---|
| Open a grid's / tab row's Look | right-click → Settings… → Look; `console_show action:chrome.look.open:<kind>:<id>` | — | `console_show` / `console_action` | `axf console do function:chrome.look.open grid:<id>` | "open the look of the builds grid" → `chrome.look.open` |
| Read its look | the Look section (value + source per key) | `GET /api/plugins/theme-manager/instance-look/<kind>/<id>` | `theme_manager_instance_look_*` (plugin-commands, auto), `control` `get tokens.looks <kind>.<id>` | `axf look get <kind> <id>` | `chrome.look.get:<kind>:<id>[:<key>]` |
| List every own look | — | `GET …/instance-look?app=` | plugin-commands; `control list tokens.looks` | `axf look list [<app>]` | `chrome.look.list` |
| Set one key | the key's picker | `PUT …/instance-look/<kind>/<id>` `{values:{rowBg:"surface2"}}` | plugin-commands; `control set tokens.looks <kind>.<id>.<key>`; console-control `setting:chrome.<kind>.<id>.look.<key>` | `axf look set <kind> <id> rowBg=surface2` | `chrome.look.set:<kind>:<id>:<key>:<value>` |
| Reset to skin | Reset to skin (confirm) | `DELETE …/instance-look/<kind>/<id>` | plugin-commands; `control reset tokens.looks <kind>.<id>`; `function:chrome.look.reset` (needs confirm) | `axf look reset <kind> <id>` | `chrome.look.reset:<kind>:<id>` |
| Undo the reset | Undo reset | `POST …/instance-look/<kind>/<id>/undo` | plugin-commands; `control act tokens.looks <kind>.<id> undo` | `axf look undo <kind> <id>` | `chrome.look.undo:<kind>:<id>` |
| Pick a named grid look | right-click → Change grid look… | — | `console_action chrome.swap:grid:<id>:<look>` | `axf console do function:chrome.swap grid:<id>:<look>` | `chrome.swap:grid:<id>:<look|next>` |
| Grid settings (Compact rows) | right-click → Grid settings… | — | `console_action chrome.set:grid:<id>:compact:on` | same via `axf console do` | `chrome.set:grid:<id>:compact:on` |

`<kind>` = `tab-group` | `grid`; `<id>` = the TabGroup / DataGrid id (`-` = every one of the kind in the app); REST, MCP and CLI take
`app` (default `axf-console`) and write the app's look document on the hub (`own.settings`), which every open screen of that app follows
live. One library under all of them: `framework/cli/instance-look.mjs` (REST and control@1 call it; the open console calls the runtime's
`setInstanceLook` / `resetInstanceLook` / `undoInstanceLookReset`, which use the same engine).

## Checks (phase 2)

`check-instance-look` (860: + skin swap restyles, reset returns to the skin, CSS reads `--fx-inst-*` only under a gate and never with a
fallback, fixed cell widths, CLI round-trip), `theme-manager/test/test_instance_look.py` (24 route checks; CI runs `plugins/*/test/test_*.py`),
`scripts/instance-look.e2e.mjs` (27 browser checks, desktop + phone, built console), `check-skin-coverage` (56 types, 0 uncovered),
`check-chrome-settings` (330), `chrome-settings check` (7 kinds × 5 apps), `check-chrome-assets` (within baseline), `check-control` (402,
26 targets), `check-console-control`, `check-theme`, `check-controls`, `check-toolbars`, `check-component-tokens`, `check-skin`,
`check-tapconfirm`, `shared-assets check --all`, `validate --framework`, `tracker --check`, token-control and plugin-commands tests,
console `npm run build` (tsc + vite).

## Review

UI Review item `r-20261117-avs9i01` (group "Own look per grid and tab group"): desktop + phone shots of a grid and a tab row on the skin,
with an own look, the Look section, and after Reset to skin; three choices (owner theme-manager, `plugins/theme-manager/assets/instance-look/`):
**Quiet ledger**, **Soft cards**, **High contrast**. They ship either way (Change grid look… lists them). Shots: `own-look-per-grid-and-tab-group/shots/`.

## Notes and what it cost

- The console build failed on the phase-1 engine under the console's strict index rules (6 errors in `instance-look.ts`); fixed in the
  framework, behaviour unchanged.
- Re-bake: the four shared apps' baked copies were behind the framework with stale lock hashes, so `rebake apply` refused them as
  "edited". Checked first (no app-only content, only older framework lines), then `--force`. `apps/demo` and `walkthrough-studio` are
  still stale; they are not shared-assets apps.
- The UI Review item went straight to the live UI Review folder (`/opt/axf/.axf-console/plugins/ui-review`): this session had no
  `AXF_TOKEN` / `AXF_CONSOLE_URL` for `--console`.
- Undo of a reset is one per instance: in the open console it lasts the session; through REST / CLI it is kept beside the look documents
  (`looks/.instance-look-undo.json`).

## Open

- Kotlin twin: deferred (framework/spec/PORTING.md, s5).
- `.fx-table` hosts (plain tables) have no settings id yet, so they take the grid family tokens but no own look.
