# watch-live — Watch live: hot render of the screen a session is changing (Nov 1 2026, Opus, headless VPS)

Branch `claude/watch-live`, orchestrator build `watch-live` (Refactor profile), change-log `chg-20261101-6b8f099767`,
UI Review `r-20261101-ksry601` (waiting for Brett). Spec: `framework/spec/WATCH-LIVE.md`.

Brett: "Watch live" = HOT RENDER. On each approval row (expanded details) and each running build in the Build
manager / Build orchestrator, a Watch live link pops up (floating window on desktop, full-screen sheet on phone) the
exact screen the session is changing, changed element scrolled to and outlined, re-rendering in real time.

## How it works

1. **Headless launcher** (`deploy/claude-headless.sh`): next to every session runs
   `framework/cli/watch-live.mjs watch --session <tmux name> --parent <pid>`. Every 10 s it reads which apps the
   checkout changes (git diff vs its merge base with origin/main + new files) and starts a preview for each new one on
   a free port: the app's own Vite dev server (wrapper config, `base: /preview/<session>/<app>/`) and, for asset-only
   projects, `axf dev` (dev-server.mjs). It writes `/opt/axf/.axf-console/previews/<session>.json` (= the console's
   `$AXF_ROOT/.axf-console/previews`), heartbeats it, and stops everything when the session ends. The brief gets a line
   asking the session to call `axf focus`. `AXF_WATCH_LIVE=off` turns it off.
2. **Console proxy** (`apps/console-web/server/previews.py`, mounted in `main.py`): `GET /api/previews` and
   `/preview/<session>/<app>/…` (HTTP + the Vite HMR WebSocket) behind the console's own auth (wall admin / console
   token / open console). Iframes get a signed per-preview key (12 h) that becomes an HttpOnly cookie scoped to that
   preview's path. Previews listen on the `coolify` Docker network gateway (172.16.1.1 here), reachable from the
   console container only: **no new public ports**. Console cookies and the token never reach a preview.
3. **Focus**: `node framework/cli/axf.mjs focus <app> [route] [selector] --note "…"` → `.axf-focus.json`. The popup
   loads the route with `?axfFocus=<selector>`; the framework helper (`framework/core/watch-live.ts`, injected into
   every preview by the Vite plugin) scrolls to it and draws an outline overlay that follows it across hot updates,
   re-renders, scrolls and resizes, and follows `.axf-focus.json` when the session moves on. No focus yet → an
   automatic one from the most recently edited UI file (asset type → its control, plugin → its `axp-` classes).
4. **Asset hot swap**: asset-file edits never reload the page. The Vite plugin validates them like `axf dev`
   (`dev-server.mjs` `assetChange`, now shared) and sends an `axf:asset` HMR event; the helper calls the new
   `AxfRuntime.hotReplaceAsset` (re-register in place, active choice kept, tokens recompiled). Asset-only projects get
   the same through `axf dev`'s `/events`.
5. **Everything hot-renderable**: console-web (all plugin pages), axhub-web, amberx-droid web layer, patches-web,
   walkthrough-studio, demo; `framework` (assets, engines, controls, templates, boilerplates) through the demo shell
   with the live framework; Android apps (console, axhub-android, voicevault, patches) through the demo shell with
   their own assets + defaults and the "code changes show in the next APK" note. Previews render the checkout's live
   `framework/{core,react,ui,schemas}` instead of a stale baked copy (console-web, demo, framework shell).
6. **UI**: `WatchLiveLink` / `WatchLiveWindow` (framework controls; `axf.css` "Watch live", theme + scale tokens only).
   Console `src/watchLive.tsx` polls `/api/previews` once for every row and matches by change id, branch, session or
   worktree (approvals: by text). Placed on session entries + the banner in the Build manager, running/waiting builds
   in the Build orchestrator, the veto screen and the approval review dialog. Greyed **No live preview** otherwise.

## Before → after

- Before: a running build showed elapsed time, cost, steps and a Log link; nothing showed what it was doing on screen.
- After: the same row has **Watch live** (one per previewed app) or a greyed **No live preview** with the reason.

Screenshots (`_claude/builds/reports/watch-live/`): `build-manager-row-desktop.png` (this session's row with three
Watch live links, others greyed), `watch-live-popup-desktop.png` (floating window), `watch-live-sheet-phone.png`
(full-screen sheet), `preview-focus-hot-swap-desktop.png` (framework preview, `.fx-btn` outlined, accent swapped live).

## Tests

| Check | Result |
|---|---|
| `npx -y tsx framework/spec/check-watch-live.mts` (new, in CI) | 68 checks pass |
| `python apps/console-web/server/test_previews.py` (new, in CI) | 42 checks pass (incl. HMR WebSocket through the proxy, key/cookie scoping, no token/cookie forwarding) |
| End to end on the VPS (real watcher, Vite, uvicorn proxy, Chromium) | console reaches 172.16.1.1 previews; outline drawn at `?axfFocus=.fx-btn`; theme accent edit → `--fx-accent` changes with no reload; `axf:asset` sent, no `full-reload`; framework long-poll events through the proxy |
| Console `tsc --noEmit` + `vite build`, demo `tsc` | pass |
| check-theme / check-controls / check-plugin-pages / plugin lifecycle (clean clone) | pass |
| Touched plugins: build-manager test.mjs (126) + test.py, build-orchestrator test.mjs (18), approvals-banner test.mts (10) | pass |
| Rest of the android.yml web block (clean clone) | same results as the untouched base commit `e48ca208`; the ones red locally (tracker/plugins `--check`, session-checkin, test_wall_users, six plugin test.py, amberx-droid test without its node_modules, `--experimental-strip-types` on Node 20) fail identically on the base here, so they are this machine's environment, not this build |

## Fixed along the way

- `AxfProvider` only re-applied tokens when `state.active` changed, so an in-place asset edit didn't repaint;
  `hotReplaceAsset` hands it a fresh `active` map (same choices).
- Demo / react-ts / next-ts starter Home crashed when an asset type had no active asset (live framework newer than the
  app's assets): `rt.asset(t)?.name ?? 'none'`.
- `axf dev --framework` had no `/manifest.json`; it now serves the framework's defaults.

## Gaps / notes

- Android twin deferred (PORTING.md): Kotlin `hotReplaceAsset` + a Compose focus outline from the same focus file.
- The first open of a preview takes a while (Vite pre-bundles; an app without `node_modules` borrows `/opt/axf`'s or
  runs `npm ci` once, status "starting" meanwhile).
- Approval rows: matched by text (a held call naming the session's branch, change id or tmux session). The
  approval-expand build's expanded row details get the link when it lands on main (see THREADS carry-on).
- Previews start only for sessions launched through `claude-headless.sh` (console launches, Build manager starts).

## Merge + push

Waited the full 90 min (00:00–01:37 UTC) for `approval-expand`; it never reached origin/main. Merged origin/main
(`60752f86`, clean), re-baked the console (main's own framework changes came along), retested: check-watch-live 68,
test_previews 42, console tsc + vite build, theme / controls / plugin pages, build-manager (test.mjs 126 + test.py),
build-orchestrator 18, approvals-banner 10, check-approvals-menu 53, check-builds-store — all pass. Pushed to main.
The approval link sits today in the veto screen and the review dialog (the details of an approval row); the
expanded-row placement follows when approval-expand lands (THREADS carry-on).
