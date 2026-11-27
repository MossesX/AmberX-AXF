# Owner recognized everywhere + veto countdown only on shell commands

Build `owner-recognized-everywhere-veto`, Nov 12 2026, Opus.

## Owner detection (s1)

Two halves, both needed:

- **Browser**: owner-only saves (`ownerFetch`, `apps/console-web/src/plugins.ts`) go out on Brett's hub session without
  the console token, so the wall forwards his signed session headers. Used by Claude settings, the No wait pass and the
  longest-pass setting.
- **Server**: a request with the console token *and* a signed, same-origin admin session resolves to the admin
  (`_token_caller`, `apps/console-web/server/main.py`); `control@1 owner()` accepts the signed session too
  (`token-control`). Every owner-only check that asks `control@1 owner()` (Claude settings, notify-control guarded
  types, passes) sees Brett.

Merged from PRs #415, #416 (owner parts) and #371 (tabbed view, Approvals & veto tab); this PR supersedes them.

axHub got the policy API the tab needs: `GET/PUT /auth/api/policy` (axHub decision 119, `packages/server/src/policy-web.ts`).
GET for the bearer token and an admin session; PUT only from a signed-in admin's browser session, never a token.

## Live policy (s2)

Applied on the live hub with the operator CLI (backup: `/root/axf-runs/policy-backup/*-2026-11-12.json`):

| Service | Veto (90 s) | Confirm | Allow |
| --- | --- | --- | --- |
| vps | run, launch | | check, logs, build_* |
| axf-console | console_terminal_sessions_run, agent_manager_vinny_commands_by_cid_run | orchestrator_upgrade_approve; destructive deletes (preset straight approval) | every other write (229) and every read |
| amberx | | recorder_start (explicit approval) | recorder_stop, recorder_status, open_url |

New console tools added later fall to the recommended preset (writes veto) until they get an entry: Approvals & veto →
Apply the default puts them on allow.

## Gaps

- `orchestrator_upgrade_approve` is `confirm`, which under `AXHUB_CONFIRM_AS=veto` shows as a countdown (it never runs
  without the window). A straight approval for an explicit `confirm` needs a policy engine change (Fable).
- `claude-accounts` decides owner from `user.admin`, which the console token also has: looser than `control@1 owner()`,
  left as is (not a recognition problem).
