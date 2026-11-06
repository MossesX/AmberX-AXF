# ui-registry@1 and the UI shortcuts plugin

Build `ui-registry-shortcuts` (Nov 6 2026, Fable, PR #369). Full report: `_claude/builds/reports/ui-registry-shortcuts.md`.

- **Contract:** `framework/core/engines/ui-registry-rules.mjs` (typed face `ui-registry.ts`, fixture `spec/fixtures/ui-registry.json`,
  checker `spec/check-ui-registry.mjs`). Asset type `ui-registry`, one per app at `src/assets/ui-registry/<app>.json`. Item =
  `<kind>:<key>` id, label, aliases, owner (`app | framework | plugin:<folder> | library:<id>`), exactly one `open`
  (`view | dialog | settings(+anchor) | action | url | element(+click) | menu`).
- **Scanner / CI:** `node framework/cli/ui-registry.mjs generate|check|scan|list|search|get|say|open|coverage|voice` (`axf ui …`).
  Scans plugin manifests, web code (`views`, `dialogs`, `settingsTabs`, `nav`, `rt.actions.register`, `openDialog`, every
  `<Button>/<a>/<Link>` with `data-axf-ui` or `data-help`), `web/menu.ts`, active menu / toolbar assets, declared
  `ui-registry.json` (plugin or app; `source: declared|authored` items survive regeneration). CI fails on unregistered UI.
- **Opening:** `uiOpenCommand(item)` = a control@1 console command (console-commands@1); element items run the framework action
  `ui.open:<item id>` in the open app (registered by the UI shortcuts plugin in the console).
- **Plugin:** `apps/console-web/plugins/ui-shortcuts` — dialog `ui-shortcuts`, actions `ui.open`, `ui-shortcuts.dialog`,
  `ui-shortcuts.say`, MCP `ui-shortcuts_say|open|items|item|shortcuts…` (plugin-commands@1), REST `/api/plugins/ui-shortcuts/*`,
  capability `ui-registry@1`, user shortcuts in its data dir, `GET /voice` in voice-command@1 shape (PR #323 can take it in).
- **Traps (Nov 6):** framework CLIs find the plugin by capability (never by folder; the lifecycle check flags names);
  generated registry assets are exempt from the stale-reference scan and regenerated on `uninstall --all`; a new asset type
  needs every app re-baked (`rebake.mjs apply apps/<app>`); `TextField` / `Switch` take no `data-help` (help ids = label slugs);
  tappable rows = `<button className="fx-menu__item">`, not a `<Button>` grid; a locked worktree index is worked around with
  `GIT_INDEX_FILE=/tmp/x.index` + `git read-tree HEAD`.
