# Plan: a second VPS for headless builds

Status: PLANNED (Nov 10 2026, build `console-speed-profile-and-cut-axf-console-cpu-pl`). For Brett to decide. Nothing bought, nothing built.

## Why
Brett, Nov 10 2026: "The console is mad slow. Ridiculous slow. How do I make this faster? ... I guess."

Measured on the one VPS that runs everything (console, axHub, Coolify, AmberX apps and every headless build):

| | Nov 10 02:46 | Nov 10 03:34 |
|---|---|---|
| CPUs | 4 | 4 |
| Load average (1 min) | 30 | 20.5 |
| RAM used | 7.2 / 16 GB | 4.7 / 16 GB |
| Swap used | 3.4 / 4 GB | 2.9 / 4 GB |
| Disk `/` | | 191 / 193 GB (100 %) |
| Build worktrees (`/root/axf-builds`) | | 205 folders, 96 GB |
| Headless builds running | 5 | 3-5 |

Each headless build is a Claude session plus its tests, vite builds and Playwright. With 4 CPUs, five builds and their test runs keep the machine 5-7x oversubscribed, and the console (a single uvicorn process) waits its turn like everything else. This build caps the builds (systemd scope per session, low CPU/IO weight, memory and swap caps, one Playwright at a time) and removes the worst background load (stacked maintenance snapshots). That makes the console usable under load, but the builds then simply run slower: the real limit is 4 CPUs and 193 GB of disk for both jobs.

## Options

| | What | Approx. cost / month | Effect |
|---|---|---|---|
| A | Keep one VPS, caps from this build only | 0 | Console responsive; builds slower; disk still fills |
| B | Upgrade this VPS (8 vCPU / 32 GB / 400 GB class) | about 2x today's plan | Twice the room, one machine to run; a noisy build still shares the console's disk and kernel |
| C | **Second VPS for builds only** (8 vCPU / 16-32 GB / 300-400 GB NVMe) | about the same as today's plan again | Console box only serves; builds can't slow it at all; build box can be rebuilt or resized without touching the console |

Prices are ranges for the usual KVM providers (Hostinger KVM 8, Hetzner CPX41/CCX33 class); check the current price list before buying. Recommendation: **C**, sized 8 vCPU / 32 GB / 400 GB, because builds are CPU- and disk-bound and the console box would then need no upgrade.

## How it would work (option C)

### Dispatch
- The orchestrator, the queue (`agent-slots`) and the console stay on the console VPS. Only the session itself moves.
- `claude-headless.sh` gets a `--host <name>` target (from an `AXF_BUILD_HOSTS` setting, default local). For a remote host the dispatcher runs `ssh axfbuild@build-vps 'cd <worktree> && bash deploy/claude-headless.sh …'` over a dedicated key that can only run that script (`command=` in `authorized_keys`).
- agent-slots already records the host on every entry (`host`) and only judges liveness on the host that started it; it gets a per-host cap (`maxAgents` per host) so the console box can run zero builds.
- The console's Terminal lists remote sessions by running `tmux ls` over the same SSH connection and attaches with `ssh -t build-vps tmux attach -t <session>`.

### Git and worktrees
- The build VPS has its own clone of the repo and makes its own worktrees under `/root/axf-builds`; nothing is shared over the network as a file system.
- Branches and PRs go to GitHub as today. builds-live notes and step ticks already reach main through GitHub, so the console sees progress without any file sync.
- The build VPS runs the same self-healing worktree clean-up and the maintenance snapshot (with the size cache from this build) on its own disk.

### Accounts and secrets
- Claude: each account's login directory is set up once on the build VPS with the same sign-in flow (claude-login), not copied, so tokens never travel.
- GitHub: `framework/cli/github-token.mjs` needs the same app credentials there; axHub token in the build VPS's own env file.
- Nothing new is stored in the repo.

### What the console shows
- Logs, meters (`headless-meter@1`) and context chains are read over SSH (or streamed to axHub) for the Builds page and Terminal tabs.
- Watch-live previews run on the build VPS and are proxied by the console under `/preview/<session>/<app>/` as today, with the build VPS as upstream.
- The Maintenance page gets a host picker (console / build) once a second host exists.

## Steps if Brett says yes (about 3 builds)
1. Buy and harden the box (SSH key only, firewall, Docker, Node 22, Python 3, tmux, Playwright deps); clone the repo; Claude logins.
2. `--host` in `claude-headless.sh` + per-host caps in agent-slots + remote `tmux ls` / attach in the Terminal plugin; one test build end to end.
3. Move the dispatcher's default to the build host; set the console host's `maxAgents` to 0; Maintenance host picker.

## Decision needed
Brett: A, B or C, and which provider. Nothing happens until then.
