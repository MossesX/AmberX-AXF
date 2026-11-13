# ui-asset-designer: the UI asset designer, Fable phase (contracts)

Build `ui-asset-designer` (Current profile, Assets), Nov 7 2026, Fable, branch `claude/ui-asset-designer`.
Agent: Amber (headless worktree). Plan: Plan Studio → Proposed › Assets (`proposed-fzf3`) and the build's own plan.

## What Brett said (verbatim)

> "We're gonna build a UI asset designer, which will create assets with their manifest and their identifier. It's going to create separate plugins for the app menu designer, the nav menu designer, the toolbar designer, the banner designer, the embedded widget designer, the widget designer. These are not dependent on the designer, but the designer interface will inherit those other designers. The UI designer plugin will have add-ons, each with their own settings interface and the designer's interface." "Redo them all from scratch." "Make it a build and get the Fable stuff going. Make it super powerful: full-blown context menu, drag and drop, map-based. Every UI asset will also have a context menu section which gives you a preview of the UI, and informs you in multiple ways (tooltips etc)."

Earlier addenda on the plan (embed asset: tab groups, grid rows, toolbars, third-party buttons, "a link to a JSON
manifest, with all the configuration", voice-controlled; toolbar designer: every option, voice) are folded into the
embed and toolbar add-ons.

## What this phase built (s1–s5)

Everything is contracts, engines, fixtures and starters. No screen was built yet, so nothing went to UI Review; the
Opus phase submits 3+ preview options per designer.

### designer@1 — host + add-on model (`framework/core/engines/designer-rules.mjs`, s1)
- `designer-addon@1`: what an add-on declares (id, label, icon, asset types, plugin + folder, standalone view, its
  settings interface asset, its designer interface asset, capabilities, accepted drops, extra manifest fields, voice
  phrases). `DESIGNER_ADDONS` = the six Brett named (app-menu, nav-menu, toolbar, banner, embed, widget); open list:
  `addonsFromPluginManifest` reads `plugin.json` → `designer` / `provides: designer:<id>`, `mergeAddons` folds them
  over the built-ins, `designerAddonChoices` is the host's picker, `addonProvides` the `provides` an add-on declares.
- The `designer` asset type (the designer's interface): 36 fields in one registry `DESIGNER_FIELDS` (canvas, panels,
  preview, info, context, history, output, voice, autosave) → validator, JSON Schema and the settings dialog.
  `designer/default` ships; every add-on has `designer/<addon>` extending it (inherit@1, same folding as
  chrome-settings@1: `resolveDesignerChain`). `designerInterfacePick`, `designerCopy`, `designerMissing`.
- Every add-on's settings interface: `settings/designer` (host, `for: designer`) and `settings/designer-<addon>`
  (`for: designer:<addon>`, `extends: designer`); `designerSettingsCopy`, `designerSettingsErrors` (run by both
  validators on every settings asset whose `for` starts with `designer`).

### Asset output: manifest + identifier + registration (s2)
- `designed@1` (`makeDesigned` / `withDesigned` / `designedOf` / `designedErrors`): the envelope block every designed
  asset carries — `uid` (the identifier, `dz-…`, never changes, survives renames), ref `<type>/<id>`, add-on, app,
  author, created / updated, revision, origin (what Brett said), the ui-registry@1 item it registers as, the add-on's
  extras and a content hash (a hand edit after the designer saved is refused by both validators).
- Registration: `designedRegistryItem` → a ui-registry@1 item (`<kind>:<type>/<id>`, `designer.open:<ref>`), built
  in the shape of build `ui-registry-shortcuts` (#369) without importing it (the check verifies it against that
  engine when both are present, so either may land first). `designedLibraryEntry` / `normalizeDesignerLibrary` /
  `upsertDesignerLibrary` (designer-library@1, one row per uid), `designedLibraryPath` (app / framework / hub),
  `designedIdErrors` (built-ins never overwritten), `suggestAssetId`.
- The `embed` asset type (`embed-asset@1`, `normalizeEmbed`, `embedAssetErrors`): target ui | plugin | command |
  url | asset, `manifest` link (Brett: "assigning a link to a JSON manifest"), size, hosts, load, sandbox (a url is
  always sandboxed), expand, passData, remember. Distinct from embed@1 (the app-in-app marker). Not a widget and not
  attachable yet (the widget / attachable registries are pinned by the Kotlin conformance tests); hosts attach embeds
  through their own fields — the toolbar item's new optional `embed` first.

### Interaction contract: designer-doc@1 (`framework/core/engines/designer-doc.mjs`, s3)
- One document for every designer: families toolbar / banner / nav / appmenu / ctxmenu / flat, `docFromAsset` ↔
  `assetFromDoc` (all 115 starters of the six types round-trip unchanged, field order kept), `docErrors`.
- Ops (pure): add / remove / move / setProps / setData / rename / duplicate / group / ungroup / lock / hide / step.
- Multi-select everywhere: select (add / toggle / range), selectAll, selectKind, topSelection, selectionBounds.
- Map canvas: place (snapped), nudge, align (6 edges), distribute, autoLayout, zoomSteps, zoomFit.
- Drag and drop: `parseDrop` (designer MIME, JSON hooks / actions, https URLs → embeds, asset refs, action ids, text,
  files) → `canDrop` (what it becomes, where, why not) → `applyDrop`; `nodeDragPayload`, `palette`.
- History: `createHistory` / `commit` (coalesces quick edits of one label) / `undo` / `redo` / `historyLabels`.
- The designer's context menu (`designerContextMenu`: node and canvas menus, every entry with an id, a tip and a
  `designer.<verb>` action so mouse, finger and voice share it) and `DESIGNER_KEYS`.

### asset-context@1 — every UI asset's context-menu section (s4)
- `UI_ASSET_TYPES` (28 drawn types) each get `assetContextSection`: identity with a tooltip, **Preview** (live
  miniature on hover, floating preview on tap), **About** (hover card / side panel), **Help** (help@1 entry),
  **Edit in <designer>**, **Change <type>** where the chrome block isn't already there, **Copy id**, **Where it is
  used**. `assetInfo` writes the same facts as tooltip / hover-card / side-panel / help-text / say; `assetSummary`
  per type. `MenuEntry` gains `tip`, `preview`, `disabled` (`core/engines/windows.ts`). Elements name their asset
  with `data-axf-asset="<type>/<id>"`.

### Fixtures, validators, checks, docs (s5)
- `framework/spec/fixtures/designer.json` + `framework/spec/check-designer.mjs` (463 checks; `--write` regenerates),
  wired into `.github/workflows/android.yml`. `check-ci-scope`, `check-agent-card` / `help` / `job-type` (type
  order), `check-chrome-settings`, `check-settings-ui`, `check-appearance`, `check-widgets`, `check-app-menu`,
  `check-tab-group`, `check-project-fixtures` green; `axf validate --framework` (533 assets), `shared-assets.mjs
  check` (514 shared assets in 4 apps), console `tsc --noEmit` green after the re-bake.
- `asset-types.json`: `designer` (System, `shared: false`, never rolled) and `embed` (Widgets group, shared, never
  rolled) before `uac-policy`; envelope `designed`; `settings.for` documents the designer values; toolbar items get
  `embed`. `core/types.ts`, `validate.ts`, `build-engine.mjs` (validators + schema props), `core/index.ts` (`export *`
  rules, `designerDoc` namespace), `defaults.json` → `designer: default`. JSON Schemas regenerated (77).
  Fixtures `appearance.json` / `roll.json` list the two new types (Kotlin reads the same spec, roll false).
- Starters: `framework/assets/designer/` (default + 6 copies), `framework/assets/settings/designer*` (7),
  `framework/assets/embed/` (plan-studio-panel, build-row-details, docs-page). Re-baked into console, Molly, axHub
  web and AmberX (`rebake.mjs apply`, `shared-assets.mjs bake --all`).
- Docs: `framework/spec/DESIGNER.md` (the contract), `PORTING.md` row (Kotlin twin deferred), CLAUDE.md convention,
  `_claude/memory/STATUS.md`, `decisions.md`. `framework/catalog/plugins.json`: the seven plugins planned
  (`pending: ui-asset-designer`); the old `asset-designer` entry and build keep drawers / layouts / themes only.

## Decisions worth knowing
- Both interfaces per add-on are assets with inherit@1 copies, exactly like chrome-settings@1, so the same picker,
  Reset-to-default and dialogs serve them.
- The identifier is `designed.uid`, not the asset id: renaming an asset keeps its library row, history and registry
  aliases.
- The embed type is deliberately minimal and open (hosts list, manifest link); the tree picker, host rendering and
  third-party sandboxed buttons are Opus-phase steps on this build (embed hosts pinned to Fable: cross-app GUI).
- `context-menu-designer` (built Nov 2026) is untouched: context menus are not in Brett's add-on list; the add-on
  registry is open for a from-scratch one later.

## Opus phase (s7–s40, ~10 min each, on the build and in Plan Studio)
Host (s7–s17: skeleton, server capability, web shell, canvas + tree, inspector, context menu + keys + history,
drag-and-drop, live preview, save / publish, asset-context in the runtime [Fable], menu rendering of tip / preview),
one group per add-on (App menu s18–s20, Nav menu s21–s23, Toolbar s24–s26, Banner s27–s29, Embed s30–s33 with the
hosts step on Fable, Widget s34–s36), voice (s37), API / MCP / CLI (s38), tests (s39), close (s40). Every add-on
group ends with 3+ preview options to UI Review.

## Checks to run
```
node framework/spec/check-designer.mjs
node framework/cli/axf.mjs validate --framework
node framework/cli/shared-assets.mjs check
npx -y tsx framework/spec/check-chrome-settings.mts && npx -y tsx framework/spec/check-appearance.mts
cd apps/console-web && npx tsc --noEmit
```
