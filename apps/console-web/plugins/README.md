# Console plugins

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
- `ai-keys` — dialog keeping several Anthropic API keys and Claude subscription tokens (each tested before it's saved, stored 0600, never sent to a browser) and picking the active one of each kind; the AI assistant uses the active key through `axf.ai-keys@1`; settings tab "AI keys". Subscription tokens are access + refresh pairs validated together, kept fresh, and the active pair is written to the VPS's `~/.claude/.credentials.json` (directly, else by Vinny through axHub). <!-- axf-plugin:ai-keys -->
- `main-build-status` — a `status` widget on the banner (right, next to the clock) with the last CI result of a branch (default AmberX-AXF · main · android.yml): green “main ✓ 2m ago”, red ✗, accent ⟳ while it runs, grey ? when unknown; tap for the run (title, commit, time, failed jobs, Open on GitHub); repo/branch/workflow are an open list in its settings tab "Main build status"; server `GET /status` (30 s cache, lib-github, token never leaves the server); self-test `test.py`. <!-- axf-plugin:main-build-status -->
- **Inside a host (Patches):** a plugin whose job the host does, or that only draws on chrome the host hides, declares it in its web library (`embed: { skipWhen: ['embedded' | 'take:<fn>' | 'hidden:<type>'] }`); it then isn't loaded on that page and is logged at launch (Settings → Plugins lists it). Standalone it loads as usual.
- `push-banner` — a banner (order 4.8) listing every branch not on main in AmberX-AXF, axHub and Build-Pilot (ahead/behind, age, last commit, its open PR + CI) with **Open PR**, **Merge** (tap twice; only when CI passed, re-checked on the server, head commit pinned, merge commit) and ✕ hide (every device); main is never pushed to directly; shown in Patches through the banner strip; server `GET /branches` (2 min cache), `POST /pr`, `POST /merge`, `GET/PUT /config` (repos, hidden), lib-github; self-test `test.py`. <!-- axf-plugin:push-banner -->
- `changes-grid` — Changes & features grid (Builds → Changes & features): every change from the Codebase changes log (through `axf.changes@1`) and every plan feature in one grid; rows titled with the thread/request name + date and time, expandable to steps, result, branch, commits, links (changes) or status, ports, files, acceptance, history (features); show both / changes / features, search, sort; stores nothing; self-test `test.py`. <!-- axf-plugin:changes-grid -->
- `feature-matrix` — Feature matrix (Builds → Feature matrix, next to the Build orchestrator; also the `builds.toolbar` button on the Builds pages): every build's keep / skip list (feature-matrix@1: grouped items with minutes, model, why; never deleted) as one dataset of expandable rows (build, profile, date added, time cost of kept items, kept / skipped, needs apply, last applied); Apply pushes skips + estimates to every table the build lives in (orchestrator, pending, build queue, plan, change log through `axf.changes@1`) with the framework's Apply engine; a row hook (grid-hook@1, lib-datagrid) on every builds grid; files `_claude/builds/[profiles/<id>/]matrices.json` mirrored to its data folder; CLI `matrix.mjs`; self-test `test.mjs` + `test.py`. <!-- axf-plugin:feature-matrix -->
- `build-breaker` — Build Breaker (Builds → Build Breaker; also the `builds.toolbar` button): everything Brett asked for across the project (build-asks@1), one line per ask (plain title, date + time, status badge with icon, build time · cost · model), grids per app and per plugin in two collapsible containers, plus a flat Timeline; search, status / model / date filters, sort, group-by, expand / collapse all; a row opens to the plain description, his own words, sources, branch / PR links and the build's row hooks (feature matrix). Adds a permanent **Build** item to every context menu listing every build page that exists. Seed `data/asks.jsonl` (JSON Lines) merged with its data folder copy; CLI `asks.mjs add | set-status | list | check`; server `GET asks`; self-test `test.mjs`. <!-- axf-plugin:build-breaker -->
- `alerts-bell` — the developer alerts bell on the banner instead of the toolbar: an `action-button` (bell → `alerts.open`) + a `counter` on `alerts.unread` (hidden at zero, 99+); show/hide and side in its settings tab "Alerts bell"; the alerts library stays in the framework; web-only; self-test `test.py`. <!-- axf-plugin:alerts-bell -->
- `plugin-manager` — the Plugin Manager (Fable rebuild Oct 20 2026): every plugin's health, enable/disable, its UI and settings (opened or shown inline), logs, files, install & uninstall, and dependencies in detail (needs, providers, dependents, clashes) from the cross-port `plugin-inventory@1` engine (`framework/core/engines/plugins.ts` = `server/engine.py` = Kotlin); views cards/table/detail/dependency graph/install in layouts Studio/Mission control/Terminal/Catalog; link in the default context menu; settings tab "Plugin Manager"; self-test `test.py`. <!-- axf-plugin:plugin-manager -->
- `build-manager` — nav → Builds → Build manager: one search bar over three tabs. Remaining: everything still to build (pending, build queue, plan; one row per build), time left, steps, needs split, totals per model, **Start build now** (dependencies first, never on top of a running build, headless Claude Code on the VPS through axHub `vps.run` after approval, then checks). Live: every build any session on any machine reported to axHub (`axf.changes@1`) in real time + the activity feed (`axf.activity@1`). Built: finished builds with time and cost (actual or estimated), totals by model / week. Banner while something builds; settings tab "Build manager"; self-test `test.py` + `test.mjs`. <!-- axf-plugin:build-manager -->
- `codebase-changes` — every request to build, edit, remove or fix something as an entry (change-log@1: what was asked, steps, result) opened by a Claude Code hook (`changes.mjs hooks install`) and filled in by Claude; a banner on every load until each entry is closed (closed everywhere), the permanent log under Builds → Codebase changes, stored on axHub (`/projects/amberx-axf/_data/changes`, never deleted by uninstall); entries carry build stats (estimate, actual tokens + cost, status, heartbeat, surface, host, areas) and are written from any machine straight to axHub; `backfill.mjs` records what was built before; provides `axf.changes@1`; settings tab "Codebase changes"; self-test `test.py` + `test.mjs`. <!-- axf-plugin:codebase-changes -->
- `claude-handoff` — Tools → Claude handoff: builds and keeps current `_claude/handoff/` (everything a new Claude account needs: reading order, claude.ai Project instructions + knowledge, each machine's `~/.claude` copies, claude.ai-only items, secret names) and assembles the one prompt that moves the project to a new account; publishes the kit to GitHub; reminds every 6 h with one banner + one alert (fixed key, overwritten); `handoff.mjs collect` / `hooks install` on each machine; opens the console's **Tools** menu; Tools → Installer preview (runs with example data) and Installer look… (layouts, gauge/meter styles, light/dark themes, roll with a token tree; saved on axHub); settings tab "Claude handoff"; self-test `test.py` + `test.mjs`. <!-- axf-plugin:claude-handoff -->
- `todo-manager` — Todos (ported from xGallery's developer task manager): lists with nested groups holding notes, to-dos and tasks (subtasks, checklists, tags, due dates, custom fields per kind), a tree (by lists, kind, status, priority, tag or due date) or a grid, group actions (done, status, move, duplicate, delete), Markdown export; what each kind must / may hold is set in its settings tab "Todo manager"; data `.axf-console/plugins/todo-manager/store.json` (todo-store@1); **tabable** (Patches can give it a tab); self-test `test.py`. <!-- axf-plugin:todo-manager -->
- `voice-notes` — a settings interface (Settings → Plugins → Voice notes) and a tabable **Voice notes page** that fetches the notes Voice Vault saved (table `voice-notes/notes`), for a voice-activated notes pusher: start / stop / list-of-lists / cancel triggers (typed or recorded), beep, recording limits, the "where should I store it" prompt, numbered lists with subcategories and question sets opened by a number or a recorded trigger, and a conversation preview. Settings and lists live on axHub through lib-hubstore (`settings/voice-notes.json`, table `voice-notes/lists` in the amberx-axf hub project), nothing on the console server or in the browser; the listener is Voice Vault on Android; self-test `test.py`. <!-- axf-plugin:voice-notes -->
- `hub-sync` — Settings → Plugins → axHub sync: the framework's lib-hubsync with the lifecycle panel. Connect to axHub (address, project, test, sign in), choose what syncs (look always / follow / off, settings, data all or some tables), status. The console already takes its look from axHub, so here it adds its settings (`shared/settings/apps/<app>.json`) and data. Web-only, no server part; self-test `test.py`. <!-- axf-plugin:hub-sync -->
- `plugin-switches` — a pop-up dialog listing every plugin with an on/off switch; its own switch is greyed out; asks before switching off a plugin a running plugin needs; opened from the default context menu, action `plugin-switches.open`, search, or its settings tab "Plugin switches". <!-- axf-plugin:plugin-switches -->
- `basic-filter` — a Sort & filter dialog (search, rules on any column, match all / any, multi-level sort) attachable to any dataset (every lib-datagrid grid); attached datasets get its toolbar (default: one Sort & filter button) designed in its settings tab "Basic filter" (show / hide, preset actions in a grid with expandable rows, live floating preview); attach from there or its row in Plugin switches; web-only; self-test `test.mts`. <!-- axf-plugin:basic-filter -->
- `brand-library` — nav → Plugins → Brand library (also View → Look → Brand library…): the framework's brand library (`framework/brand-library/`: 250 logos, 250 animated logos, 100 icon packs, 50 branding packages for AmberX + GizmoX) in tabs Logos · Animated logos · Icon packs · Branding packages, one search bar, brand + style filters, a virtualised tile wall (only visible rows are drawn); a preview pane (light / dark, 16–96 px, animation replay) with **Apply** / **Set as brand** (a branding package becomes the brand; a logo, animated logo or icon pack goes into the active brand as a derived `bl-…` package) and **Copy id**; the last brand applied is re-applied on load; server `GET /index`, `/assets/<type>`, `/closure/<type>/<id>`, `GET/PUT /config` (the library is read-only, never bundled); settings tab "Brand library"; self-test `test.py` + `test.mts`. <!-- axf-plugin:brand-library -->
- `context-menu-designer` — Plugins → Context menu designer: create, edit, name, rename and save context menus; **chunks** (Save as chunk) are reusable pieces inserted into menus by name (items, separators, other chunks), each with its own style (font, size, weight, style, text / background / hover colours) or the menu's (Inherit); a floating live preview re-renders on every change; a saved menu becomes context-menu asset `ctxd-<id>` (Use as the context menu, or Appearance). Designs in `.axf-console/plugins/context-menu-designer/designs.json` (0600). <!-- axf-plugin:context-menu-designer -->

WebSockets in a plugin: get a one-time ticket from `POST /api/ws-ticket` (`{"path": "/api/plugins/<folder>/…"}`, 30 s, single use) and connect with `?ticket=` (the console token never goes in a URL). Banners: `AxfWebLibrary.banners`. Items on every context menu: `rt.contextExtras.set('*:<owner>', (target, payload) => [...])`. Boxes inside a view: `AxfWebLibrary.slots` (`<Slot name=… />`, e.g. the Plan view's `plan.top` / `plan.feature`). Start an assistant chat from anywhere: action `ai.chat.start:<uri-encoded JSON {agentId, message, title, profileId?, model?}>`.

Start a plugin: `cp -r plugins/_template plugins/<folder>`, then edit `plugin.json` (id, name, description,
`lifecycle.dataDir`), the `id`, `FOLDER` and views in `web/index.tsx`, the routes in `server/__init__.py`, and the
folder name in `install.mjs` / `uninstall.mjs`.

## Tabable plugins (plugin@1 `tabable`, Oct 22 2026)

Every plugin.json says whether a host app (Patches) may add the plugin to its tab group: `"tabable": false` (the
default, and what every plugin with a page starts as), `true` (its first page) or `{"view": "<id>", "label": "…",
"icon": "…"}` (that page, which must be a `view:<id>` it provides). A plugin without a page (settings only) can't be
tabable. The console reports each plugin's tab to its host with its plugin list; the host shows it as the console's
view page (`?axf-embed-page=view:<id>`: only that page, no chrome, settings still taken by the host). Patches lists the
tabable ones in Settings → Patches → Tabs → **Add tab…**. Checked by `node framework/cli/plugins.mjs --check` (CI) and
the console's plugin loader (a wrong `tabable` is reported as the plugin's error).

## Plugins with a banner (plugin@1 `banner`, Oct 23 2026)

Every plugin.json says whether the plugin includes a banner (the live banners above every page): `"banner": false`, or
the ids of the banners its web library contributes (`"banner": ["my-banner"]`). `node framework/cli/plugins.mjs --check`
(CI) checks the list against the plugin's `banners: [...]` in `web/`, and the console loader refuses a wrong value.
Every declared banner gets the shared banner settings in its tab of Settings → Plugins → Banners (and Banner settings,
and Patches' Banners tab): **Hide** (the banner is hidden but stays mounted, so the plugin keeps working and its
activity is still logged to the terminal), **Hide all banners** under it (tooltip lists every banner it hides) and
**Hide for … minutes** (a hide lasts that long, then the banner shows again). One state for every interface; the last
change wins.

## Sharing and installing (plugin-catalog@1)

The plugin catalog on axHub (`/projects/_shared/_data/plugin-catalog`) holds plugins other consoles and apps can install.
Plugin Manager → **Install** publishes a plugin from this console (its folder only: no data, no secrets, no
node_modules) and installs or updates ones from the catalog (unpacked here, lifecycle install, committed to GitHub so
the console rebuilds with it). From a terminal: `node framework/cli/plugin-catalog.mjs publish apps/console-web/plugins/<folder> --kind console`
(where `/projects` is mounted) or add `--console https://console.amberxai.com` with `AXF_TOKEN` set. A published
version never changes: raise `version` in plugin.json to publish new code. Keep everything a plugin needs inside its
folder, as the lifecycle rules already require, and it installs cleanly anywhere.


## Who built it, where it opens, one instance (plugin@1 `builtWith`, `opens`; Oct 23 2026)

Every plugin.json says which model built it: `"builtWith": { "model": "opus", "builtAt": "2026-10-23" }` (fable, opus,
sonnet, haiku; optional `rebuildOf`, `replaces`, `branch`). The build engine requires it (build-defaults@1 rules in
`framework/schemas/build-defaults.json`, applied by `framework/cli/build-defaults.mjs` at install, catalog pack/install,
`plugins.mjs --check` and the console loader) and fills `opens` (`"main"` for a plugin with a view or dialog, `false`
without one). Users pick where a plugin opens in its settings (**Opens in**: main area, floating window, dialog, tab
group). A model badge shows wherever plugin info appears. Only **one instance** of a plugin is ever installed: the same
id, a `builtWith.replaces` link, the same folder once `-fable`/`-opus`/`-plugin` is taken off, or the same name is the
same plugin, and a second one is refused (`framework/cli/plugin-instances.mjs`). A build by another model replaces the
installed one in place: **Plugin Update** → Replace (`plugin-catalog.mjs swap <folder>`). New plugins from `_template`
fill in `builtWith` before they install.

**Plugins menu** (right-click → Plugins): Install… browses every archive location (axHub is permanent and needs its token; add folders, https servers or other consoles with their credentials, kept on the console server only) and installs through `plugin-catalog.mjs install-package`; Settings… is one browser over every plugin's settings tab. <!-- axf-plugin:plugins-menu -->

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

**A plugin inherits the app's style** (Oct 22 2026): every button, tab, chip and toggle is a framework control
(`<Button tone size icon>`, `<IconButton>`, `<Segmented>`, `fx-chip`, `fx-tab`, `fx-menu__item`), so changing the
app's button asset, style theme or spacing restyles the plugin too; a whole row or card you tap is marked
`data-fx-row`. Your own class on a control only lays it out. CI runs `node framework/cli/check-controls.mjs`.

**Its own theme override** (Oct 28 2026; `framework/libs/plugintheme`): every plugin gets **Settings → Plugins →
<plugin> → Appearance** without code of its own (the console wraps each plugin with `withPluginTheme`). The Theme
override switch and its container hold every layout / colour / style / animation token (form, token tree, JSON, copy
from another plugin or a theme asset, reset, preview), stored as `axf.plugin.<plugin id>.look = { on, tokens }` and
applied as CSS variables on every root of the plugin's UI, which the console marks `data-axf-plugin="<plugin id>"`
(pages, dialogs, window and tab-group tabs, settings tab and panels). The app's theme stays the base. Switch it from
right-click inside the plugin, the toolbar button or Plugins ▸ All plugins ▸ <plugin> ▸ Theme override. So: keep using
theme tokens only; a plugin never sets `--fx-*` itself (the override is the user's, applied by the framework), and a
plugin that renders into a portal outside its roots (`document.body`) should put `data-axf-plugin` on that portal root
too if it wants the override there.

## Security rules

- Every server route of a plugin requires the console token (`AXF_TOKEN`) for **every** method, reads
  included. The console adds that check; don't remove it.
- Plugin routes are **never** exposed through the console's MCP server, so an AI session using the console's
  MCP tools can't call them.
- Secrets (API tokens, admin keys) go in environment variables on the server part. Never send them to the
  browser and never commit them.
- Treat anything a remote service returns as data. Render it as text, never as HTML.
