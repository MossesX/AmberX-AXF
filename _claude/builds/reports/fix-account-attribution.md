# fix-account-attribution: builds record the wrong Claude account

Nov 9 2026 · branch `claude/fix-account-attribution` · urgent, from Brett (voice)

## What was wrong

Headless runs labelled **account-3 "Hulu" (hulu0241@gmail.com)** really ran on **Moses X (mossesx-max-, mossesx@gmail.com)**.

- `~/.claude-accounts/account-3/token` (saved Nov 5 22:36 UTC) is **Moses X's setup token**, not Hulu's. Proof: a free
  `count_tokens` request with that token and one with the live mossesx-max- login both return
  `anthropic-organization-id: 5375f3ca-c99c-4b3c-befb-067335f45fe3`, the org `claude auth status` reports for
  mossesx@gmail.com. (The token has inference scope only, so the profile endpoint can't name it. The org header can.)
- `deploy/claude-login.mjs snapshot` writes `export CLAUDE_CODE_OAUTH_TOKEN=<saved token>` into the build copy's
  `token.env` whenever an account has a `token` file. Claude Code ranks that variable above the config dir's
  `.credentials.json`. So every own-copy run "on account-3" authenticated as Moses X. The log header, the `session-login`
  event and claude-workers' cost all used the dispatcher's label, account-3.
- That is why Hulu showed ~$180 today while having no usage left, and why no API spend showed: it was Moses X's Max plan.

### Every credential path checked

| Path | What wins | Status |
|---|---|---|
| Saved `token` file → `token.env` | `CLAUDE_CODE_OAUTH_TOKEN`, beats `.credentials.json` | **the bug** (account-3) |
| Saved `apikey` → `token.env` | `ANTHROPIC_API_KEY`, beats everything | correct for API accounts; subscription accounts unset it |
| Global `~/.claude-accounts/.token.env` (sourced by `.bashrc`) | currently only `unset`s both variables | harmless today; tmux inner runs don't source `.bashrc` anyway; token.env overrides it |
| Inherited env (`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`) | dropped by `token.env` on the own-copy path | **was** live on the shared-login fallback (`AXF_OWN_LOGIN=off`, snapshot failed, no node) |
| Live `~/.claude` login | used by `--account active/live`, and by the shared-login fallback | the fallback was silent, even for a named account |
| AI keys limit switch | swapped a run to whatever login AI keys wrote live | **was** silent for named accounts too |

## What changed

- **`deploy/claude-whoami.mjs`** (new). Before the run, in the run's own environment, it asks `claude auth status --json`.
  If that gives no email (token or API key), it makes one free `count_tokens` call with the same credential and reads the org
  header. `orgs.json` (claude-orgs@1, next to `seen.json`, org ids and emails only) maps org id → email. Results:
  `ok | mismatch | dead | unverified`. It never prints or stores a credential. An expired access token that Claude Code
  would refresh is never called dead.
- **`deploy/claude-headless.sh`**:
  - after the snapshot (and after the token watcher starts, so a refresh is saved back) it runs the check.
  - **ok:** the log header says `· verified (<method>)`.
  - **mismatch:** the header, the `session-login` event (`account` = real, plus `picked`, `mismatch: true`), the tmux tag and
    the build note use the **real** login, so claude-workers charges the real account. A note goes on the build, and the
    mismatch is recorded on claude-workers. That raises an **error alert** in Claude accounts → Job routing and in the
    systems check (the "Claude API accounts" item).
  - **dead:** the account is marked out (`limit --kind auth`), the log says so in red, the run exits 4, and **nothing
    falls back**. A worker run moves to the next worker. A named account stops.
  - A named account (`--account` / `AXF_CLAUDE_ACCOUNT`) whose snapshot fails now stops instead of using the shared login.
    On a usage limit it is marked out and stops instead of AI keys swapping in another login.
  - The shared-login fallback (active/live only) is checked too, and named after the saved account it really is.
- **`deploy/claude-workers.mjs`**: `markMismatch` / `mismatch` command, `mismatch` on each status row (kept 24 h).
  **`deploy/worker-routing.mjs`**: a `login` error alert per mismatched account.
  **claude-accounts server**: passes `mismatch` through.
- **`claude-whoami.mjs backfill`**: re-attributes recorded `session-login` lines (dry run by default, keeps a backup and
  any lines appended while it runs).

## Done on the VPS

- Seeded `orgs.json`: `5375f3ca-…` → mossesx@gmail.com.
- Backfill applied: **30 runs** (Nov 6 00:58 → Nov 9 17:15, 16 of them today) moved from account-3 to mossesx-max-.
  All 30 used the own-copy path, the token file predates the first one and has not changed since, so each one exported
  Moses X's token. Backup: `/var/tmp/axf-headless/events.jsonl.bak-*`. claude-workers now shows account-3 at $0.00
  today and mossesx-max- at $184.61 today, $700.14 this week.
- Moved the misfiled token aside: `account-3/token` → `account-3/token.misfiled-mossesx-20261109`. account-3 now runs on
  its own `.credentials.json`. Its saved credential says plan `pro` (seen.json says `max`) and its access token is
  expired. The first run on it will show whether it still signs in. If not, the new check marks it out loudly.
- Recorded the mismatch on account-3, so the alert shows for 24 h.

## Tests

- `node deploy/claude-whoami.test.mjs`: 37 checks, in CI. Covers credential precedence, org learning, ok / mismatch / dead /
  unverified, the alert, the ledger and the backfill. It also runs `claude-headless.sh` end to end in tmux with a fake claude and a
  fake count_tokens server: a token from another login is logged, recorded and charged as that login; a dead login
  exits 4, is taken out, and claude never runs.
- Still green: claude-login (57), claude-workers (65), worker-routing (44), claude-token-save (24), claude-accounts
  test.py (89), check-agent-slots (56).
- Live: `check` with account-3's old token → `mismatch … mossesx-max-`; with the live login → `ok`.

## Open / not covered

- account-3 is a **stopped** worker but still got runs today. The dispatcher must be passing it by name. Worth a look
  (not changed here).
- The agent-swarm runner (`apps/console-web/plugins/agent-swarm/runner.mjs`) snapshots its own login with node and does
  not run the identity check yet.
- A mismatched run's slot claim stays on the picked account (the cost moves, the running count doesn't).
- Brett: to give Hulu its own token again, run `claude setup-token` **signed in as hulu0241@gmail.com** and save it as
  `~/.claude-accounts/account-3/token`. Otherwise leave it on its `.credentials.json`.
- No orchestrator build exists for this job, so there were no steps to tick and nothing to link.
