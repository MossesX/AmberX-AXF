# build-own-login: every headless build keeps its own Claude login

Brett, Nov 5 2026 (voice): "Yeah, it should be like that already." (after two builds died with "Not logged in" when
he logged the VPS Claude out to add another account). Branch `claude/build-own-login-r2` (r1 died at launch on a usage
limit and left nothing). Opus, one session.

## Before / after

| | Before | After |
|---|---|---|
| Login a build uses | the one shared `~/.claude/.credentials.json` | its own copy in `<build folder>/.axf-claude/<session>/` (`CLAUDE_CONFIG_DIR`) |
| VPS logout / switch / new login | every running build dies or moves to the new account | running builds don't notice; new launches use the new active account |
| Token refresh | written to the shared login | written to the build's copy only |
| Inherited `CLAUDE_CODE_OAUTH_TOKEN` | beat the login file | dropped, unless the account has a saved token (then that one) |
| Which account a build ran on | unknown | log line `# login account-2 (email) · own copy`, tmux tag `@axf_login` (Terminal `login` field), `session-login` event, note on the orchestrator build |
| Pick an account per launch | no | `--account <name>` / `AXF_CLAUDE_ACCOUNT` (default: active) |

## What changed

- **`deploy/claude-login.mjs` (new):** `snapshot | release | who | accounts`. Copy = the credentials file (real, 0600),
  a copy of `~/.claude.json` minus the cached `oauthAccount` (it goes stale on every switch: the switcher swaps only the
  credentials file), `token.env` (export the account's saved token, else `unset CLAUDE_CODE_OAUTH_TOKEN`), a
  `build-login@1` record (account, email, source; never a credential), and symlinks to everything else in `~/.claude`
  (settings + hooks, CLAUDE.md, transcripts, plugins), so builds behave as before. Folders 0700, `.axf-claude/`
  git-ignored. Release only deletes a folder carrying its marker and never follows the symlinks.
- **Which account:** `active` = the switcher's active account; its freshest copy is the live login unless the live login
  is byte-identical to another saved account or missing (logged out), then the saved copy. `live` = the live login,
  named after the saved account it matches (used after AI keys switches accounts on a usage limit). `<name>` = that
  saved account. No store = the live login, recorded as `live`. Mechanism checked on Claude Code 2.1.318:
  `CLAUDE_CONFIG_DIR` makes it read `$CLAUDE_CONFIG_DIR/.credentials.json` and `.claude.json` only (empty dir = not
  logged in), and a real `claude -p` ran fine on a copy.
- **`deploy/claude-headless.sh`:** the inner run snapshots before Claude starts, exports `CLAUDE_CONFIG_DIR`, sources
  `token.env`, writes the `# login` line into the log, tags tmux, logs the event and notes the build; releases the copy
  when Claude exits (before the close wait). On a usage-limit account switch it re-snapshots from the live login.
  `--account` flows through the look-approval and queue waiters into tmux. The no-tmux fallback gets a copy too and a
  tiny wrapper deletes it when that `claude` exits. A failed snapshot never stops a run: it warns and uses the shared
  login. `AXF_OWN_LOGIN=off` turns it off.
- **Agent swarm** (`runner.mjs` jobs, `swarm.mjs` banter): same copy through `ownLogin()`; released when the run ends.
- **Console Terminal** (`sessions.py`): `@axf_login` read into each headless item's `login` (data only, no UI change).
- **CI:** `node deploy/claude-login.test.mjs` in android.yml.
- Lifecycle: `deploy/claude-login.mjs` is a marked mention of claude-accounts (the seen-emails path), the test of
  agent-swarm. The switcher's save/use logic and the claude-accounts plugin code were not touched (README line only).

## Launchers covered

`claude -p` callers: `deploy/claude-headless.sh` (axHub `vps.build_start`, orchestrator / build-manager launches,
systems-check and push-banner "Fix with Claude", agent-job router, console headless tabs all go through it), agent swarm
runner + banter. The `nohup claude -p` fallbacks in `build-manager/web/orchestrate.mjs` and the two `claudefix.py`
only run when `deploy/claude-headless.sh` is missing from the checkout (then `claude-login.mjs` is missing too), so they
stay on the shared login.

## Tests

- `node deploy/claude-login.test.mjs`: 50/50 (new). Fake accounts + fake `claude`, tmux on its own socket: the shared
  login is logged out and switched to another account mid-run, the build keeps its login; its refresh lands only in its
  copy; inherited token never reaches it; saved token used for an account that has one; `--account` per launch; log +
  event name the account; copies gone at session end; no credential string in any output.
- Unchanged and green: `check-agent-slots.mjs` 56/56, agent-swarm `test.mjs` 100, console-terminal `test.py` 140 (+1),
  `check-card.mjs`, plugin-lifecycle for claude-accounts clean (no new stale hits elsewhere).

## Known gaps / notes

- **Refresh-token rotation:** if Anthropic rotates refresh tokens, a long build that refreshes its copy and the shared
  login that refreshes its own can't both stay valid forever on the same account; each is fine on its own, which is the
  point of this build. Accounts saved with a long-lived token (`claude setup-token`, the switcher's `token`) avoid it.
- An unsaved new login on the VPS (logged in as someone else, not saved yet) is taken as the active account's live copy;
  the claude-accounts plugin already warns about that state and refuses switching until it is saved.
- A crashed inner run (kill -9) leaves its copy in `.axf-claude/`; it goes with the worktree, and the next run with the
  same session name replaces it.
