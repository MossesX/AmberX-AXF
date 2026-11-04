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

## Follow-up

- Phone time-to-interactive not measured (no device/screenshot pass on this landing, per brief).
- UI Review for the Lazy loader settings tab is still owed by `plugin-lazy-load` s3 (screenshots were out of scope here).
