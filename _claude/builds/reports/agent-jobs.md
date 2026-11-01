# Agent jobs: hire agents to own recurring jobs

Nov 1 2026 · Opus, one session (headless) · Breakroom build `agent-jobs` · branch `claude/agent-jobs` → main

## Result

Recurring work now goes to hired agents instead of anonymous one-off builds. One command routes it:

```
node framework/cli/agent-job.mjs <job-type> [--input k=v]… [--dry-run]
```

It picks the agent who owns the job type, checks they're on duty and under budget, writes the brief from the job
type's template (the agent gets only that brief, its one-page skill and its own short notes), launches it through
`deploy/claude-headless.sh` as tmux session `axf-<agent>-<job>`, and books the run on the agent (runs, stats, spend,
fail streak, bonus, group chat). Breakroom → **Jobs** shows every job type with its owner, trigger, last run, next
scheduled run and cost, with **Run** (inputs + Preview brief) or, when nobody owns it, **Unassigned job** + **Hire**.

The HR department (raises, school, HR panel) stays shelved; nothing of it was built.

## The crew

| Agent | Role | Owns (job type) | Models | Salary/wk | Catchphrase |
| --- | --- | --- | --- | --- | --- |
| Reel Rhonda (`rhonda`) | Walkthrough producer | `amberx-walkthrough` (on demand) | Sonnet, Opus | $15 | "Roll it. If it lags, I cut it, no suh." |
| Ping Paulie (`paulie`) | Site checker | `site-check` (every 6 h, read-only) | Haiku, Sonnet | $6 | "Pinged it. It's up, kid. Or it's wicked down." |
| Snap Sully (`sully`) | Screenshot runner | `ui-screenshots` (on demand) | Sonnet | $8 | "Desktop, phone, named and stamped. Next." |
| Landin' Lenny (`lenny`) | Lander | `land-build` (event `build.finished`) | Sonnet, Opus | $20 | "Main's green, she's landed. Bang a uey if it ain't." |
| Janitor Joey (`joey`) | Banner janitor | `banner-cleanup` (daily 09:00 UTC) | Haiku, Sonnet | $6 | "Swept the banner. Ghosts are gone, wicked clean." |
| Earl the Ear (`earl`) | Listener fixer / QA | `listener-qa` (event `amberx.voice-regression`) | Sonnet, Opus | $15 | "Say it again. Louder. Okay, that's the bug." |

All six are normal swarm agents (ID cards, statuses, salaries, chat) marked `jobsOnly`, so the build planner never
hands them build steps. Hire date Nov 1 2026.

## What was built

1. **`job-type@1` asset type.** Rules `framework/core/engines/job-type-rules.mjs` (+ `.d.mts`): specialty, model,
   budget `{ tokens, maxTurns, usd }`, trigger on-demand / schedule (`every` or daily `at`) / event, inputs, brief
   template with `{{placeholders}}` (declared inputs + built-ins), readOnly, tools, command, outputs (report path, UI
   Review group that must carry a timestamp). One validator for both `core/validate.ts` and the build engine; JSON
   Schema `schemas/json/job-type.schema.json`; registered in `asset-types.json`, `types.ts` (optional, late-optional,
   never rolled). Six starters in `framework/assets/job-type/`. Fixture `spec/fixtures/job-type.json`, check
   `spec/check-job-type.mts` (87 checks; in CI). Kotlin twin deferred (Android on hold, PORTING.md).
2. **Crew:** six roster entries, six one-page skills (`agents/skills/`), six short notes files (`agents/notes/`).
3. **Router:** `apps/console-web/plugins/agent-swarm/jobs-core.mjs` (pure: owners, route, model, cap, brief, args,
   session name, run record, Jobs view, hire) + `jobs.mjs` (list, run, due, event, sweep, hire). Entry point
   `framework/cli/agent-job.mjs`, found by capability `service:agent-jobs@1` (never by folder, so the plugin stays
   removable). Each run gets its own worktree (detached for read-only jobs, else branch `agent-jobs/<type>/<stamp>`).
   Exit 3 = unassigned or not routable, reason printed.
4. **Console:** server routes `GET jobs`, `POST jobs/run` (explicit Run only; a GET never spends), `POST jobs/hire`;
   Breakroom tab **Jobs** (`web/jobs.tsx`), the old build-step tab renamed **Build plan**; crew cards and profiles
   list the jobs each agent owns. Tokens and framework controls only (theme, controls, plugin-pages checks green).
5. **Cost rule:** the brief is the job's template + the agent's skill + its notes + the five-line voice, about 1k
   tokens for a site check; `--system-prompt` replaces Claude Code's default prompt, `--strict-mcp-config` drops every
   MCP server the launcher doesn't add, read-only jobs get no edit tools and `--permission-mode default`.
6. **Docs:** project rule in `_claude/rules/RULES.md` (recurring work goes to hired agents), install_steps
   **Part J: Jobs and the crew** (steps 32–35; J was free in the file, the shelved HR never used it), plugin README,
   STATUS line.

## Tests

- `agent-swarm/test.mjs`: 67 → 79 checks. New: six starters valid and each owned by one crew member; bad job type
  named and never routed; routing to the owner on the job's model with its cap; owner off duty → not routed; budget
  check (pay left under the cap, broke); unassigned → hire → routed; brief carries only the job + own notes and
  read-only gets no edit tools; launcher naming (`--name paulie-site-check`, brief file, model); missing required
  input refused; run recorded on the agent after the sweep (status, cost, stats feed, Jobs view, chat); a session gone
  without a result closed as error; one-tap hire kept in state and joins the roster.
- `check-job-type.mts`: 87 checks (new). `check-agent-card.mts` 61 (unchanged).
- Local CI block: the Node engine sweep (validate 471 assets, tracker, plugins, projects, builds store, UI Review,
  theme, controls, plugin pages, feature matrix, catalog, axf_server), all 45 tsx/node checks of the web test block
  (menu-reach included), console `tsc` + `vite build`, `theme-swap.mjs` green.
- `plugin-lifecycle check agent-swarm`: clean apart from untracked local session logs in this worktree (not in git).

## Screenshots

UI Review → Screenshots, group **Agent jobs - Nov 1** (6 shots, phone + desktop): Jobs view, Run → Preview brief,
crew card with its jobs. Taken from the production build (Vite dev was too slow on the loaded VPS; the console's
look source was off because the headless browser can't reach axHub).

## Known gaps

- No live run measured yet: the end-to-end test uses a fake launcher and a recorded stream.
- Schedules and events don't fire by themselves: `agent-job.mjs due --run` / `event <name> --run` need a cron line
  or a hook (install_steps step 34). Wiring `build.finished` to the lander is a follow-up.
- `amberx-walkthrough` has no re-record command yet; Rhonda takes it over when the amberx-walkthrough build lands
  (edit `command` in its job type).
- The agent cap/queue applies once agent-cap's launcher changes land in `deploy/claude-headless.sh` (this build only
  calls the launcher, so it inherits them).
- Claude Code still loads CLAUDE.md from the worktree it runs in; the system line tells the agent not to read more.
- Kotlin twin of job-type@1 deferred (Android on hold).
