# pass-approval-hook-deep-link-amberx-notification — a link to the pass, a hook to it

Brett, Nov 10 2026: "I'm gonna need a link to the pass, a hook to it."

P0 build, Phase 1 Fable (s1: contract `docs/contracts/pass-approval.md` + `packages/shared/pass-approval`), Phase 2 Opus
(s2–s9, Nov 14 2026). Branch `claude/pass-approval-hook-deep-link-amberx-notification`. The s1 commits were not on any
branch after the duplicate dispatch on Nov 10; this session cherry-picked them first.

## What a veto pass request now comes with

| Surface | Open | Read | Approve / deny |
|---|---|---|---|
| Deep link | `https://console.amberxai.com/#/pass/<id>` (`/approve`, `/deny` = button primed); Molly `#/console/pass/<id>` or `#/pass/<id>` | the pass-approval view | one tap with Brett's session |
| console_show / console_open | target `pass:<id>` (or a bare pass id) → Token control, focused on the pass | — | — |
| Console actions | `token-control.pass:<id>[/approve\|/deny]`, `token-control.focus:pass:<id>`; Molly `molly.pass:<id>` | — | — |
| REST | — | `GET /api/passes/pending`, `GET /api/passes/<id>` (plugin mount: `pass/pending`, `pass/<id>`) | `POST /api/passes/<id>/approve\|deny` (owner session or axHub's signed headers); `POST /api/passes/action {token}` (signed token, no session) |
| MCP | `console_show pass:<id>` | `pass_list_pending`, `pass_get`, `pass_status` | `pass_approve` / `pass_deny` answer `approval_required` + the link (MCP never decides) |
| CLI | `axf pass link <id>` | `axf pass list`, `axf pass show <id>` (`--remote` = /api/passes) | `axf pass approve\|deny <id>` at a terminal (types the scope back) |
| Voice (AmberX) | "open the pending pass" | "what's waiting" | "approve / deny the pass": with the notification's token it decides; without, it opens the pass with that button ready |
| Push | tap = deep link | — | Approve / Deny on the notification, in the background |

`pass_grant` (and `POST pass/grant`, `control_act pass.scopes grant`, every pass view) answers `deep_link`, `approve_url`,
`deny_url`, `molly_url`, `target`, `hand_over`; the sentence ends with "Approve here: <deep_link>". No answer to a bearer
caller ever carries a token.

## How it is built

- **Service** `apps/console-web/plugins/token-control/lib/pass-approval.mjs`: `getPass`, `listPending`, `decidePass`
  (owner approval or a pa1 token, verified with the shared `node.mjs`), `tokensFor` (device delivery only), `alertFor`.
  Decisions go through the existing `pass.scopes` approve / deny (`runControl` → `runPass`); a token decision is
  `approvedVia: push` (added to control-pass@1 `PASS_APPROVED_VIA`) with `decidedBy {nonce, decision}`. Idempotent: the
  same token again, or the owner deciding the same way again, answers `already: true`; the other decision is `decided`.
  Every call, refused or not, is an audit row (`op: pass-approval`, result, nonce).
- **REST** in `token-control/server/__init__.py`; `/api/passes` aliases through capability `pass-approval@1` in
  `server/main.py` (`CAPABILITY_MOUNTS`); a provider's `public_router` is mounted without the console's auth, which only
  `POST /api/passes/action` uses (the signed single-use token is the proof).
- **Deep link resolver**: console-focus@1 can now have several providers (`plugin_services.get_all`,
  `console-focus@1/pass`); console-commands tries each.
- **Console UI** `token-control/web/pass-approval.tsx`: requester, scope, veto window, request-lapse countdown, reason,
  approver, link; Approve / Deny / All passes. The hash route `#/pass/<id>` is handled by the plugin's `register`.
  Banner chips and Token control → Passes have Open.
- **Molly**: `#/pass/<id>` shorthand, `molly.pass` action, and a link that arrives while Molly is open moves the live
  console frame (fragment change, no reload).
- **Push**: a watcher in token-control raises one alert per request (`pass:<id>`, link = deep link, no token,
  `push: true` = reaches the set-up phone channels below their minimum severity; notify type `pass.request`, guarded).
  The alert hub asks `alert-actions@1` for per-delivery buttons: web push (`alerts-sw.js` POSTs the token in the background
  and shows the answer as a follow-up) and ntfy (`http` actions). When the pass stops waiting the same key is raised with
  the outcome (replacing the ask on the phone) and resolved.
- **Voice**: `console_control_api.voice` asks `voice-intents@1` providers first; token-control answers the pass phrases.
  `POST /api/console-control/voice` accepts `token` (the notification's) for "approve the pass".

## Decisions

- approve_url / deny_url open the pass primed; they never decide (an agent handed the link can't approve its own pass).
- AmberX native Approve / Deny buttons are Kotlin work: deferred gap in `framework/spec/PORTING.md`. Today AmberX's alert
  watch shows the pass alert and its tap opens the deep link; background buttons work through web push and ntfy.
- Voice without a token does not decide: a voice request is no proof it is Brett.
- `axf pass list` now lists waiting passes; `axf pass status` stays the scope table.
- No catalog feature id fits this build, so `framework/catalog/status.json` is unchanged.

## Tests

- `node packages/shared/pass-approval/test.mjs` (11, cases.json: expiry, replay, wrong pass, signatures) — now in CI.
- `node apps/console-web/plugins/token-control/test.mjs` (25): grant result fields, decide by token (replay, other token,
  nonce recorded), expiry, wrong pass, forged signature, owner path + idempotency, audit rows, CLI parity.
- `python apps/console-web/plugins/token-control/server/test_pass_approval.py` (60): REST on both mounts, owner vs bearer,
  pass/action, focus resolver, watcher → alert → actions → web push payload / ntfy actions → outcome, voice, MCP parity,
  the push flag. Added to CI.
- Regression: `test_mcp_tools.py` (222), `test_console_commands.py` (121 + 2 for a second focus provider),
  `tests/test_console_control.py`, `test_alerts.py`; `tsc --noEmit` (console-web); check-theme, check-controls,
  check-toolbars, check-chrome-assets.

## Open

- UI Review screenshots: `rebuild-shots.mjs` rendered blank pages in this session (Chromium `ERR_NETWORK_CHANGED` on every
  module load), so none were submitted. The view needs desktop + phone shots before the PR is called ready.
- AmberX native notification actions (PORTING.md deferred gap).
- Behind axHub's wall, `POST /api/passes/action` from a phone needs the hub to let it through (the device's hub session
  does; a bare ntfy `http` action has none). If ntfy Approve answers 401 in production, the hub needs that path open.
