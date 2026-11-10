# Project Manager: every project its own console instance (`project-manager-every-project-its-own-console-in`)

Phase 1 (Opus), Nov 10 2026. Branch `claude/project-manager-every-project-its-own-console-in`.

## Brett asked (verbatim)

> Build the project manager so everything can be its own project, its own instance of the console. A setting to enable
> multi-project view, the entire console appears in that group with each project's console running. A project type: one
> for development of itself or framework tools like the console, one for creating new apps using all the tools in the
> console. The new app will actively render in a preview window, a floating or dockable section.

## What was built

New console plugin `apps/console-web/plugins/project-manager` (project-manager@1):

- **Projects.** Create, open, rename, switch, close, remove. Every project is its own console instance: the console
  opened with `/?project=<id>`. That instance shows a project bar (name, type, folder, data folder). Each project gets
  its own `builds/`, `notes/` and `data/` folders under `.axf-console/plugins/project-manager/projects/<id>/`. The Dev
  Console itself is the built-in project `console`.
- **Types.** `framework` (Framework / self development: the console building itself, or framework tools; root = the
  repo) and `app` (New app: `apps/<id>` gets a project-manifest@1 so the console's build tools pick it up).
- **Multi-project view (setting).** When it is on, a framework TabGroup sits above the application menu with every open
  project. Each project's console runs in its own frame and stays loaded while you switch tabs. Layout `tabs` shows one
  at a time; `split` shows them all side by side. The frames load with `pm-embed=1`, so a framed console never draws
  another tab group or preview inside itself.
- **Live preview.** A window that shows the app being built: floating (drag, resize), docked right or bottom, or a
  full-screen sheet on a phone. It shows the active project, or a project you pick. The URL is the project's
  `previewUrl` (http(s):// or a console path).
- **Active-project banner.** Shows the active project while the multi-project view is off. It also makes the plugin
  load first, so the tab group and the preview window are there from startup (`KNOWN_BANNERS` in `src/lazyEngine.ts`).
- **Capability `axf.projects@1`** (server): `list`, `get`, `active`, `data_dir(id, kind)`, `of_request(request)`.
  Other plugins can use it to put their builds, notes and data under the project a console instance belongs to.

## How each part is reached (API rule)

| Feature | UI | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|
| List / read projects | Project Manager page | `GET /api/plugins/project-manager/projects[/<id>]`, `/api/control/project-manager/list` | `project-manager_list`, `_get` | `projects.mjs list`, `axf project-manager list` | through the MCP tools (AmberX → console) |
| Create | New project | `POST …/projects` | `project-manager_create` | `projects.mjs create <name> --type app\|framework` | same |
| Rename / change | Rename / Preview URL | `POST …/rename`, `POST …/update` | `_rename`, `_update` | `projects.mjs rename <id> <name>`, `update` | same |
| Switch / close tab | Switch to, tab row | `POST …/open`, `POST …/close` | `_open`, `_close` | `projects.mjs open\|close <id>` | same |
| Remove | Remove | `POST …/delete` (confirm) | `_delete` (destructive) | `projects.mjs delete <id> [--data]` | same |
| Multi-project view + layout | switch, tab row buttons, Console ▸ Projects | `PUT …/settings` | `_set-settings`, action `project-manager.multi` | `projects.mjs multi on\|off --layout tabs\|split` | same |
| Live preview | buttons, switch, window toolbar | `POST …/preview` | `_preview`, actions `project-manager.preview\|preview-dock\|preview-float` | `projects.mjs preview on\|off --mode float\|dock --side right\|bottom --project <id>` | same |
| Deep link | — | `console_open project-manager`; a project's console: `/?project=<id>` | `console_open` / `console_show` | `axf console open project-manager` | same |

The open console checks the store every 5 s, so a change made through the API shows there within a few seconds.

## Checks

- `node apps/console-web/plugins/project-manager/test.mjs`: 9 passed (also added to CI, android.yml).
- `python3 apps/console-web/plugins/project-manager/server/test_project_manager.py`: routes + capability, ok.
- check-theme, check-controls, check-toolbars, check-chrome-assets, plugin-commands check, plugin-lifecycle check: pass.
- `tsc --noEmit` (console-web): 0 errors.
- Failures that are already on main and not from this build: `help-coverage --check` (98.3%, from claude-accounts'
  help.json), `menu-reach` (shipped-features, glossary-index, demo-designer, book-builder pages) and
  `lazy-loader-check` (shipped-features missing from KNOWN_BANNERS).

## Screenshots

Taken with `framework/cli/rebuild-shots.mjs` (scratch API + Vite, hub off): Project Manager page (desktop, phone),
the New project form, the multi-project view with the Recipe Box console running in its tab (desktop, phone), and the
live preview floating and docked right. Sent to UI Review (see the PR).

## Gaps / next

- The other plugins (Builds, Notes …) don't yet put their own data under the project. A project's console instance
  knows its project and has its own data folders; `axf.projects@1` is how they would scope by project. Each plugin
  needs to adopt it. The console's shared `pluginFetch` could also send `X-AXF-Project` (framework change, not made
  here).
- The New app type writes the manifest only. It doesn't start a dev server: set the project's preview URL to where the
  app runs.
- The active-project banner may be hidden by Banner settings on a fresh console. Turn it on under Banner settings.
- Android / Kotlin twin: not needed (a console-only plugin, no framework/core engine changed).
