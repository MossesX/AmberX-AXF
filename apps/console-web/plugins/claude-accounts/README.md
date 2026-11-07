# Claude accounts

The Claude logins on the VPS: one runs the console, the others can be workers that only run headless jobs.

It is a thin front on the host script `/usr/local/bin/claude-account` (`list | save <name> | use <name> | who`).
Saved logins stay in `/root/.claude-accounts/` on the host. The active one is copied to `/root/.claude/.credentials.json`.

## Where

- Settings → Plugins → Claude accounts, or Builds → Claude accounts
- Banner chip with the active account: tap it to switch
- CLI: `axf claude-accounts list | who | use --name <n> | save --name <n>`
- Capability `axf.claude-accounts@1` (`view()`, `use(name, by)`): the same list and the same held switch for other plugins; AI keys lists these accounts beside its own keys through it
- MCP: `claude_accounts_list`, `_who`, `_use`, `_save` (voice: "switch Claude to account 2"; `account 2` becomes `account-2`)

## How it works

| What | Path | Waits for Brett? |
|---|---|---|
| list, who | ssh with the Terminal plugin's key (`axf.headless@1`, `vps_read`) | No |
| use, save | one `vps.run` through Vinny (`axf.vinny@1`) | Yes: a held axHub call |

- **Fixed commands only:** each command is a constant plus a name matching `^[a-z0-9-]{1,32}$`. There is no free-form shell.
- **No credentials:** the plugin never opens a credentials file. From `claude auth status` it keeps only the email and plan.
  Answers carry names, the active marker, email and plan.
- **Owner only:** a signed-in non-admin gets 403. Brett's session and the console token can ask. The hold is what
  guards the change: Deny stops it, Approve runs it at once, and otherwise it runs after the veto countdown.
- **Builds:** running builds keep their account; new launches use the active one. Each headless build runs on its own
  copy of the login (`deploy/claude-login.mjs`, `CLAUDE_CONFIG_DIR`), so a logout, switch or new login here never
  touches a running build. The launcher only reads the saved logins; it never runs save or use.

## Worker accounts

The console stays on the active account. An account marked as a worker is never made active. It only runs headless jobs,
each on a private copy of its login, so several subscriptions work at once.

- **Which worker:** `deploy/claude-headless.sh` asks `deploy/claude-workers.mjs route` for every job launched without
  `--account`: saved, not active, not limited, fewest running jobs, then list order. No worker free = the job runs on the
  active account, with a note on the build, and the systems check item *Claude worker accounts* turns red.
- **Failover:** a worker that hits its limit is out until the reset time in Claude's message (else 5 hours); one whose
  login fails is out for 10 minutes. The run moves to the next worker and is told to carry on from the worktree. The
  active account never changes for this. The console's own switch (AI keys `/switch`) skips workers.
- **Sign in:** `claude auth login` with `CLAUDE_CONFIG_DIR` set to the account's folder, in a tmux session `axf-signin-<name>`
  the Terminal opens, so the live login is never touched. Works for a new account and to re-log an expired one.
- **Remove:** the folder moves to `~/.claude-accounts/.removed/`; nothing is deleted.
- **Records:** `session-login`, `session-part` (a run leaving an account) and `session-end` in
  `/var/tmp/axf-headless/events.jsonl` carry the account and cost; `claude-workers.mjs status` adds them up per account, and
  the build gets a note with runs and cost per account.
- **Not covered:** usage shows what the console's own runs spent, not the subscription's remaining quota. API keys are
  never workers. Two jobs on one worker share a refresh token: the first renewal spends it, so a long second job can
  lose its login and move on. Routing keeps jobs on idle workers first for that reason.

| What | How | Waits for Brett? |
|---|---|---|
| role | writes `workers.json` in the data folder | No |
| signin, remove | one `vps.run` through Vinny (`claude-workers.mjs`) | Yes |

CLI: `axf claude-accounts role --name <n> --role worker|saved | signin --name <n> | remove --name <n>`.
Host: `node deploy/claude-workers.mjs status`.

## Adding an account

Terminal > VPS host > claude > /login, then **Save current login as…** right away.

Save first, because `use` copies the live login back over the active name. If you log in as someone else and then switch,
that would overwrite the old account's saved login. The plugin spots this (the email differs from the one last seen for
the active account), shows a warning and refuses the switch until the new login is saved.

## Data

`workers.json` (claude-workers@1, names in order) and `worker-state.json` (limits) sit next to `seen.json`, and neither holds a credential.

`.axf-console/plugins/claude-accounts/seen.json`: the email + plan last seen per account. The script only reports the
active account, so this is how the other rows show theirs. A saved account the console hasn't seen active yet shows
its name only. Uninstalling leaves the host script and the saved logins alone.

## Test

`python3 apps/console-web/plugins/claude-accounts/test.py` and `node deploy/claude-workers.test.mjs`

## Rotated tokens

A Claude refresh token is spent by every renewal, so `deploy/claude-token-save.mjs` carries each new pair to every store
of that login at once: a build's watcher (and its release) for its private copy, the `axf-claude-token-save` cron (every
minute) for the live login and for pairs AI keys renews. A store is rewritten only when it holds a token that login has
already spent, so a login that doesn't match its account name can never overwrite another account.
