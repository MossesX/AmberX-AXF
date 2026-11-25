# Approval pass covers every call, including VPS commands and stops

Brett (Nov 18 2026): "Why do I keep getting approvals when I set a pass?"

Build `approval-pass-covers-every-call`, Pipeline 2.0, 12 steps, re-run from the top on Nov 25 2026. Two repos:

- AmberX-AXF: step branches `claude/approval-pass-covers-every-call--s1` … `--s11`. `--s11` has every finished step
  merged (s1-s8, s10) plus this step's work.
- axHub (`MossesX/axHub`): step branches `--s4`, `--s6`, `--s7`, `--s9`, merged and fixed up on
  `claude/approval-pass-covers-every-call--s11` (head `975914a`). **No axHub PR is open for this run.** The hub half
  is not live until that branch lands and the hub is deployed. PR #48 (the Nov 18 run) is superseded and conflicts with
  axHub `main`.

Step notes with the detail: `approval-pass-covers-every-call/s2-pass-skips.md` (the trace), `s4-veto-path.md`,
`s7-notices.md`. Contract: `framework/spec/AXHUB-PASS.md` (pass@2), `framework/schemas/axhub-pass.json`.

## Cause

A pass was asked in one place on the hub (`PassBook.match`) and lost before it got there, then lost again in the
console. Full list in `s2-pass-skips.md`; the ones that mattered:

| # | Where | What it did |
|---|---|---|
| V1-V2 | Console pass feed → axHub `parseFeed` | The console published `{ active: […] }` with `approvedBy`; the hub wanted `{ passes: […] }` with `grantedBy` and threw `no passes list`. The hub honoured no console pass at all. |
| V3 | axHub `parseFeed` | The console's `scope: "all"` was read as a scope pattern to match against a call's `target`, so a pass for everything covered nothing. |
| V5-V6 | axHub `passExclusion`, `PassBook.grant` | Any pass that wasn't `all` never covered a shell service (`vps.run`), a destructive tool or an explicit-approval tool (`console_terminal_sessions_stop`), and a pass naming a shell was refused. |
| V7 | `PASS_MAX_MINUTES = 240` in both repos | A 24-hour pass was cut to 4 hours (console) or refused (hub). |
| C1-C3 | Console `plugin-commands` → `plan` | A `confirm` command always answered `confirmation_required`; it never asked whether a pass covered the call, and the hub sent no pass with a forwarded call. |
| C5 | Console `control-pass.mjs` | Matched passes by scope id only; no `covers`, no service or tool match. |

## Fix

| Where | Change | Step |
|---|---|---|
| Contract | pass@2: one field `covers` (`all` by default, or entries `<service>`, `<service>.<tool>`, `scope:<target>`), how a pass decides each policy (veto, confirm, always-approve), what a covered run logs (`ranUnder`, `policySkipped`, `ranAt`), migration (a record with no field reads as `all`). | s1 |
| Console `control-pass.mjs`, `token-control` | The matcher covers by service, tool or scope, not scope id. | s3 |
| axHub `hub.ts` | A covered veto call never enters the held list: no countdown, no held job, no notice. A job it becomes is stamped with the pass. | s4 |
| Console `plugin-commands`, `/mcp` | A `confirm` command runs at once under a covering pass, the console's own or the signed one the hub sends with the call. | s5 |
| axHub `pass-log.ts`, docs | Every covered run writes a `pass_run` audit row and a log entry with pass id, tool, policy skipped and time; `pass_status` counts runs per pass. MCP instructions and the `pass_grant` description say a pass covers every tool by default. | s6 |
| axHub `approval-push.ts`, `vinnie.ts`; console `follow-amber`, `token-control` | Every notice sender asks the pass first. A covered call sends nothing, or one quiet "ran under pass" line when the pass says `quietNotice`. | s7 |
| Console → VPS Configuration → Passes → axHub passes | Grant form opens on All tools, with an optional service / tool picker. Each active card lists its coverage and the newest calls that ran under it. Edit coverage. | s8 |
| axHub `passes.ts`, `builtin.ts`, `passes-web.ts`, CLI | `covers` on grant, `axhub.pass_update`, one-pass read, `axhub passes update / show`. | s9 |
| CI | `token-control/pass-walk.test.mjs` walks every registered tool policy under a covers-all pass and fails if one prompts, counts down or notifies. In the workflow. | s10 |
| Both repos | This step, see below. | s11 |

### What s11 changed beyond the report

Running everything together showed gaps the separate step branches hid:

- **axHub steps didn't merge.** s4 and s6 both built the run log, with different shapes; s7 and s9 both changed the
  pass request. Merged on the axHub `--s11` branch: s6's `passRun` is the one shape, the flat `ranUnder` /
  `policySkipped` stay on the observation for log readers, one `passPolicySkipped` (in `pass-log.ts`).
- **24 hours was still refused.** `PASS_MAX_MINUTES` is now 1440 in both repos (console engine
  `framework/core/engines/control-pass.mjs`, axHub `passes.ts`); hub presets are 30 min, 1 h, 4 h, 24 h.
- **The hub still couldn't read the console's feed.** The console now also publishes `passes` (each with `grantedBy`);
  the hub reads `covers: "all"` / `scope: "all"` as every tool of the publishing service.
- **The console's covered stop didn't use the contract's field.** `plan` now returns `policySkipped`
  (`always-approve` for a destructive confirm command) next to control-pass@1's `skippedPolicy`.
- s2's five reproductions (`token-control/pass-coverage.test.mjs`) were still 3 red; all 8 tests pass now and the file
  is in the workflow.
- `check-theme` read "decision #120" in comments as a colour literal (5 findings): reworded.
- UI Review needs three options; s8 sent one. Added the view choice `gate.pass-cover-view` (below).

## Before / after

| Call while a pass is on | Before | After |
|---|---|---|
| `vps.run`, pass granted on the hub | veto countdown + push unless the pass was for everything; a pass naming `vps.run` was refused | runs at once, no countdown, no notice; logged `ranUnder`, `policySkipped: veto` |
| `console_terminal_sessions_stop` through the hub | approval on the hub, then the console's own confirm token | runs at once on both; logged `policySkipped: always-approve` |
| a `confirm` console command over REST / CLI under a console pass | `confirmation_required` | runs at once, logged `ranUnder` |
| a 24-hour pass | cut to 4 h, or refused | lasts 24 h |
| the pass set in the console, read by the hub | never read (`no passes list`) | read; covers the console's own tools on the hub |
| an irreversible call (`docker volume rm`, delete a repo) | asks | still asks, unless the pass is `all` with `include_irreversible` |
| `pass_grant`, `pass_update` | asks | still asks: a pass can't grant or widen a pass |

## How each part is reached

| What | UI | REST (hub session) | MCP | CLI | Voice |
|---|---|---|---|---|---|
| open one pass | `#/passes/<id>` | `GET /auth/api/passes/:id` | `axhub.pass_status {id}` | `axhub passes show <id>` | "what does the pass cover" |
| state: `covers`, `label`, `runs`, `lastRunAt`, time left | active pass card | `GET /auth/api/passes` | `axhub.pass_status` | `axhub passes list` | same |
| grant | Switch a pass on | `POST /auth/api/passes {minutes, covers?, quiet_notice?, include_irreversible?, reason}` | `axhub.pass_grant` | `axhub passes grant all <minutes>` / `grant <service> <minutes> …` | "give me a pass for 30 minutes" |
| change coverage | Edit coverage | `POST /auth/api/passes/:id/update` | `axhub.pass_update` | `axhub passes update <id> --covers …` | "make the pass cover everything" |
| end | Revoke (tap twice) | `POST /auth/api/passes/:id/revoke` | `axhub.pass_revoke` | `axhub passes revoke <id>` | "end the pass" |
| quiet notice (console passes) | — | `GET` / `PUT /api/plugins/token-control/pass/settings` | control@1 `pass.scopes` | `control.mjs pass-settings '{"quietNotice":true}'` | — |
| how the form asks | Settings → Plugins → VPS Configuration → Passes | console setting `gate.pass-cover-view` | `console_control set` | same | — |

`covers` left out means `all` on every route.

## UI Review

Item `r-20261125-eeed056a` (settings, 26 shots, desktop and phone) is **waiting for Brett**. Three options for how the
form asks "All tools or a pick", each a settings asset in `apps/console-web/plugins/gate/assets/settings/`:

| Option | Looks like | Shots |
|---|---|---|
| `segmented` (default until one is picked) | two buttons, All tools \| Pick services and tools | `pass-coverage-grant-all-*`, `-grant-pick-*`, `-edit-*`, `-cards-*` |
| `switch` | one "All tools" switch; off opens the picker | `pass-coverage-switch-grant-*` |
| `select` | a drop-down | `pass-coverage-select-grant-*` |

Every option opens on All tools and sends the same request. `scripts/pass-coverage-shots.mjs` drives all three with
real clicks (`PASS_COVER_VIEW=…`) and checks what is posted. It replaces s8's single-option item
`r-20261125-b1d9de77`. Shots are in `approval-pass-covers-every-call/`.

## Tests

- axHub `pnpm test`, Node 22 in Docker, on the merged `--s11` branch: **667 of 668 pass**. The one failure,
  `packages/connectors/ssh/test/build-tools.test.ts` (`build_land` merges `THREADS.md`), fails the same way on axHub
  `main` in Docker and passes on the host; this build doesn't touch it.
- This repo has no root `pnpm test`; the suite is the workflow. Run here on the merged branch, all green:
  `token-control/test.mjs` (24), `pass-coverage.test.mjs` (8), `pass-walk.test.mjs` (665 veto, 2 confirm, 77
  always-approve tools, 814 plugin commands), `plugin-commands/test.mjs` (53) and `test_plugin_commands.py` (63),
  `gate/test.mjs` (27), `hubPages/test.mjs` (268), `follow-amber/test.py` (70), `notify-control/test.py` (133),
  `claude-settings/test.mjs` (107), console `tsc --noEmit` and `vite build`, `check-theme`, `check-controls`,
  `check-toolbars`, `check-chrome-assets`, `check-plugin-settings`, `check-settings-sources`, `help-coverage --check`,
  `gen-fixtures` (no fixture changed). The whole workflow was not run locally; CI runs it on the PR.

## Left open

- **The pass Brett sets in the console still doesn't cover `vps.run`.** By the contract (§2, feed passes) a pass
  approved in the console is held to the console's own service and never reaches a destructive or explicit-approval
  call on the hub. To cover `vps.run` and the stops, grant the pass on the hub (any route in the table above). If
  Brett wants the console's No wait switch to do that, it has to grant on the hub instead of in the console's store:
  a follow-up build, and a trust decision that is his.
- Not checked from here: whether the live `axf-console` service on the hub has `config.passFeed` set. Unset, the hub
  never reads the console's feed.
- No wait's "until off" is still a 4-hour console pass renewed by a clock (`claude-settings/core.mjs`).
- A call already counting down when a pass is granted keeps its countdown (s4's choice: releasing it would take away
  the chance to deny it).
- s9's console half (pass settings in the console calling the new hub routes) had not been committed when this step
  merged; the lander picks it up from `--s9` if it lands.
- Kotlin twins deferred (`framework/spec/PORTING.md`).
