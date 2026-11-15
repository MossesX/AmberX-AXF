# badges-notify-followup

Follow-up on `claude-badge-vps` (PR 366) and `notifications-control-panel` (PR 367). This branch merges both on main and supersedes them.

## Badges (folder `claude-badge`, name now "Badges", 0.5.0)

- One plugin, five badges: Claude, VPS, axHub, AmberX, usage meter. The folder keeps its name so saved settings and data stay put.
- Per badge: show or hide, icons only, label, an icon per state (ok, warning, error, off), side, order, tap action (drop-down, open a screen, run a command, toggle, nothing), all hot.
- axHub: the framework's `hubstatus` library still does the check; the plugin draws it and switches the old badge off once, keeping whether it was shown. Red unless live, same rule.
- AmberX: axHub `amberx.recorder_status` through `axf.vinny@1`. Green connected, amber offline under an hour, red longer, grey not paired.
- Usage meter: `5h 22% · wk 14%` on the active account; default tap drops down every saved account (type, active marker, 5-hour + weekly, reset times, status, Refresh). Cached 5 minutes in memory and on disk.

### Not what the brief assumed

- **There was no usage-meter code to reuse.** `claude/usage-meter` and `-r2` are empty: both runs stopped before any work, nothing is on any branch or on main. The meter is new, in this plugin, as small as it could be.
- **"Used of total" is a percent.** `api.anthropic.com/api/oauth/usage` gives percent used and reset times, no absolute limit (`limit_dollars` is null on these plans).
- **Only the active account reads live.** Live read on the VPS, Nov 6: account-1 200 (weekly 14%, no 5-hour window open), account-2 no login saved, account-3 403 (token login, no profile scope), account-5 API key, gizmox1111 401 (saved copy expired). Saved copies go stale when a login rotates, and refreshing one would rotate a login other sessions use, so nothing is refreshed: those rows show last known numbers with their date, once the account has been active. Build step `s37` (a headless check of the others) would need its own design.

## Notifications panel (0.2.0)

- Groups: user-made, on or off together, own command buttons. Off stops its types (`Group X is off`).
- Triggers: event (types, groups, source, key prefix, lowest severity), conditions (`field op value`, incl. `meta.<name>`), threshold (Nth within N minutes), schedule (days, hours). Effects: only, mute, raise.
- Commands on a notification: `approve` (opens the call's own screen, only Brett's session decides), `open`, `console`. Held calls get Approve by themselves.
- Editable in the panel and through `GET groups|triggers`, `POST group|group-remove|trigger|trigger-remove|trigger-test`, MCP and CLI (plugin-commands).
- Guarded types (approvals, veto) are never held by a group or rule.

### Limits

- A rule's schedule is a window on notifications that happen: nothing fires on the clock alone.
- Threshold counts live in memory: a console restart starts them again.
- Buttons draw in the console's alert list only. AmberX gets them in `notify.actions`, but Android work is on hold, so the phone doesn't draw them.

## Also fixed

- `notify-control` now loads at start (`KNOWN_BANNERS`). On a lazy load its `register()` didn't run, so sound, pop-up and the browser senders' `AXF_NOTIFY` waited until the panel was first opened.
- Framework: `alerts` draws `notify.actions`, and `openLink` dispatches an action spec. Re-baked into console, AmberX, axHub web, Molly.

## Known gap

On the phone the Claude badge's 5-second pop-out draws over the badges next to it. Same cause as `banner-popout-size-cap` (fix belongs in `useBannerOverflow`), more visible with five badges.

## Tests

`claude-badge/test.py` 40 → 73, `claude-badge/test.mts` 49 (new), `notify-control/test.py` 78 → 132. Help coverage 100%. Theme, controls, toolbars, chrome, lifecycle, plugin commands, menu reach pass. Host read checked live on the VPS.

Screenshots: `_claude/builds/reports/badges-notify-followup/shots/`. Mock data, no server.
