# Agent cap + queue (agent-cap) — Nov 1 2026

Brett's ask: the VPS has 16 GB (4 GB swap being added); idle headless Claude sessions take ~300-400 MB and 1-2 GB while
they build or test. He wants a **configurable** cap on agents/builds at once, with the rest waiting in line.

Built on Opus in one headless session, branch `claude/agent-cap`. Orchestrator build `agent-cap` in profile Breakroom.

## What was built

| Part | Where | What it does |
|---|---|---|
| Engine + CLI (agent-slots@1) | `framework/cli/agent-slots.mjs` | Settings (hot-reloaded), running registry, FIFO + priority queue, claim/wait/bind/finish/release, Move up, Cancel, memory guard, heavy lock, tmux sweep. Store: `/projects/amberx-axf/_data/agent-slots/` (shared by the host and the console container), mkdir lock. |
| Launcher | `deploy/claude-headless.sh` | Sweeps, then asks for a slot. Full = it prints `queued at position N (<id>) in <dir>: starts by itself when a slot frees` and a detached waiter starts it later. Inside tmux it binds its slot, marks it finished when Claude exits (the slot frees at once), and closes the window after `closeFinishedAfterSec` (default 120 s, Enter closes it sooner; logs stay). The brief gets a line saying to wrap heavy steps in `agent-slots.mjs heavy -- <cmd>`. `--priority` / `AXF_PRIORITY`; `AXF_SLOTS=off` skips the cap. |
| axHub `vps.build_start` | (unchanged, it calls the launcher) | Its output is the launcher's stdout, so it now says `queued at position N …` when queued. |
| Swarm | `apps/console-web/plugins/agent-swarm/swarm.mjs` | `run()` takes a slot (`withSlot`, kind `swarm`) around the `claude -p` run; when queued, Boss posts "<agent> is waiting for a desk (position N …)" in the group chat. Cards and profiles carry a `swarm.agent.status` slot. |
| Console plugin `agent-slots` | `apps/console-web/plugins/agent-slots/` | Settings → Plugins → Agent cap (+ the same panel in the Agent swarm / Breakroom settings → Desks, slot `swarm.settings.desks`): max running agents, max heavy steps, memory floor, close-after, priority rules. `activity.summary` slot: "· slots 4/6 · 2 queued" in the activity banner's summary line. `builds.top` slot: the queue on the Builds page (position, priority, kind, who, waiting since, Move up, Cancel; what holds a slot folded underneath). `swarm.agent.status`: on-duty agents past the free slots show **Waiting for a desk** (with the queue position when their job is queued). Capability `axf.agent-slots@1`. |
| Systems check | registered by the plugin on `axf.health@1` | `agent-slots-memory` "VPS memory for headless agents": warn when the memory guard held starts ≥ 5 times in the last hour, or swap stayed over 256 MB for ≥ 30 min (all three numbers in settings). |
| Slot hooks | `builds-page/web/ui.tsx`, `activity/web/index.tsx`, `agent-swarm/web/cards.tsx` | One `<Slot>` each; nothing else changed there. |

Defaults: max running agents **6**, max heavy steps **3**, memory floor **2 GB**, close finished sessions after **120 s**,
priority rules `^(boss|brett)` → Boss, `^(urgent|hotfix)` → Urgent. Order: Boss > Urgent > Normal > Low, first come
first served within one. Move up past an entry of a higher priority takes that priority.

## How sessions are counted

- A slot is held by entries in state `starting` or `running`. `finished` (Claude exited, window still showing the result)
  does **not** count.
- Liveness is judged only on the host that made the entry (tmux session present, else the pid), so the console container
  never drops the VPS's sessions. A just-taken slot counts for 2 min before it has to be bound.
- `axf-*` tmux sessions started before the cap (or by hand) are adopted as `legacy` and count until their pane shows the
  `── finished (exit …)` line; then the sweep closes them (their logs stay on disk). There were ~20 such old finished
  sessions sitting on "Press Enter" on the VPS when this was built: the first launch after deploy closes them.

## Tests

| Check | Before | After |
|---|---|---|
| `node framework/spec/check-agent-slots.mjs` (new, in CI engine job) | — | 53/53: cap, FIFO, priority, claim, move up / cancel, auto-start on a freed slot, dead pids free slots, other-host entries kept, memory guard + trip, swap since, settings hot reload, heavy lock (peak 2 of 5), swarm `withSlot`, sweep (grace, adopt, close), and `claude-headless.sh` end to end in real tmux (second run prints "queued at position 1", starts by itself, first closes itself, log kept) |
| `python3 apps/console-web/plugins/agent-slots/test.py` (new) | — | 19/19: routes, unknown keys dropped, CLI sees console saves at once, Move up, Cancel, 409 twice, capability, probe ok/warn/unknown, systems-check registration |
| `node apps/console-web/plugins/agent-swarm/test.mjs` | 66 | 66 (now isolated to a scratch slots store) |
| `tsc --noEmit` (console) | clean | clean |
| `check-theme.mjs` / `check-controls.mjs` / lifecycle `check agent-slots` | — | green |

Full local block from `.github/workflows/android.yml`: see the run notes at the bottom.

## Known gaps

- The heavy lock is opt-in per command (`agent-slots.mjs heavy -- …`): the brief tells every headless session to use it,
  but nothing forces a session that ignores it. A PreToolUse hook that wraps matching Bash commands would make it hard.
- Orchestrator / build-manager / systems-check / push-banner launches go through `claude-headless.sh` and so are capped;
  their nohup fallback (no helper script on the host) is not.
- The activity banner only shows while something is active, so the slots chip shows with it, not on its own.
- Android: nothing (web/TS/Python only; no cross-port contract changed).

## Full local CI block (`.github/workflows/android.yml`, engine + console jobs)

Green: every engine-sweep `node` check (incl. the new `check-agent-slots.mjs`), theme / controls / plugin-pages checks,
console re-bake + `tsc` + `vite build` (with `ci-example`), axhub-web / amberx-droid / walkthrough-studio builds, theme
swap (Playwright), interface-scope check, the Alerts/MCP/axf_server block, every plugin `test.py` and `test.mts`,
library templates, Python API + MCP smoke (agent-slots loads; systems check answers), menu reach (301 checks).

Red only because of this VPS, each confirmed on a clean `origin/main` worktree or by rerunning with the fix:
- `pip install` lines (system Python is externally managed): the blocks were rerun without them (deps already present).
- `node` here is v20; CI uses 22: the `--experimental-strip-types` tests were rerun on a local Node 22 binary, all green.
- session-checkin test sees this headless session as unattended (`CLAUDE_CODE_ENTRYPOINT`): green with it unset.
- lifecycle sweep: stale references only from the untracked `sessions/archive/` folder on this box (my own plugin's
  one real hit, naming the swarm's settings tab, was fixed with the `swarm.settings.desks` slot).
- `plugins.mjs --check`: "x.assets.browser not in the plan" — the same on a clean main (shared plan data on the hub).

## Screenshots

UI Review → Screenshots, group **Agent cap - Nov 1** (6 shots, phone + desktop), copies in `agent-cap/`:
`builds-queue-*` (queue on the Builds page, 6/6 slots, urgent hotfix first), `settings-agent-cap-*` (Settings →
Plugins → Agent cap), `swarm-desks-*` (Rio holds a desk, Py Pete "Waiting for a desk · #3", the rest waiting).
The activity banner chip isn't in a shot: the banner only shows while activity items are live, which the scratch
console had none of.
