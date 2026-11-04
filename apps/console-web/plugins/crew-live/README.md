# Crew (`crew-live`)

Every agent (employee) working right now and exactly what each is doing, live. Builds → **Crew**.

Zero tokens: plain code reading the headless stream logs, the live meters, the builds store and git. `test.py` fails if
anything in the plugin imports or calls a model.

## What it shows

- **Row:** avatar + name, status dot (working / waiting on approval / stuck / idle), build and step in plain English
  (`s3 of 7: …`), model, a timer since the job started plus time on the current step (ticks every second), live cost
  and tokens (from the headless meter, else the stream's usage × `model-pricing.json`; the final `total_cost_usd` once
  the run ends), PR link.
- **Expanded:** what the agent is doing this second (its newest tool call, in words derived from the tool and its
  input, never summarised by a model), the steps done / now / next, every file the build created / modified / deleted
  against its base (merge-base with `origin/main`) with its diff (hunks fold, lines highlighted), the recent tool calls
  with each one's share of its turn's cost, links to the run's Terminal tab, Session browser entry and employee card,
  and **Stop** (confirm).
- **Off the clock:** crew members with nothing running. **Totals bar:** agents working, cost running now, cost today.

## Sources (capabilities, never other plugins' folders)

| What | Where |
|---|---|
| live headless runs, meters, kill | `axf.headless@1` (Terminal plugin: `tmux ls` + `headless-meter@1` over its VPS ssh) |
| names, avatars, pay, status | `axf.swarm-roster@1` (agent swarm) |
| tool calls, usage, result | `<worktree>/<name>.jsonl` (stream-json from `deploy/claude-headless.sh`) |
| build, steps, PR, approvals | `_claude/builds/store.json` (builds@1) |
| files and diffs | `git` in `/root/axf-builds/<name>/` |

Without the Terminal plugin the Crew still lists runs from their stream logs (no stop); without the roster agents show
with initials. Host paths map into the console container (`/root/axf-builds` → `/hostfs/axf-builds`, `/opt/axf` →
`/axf`; `AXF_CREW_PATHS=host=local,…` overrides). `AXF_BUILDS_ROOT` is the worktrees folder (default `/root/axf-builds`).

An agent is found by the run's agent tag or session name (`axf-<agent>-<job>` from the job router), else by the build's
`Agent: <name>` line in its detail.

## Commands (REST + MCP + CLI, plugin-commands@1)

| Command | Route | |
|---|---|---|
| `agents` | `GET /api/plugins/crew-live/agents` | the crew@1 snapshot |
| `agent` | `GET …/agents/{run or agent id}` | one run in full |
| `files` | `GET …/agents/{run}/files` | files vs the base |
| `diff` | `GET …/agents/{run}/diff?path=` | one file's hunks |
| `stop` | `POST …/agents/{run}/stop` | ends the run (destructive, confirm) |

MCP tools `crew-live_agents` …; CLI `axf crew-live agents`. Live: `GET …/live` (server-sent events, a `crew` frame
whenever the snapshot changes; one snapshot every 2 s at most, shared by every watcher).

## Avatars everywhere

`AgentAvatar` (framework `react/components/AgentAvatar.tsx`) draws an agent's face from their card (agent@1 `avatar`)
or their initials; size and shape come from the `agent-avatar` asset (avatar@1), colours from the theme. It carries the
`agent` context target, and this plugin contributes that menu: employee card, current task, history, Session browser,
Terminal tab, group chat, assign a job, stop. The plugin fills the framework's agent directory
(`core/agent-directory.ts`) so any plugin can show `<AgentAvatar agent="paulie" />` by id or name.

## Lifecycle

Stores nothing (`.axf-console/plugins/crew-live` stays empty). `install.mjs` / `uninstall.mjs` per plugin-lifecycle@1.

## Crew cards (Nov 4 2026)

The Crew window opens on **Crew cards**: one collapsible container per roster member (crew-profile@1 from `axf.crew@1`).
Collapsed = avatar + name + status dot + job title on one line; open = a Crew card (job title, doing now, live timer,
cost, files, pay, reports to, write-ups), the ID card (framework `AgentCard`, agent-card@1) and the Profile (a tab per
section, editable; pay, tools, safety and job title save only from Brett's own session). Working members are always on
top (longest-running first), then queued, idle and off; the list reorders live with a short slide and holds still
while Brett touches or scrolls it. Expand all / Collapse all, open state per member on this device, default: working
open (Settings → Plugins → Crew → Crew cards, also sort). Table shows the old run grid. Action `crew.profile:<id>`.
