# Console speed: profile and cut the load (console-speed-profile-and-cut-axf-console-cpu-pl)

Built Nov 10 2026 on Opus, branch `claude/console-speed-profile-and-cut-axf-console-cpu-pl`.

Brett, Nov 10 2026: "The console is mad slow. Ridiculous slow. How do I make this faster? ... I guess."

## What was actually slow
The console itself was not the problem. Measured 03:34-03:40 UTC:

- `axf-console` container: **0.2 % CPU idle, 205-270 MB** with no browser open; its busiest caller in the log is the
  merge queue (`ui-hold`, about 37 calls a minute, a cheap in-memory lookup). No runaway timer, watcher or SSE loop in
  the container. The 74 % seen at 02:46 was with the console open; the container restarted at 03:29, so those logs are
  gone (see "Endpoint timings" for what an open console costs).
- The **host** was choking: load 24-29 on **4 CPUs**, CPU idle **0 %**, **11 processes blocked on disk**, 15 % I/O wait,
  swap 2.9-3.4 / 4 GB, and disk `/` at **100 %** (191 / 193 GB; build worktrees 96 GB in 205 folders).
- Worst offender: the **Maintenance snapshot** (`/etc/cron.d/axf-maintenance`, every 10 min). One run took
  **84 minutes** (`tookMs` 5,068,379): it ran `du` over all 205 worktrees, then `du` of `/root/axf-builds`, `/root` and
  `/opt` again. Each of those big `du` calls hit its 120 s timeout, and the code then **walked the whole tree again in
  Python**. With no lock, cron started a new one every 10 minutes: **12 copies were running at once**, all crawling the
  same 96 GB. That was most of the disk wait the console (and everything else) was stuck behind.
- Headless builds: 3-5 at a time, each a Claude session plus test runs, vite builds and Playwright, with nothing keeping
  them from taking the CPU, disk and swap the console needs.

## What changed
1. **Maintenance snapshot can't stack or crawl any more** (`plugins/maintenance/engine/maint.py`, `deploy/host.sh`)
   - One run at a time: an in-process `flock` on `<data>/snapshot.lock`, and the cron line itself now runs under
     `flock -n /run/axf-maintenance.lock timeout 1800`.
   - **Size cache** (`<data>/sizes.json`): a folder size is reused for an hour (six hours for folders that take more
     than a minute to measure, like `/root`); after 4 minutes of fresh measuring in one run, known sizes are reused even
     if stale, so a run stays bounded however many worktrees exist. Clean-up runs never use the cache: they always
     measure fresh (approved-plan safety is unchanged).
   - A `du` that times out no longer falls back to a Python walk; a `du` that exits 1 because a file vanished mid-scan
     (normal in live worktrees) still uses the total it printed.
   - Big areas (`/root`, `/opt`, `/root/axf-builds`) get a 15-minute `du` timeout instead of 2 minutes, so they get a
     real number once, then come from the cache.
   - The snapshot reports `sizeCache` (hits, measured, measuring time).
2. **Builds can't starve the console** (`deploy/claude-headless.sh`)
   - Every headless session runs in its own systemd scope under `axfbuild.slice`: MemoryHigh 2.5 GB, MemoryMax 4 GB
     (an OOM kills that session, never the console), MemorySwapMax 512 MB, and the slice gets CPU/IO weight 20 against
     the console container's 100, with 10 GB MemoryHigh for all builds together. Plus `nice -n 10` and `ionice -c2 -n7`.
   - Without systemd or root, sessions just run under nice/ionice. `AXF_BUILD_LIMITS=off` turns it off; sizes come
     from `AXF_BUILD_MEM_HIGH`, `AXF_BUILD_MEM_MAX`, `AXF_BUILD_SWAP_MAX`, `AXF_BUILDS_MEM_HIGH`.
3. **Heavy steps** (`framework/cli/agent-slots.mjs heavy`)
   - Node gets `--max-old-space-size=1536` unless the step sets its own (`heavyNodeHeapMb`, 0 = off).
   - Playwright/browser steps also take a browser lock: **one at a time** (`maxBrowser`, default 1).
4. **Console CPU/RAM on the Maintenance page** (Console → Server health): a "Console CPU" gauge and a line
   "Console: CPU x % of one core (y % of the server) · RAM z MB", read live from the console's own cgroup (no Docker
   access needed, costs one file read).
5. **Second VPS plan** for Brett to decide: `_claude/plans/build-vps.md` (options, cost ranges, dispatch over SSH,
   git/worktrees, accounts). Nothing bought.

## Before / after
| | Before | After |
|---|---|---|
| Maintenance snapshots running at once | 12 | 1 at most (lock) |
| Snapshot run time | 84 min, 12 overlapping | cold (empty cache, idle I/O class, under load): about half of 216 worktrees measured when I stopped it at 11 min (no finished cold figure); after that, sizes are reused for 1 h (6 h for /root, /opt), and fresh measuring is capped at 4 min a run |
| Host CPU idle (vmstat) | 0 % | 60-64 % |
| Processes blocked on disk | 11 | 0-1 |
| Load average (1 min) | 24-29 | 15.5 a minute later, 16-18 under builds |
| Maintenance test suite | over 4 min (it measured the real `/root/axf-builds`) | 6 s |

The "after" host numbers are from right after the stacked snapshots were stopped (03:38) with the same builds
running. The build caps apply to sessions started after this merges.

## Endpoint timings (s2: what an open console costs)
Every GET route without parameters (268 from `/openapi.json`), timed one by one at 03:55 with 3-5 builds running:
228 answered, **49 took over 0.3 s, 12 over 1 s**. The slowest real (non-stream) ones:

| Route | Time | Why |
|---|---|---|
| `/api/plugins/agent-swarm/jobs` | 9.2 s | spawns `node swarm.mjs list` per request |
| `/api/plugins/plugin-manager/inventory` | 8.3 s | not checked |
| `/api/plugins/ref-links/targets` | 4.4 s | |
| `/api/plugins/systems-check/ai/state` | 3.8 s | |
| `/api/plugins/whats-shipped/feed` | 2.5 s | |
| `/api/plan` | 1.8 s | |

These load when their tab opens rather than on a timer, so they make screens feel slow rather than burning CPU in
the background. They were timed on a host at load 16-20, so part of each figure is waiting for CPU and disk; how much
is still to be measured on a quiet host. The short browser timers
(`setInterval` under 5 s) are clocks or "only while this dialog is open" checks; the Terminal's 2 s meter poll already
reuses one SSH connection (`ControlPersist`).

Not done (follow-ups): a logged-in browser profile of request counts per open page (the container restarted at 03:29,
so the 74 % window can't be replayed from its log, and Playwright isn't installed in this worktree); caching
`agent-swarm/jobs` and `plugin-manager/inventory` server-side.

## Done on the VPS now (not only in the PR)
- Stopped the 12 stacked snapshot runs (they only measure; nothing is lost).
- Added `flock -n … timeout 1800` to the live `/etc/cron.d/axf-maintenance`, the same line `host.sh up` now writes.

## Needs Brett
- **Disk is full** (100 %, 1.8 GB free). The Maintenance page's clean-up can free about 7.4 GB of finished
  worktrees (19 of 205) plus 0.4 GB of Docker; the other 186 worktrees are kept because they have unpushed work or a
  live session. Console → Server health → Clean-up, approve the plan.
- **Second VPS**: pick an option in `_claude/plans/build-vps.md`.

## How to reach it (API)
- Console CPU/RAM: `GET /api/plugins/maintenance/console`, and `console` in `GET /api/plugins/maintenance/status`;
  the Maintenance plugin's `console` command (MCP console actions, CLI, AmberX voice through `forFramework`); deep link
  `console_open` target `maintenance` (the existing Server health page, view `main`).
- Build limits: `AXF_BUILD_LIMITS` and the size env vars on the launcher; heavy-step limits:
  `node framework/cli/agent-slots.mjs set maxBrowser=1 heavyNodeHeapMb=1536` (and the agent-slots REST/MCP settings).

## Tests
- `apps/console-web/plugins/maintenance/test.py`: 116/116 (size cache, lock, cron line, `du` timeout and vanished
  files, console cgroup reader, `/console` route).
- `deploy/claude-headless-limits.test.mjs`: 9/9 (scope + caps as root with systemd, nice/ionice otherwise, off switch).
- `deploy/claude-workers.test.mjs` 72 (launcher end to end), `plugins/agent-slots/test.py` 19/19.
- `tsc --noEmit` (console-web), check-theme, check-controls, check-toolbars, check-chrome-assets,
  plugin-lifecycle check maintenance: all clean.
