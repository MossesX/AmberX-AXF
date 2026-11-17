# Fix: refreshing the console jumps back instead of staying put

Build `fix-refreshing-console-jumps-back` · Brett (Nov 17 2026): "when are we fixing the refresh bug"

Status: draft (step 1, findings).

## How the console finds its place on load (before the fix)

| State | Where it lives | Survives a reload? |
|---|---|---|
| View (`view:<id>`) | `AxfState.view` in memory, initial `manifest.startView ?? 'home'` (`framework/core/runtime.ts:468`) | **No**: every reload opens Home |
| URL | none: the console never writes the view to the hash or query. Only one-shot deep links are read and stripped (`?axf-open=` in `src/native/axfNative.ts:76`, `?axf-cmd=search` in `src/control/SearchPalette.tsx:96`, `?ref=` in `framework/react/components/RefText.tsx:129`) | n/a |
| Active tab per tab group (`tab:<id>`) | component state of each view; `TabGroup` only restores it when the row's asset has `rememberLast` (`framework/react/components/TabGroup.tsx:107-113`, localStorage setting, per device not per page) | **Partly**: only rows whose asset remembers, and only once the view itself is open again (which it isn't, see View) |
| Scroll of the main pane (`scroll:main` = `.fx-main`) and named panes (`data-axf-scroll`) | DOM only | **No**: the shell is replaced by the waiting screen until the hub answers (`framework/react/AppShell.tsx:91-97`), then the view mounts at the top |
| Selection (`row:<…>`) | component state | **No** |
| Dialog | `AxfState.dialog` in memory; `DialogHost` pushes one history entry `{ axfDialog: true }` (`framework/react/components/Overlays.tsx:44-55`) | No (and the stale history entry survives the reload) |
| Hot-swap choices | localStorage `axf:<app id>` (`runtime.ts:1396-1398`) | Yes (look only) |

## Every path that reloads the page

1. Browser reload / F5 / the phone's reload.
2. Pull-down refresh on the phone: there is no pull-to-refresh handler of our own. Chrome / the WebView's native
   pull-to-refresh fires because `html, body` are 100% high and the only scroller is `.fx-main`
   (`framework/ui/axf.css:128`, `:431`), which has no `overscroll-behavior`: pulling past the top of a list chains to
   the root and reloads the page.
3. Server-pushed `console.refresh` (`axf console refresh [--hard]`, MCP `console_refresh`): the console-commands plugin
   acks then calls `reloadPage()` (`plugins/console-commands/web/index.tsx:142-152`): soft = `location.reload()`, hard =
   clear caches + service workers, `location.replace(?axf-refresh=…)`. Nothing is saved first.
4. The in-console `console.refresh` action (`src/actions.ts:10`) only re-reads the store's data (`store.refresh()`); it
   does not reload, but it is the same name as the server command.
5. New version: `NewVersionNotice` / `LazyCall` "Reload" buttons (`src/pluginLoader.tsx:544,560`) and the Android shell's
   content update (`apps/console-droid/.../ContentUpdate.java:97-104`, reload off screen; falls back to `loadUrl(HOME)`).
6. Watch live asset removal (`framework/core/watch-live.ts:194`).

## Cause

The console has no saved place at all. Every reload path above lands on `startView` (Home) at scroll 0 with default
tabs and no selection; that is the "jumps back". The fix is one place store (session-scoped, keyed by console-control
addresses) that every reload path saves into and the shell restores from, with URL deep links winning.

## Scroll lock after an update

See step 2 below.
