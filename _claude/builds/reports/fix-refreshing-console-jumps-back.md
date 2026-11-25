# Fix: refreshing the console jumps back instead of staying put

Build `fix-refreshing-console-jumps-back` (Pipeline 2.0). Status: **code complete, checks green, not yet seen in a
browser** (see "What was checked"). Steps s1 to s9 are merged on `claude/fix-refreshing-console-jumps-back--s11`;
step s10 (unit test + Playwright run) had not pushed when this report was closed.

## Result in one line

The console never saved where Brett was, so every reload booted on Home at the top. It now saves the place (screen,
tabs, selection, scroll) per browser tab and puts it back after every kind of reload. No scroll lock existed in the
code; the "won't scroll after an update" came from the layout, and those spots are fixed too.

## Cause

### Jumping back

There was no "restore my place" at all (trace on `main` a547deee5):

| State | Before | Why it was lost |
|---|---|---|
| Screen (view) | Lost | `framework/core/runtime.ts:482` starts on `manifest.startView ?? 'home'` on every boot; the view was never written to the address or to storage. |
| Tab in a tab row | Lost by default | `TabGroup` only remembers a tab when the row's `rememberLast` is on (default off); rows held in a view's `useState` kept nothing. |
| Scroll | Lost | The page does not scroll, `.fx-main` does (`axf.css:432`), so the browser's own scroll restoration never applies, and `AppShell.tsx:91` scrolls to the top on every view change. |
| Selection | Lost | The focused row lives in memory (`src/control/executor.ts`); open items are view `useState`. |

Every reload took that same path, and none saved anything:

1. **Pull-down on the phone.** The console has no pull-to-refresh of its own. Nothing set `overscroll-behavior`, so a
   downward drag with the pane at its top (or starting on the banner stack) became the browser's page reload.
2. **Browser reload.**
3. **Refresh pushed from the server** (`plugins/console-commands/web/index.tsx`, `reloadPage`): soft is
   `location.reload()`, hard clears caches and service workers and replaces the address with `?axf-refresh=<stamp>`.
   The plugin already knew the place and reported it, but nothing put it back, and the query value stayed.
4. **"Reload for the new version"** (`src/pluginLoader.tsx`) after a redeploy.
5. **The Android shell's own reload** when a new console is live.

### Locking up after an update

Nothing in the console or the framework sets `overflow: hidden`, a lock class or a touch blocker on the page. The
lock-up is the layout handing the gesture to the wrong thing:

1. **The banner stack is its own scroller above the page** (`.fx-frame-banners`, up to 45vh, `axf.css:164`). After an
   update more banners show. A drag that starts there moves the banners or nothing; downward it chained to the
   browser's pull-to-refresh, which reloaded the page onto Home (the jump back again).
2. **The update notice could not be put away** (`.axf-new-version`, fixed, z-index 300, nearly full width on a phone).
   A drag that starts on it does not scroll the page, and it stayed until a reload.
3. **A dialog open during a reload left its history entry** (`Overlays.tsx`, `{ axfDialog: true }`): the first Back
   press afterwards did nothing.

Ruled out: the drag class (`axf-dnd-dragging`, cursor only), the banner-strip flag (the console's shell never mounts
the strip), arrange mode (not saved), full-screen layers (none is restored after a reload), the terminal's touch
handlers (two fingers / Ctrl only).

## Fix

| Part | Where | What it does |
|---|---|---|
| Place store (s3) | `apps/console-web/src/place/placeState.ts` | Saves view, active tab of every tab row, selection and scroll offsets (main pane and named panes) to sessionStorage `axf:console:place@1`, keyed by console-control addresses. Debounced 200 ms; flushed on `pagehide` and when the page is hidden. Per browser tab on purpose: two console tabs do not fight. |
| View + tabs on load (s4) | `src/App.tsx` (`usePlace`, `placeHost`) | Reopens the saved view before the first paint and switches saved tabs as their rows render. A deep link (`#/…`, `?axf-open=`, `?axf-ref=`) wins over the saved place. A saved plugin view shows an empty page until its plugin loads (no Home flashing by); if the plugin never comes, the start view opens after 15 s. Embedded page mode keeps no place. |
| Scroll + selection (s5) | `src/views/placeRestore.ts`, six views | `restoreScroll()` retries each container until the content is tall enough, holds the offset 400 ms against a late scroll-to-top, gives up after 5 s and stops the moment Brett scrolls, taps or types. `usePlaceTab` / `usePlaceSelection` / `usePlaceSet` start a view's chip row, selected item and open rows from the saved place: Build queue, Catalog, Components, Boilerplates, Library templates, Pending, Tracker. |
| Pushed refresh (s6) | `src/place/keepPlace.ts`, `plugins/console-commands/web/index.tsx`, `src/pluginLoader.tsx` | `savePlaceNow` writes the live place right before a soft or hard refresh (twice on hard: cache clearing takes a moment) and before "Reload for the new version". The `axf-refresh` query value is taken off the address after load. |
| Pull-down (s7) | `src/place/pullRefresh.ts`, `src/main.tsx` | Saves the place the moment a drag becomes a pull that can reload the page, and again on `touchcancel` (the shell took the gesture), because some WebViews skip `pagehide`. Passive listeners only: it cannot hold the page. |
| Scroll after an update (s8) | `src/place/scrollGuard.ts`, `src/console.css`, `src/pluginLoader.tsx`, `framework/react/components/Overlays.tsx` (+ baked copy) | `.fx-frame-banners` gets `overscroll-behavior-y: contain` (no accidental reload from the banners). The update notice has a Hide button. A leftover dialog history entry is dropped on load. As a safety net, `clearScrollLocks` removes any inline overflow / pointer-events / touch-action lock, `inert`, stuck drag class or stray strip flag from `html`, `body`, `#root` on load, on `pageshow` and when the tab is shown again. |
| API (s9) | `src/place/placeApi.ts`, `server/console_control*.py`, `server/mcp_server.py`, `framework/cli/console-control.mjs`, `console-control-voice.mjs` (+ fixtures) | One control target, `panel:console-place`: state = the place (read only), press = put it back. |

Pull-down still reloads the page (the browser's own gesture on `.fx-main` is left in place); it now comes back where
it was. Stopping it outright (`overscroll-behavior` on `.fx-main`) was left out on purpose: Brett uses it.

## How each part is reached

| Part | REST | MCP | CLI | Voice |
|---|---|---|---|---|
| Read the place | `GET /api/console-control/place` | `console_control_place` | `axf console place [get]` | none (read only, nothing to say) |
| Put the place back | `POST /api/console-control/place/restore {from?}` | `console_control_place {restore: true, source?}` | `axf console place restore [--from loaded\|saved]` | "put me back", "back to where I was", "restore my place", "where was I" |
| Refresh the console, keeping the place | the console-commands plugin's `POST …/refresh {hard?}` route (already there) | `console_refresh {hard?}` (already there) | `axf console refresh [--hard] [--all]` (already there) | none: no refresh phrase was found or added |

`state` answers `saved` (what the store holds now), `loaded` (what this page load found, i.e. where Brett was before
the reload), `now` (what is on screen) and `restoring`. A restore puts back `loaded` when there is one, else `saved`.
It only moves the screen, so its policy is navigation (allow). All four drivers send the same command; the restore is
also the action `console.place.restore`. Details: `_claude/memory/docs/console-control.md`, "Saved place".

The save and restore on load, pull-down and the scroll guard have no driver: they run by themselves on every page.

## Before / after

| | Before | After |
|---|---|---|
| Pull-down, browser reload, pushed refresh (soft and hard), "Reload for the new version", shell reload | Home, top of the page, default tabs, nothing selected | Same screen, same tabs, same selection, same scroll offset |
| Address after a hard refresh | `?axf-refresh=…` stays | removed after load |
| Deep link while a place is saved | n/a | the link wins |
| Drag on the banner stack | can reload the page | stays in the stack |
| Update notice | covers the bottom of the page until a reload | Hide button; Reload keeps the place |
| Back after a reload with a dialog open | first press does nothing | works |

"After" is what the code does, read from the merged branch. It has not been watched in a browser.

## What was checked

Run on the merged branch (main a547deee5 + s1 to s9), Nov 24 2026:

| Check | Result |
|---|---|
| `tsc --noEmit` (apps/console-web) | pass (needs the generated `src/control/inventory.json`: `node scripts/control-inventory.mjs`, as `npm run build` does) |
| `check-theme` | pass, 1483 files |
| `check-controls` | pass |
| `check-console-control` | pass |
| `check-toolbars` | pass, 570 files |
| `check-chrome-assets` | pass |
| `scripts/console-control-parity.mjs` | pass, 14 cases, 132 comparisons across REST, CLI, MCP, voice |
| `server/tests/test_console_control.py` | 11 passed (includes `test_place`) |

Not done, and it matters:

- **No browser run.** Step s10 (unit test for the place store and the Playwright reload / pull / pushed-refresh
  check) had not pushed. Nothing here proves on a real page that the place comes back or that the page scrolls after
  an update. The scroll-lock causes were found by reading the code, never reproduced on a phone.
- **No UI Review item.** The update notice's Hide button is a visible change with no desktop or phone shots yet.
- **Android shell.** The shell's own reload is covered by the same save (pagehide + pull), but was not run on a device.
- Merge clashes settled while joining the steps: the report (s1 and s2 both created it) and `src/main.tsx` (s7 and s8
  each added an install line; both kept).

## PR description (for the lander's one PR)

**Fix: refreshing the console stays put (screen, tabs, selection, scroll)**

Cause: the console never saved the place; every reload (pull-down, browser reload, pushed refresh, "Reload for the new
version", the Android shell) booted on Home at the top. The "won't scroll after an update" was not a lock: the banner
stack and the update notice took the drag, and a drag on the banners reloaded the page.

Fix: a per-tab place store (sessionStorage) saves view, tabs, selection and scroll; the app reopens them on load
(deep links win); every reload the console starts saves first; a pull saves as it starts; the banner stack no longer
chains to pull-to-refresh, the update notice can be hidden, leftover locks and a stale dialog history entry are
cleared on load.

Reached by: REST `GET /api/console-control/place`, `POST /api/console-control/place/restore`; MCP
`console_control_place`, `console_refresh`; CLI `axf console place [get|restore]`, `axf console refresh [--hard]`; voice "put me back" /
"back to where I was" / "restore my place".

Checks: typecheck, check-theme, check-controls, check-console-control, check-toolbars, check-chrome-assets, the
four-driver parity script and the console-control server tests all pass. Not verified in a browser; the Hide button
on the update notice is waiting on UI Review shots. Supersedes #825 (the Nov 18 attempt on
`claude/fix-refreshing-console-jumps-back`).
