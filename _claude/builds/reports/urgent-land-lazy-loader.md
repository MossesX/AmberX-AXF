# urgent-land-lazy-loader — landing PR #298 (console plugin lazy loader)

Build `urgent-land-lazy-loader` (Current profile, Opus). Brett, Nov 4 2026 (voice): "Move it to next... start it right away."

## What was done

- `claude/plugin-lazy-load` was 425 commits behind main. Merged main in; conflicts: `App.tsx` (kept main's new
  `toolbarsLibrary` and the loader's disabled-plugin libraries + `markInstalled`), `.axf-queue.log` and
  `amber-persona.md` (main's), `follow-ups.md` (branch's, a superset of main's).
- Every plugin on main is picked up by the loader's glob (60 with a web part). New: `KNOWN_BANNERS` seed so all 20
  banner plugins load first even on a first visit, plus a check that fails when a banner-painting plugin is missing
  from it or a listed one no longer exists. Core plugins (plugin-manager, console-commands, console-terminal,
  systems-check) all exist on main.
- s1 (lazy loading, one chunk per plugin, stand-ins, on-demand commands, per-plugin HMR) and s2 (Lazy loader settings
  in Plugin Manager: preload count, pins, idle preload, cache size, offline cache, per-plugin Start/Open/Off, live
  table, drag order, banners first, reset; REST/MCP/CLI) were already built on the branch; nothing left unbuilt.

## Bug found while landing (fixed)

CI's theme-swap check timed out: the console never drew its menu. Cause: on a first visit every plugin loads once to
learn its shape, and each arrival bumped the loader version, so the shell re-ran `installLibraries` over all 60
plugins once per plugin (about 2 s each): the page's main thread was busy for minutes. Fix (`src/pluginLoader.tsx`):
each startup group (banners, then the rest) lands as one change, so the shell re-installs twice instead of 60 times.
Also: a stand-in on screen now counts as shown, and the plugin being installed (or with actions waiting for it) is
never the one evicted, so two on-screen plugins can't evict each other in turn. Found by pausing the stuck page in the
debugger (stack: `useMemo` → `installLibraries` → settings `addGroup`), confirmed with a headless probe (stuck
before, responsive for 25 s+ after) and theme-swap passing. The core plugins list also moved into each core plugin's
own `plugin.json` (`lazy.core`) so the Plugin Manager server doesn't name other plugins' folders (plugin-lifecycle@1).
`scripts/theme-swap.mjs` now prints page errors and the page text when it can't run, and takes `THEME_SWAP_PORT`
(another session's preview held 7098 on the VPS, so a local run tested someone else's build).

## Numbers

Startup bundle 4.46 MB → 2.07 MB (gzip 1.20 → 0.57 MB, −53 %); JS chunks 3 → 72. Details in
`_claude/builds/reports/plugin-lazy-load.md` → Numbers.

## Checks

| Check | Result |
|---|---|
| console `tsc --noEmit` | pass |
| `vite build` | pass |
| `lazy-loader-check.mts` | 11 passed |
| `plugin-manager/server/test_lazy.py` | 7 passed |
| `plugin-manager/test.py` | 69 passed |
| `theme-swap.mjs` (Playwright) | timed out before the fix → pass |
| `interface-scope-check`, `window-handles-check` | 7, 35 passed |
| plugin-lifecycle (every plugin, clean checkout) | pass |
| `check-theme`, `check-controls`, `check-toolbars` | pass |

## Landed

PR #298 merged `f15709c32` (2026-11-04 14:24 UTC) after CI passed on all four jobs (run 41845605537). The
console auto-update rebuilt the container at 14:28; a headless browser against it shows the menu, the banner and
`/axf-plugin-chunks.json`, stays responsive, and `GET /api/plugins/plugin-manager/lazy` answers with the defaults.

## Follow-up

- Phone time-to-interactive not measured (no device/screenshot pass on this landing, per brief).
- UI Review for the Lazy loader settings tab is still owed by `plugin-lazy-load` s3 (screenshots were out of scope here).
