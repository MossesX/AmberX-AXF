# Skin editor (console plugin)

Brett, Nov 13 2026: "list every token in a registry; any time a new UI is made add its tokens to the registry; an editor
that takes whatever UI you pick and throws it in a sandbox with live preview, hot render as you edit; a default skin;
every edit takes a snapshot, you see the chain of edits like a disk snapshot and can revert to any point; at any point
export current to a new skin".

## What it does

- **Token registry** (Plugins → Token registry, `view:token-registry`): every `--fx-*` token with element, area, state,
  scheme, level, plain-English description, default and source, searchable by any word, narrowed by level / area /
  element / state. The document is `framework/schemas/token-registry.json` (token-registry@1, engine
  `framework/core/engines/token-registry.mjs`, CLI `framework/cli/token-registry.mjs`, CI `spec/check-token-registry.mjs`).
  New plugins register their tokens in plugin.json (`tokens` block); CI fails on an unregistered or unread token.
- **Skin editor** (Plugins → Skin editor, `view:skin-editor`): pick a UI (screen, dialog, plugin, element) from the list,
  or **Pick on screen** and click any console screen. The sandbox draws it with real components (`rt.uiRenderers`); the
  wrapper carries the edited tokens as CSS custom properties, so every edit hot-renders. **Pick element** narrows the
  token list to the control you click. Basic / Pro / Advanced levels. **History** is the snapshot chain, drawn like disk
  snapshots; click one to revert (a new snapshot, nothing lost). **Export** writes the head state as a skin asset.
- **Default skin**: every chain starts at the default skin (no edits); the exported skin starts from the console's look
  as it stands (active slots) plus the edits.

## API (plugin-commands@1: REST `/api/control/skin-editor/<command>`, MCP `skin-editor_<command>`, CLI `axf skin-editor <command>`)

| Command | Route | Does |
| --- | --- | --- |
| registry / registry-summary / registry-token | GET /registry, /registry/summary, /registry/token/{token} | the registry, filtered (`q`, `area`, `element`, `level`, `state`, `scheme`, `source`) |
| uis | GET /uis | UIs the sandbox can draw (manifests + element gallery) |
| state / sessions / session | GET /state, /sessions, /sessions/{ui} | the current session, every session, one chain (`ui` = `view:home`, `dialog:x`, `element:button`, `plugin:plan-studio`) |
| pick | POST /sessions/{ui}/pick | make a UI current (its chain starts at the default skin) |
| edit | POST /sessions/{ui}/edit `{ edits: [{ token, to }] }` | set tokens → a snapshot (`to: null` = back to default) |
| revert | POST /sessions/{ui}/revert `{ snapshot | minutesAgo | at }` | revert to a snapshot, the default, or how it was n minutes ago |
| undo | POST /sessions/{ui}/undo | back to the head's parent |
| export | POST /sessions/{ui}/export `{ name, id?, description?, snapshot?, base? }` | the state as a skin asset in `skins/` |
| skins / skin / delete-skin | GET /skins, GET /skins/{id}, DELETE /skins/{id} | exported skins |
| voice | POST /voice `{ phrase, ui?, dry? }` | "revert the skin to 10 minutes ago", "export this as a new skin called Midnight", "set the accent to #ff8800 in the skin", "undo the last skin edit", "search the token registry for hover" |

Deep links: console-control `view:skin-editor`, `view:token-registry`; actions `skin-editor.open[:view:<id>|:dialog:<id>|:element:<id>|:plugin:<id>|:token:<--fx-x>]`, `skin-editor.pick`, `token-registry.open`.

## Files

`web/` (Registry.tsx, SkinEditor.tsx, model.ts, api.ts, menu.ts, skin-editor.css), `server/__init__.py` (registry reads,
sessions, skins, the voice twin), `help.json`, `test.py` (server: fixture replay of the snapshot twin, routes),
`test.mjs` (web model). Data in `.axf-console/plugins/skin-editor/` (`sessions/`, `skins/`, `current.json`).
