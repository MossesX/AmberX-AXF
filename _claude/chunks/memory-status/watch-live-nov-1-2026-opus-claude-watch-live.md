<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=24-24 tokens=169 -->
## Status (as of Oct 21 2026)

- **Watch live (Nov 1 2026, Opus, `claude/watch-live`):** hot-rendered previews of what a headless session is changing. `framework/cli/watch-live.mjs` (started by `deploy/claude-headless.sh`: previews per touched app, registry `/opt/axf/.axf-console/previews`, `axf focus`), Vite plugin `watch-live-vite.mjs`, page helper `framework/core/watch-live.ts` + `AxfRuntime.hotReplaceAsset`, console proxy `server/previews.py` (`/preview/<session>/<app>/`, `/api/previews`), `WatchLiveLink`/`WatchLiveWindow` in the Build manager, orchestrator and approval details. Spec `framework/spec/WATCH-LIVE.md`, report `_claude/builds/reports/watch-live.md`.
