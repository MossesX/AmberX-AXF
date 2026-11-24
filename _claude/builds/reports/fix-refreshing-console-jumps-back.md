# Fix: refreshing the console jumps back instead of staying put

Status: **draft** (step s1: cause analysis). Build `fix-refreshing-console-jumps-back`.

## How this was checked

Static trace of the code on `main` (a547deee5). No browser run: the live console on this VPS answers loopback only
with a bearer token, and this step has no build of its own. The "jumps back" cause is certain from the code. The
scroll-lock cause is **not proven**: the candidates are ranked below and need a browser run in a later step.

## Result in one line

The console has no "restore my place" at all. Every page load boots on the start view with fresh component state, so
any reload (pull-down, browser reload, the pushed `refresh` command, the "Reload for the new version" bar, the
Android shell's own reload) lands on Home at the top.

## What a reload loses

| State | Kept across a reload? | Why |
|---|---|---|
| Screen (view) | **Lost** | `framework/core/runtime.ts:482` sets `view: opts.manifest.startView ?? 'home'` on every boot. `set()` (`runtime.ts:1411`) only saves `{active, role, defaults}` under `axf:<app>`; the view is never written anywhere (no URL hash, no query, no storage). |
| Hub page parameters (which approval, which handoff run) | **Lost** | `apps/console-web/src/hubPages/route.ts:25` keeps them in a module variable. An old `#/approvals/<id>` hash is read once and then cleared (`route.ts:61`), so the address never carries the place either. |
| Tab in a tab row | **Lost** by default | `TabGroup.tsx:107-118` saves the tab under `axf.tabs.<id>.last` only when the row's `rememberLast` is on; the default is off (`chrome-settings-rules.mjs:132`). Rows that are plain `useState` in a view (Build queue, Plan and most plugin pages) keep nothing. |
| Settings tab | Kept | `axf.settings.lastTab` (settings library). The Settings screen itself is still lost, because the view is. |
| Scroll position | **Lost** | The page does not scroll; `.fx-main` does (`axf.css:432`), so the browser's own scroll restoration never applies. Nothing saves `.fx-main`'s `scrollTop`, and `AppShell.tsx:91` forces `scrollTo({ top: 0 })` whenever the view changes. Named containers (`data-axf-scroll`) are not saved either. |
| Selection (focused row, open item) | **Lost** | The focused address lives in memory (`src/control/executor.ts`), and open items are view `useState`. |
| Open dialog | **Lost** | `state.dialog` starts `null`. The history entry a dialog pushed (`Overlays.tsx:49`, `{ axfDialog: true }`) survives the reload with no dialog behind it. |
| Floating windows and docked tabs | **Lost** | The window manager state is in memory only. |
| Look, role, settings, plugin on/off | Kept | `axf:<app>`, `axf:<app>:settings`, the plugin loader's keys. |

## Every way the console reloads (all take the same path, none saves the place)

1. **Pull-down on the phone.** There is no pull-to-refresh code. `.fx-main`, `html` and `body` set no
   `overscroll-behavior`, so Chrome's own pull-to-refresh fires when the main pane is at its top: a full page reload.
2. **Browser reload / F5.** Same.
3. **Refresh pushed from the server.** `plugins/console-commands/web/index.tsx:299, 442` acks the `refresh` command
   and calls `reloadPage()` (`:222`): soft is `location.reload()`; hard clears caches and service workers and does
   `location.replace(<url>?axf-refresh=<stamp>)`. The plugin already knows the place (`hereOf()`, `:166`: screen,
   open tab of each row, selection, dialog, settings tab) and reports it to the server, but nothing puts it back after
   the reload. The `axf-refresh` value also stays in the address afterwards.
4. **"Reload for the new version".** `src/pluginLoader.tsx:579, 595`: `location.reload()` after a redeploy
   (chunk load error, `vite:preloadError`, or the Android shell's `shell.update`).
5. **Android console app.** The shell reloads the page by itself when a new console is live and the app is off
   screen (`src/native/axfNative.ts:23, 224`). Brett comes back to Home without having asked for anything.

Not a reload: the `console.refresh` action (`src/actions.ts:10`) only re-reads the store's data
(`store.tsx:46`); it keeps the place. Service worker: only `/alerts-sw.js` for push; it does not reload the page.
Vite hot reload and Watch Live (`watch-live.ts:194`) only run in previews, not the live console.

## A second trap for the fix: plugin views arrive late

Plugin views are not there on the first render: `App.tsx` `usePlugins()` installs them after `fetchPluginStatus()`
and the lazy loader's chunks. Until then `AppShell.tsx:83` shows `views[state.view] ?? Object.values(views)[0]`.
So a restored view id must be kept as it is while the fallback shows (it resolves by itself when the plugin lands),
and tabs, selection and scroll can only be put back after that view has rendered its data. Restoring scroll in the
first frame will not hold: the content is not tall enough yet, and the `[state.view]` effect scrolls to the top.

## Scroll lock after an update: not proven, ranked candidates

No code sets `overflow: hidden`, a scroll-lock class or `touch-action: none` on the page or on `.fx-main`. What can
leave the page unable to scroll, most likely first:

1. **The reload itself, on the phone, mid-gesture.** After an update the page is reloaded (ways 4 and 5), boots on
   Home at the top, and plugin banners (`.fx-frame-banners`, up to 45vh, its own scroller) and the main pane are
   rebuilt as plugins load. On a phone a drag that starts on the banner stack scrolls the stack, not the page, and
   with the page at the top a pull-down starts another reload. This reads as "it won't scroll". Needs a phone-size
   browser run to confirm.
2. **A stale dialog history entry.** Reloading with a dialog open leaves `history.state = { axfDialog: true }` with no
   dialog. The next dialog pushes a second entry and its close runs `history.back()` (`Overlays.tsx:56`) onto the
   stale one; the Android back button then eats a press doing nothing. Not a scroll lock by itself, but it is wrong
   state after an update and should be cleared on boot.
3. **An invisible full-page layer left up.** `app.frame.cover` plugins (`claude-session` asks, `claude-badge`
   drop-down), the `.fx-backdrop` (z-index 70, fixed, full page) and the root view transition of the skin switch
   (`runtime.ts:851`; the page takes no input while it runs) all cover the page. The skin switch only runs on a look
   change the user makes, and its flag clears on `finished`, so it should last a fraction of a second; a backdrop
   whose dialog id has no renderer draws nothing (`def` is undefined). No stuck case found in the code.
4. **Touch handlers.** The terminal (`plugins/console-terminal/web/TerminalHost.tsx:221-223`) cancels `wheel` only
   with Ctrl/Cmd and `touchmove` only with two fingers. Not the cause.

Recommended for the step that fixes this: reproduce on a phone viewport after a reload with
`document.elementsFromPoint()` at the touch point and the `scrollHeight` / `clientHeight` of `.fx-main`, which tells
candidates 1 and 3 apart in one run.

## Recommended fix (for the next steps)

- **Save the place** in `sessionStorage` (per tab, so two console tabs do not fight; survives reload, soft and hard
  refresh and the shell's reload): `{ view, hub route params, tabs, selection, dialog, scroll: { main, named } }`.
  The data already exists: `hereOf()` / `controlState()` give screen, tabs and selection by control address, and
  `scrollControl.ts` gives `scroll:main` and every named container. Write it on change (throttled) and on
  `pagehide`, so a reload nobody announced (pull-down, the shell) is covered too.
- **Put it back on boot**: the runtime starts on the saved view (falls back to `startView` when the view no longer
  exists once plugins have loaded); then, when that view's targets are registered, set the tabs and selection through
  their control targets and scroll last. The `[state.view]` scroll-to-top effect in `AppShell` must skip the restored
  first view.
- **Pull-down**: `overscroll-behavior-y: contain` on `.fx-main` stops the accidental browser reload; decide in the
  build whether pull-down should instead run `console.refresh` (data only, place kept).
- **Hard refresh**: strip `axf-refresh` from the address after load. Clear a stale `axfDialog` history state on boot.
- **Where the code lives**: `apps/console-web/src/axf/**` is a baked copy of `framework/**` (`framework/cli/rebake.mjs`).
  The runtime and AppShell changes go in `framework/core` and `framework/react`, then rebake. The copy has already
  drifted: `framework/react/AppShell.tsx:91` has `scrollTo?.(…)`, the console's copy has `scrollTo(…)`.
  A view field on the runtime is a reference-engine change: regenerate `framework/spec/fixtures` and record the
  Android twin as a deferred gap in `framework/spec/PORTING.md`.
