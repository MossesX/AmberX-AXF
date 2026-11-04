# Plugin lazy loader — build report

Build `plugin-lazy-load` (Current profile, Opus; booked to Janitor Joey, no Polo card), Brett Nov 3 2026 (voice):
"The console gets slower as more plugins are installed." "Anytime I hot render or something gets hot rendered, it
reloads all the plugins." "Put in the plugin manager plugin all the ways to configure the lazy loader…" Addendum:
"For default, right off the bat, banners need to be the very first thing to load." Branch `claude/plugin-lazy-load`.

## Root cause

`apps/console-web/src/plugins.ts` loaded every plugin's web part with
`import.meta.glob('../plugins/*/web/index.tsx', { eager: true })`: all 56 plugins sat in the one startup chunk, so
startup grew with every plugin, every deploy re-downloaded all of it, and in dev any plugin edit propagated to
`plugins.ts` → `App.tsx` and reloaded the page with every plugin.

## What was built

| Step | What |
|---|---|
| s1 Lazy loading | `src/pluginLoader.tsx`: non-eager glob, one chunk per plugin. Manifests + help stay eager. A plugin that has loaded once leaves a **shape** in localStorage (its library as plain data, every function marked, plus the actions its `register` added and whether it paints the banner), keyed by a content hash of its `web/` folder. On the next start the shell installs a **stand-in** built from it: nav, views, dialogs, tabs, settings tabs/groups/panels, context and app menus, help and actions are all there; any render shows a "Loading …" placeholder (error + Retry) and loads the plugin; any action loads it, waits for the real handler, then re-dispatches (so REST / MCP / CLI / console_action commands that run actions in the console still work). Unknown or changed plugins load once at startup to learn their shape. `scripts/plugin-chunks.mjs` (Vite): `virtual:axf-plugin-hashes`, `axf-plugin-chunks.json` (each plugin's chunk + CSS size, startup chunk size), and in dev each `web/index.tsx` is its own HMR boundary (React Refresh's invalidate is replaced with a swap of that plugin only). |
| s2 Settings | Settings → Plugins → Plugin Manager → **Lazy loader**: banners first (on), most-used to preload (5), startup list with drag (and arrows on phones) to reorder, pins, idle preload (on, 5), plugins kept loaded (15, LRU back to stand-in), offline chunk cache (on, 25 MB), per plugin Start / Open / Off (core plugins can't be Off), live table (state loaded / cached / loading / not loaded / error / disabled, size, load time, last used, uses), Reset to defaults, Forget usage. Pure rules in `src/lazyEngine.ts`. Stored by the plugin-manager server part (`server/lazy.py`): `GET/PUT /lazy`, `PUT /lazy/plugin/{folder}`, `POST /lazy/reset`, `POST /lazy/report` (the open console's live table, read back by `GET /lazy`) — REST, MCP and CLI through plugin-commands@1 auto (`axf plugin-manager lazy`). |
| Banners first | `KNOWN_BANNERS` in `src/lazyEngine.ts` seeds the 20 banner plugins on main (activity, agent-voice, ai-assistant, alerts-bell, approvals-banner, build-manager, build-profiles, builds-page, claude-badge, claude-handoff, claude-settings, codebase-changes, follow-amber, main-build-status, plan-studio, plugins-menu, push-banner, systems-check, token-control, whats-shipped) so they load first on a first visit too; the check fails when a new plugin paints the banner and isn't listed. Banner plugins (declared `banners`, or `register` calling `setBadge` / `attachToBanner`) are pinned at position 1 and load in parallel before anything else; their chunks start downloading from the last visit's enabled list before React mounts. |
| Deploys | Console server serves hashed `/assets` with `cache-control: public, max-age=31536000, immutable`; a deploy now re-downloads only changed chunks. The alerts service worker answers `/assets/` from Cache Storage `axf-plugin-chunks` (offline cache), filled and trimmed by the loader. |

## Numbers

Production build (`vite build`, Nov 4 2026, main `d48cd480c` vs this branch merged with it; 60 plugins):

| | Before (main) | After |
|---|---|---|
| Startup bundle (entry JS + CSS) | 4.46 MB (1.20 MB gzip) | 2.07 MB (0.57 MB gzip), **−53 %** |
| JS chunks | 3 | 72 (one per plugin + shared) |
| Everything (all chunks) | 4.75 MB (1.27 MB gzip) | 4.78 MB (1.37 MB gzip) |
| Banner plugins (20, loaded first in parallel) | in the one bundle | 0.91 MB raw across their own chunks |
| Biggest plugin chunks | — | console-terminal 146 KB, agent-manager 115 KB, plan-studio 113 KB, build-manager 110 KB |

Time to interactive on a phone wasn't measured (no device pass on this landing); the startup download halves, and a
repeat visit loads only the startup list (banners + core + the 5 most used) from the immutable cache.

## Tests

| Check | Before | After |
|---|---|---|
| `npx -y tsx apps/console-web/scripts/lazy-loader-check.mts` | — | 11 checks (+ every banner-painting plugin is a known banner) (defaults, normalizer, frecency, banners-first order, off, dragged order, idle, LRU, TS = Python normalizer) |
| `python3 apps/console-web/plugins/plugin-manager/server/test_lazy.py` | — | 7 checks |
| `python3 apps/console-web/plugins/plugin-manager/test.py` | 62 | 69 (lazy routes) |
| `check-theme`, `check-controls`, `help-coverage` | pass | pass (help 100 %) |
| console `tsc --noEmit` | pass | pass |

## Known gaps

- "Unloading" an evicted plugin takes it out of the shell (back to its stand-in); its module stays in the browser's memory (JS can't unload a module), so a timer its `register` started keeps running. Re-opening is instant.
- A plugin whose library isn't plain data (React elements or class instances in it) can't have a stand-in: it loads at startup every time (shown in its table row tooltip). None found so far.
- First visit (or after Forget usage) still loads every enabled plugin once, in parallel chunks, to learn shapes.
- The offline cache works where the console's service worker (`/alerts-sw.js`) is registered; the loader registers it when the setting is on.
- Kotlin twin not needed (console-web only).
