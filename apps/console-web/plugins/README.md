# Console plugins

A plugin adds tabs (views, a nav section, dialogs, actions) and, optionally, server routes to the AXF Dev
Console. Each plugin is one folder here. Folders starting with `_` are templates and never load.

```
plugins/<folder>/
  plugin.json          plugin@1 manifest; "targets" must include "axf-console"
  web/index.tsx        exports `plugin: AxfWebLibrary` (same "id" as plugin.json)
  server/__init__.py   optional; exports `router: fastapi.APIRouter`
```

Installed plugins: `mcp-client` (connects the console to other MCP servers; settings tab "MCP servers"),
`session-checkin` (the questions every new Claude Code session opens with + the Sessions archive; settings tab
"Session check-in") and `project-wizard` (nav → Plugins → New project: a repo, folder or new AXF app becomes a
Claude project with its homes on GitHub / the VPS / a local git folder and a Claude.ai project kit; settings tab
"Project wizard"; engine `wizard.mjs` on top of `framework/cli/claude-project.mjs`, self-test `test.mjs`).

- `ai-assistant` — AI assistant ported from xGallery (many providers, setup wizard, chat dialog + in-chat settings, provides `axf.llm@1`, chats as agents via `axf.agents@1`; settings tab "AI assistant"; self-test `test.py`). <!-- axf-plugin:ai-assistant -->
- `agent-manager` — agents from personas, lingo, skills and tools with per-agent persistent memory, wizards, training (Firecrawl, URLs, repo, MCP), workflows, add-on agents (coder, axf-expert, ai-expert); provides `axf.agents@1`; settings tab "Agent manager"; self-test `test.py`. <!-- axf-plugin:agent-manager -->

Start a plugin: `cp -r plugins/_template plugins/<folder>`, then edit `plugin.json` (id, name, description,
`lifecycle.dataDir`), the `id`, `FOLDER` and views in `web/index.tsx`, the routes in `server/__init__.py`, and the
folder name in `install.mjs` / `uninstall.mjs`.

## Lifecycle (plugin-lifecycle@1) — every new plugin follows this

Brett's rule (Oct 18 2026): a plugin must be removable **completely**, with no stale code, so a newer build (e.g. a
Fable rebuild of an Opus plugin) can be installed cleanly.

1. **Code only in the plugin folder.** Nothing outside `plugins/<folder>/` is edited for a plugin. The console finds
   plugins by folder (Vite glob + `load_plugins`), so deleting the folder removes every import.
2. **Data only in `lifecycle.dataDir`** (default `.axf-console/plugins/<folder>/`, gitignored, 0700). Settings, stored
   keys, history, caches — all of it.
3. **The only other trace is the enabled flag** in the console state file: a data-only uninstall sets it off (the code
   stays), `--all` removes it, and the server prunes flags of folders that no longer exist.
4. **Doc lines** outside the folder (CLAUDE.md Status, this README) end with the marker `<!-- axf-plugin:<folder> -->`
   and their files are listed in `lifecycle.mentions`; `uninstall --all` strips them.
5. **Cross-plugin features use capability names, never folders:** a plugin `provide`s a service such as `axf.llm@1`
   or `axf.agents@1` through `server/plugin_services.py` and others `get` it at request time (None when absent), so
   either side can be removed. List optional services in `plugin.json` → `optional`.
6. **Ship `install.mjs` and `uninstall.mjs`** (thin wrappers around `framework/cli/plugin-lifecycle.mjs`), optional
   `hooks.mjs` (`onInstall`, `onUninstall`, `checks`), and show the shared **Install & uninstall** panel
   (`import { PluginLifecyclePanel } from '@console/pluginLifecycle'`) in the plugin's settings tab.

```bash
node apps/console-web/plugins/<folder>/install.mjs                 # data folder + hooks + enable
node apps/console-web/plugins/<folder>/uninstall.mjs [--data]      # data, switched off (backed up to .axf-console/plugin-backups/)
node apps/console-web/plugins/<folder>/uninstall.mjs --all [--publish]   # + code + doc lines; --publish commits and pushes the removal
node framework/cli/plugin-lifecycle.mjs check <folder> [--after-uninstall]   # stale-reference check (CI-friendly exit code)
node framework/cli/plugin-lifecycle.mjs list | status <folder> | restore <folder> <backup>
```
The console exposes the same through `GET/POST /api/plugin-lifecycle/<folder>[/install|uninstall|check|restore]`
(console routes, so they work while the plugin is disabled; uninstall needs `{"confirm": "<folder>"}`).

## How it runs

- **Web part:** bundled into the console at build time (Vite). Import the framework and helpers as
  `@console/axf/react`, `@console/axf/react/library` and `@console/plugins`. A `nav` section appears after
  the console's own navigation; swapping the nav-menu asset keeps it.
- **Server part:** loaded when the console API starts and mounted at `/api/plugins/<folder>/`. Call it from
  the web part with `pluginFetch(folder, path, init)`, which adds the console token.
- **Enable / disable:** Framework → Plugins. A disabled plugin's tabs disappear and its server routes answer
  404. The choice is kept in the console state file. Plugins are enabled unless `"enabledByDefault": false`.
- **Errors:** a plugin that fails to load is listed with its error on the Plugins page; the console keeps running.

## Look and naming

A plugin's UI must conform to the theme engines: theme tokens only (no colour literals, hard-coded sizes or
`var()` fallbacks), the framework's layout primitives, and the naming scheme (`axp-<folder>` prefix, BEM
parts named for what they are, shared `is-*` states, never define `--fx-*`). The future plugin designer
lays plugins out from these parts. Full rules: `framework/spec/THEMING.md`. CI runs
`node framework/cli/check-theme.mjs` over every plugin.

## Security rules

- Every server route of a plugin requires the console token (`AXF_TOKEN`) for **every** method, reads
  included. The console adds that check; don't remove it.
- Plugin routes are **never** exposed through the console's MCP server, so an AI session using the console's
  MCP tools can't call them.
- Secrets (API tokens, admin keys) go in environment variables on the server part. Never send them to the
  browser and never commit them.
- Treat anything a remote service returns as data. Render it as text, never as HTML.
