# Claude accounts

Temporary switcher for the Claude login the VPS uses. The Handoff 2 add-ons build replaces it, so it stays small.

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

## Adding an account

Terminal > VPS host > claude > /login, then **Save current login as…** right away.

Save first, because `use` copies the live login back over the active name. If you log in as someone else and then switch,
that would overwrite the old account's saved login. The plugin spots this (the email differs from the one last seen for
the active account), shows a warning and refuses the switch until the new login is saved.

## Data

`.axf-console/plugins/claude-accounts/seen.json`: the email + plan last seen per account. The script only reports the
active account, so this is how the other rows show theirs. A saved account the console hasn't seen active yet shows
its name only. Uninstalling leaves the host script and the saved logins alone.

## Test

`python3 apps/console-web/plugins/claude-accounts/test.py`
