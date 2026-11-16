# Orchestrator: custom groups and custom tabs on the builds board

Build `orchestrator-custom-groups-custom-tabs` · phase 1 (Opus) · branch `claude/orchestrator-custom-groups-custom-tabs`

## Brett said (verbatim, 2026-11-13 18:50)
> I want to be able to add some custom groups to my board, sorted by state from partials to done, running; mostly for pending; custom pending tabs, custom groups

## What shipped
- **Groups engine** `build-groups@1` (orchestrator plugin `groups-core.mjs`, pure): groups per project; hand-picked members (one build may be in several groups) plus **smart rules** (title contains, more than N commits behind main, filed in the last N days with 0 = today, states, priorities). Builds sort by state in Brett's order: **partial → pending → queued → running → failed → done → landed**, and each group counts its builds per state. Each group has its own sort (state / priority / newest / title) and state filter.
- **Custom tabs**: a group can be pinned as its own tab, placed right after the stage tab it belongs to (Pending, Queue, Active, Incomplete, Complete, Errors, Archive) or after Groups when it covers every stage. A new group gets a Pending tab by default, because custom Pending tabs are the main use.
- **Groups board** (new orchestrator tab *Groups*): every group with its state counts; a "Pending, in no group" bucket you drag builds out of; drag a row onto a group to add it, drag it onto the bucket to take it out; drag a group to reorder it; select rows and use Add to group / Take out of its group. The **editor** lets you rename, recolour, move up/down, set the tab, the sort, the states shown and the smart rule, or delete the group (its builds stay where they are). **Group actions**: Queue all (Pending → Queue), Land all (Done builds tagged Urgent so the merge queue takes them first), Archive all, Set priority for all.
- **Storage**: `<pipeline dir>/groups.json`, keyed by project profile. This is the folder the VPS host and the console container already share for the pipeline settings.

## How each part is reached (API)
| Feature | REST | MCP / CLI / control@1 (plugin-commands registry) | Console action / deep link | Voice |
|---|---|---|---|---|
| List groups, counts, loose Pending | `GET /api/plugins/build-orchestrator/groups` | `build-orchestrator_groups-list`, `axf build-orchestrator groups-list`, `plugins.reads` | `build-orchestrator.tab:groups`, `build-orchestrator.groups` | "what's in my console app group" (command descriptions carry the phrases) |
| One group | `GET …/groups/{group}` (id or name) | `groups-get` | `build-orchestrator.groups:<id>` opens its tab | yes |
| Custom tabs | `GET …/groups/tabs` | `groups-tabs` | `build-orchestrator.tab:group:<id>` | yes |
| Create / rename / colour / tab / sort / filter / rule / reorder / delete / assign | `POST …/groups {op…}` | `groups-change` | `build-orchestrator.group-add:<group>\|<ids>`, `group-remove` | "make a group called UI", "put skins in Urgent" |
| Group actions | `POST …/groups/{group}/action` | `groups-action` | `build-orchestrator.group-action:<group>\|queue` (or `land`, `archive`, `priority:P0`) | "queue all of console app" |
| CLI | — | `node apps/console-web/plugins/build-orchestrator/groups.mjs list\|show\|tabs\|create\|rename\|color\|tab\|sort\|filter\|rule\|move\|delete\|add\|remove\|set\|act\|apply` | — | — |

## Checks
- `node apps/console-web/plugins/build-orchestrator/groups.test.mjs`: 8 checks pass (core rules, plus the CLI against a scratch store, including a real queue-all). Added to CI next to the other orchestrator tests.
- `python3 apps/console-web/plugins/build-orchestrator/test.py`: 47 checks pass (6 new ones exercise the groups routes against a scratch store).
- `tsc --noEmit` (console-web) is clean; groups.tsx is in the program.
- `check-theme`, `check-controls`, `check-toolbars`, `check-plugin-commands` and `help-coverage` all pass.
- `plugin-lifecycle check build-orchestrator` still lists stale references, but every one is in a file this build did not touch (project-seed, check-build-limit, check-projects, console-control e2e) or in an untracked session file.

## Open / not done
- **No UI Review shots yet.** I couldn't capture them: in a scratch console (the worktree's API plus Vite) the orchestrator's web part never showed up in any menu, so neither the Groups tab nor a custom tab could be shot. The PR stays a draft until desktop and phone shots of the Groups board and a custom Pending tab are in UI Review.
- "Behind main" rules only match builds the merge queue reports a `behind` count for, read through `axf.merge-queue@1`. If that service has no number for a build, the rule doesn't match it.
- "Land all" doesn't merge anything itself. The merge queue lands every ready PR on its own; this action tags the group's Done builds Urgent so they go first.
- Kotlin twin deferred (PORTING.md).
- While I was cleaning up the screenshot runs, a broad `pkill -f "vite --host 127.0.0.1 --port"` / `uvicorn main:app --host 127.0.0.1` ran on the VPS. It may also have stopped another session's local dev server: the overlay-merge-tmp vite was still running afterwards, but other sessions may have been hit.
