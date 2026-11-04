# console-wake-finish

Build `console-wake-finish` (Current profile, urgent, Opus, agent Ping Paulie). Nov 4 2026.

## Brett said (verbatim)
Source: voice · At: 2026-11-04
> Why isn't Follow Amber working? … Yes.

(Follow Amber was on, but his console tab was asleep in the background while he was in the Claude app on a voice call,
so `console_show` commands sat undelivered. Amber offered to bump console wake up the line; he said yes.)

## What Brett must do
**Install the new AmberX APK: yes.** axHub sees no AmberX phone connected (no AXPP traffic at all since the axHub
redeploy at 14:17 UTC; pairing lives in axHub's memory and the phone re-pairs by itself only while AmberX's watch runs).

1. On the phone, open https://axhub.amberxai.com/apps and install **AmberX build 1227** or newer
   (`amberx-droid-0.1.0-b1227.apk`, built from `d857b6032a10`, has `browser.open` / `open-url@1`).
2. Open AmberX, signed in to axHub, and leave the watch on. It pairs within a minute.

There's a console banner item for this ("Install the new AmberX APK so Follow Amber can wake the console").

## What was already live
- **#288** (merged 12:05 UTC) carried all of **#266** console-wake: the per-user queue with TTL, delivery once on
  reconnect, the wake through AmberX (`?axf-cmd=<id>`), the settings and the toast. `wake.py` is on main and deployed.
- **#266** was already closed. **#308** (help text for the wake settings, red CI on a stale branch) was **closed as
  superseded**: the same `help.json` landed on main in `f07014ed2`.
- AmberX app: `browser.open` (`OpenUrlRules.java`, `AxppLink.java`) is on main since `6eb2aac38` and in APK b1227 on
  the hub's app catalog.

## What this build changed
- **axHub MossesX/axHub#35** (`amberx.open_url`, allowed only for amberxai.com, policy `allow`, high-priority
  notification fallback): CI green, merged (`440184c`), **redeployed** through Coolify (container
  `jghx…-20261104T141721`, healthy).
- **The real gap (PR #317):** a console tab that's open but asleep in the background still looked connected. So
  `console_show` sent to it, got no ack, and never woke anything. The AmberX wake only fired when *no* console was
  connected.
  - `console-commands` `run(..., wake_hidden=True)`: when no console in front acks within **4 s** (`FRONT_WAIT_S`), the
    command is queued for the next console in front, AmberX is asked straight away, and the call answers
    `delivery.how: "waking"` (no more 60 s hang on a frozen stream).
  - The queued command runs as soon as a console comes to the front: a `hello`, or a `seen` with `front: true` (Brett
    just switching back to Chrome now counts too). It runs under the message id the sleeping tab already got, so a tab
    holding both copies runs it once. A late ack from the front closes the entry. A hidden tab's heartbeat hello
    doesn't take it.
  - `follow-amber` passes `wake_hidden` on every show and answers `queued` + the reason, not "opened", while it waits.

## Tests
| Check | Before | After |
|---|---|---|
| `python apps/console-web/plugins/console-commands/server/test_console_commands.py` | 72 | 86 (passed 4 runs in a row) |
| `python apps/console-web/plugins/follow-amber/test.py` | 33 | 36 |

## End to end
- Console → axHub → `amberx.open_url`: the call reaches the deployed hub with the console's token, and the hub answers
  "The AmberX phone isn't paired with axHub yet". So the chain works up to the phone, and the phone is the missing
  piece (see *What Brett must do*).
- The phone leg (Chrome opening the console, then the queued show running) can only be checked once AmberX is paired.

## Known gaps
- axHub keeps device pairing in memory: every axHub redeploy unpairs the phone until AmberX polls again. It reconnects
  by itself while the watch runs.
- `follow-amber/test.py` isn't in CI (nothing new here; it never was).
