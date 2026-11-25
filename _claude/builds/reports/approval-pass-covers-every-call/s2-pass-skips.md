# Where the call path skips an active pass (step s2)

Build `approval-pass-covers-every-call`. Brett: "Why do I keep getting approvals when I set a pass?"

Traced on AmberX-AXF `main` (e29231ce0) and axHub `main` (5dd64b6), Nov 25 2026. axHub PR #48 (the earlier run of
this build) is still open, so none of its fixes are live: the hub runs the code traced here.

## The path a pass travels

1. Brett turns on **No wait** (Claude settings) or grants a pass in the console. Both make an `all`-scope
   control-pass@1 record in the console's token-control store (`claude-settings/server/__init__.py` → `apply_pass`
   → `owner_pass(…, "all", …)`).
2. The console publishes its passes at `GET /api/plugins/token-control/pass` (`token-control/lib/pass.mjs` →
   `publication` → `passPublication`).
3. axHub reads that address every 15 s (`packages/server/src/pass-feed.ts`) and keeps the passes as *feed passes*.
4. On every call the hub resolves the policy, then asks `PassBook.match` (`packages/core/src/hub.ts:721`). A match
   turns `veto` / `confirm` into `allow`; no match sends the call to `checkConfirmation`, which holds it:
   `holdVeto` (countdown + veto notice) or `confirmation_required` (approval prompt + notice).
5. A call the hub lets through to the console's `/mcp` is gated a second time by the console itself
   (`plugin-commands/commands.mjs` → `plan`).

The pass is lost at steps 2-3 for every call, and again at step 5 for the console's own confirm tools.

## Every place that skips the pass

### Veto case: `vps.run` still counts down

| # | Where | What it does | Effect |
|---|---|---|---|
| V1 | Console `framework/core/engines/control-pass.mjs` → `passPublication`; axHub `packages/server/src/pass-feed.ts` → `parseFeed` | The console publishes `{ active: […], pending: […] }`. The hub requires `{ passes: […] }` and throws `no passes list`. | **The feed fails closed on every read: the hub honours no console pass at all.** This alone explains every prompt. |
| V2 | Same two files | Each published pass carries `approvedBy`; the hub skips an entry without `grantedBy`. | Even with a `passes` list, every entry is dropped. |
| V3 | axHub `parseFeed` | The console's `scope: "all"` is read as the scope pattern `["all"]` on the console's own service. `passCovers` then wants a call whose `target` argument equals `all`. | An "everything" pass from the console covers nothing. The published `covers` (`["*"]`, the scope's target list) is never read. |
| V4 | axHub `packages/core/src/passes.ts` → `PassBook.active` | A feed pass is held to the service that published it; `all` and `includeIrreversible` are stripped; a `*` service is dropped. | A console pass can never reach `vps.run` (service `vps`), by design of pass@1. |
| V5 | axHub `passes.ts` → `PassBook.match` → `passExclusion` | Every pass that is not `all` (so every feed pass, V4) never covers an `ssh` service, the hub's own tools, a destructive or delete-named tool, or an explicit-approval tool. | `vps.run` and `console_terminal_sessions_stop` are excluded twice over. |
| V6 | axHub `passes.ts` → `PassBook.grant`, `parsePassRequest` | A named pass for an `ssh` service or a reserved namespace is refused at grant time. | Brett cannot name `vps.run` in a pass. |
| V7 | Console `control-pass.mjs` `PASS_MAX_MINUTES = 240`, `passMinutes`; `claude-settings/core.mjs` `NO_WAIT_MINUTES`; axHub `passes.ts` `PASS_MAX_MINUTES = 240`; `parseFeed` cuts a later end to 4 h | A 24-hour pass is silently cut to 4 hours (console) or refused (hub). "Until off" is a 4 h pass renewed by a 60 s clock. | Past hour 4 every call prompts again; a missed renewal ends the pass. |
| V8 | axHub `hub.ts:721` | `match` is the only place the pass is asked. With no match the call enters `checkConfirmation` → `holdVeto`, which starts the countdown and the veto notice; nothing after that point looks at passes. | Once V1-V6 lose the pass, the countdown and the push notice both fire. |

What already works on the hub: a pass for everything granted **on the hub** (`axhub.pass_grant`, `POST
/auth/api/passes`, `axhub passes grant all`; decision #113) does cover `vps.run` and explicit-approval tools, for up
to 4 h. Brett's pass is made in the console, so it never gets there.

Not checked from here (no hub credential in this session): whether the live `axf-console` service has
`config.passFeed` set. Nothing in this repo's deploy files sets it. If it is unset the hub never reads the feed and
V1-V3 are moot; the result for Brett is the same.

### Confirm case: `console_terminal_sessions_stop` still asks

| # | Where | What it does | Effect |
|---|---|---|---|
| C1 | Console `apps/console-web/plugins/plugin-commands/commands.mjs` → `plan` (line 189) | A `confirm: true` command (`console-terminal/sessions-stop`: `destructive`, `confirm`) answers `confirmation_required` unless the call carries a confirm token. `plan` takes no pass and never asks token-control. | The stop asks even when the hub let the call through, and on REST / CLI calls that never touch the hub. |
| C2 | Console `control-pass.mjs` → `passCoveringCall`, `token-control/lib/pass.mjs` → `coveringCall` | The console does have a "does a pass cover this call" check, but only `pass-check` (CLI / `GET pass/check`) and one hint in token-control call it. No transport asks it before a confirm. | The check exists and is unused on the call path. |
| C3 | Console ← hub | The hub sends nothing with a forwarded call that says "this ran under pass X", so the console's second gate cannot know. | A hub-side fix alone leaves the console prompt in place. |
| C4 | axHub `passExclusion` (V5) | `console_terminal_sessions_stop` is destructive, so on the hub it is held at `confirm` under any pass that is not `all`. | The hub prompts first; the console would prompt again after. |
| C5 | Console `control-pass.mjs` → `passCovering` | Matches by scope id only (`all`, `tokens.*`); no `covers` list, no service or tool match. | A pass that names tools cannot exist on the console side (contract s1 needs it). |

## Reproductions

`apps/console-web/plugins/token-control/pass-coverage.test.mjs` (`node` that file). 5 fail on main, 3 controls pass:

| Test | Reproduces | Today |
|---|---|---|
| V1 the hub can read the pass the console publishes | V1, V2 | fails: `no passes list` |
| V2 the published pass says `covers: all` | V3 | fails: `["*"]` |
| V3 a 24-hour pass lasts 24 hours | V7 | fails: 240 minutes |
| C1 `console_terminal_sessions_stop` runs at once under the pass | C1, C2 | fails: `confirmation_required` |
| C2 the covered stop says which pass it ran under | logging contract (`ranUnder`, `policySkipped`) | fails: no field |

`hubReads` in that file restates the hub's `parseFeed` rules, so the test stays honest whichever side is changed;
if the hub's reader changes, change it there too.

The file is not in the CI workflow while it is red. Steps s3-s5 turn it green; s10 wires it.

Hub half (V4-V6): axHub `packages/core/test/passes.test.ts` on `claude/approval-pass-covers-every-call` (commit
002df19, PR #48) reproduces `vps.run` and `terminal_sessions_stop` under a named pass. That branch does **not**
cover V1-V3 or V7: its `parseFeed` still requires `passes` and its `PASS_MAX_MINUTES` is still 240.

## What the fixing steps need

- s3 / s4 (hub, axHub repo): read the console's publication as it is published (or agree one shape, V1-V2), read
  `covers` (V3), let a console `all` pass be a pass for everything (V4), drop the narrow exclusions per the s1
  contract (V5-V6), allow 24 h (V7). Then the hub's `match` covers `vps.run` and `holdVeto` is never reached.
- s5 (console): `plan` asks the pass before the confirm (C1-C2), and the hub tells the console which pass a
  forwarded call ran under (C3).
- This step changed no behaviour.
