# jump-menu-asset — the jump menu is an asset type (jump-menu@1)

Build `jump-menu-asset` (Current, Fable, agent Ping Paulie, headless worktree), Nov 4 2026. Branch `claude/jump-menu-asset`,
PR [#326](https://github.com/MossesX/AmberX-AXF/pull/326). Replaces the cancelled `plan-studio-section-nav`.

## What Brett said (verbatim, Nov 4 2026, voice)

> So make the jump menu an asset type. And um, so when you right click on it, you can go to its settings. It has its own
> settings. It's allow placing it. Allow different options like whether it shows icons or text or whatever. And um, you can
> select its location.

About Plan Studio's plan view, where a row at the top says Basics, Steps, Requirements, Links, Notes… and tapping one scrolls
to that section (a jump bar, not tabs). The earlier idea of a nav menu that opens sections one at a time was scratched.

## What was built

### The contract: `jump-menu@1`

- **One registry**, `framework/core/engines/jumpmenu-rules.mjs` (plain .mjs, shared by the TS validator, the build engine,
  control@1 and the settings dialog), `JUMP_FIELDS`:

  | Field | Values | Default | Level |
  |---|---|---|---|
  | `location` | top · left · right · bottom · floating | top | Simple |
  | `display` | icons-text · text · icons · numbered | icons-text | Simple |
  | `variant` | chips · underline · rail · pill | chips | Basic |
  | `size` | sm · md · lg | md | Basic |
  | `density` | theme · compact · regular · roomy | theme | Basic |
  | `sticky` | true / false | true | Basic |
  | `collapsible` | true / false | false | Basic |
  | `collapsed` | true / false (only with collapsible) | false | Developer |
  | `spy` | true / false (scroll-spy) | true | Developer |
  | `smooth` | true / false (reduced motion turns it off) | true | Developer |
  | `overflow` | wrap · scroll · more | scroll | Developer |
  | `offset` | 0..12 (× the space unit) | 4 | Developer |

  Plus optional fixed `sections: [{ id, label, icon? }]` (normally none: the page supplies them). Every field is one scalar,
  so a control@1 override can set any of them. Unknown fields are dropped; bad values are named one by one.
- **Per page:** a jump menu has an id (`plan-studio.plan`). Its own settings are overrides on the same token set under
  `menu.<menu id>.<field>`, and `menu.<menu id>.asset` picks the jump-menu asset that page uses. Resolution
  (`jumpConfig`): asset data < app-wide field < that page's own field.
- **Engine** `framework/core/engines/jumpmenu.ts`: `jumpMenuOutput` → `--fx-jump-offset / -font / -icon / -py` tokens and
  `data-fx-jump-*` attributes on the menu element (never the root: several menus may share a page; theme tokens only),
  `jumpItems` per display (icons only falls back to the number for a section without an icon; numbered prints "1. Basics"),
  `jumpSpy` (the last section whose top passed the reading line; the first before it; the last at the end of the scroll),
  `jumpMoreSplit` (how many entries fit beside a More button, at least one), `jumpStep` (arrow keys wrap, Home / End),
  `jumpCollapsed` / `parseJumpCollapsed` / `withJumpCollapsed` on the per-device key `axf.jumpmenu.collapsed`.
- Wired into `types.ts` (`ASSET_TYPES`, optional, late-optional, `AssetDataMap`), `validate.ts`, `build-engine.mjs`
  (validator + generated schema), `asset-types.json` (enums match the registry; a check holds them equal), `defaults.json`
  (`classic-chips`), `schemas/json/jump-menu.schema.json`.
- **Six starters** (`framework/assets/jump-menu`): classic-chips (top), left-rail (left, foldable), icon-rail (right, icons,
  compact), numbered-outline (left, numbered, underline, roomy), bottom-tabs (bottom, text, underline, wraps), floating-pill
  (floating, icons, pill, folds, More). Every location covered. Baked into the console, axHub web, AmberX and Molly
  (`shared-assets.mjs bake`).

### control@1 `tokens.jump` (Amber by voice, the API, MCP and CLI)

- Appended after `tokens.nav` (24 targets; `check-control` pins the append-only order), settings key `axf.tokens.jump`
  (an `axf.tokens.*` key, so it rides the axHub appearance document like every look change).
- `control list tokens.jump` names every field; `set` / `reset` take a plain field (app-wide) or `menu.<menu id>.<field>` /
  `menu.<menu id>.asset` (per page; known by shape, values checked by the same rules). MCP `control_*` target lists,
  the Token control plugin's picker and docs, and the CLI aliases (`axf token jump …`, `axf token nav …` was missing too)
  carry it. CONTROL.md documents it. Swapping the app-wide asset stays `tokens.slots` (`jump-menu`).
- Examples: `axf token jump set location left` · `axf token jump set menu.plan-studio.plan.display numbered` ·
  `axf token jump set menu.plan-studio.plan.asset floating-pill` · `axf token jump reset menu.plan-studio.plan.location`.

### React (`framework/react/components/JumpMenu.tsx`)

- `<JumpMenu id="plan-studio.plan" sections={…} targetId={…}>{content}</JumpMenu>` lays the menu and the content out per the
  location in force: top / bottom rows (sticky to their edge), left / right columns (sticky to the top), floating (a pill
  riding the bottom of the content). Without children it is the bare bar.
- Scroll-spy on the nearest scrolling box (or the page), one frame at a time; tapping an entry scrolls so the section's top
  sits `offset` below the box's top (no page CSS needed); keyboard roving (arrows, Home, End); overflow `more` measures the
  entries once and folds the rest under a More menu (MenuList, `jumpmenu.go`); fold handle for collapsible menus (per device).
- **Right-click / long-press** (the same plumbing as toolbars and banners: `data-fx-ctx-target="jump-menu"` + payload =
  the menu id, `rt.contextExtras`, actions under the framework module): **Jump menu settings**, **Change jump menu**
  (every jump-menu asset, the current one marked, "The app's own" when the page picked its own), **Move** (Top / Left / Right
  / Bottom / Floating), Fold / Unfold, Reset this jump menu. Actions `jumpmenu.settings|use|move|fold|go|reset`.
- **Settings dialog** `jump-menu-settings` (registered in AppShell with the banner one): the Simple / Basic / Developer /
  Administrator level bar (the shared `axf.settings.level`), an Applies-to switch (This page / Every jump menu), the asset
  picker, a live preview drawn with the real bar, every field at its level with a "Set for this page / app-wide" hint, and
  two resets. Writes go through `setJumpField` → `withTokenOverride` on `axf.tokens.jump` (a value equal to what lies
  beneath drops the override).
- `useJumpMenu(id)` re-reads on override, active-asset and folded changes; runtime `jumpMenuData(menuId)`.
- `axf.css`: `.fx-jump*` (host, list, item per variant, More, fold, preview) from theme tokens only; `AssetPreview` draws the
  type on the Assets screen; Settings → Appearance → Assets lists it like every slot (not hideable: it is per page, not
  chrome). Help entries for the new controls (framework pack, synced).

### First consumer: Plan Studio

`apps/console-web/plugins/plan-studio/web/editor.tsx` replaced its hard-coded `<nav>` of `fx-chip` buttons and the
`scrollIntoView` helper with `<JumpMenu id="plan-studio.plan" sections={SECTIONS} targetId={(s) => \`axp-ps-${s.id}\`}>`
around the totals strip and the ten sections. The default look is the same row of chips at the top; right-click it to move
it, swap it or change what it shows.

## Candidates for the next adopters

Long pages in the console that scroll between sections today (found by their `scrollIntoView` / section headings):

- Settings pages (`framework/libs/settings`: every app's Settings tab and the Plugins sub-tabs) — a left rail per tab.
- MD Studio docs (`plugins/md-studio/web/Doc.tsx`) — a numbered outline from the document's headings.
- Reports: Fable rebuilds (`plugins/fable-rebuilds/web/ui.tsx`), the Feature matrix (`plugins/feature-matrix`), the
  Codebase changes log (`plugins/codebase-changes/web/ui.tsx`), the Build manager (`plugins/build-manager/web/ui.tsx`).
- Guides and installers: Molly guide (`plugins/molly-guide`), the Claude handoff installer (`plugins/claude-handoff`).
- Chat views that jump to a message (`plugins/chat-viewer`, `plugins/agent-swarm/web/chat.tsx`, `plugins/ai-assistant`).

Each is a one-line change: list the sections, wrap the content in `<JumpMenu id="<plugin>.<page>" …>`.

## Checks

| Check | Result |
|---|---|
| `npx -y tsx framework/spec/check-jumpmenu.mts` | 171 checks |
| `npx -y tsx framework/spec/check-control.mts` | 374 checks, 24 targets |
| `node framework/cli/axf.mjs validate --framework` | 508 assets valid |
| `check-navstyle` · `check-appearance` · `check-roller` · `check-widgets` · `check-toolbars` · `check-tapconfirm` | 98 · 107 · 138 · 248 · 590 · 40 |
| `node framework/cli/check-theme.mjs` (JumpMenu.tsx, axf.css, AssetPreview, plan-studio) | conformant |
| `node framework/cli/check-controls.mjs apps/console-web/plugins/plan-studio` | ok |
| `node framework/cli/help-coverage.mjs --check` | at the ratchet (5 written entries added) |
| `node framework/spec/check-plugin-commands.mjs` · `check-project-fixtures.mjs` · `check-conform.mjs` | ok |
| `npx -y tsx apps/console-web/plugins/plan-studio/test.mjs` · `node apps/console-web/plugins/token-control/test.mjs` | 26 · 20 |
| `cd apps/console-web && npx tsc --noEmit && npm run build` | clean, built |
| `node framework/cli/shared-assets.mjs check` | 4 apps ship all 497 shared assets |

Not mine, pre-existing on main: `tracker.mjs --check` exits 1 (390 items without a status) on a sibling checkout too;
`plugin-lifecycle check plan-studio` flags stale references in two apps' copies of the shared rules.

## Screenshots (UI Review)

Captured with `rebuild-shots.mjs` (`_claude/builds/reports/jump-menu-asset/shots.json`, console API + Vite + Playwright,
`AXF_APPEARANCE_HUB=off`) and submitted to UI Review as `jump-menu-asset - Nov 4` (non-blocking for this build, per the
brief). Files under `_claude/builds/reports/jump-menu-asset/shots/after/`:

- `plan-editor-classic-chips` — the default: the same chip row Plan Studio had, now the asset.
- `plan-editor-left-rail` — `menu.plan-studio.plan.asset = left-rail`.
- `plan-editor-numbered-outline-spy` — numbered outline, scrolled to Links (scroll-spy lit).
- `plan-editor-floating-pill` — the floating pill, scrolled to Steps.
- `plan-editor-context-menu` — right-click: Jump menu settings / Change jump menu / Move.
- `jump-menu-settings-dialog` — the settings dialog (level bar, scope, preset, preview, fields).
- `assets-screen-jump-menu` — the Assets screen, Navigation group (desktop).

## Deferred / notes

- **Android:** no Kotlin written (Brett's Oct 21 2026 hold). The brief asked for a typed model / validator in axf-kernel;
  the Kotlin registry is spec-driven and accepts the new optional type as is, and the twin (`JumpMenuEngine.kt`, the type
  in `AssetTypeRegistry`, `tokens.jump`, a Compose `AxfJumpMenu`) is recorded in `framework/spec/PORTING.md`.
- The console re-bake needed `rebake.mjs apply` with force: `apps/console-web/src/axf/libs/alerts/alerts-sw.js` was an
  edited baked file already on main (the framework copy went in, as CI does).
- `axf token nav …` was not an alias before (the CLI's token-set list lacked `nav`); added with `jump`.
- Fixture drift not mine, reverted: `agent-card.json` and `widgets.json` regenerate differently from what main holds.
