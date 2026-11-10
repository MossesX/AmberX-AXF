# One VPS plugin: everything VPS in one place

Build `one-vps-plugin-everything-vps-in-one-place-gauge`, phase 1 (Opus), Nov 10 2026.
Branch `claude/one-vps-plugin-everything-vps-in-one-place-gauge`.

## Brett said

> Is there a plugin that shows the VPS status, like its load and disk space? I need gauges and meter widgets for the VPS: load, RAM usage, swap usage, hard drive space, with different views. Various cleanup options. Put it in maintenance, a server maintenance tab. Add a banner widget. In the banner widget, if it's icon only, I want the colours to represent the load and the space: start with white, go up to gray to black, then all the way up to red, representing low or high. Move all the other VPS stuff over to that plugin. I want it all in one plugin. When you click the banner items, it's a drop-down menu showing all the gauges, each with a dot in the same colour as the gauge, the text, the percentage and what it is.

## Decision: the Maintenance plugin is the VPS plugin

Maintenance already owned clean-up (approved on axHub), the disk and swap alerts, the Server health row and the live
disk / memory / swap / load readings. Building a second plugin next to it would have duplicated all of that, so the
Maintenance plugin (folder `maintenance`, same data folder, same id) became **VPS & maintenance**. That matches
"put it in maintenance" and leaves no duplicate.

## What was built

| Part | Where |
|---|---|
| Tabs Status · Clean-up · Space · VPS tools · Build profiles (framework TabGroup, last tab remembered) | `web/index.tsx` |
| Nav: Plugins → **VPS** (opens Status), Plugins → Maintenance (opens Clean-up); app menu Console → VPS | `web/index.tsx`, `web/menu.ts` |
| Status tab: load 1/5/15 against the CPU count, RAM, swap, every real filesystem, Docker per-container CPU/RAM, top processes. Views radial / bars / strip / history sparklines, switchable and remembered on the server; warning / high thresholds | `web/vps.tsx`, `server/gauges.py` |
| Banner widget: one badge per chosen gauge; modes icon only, icon + value, icon + mini meter; own settings (gauges, mode, side, refresh) | `web/vps.tsx` `paintBanner` |
| Icon-only heat colour: smooth mix between stops, default white → gray → black → red (`--fx-text` → `--fx-muted` → `--fx-bg` → `--fx-danger`). Stops editable (Settings → Plugins → VPS & maintenance → Heat colours); each stop is a theme token, so a theme recolours it | `vpsmodel.ts` `heatCss`, `gauges.py` `heat_mix` |
| Dropdown on any banner gauge: every gauge, dot in its heat colour, name, %, values (e.g. 9.4 / 16 GB) and what it is; live; the tapped one highlighted; footer Open VPS plugin + Quick clean-up | `web/vps.tsx` `VpsDrop` |
| New clean-up jobs: stopped containers (check first; restart-policy and Coolify containers kept), apt/npm/pip caches (safe), old Playwright browsers (check first; newest per browser kept), stale git locks (safe; never while git runs). Existing: worktrees, dangling images + build cache, logs + journal vacuum, /tmp, Created containers. Each previews size, needs a confirm (axHub approval), shows space freed | `engine/maint.py` |
| Auto-cleanup over a disk threshold, off by default; at most hourly; still approved on axHub | `server/__init__.py` `auto_clean` |
| Finished clean-up runs go into the fix log (`axf.changes@1`) once each | `server/__init__.py` `log_fixes` |
| VPS tools tab: slot `vps.tools` (claude-badge VPS login check, agent cap + memory guard + queue, container access contribute to it) plus every view / settings tab about the server, found by what it says it is | `web/vps.tsx` `ToolsTab` |

## How each part is reached without the UI

| Feature | REST (console API) | MCP / CLI / voice |
|---|---|---|
| Gauges (all metrics, %, values, heat, level, history, containers, top) | `GET /api/plugins/maintenance/gauges` | plugin command `gauges` (`maintenance_gauges`) |
| View, thresholds, banner widget, heat stops | `GET` / `PUT /api/plugins/maintenance/vps/settings` | `vps-settings`, `set-vps-settings` |
| Clean-up jobs, preview, run, runs | `GET jobs`, `POST preview`, `POST run`, `GET runs` | `jobs`, `preview`, `run`, `runs` |
| Auto-cleanup, job ages | `PUT /settings` (`autoClean`, `autoCleanPct`, `autoCleanJobs`, `exitedDays`, `gitLockMinutes`) | `set-settings` |
| Open a tab | console action `vps.tab.status` / `cleanup` / `space` / `tools` / `profiles`, view `vps` | `console_open` / `console_show` target |
| Banner dropdown | actions `vps.drop.<metric>`, `vps.drop.close`, `vps.drop.state`, `vps.read` | console actions |

Plugin commands are `auto: true`, so the CLI, MCP tools and AmberX voice pick them up from `plugin.json`.

## Tests

- `python3 apps/console-web/plugins/maintenance/test.py`: 112/112 (was 96; new: every new job's preview on scratch
  folders, filesystems, metrics, docker stats, top processes, VPS settings validation, heat scale, `GET /gauges`,
  `PUT /vps/settings`, auto-clean off by default).
- `tsc --noEmit` clean. `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` pass.
  `plugin-lifecycle check` clean for maintenance, claude-badge, container-access (agent-slots only flags an untracked
  live-preview focus file).
- `scripts/menu-reach.mts` lists unknown pages from other plugins (glossary-index, demo-designer, book-builder,
  shipped-features); present on main, nothing from this build.

## Not done in this phase / gaps

- **UI Review screenshots** (desktop and phone) were not taken in this session: there was no time left for a console
  build plus Playwright run. The PR says it waits on them.
- **Moving the rest physically.** The claude-badge VPS check, agent cap and container access now show inside the VPS
  plugin through the `vps.tools` slot; their original screens still exist (a plugin is removable, so its code stays in
  its own folder). Coolify / Hostinger links, the VPS terminal shortcuts, ai-keys VPS sync and the running-builds
  watchdog are listed in VPS tools by discovery, not yet contributed to the slot. The claude-badge VPS badge still
  sits on the banner beside the new widget.
- **Toolbars and title bars:** the widget is a banner widget; title bars that draw the banner strip show it (and its
  heat colours) too. A separate toolbar host was not added.
- **Theme override of the stops:** the stops are theme tokens, so a theme's colours flow through; a theme cannot yet
  set its own stop list (that would need a new token family in the framework, Fable territory).
- Android twin: none (no new Android work).
