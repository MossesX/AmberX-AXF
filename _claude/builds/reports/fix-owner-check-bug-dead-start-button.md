# Fix owner check bug + dead start button

Build `fix-owner-check-bug-dead-start-button` (bug fix, P0, Opus). Branch `claude/fix-owner-check-bug-dead-start-button`.

## What was broken

### 1. Owner-only settings refused Brett's own admin login

Signed in to the console as admin, *Launch builds without asking* (and every other `owner: true` Claude setting, the
No wait pass, guarded notification types) said "owner only" and would not change.

Cause: the console page sends its stored console token on every request. `auth()` / `auth_always()` in
`apps/console-web/server/main.py` checked the token first and labelled the request as the shared token caller
(`console-token`, `via: "token"`) before looking at the signed axHub session headers. Token-control's
`owner_approval()` (the single owner check behind `control@1 owner()`, used by Claude settings, the No wait pass and
notify-control) only accepts a signed-in admin **session**, so Brett's click looked like a session/MCP/voice call.

*Max parallel builds* behaved as designed: it is `owner: "raise"` (anyone may lower it). The live value is 1, lowered
by Amber on Nov 6, which is why it looked like it "worked" while the toggle did not.

### 2. Build Manager Start (now "Queue") on a pending build did nothing

Since Nov 9 the button sends the row to the Build orchestrator. For a pending build it called
`axf.build-dispatch@1 request(title, …)`, which files a **new** build (`<slug>-2`) and queues that copy. The build on
screen stayed Pending, so nothing visibly happened, and the Build Manager wrote no console log line either way.

## Fix

- `main.py`: `_token_caller(request)`. A request that passes the token check **and** carries signed axHub admin
  session headers from the console's own origin is that admin's session; the token alone, unsigned headers, a plain
  user's session or a cross-site write stay the token caller. Applied in `auth()` and `auth_always()` (HTTP). The owner
  check itself is unchanged, so every owner-only setting that goes through `control@1 owner()` is fixed at once.
- `build-manager/server`: `send_to_queue()`. A row whose build the orchestrator already has is queued as itself
  (`dispatch.queue(id)`); one already queued or running is reported as such; any other state refuses with the reason;
  only a row with no build behind it (plan feature, build-queue step) is filed as a new build. An orchestrator error
  other than "not found" refuses instead of risking a duplicate. Every Queue press now writes a console log line
  (system channel) with the key, the orchestrator build id, what happened and who.
- `build-manager/web`: the toast says "already in the orchestrator" when that is the case.

## API (how each part is reached without the UI)

- Owner-only settings: REST `PUT /api/plugins/claude-settings/settings` (owner only from Brett's signed-in session, by
  design); MCP `claude_settings_get` / `claude_settings_set` (non-owner keys); CLI `claude-settings.mjs`. Unchanged
  surface; the fix is who the server recognises as the owner.
- Queue a build: REST `POST /api/plugins/build-manager/start {key}`; the orchestrator's own
  `POST /api/plugins/build-orchestrator/pipeline/queue`, CLI `pipeline.mjs queue <id>`, MCP / voice pipeline commands.

## Tests

- `apps/console-web/server/test_wall_users.py`: 65 checks (8 new: token + signed admin session = the admin as a
  session; token alone, cross-site, unsigned, plain user stay the token caller; `control@1 owner()` gives / refuses
  the owner approval accordingly). Needs a built `dist/` to run (CI has it).
- `build-manager/test.py`: 127 checks (3 new: pending build queued as itself, running build left alone, archived
  build refused).
- Green: claude-settings (core 47, server 21), token-control 20, build-orchestrator 31, notify-control 132,
  claude-accounts 89, console MCP tools 203, alerts, console `tsc`, check-theme, check-controls.

## Not done / notes

- The only UI change is one toast's wording (no layout), so no UI Review item was filed.
- Sibling build `owner-only-settings-brett-s-admin-console-login-counts-as-owner` (queued, Nov 6) asks for the same
  owner fix; this PR covers it.
- No duplicates from the old Queue path exist in the orchestrator store (no build has source `build-manager`).
