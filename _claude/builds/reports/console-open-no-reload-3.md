# console-open-no-reload-3

Brett, voice, Nov 23 2026: "Every time you try to load a screen, it refreshes and loads the main console first.
That's why it's taking so long. Every single time you send me to any screen, it loads the home screen first. Stop
doing that." And: "We need an app catalog, a link in the console, so I can download all the Android apps."

Restart of `console-open-no-reload-fable` (it stopped with no commits when its account hit a limit). Branch
`claude/console-open-no-reload-3`. Plan Studio 2.0: "Console opens on the phone: no reload to home, go straight to
the screen (+ Apps link in nav)".

## Root cause

Three faults in a row, each one hiding the next.

1. **The folded page dropped off the list.** The console app's page keeps running behind its folded overlay, but
   nothing shows it, so its timers are throttled. Its 15 s beat was a timer. No beat for 45 s and the server took the
   console for closed: `console_clients` empty, "no console is open for you right now", every open sent down the
   wake path. The page was there the whole time, with its command stream open.
2. **The wake always reloaded.** The wake asks the phone to open `…/?axf-cmd=<id>`. The console app loaded that link
   into its one WebView whatever it was showing (`WebHost.open` was a bare `loadUrl`), so a console that was already
   up started again at its home screen. Follow Amber did the same on every `console_show`, even after the open had
   been delivered: it also sent the phone `…/?axf-open=<address>`, which is why it was "every single time".
3. **The queued open was lost in the reload.** The wake brings the old page to the front a moment before it is
   replaced. The old page beat, the server sent it the queued open, and the reload took the page away. The server
   marked the command done without an ack (`status: pending`, "sent; the console didn't answer yet"), so the new
   page had nothing to pick up and stayed at home. A second delivery could not start while the first one waited
   10 s for the dead page.

Also found: the page sent a changed catalog only with its next 15 s beat, so an open in the first seconds after a
load answered "the console has no screen …" for a plugin's screen; and a call waited up to 60 s for a console.

## What changed

**Console commands, server** (`apps/console-web/plugins/console-commands/server/__init__.py`)

- A console with an open stream and no recent beat is asked first, for 2 s, before anything is queued or woken. Its
  answer is a normal live delivery. Console-control addresses take the same path.
- A queued command is done only when a console acks it. Sent and not acked: it stays queued under the same message
  id and goes to the next page that says hello. A page that already ran it only acks again.
- Every page load has an id (`page`). A hello from a new page load ends the wait on the old page at once and drops
  the old page's stream; a late goodbye from the old page no longer takes the new one off the list.
- The wake link carries the target: `…/?axf-cmd=<id>&axf-open=view:<screen>` (screens and settings tabs).
- A name the catalog does not have is asked for again and waited for: 2 s, or 8 s while the page is under 30 s old.
  A loading page's short catalog no longer replaces the full one the server remembers.
- Fast answers: one live console gets 2.5 s (was 3.5), the wait after a queue is 3 to 4 s (was 15 to 60). The
  command stays queued after the call answered, and the answer says why in plain words. `wait` (seconds, up to 60)
  on the REST body asks for longer.

**Console page** (`plugins/console-commands/web/index.tsx`, `src/native/axfNative.ts`, `nativeRules.mjs`)

- The beat also rides on the command stream: every chunk the server sends, its keep-alive included, is a reason to
  beat. Network events are not throttled, so the folded page stays on `console.clients`.
- A page its app hides brings itself to the front after it ran a navigating command (`overlay('expand')`), with no
  reload. Its ack says so (`shell`, `surfaced`).
- `window.axfNative.open(url)`: a console link the app hands over opens in the running page. `axf-open` goes
  through the control executor, `axf-cmd` picks the queued command (event `axf-deep-link`).
- The catalog is sent as soon as it changes, and when the server asks. A deep link to a screen that is already
  registered shows it at once; one a plugin still has to bring is retried for 10 s.

**Console app** (`apps/console-droid`: `WebHost.open`, `ShellRules.inPage` / `handOffScript`)

- A console link for a console that is already loaded goes to the page instead of `loadUrl`. The shell still loads
  it when no console shows, for any other path or site, and when the page does not take it within 1.5 s.

**Follow Amber** (`plugins/follow-amber/server`, `server/mcp_server.py`)

- A show the phone app's own page acked is not also sent to the phone as a link.

**Apps entry** (`plugins/axhub-apps`, `src/assets/nav-menu/default-console-web-nav.json`)

- The Apps menu now opens with "Android apps (downloads)" (it was two levels down, Apps → axHub → Apps).
- The side navigation has an "Apps" section right under Home with "Android apps" (it was the eleventh of fifteen
  entries under System). On the phone the side navigation is the bottom bar: Home, Android apps, Plan, …

## The six points of the brief

| # | Asked | Where |
| --- | --- | --- |
| 1 | An open to a loaded page: no reload, no home screen | quiet consoles asked first; the app hands links to the page; Follow Amber sends no second open |
| 2 | A wake loads at the target, the queued open is never lost | `axf-open` on the wake link; done only on an ack; same message id to the next page |
| 3 | The overlay's page stays registered and answers while folded | the beat on the stream; quiet consoles still asked |
| 4 | Answer fast with a plain reason | seconds, not 20 to 45; "not shown yet: … It stays queued and opens the moment …" |
| 5 | An early open waits for the screens list | catalog asked for and waited for; sent as soon as it changes |
| 6 | Apps has an obvious entry, on the phone too | first in the Apps menu; its own nav section under Home |

## Tests

- `plugins/console-commands/server/test_console_commands.py`: 195 checks (154 before). New: an open to a loaded,
  quiet console is delivered live with nobody woken and nothing queued; a console that never answers costs seconds
  and the answer is plain; the wake link lands on the screen; an open sent to a page that is then reloaded reaches
  the new page once, under the same id, without waiting out the old page; a late goodbye from the old page is
  ignored; an early open waits for the catalog; a wrong name on a loaded console still fails fast; `wait`.
- `plugins/follow-amber/test.py`: 60 checks. A show the phone app's page acked does not go to the phone again.
- `src/native/nativeRules.test.mjs`: 11 checks. Which links open in the page; the screen a deep link starts on.
- `src/hubPages/test.mjs`: 237 checks. The Apps anchor under Home, the plugin's nav entry, the Apps menu's first entry.
- `apps/console-droid` `ShellRulesTest`: 3 new (15 with `DeviceRulesTest`), run here in a JDK container.
- Also green here: `console-commands/test.mjs`, `check-console-commands.mts`, `menu-reach.mts`, `tsc --noEmit`,
  check-theme / controls / toolbars / chrome-assets, plugin-lifecycle for the three plugins.

## What Brett needs

- **A console deploy is enough for the main fix.** With the app he has now: the folded page stays registered, opens
  reach it live, it comes to the front by itself, and `console_show` no longer reloads it. If a wake still happens
  (the page really is gone), today's app loads the link, but it now lands on the screen and the queued open is no
  longer lost.
- **A new console app APK finishes it**: with it a wake or a deep link for a console that is already loaded never
  reloads at all. CI builds it (`console-app-debug.apk`); it is in the Apps screen once this lands.

## What to know

- Not tested on a phone. No device here. That the stream keeps delivering while the WebView is detached, and that
  the page reports itself hidden there, is how Chromium behaves, not something measured on his phone. If the folded
  page still drops off the list after the deploy, the fallback is intact (wake, now on the target, open not lost),
  and the next step would be a beat driven by the shell.
- The quiet-console try costs up to 2 s when the page really is frozen, then the wake goes out at once. A frozen
  page is not asked again until it beats.
- A command that changes data and reaches only a quiet console that does not answer fails honestly ("not re-sent
  because it changes data"), as it already did for a live console. It used to be queued in that one case.
- Calls now answer `pending` after a few seconds where they used to hang for the whole wake. The command still
  runs; `console_where` shows where the console ended up. Pass `wait` to hold the call longer.
- No build record existed in the builds store for this hand build, so there were no steps to tick.
- UI: the nav and menu entries are in UI Review (desktop and phone shots, `scripts/apps-nav-shots.mjs`).
