# theme-veto-pass — timed veto passes for token changes

Build `theme-veto-pass` (profile Urgent), Opus, Nov 3 2026. Branch `claude/theme-veto-pass`, based on `claude/token-control-opus`
(PR #250, which contains #246): **merge after #250**. Requested by Brett (voice): "allow theme changes for the next 30 minutes".

## What it does

Every changing call through axHub is a veto call (90 s countdown). A **pass** lets token `set` / `reset` in one scope
(`tokens.theme`, `tokens.style`, `tokens.layout`, `tokens.*`) run at once until it ends, after Brett approved the pass itself once.

## Steps

| Step | What landed |
|---|---|
| s1 control@1 `pass` resource | New target `pass.scopes` (domain `pass`, permissions `control.pass.read|write|delete`): `list` / `get <scope>` = status, `act <scope> grant {minutes, reason} | approve {request} | deny {request} | revoke | undo`. Pure engine `framework/core/engines/control-pass.mjs` (scopes registry, append-only; coverage; minutes 1-240, default 30, cap from the setting; one pass per scope, re-grant replaces and carries the change log; plain sentences; undo plan; signed publication shape). Deletes, `add` and `act` are never covered. |
| s2 grant approved once | A grant is a request until the owner approves it. The approval comes from the transport, never the command: Brett's signed-in console session (`via: session` admin, the banner sends owner actions without the bearer token), axHub's HMAC-signed approval headers, a console with no token (local dev), or a typed confirmation at a real terminal. MCP tools and the `control@1` capability never approve. Requests lapse after 15 min. Expiry is the server clock. |
| s3 REST, MCP, CLI | REST `/api/plugins/token-control/pass…` (`GET pass` signed, `pass/status`, `pass/check`, `pass/grant|approve|deny|revoke|undo`, `pass/settings`) plus the generic `/api/control` routes; MCP `token_pass_grant`, `token_pass_status`, `token_pass_revoke`, `token_pass_undo` (and `control_act` on `pass.scopes`); CLI `axf token pass grant theme 30`, `status`, `revoke`, `undo`, `approve`, `deny` (also `axf pass …`). Answers carry `text`: "Theme changes run without veto until 10:42 AM (30 min left)." |
| s4 visibility + safety | Banner `token-pass`: one chip per active pass with a live countdown, Extend, Undo N, Revoke; warning tone + "ending soon" 2 min before the end; waiting requests with Approve / Deny. Passes tab on the Token control page; Settings → Plugins → Token control → Veto passes (longest pass, time zone). Every grant / request / approval / change (who, token, old → new) / revoke / undo / end = one audit row (with the pass id) and one line under `## Token passes (log)` in THREADS.md (hub copy where mounted). `undo` puts each token back to its value before the pass first touched it (an older override comes back as that override). |
| s5 read-only annotations | All 20 read tools on the console MCP already carried `readOnlyHint`; new `apps/console-web/server/test_mcp_tools.py` locks it (every list/get/status/find/… tool read-only, every `*_remove` destructive, read-only tools must be named as reads) and checks the pass tools. Recommended axHub policy written in CONTROL.md. |
| s6 axHub contract | CONTROL.md → *Veto passes*: the signed publication (`X-AXF-Pass-Signature: t=<ms>,v1=HMAC-SHA256(secret, "<t>.<body>")`, secret `AXF_PASS_SECRET` else `AXF_WALL_SECRET`), how axHub decides a held call, the approval it forwards (`X-AXF-Pass-Approval` over `approve.<request>.<scope>.<minutes>.<approver>`), the `passScope` / `pass` stamp on every write answer, and the policy table. |
| s7 wrap-up | Help pack (passes tab, banner, settings, plus the 10 controls #250 left without help: coverage back to 100%), Docs tab guide, tests, checks, report, THREADS, STATUS, PR. |

## Contract / API / fixture changes

- control@1: target `pass.scopes` added (append-only), domain `pass` (12 permissions), two CLI usage lines, alias `pass`.
  `framework/schemas/control.json` and `framework/spec/fixtures/control.json` regenerated; `check-control.mts` updated (14 targets).
- Every control@1 write answer now carries `passScope` (and `pass` when covered). Additive; old clients ignore it.
- New REST routes and MCP tools listed above; `Control.run` unchanged (never approves).
- Plugin 0.1.0 → 0.2.0; new env names in its lifecycle (`AXF_PASS_SECRET`, `AXF_PASS_MAX_MINUTES`, `AXF_THREADS_FILE`, `AXF_TIMEZONE`, `AXF_OWNER`, `AXF_NO_TTY_APPROVAL`).

## Tests

| Check | Before | After |
|---|---|---|
| `node apps/console-web/plugins/token-control/test.mjs` | 13 tests | 19 tests (engine; request-only grant, self-approval / forged / bad signature refused, signed approval; owner grant, logged changes, deletes still confirm, sizing outside every scope; undo incl. an older override; extend carries the log, one pass per scope, server-clock expiry, revoke, lapse; signed publication, check, CLI) |
| `python apps/console-web/server/test_mcp_tools.py` (new, add to CI) | – | 124 checks, 51 tools, 20 read-only |
| `npx -y tsx framework/spec/check-control.mts` | 13 targets | 257 checks, 14 targets |
| `node framework/cli/help-coverage.mjs --check` | console-web 98.7 % (failing on #250's page) | 100 % |
| check-theme, check-controls, check-help, `tsc --noEmit` (console) | pass | pass |
| `plugin-lifecycle.mjs check token-control` | 1 stale line (THREADS) | THREADS line marked |

## Screenshots

Desktop + phone of the banner chip (active theme pass with 2 changes + a waiting layout request) and the Passes tab, sent to UI Review
(group `theme-veto-pass - Nov 3 10:41 AM`). In the screenshot sandbox the banner group was hidden (its look had the group folded),
so the banner shots inject one style rule to show `.fx-frame-banners`; nothing in the product changes for that.

## Known gaps

- axHub side (`axhub-veto-pass`, axHub repo) still has to read `GET pass`, skip covered calls and forward Brett's approval with
  the signature; until it lands, a pass shows and logs but axHub still vetoes every call.
- A shell on the VPS can always write files directly; the pass guards the API, MCP and CLI surfaces, not the disk.
- Undo writes the before-values even if someone changed the same token outside the pass afterwards (last write wins, as everywhere).
- Kotlin twin deferred (Android on hold); recorded with the control@1 gap.
