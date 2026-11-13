# The UI asset designer — designer@1

Brett, Nov 7 2026 (build `ui-asset-designer`): "We're gonna build a UI asset designer, which will create assets with
their manifest and their identifier. It's going to create separate plugins for the app menu designer, the nav menu
designer, the toolbar designer, the banner designer, the embedded widget designer, the widget designer. These are not
dependent on the designer, but the designer interface will inherit those other designers. The UI designer plugin will
have add-ons, each with their own settings interface and the designer's interface." "Redo them all from scratch."
"Make it super powerful: full-blown context menu, drag and drop, map-based. Every UI asset will also have a context
menu section which gives you a preview of the UI, and informs you in multiple ways (tooltips etc)."

This is the contract every designer is built on. The rules live in two plain-JS engines so the TS core, the build
engine, the console server, the CLI, the React layer and every plugin read one definition:

| File | What |
|---|---|
| `framework/core/engines/designer-rules.mjs` (+ `.d.mts`) | designer-addon@1, the `designer` and `embed` asset types, designed@1 manifests + registration, asset-context@1 |
| `framework/core/engines/designer-doc.mjs` (+ `.d.mts`, exported as `designerDoc`) | designer-doc@1: the document, ops, selection, canvas, drag-and-drop, history, the designer's context menu + keys |
| `framework/spec/fixtures/designer.json`, `framework/spec/check-designer.mjs` | the conformance fixture (463 checks, CI) |
| `framework/assets/designer/*`, `framework/assets/settings/designer*`, `framework/assets/embed/*` | the shipped interfaces and starters |

Kotlin twin deferred (Android on hold): `spec/PORTING.md`.

## 1. Host and add-ons (designer-addon@1)

The **host** is one console plugin, `ai.amberx.axf.console.ui-asset-designer` (`DESIGNER_HOST_PLUGIN`), providing the
capability `axf.designer@1` (`DESIGNER_SERVICE`): the asset library, the shared designer shell (canvas, tree,
inspector, preview, context menu, history), saving, registration, the API / MCP / CLI and voice.

An **add-on** is a standalone plugin (it works with no host installed) that also plugs into the host. It declares a
`designer-addon@1` block in its `plugin.json` (`designer: {…}` or a list) or a `designer.json` beside it, and
`provides: ["service:axf.designer-addon@1", "designer:<id>", "view:<id>-designer", "settings-tab:<folder>"]`
(`addonProvides`). The host finds add-ons with `addonsFromPluginManifest` and merges them over the built-in six
(`mergeAddons`); a declared add-on with a built-in id replaces it.

```json
{ "$axf": "designer-addon@1", "id": "toolbar", "label": "Toolbar designer", "icon": "sliders",
  "types": ["toolbar"],                                  // the asset types it designs
  "plugin": "ai.amberx.axf.console.toolbar-designer", "folder": "toolbar-designer", "view": "toolbar-designer",
  "settings": "designer-toolbar",                        // its settings interface: a settings asset (settings-ui@1)
  "interface": "toolbar",                                // its designer interface: a designer asset
  "capabilities": ["canvas","tree","preview","context-menu","drag-drop","multi-select","undo","map","voice","api","standalone","embedded"],
  "drops": ["node","palette","asset","action","hook","embed","text"],   // what may be dropped on its canvas
  "manifest": { "fields": [{ "key": "placement", "label": "Placement", "kind": "choice", "options": ["top","bottom","left","right","floating"] }] },
  "voice": ["make a toolbar called {name}", "open the toolbar designer"], "standalone": true, "version": "1.0.0" }
```

The six add-ons Brett named ship as `DESIGNER_ADDONS`: `app-menu`, `nav-menu`, `toolbar`, `banner`, `embed`
(the embedded widget designer, type `embed`) and `widget` (every widget type: clock, search bar, logo, label, status,
counter, progress, avatar, link, theme switch, spacer, divider). The list is open: a plugin may declare an add-on for
any asset type (a tab-group designer, a dialog designer…).

Every add-on has two interfaces, both assets, both inherit@1 copies that follow their default until edited (the same
folding as chrome-settings@1, `resolveSettingsChain`):

- **its settings interface**: `settings/designer-<addon>` (`for: "designer:<addon>"`, `extends: "designer"`), a copy of
  the host's `settings/designer` (`for: "designer"`): tabs Canvas / Panels / Preview / Info / Output / Add-ons, levels
  on, Output at Developer. `designerSettingsCopy`, `designerSettingsErrors`.
- **its designer interface**: `designer/<addon>` (`for: "<addon>"`, `extends: "default"`), a copy of `designer/default`.
  `designerCopy`, `designerInterfacePick` (the add-on's own copy when it exists, else the default), `designerMissing`.

## 2. The `designer` asset type: the designer's interface

The designer's own interface is data, like the settings interface (`settings`) is. `DESIGNER_FIELDS` is the one list
the validator, the JSON Schema, the settings dialog and the shell read (dotted paths into `data`, each with kind,
options / range, default, group, level):

| Group | Fields |
|---|---|
| `canvas` | `mode` free / flow / both, `grid` 2–64, `snap`, `zoomMin` 10–100, `zoomMax` 100–800, `rulers`, `guides` |
| `panels` | `library`, `layers`, `inspector`, `preview`, `help`, `history`: left / right / bottom / float / hidden |
| `preview` | `mode` inline / floating / docked, `device` desktop / phone / both, `refresh` live / on-save |
| `info` | `tooltip`, `hoverCard`, `sidePanel`, `helpText`, `say` (the ways an asset informs you, asset-context@1) |
| `context` | `preview`, `insert`, `arrange`, `clipboard`, `help` (the sections of the designer context menu) |
| `history` | `limit` 10–500, `coalesceMs` 0–2000 |
| `output` | `to` app / framework / hub, `idPrefix`, `register` (UI registry), `version` patch / minor / keep |
| | `voice`, `autosave` |

`normalizeDesigner` fills every field (bad values fall back, unknown fields drop); `designerInterfaceErrors` judges
only what the asset sets. Console-only type: `shared: false`, never rolled, `defaults.json` → `designer: default`.

## 3. Designed assets: manifest + identifier (designed@1)

Every asset a designer saves is an ordinary `asset@1` of its type (so every validator, engine and app treats it like
a starter) **plus** a `designed` block in its envelope, the manifest:

```json
"designed": { "$axf": "designed@1",
  "uid": "dz-…",                         // THE identifier: made once, never changes, survives renames (designedUid)
  "ref": "toolbar/my-bar", "type": "toolbar", "id": "my-bar", "name": "My bar", "version": "1.0.1",
  "addon": "toolbar", "designer": "designer@1", "app": "axf-console-web", "by": "Brett",
  "createdAt": "…", "updatedAt": "…", "revision": 2,
  "origin": { "said": "make me a toolbar", "source": "voice" },      // what Brett said when it was voice-started
  "registry": { "kind": "toolbar", "id": "toolbar:toolbar/my-bar", "aliases": ["my-bar"] },
  "extras": { "placement": "top" },        // the add-on's manifest fields
  "hash": "9f1c2a3b" }                     // FNV-1a of data: a hand edit after the designer saved is refused
```

`makeDesigned({ asset, addon, app, by, now, uid, previous, origin, aliases, extras, output })` makes it (a later save
passes `previous`: uid, createdAt and origin are kept, revision and version bump as the interface's `output.version`
says); `withDesigned` puts it in the envelope; `designedOf` reads it; `designedErrors` is run by both validators
whenever the block is present (uid, ref = the asset, revision ≥ 1, registry id = `<kind>:<ref>`, hash = the data).

Three identifiers, each with a job: `uid` (stable, the row key of the library), `ref` = `<type>/<id>` (how assets
name each other and how an element names its asset: `data-axf-asset="toolbar/my-bar"`), and the ui-registry@1 id
`<kind>:<type>/<id>` (`designedUiKind`: toolbar → toolbar, banner → banner, menus → menu, tab-group, dialog, popup,
widgets and the embed → widget, controls → control).

**Registration.** `designedRegistryItem(manifest)` is the ui-registry@1 item the host declares in its
`ui-registry.json` (source `declared`, owner `plugin:ui-asset-designer`, `open: { via: 'action', action:
'designer.open:<ref>' }`): the asset can be opened by voice the moment it is saved. `designedLibraryEntry` is its
row in the designer library index (`designer-library@1`, one row per uid, newest wins; `upsertDesignerLibrary`), and
`designedLibraryPath` says where the file goes: `src/assets/<type>/<id>.json` in the app (`output.to: app`),
`framework/assets/…` (framework) or `_data/assets/…` on the hub. `designedIdErrors` refuses built-in ids (a starter
is never overwritten), clashes and ids outside the interface's prefix; `suggestAssetId` makes one from the name.

## 4. The `embed` asset type (embed-asset@1)

Brett: "an asset type called embed … attach it to any tab group, or in a grid row … also be on any UI on the
framework, through the API … a simple embed asset designer, which is basically just assigning a link to a JSON
manifest, with all the configuration." Not embed@1 (`core/engines/embed.ts`), which marks an app running inside
another app.

```json
{ "target": { "kind": "ui" | "plugin" | "command" | "url" | "asset", "id": "screen:plan-studio", "url": "https://…", "params": {} },
  "manifest": "https://…/embed.json | ./embeds/x.json",  "label": "…", "icon": "…",
  "size": { "width": "auto" | px, "height": "auto" | px, "minHeight", "maxHeight" },
  "hosts": ["toolbar","tab-group","grid-row","banner","region","dialog"], "load": "live" | "lazy" | "snapshot",
  "sandbox": true, "expand": "inline" | "side" | "popout", "passData": false, "remember": true }
```

`normalizeEmbed`, `embedAssetErrors`. A `url` target is **always sandboxed** (no console token, no host storage; https
only). The type is shared (every app bakes the starters) and never rolled. It is not a widget and not attachable
through `banner.attach` / `toolbar.widgets` (those registries are pinned by the Kotlin conformance tests): hosts attach
an embed through their own field — first the toolbar item's `embed` (asset-types.json, written by the Toolbar designer
when an embed is dropped), then tab groups, grid rows and regions in the Embed add-on's steps.

## 5. The document every designer edits (designer-doc@1)

One model, so the host gives every add-on the same tree, canvas, selection, undo / redo, drag-and-drop and context
menu, and an add-on only says which node kinds its asset type has (a **family**) and how they read and write:

| Family | Types | Tree |
|---|---|---|
| `toolbar` | toolbar | root → group → item; widgets on the root |
| `banner` | banner | root → attachment |
| `nav` | nav-menu | root → section → item → item… |
| `appmenu` | app-menu | root → menu → item \| separator → … |
| `ctxmenu` | context-menu | root → target → item \| separator → … |
| `flat` | widgets, embed, everything else | the data alone |

`registerFamily` adds one for another type. `acceptsKinds(type, kind)` says which children a kind takes;
`nodeProps(type, kind)` is the inspector's field list (and what `docErrors` requires); `palette(type)` the things a
person can drag in. `docFromAsset(asset)` → document, `assetFromDoc(doc, base)` → asset (every starter of the six types
survives the round trip unchanged, field order kept; hidden nodes are left out).

Ops are pure (a new document every time): `addNode`, `removeNodes`, `moveNodes`, `setProps`, `setData`, `renameDoc`,
`duplicate`, `group` / `ungroup` (wrap in a toolbar group or a submenu item where the parent takes it), `lockNodes`,
`hideNodes`, `stepNodes`. Selection is a list everywhere: `select` (alone / add / toggle / range), `selectAll`,
`selectKind`, `clearSelection`, `topSelection`, `selectionBounds`. The **map**: `place` (snapped to the interface's
grid), `nudge`, `align`, `distribute`, `autoLayout` (a flow grid for a document with no positions), `zoomSteps`,
`zoomFit`. **Drag and drop**: `parseDrop(types, files)` reads the designer MIME (`DESIGNER_DROP_MIME`: node / palette /
asset / action / hook / embed / text), `application/json` (a grid-hook@1 `{kind, id}` or `{action}`), `text/uri-list`
(an https page → an embed), `text/plain` (an asset ref, an action id, or text) and files; `canDrop(doc, addon,
payload, target)` answers with the parent, index and the node kind it would become (`dropNode`); `applyDrop` does it
(a map drop also places the node). **History**: `createHistory`, `commit` (quick edits of one label within
`coalesceMs` merge into one step), `undo`, `redo`, `historyLabels`. **The designer's context menu**:
`designerContextMenu(doc, addon, { node | canvas }, interface, { clipboard, history })` — edit, rename, insert
before / after / inside, cut / copy / paste, duplicate, delete, wrap / ungroup, arrange (forward / backward, align,
distribute), lock, hide, select, auto layout, snap, grid, zoom, undo / redo with labels, preview, help; every entry has
an id, a `tip` and an action `designer.<verb>[:args]` so the same menu works by mouse, finger and voice.
`DESIGNER_KEYS` is the keyboard map (Ctrl+Z / Shift+Z / Y, Delete, Ctrl+D, Ctrl+A, Ctrl+G, arrows nudge, Ctrl+] / [, …).

## 6. Every UI asset gets a context-menu section (asset-context@1)

Brett: "Every UI asset will also have a context menu section which gives you a preview of the UI, and informs you in
multiple ways (tooltips etc)." Every element that draws an asset carries `data-axf-asset="<type>/<id>"`
(`ASSET_ATTR`); the runtime's context menu adds `assetContextSection(asset, { addon, interface, isChrome, usedIn })`
for every `UI_ASSET_TYPES` member (chrome, overlays, controls, banner and badges, widgets, embed):

| Entry | Does |
|---|---|
| `<Type>: <name>` (tip = the one-line summary) | opens About |
| **Preview** (`preview` = the ref) | hover shows a live miniature; tap opens a floating preview (`asset.preview:<ref>`) |
| **About…** | hover card / side panel: identity, contents, who designed it, where it is used (`asset.about:<ref>`) |
| **Help** | the help@1 entry `asset:<ref>` (`help.explain`) |
| **Edit in <designer>…** | `designer.open:<ref>` (when an add-on designs the type) |
| **Change <type>…** | the chrome picker (only where the shared chrome block isn't already there) |
| **Copy id**, **Where it is used** | `asset.copyId:<ref>`, `asset.usage:<ref>` |

`assetInfo(asset, mode)` writes the same facts in every mode (`ASSET_INFO_MODES`: `tooltip` one line, `hover-card`,
`side-panel` sections of rows, `help-text` a help@1 entry, `say` a spoken sentence); `assetSummary` is the per-type
one-liner (buttons in groups, items in sections, attachments, targets…). Which entries and modes are on comes from the
designer interface in force (`info.*`, `context.*`) and the settings keys `ASSET_CONTEXT_KEYS`. `MenuEntry` carries
`tip`, `preview` and `disabled` for this (`core/engines/windows.ts`).

## 7. Checks

- `node framework/spec/check-designer.mjs` — replays the fixture; the hard-coded type lists equal asset-types.json;
  both validators agree; every shipped interface, copy and starter exists and validates; an unedited copy resolves to
  its default; the registry item is a valid ui-registry@1 item when that engine is present. `--write` regenerates the
  expected outputs after an intended change.
- `node framework/cli/axf.mjs validate --framework`, `node framework/cli/shared-assets.mjs check`, the console typecheck.
