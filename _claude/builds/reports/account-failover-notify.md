# Account failover + phone alerts + one home per login

Build `account-failover-notify` (Nov 8 2026, Opus), branch `claude/account-failover-notify`, stacked on PR #389
(`workers-api-routing`). Absorbs steps 3-5 of `running-builds-follow-the-active-claude-account-fail-over-when-it-dies`.

## What happened to account-1 (the incident)

On Nov 8 2026 16:33-16:53 UTC five builds (`memory-manager`, `ui-api-parity-rule`, `molly-one-shell`, and their `-r2`
relaunches) started on account-1 and died within 1-3 s each:

```
Failed to authenticate: OAuth session expired and could not be refreshed
```

**Why the refresh failed: the token was spent by another copy of the same login, not idle expiry.**

| When (UTC) | What |
|---|---|
| Nov 6 02:20 | account-1 signed in and saved: `~/.claude-accounts/account-1/.credentials.json` (refresh token `05c4fc…`). The file was never written again. |
| Nov 6 10:20 → Nov 7 11:45 | account-1 is the active account. ~35 builds run on a copy of the **live** login (`~/.claude`, log line `own copy (live)`), so every renewal rotated the token in the live store and spent `05c4fc…` early on. Nothing carried the new tokens to the saved folder: the build watcher wrote back only to stores holding a token in *its* chain (which started from the live token, not `05c4fc…`), and the minute sweep cron didn't exist on the host until Nov 7 17:51 (first line in `/var/log/axf-claude-token-save.log`). |
| Nov 7 ~12:04 | Another account (now `mossesx-max-`) was signed in on the shared live login and saved. That overwrote the live store, and account-1's only current token went with it. |
| Nov 8 16:33 | PR #389's routing made every subscription login a worker, so jobs went to account-1. Its saved folder still held `05c4fc…`, spent two days earlier. |

The sweep can't recover it: the token is gone. **account-1 has to be signed in again.**

**Why nothing retried:** the launcher's auth pattern knew only `oauth token expired`, not Claude Code 2.1.319's
`OAuth session expired … could not be refreshed`. Even with a match, a dead login was out for only 10 minutes, so the next
build would have died on it again. That happened at 17:05; the live host was patched by hand (see *Done on the VPS*).

## What changed

**Failover (any account).** `deploy/claude-workers.mjs`
- `hitOf`: auth now matches `Failed to authenticate`, `OAuth session expired`, `could not be refreshed`, `invalid_grant`,
  `revoked`. A run that *opens* with `Failed to authenticate:` counts even on exit 0. `credits` is its own kind (was
  folded into usage).
- `markLimit`: a dead login (expired / could not be renewed / signed out) stays out **until the account holds a new
  login** (hash of its refresh token / token / key, max 30 days), not 10 minutes. A passing `authentication_error` keeps
  the short retry.
- `failover()` (CLI `failover`): marks the account out, raises the phone alert, claims the next account with the same
  routing rules (workers, then the console's account; API accounts only where a rule sends the job). It returns
  move / queue / wait / stop. `revive` (minute sweep): accounts that are back leave the limits and their alert closes.
  `clear`, `events`, `failover-set`.
- `deploy/claude-headless.sh`: every run goes through it, not only worker-routed runs. A run started with `--account` or
  on the console's account moves too. Every account out = the run waits (default 12 h) for one to come back instead of
  dying. The old AI-keys switch stays only for hosts without saved accounts.
- Settings `failover` in `workers.json` (worker-routing `normFailover`): `enabled`, `maxMoves` (6), `waitMinutes` (720),
  `alerts`, `alertOnLimit`.

**Phone alerts.** `deploy/account-alerts.mjs` raises one console alert per account + problem
(`claude-accounts:account:<name>:<kind>`, source `claude-accounts`; notify type `claude-accounts.problem`, AmberX on,
high). Example: *"Claude account-1 (brettspend@gmail.com): login expired and could not be renewed"* /
*"Build memory-manager moved to account-3. Sign account-1 in again: console → Builds → Claude accounts → account-1 → Sign
in (or tell Amber "sign account-1 in")."* A second build dying on the same account updates the alert in place. It is
resolved when the account works again. When the console is down it waits in an outbox the minute sweep flushes. Every
event is also logged to `account-events.jsonl` (out / move / back).

**One home per login.** `deploy/claude-home.mjs` (login-home@1)
- `~/.claude-accounts/<name>/.credentials.json` is the login's only home. Claude Code refuses a symlinked credentials
  file (`O_NOFOLLOW`) but reloads it when its mtime changes, so copies are mirrors kept in step **both ways** by token
  lineage (`.home.json`: hashes, last refresh time and by whom, never a credential).
- Build copies: the 3-s watcher saves a newer token home and **pulls** a newer home token into the copy. Two builds on
  one account no longer leave one holding a spent token.
- Live login: the minute sweep does the same against the home of the login it is (by lineage). A new sign-in (the
  email changes) is never taken as a renewal.
- Snapshots always copy from the home after syncing the live login into it. Never straight from the live login, which
  was the account-1 bug.
- `audit`: every place a login is kept (home, live, each build copy): in step / behind / foreign.

**AI keys store:** checked on the host and in the container (`/opt/axf/.axf-console/plugins/ai-keys/keys.json`, mounted
at `/axf`). It holds **no** Claude OAuth pairs today, so it's no duplicate. Its token-rotation@1 drop-file channel is
kept as a mirror.

**Console.** Claude accounts → *Failover & alerts* (page and Settings → Plugins → Claude accounts):
- accounts out now: why, since, *until signed in again* or back-at time; Sign in / Bring back;
- failover settings and phone alert switches;
- account events;
- logins with their last refresh (and who), plus *Check where each login is kept*.

Rows show *Login dead · sign in* and the last refresh. Three layouts are settings assets (sections, status first,
compact; UI Review `r-20261108-d22f9202`).

Routes `GET/POST failover`, `POST clear`, `GET logins` are MCP / voice / CLI commands (`failover`, `failover-set`,
`clear`, `logins`). Systems check *Claude logins*: red while a login is dead.

## Tests

| Test | Before | After |
|---|---|---|
| `deploy/account-failover.test.mjs` (new, CI) | — | 50 (auth fail → failover → notify; limit → failover; credits; wait / stop; one home both ways; live login; end to end through the launcher with a fake claude dying like account-1) |
| `deploy/claude-workers.test.mjs` | 65 | 65 |
| `deploy/claude-login.test.mjs` | 57 | 57 (3 expectations now say copies come from the home) |
| `deploy/claude-token-save.test.mjs` | 24 | 24 |
| `deploy/worker-routing.test.mjs` | 44 | 44 |
| `claude-accounts/test.py` | 89 | 105 |
| notify-control, plugin commands, help coverage, glossary, lifecycle, theme/controls/toolbars/chrome, console typecheck | pass | pass |

## Done on the VPS (live, before merge)

- account-1 taken off the worker list (`workers.json`: `workers` without it, `excluded: [account-1]`), so main's launcher
  stops routing builds into the dead login. **After signing it in:** Claude accounts → account-1 → Make worker (or
  `claude-workers.mjs worker account-1 on`).

## What Brett needs to do

1. Sign account-1 in again (console → Builds → Claude accounts → account-1 → Sign in).
2. Pick a layout in UI Review (`r-20261108-d22f9202`).

## Known gaps

- Claude Code renews tokens itself, so two copies can still race inside the same few seconds. The pull shrinks the
  window from hours to ~3 s, but doesn't remove it. A single refresher that renews the home before expiry would close it,
  but that means calling the OAuth endpoint ourselves (not done).
- `claude-account use` (host script, `/usr/local/bin`, not in the repo) still copies files directly. The sweep keeps
  homes in step after it.
- AmberX shows the alert through the alert hub. A dedicated tap-to-sign-in action on the phone is not built.
