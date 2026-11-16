# UI Manager: floating window to select any element in the console and edit all its tokens

Build `ui-manager-floating-window-to-select-any` · branch `claude/ui-manager-floating-window-to-select-any` · PR #634

Brett (Nov 13 2026): "a UI manager, opens a floating window which contains the ability to select any UI element in the
whole console; collapsible categories; one category is all the ones visible on screen, like a Windows shortcut, two things
point to the shared source; select one and it opens an expanding row with all the properties and tokens; you change them by
selecting from predetermined things from the integration with the console and the framework"

## What shipped

| Step | What |
|---|---|
| Phase 1 (Fable) | Core `framework/core/engines/ui-manager-rules.mjs`: ui-element@1, ui-overrides@1, ui-change@1, props with predetermined choices, preview plan, diff / summary / undo; fixture + `framework/spec/check-ui-manager.mjs` |
| s4–s6 | Floating window (tab kind `ui-manager`), every element in the console (asset slots, plugin manifests, live console-control targets), collapsible categories, **On screen now** as shortcuts to the one shared element, expanding row / side panel / grid, pick on screen |
| s7 | Search, sort and multi-filter of elements and properties |
| s8 | Full API: REST, MCP (`ui-manager_*`), CLI, console actions, voice (`ui-manager.say`) |
| s9 | Elements register from every plugin's manifest; new plugins appear on their own |
| s14 | Export any UI as an asset library (ui-library@1) to the hub library and as a package; import into framework / app / project / skin / console |
| **s12** | The window edits a **draft**: each pick hot-renders at once (`POST preview {pending}`), rows say `pending`. Closing the window, leaving the page or Discard resets everything. **Apply…** shows the exit summary (element, property / token, old → new); **Save** writes one ui-change@1 entry, rebased on what is saved now (last save wins per key, `lib/draft.mjs`, tested). **Change log** lists every applied set with its own **Undo**. |
| **s13** | **Live preview**: a floating, movable, resizable window with the console itself in a same-origin frame at the current route, scaled to fit (or 50 / 75 / 100 %). Saved and pending CSS is mirrored in on every change; the selected element is scrolled into view and outlined, so off-screen elements can be seen. The UI Manager's own windows are hidden in the frame, and the frame never opens a preview of its own. |
| s10 | The original ask walked end to end (CLI: tree categories, props, choices snapping 37 → 35 %, set, undo). Build passes. |

## How each piece is reached (API parity)

See `apps/console-web/plugins/ui-manager/README.md` tables. New in this phase:

- Pending / apply: REST `POST preview {pending}`, `POST apply {pending}`; MCP `ui-manager_preview`, `ui-manager_apply`; CLI `ui-manager.mjs preview|apply --pending f`; action `ui-manager.apply` (opens the exit summary), `ui-manager.discard`.
- Change log / undo: REST `GET changes`, `POST undo {id}`; MCP `ui-manager_changes`, `ui-manager_undo`; CLI `ui-manager.mjs changes|undo <id>`; actions `ui-manager.log`, `ui-manager.undo:<id>`.
- Live preview: action `ui-manager.preview[:on|off]` (console_action, `axf console action ui-manager.preview:on`, voice); scale is `previewScale` in the window state.

## Checks

`test.mjs` (16 groups), `check-ui-manager`, `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`,
`check-console-control` (inventory regenerated), `chrome-settings check`, `check-skin-coverage`, `plugin-lifecycle check`,
`tsc --noEmit`, `vite build`: all pass.

Not run here: `theme-swap.mjs` and a screenshot. Playwright isn't installed in this worktree, so CI runs theme-swap.

## Choices made (nobody to ask)

- API `set` / `reset` / voice still save at once: they have no window to Apply in. Only the window drafts.
- The preview is the real console in an iframe, not a re-render: it stays exact for every plugin and screen with no
  second renderer to keep in step. It shares the browser's storage, so it shows the same windows and state.
- The draft lives in the window (browser), not on the server; anyone outside it sends the same document to `preview` /
  `apply`.

## Open gaps

- `uiElements` is not a documented field of `framework/schemas/plugin.schema.json` yet (a contract change, needs Fable).
- Kotlin twin of the UI Manager window: deferred (no new Android work), recorded in `framework/spec/PORTING.md`.
