# UI Review → Screenshots: named, timestamped groups (`shot-groups`, Nov 1 2026)

Headless VPS build, Opus, one session, branch `claude/shot-groups`. Waited for the Screenshots tab build: it never
reached origin/main within the hour while the VPS GitHub token was dead, so its finished local branch
(`claude/shots-tab`, already merged with main) was merged here instead; origin/main got it later and was merged on top.

**Ask (Brett):** UI Review's Screenshots will fill up fast. When Claude sends shots for him it must ask him for a name
and file them in a named, timestamped group so he can find them.

## What landed

| Part | Where |
|---|---|
| Group record (`shot-group@1`): id `g-<date>-<hex>`, name, createdAt, source, session, build, agent, app, note (unknown fields kept). Stored in the same `screenshots/index.json` (`groups: [...]`); every screenshot carries one `group` id. | `web/groups-core.mjs` (+ `.d.mts`), `server/screenshots.py` (mirror) |
| Intake: API `group` (name) / `groupId`; CLI `--group "<name>"` / `--group-id`. Same name (case + spaces ignored) made the **same day** = that group, else a new one; one upload = one group; no name = `<session/build/source> - <YYYY-MM-DD HH:mm>`. Days and times in the console's zone (`AXF_SHOT_TZ`, default America/New_York, rule-based Eastern fallback when the image has no tzdata). A failed upload leaves no empty group. | `server/screenshots.py`, `shots.mjs`, `framework/cli/shot.mjs` |
| Routes: `GET shots` (+ groups), `POST shots/groups` (make / reuse), `shots/groups/update` (rename), `shots/groups/merge {from, into}`, `shots/groups/delete {id, into?}` (with `into` the shots move; without, they are deleted with their files), `shots/move {ids, group \| groupName}`. `shots/update` can't change a group. | `server/screenshots.py` |
| CLI: `shot groups [--q]`, `shot group new\|rename\|merge\|delete [--into]`, `shot move <ids> <group id \| name>`, `shot list --group`. | `shots.mjs` |
| Screenshots tab: opens on the **group list**, newest first: cover thumbnail, name, time + apps, count, source (framework DataGrid, sortable; or a Thumbnails layout); search by name, date (`Oct 31`, `2026-10-31`), app or source. Tap a group → its shots (the existing grid / thumbnails / filters / viewer) under a group head with **Rename**, **Merge** (into another group), **Select** (tap shots, *Move to* a group or a new one) and **Delete** (with its shots; merge to keep them). Upload from the list asks for the group name first (default `Upload - Nov 1 1:20 AM`); inside a group it uploads there. Framework controls (Button, IconButton, TextField, SelectField, Segmented, DataGrid), theme / scale tokens only. | `web/screenshots.tsx`, `web/ui-review.css` |
| Migration: shots without a group are put in `'<title prefix> - <YYYY-MM-DD HH:mm of their first shot>'` groups (one per prefix and day) on the next read and right after the Breakroom item migration, so tonight's check becomes `Breakroom check - 2026-10-31 <time>`. Idempotent. | `assign_groups` / `assignGroups`, `Store.repair` |
| Rule (shared): *Screenshots go in a named group, and Brett names it*: before sending screenshots any Claude session asks him for the group name (card, default like `Breakroom check - Oct 31 8:20 PM`) and sends with `--group`; headless sessions name it after their build. | `_claude/shared/rules/RULES.md` |
| Docs | plugin `README.md` (Groups section, checks), `plugin.json` 0.4.0 |

## Tests

| Check | Before | After |
|---|---|---|
| `python apps/console-web/plugins/ui-review/test.py` | 64 | **89** (+25: zone + Eastern fallback, every shot grouped, auto name, named group per upload, same-day reuse, `groupId`, unknown group refused, failed upload leaves no group, next day = new group, make / reuse route, rename + refusals, move by id / new name + refusals, merge + self-merge refused, update can't change group, delete with / without `into` (files gone), repair of ungrouped shots, Breakroom migration lands in one `Breakroom check - <date time>` group) |
| `npx tsx …/ui-review/test.mts` (Node 20 box; CI uses `--experimental-strip-types`) | 15 | **20** (groups core: names / reuse / zones; rows + search; rename / merge / move; migration; CLI `--group`, `groups`, `group …`, `move`) |
| console `tsc --noEmit` + `vite build` (framework re-baked like CI) | pass | pass |
| `check-theme`, `check-controls`, `check-plugin-pages` | pass | pass |
| `plugin-lifecycle check` (every lifecycle plugin, clean worktree) | pass | pass |
| android.yml node checks (validate, project, fixtures, catalog, axf-server, build-steps, profiles, feature-matrix, builds-store + verify, pending / queue steps, github, libraries, project-wizard) | pass | pass |

**Red on this box, same on clean origin/main (not from this build):** `tracker.mjs --check` (391 items without a
status), `plugins.mjs --check` (asset-browser plan item `x.assets.browser` missing), `session-checkin/test.mjs`
(Node 20 here), plugin tests `claude-handoff`, `context-menu-designer`, `fable-rebuilds`, `feature-assist`,
`plugin-update` (`test.py`) and `basic-filter` (`test.mts`).

## Screenshots

`_claude/memory/docs/ui-review/shot-groups/shots/after/` (demo data: 5 groups, 7 shots; `shots.json` next to it):
groups list (grid, thumbnails, search "breakroom"), an open group, and a group with Rename + Select / Move open; phone
and desktop.

## Known gaps

- Moving a single shot from the full-screen viewer isn't there; use Select in the group.
- A deleted group's shots are deleted (with a confirm that says so); to keep them, merge or `delete --into`.
- The rule can only ask; the console can't tell whether a session asked Brett first.
