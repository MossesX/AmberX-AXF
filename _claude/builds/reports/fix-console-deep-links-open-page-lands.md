# Fix console deep links so open-page lands on the right screen

Build `fix-console-deep-links-open-page-lands`, Opus, Nov 16 2026. Branch `claude/fix-console-deep-links-open-page-lands`.

## Brett said (verbatim)

> You didn't open the orchestrator, you just opened the main console. Yeah, we need to fix that.

## What broke

Two gaps, both ended on the console's home screen:

1. **The console never read `?axf-target=`.** A link such as
   `https://console.amberxai.com/?axf-target=view:build-orchestrator` loaded home. The only load-time parameters handled
   were `?axf-cmd=<id>` (queued commands) and `?axf-cmd=search`.
2. **No-console answers pointed at home.** `console_show` / `console_open` with an address go out as a console-control
   `control` command, which is never queued and never woke AmberX. With no console open the answer's `openUrl` was the
   bare console root, so a session that opened it put Brett on home. This is very likely the exact path behind Brett's
   message.

The hub's sign-in wall was fine: axHub `/auth/verify` rebuilds the return URL from `X-Forwarded-Uri`, which includes
the query string.

## What changed

- `apps/console-web/src/control/deepLink.ts` (installed by `src/control/index.ts`): on load, reads `?axf-target=`
  (or `#/?axf-target=`) and runs it through the console-control executor. Screens and tabs are opened; rows and steps
  are focused. It retries until the named screen has registered (lazy plugin chunks, slow backend, up to 30 s), holds
  the screen for 2.5 s against late boot steps, keeps the address in sessionStorage until it lands (reload / sign-in
  round trip), then takes the parameter off the address bar. A link that can't land ends with a warning toast.
  `window.axfDeepLink` reports `{address, done, answer}`.
- Console-commands server `control()`: with no console open, `openUrl` is `…/?axf-target=<address>`. An `open` or
  `focus` also asks AmberX to open that link on the owner's phone, using the same wake switch, 45 s cooldown and alert
  fallback as queued commands. `target_link()` builds the link.
- REST `console_control_api.run()`: the no-console `openUrl` carries the command's address too.
- MCP `console_open` / `console_show` (address form): status `pending` (not `failed`) when AmberX was woken.
- Voice (JS engine + Python twin, fixture `replies.woke`): "No console was open. Opening it on your phone."
- AmberX (`AxppLink`, `OpenUrlRules`): `browser.open` takes `newTab: true` (or `where: "tab"`), which skips the
  one-page overlay and opens a new Chrome tab (`Browser.EXTRA_CREATE_NEW_TAB`) instead of reusing the last one.
- Docs: `framework/spec/CONSOLE-CONTROL.md` (Transports → Link), `_claude/memory/docs/console-control.md`.

## How each surface reaches it

| Surface | How |
|---|---|
| Link | `https://console.amberxai.com/?axf-target=<address>`, e.g. `view:build-orchestrator`, `view:gate/tab:gate.tabs=auto-lander` |
| REST | `POST /api/console-control/focus {address}`: live console answers; no console → 503 with `openUrl` = the link, `wake` |
| MCP | `console_show` / `console_open` with an address; `console_control_focus`. No console → `openUrl` + `wake`, status pending |
| CLI | `axf console focus <address>` (same REST route, same `openUrl`) |
| Voice | "open the orchestrator" → same command; no console → "Opening it on your phone." |
| Phone | axHub `amberx.open_url {url, newTab: true}` for a tab of its own |

## Tests

- `apps/console-web/scripts/deep-link.e2e.mjs` (Playwright on `vite preview`): **38 checks green**. Covers four addresses
  loaded fresh (build orchestrator, gate, gate › auto-lander, settings › plugins), the hash form on a phone viewport, a
  2.5 s slow backend, a reload before landing, an unknown screen, and the wake path (`?axf-cmd=<id>`) for console_show
  by address, console_open by name and a gate tab. With the handler switched off it fails on the first case
  (`screen: home`).
- `plugins/console-commands/server/test_console_commands.py`: 128 checks green (new: link, wake, cooldown, no wake for
  press / state, escaping).
- `server/tests/test_console_control.py` 8 tests green (new: REST link, voice reply parity). `server/test_mcp_tools.py`
  206 checks green.
- `check-console-control`, `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `tsc` all pass.
- `OpenUrlRulesTest.newTabOnlyWhenAsked` added; no JDK on the VPS, so it runs in the Android CI job.
- Screenshots in UI Review → Screenshots, group "Fix console deep links so open-page lands on the right screen".

## Known gaps

- The deep-link e2e is not in CI. It needs a built `dist/` and Playwright, the same as `console-control.e2e.mjs`.
- `newTab` reaches the phone only once the AmberX APK with this change is installed. Until then the old app ignores the
  argument and behaves as before.
- axHub's `amberx.open_url` passes arguments through to the device. If its schema is ever narrowed, `newTab` must be
  listed there.
