# crew-retrain: every agent an all-rounder, no anonymous sessions

Build `crew-retrain` (Breakroom profile), Nov 3 2026, Opus, branch `claude/crew-retrain`. Booked on **Landin' Lenny**.
Brett (voice): retrain, don't fire. Every agent keeps its name, card, history, chat and pay; nobody was removed.

## What changed

**Job model (job-type@1, agent@1)**
- `job-type@1` gains `skills` (the skills a run needs; any agent holding them all may take it). `specialty` stays as the
  home skill whose page goes in the brief; a file without `skills` needs its specialty only, so every older job type
  reads the same. A job type must name one or the other. Validators, normalizer, schema and fixture updated
  (`framework/core/engines/job-type-rules.mjs`, `framework/spec/fixtures/job-type.json`, 122 checks).
- `agent@1` gains `skills` (`"*"` = every skill, now and later) and `home` (the job type it prefers: a tie-break only,
  never exclusive), plus `hasSkills()` (`framework/core/engines/swarm-rules.mjs`, `framework/schemas/swarm.json`,
  `framework/spec/fixtures/swarm.json`, 229 checks). swarm-run@1 keeps `build`, `source` and `forced`.
- The six crew agents (Reel Rhonda, Ping Paulie, Snap Sully, Landin' Lenny, Janitor Joey, Earl the Ear) carry
  `skills: ["*"]`, their old job as `home`, and may run on Opus or Fable. The eight build agents are unchanged.

**New job types**: `feature-build` (any feature/fix build launched headless) and `ops-fix` (the "fix it yourself"
rule), each with a skill page (`agents/skills/feature-build.md`, `ops-fix.md`). Eight job types in all.

**Router** (`apps/console-web/plugins/agent-swarm/jobs-core.mjs`): candidates are everyone with the skills; free =
on duty and under budget; ranked home job first, then least busy (running now), then fewest runs in the last day (so
work goes round the crew), then cheapest. Nobody with the skills free: any free crew member takes it. It only says
"nobody" when nobody is free, and the reason list is capped at two names plus a count.

**Every launch has an agent** (`deploy/claude-headless.sh`):
- Before anything starts, the run is booked through `agent-job.mjs book`: on `AXF_AGENT` when set (refused, exit 3,
  when that agent doesn't exist), else on the router's pick for `AXF_AGENT_JOB` (default `feature-build`), forced
  when nobody is free (the card gets a notice). This covers axHub `vps.build_start`, the Build manager's launches,
  the orchestrator and the job router (which books its own run and passes `AXF_AGENT_BOOKED` so nothing books twice).
- tmux session `axf-<slug>--<agent>` (a prefix lookup of `axf-<slug>` still finds it), the header shows the agent,
  and the log's first line is `# agent <id> · <name>` (the Chat viewer reads it as `facts.agent`).
- Usage, cost and the result are booked on the agent's card when the sweep closes the run. A headless build has no
  swarm-report block: a clean result = done, an error result = error, stopped part way = blocked (usage booked, no
  strike towards a rage-quit). No under-budget bonus for builds.
- Without the agent swarm plugin the run starts unbooked with a warning; every new launcher line carries
  `# axf-plugin:agent-swarm` and the file is in the plugin's lifecycle `mentions`, so uninstall strips them cleanly
  (checked: the stripped script still parses).
- `agent-job.mjs <type> --agent <id>`, `agent-job.mjs book …`, `agent-job.mjs assign <build-name>` (attach a
  running or finished build from its worktree's `.axhub-build.json` and `<name>.jsonl`).

**Breakroom UI**: each crew card shows *Now* (current job or free), *Home job*, and *All-rounder · 8 skills* with
the list; a *Who's free* strip sits above the cards (Free / On a job / Off). The Jobs tab shows each type's skills,
its home agent and "6 can take it · N free". Screenshots: `crew-retrain/shots/`.

## Back-assigned today's headless builds (live swarm data, round the crew)

| Build | Agent | Result | Cost |
|---|---|---|---|
| land-everything | Landin' Lenny | running | — |
| crew-retrain | Landin' Lenny | running | — |
| orch-live-sync | Janitor Joey | done | $10.02 |
| notes-vault | Ping Paulie | done | $6.73 |
| headless-tabs | Snap Sully | done | $13.73 |
| whats-new-banner | Earl the Ear | done | $8.18 |
| amberx-backup-fix | Reel Rhonda | done | $2.06 |
| kill-patches-pilot | Janitor Joey | done | $15.12 |
| theme-veto-pass | Ping Paulie | done | $10.81 |
| axhub-veto-pass | Snap Sully | done | $8.91 |
| plugin-commands-auto | Earl the Ear | done | $14.72 |
| pass-all | Reel Rhonda | running | — |
| axhub-pass-all | Janitor Joey | done | $4.32 |
| banners-one | Ping Paulie | blocked (stopped before a result) | — |

Backups of the swarm data before the change: `/tmp/swarm-runs-before-crew-retrain.json`, `/tmp/swarm-state-before-crew-retrain.json` (VPS).

## Checks

- `node apps/console-web/plugins/agent-swarm/test.mjs`: 93 passed (router: home first, least busy, round the crew,
  `--agent`, force; build outcomes; `assign` and `book` end to end; all-rounder roster).
- `npx -y tsx framework/spec/check-job-type.mts`: 122 · `check-swarm.mts`: 229 · `check-agent-card.mts`: 84.
- `node framework/spec/check-agent-slots.mjs`: 56/56 (its launcher runs now book into a scratch swarm folder).
- `check-theme`, `check-controls`, console `tsc --noEmit`, `axf validate --framework` (481 assets), build-manager 42,
  console-terminal 75, chat-viewer 98, `plugin-lifecycle check agent-swarm` clean.
- `tracker.mjs --check` is red on main already (391 items without a status); not touched here.

## Known gaps

- Pay: the crew's weekly salaries ($6–20) are under a feature build's $40 cap, so a direct `agent-job.mjs
  feature-build` run is refused for budget; launches through `claude-headless.sh` book anyway (forced, noted on the
  card). Minimum-wage pay comes with the finished Breakroom (HR stays shelved).
- Until this lands, the console runs the old sweep: the three runs still going (land-everything, crew-retrain,
  pass-all) would close as *failed* (no swarm report) and add one strike each. Lenny has two, under the rage-quit
  limit of three.
- axHub's `build_start` source wasn't on this host to read; it goes through `claude-headless.sh`, which books it.
  Anything that looks a session up by exact name `=axf-<slug>` would miss the `--<agent>` suffix.
- Android twin of the job-type/agent skill fields is deferred (Android on hold).
