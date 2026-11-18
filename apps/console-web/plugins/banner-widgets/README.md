# Badges (console plugin, folder `claude-badge`)

`ai.amberx.axf.console.claude-badge` · built on Opus.

Five banner badges in one plugin. The folder keeps its old name so saved settings and data stay where they are.

| Badge | Asset | What it reads | Tokens |
| --- | --- | --- | --- |
| **Claude** | `badge/claude` | one tiny request through `axf.llm@1` when the console loads | a few |
| **VPS** | `badge/claude-vps` | `claude auth status` on the host through `axf.claude-accounts@1`, the limit mark through `axf.ai-keys@1` | none |
| **axHub** | `badge/axhub` | the framework's `hubLive` check (`framework/libs/hubstatus`): green only while settings come live from axHub, red otherwise | none |
| **AmberX** | `badge/amberx-phone` | axHub's `amberx.recorder_status` through `axf.vinny@1` (runs at once, no veto) | none |
| **Usage meter** | `badge/claude-usage` | `server/usage_host.py` on the host: `GET api.anthropic.com/api/oauth/usage` for each saved login | none |

## What each badge can do

Settings → Plugins → Badges, one group per badge. All hot: the badge repaints the moment one changes.

- **Show on the banner**, **Icons only**, **Label**, **Side** and **Order**.
- **An icon per state:** ok, warning, error, off. The Claude and VPS badges keep their old icon keys.
- **Tap does:** drop-down, open a screen, run a command, toggle a setting, or nothing. **Tap target** says which: a page id or an
  action for a screen, an action for a command, a setting key for a toggle (empty flips Icons only).

Defaults: Claude and VPS open these settings, axHub opens its details, AmberX and the usage meter drop down. Hiding the Claude
badge also stops its load-time test; hiding any other badge stops its reads.

## Moved in

The framework's own axHub badge (`hubstatus.show`) is switched off the first time this plugin loads, keeping whether it was showing.
Turn it back on in its own settings if you want both. Nothing was removed. The library still does the checking; this badge draws it.

## Usage meter

The badge shows `5h 12% · wk 13%` for the active account: green under 80%, amber from 80%, red when a limit is full, grey with
nothing to read. Tap it for every saved account: name, type, active marker, 5-hour and weekly use with reset times, status, and Refresh.

- **Percent, not a total:** the service gives percent used and no absolute limit, so "used of total" reads as a percent of 100.
- **The active account reads the live login.** Saved copies of other accounts go stale as soon as the login rotates, so those
  rows show their last known numbers with the date. A login is read fresh again once it is the active one. A window that has
  reset since reads zero. Token logins (no profile scope) and API keys have no meter and say so.
- **No token is refreshed, printed or sent anywhere else.** An expired token isn't sent at all: refreshing would rotate a login
  other sessions are using. The host script prints a fixed list of fields.
- **Cached:** 5 minutes in memory and in `usage.json`; Refresh reads again, at most every 30 s. Only the owner sees account names.

## AmberX badge

Green connected, amber offline for under an hour, red offline longer, grey not paired or no reading. Cached for a minute.

Routes (console token, 404 when disabled): `POST /test`, `GET /status`, `GET /vps`, `GET /usage?refresh=1`, `GET /amberx`, also as MCP and
CLI commands through plugin-commands. Data: `.axf-console/plugins/claude-badge/` (`status.json`, `usage.json`: no reply text, no keys, no
tokens). Removing the plugin removes only these badges; the banner, badge and clock types are permanent parts of the framework.

Self-tests: `python3 apps/console-web/plugins/claude-badge/test.py`, `npx -y tsx apps/console-web/plugins/claude-badge/test.mts`.
