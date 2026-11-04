# terminal-vps-host (Current profile, Opus, Nov 3 2026)

Agent: Ping Paulie (the all-rounder router is not on this checkout).

## What was broken
`GET /api/plugins/console-terminal/headless` answered `{ready:false, items:[], why:"the VPS tab isn't set up"}`: the
Terminal had no VPS host and no SSH key, so the headless tabs (PR #259) could not list or attach to any build's tmux
session, and the meters could not read cost.

## Live fix (on the VPS, no redeploy)
- Generated the Terminal's dedicated ed25519 key through the plugin's own `store.keygen()` inside `axf-console`. It lives
  in the plugin's dataDir, `/opt/axf/.axf-console/plugins/console-terminal/ssh/` (0600, folder 0700).
- Host `172.16.1.1` (the gateway of Coolify's network = the VPS host as seen from the console), user `root`, port 22.
- Public key appended to `/root/.ssh/authorized_keys` as `from="172.16.0.0/12" ssh-ed25519 … axf-console-terminal`
  (only accepted from Docker networks; backup `authorized_keys.bak-terminal-vps-host`).

## Persistence
The dataDir is under `/opt/axf/.axf-console/`, which `deploy/install-console.sh` always bind-mounts into the console
(`-v /opt/axf:/axf`) and which is gitignored, so landings and redeploys keep the key and the setting. No Coolify
change needed. A fresh install that loses it is caught by the new health check and repaired by its Auto fix.

## Code (PR)
- `server/health.py` (new): systems check item `terminal-vps-host` ("Terminal reaches the VPS host", service `vps`).
  Red when the host or key is missing, or ssh `tmux ls` fails (with the reason); green with the number of headless
  sessions. **Auto fix:** make the key, fill in the host (`AXF_VPS_HOST`, else the Docker default gateway), and when the
  host still refuses the key, send one idempotent veto call (`vps_run`) adding only the public key, `from=` Docker networks.
- `server/store.py`: `default_host()` (env, else the default gateway from `/proc/net/route`, only inside Docker).
- `server/__init__.py`: registers the check on import and from `status` / `headless` (plugins load in any order).
- `test.py`: 9 new checks (probe ok/red/missing host, gateway parsing, auto fix fills host + sends the key once, nothing
  sent when already fine, no route = failed with instructions, registration). Also fixed a pre-existing flake in "a
  console token reset closes every terminal" (earlier sessions could close before the reset, so `before` was 0, and a
  fixed 6 s sleep raced the 5 s reaper): it now opens its own session and waits up to 15 s.

## Verified
- From the console: `headless` → `ready:true`, 6 sessions (auto-land-2, ui-review-shots, follow-amber,
  claude-settings, agent-pick, terminal-vps-host), each with agent + model.
- `headless/meters` → `ready:true` with `costUsd`, tokens, status per session.
- Tests: terminal self-test 106/106 (was 97 + the flake failing on this host).
- The browser side (auto-open a tab per build) is PR #259's `web/headless.ts`, unchanged; it only needed `ready:true`.

## Gaps
- The health item appears once this PR is on main and the console restarts (plugins load from `/opt/axf`).
