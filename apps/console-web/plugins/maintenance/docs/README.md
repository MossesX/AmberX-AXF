# Maintenance plugin

Server health and safe clean-up for the VPS (Hostinger, Coolify + Traefik, Docker). Plain code, no AI.

Open it from **Plugins → Maintenance** or **Console → Server health and clean-up**.
Settings are in **Settings → Plugins → Maintenance**.

## What it shows

- Disk, memory, swap and load, with gauges.
- The biggest space users: logs, /tmp, build worktrees, home folders, Docker images, volumes and build cache.
- Every build worktree in `/root/axf-builds` and `/home/axfbuild/wt-*`, its size and whether it can go.
- Each clean-up job, how many items it would take and how much space that frees.

## Clean-up jobs

| Job | Safe for nightly | What it removes |
| --- | --- | --- |
| Finished build worktrees | no | Worktrees merged into main or fully pushed, idle 24 h, no tmux session or process. Logs and briefs are copied to `/root/axf-builds/_archive` first. Uncommitted or unpushed work is always kept. |
| Dangling Docker images and build cache | yes | Untagged images no container uses, build cache unused for 24 h. |
| Old logs | yes | Rotated logs in `/var/log` and build logs older than 14 days, journal beyond 14 days. |
| /tmp leftovers | yes | Entries in `/tmp` and `/var/tmp` untouched for 7 days. |
| Containers stuck in Created | yes | Containers created but never started, older than 1 h. |

Never touched: running, paused or restarting containers, Docker volumes, app data, symlinks, open files,
the working folder of any running process, and anything outside those folders.

## How a run works

1. **Preview.** Tick jobs and tap Preview. You see every item, its size and why, and what is kept.
2. **Send for approval.** The console writes the plan (with a fingerprint) and sends one held `vps.run`
   call to axHub. Nothing is removed yet.
3. **Approve on axHub** (or your phone). axHub runs `engine/maint.py run <id> --sha <fingerprint>` on the VPS.
4. **Re-check.** The engine plans every job again and removes an item only if it is still in the approved
   plan and still passes every rule. Anything now in use or changed is skipped.
5. The result (removed, skipped, failed, space freed) shows under **Runs**.

## Alerts

- Disk at 80% (warning, bell), 85% (error, bell + phone) and 90% (critical, bell + phone).
- Swap at or above 90% for 15 minutes (error, bell + phone).
- One alert per level change; it clears by itself once things are back to normal.

## Nightly auto-clean

Off by default. When on, the console sends the safe jobs to axHub at the set hour. It is still a held call,
so it waits for approval like any other run.

## Systems check and Home

- Systems check row **Server health** (service VPS). **Auto fix** sends the safe clean-up for approval.
- Home suggests a **Server disk** card (from the `summary` read).

## Commands (API, MCP, CLI)

Every route is a plugin command (`forFramework: true`, so Molly gets voice commands too):

| Command | Kind | What |
| --- | --- | --- |
| `status` | read | health, alert levels, last run |
| `summary` | read | short numbers (Home card, voice) |
| `snapshot` | read | the full measurement |
| `jobs` | read | jobs, safe flags, what each would free |
| `preview` | read | what given jobs would remove |
| `run` | command | send a clean-up to axHub for approval |
| `runs` | read | runs and results |
| `settings` / `set-settings` | read / command | the settings |
| `check` | command | check health now |

REST `/api/control/maintenance/<command>`, MCP `maintenance_<command>`, CLI `axf maintenance <command>`.

## Host part

`deploy/host.sh up` (run by `deploy/install-console.sh`) installs `/etc/cron.d/axf-maintenance`, which runs
`python3 engine/maint.py snapshot` every 10 minutes at low priority. It writes to the plugin's data folder
(`.axf-console/plugins/maintenance/`) in the checkout the console already mounts. Without it, the page shows
only disk, memory, swap and load.

On the VPS you can also run the engine yourself:

```bash
python3 apps/console-web/plugins/maintenance/engine/maint.py snapshot
python3 apps/console-web/plugins/maintenance/engine/maint.py preview --jobs docker,logs
```

## Uninstall

`node apps/console-web/plugins/maintenance/uninstall.mjs --all`. The cron line deletes its own file on the
next tick once the plugin folder is gone.

## Tests

`python apps/console-web/plugins/maintenance/test.py`
