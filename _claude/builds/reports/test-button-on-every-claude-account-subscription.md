# Test button on every Claude account (test-button-on-every-claude-account-subscription)

Built Nov 10 2026 on Opus, branch `claude/test-button-on-every-claude-account-subscription`.

## Asked
Brett (Nov 9): "Why is there no way to test these accounts? There's no fucking button to test them." Addendum 1: an
animated loading state that checks each account one at a time and shows its status. Addendum 3 (overrides 2): no check
when the console opens and none before the orchestrator launches. Only manual. "If the build fails, that's the check."

So the step text "Same check runs before the orchestrator launches on an account" was **not** built: Addendum 3 drops it.

## What changed
- **Host check** `deploy/claude-account-check.mjs check <name> [--models opus,fable] [--json]` (account-check@1).
  It makes one `claude -p` call per model with a one-line system prompt, no tools, no MCP, `--safe-mode` and no saved session,
  on a private copy of that account's saved login or API key (`claude-login.mjs snapshot`, released straight away so a
  refreshed token goes back to every store). Results: `alive`, `expired`, `bad-key`, `no-credit`, `limit` (with the
  reset time if Claude gave one), `error`, plus a result per model (`ok`, `unavailable`, …). If the login or key itself
  fails, it stops after one call. A healthy account takes about 9 s.
- **Plugin server** (claude-accounts 0.5.0): `POST check {name}`, `POST check-all {names?}` (one at a time),
  `GET checks` (last result per account, plus which account is being tested and which are still queued). Every row of
  `GET accounts` / `GET routing` now carries its last `check`. Results are kept in `checks.json` in the plugin data
  folder; no credentials are stored there. Only the owner can run a check. It goes through the Terminal's host
  read connection, not a held axHub call, because it changes nothing on the host.
- **UI**: every account row (Accounts and Job routing → Account status) gets a status chip (Not tested / Testing… / Waiting
  to test / Alive / Login expired / Bad key / Out of credits / Limit hit / Check failed), a **Test** button, and a
  line with each model's result and when it was tested; if a check fails, Claude's message shows too. **Test all** runs the
  accounts in turn with an animated framework Meter and "Checking account-3 (2 of 4)…". The busy Test button spins on
  the account being tested. When it finishes: "N of M accounts alive". Nothing runs when the page opens.

## API (all four the same)
- REST: `POST /api/plugins/claude-accounts/check`, `/check-all`, `GET /checks` (state also on `GET /accounts`).
- MCP / plugin commands: `check`, `check-all`, `checks` (auto from plugin.json). CLI: `axf claude-accounts check --name <n>`.
- Voice (AmberX): "test account 3", "test all Claude accounts" (spoken names are cleaned to `account-3`).
- Console actions / deep link: `claude-accounts.test:<name>`, `claude-accounts.test-all` open Settings → Plugins →
  Claude accounts and run the test there, so the progress is visible. Capability `axf.claude-accounts@1`: `check(name)`, `checks()`.

## Live result (real run on the VPS, Nov 10)
- account-5: alive on Opus and Fable (8.6 s).
- account-3: **login expired** ("OAuth session expired and could not be refreshed"). Brett: Settings → Plugins →
  Claude accounts → account-3 → **Sign in**.

## Checks
`node deploy/claude-account-check.test.mjs` (22, also in CI), `python3 apps/console-web/plugins/claude-accounts/test.py`
(107), `node deploy/claude-workers.test.mjs`, `node deploy/worker-routing.test.mjs`, `node deploy/claude-login.test.mjs`
(run with `AXF_CLAUDE_ACCOUNT` unset; a headless session's own value leaks into it otherwise), `tsc --noEmit`,
check-theme / check-controls / check-toolbars / check-chrome-assets, plugin-lifecycle.

## Left
- UI Review approval of the desktop and phone screenshots.
- The host script only runs after deploy (`/opt/axf/deploy/claude-account-check.mjs`). Until then a test answers "The VPS didn't
  answer the check (is deploy/claude-account-check.mjs deployed?)".
- No Android/Kotlin twin. The console has no Kotlin port of this plugin.
