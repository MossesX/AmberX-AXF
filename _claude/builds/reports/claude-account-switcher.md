# Claude account switcher (build claude-account-switcher, Nov 4-5 2026)

Temporary console plugin over the VPS host script `claude-account`. The Handoff 2 add-ons switcher replaces it.

## What shipped

- Plugin `claude-accounts`: Settings → Plugins → Claude accounts, Builds → Claude accounts, and a banner chip with the active account (tap = switch dialog).
- List of saved accounts with name, active marker, email and plan; **Switch** per account; **Save current login as…**; help box with a button that opens the Claude Code connection picker.
- API `GET accounts | who`, `POST use | save`; CLI `axf claude-accounts list | who | use --name <n> | save --name <n>`; MCP `claude_accounts_*`, which is what voice uses. `account 2` becomes `account-2`.
- The builds note (running builds keep their account; new launches use the active one) is on the screen and in every answer.

## How it works

- Reads: one fixed command over the Terminal's ssh key. New capability method `axf.headless@1.vps_read` (console-terminal), 30 s cache.
- Writes: one held axHub `vps.run` through Vinny, one at a time, repeat asks send nothing.
- Commands are a constant plus a name matching `^[a-z0-9-]{1,32}$`.
- Credentials are never opened. From `claude auth status` only email and plan are kept.

## Decisions to check

- **Owner only:** a signed-in non-admin gets 403, but the console token can ask too, because MCP, CLI and voice use it. The hold is the gate, and a hold is a veto: an ask from a session runs after the 90 s countdown unless Brett denies it. Any session could already send the same `vps.run` itself, so this adds no new reach. A hard Approve-only gate needs an axHub policy change.
- **Added beyond the brief:** `use` copies the live login back over the active name, so logging in as someone else and switching before saving would overwrite that saved login. The plugin compares the email with the last one seen for the active name, warns, and refuses the switch until the login is saved.
- **Email + plan per account:** the host only reports the active login, so other rows show the last seen values (`seen.json`). A saved account the console has never seen active shows its name only. `main` saved later shows its email once it is active.
- **Pending state** clears when a switch takes effect or after 3 minutes. A denied or shelved call keeps the screen on "waiting" until then, and a shelved call could still run after the screen has cleared.
- **Status chip:** the banner chip is a framework status widget, listed in the lazy loader's `KNOWN_BANNERS` so it loads at startup.

## Tests

- `claude-accounts/test.py`: 47 checks (names, fixed commands, held call, repeat asks, overwrite guard, owner only, no token in any answer or in the data file). Fake host and hub.
- Real read command run against the real script on the VPS: parsed `account-2`, active, plan.
- Passing locally: console-terminal test (139), plugin-commands, plugin-lifecycle, check-theme, check-controls, check-toolbars, check-chrome-assets, help coverage, plugins catalog, menu-reach, lazy-loader-check, tsc, vite build.

## Not tested

- No real switch or save has run: it would change the live login, so the held `vps.run` path is covered only with a fake hub.
- The screenshots use mocked API data and example emails. The ssh path from the console container to the host was not run live, only the same command on the host.
- `app-voice-commands` is not on main yet. When it lands, run `voice-commands.mjs generate console-web --write` to give the new commands phrases.

Shots: UI Review → Screenshots, group "claude-account-switcher - Nov 5 12:15 AM".
