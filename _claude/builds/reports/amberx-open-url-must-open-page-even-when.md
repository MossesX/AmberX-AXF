# AmberX open_url opens the page even when Chrome is already in front

Build `amberx-open-url-must-open-page-even-when`, branch `claude/amberx-open-url-must-open-page-even-when`.
Phase 1 (Fable): the contract open-url-route@1. Phase 2 (Opus): s3–s15 below.

Brett, Nov 16 2026 18:37: "It sent a notification, but it didn't open. I have the browser open right now."

## What broke

Chrome was in front with the console in it. AmberX was in the background and "Display over other apps" was off.
Android blocked AmberX's background browser start without any error. Then the fallback notification went out.
Nobody used the console tab that was already on screen.

## Before / after per route

| Route | Before | After |
| --- | --- | --- |
| console-tab | Didn't exist. A console command could only wake a console, not open a page in one | `POST /api/console-control/navigate` sends `op: navigate` to the live console tab Brett focused last. That tab opens the page in place (a console address) or in a new tab (another amberxai.com page), and falls back to the same tab when the new tab is blocked. A hidden tab, a tab that isn't in front, or a silent tab (no answer in 2.5 s) passes it on to the next route. AmberX calls this first |
| overlay | First, when the toolbar was up | Second. `WatchService.openOverlayPage` |
| direct | One try with no check. A start Android dropped still counted as tried | Allowed when AmberX is in front or "Display over other apps" is granted (the overlay exemption). The start goes through `OpenPageActivity`, which must report back within 1.8 s or the next route runs |
| full-screen-intent | Mixed into the fallback notification, never checked | Its own route. It checks `canUseFullScreenIntent()`, posts on the high-importance `open-page` channel, and the trampoline starts the browser and closes itself. Shown only as a banner (phone unlocked) = failed with `phone-unlocked`, and it falls through |
| notification | Always posted, even when the start worked | Only when every other route failed. It never counts as `opened` |

Every answer to axHub keeps today's AXPP fields (`opened`, `notified`, `overlay`, `where`) and adds `route`,
`reason`, `tried`, `attempts: [{route, opened, reason}]` and the open-url-result@1.

## Device results (S26 Ultra)

**Not run in this session.** The session had no axHub token and no axHub tools (`AXHUB_TOKEN` unset, no
`call` tool), so it couldn't install the APK or run `amberx.open_url` on the phone. The three planned runs:

| Run | Expected route | Result |
| --- | --- | --- |
| Chrome in front, console tab open | console-tab (opened, in place) | not run |
| Chrome in front, no console tab | direct with "Display over other apps", else full-screen-intent → notification (opened: false) | not run |
| Phone idle / locked | full-screen-intent (opened) | not run |

The systems check item `amberx-open-pages` reports the real outcome as soon as a page is opened through AmberX.
Screenshots of the AmberX Open pages panel weren't taken either: the AmberX vite dev server fails on an unrelated
import (`@console/api` from `console-web/plugins/wake-listener/web/flow.ts`, which AmberX's vite config doesn't alias).

## API reach per feature

| Feature | REST | MCP | CLI | Voice | Deep link / target | State read |
| --- | --- | --- | --- | --- | --- | --- |
| Open a page in the console tab | `POST /api/console-control/navigate {url, newTab?, to?}` | `console_open_url` | `axf console open-url <url> [--new-tab\|--same-tab]` | "open page <address> [in a new tab]" (`POST /api/console-control/voice`); AmberX "open page {text}" | `panel:console-commands.navigate` (Settings → Plugins → Console commands → Pages opened) | `GET /api/console-control/navigate/last`, `console_open_url_last`, `axf console open-url last` |
| AmberX Open pages settings | hub `amberx.open_url` with `?axf-open-pages=state\|test\|grant` (AXPP `browser.open`); AXPP tools `open-pages.state` / `open-pages.test` once axHub lists them | through axHub `call` → `amberx.open_url` | n/a (phone) | "test open page", "how do you open pages", "open pages settings" | `amberx://settings/open-pages`; `view:settings/tab:settings.tabs=open-pages`; `panel:open-pages` | bridge `openPagesState()`; `?axf-open-pages=state` |
| Grant a permission | hub `?axf-open-pages=grant` | via axHub | n/a | via action `open-pages.grant:<which>` | Android grant screens | same as above |
| Systems check "AmberX can't open pages" | `GET /api/plugins/systems-check/health`, `POST health/autofix/amberx-open-pages` | systems-check tools | n/a | n/a | systems check banner | `GET health` |

API parity pins: `framework/spec/console-control-pins.json` (append-only; checked by `check-console-control.mjs`).

## Tests

- `node framework/spec/check-open-url-route.mjs`: 37 checks, including the phone order for mocked permissions (`fixtures/open-url-phone-order.json`).
- `python apps/console-web/server/tests/test_open_url_navigate.py`: 42 checks (tab on screen, none, hidden, silent, refused hosts, last, voice, MCP, CLI, Python twin vs the engine).
- `npx -y tsx apps/console-web/plugins/console-commands/web/navigate.test.mts`: 7 checks (in place, new tab, blocked → same tab, hidden, refused).
- `OpenUrlRouteTest.java` (gradle `testDebugUnitTest`): order, settle, console answers, `axf-open-pages` verbs.
- `npx -y tsx apps/amberx-droid/test.mjs`: 2391/2391.
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control, tracker: green.
- `apps/console-web/plugins/systems-check/test.py` has one failure ("ask first: red with its Auto fix offered"), and it fails the same way at this branch's HEAD before the systems-check change. That makes it pre-existing.

## Gaps and follow-ups

- axHub (`MossesX/axHub`, `packages/server/src/amberx.ts`) lists AmberX's tools by name. `open-pages.state` / `open-pages.test` need entries there to show up as their own hub tools. Until then the same verbs go through `amberx.open_url` with `?axf-open-pages=…`, which works today.
- Old APKs read `?axf-open-pages=grant` (the Auto fix) as a page and open the console. That's harmless, and it's gone once the new APK is installed.
- Kotlin kernel twin of open-url-route@1: deferred (Android on hold), recorded in `framework/spec/PORTING.md`.
- Device runs and screenshots: still to do with axHub access (see above).
