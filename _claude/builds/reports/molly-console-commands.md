# Molly: console commands reach the embedded console (`molly-console-commands`, Current, Opus)

Brett, Nov 3 2026 (voice): "I mean Molly. I'm in control through Molly." Amber's `console_open` / `console_settings`
were "sent" to clients `cc-bbtoklptl9ke` / `cc-iw5fg6x8lm1f` but "the console didn't answer within 4 s", and nothing
changed on his screen while he used the Console inside Molly in Chrome. Agent: Ping Paulie (router not on this branch).

Branch `claude/molly-console-commands`, stacked on `claude/console-wake` (#266, same files) + main.

## s1 — reproduction

A headless Chromium loading Molly with the Console frame against the live containers (local HTTP/2 TLS proxy mapping
`*.amberxai.com` to the containers, the hub's appearance document served from the hub's data folder, the console token
in the frame's storage). Traced hello → stream → command → ack with a fetch wrapper inside the frame.

Findings (all three together are what Brett saw):

1. **The ack misses the window.** The VPS was at load ~41 on 4 cores; trivial console API calls took 0.3–5 s
   (sampled), a frame's `hello` took 5 s, an `ack` 3.5 s. Reproduced exactly: `sent; the console didn't answer within
   4 s` with a healthy, connected embedded console. Server-side delivery itself is fine (a fake client through the same
   routes: message in 0.7 s, ack 0.2 s, when the box is quiet).
2. **The command ran where Brett couldn't see it.** Molly keeps every app's frame alive and only hides the ones not on
   screen. A console frame hidden behind axHub or AmberX ran the command (it opened the screen inside the hidden frame)
   and nothing changed on screen.
3. **`recent` picked the wrong console.** It meant "touched last". Inside Molly the frame's focus / visibility events
   don't follow which app Molly shows, so a hidden frame (or another tab) could be "recent".

Also seen: Molly opens a frame only when its app is first shown, so with Molly open but the Console never opened there
was no console client inside Molly at all (console-wake would then wake a separate tab).

## s2 — commands work inside Molly

- **embed@1 front messages** (`framework/core/engines/embed.ts`): `show` (guest → host: bring my frame to the front,
  optional `reason`) and `shown` (host → guest: `on` = my frame is on screen). Runtime: `hostShown`, `inFront()`
  (page visible and, inside a host, shown by it), `onFront()`, `bringToFront(reason)`. Fixture group `frontMessages`
  in `embed-takes.json` (web only; Kotlin deferred in PORTING.md).
- **Console client** (`plugins/console-commands/web`): reports `app: molly/console-web`, `host: molly` and `front` on
  hello / seen / ack; re-reports when Molly shows or hides it (showing it counts as used); asks Molly to bring it
  forward before it runs a command while hidden.
- **Server** (`plugins/console-commands/server`): keeps `front` / `host` per client (host name checked), passes them to
  the runner, lists the client in front first; `ACK_WAIT_S` 4 → 10 s.
- **Engine** (`core/engines/console-commands.mjs`): `recent` = a client in front wins, then the one used last; client
  summaries carry `host` and `front` (so `console_clients` shows `molly/console-web`).
- **Molly xLayout host** (`plugins/xlayout/web/host.ts`): answers `show` by navigating to that app (its last page when
  known); watches each frame's `data-on` and sends `shown` on every change and on load.

## s3 — axHub and AmberX frames

The front path is generic: any app on the framework running in Molly gets `show` / `shown` / `inFront()` from the
runtime and Molly's host handles them for every frame. axHub web and AmberX don't accept remote commands yet, so there
is nothing to relay for them today; giving them the command surface is the addendum (s6, s7, still open).

## s4 — console-wake through Molly

Molly with xLayout now opens the Console frame hidden at start (new host hook `warm`, `src/molly/host.ts` +
`FrameDeck.tsx`; xLayout sets `['console']`). So whenever Molly is open there is a console client inside it: a command
(live or queued by console-wake) goes there and Molly brings it forward, instead of the server waking a separate tab
through AmberX. Cost: the Console loads in the background when Molly starts.

## s5 — tests

| Check | Before | After |
|---|---|---|
| `python apps/console-web/plugins/console-commands/server/test_console_commands.py` | 66 | 72 (Molly's console listed as `molly/console-web`; hidden one not `recent`; shown one gets it; listed first; bad host dropped) |
| `node apps/console-web/plugins/console-commands/test.mjs` | 6 | 7 (front beats used-last; summaries carry host/front) |
| `tsc --noEmit` Molly, console-web | pass | pass |
| `gen-fixtures.mts` | — | `embed-takes.json` gains `frontMessages` only |
| Browser e2e (local Molly + console builds, live server) | ack timed out, nothing on screen | Console hidden behind axHub: command acked `opened Plan Studio`, Molly switched to the Console. From Molly's home (Console never opened): warm frame registered as `molly/console-web`, acked, Molly brought it forward |

Screenshots (Settings → Plugins → Console commands opened in Molly by a console command; rows read
`molly/console-web`): `molly-console-commands/molly-console-desktop.png`, `molly-console-phone.png`. The "server part
is not answering" notes in them are the live server predating console-wake's `/settings` and `/queue` routes.

## Not done here / gaps

- **Addendum (s6, s7):** every app gets the Console's control surface (Molly, axHub web, AmberX: REST + MCP + CLI,
  `apps_list`, app-scoped targets, Molly relaying to its frames, the template shipping it, Plugin commands page grouped
  by app). Open in this build.
- Molly without xLayout frames apps plainly (no embed marker), so no `show` / `shown` there.
- The runner is a `node` subprocess per command; under heavy load that alone took seconds. Not changed.
- Main's CI is red for other reasons (tracker status, plugin catalog, profiles, help coverage, session-checkin,
  kernel widget tests); `urgent-main-ci-green` (#284) owns that. This PR carries the same one-line xLayout `opens` fix.
- Kotlin twin of the front messages: deferred (Android on hold).
- Fable review suggested for the embed@1 contract addition (Opus-built foundation work).
