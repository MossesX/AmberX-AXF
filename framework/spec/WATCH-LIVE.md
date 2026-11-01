# Watch live (watch-live@1)

Brett, Nov 1 2026: "Watch live" = hot render. Every approval row (its details) and every running build in the Build
manager and the Build orchestrator has a **Watch live** link that pops up the exact screen the session is changing
(floating window on desktop, full-screen sheet on phone), with the changed element scrolled to and outlined,
re-rendering in real time as files change. No preview → a greyed **No live preview** (its tooltip says why).

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Watcher | `framework/cli/watch-live.mjs watch` | Started by `deploy/claude-headless.sh` next to every headless session (`AXF_WATCH_LIVE=off` turns it off). Every 10 s: which apps the checkout changes (git diff against its merge base with `origin/main` + new files) → starts a preview per app on a free port, heartbeats the registry, keeps `.axf-focus.json` current. Stops the previews and removes its entry when the session (or `--parent`) ends. |
| Targets | `TARGETS` in the same file (open list) | `vite` = the app's own dev server: console-web (plugins included), axhub-web, amberx-droid (web layer), patches-web, walkthrough-studio, demo. `shell` = the demo app rendering another project's assets through the web port: `framework` (framework assets, engines, controls, templates, boilerplates) and the Android apps (console, axhub-android, voicevault, patches), with the "next APK" note. |
| Vite plugin | `framework/cli/watch-live-vite.mjs` | Added by a generated wrapper config (`.axf-preview.<app>.vite.config.mjs`, git-ignored) around the app's own config, with `base: /preview/<session>/<app>/`. Injects the helper, serves `<base>__axf/focus`, turns asset-file edits into `axf:asset` HMR events (validated like `axf dev`: `dev-server.mjs` `assetChange`) instead of a reload, and (`liveFramework`) renders the checkout's `framework/{core,react,ui,schemas}` instead of the app's baked copy. |
| Assets server | `framework/cli/dev-server.mjs` (`axf dev --host`) | For `shell` targets: serves the project's assets; the helper loads them, swaps to the project's defaults (`/manifest.json`; `--framework` serves `framework/defaults.json`) and long-polls `/events`. |
| Registry | `$AXF_PREVIEW_REGISTRY` or `/opt/axf/.axf-console/previews/<session>.json` (console: `$AXF_ROOT/.axf-console/previews`) | `{contract, session, worktree, branch, change, host, pid, focus, apps: {<app>: {label, kind, status: starting|ready|failed, why, port, assetsPort, android, note}}, updatedAt}`. No heartbeat for 2 min = gone. |
| Proxy | `apps/console-web/server/previews.py` (mounted by `main.py`) | `GET /api/previews` (console auth) and `/preview/<session>/<app>/…` (HTTP + the HMR WebSocket). Previews listen on the Docker network gateway (`AXF_PREVIEW_HOST`, default: the `coolify` network's gateway), never on a public port. Who may watch = who may use the console API (wall admin, console token, open console). Iframes can't send the token, so each listed preview carries a signed key (`?axfKey=`, HMAC of session/app/expiry with the console token, 12 h) that the proxy turns into an HttpOnly cookie scoped to that one preview's path. Console cookies and the token are never forwarded; the preview can't set cookies. |
| Page helper | `framework/core/watch-live.ts` | `?axfFocus=<selector>&axfNote=<text>` → scroll to + outline (an overlay; the element's own styles are untouched). Re-finds the element on every DOM change, scroll and resize, so focus survives hot updates. Follows `.axf-focus.json` when the session moves on. Applies asset changes with `AxfRuntime.hotReplaceAsset` (no reload; a removed asset, or a page without a runtime, reloads). |
| UI | `framework/react/components/WatchLive.tsx`, `apps/console-web/src/watchLive.tsx` | `WatchLiveLink` / `WatchLiveWindow` (framework controls, theme + scale tokens only; CSS in `axf.css` "Watch live"). The console's `WatchLiveFor` matches previews to a row by change id, branch, session or worktree (approvals: by text naming one of them). |

## Focus

Sessions say where they are: `node framework/cli/axf.mjs focus <app> [route] [css-selector] --note "…"` writes
`.axf-focus.json` (`{app, route, selector, note, at}`) at the checkout root. The headless launcher and the build brief
templates (Build manager `briefFor`, orchestrator `brief`) ask every session to do it whenever it starts on a screen.
Until it does, the watcher writes an automatic one (`auto: true`) from the most recently edited UI file (asset type →
its control's class, plugin → its `axp-<plugin>` classes); a session's own focus always wins.

## Tests

`npx -y tsx framework/spec/check-watch-live.mts` (focus params, hot swap in the runtime, registry, targets, focus
file, Vite plugin) and `python apps/console-web/server/test_previews.py` (registry, signed keys, proxy auth, HTTP +
WebSocket through the proxy). Both run in CI (`android.yml`, web/Python tests).
