# Bugs board (`bugs-board`, Current profile)

Agent: Reel Rhonda (no Polo card on the roster). Model: Opus. Branch `claude/bugs-board`.

## What Brett said (verbatim, Nov 4 2026, voice)

> "Do we have a confirmed bugs list?" -> "Yep, and I want to be able to drag and drop and arrange them. And show which builds they're part of. And if they're part of a build that's being run, and what line it is in the queue. And all that good stuff. I want to be able to move it from one build to another one." ... "I need an auto-optimize switch, which will move the bugs to appropriate builds that are either in queue or in process."

Addendum 1 (voice): "Anytime a bug is moved to a different build, put in the group chat whatever agent is assigned. Be like, yo, I'm sending it over. And they gotta be like, all right, or yo, I don't have time for that shit right now, send it to somebody else. Then it'll pop up, or it will automatically send it to somebody else: yo, can you handle it, G? Yeah, I got you, dog."

## What was built

New console plugin `apps/console-web/plugins/bugs-board/`:

| Piece | Where |
| --- | --- |
| bug@1 / bugs@1 core (pure): changes, newer-wins merge with tombstones, optimizer, handoff rules + template lines, board groups, build chips | `web/bugs-core.mjs` |
| CLI + Node API: file under a lock, published to main, mirrored to the console checkout, build context (store + agent-slots + crew), side effects | `bugs.mjs` |
| REST `/api/plugins/bugs-board/` (`board`, `optimize`, `banner`, `act`) + capability `axf.bugs@1` | `server/__init__.py` |
| MCP `bugs_list`, `bug_add`, `bug_update`, `bug_move`, `bug_reorder`, `bugs_optimize` | `apps/console-web/server/mcp_server.py` |
| Board UI (lazy-loaded), banner count, context menu, Settings → Plugins → Bugs | `web/index.tsx`, `web/ui.tsx`, `web/data.ts`, `web/bugs-board.css` |
| Sidecar publish to main (generic, `_claude/builds/*.json` only) | `framework/cli/builds-live.mjs` `publishSidecar`, `mainFile` |

### Storage
`_claude/builds/bugs.json` (bugs@1) sits next to the builds store. Every write takes a lock, then is published to main as a
status-only `[skip ci]` commit through `builds-live.mjs publishSidecar` (same plumbing as the store: private index, fetch +
re-merge when main moves, never a force push) and merged into the console's checkout (`/opt/axf`). Reads pull main at most
once a minute. Merge is newer-wins per bug (`updatedAt`); deletes are tombstones so a merge never brings a bug back.

### Board (s2)
- Grouped by build (build title, live chip, agent avatar, Open build) then Unassigned, Fixed, Won't fix; or one List.
- Chips: **Running** · agent · step x/y; **Queued** · #n in line (agent-slots queue); Paused/Blocked; **Built · awaiting merge #PR**; **Merged #PR**; Pending · step x/y.
- Drag by the grip (pointer events, so finger, pen and mouse all work): drop on a row = reorder above it (and move to that row's build), on a group = move into that build, on "Mark fixed" = fixed. While dragging, empty target builds show as drop zones. Multi-select drags them all.
- Right-click / long-press a bug: Move to build…, New build from bug, Open build (ref@1), Mark fixed, Edit.
- Filters: status (Open / All / Fixed / Won't fix), app, profile. Banner chip: open bugs · unassigned · need you.

### Moving a bug into a build (s3)
1. Addendum on the build's origin (build-origin@1) with the bug and Brett's words.
2. A `Fix bug <id>: <title>` step (Opus, 30 min, the bug's files) on the build via the orchestrator (found by capability `service:orchestrator@1`); taking the bug off removes that step again (only while not done).
3. If the build is running in tmux, the session is told (send-keys).
4. When the build's PR merges (status complete), its open bugs are marked fixed with the PR on the next read.

### Auto-optimize (s4)
Zero tokens. Scores each unassigned bug against every queued or running build: words shared with the title/brief/steps
(title words count double), app (+3), area/tag words (+2 each), files the build touches (+4, same folder +2), running
builds win ties. Never into built/complete/archived/hidden builds or a build in its last step (PR/merge/CI), never over
`maxPerBuild` (default 3). Scope = the active build profile (setting: every profile), skips builds untouched for 21 days.
Optimize… shows the preview with reasons; Apply runs every move through the handoff; Undo reverses the batch. The switch
(default off) re-runs on every new bug and when a bug is put back. The "Ask AI" switch is there, off by default; the
button itself is not built yet (gap below).

### Group-chat handoffs (Addendum 1)
Every move posts in the crew group chat (capability `service:axf.crew@1`, the console's room even from a worktree):
the sender (the source build's agent, else Boss) tags the target build's agent; the agent answers from zero-token
template lines: accepts when the build has room, isn't finishing and the agent works and isn't broke, else bounces. A
bounce goes to the next best build ("Yo @X, can you handle it, G?" → "Yeah, I got you, dog.") until one accepts or
`bouncesBeforeAsk` (3) is reached; then the bug goes back to Unassigned with **needs you** and the best builds as
one-tap buttons. Setting **When bounced**: Auto-reroute (default) / Ask Brett. A drag by Brett stands ("Aight, boss's
call."). Builds with no agent yet: Boss parks it there. Tone: street (default) / clean; chat on/off.

### Seed (s5)
The 8 confirmed bugs of Nov 4, linked as Brett listed them (hotfix-build-manager ×2, terminal-no-focus, land-round-2,
app-style-override, 3 unassigned). Published to main (`5f587e6d6`). hotfix-build-manager merged since, so its two bugs
show as fixed on the next read. One more added from this build: builds-live duplicated a new build's steps on main
(below).

## Checks
- `node apps/console-web/plugins/bugs-board/test.mjs`: 10 groups, all pass (wired into CI, android.yml).
- `apps/console-web/server/test_mcp_tools.py`: 198 checks pass (bugs tools registered, read-only flag, add → list).
- REST through FastAPI TestClient: add, board, banner, optimize, bad action/filter → 400.
- Side effects against a scratch store + scratch swarm: step added/removed, addendum, chat accept, bounce → reroute.
- `tsc --noEmit` clean; check-theme, check-controls, check-toolbars, check-plugin-pages, menu-reach, help-coverage --check pass; plugin-lifecycle check clean (no other plugin's folder name in this one).

## Found on the way
- **builds-live duplicate steps:** minutes after `bugs-board` was added, main held it with 14 steps (7 fresh uids plus
  the originals renamed s8-7…s14-13), and every live publish from this checkout was refused (merged store not valid:
  duplicate live step uids). Fixed here by deduping the local record and making it newest; logged on the board as
  `b-builds-live-a-new-build-s-steps-` (unassigned, high). Suspect: a per-profile export absorbed without uids.

## Gaps
- "Ask AI" for unclear matches: only the switch. The button (axf.llm@1, costs tokens) is still to build.
- "When the queue changes" re-run is done on reads and new bugs, not by a queue watcher.
- tmux nudge only reaches sessions on the host that runs bugs.mjs (not from inside the console container).

## Screenshots
`_claude/builds/reports/bugs-board/shots/after/` (phone + desktop), filed to UI Review (non-blocking).
