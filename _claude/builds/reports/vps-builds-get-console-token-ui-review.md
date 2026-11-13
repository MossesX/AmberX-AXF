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

## s4 Failures raise a banner alert

- New health check `ui-review-stuck` ("Build screenshots reach UI Review", every 60 s, severity error) in the
  UI Review plugin (`server/stuck.py`). It scans build worktrees (`/hostfs/axf-builds` in the console container =
  the host's `/root/axf-builds`; `AXF_UI_REVIEW_STUCK_ROOTS` overrides) for UI Review items and screenshots the
  console doesn't have and for failed-submit markers. Red = systems check banner item + one phone alert
  (`system:ui-review-stuck`), the systems check's normal path. `GET /api/plugins/ui-review/stuck` lists them.
- `console-call.mjs` `reported()`: a failed write from a build worktree writes `submit-failed.json` in its UI
  Review data folder (read by the check) and, when the console still takes the token, raises a console alert at
  once (`POST /api/alerts`, source `ui-review`, key `ui-review:submit-failed:<build>`). A later success clears it.
- The launcher warns and leaves a build note when it has no console token to hand over.
- First scan of the VPS: 6 review items and 4 screenshots stuck in 6 build worktrees.

## s5 Stuck shots re-sent

`review.mjs resubmit [--roots …] [--dry-run]` (`resubmit.mjs`) re-runs the normal CLIs against the console for
every stuck item / screenshot and records what went in the worktree's `sent.json` (nothing deleted). An item the
console already has (same name + branch) is recorded without a second copy; loose pictures identical to a stuck
item's are skipped. Run on the VPS, 13 Nov 2026:

| Worktree | What | Result |
|---|---|---|
| chrome-settings-actually-apply-toolbars | 1 review item (4 shots) + 4 screenshots | sent |
| full-api-control | Console search palette (Ctrl+K) | already in UI Review (r-20261113-3lor001) |
| github-client-plugin-see-control-every | GitHub client: PRs, batches, git log (6 shots) | sent |
| new-project-wizard-name-linked-repo | New project wizard (10 shots) | sent (r-20261113-55a269bb) |
| project-duplicate-boilerplate | Duplicate project, boilerplates (6 shots) | sent |
| tab-groups-choose-how-many-rows-tabs | Tab group Rows (2 shots) | sent |
| /root/axf-review-shots/github-client | 6 loose pictures | skipped: same pictures as the GitHub client item |

9 sent, 0 failed. The scan is clean afterwards.

## s6 Duplicate removed

`builds-get-console-token-banner-alert` (filed 17:34 from the console, no pending id, same request and the same
five steps as this build) removed with `orchestrator.mjs act remove`; builds-live put it on main (`afcad03f8`).

## s7 Tests, Shipped features

- `apps/console-web/plugins/ui-review/test.py` (CI glob): stuck scanner roots, unknown items/shots found and console
  ids skipped, red probe with counts, `sent.json` clears it, a failure marker alone turns it red, `GET stuck`. 235 ok.
- `apps/console-web/plugins/ui-review/test.mts` (CI glob): console call failure codes (no-token, 401, web page,
  redirect, unreachable, 5xx), Bearer + no redirects; `reported()` writes the marker and raises the alert, never on a
  refused token, clears on success; resubmit plan flags, skip without pictures, dedup of known items and loose
  duplicates, `sent.json`, marker cleared, second run empty. 32 ok.
- `deploy/claude-login.test.mjs`: the build session sees `AXF_TOKEN` and `AXF_CONSOLE_URL`; the token is printed nowhere.
- `plugin-lifecycle.mjs check ui-review`: clean.
- Shipped features: `cx.buildengine.reviewtoken` in `framework/catalog/catalog.json` + `status.json` (built).

## s8 "the VPS builds, the UI reviews, does that have anything to do with it"

Yes. It was the same fault behind both:

- VPS builds start through `deploy/claude-headless.sh`, which never handed over the console token. Every build
  that tried to put screens in UI Review either got refused (`--console needs AXF_CONSOLE_URL and AXF_TOKEN`) or
  wrote them into its own worktree, where Brett never sees them. Nothing raised an alarm.
- On top of that, builds that took screenshots with `rebuild-shots` got the "Waiting for axHub" screen instead
  of the UI, because the capture browser has no hub session.
- Scale: since Nov 1, 44 builds' notes say UI Review shots were missing, refused, not captured or waiting for
  axHub. 6 builds had items or shots sitting in their worktrees today (sent now, s5).

What changes for the next build: it starts with the console URL and token, its shots land in UI Review, a submit
that still fails leaves a marker and a console alert, and the `ui-review-stuck` check turns the systems check
banner red within a minute if anything is stuck in a worktree.

## Follow-ups

- Per-build scoped console token (only UI Review / shots / activity routes, expires with the build): needs the
  console's auth to accept a second token class. Cross-app contract, so Fable. Today builds carry the console token
  itself, the same way they already carry `AXHUB_TOKEN` (private file, never logged).
- `/root/axf-review-shots` is not mounted in the console container, so the health check scans build worktrees
  only; `review.mjs resubmit` covers both folders on the host.
