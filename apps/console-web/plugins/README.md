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
- `agent-manager` — agents from personas, lingo, skills and tools with per-agent persistent memory, wizards, training (Firecrawl, URLs, repo, MCP), workflows, add-on agents (Mosses = `coder`, axf-expert, ai-expert); provides `axf.agents@1`; settings tab "Agent manager"; self-test `test.py`. <!-- axf-plugin:agent-manager -->
- `container-access` — the master switch for reaching other VPS containers through a locked-down Docker socket proxy (`deploy/haproxy.cfg`, started by `deploy/install-console.sh`), server-side protected list, audit log and approval-gated change batches; provides `axf.containers@1`; settings tab "Container access". <!-- axf-plugin:container-access -->
- `snapshot-manager` — snapshots of container files before every approved change, diff, one-step restore (itself undoable), retention 30 days / 5 GB; provides `axf.snapshots@1`; settings tab "Snapshots". <!-- axf-plugin:snapshot-manager -->
- `systems-check` — the systems check and What's new banners: checks declared by the codebase (plugins, their services and self-checks, project manifests, shared data) plus the built-ins, and an AI switch (needs the assistant + Mosses) that saves Mosses's checks as a routine that runs without AI; provides `axf.syscheck@1`; settings tab "Systems check". <!-- axf-plugin:systems-check -->
- `console-terminal` — floating terminal windows with tabs (container shells through `axf.containers@1`, the console, the VPS host over SSH, Claude Code), Open terminal on every right-click, mouse mode, copy/paste, Mosh mode, phone keys; xterm vendored in `web/vendor/`; settings tab "Terminal". <!-- axf-plugin:console-terminal -->
- `feature-assist` — plain-English features in the Plan view (AXF expert drafts entries, you approve; plan + pending list) and Build with Mosses on unbuilt features (plan, new build order, model choice incl. Opus now + Fable later, then Mosses builds in the assistant chat); settings tab "Feature assistant". <!-- axf-plugin:feature-assist -->
- `theme-manager` — roll colour/style/layout themes with a token tree (tri-state ticks, locks, presets), live preview, undo/redo, pins, hand edits; save rolls as asset@1 themes and manage them; settings tab "Themes". <!-- axf-plugin:theme-manager -->
- `claude-badge` — tests the AI connection on every load and attaches a Claude badge asset to the banner (green "Powered by <model>" pop-out, or grey "AI unavailable"); settings tab "Claude badge". <!-- axf-plugin:claude-badge -->
- `plugin-switches` — a pop-up dialog listing every plugin with an on/off switch; its own switch is greyed out; asks before switching off a plugin a running plugin needs; opened from the default context menu, action `plugin-switches.open`, search, or its settings tab "Plugin switches". <!-- axf-plugin:plugin-switches -->

WebSockets in a plugin: get a one-time ticket from `POST /api/ws-ticket` (`{"path": "/api/plugins/<folder>/…"}`, 30 s, single use) and connect with `?ticket=` (the console token never goes in a URL). Banners: `AxfWebLibrary.banners`. Items on every context menu: `rt.contextExtras.set('*:<owner>', (target, payload) => [...])`. Boxes inside a view: `AxfWebLibrary.slots` (`<Slot name=… />`, e.g. the Plan view's `plan.top` / `plan.feature`). Start an assistant chat from anywhere: action `ai.chat.start:<uri-encoded JSON {agentId, message, title, profileId?, model?}>`.

Start a plugin: `cp -r plugins/_template plugins/<folder>`, then edit `plugin.json` (id, name, description,
`lifecycle.dataDir`), the `id`, `FOLDER` and views in `web/index.tsx`, the routes in `server/__init__.py`, and the
folder name in `install.mjs` / `uninstall.mjs`.

## Sharing and installing (plugin-catalog@1)

The plugin catalog on axHub (`/projects/_shared/_data/plugin-catalog`) holds plugins other consoles and apps can install.
Plugin Manager → **Install** publishes a plugin from this console (its folder only: no data, no secrets, no
node_modules) and installs or updates ones from the catalog (unpacked here, lifecycle install, committed to GitHub so
the console rebuilds with it). From a terminal: `node framework/cli/plugin-catalog.mjs publish apps/console-web/plugins/<folder> --kind console`
(where `/projects` is mounted) or add `--console https://console.amberxai.com` with `AXF_TOKEN` set. A published
version never changes: raise `version` in plugin.json to publish new code. Keep everything a plugin needs inside its
folder, as the lifecycle rules already require, and it installs cleanly anywhere.

Page-level slots (React shell): `app.frame.top` renders above everything, `app.frame.cover` after the shell (e.g. the app-tabs plugin's tab bar and app frames). <!-- axf-plugin:app-tabs -->

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
6. **Settings live under Settings → Plugins.** A plugin's `settingsTabs` become sub-tabs of the Plugins tab (the
   console sets `parent: 'plugins'` on every plugin tab); open one with `rt.dispatch('settings.open:<tab id>')`.
7. **Ship `install.mjs` and `uninstall.mjs`** (thin wrappers around `framework/cli/plugin-lifecycle.mjs`), optional
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

## Menus and UI editors

- **Menu links are contributions, not asset edits:** `contextMenu: [{ id, target: 'default', items }]` on the `AxfWebLibrary` adds items to a context-menu target (`default` = right-click / long-press anywhere). They leave with the plugin (disabled or removed), so no asset ever names a plugin.
- **UI-editing plugins** declare `"uiEditor": ["theme" | "style" | "layout" | "manager" | "builder"]` in `plugin.json`. Saves are per key and the last save wins; call `useEditorSync({ onRefresh })` (from `@console/axf/react`) in every editing view so it reloads current token values whenever it opens, loads or comes back into focus.

## How it runs

- **Web part:** bundled into the console at build time (Vite). Import the framework and helpers as
  `@console/axf/react`, `@console/axf/react/library` and `@console/plugins`. A `nav` section appears after
  the console's own navigation; swapping the nav-menu asset keeps it.
- **Server part:** loaded when the console API starts and mounted at `/api/plugins/<folder>/`. Call it from
  the web part with `pluginFetch(folder, path, init)`, which adds the console token.
- **Enable / disable:** Framework → Plugins. A disabled plugin's tabs disappear and its server routes answer
  404. The choice is kept in the console state file. Plugins are enabled unless `"enabledByDefault": false`.
- **Hub users (`"wallUsers": true`, Oct 18 2026):** behind axHub's sign-in wall the console trusts the wall's
  headers only when axHub signed them (`X-Auth-Sig` with the shared wall secret; `AXF_TRUST_WALL=1` + `AXF_WALL_SECRET`, set by the installer) — a signed-in hub **admin** counts as the console token
  everywhere; a hub **user** reaches only plugins whose plugin.json says `"wallUsers": true`, and the installer
  opens `/api/plugins/<folder>/` to them at the wall. Such a plugin must limit users itself from
  `request.state.axf_user` (`server/wall.py`: `Caller.name/role/perms`, `can("x.y")`, `assistant.*` wildcards).
  Browser-session writes must come from the console's own origin (the core refuses cross-site ones).
- **Grantable to users (`"userGrantable": true`, Oct 18 2026):** an admin may hand a plugin to one hub user by ticking
  `console.plugin.<folder>` on the hub's users page (exact name; wildcards never open a plugin). Only declare it when
  **every** route of the plugin is safe for a non-admin (the theme manager and the Claude badge are; anything that
  touches secrets, containers, files on the host, git or other services is not). Plugins without it stay admin-only
  whatever is granted. `wallUsers` plugins are open to every user and check each one themselves.
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
