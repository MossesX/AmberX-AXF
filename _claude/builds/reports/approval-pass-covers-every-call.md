# Approval pass covers every call, including VPS commands and stops

Brett (Nov 18 2026): "Why do I keep getting approvals when I set a pass?"

Branches: `claude/approval-pass-covers-every-call` in AmberX-AXF (PR #836) and in axHub.

## Cause (s2: every place the call path skipped the pass)

| # | Where | What it did |
|---|---|---|
| 1 | axHub `packages/core/src/passes.ts` → `PassBook.match` → `passExclusion` | Any pass that wasn't `all` skipped `ssh` services (`vps.run`), the hub's own tools, destructive and delete-named tools and explicit-approval tools (`console_terminal_sessions_stop`). |
| 2 | axHub `PassBook.active` | Dropped `all` from every feed pass, so the pass Brett sets in the console was always narrow on the hub and then hit (1). |
| 3 | axHub `passCovers` | Ignored `covers`; read only the old `service` / `tools` / `scopes` fields. |
| 4 | axHub `PassBook.grant` | Refused any pass that named an `ssh` service. |
| 5 | Console `plugins.commands` (`plugin-commands/commands.mjs` → `plan`) | A `confirm: true` command (`console-terminal/sessions-stop`) always answered `confirmation_required`; it never asked whether a pass covered the call. |
| 6 | Console `token-control` (`control-pass.mjs` → `passCovering` / `passCoveringCall`) | Matched passes by scope id only; `passCoveringCall` only ever matched an `all`-scope pass and ignored `covers`. |
| 7 | Console ← hub | The hub sent no pass with the call, so the console's own confirm layer couldn't know the hub ran it under one. |

Reproductions: axHub `packages/core/test/passes.test.ts` → "a pass covers what it names, whatever the policy class"
(`vps.run` and `terminal_sessions_stop` under a named pass); console `plugin-commands/test.mjs` → "a pass" block.

## Fix (s3-s11)

**One matcher, one set of exclusions.** A pass covers what its `covers` names: `all` (the default for every grant that
names nothing) or entries `<service>`, `<service>.<tool>`, `scope:<target>` (`*` matches any run of characters), whatever
the tool's policy class. Only three things still ask under a pass: a `deny`, granting or changing a pass
(`pass_grant`, `pass_update`), and an irreversible call unless the pass includes them.

| Where | Change |
|---|---|
| axHub `passes.ts` | `coversCall` + `passCovers` match by `covers`; `passExclusion`, the shell / builtin / destructive / explicit-approval exclusions and the shell grant refusal are gone. A service+scope pass compiles to its scope only (never wider). Feed passes still only cover their own service. `PassBook.covering` (no use counted), `PassBook.update`, `parsePassUpdate`, `covers` + `notify` on grants. |
| axHub `hub.ts` (veto + confirm path) | A covered call runs at once: no hold, countdown job, approval entry or notice. `skippedPolicy` (`veto`, `confirm`, `explicit`) is recorded; a job it starts gets `ranUnder`; the audit row starts `ran under pass <id> (skipped <policy>)`; the pass counts `runs` per class. The pass goes to the connector (`OutboundContext.pass`). |
| axHub MCP proxy | Sends `_meta["axhub/pass"] = {id, covers, expiresAt, callId, t, sig}`, `sig = HMAC-SHA256(service credential, "<t>.<id>.<callId>")`. |
| axHub push (`approval-push.ts`, `vinnie.ts`) | Asks `hub.coveringPassFor` before every approval or veto push; a covered call sends nothing. `notify: quiet` sends one short "ran under pass" line per run. |
| Console `plugin-commands` | A `confirm` command (`console_terminal_sessions_stop` and 70 others) runs at once under a covering pass: the console's own or the one axHub sent (`hub_pass` checks the signature with the console token, five minutes). Audit rows carry `ranUnder` + `skippedPolicy`. |
| Console `control-pass.mjs` | `passCoversCall` / `passPatternMatches`; `passCovering` and `passCoveringCall` match by `covers` (token scopes keep their ops), not by scope id. |
| axHub web → Passes | Grant form: All tools (default) or Pick services and tools (service checkboxes + entries field), quiet-line setting. Active card: coverage chips, runs per class, Edit coverage. `#/passes/<id>` opens one. |

## Before / after

| Call while a pass is on | Before | After |
|---|---|---|
| `vps.run` under a console or narrow pass | veto countdown + push | runs at once, logged `ranUnder`, `skippedPolicy: veto` |
| `console_terminal_sessions_stop` via axHub | approval on the hub, then the console's own confirm token | runs at once; the console skips its confirm for the signed pass |
| a destructive console tool under a pass naming the console | approval | runs at once |
| an irreversible call (`docker volume rm`, delete a repo) | asks | still asks unless `include_irreversible` |

Shots (UI Review, group "Approval pass covers every call, including VPS commands and stops"): active cards, grant with
All tools, grant with the picker; desktop and phone.

## How each part is reached

| What | REST (hub session) | MCP | CLI | Voice (pass-voice@1) |
|---|---|---|---|---|
| open one | `#/passes/<id>`; `GET /auth/api/passes/:id` | `axhub.pass_status` | `axhub passes show <id>` | "what does the pass cover" |
| grant | `POST /auth/api/passes {minutes, covers?, notify?, reason}` | `axhub.pass_grant` | `axhub passes grant <minutes> --covers all\|<entries> [--notify quiet]` | "give me a pass for 30 minutes" |
| change coverage | `POST /auth/api/passes/:id/update` | `axhub.pass_update` | `axhub passes update <id> --covers …` | "make the pass cover everything" |
| end | `POST /auth/api/passes/:id/revoke` | `axhub.pass_revoke` | `axhub passes revoke <id>` | "end the pass" |

State: `pass_status`, `GET /auth/api/passes`, `axhub passes list` return `covers`, `label`, `uses`, `runs {veto, confirm,
explicit}`, `notify`.

## Tests

- axHub: `packages/core/test/passes.test.ts` (45), `pass-coverage-walk.test.ts` (CI walk of every tool policy under a
  covers-all pass, in `pnpm test`), `approval-push.test.ts`, storage contract (`runs`). Full suite on Node 22: 610 pass,
  4 fail, none from this build: two timing checks under VPS load (rest relay, ssh redaction), the CLI passes test hits
  the 15 s timeout in docker (passes with a longer timeout), and `build_land` (ssh build tools, a file this build doesn't touch;
  the branch is level with axHub main) fails on a git merge inside the container.
- Console: `plugin-commands/test.mjs` (46), `test-pass-walk.mjs` (71 confirm commands, added to the workflow),
  `server/test_plugin_commands.py` (hub pass signature), `token-control/test.mjs` (pass-voice fixture), `axhub-web/test.mjs`
  (255), `check-theme`, `check-controls`.

## Left for later

- A held call already counting down when a pass is granted is not released at once; its push is suppressed, and it
  runs when its countdown ends.
- The console feed publishes `active`, the hub reads `passes`: a console-set pass doesn't reach the hub through the
  feed today. Grant on the hub (all four ways above) to cover hub calls.
- Kotlin twins (`ControlPass` matcher, `PassVoice`) deferred, recorded in `framework/spec/PORTING.md`.
- CI on main: `check-page-toolbars` fails on `orchestrator-demo` (a toolbar asset with no page drawing it). It belongs to
  another build, so this branch leaves it alone.
