# Agent swarm

Specialist agents that run headless, one job each, so several builds go at once without stepping on each other,
on the cheapest model that can do the job. Console → Builds → **Agent swarm**.

Built Oct 31 2026 on Opus (orchestrator build `agent-swarm`, Breakroom profile).

## The crew

Eight build agents (plus the six-agent job crew below) in `agents/roster.json` (`swarm-roster@1`, each agent `agent@1`), each with one skill file under one
page in `agents/skills/` (`agent-skill@1`):

| Agent | Skill | Models (cheapest first) |
|---|---|---|
| Kotlin Kat | kotlin-compose | Sonnet, Opus, Fable |
| Rio React | react-ui | Sonnet, Opus, Fable |
| Py Pete | python-server | Sonnet, Opus |
| Manny Fest | plugin-manifests | Haiku, Sonnet |
| Tia Theme | assets-themes | Sonnet, Opus, Fable |
| Tex Tester | tests | Sonnet, Opus |
| Doc Holli | docs | Haiku, Sonnet |
| Merge Max | merge-fixer | Sonnet, Opus |

Amber's persona (`agents/persona.md`, five lines) is in the shared prefix: reports and chat talk like Amber; code,
comments and commits stay clean. No jokes about anyone's identity.

## ID cards (agent-card@1)

Every agent has an ID card drawn by the framework's `AgentCard` from an `agent-card@1` asset (rules
`framework/core/engines/agent-card-rules.mjs`, starters in `framework/assets/agent-card/`: corporate badge, license,
trading card, backstage pass). **ID cards** tab: the gallery of every design with a real agent, **Make default**, and
the card designer (**Edit as new** → Save as new; saved designs live in the swarm state as asset@1 envelopes). Each
profile's **ID card** section picks a design for that agent and edits its identity (blank = the roster's value;
employee ID and internal email derive from the agent id; the email is display only). Colours come only from theme
tokens, so swapping the theme rebrands every card. The `qr` code strip shows the agent's page link (no QR encoder yet).

## How a build runs

1. **Plan** (`swarm.mjs plan <build>…`): each open step becomes a job. The agent is picked by keywords and the
   step's files; the model is the cheapest one that reaches the job's tier (Fable only for contract/design work
   pinned to Fable). Each job leases its files; jobs that touch the same files go in later waves. Several builds
   share one lease table. Shared files (the sync file, STATUS, trackers, catalogs) are never leased.
2. **Pack** (`swarm.mjs pack <build> <step>`): the brief is the shared prefix (same bytes for every job, so the
   prompt cache hits), the agent's skill, the task, its leases and snippets cut from the leased files only.
3. **Run** (`swarm.mjs run <build> <step>`): `claude -p` in its own worktree (branch `swarm/<build>/<step>`), with
   its own system prompt, no MCP servers, only its tools, max turns and a token budget. Usage is followed live;
   over budget or over time = killed. The agent ends with a `swarm-report@1` JSON block.
4. **Check + merge** (`swarm.mjs check …`, `swarm.mjs merge <build> [--push]`): changed files must be inside the
   lease. Done, clean jobs merge in wave order into the build's branch in a separate worktree. A conflict is aborted
   and handed to Merge Max (`swarm.mjs fix <build> <step>`). Then Boss ticks the steps on the orchestrator tracker,
   adds one build note and prints the reports' notes for the shared files.

`--dry-run` on `run`, `fix` and `banter` shows what would happen without spending anything. Claude Code is
`AXF_CLAUDE_BIN`, else `claude` on PATH. Page requests never start a run.

## Money

- **Cost meter** (Cost tab, `swarm.mjs cost`, and a "Swarm $" button on the Builds pages' toolbar): tokens and
  dollars per agent, job, build and model. Real cost from Claude Code when it reports it, else priced from
  `framework/schemas/model-pricing.json` (Haiku is an estimate there until it's added).
- **Salary** = each agent's weekly budget in dollars (Monday UTC). Spent it all = broke: no new jobs till payday or a
  top-up. A higher salary is a raise, a lower one docks it; both are posted in the chat. Finishing under budget earns
  a bonus on the card (bragging rights only).
- **Pilot** (`swarm.mjs pilot <build> [--apply]`): plans and packs a build without running it and compares the
  swarm with one session. Dry pilot on Angel `ui-all-assets` (Oct 31 2026): about $3 for the swarm vs $31 for one
  session, suggested budget scale 0.36; saved as 0.5 on the roster until real runs are measured.

## Statuses and discipline

On duty · Off duty · Injured · Medical leave (back on its date) · Probation (small jobs, a notice every run) · Fired ·
Custom (named, works or not) · Suspended (timed, with a reason) · Quit (rage-quit after N failed jobs in a row,
default 3). Rehire puts an agent back on duty. Every change is in the agent's history and posted by Boss.

## Group chat

Boss posts assignments, lease decisions, status changes and merges; agents post reports and handoffs; coworkers react
from a zero-token banter bank, and `swarm.mjs banter` asks the small model for one cheap batch. Off = nothing posted,
nothing spent; one switch per agent too.

**Chat settings:** vibe 1–500 is a hard ceiling (each message is scored; above it = cleaned and calmed, banter still
above = dropped; work lines are never dropped), chattiness, cussing and drama sliders, per-agent overrides, a daily
banter budget (quiet when hit), presets (All business, Work crew, Break room, Off the rails, plus your own), a live
preview, and Color by vibe (also on the chat's right-click menu).

**Read by AI sessions (read-only, Nov 3 2026):** every save of the swarm state mirrors the chat to the hub's shared
data, secrets redacted (`web/chat-watch.mjs`): `/projects/amberx-axf/_data/agent-swarm/chats/` = `index.json`
(breakroom-chats@1: the chats, counts, paths), `group.json` (breakroom-chat@1: the messages, speaker names) and
`mentions.json` (breakroom-mentions@1: messages about Brett / the boss / the owner, newest first, each with chat, agent,
time, matched terms and tone `negative|neutral`). A Claude session reads them with axHub `memory_read` (project
`amberx-axf`, area `data`, path `agent-swarm/chats/mentions.json`); nothing there is ever read back into the swarm.
A bare "Boss" is the orchestrator and Boss's and Brett's own posts never count. Also: `swarm.mjs mentions [n]
[--negative]`, `swarm.mjs chats-export` (rewrite the mirror now), `GET /api/plugins/agent-swarm/chat/mentions`
(`limit`, `negative`), and Breakroom → Group chat → **Everyone / About Brett / Negative**. `AXF_SWARM_CHATS_DIR`
moves the mirror (`off` = none). Uninstall removes it.

## Jobs and the crew (agent jobs, Nov 1 2026)

Recurring kinds of work are **job types** (`job-type@1` assets in `framework/assets/job-type/`, rules
`framework/core/engines/job-type-rules.mjs`): owning specialty, default model, token budget per run, trigger (on demand,
schedule, event), brief template, outputs (report path, UI Review group). Six hires own the first six, one each:
Reel Rhonda (walkthroughs), Ping Paulie (site checks, read-only), Snap Sully (screenshots), Landin' Lenny (landing),
Janitor Joey (banner cleanup), Earl the Ear (listener QA). They are `jobsOnly`: the build planner never gives them
build steps.

- **Route** (`node framework/cli/agent-job.mjs <job-type> [--input k=v]…`, found by capability `service:agent-jobs@1`
  → `jobs.mjs`; Breakroom → **Jobs** → Run): the owner (cheapest salary first) that is on duty, not broke, and whose
  pay left this week covers the run's cap; the brief from the template plus the agent's skill page and
  `agents/notes/<id>.md` (nothing else); launched through `deploy/claude-headless.sh` as `axf-<agent>-<job>` in its own
  worktree (detached for read-only jobs, else branch `agent-jobs/<type>/<stamp>`); the run is a `swarm-run@1` with
  `kind: "job"` in `runs.json`.
- **Sweep** (`agent-job.mjs sweep`, also on every Jobs read): a finished stream fills usage, cost and the report, then
  the run is booked on the agent like any swarm run (stats, spend, fail streak, bonus, chat). The final message is kept
  as `job-reports/<run>.md` in the data folder.
- **Unassigned**: a job type nobody owns shows **Unassigned job** with **Hire**; the hire (agent + a skill page made
  from the job type) is kept in the swarm state (`hired`, `hiredSkills`) and joins the roster.
- `due [--run]` and `event <name> [--run]` start scheduled and event jobs (cron is not installed by the plugin).
- The Jobs tab replaced the old tab name for build planning, which is now **Build plan**.

## Files

- Code: this folder. Data: `.axf-console/plugins/agent-swarm/` (`state.json`, `runs.json`, `merges.json`,
  `pilot-*.json`, `worktrees/`); the read-only chat mirror on the hub (`agent-swarm/chats/` in amberx-axf `_data`).
- Self-test: `node apps/console-web/plugins/agent-swarm/test.mjs`.
- Remove: `node apps/console-web/plugins/agent-swarm/uninstall.mjs --all`.

## Limits

- The session browser isn't built yet; `swarm.mjs sessions --json` gives it each run's agent status and spend.
- No live run has been measured yet (no Claude Code binary where this was built); budgets are tuned from projections.
- Agent choice is a keyword and path match: steps that name their files get the right specialist; vague steps are
  flagged "no clear specialist".
