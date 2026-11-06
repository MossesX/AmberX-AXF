# Notifications (`notify-control`)

Brett, Nov 6 2026: "You need to have an administration panel. I need to control all the notifications."

One panel, one registry, one decision. Open it from **Plugins → Notifications**, **Console → Notifications** or
**Settings → Plugins → Notifications**.

## What it controls

| Control | What it does |
|---|---|
| All notifications | Master switch. Approvals and veto stay on. |
| Console, AmberX, Web push / ntfy | One switch per app: where it lands. |
| Quiet hours | Holds AmberX, web push, sound and pop-ups. The banner still counts it. Urgent types and approvals go through. An alert still open when they end reaches AmberX then. Web push and ntfy are not re-sent. |
| Per type | On or off, channels, priority, Test, Reset. |
| Sent and blocked lately | The last 30 decisions with the reason. Kept in memory, gone on a restart. |

Priorities: **Low** banner only. **Normal** every channel that's on, held in quiet hours. **High** same, stronger tone
and pop-up. **Urgent** also goes through quiet hours.

Channels: **Banner** (the bell and its count), **AmberX push**, **Sound** and **Console pop-up** (an open, visible
console, off by default for every alert), **Web push / ntfy** (their severity rules in Settings → Alerts still apply).

A muted alert is never lost: the hub keeps it. With the banner off it shows in the Alerts list, already read, and comes
back unread if the banner is switched on again. Settings → Alerts still works: a source switched off there isn't raised.

## How it's enforced

Every console sender raises through `AlertHub.raise_alert` (`server/alerts.py`), so the gate is one seam, not an edit in
each sender. The hub asks capability `axf.notify@1`:

- `check(alert)` before delivering. Web push and ntfy stop here.
- `view(alerts, phone)` on every read. It is live, so a change or the end of quiet hours applies at once. A browser gets
  banner-off alerts as read. AmberX (`Dalvik/` user agent, or `?view=phone`) gets only what may buzz it, so this works without an app update.
- `allowed(type, channel)` for senders outside the hub (Follow Amber's approval pop-up, the Activity hub inbox).
- `device_off()`: the types AmberX must mute itself (`notify.off` in its alerts reply). **This part needs the new APK.**

In the browser, `AXF_NOTIFY.allowed(type, channel)` answers the veto notices, veto alarm, Terminal bell and Activity
chime. Anything unknown stays yes, and with no plugin, or a broken one, the hub works as it always did.

## Types

Core types are in `registry.json`. **A plugin's types are in its own `notify.json`**, so they leave with it:

```json
{ "$axf": "notify-types@1", "types": [
  { "id": "example.ready", "label": "Example ready", "group": "review", "app": "console", "source": "Example",
    "description": "…", "match": { "source": "example" }, "setting": "notify.example", "priority": "high" }
] }
```

- `match`: the alert `source` and optional `keyPrefix`. The longest prefix wins.
- `only`: the channels it can use. `channels`: defaults (`{ "amberx": false }`). `setting`: a Claude setting that is the
  same switch. `push`: promote to AmberX though its severity is below warning.
- `enforced`: `gate` (default), `browser`, `device`, or the fixed `required` / `feed` / `elsewhere`, shown but not
  switchable.
- `guarded`: approvals and veto. The master and app switches skip it, it goes through quiet hours, and only Brett's own
  signed-in session turns it down. A session that could mute the veto notice could act unseen. Turning it up is open.

A source nobody registered still works as before and shows under *Not in the registry yet*. `test.py` fails when code
raises an alert source no registry names.

## REST, MCP, CLI

Routes under `/api/plugins/notify-control/`; plugin-commands@1 puts each on MCP (`notify-control_<command>`) and the CLI
(`axf notify-control <command>`), so voice sets them too.

| Command | Does |
|---|---|
| `state`, `types`, `recent` | Read the panel, every type's decision, what was sent or blocked. |
| `check --type ci.failed` | What happens to this type right now, and why. |
| `master --on false` | The master switch. |
| `app --app amberx --on false` | One app. |
| `set --type ci.failed --enabled false` | One type. Also `--channel sound --on true`, `--priority urgent`. |
| `quiet --enabled true --start 22:00 --end 07:00` | Quiet hours. They live in Claude settings (`notify.quiet*`). |
| `test --type ci.failed` | A real test down the current channels; clears after 90 s. |
| `reset --confirm reset [--type id]` | Back to defaults. |

## Data

`.axf-console/plugins/notify-control/config.json` (0600). Quiet hours and `setting`-linked types live in Claude settings
on axHub. Uninstalling leaves the hub as it was. Env: `AXF_NOTIFY_DATA_DIR`, `AXF_TIMEZONE`.

Tests: `python apps/console-web/plugins/notify-control/test.py`.
