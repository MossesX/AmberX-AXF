# Console plugins

Page-level slots (React shell), top to bottom: the banner asset, `app.frame.head` (the app-tabs plugin's tab bar, above the application menu; empty when the console runs inside a host app such as Patches), the application menu bar, `app.frame.banners` (every `AxfWebLibrary.banners` entry lands here in the console, so banners sit above the app tabs and stay visible while another app is open), `app.frame.top` (a page-wide bar under the banners), the layout, then `app.frame.cover` after the shell (the app frames, starting where the page starts, under the menu bar and banners: `--axp-app-tabs-bottom`). <!-- axf-plugin:app-tabs -->
A plugin adds tabs (views, a nav section, dialogs, actions) and, optionally, server routes to the AXF Dev
Console. Each plugin is one folder here. Folders starting with `_` are templates and never load.

```
plugins/<folder>/
  plugin.json          plugin@1 manifest; "targets" must include "axf-console"
  web/index.tsx        exports `plugin: AxfWebLibrary` (same "id" as plugin.json)
  server/__init__.py   optional; exports `router: fastapi.APIRouter`
```

Installed plugins:
`session-checkin` (the questions every new Claude Code session opens with + the Sessions archive; settings tab
"Session check-in") and `project-wizard` (nav → Plugins → New project: a repo, folder or new AXF app becomes a
Claude project with its homes on GitHub / the VPS / a local git folder and a Claude.ai project kit; settings tab
"Project wizard"; engine `wizard.mjs` on top of `framework/cli/claude-project.mjs`, self-test `test.mjs`).

- `mcp-client` — connects the console to other MCP servers through the framework's MCP client library (`framework/libs/mcp` views + `axf_libs/mcp` Python client, Fable rebuild Oct 20 2026); nav → Plugins → MCP servers; settings tab "MCP servers"; data `.axf-console/plugins/mcp-client/`; self-test `test.py`. <!-- axf-plugin:mcp-client -->
- `ai-assistant` — the framework's assistant (assistant@1: `framework/core/assistant.ts`, Fable rebuild Oct 20 2026) in the console: providers from `framework/schemas/ai-providers.json`, setup wizard, chat page + dialog with in-chat settings, live sessions on an open host registry, write-mode approval cards, Claude Code MCP bridge, hub users; provides `axf.llm@1` + `axf.live-sessions@1`, chats as agents via `axf.agents@1`; settings tab "AI assistant"; self-test `test.py` (137). <!-- axf-plugin:ai-assistant -->
- `agent-manager` — agents from personas, lingo, skills and tools with per-agent persistent memory, wizards, training (Firecrawl, URLs, repo, MCP), workflows (streamed runs), add-on agents (Mosses = `coder`, axf-expert, ai-expert); the definition format is the framework contract `agent-definition@1` (`framework/core/agents.ts`); provides `axf.agents@1`; settings tab "Agent manager"; self-test `test.py`. <!-- axf-plugin:agent-manager -->
- `container-access` — the master switch for reaching other VPS containers through a locked-down Docker socket proxy (`deploy/haproxy.cfg`, started by `deploy/install-console.sh`), server-side protected list, audit log and approval-gated change batches; provides `axf.containers@1`; settings tab "Container access". <!-- axf-plugin:container-access -->
- `snapshot-manager` — snapshots of container files before every approved change, diff, one-step restore (itself undoable), retention 30 days / 5 GB; provides `axf.snapshots@1`; settings tab "Snapshots". <!-- axf-plugin:snapshot-manager -->
- `systems-check` — the systems check and What's new banners: checks declared by the codebase (plugins, their services and self-checks, project manifests, shared data) plus the built-ins, and an AI switch (needs the assistant + Mosses) that saves Mosses's checks as a routine that runs without AI; provides `axf.syscheck@1`; settings tab "Systems check". <!-- axf-plugin:systems-check -->
- `console-terminal` — floating terminal windows with tabs (container shells through `axf.containers@1`, the console, the VPS host over SSH, Claude Code), Open terminal on every right-click, mouse mode, copy/paste, Mosh mode, phone keys; xterm vendored in `web/vendor/`; settings tab "Terminal". <!-- axf-plugin:console-terminal -->
- `feature-assist` — plain-English features in the Plan view (AXF expert drafts entries, you approve; plan + pending list) and Build with Mosses on unbuilt features (plan, new build order, model choice incl. Opus now + Fable later, then Mosses builds in the assistant chat); settings tab "Feature assistant". <!-- axf-plugin:feature-assist -->
- `theme-manager` — roll colour/style/layout themes with a token tree (tri-state ticks, locks, presets), live preview, undo/redo, pins, hand edits; save rolls as asset@1 themes and manage them; settings tab "Themes". <!-- axf-plugin:theme-manager -->
- `claude-badge` — tests the AI connection on every load and attaches a Claude badge asset to the banner (green "Powered by <model>" pop-out, or grey "AI unavailable"); settings tab "Claude badge". <!-- axf-plugin:claude-badge -->
- `main-build-status` — a `status` widget on the banner (right, next to the clock) with the last CI result of a branch (default AmberX-AXF · main · android.yml): green “main ✓ 2m ago”, red ✗, accent ⟳ while it runs, grey ? when unknown; tap for the run (title, commit, time, failed jobs, Open on GitHub); repo/branch/workflow are an open list in its settings tab "Main build status"; server `GET /status` (30 s cache, lib-github, token never leaves the server); self-test `test.py`. <!-- axf-plugin:main-build-status -->
- **Inside a host (Patches):** a plugin whose job the host does, or that only draws on chrome the host hides, declares it in its web library (`embed: { skipWhen: ['embedded' | 'take:<fn>' | 'hidden:<type>'] }`); it then isn't loaded on that page and is logged at launch (Settings → Plugins lists it). Standalone it loads as usual.
- `push-banner` — a banner (order 4.8) listing every branch not on main in AmberX-AXF, axHub and Build-Pilot (ahead/behind, age, last commit, its open PR + CI) with **Open PR**, **Merge** (tap twice; only when CI passed, re-checked on the server, head commit pinned, merge commit) and ✕ hide (every device); main is never pushed to directly; shown in Patches through the banner strip; server `GET /branches` (2 min cache), `POST /pr`, `POST /merge`, `GET/PUT /config` (repos, hidden), lib-github; self-test `test.py`. <!-- axf-plugin:push-banner -->
- `alerts-bell` — the developer alerts bell on the banner instead of the toolbar: an `action-button` (bell → `alerts.open`) + a `counter` on `alerts.unread` (hidden at zero, 99+); show/hide and side in its settings tab "Alerts bell"; the alerts library stays in the framework; web-only; self-test `test.py`. <!-- axf-plugin:alerts-bell -->
- `plugin-manager` — the Plugin Manager (Fable rebuild Oct 20 2026): every plugin's health, enable/disable, its UI and settings (opened or shown inline), logs, files, install & uninstall, and dependencies in detail (needs, providers, dependents, clashes) from the cross-port `plugin-inventory@1` engine (`framework/core/engines/plugins.ts` = `server/engine.py` = Kotlin); views cards/table/detail/dependency graph/install in layouts Studio/Mission control/Terminal/Catalog; link in the default context menu; settings tab "Plugin Manager"; self-test `test.py`. <!-- axf-plugin:plugin-manager -->
- `build-manager` — nav → Builds → Build manager: one search bar over three tabs. Remaining: everything still to build (pending, build queue, plan; one row per build), time left, steps, needs split, totals per model, **Start build now** (dependencies first, never on top of a running build, headless Claude Code on the VPS through axHub `vps.run` after approval, then checks). Live: every build any session on any machine reported to axHub (`axf.changes@1`) in real time + the activity feed (`axf.activity@1`). Built: finished builds with time and cost (actual or estimated), totals by model / week. Banner while something builds; settings tab "Build manager"; self-test `test.py` + `test.mjs`. <!-- axf-plugin:build-manager -->
- `codebase-changes` — every request to build, edit, remove or fix something as an entry (change-log@1: what was asked, steps, result) opened by a Claude Code hook (`changes.mjs hooks install`) and filled in by Claude; a banner on every load until each entry is closed (closed everywhere), the permanent log under Builds → Codebase changes, stored on axHub (`/projects/amberx-axf/_data/changes`, never deleted by uninstall); entries carry build stats (estimate, actual tokens + cost, status, heartbeat, surface, host, areas) and are written from any machine straight to axHub; `backfill.mjs` records what was built before; provides `axf.changes@1`; settings tab "Codebase changes"; self-test `test.py` + `test.mjs`. <!-- axf-plugin:codebase-changes -->
- `claude-handoff` — Tools → Claude handoff: builds and keeps current `_claude/handoff/` (everything a new Claude account needs: reading order, claude.ai Project instructions + knowledge, each machine's `~/.claude` copies, claude.ai-only items, secret names) and assembles the one prompt that moves the project to a new account; publishes the kit to GitHub; reminds every 6 h with one banner + one alert (fixed key, overwritten); `handoff.mjs collect` / `hooks install` on each machine; opens the console's **Tools** menu; settings tab "Claude handoff"; self-test `test.py` + `test.mjs`. <!-- axf-plugin:claude-handoff -->
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
- **Application-menu hooks (Oct 21 2026, `core/engines/appmenu.ts`):** `appMenu: [{ id, menu, menuLabel?, menuOrder?, path?, order?, before?, after?, items }]` adds items or whole submenus into a top-level menu (created when missing) or under an item path (`path: ['builds', 'manager']`, missing steps are created). Items are plain menu items plus `badge: '<counter>'` (a `rt.setBadge` counter), `checked: 'setting:<key>' | 'counter:<name>' | 'slot:<type>' | 'hidden:<type>'` (a check mark), `provider: '<id>'` (a live list filled when the submenu opens) and `requires` (UAC). `appMenuProviders: { '<id>': () => items | Promise<items> }` or `{ items, max, moreAction, moreLabel }` registers live lists (built-in ones every app has: `views`, `nav`, `toolbar`, `settings`, `windows`, `dialogs`, `chrome`). The runtime equivalents are `rt.addAppMenuItems`, `rt.removeAppMenuItems(module | id)`, `rt.registerAppMenuProvider`, `rt.appMenu()`; contributed items with an action are found by the global search (kind `menu`). Same id from two plugins = the later wins + a diagnostic. Everything leaves with the plugin.
- **Console menu entries live in `web/menu.ts` (Oct 21 2026):** the console hides its toolbar and side navigation by default, so its app menu (asset `console`: Console, Builds, Framework, Plugins, Apps, View, Help) must reach everything. Every plugin with a page, dialog or settings tab exports `appMenu` from a pure `web/menu.ts` (no React/CSS imports) and installs it in `index.tsx` (`appMenu,`); one entry in **Plugins** (order 50) plus, where it fits, one in another menu (Builds, Apps, View, Console, Help). Live lists are exported string constants registered under `appMenuProviders: { [CONST]: … }`. Use `nav:<view>` for pages, so the check can see them. `npx -y tsx apps/console-web/scripts/menu-reach.mts` (CI) fails when a nav entry, toolbar item or page isn't in the menu, a live list isn't registered, or a plugin with UI has no entry. The template ships an example.
- **UI-editing plugins** declare `"uiEditor": ["theme" | "style" | "layout" | "manager" | "builder"]` in `plugin.json`. Saves are per key and the last save wins; call `useEditorSync({ onRefresh })` (from `@console/axf/react`) in every editing view so it reloads current token values whenever it opens, loads or comes back into focus.

## How it runs

- **Web part:** bundled into the console at build time (Vite). Import the framework and helpers as
  `@console/axf/react`, `@console/axf/react/library` and `@console/plugins`. A `nav` section appears after
  the console's own navigation; swapping the nav-menu asset keeps it.
- **Server part:** loaded when the console API starts and mounted at `/api/plugins/<folder>/`. Call it from
  the web part with `pluginFetch(folder, path, init)`, which adds the console token.
  For JSON calls use `pluginApi(folder, label)` (also from `@console/plugins`, Oct 2026): `const api = pluginApi(FOLDER, 'The x plugin')`
  gives `api.call/post/put/patch/del/download/blob` with the console token and the standard messages (401 → "Console token
  required (Settings → Account & security).", 404 without detail → "<label> is disabled or its server part is not running.",
  otherwise the server's `detail`; errors are `ApiError` with `.status`). It's the framework's API client library
  (`@console/axf/libs/apiclient`); don't copy a `call()` wrapper into a plugin. Event streams: `readSse(response, onFrame, signal)`
  or `followSse(open, onFrame)` (reconnects with back-off) from `@console/axf/core/sse`.
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
- **Framework helpers for server parts (Oct 20 2026):** a plugin's Python may import the framework's shared server
  package `axf_server` (`framework/python/axf_server`): `import axf_framework` (puts framework/python on the path),
  then `from axf_server import storage, http` — private files (`storage.write_json/read_json/append_jsonl`: atomic,
  0600, folders 0700) and outbound HTTP (`http.request`: https only, no redirects or credential-stripping ones, size
  cap, timeout). Framework imports are fine under plugin-lifecycle@1; importing another plugin's folder never is.
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
