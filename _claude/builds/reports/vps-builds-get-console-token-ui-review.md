# VPS builds get the console token so UI Review works, banner alert when it fails

Build `vps-builds-get-console-token-ui-review` · branch `claude/vps-builds-get-console-token-ui-review`

Brett (2026-11-13 18:13): "the VPS builds, the UI reviews, does that have anything to do with it"

## s1 Diagnosis

Yes. Headless builds on the VPS start without `AXF_TOKEN` and `AXF_CONSOLE_URL`:

- `deploy/claude-headless.sh` passes an explicit allow-list of env vars into tmux, plus a private
  secret file that carries git auth and `AXHUB_TOKEN` only. The console token was never in either.
- Confirmed in this build's own session: `AXF_DISPATCH_TOKEN`, `AXF_BUILD_ID`, … are set; `AXF_TOKEN`
  and `AXF_CONSOLE_URL` are not.
- `review.mjs submit --console` then throws `--console needs AXF_CONSOLE_URL and AXF_TOKEN` (exit 2), and
  without `--console` it writes the item into the worktree's own data folder with only a stderr warning.
- `axf shot` (shots.mjs) silently falls back to the worktree data folder when the env is missing.
- Result: review items and screenshots stay in `/root/axf-builds/<build>/…`, Brett never sees them, and
  nothing tells him. When the worktree is removed they are gone.

## s2 Launcher passes the console URL and token

`deploy/claude-headless.sh` (every dispatcher, agent-slots and manual launch goes through it):

- `AXF_CONSOLE_URL` goes into the tmux env: `AXF_CONSOLE_URL`, else `https://<DOMAIN>` from the console's
  env file (`AXF_CONSOLE_ENV`, default `/opt/axf/.axf-console/env`), else `https://console.amberxai.com`.
- `AXF_TOKEN` goes through the existing private secret file (0600, sourced and deleted by the inner run,
  never on tmux's command line, never logged), from the env, else the console's env file.
- Heavy steps via `agent-slots.mjs heavy` inherit the session env, so they get both too.
- Test: `deploy/claude-login.test.mjs` end to end checks the fake claude sees both and that the token is
  printed nowhere. (4 checks in that file already fail on main, unrelated: account switching mid-run.)
- Scope: the console accepts one token today, so builds get the console token itself. A per-build scoped
  token needs a console auth change (cross-app contract, Fable): recorded as a follow-up below.

## s3 Screenshot tools authenticate

- `framework/cli/rebuild-shots.mjs`: the scratch console runs with `AXF_APPEARANCE_HUB=off` unless `--env`
  names a hub (the capture browser has no axHub session, which is why every shot was "Waiting for axHub"),
  never inherits the real `AXF_CONSOLE_URL` (its throwaway token only earned 401s), and a capture that
  shows only the axHub waiting / sign-in screen is dropped and the run exits 3 with the reason.
- `apps/console-web/plugins/ui-review/console-call.mjs`: one console call for `review.mjs` and `shots.mjs`,
  no redirects, and a message per failure: no token, token refused (401/403), web page instead of the API
  (wrong URL or stopped at the wall), unreachable.
- `review.mjs` in a build worktree with the console address + token now posts to the console by default
  (as `axf shot` already did); `--local` keeps the old behaviour.
- Checked against the live console: `review.mjs state --console` answers; a wrong token says 401 plainly.
