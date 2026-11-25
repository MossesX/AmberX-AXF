# s7: a covered call never sends a push notice

Step s7 of `approval-pass-covers-every-call` (Nov 25 2026).

## Rule

A call an active pass covers runs at once and sends **no veto notice and no approval notice**, on any channel. If the
pass setting `quietNotice` is on, each covered run sends one quiet "ran under pass" line (tool name and pass id only,
never the arguments). The setting is off by default: a covered run sends nothing.

A sender that can't tell (no call name, no pass plugin, a check that fails) treats the call as **not covered** and
sends the notice. A broken check never hides a waiting call.

## Where the senders are

| Sender | Repo | What it does now |
|---|---|---|
| `ApprovalPush` (ntfy "approval waiting", postponed reminder) | axHub `packages/server/src/approval-push.ts` | Asks `Hub.coveringPassFor` first; a covered call gets no push. |
| Vinnie (veto `held`, `warning`, `running`) | axHub `packages/server/src/vinnie.ts` | Same check; follow-ups only for a notice already on the phone; `stuck` always goes. |
| Quiet line | axHub `withPassNotices` | One lowest-priority "Ran under pass" line when the pass carries `quietNotice`. |
| Pass feed | axHub `packages/server/src/pass-feed.ts` | Keeps `quietNotice: true` from a console pass. |
| Follow Amber approval pop-up | this repo, `apps/console-web/plugins/follow-amber/server/__init__.py` → `approval` | `POST approval` takes `call` (`service.tool`); a covered call pops nothing up and the answer says `ranUnder`. With `quietNotice` on, the consoles get one `pass-run` frame, shown as a plain toast. |
| Pass setting | this repo, `apps/console-web/plugins/token-control` | `quietNotice` in `pass/settings` (REST `GET`/`PUT`, CLI `control.mjs pass-settings '{"quietNotice":true}'`); published on each active pass. `control@1` gains `pass_covering(call)` and `pass_quiet_notice()` for other senders. |
| AmberX on the phone, the veto banner | read the hub's feed | Nothing to change: a covered call is never held, so it is never in the feed. No Kotlin work. |

axHub commits: `16fac6b`, `7533c70` on `MossesX/axHub` branch `claude/approval-pass-covers-every-call--s7` (cut from
axHub `main`, pushed, no PR opened). The hub half is not live until that branch lands and the hub is deployed.

## Choices

- The Notifications panel shows the quiet line as two rows: `follow.pass-run` (console, switchable) and
  `axhub.pass-run` (the hub's line, shown but switched by the pass setting).
- `quietNotice` has no switch in the web UI yet; it belongs on the pass settings page (step s8). REST and CLI work now.
- The console's pass check covers what the console's pass matcher covers. On `main` that is an all-scope pass; the
  per-tool `covers` list arrives with steps s3 and s5 and the senders pick it up through the same call.

## Checks

- axHub, Node 22 in Docker: `passes`, `approval-push`, `veto` (server) and `passes` (core): 87 of 87.
- This repo: `follow-amber/test.py` 70 checks, `follow-amber/test.mts` 14, `token-control/test.mjs` 23 tests,
  `notify-control/test.py` 133 checks.
