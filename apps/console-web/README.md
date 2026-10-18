# AXF Dev Console (web)

The framework development console: a React/TypeScript app built on the AmberX AXF web port (`src/axf` = baked `framework/core` + `framework/react` + `framework/ui`), with a Python (FastAPI) API in `server/` that runs the build engine.

- **Home** — coverage per catalog tab, open project, recent installs/imports.
- **Tracker** — built / partial / placeholder / planned per feature; status edits write `framework/catalog/status.json` through the API and regenerate `tracker.json`.
- **Catalog** — the feature checklist; checking a feature opens the suggestions dialog of related features to bundle into one library; export the build plan for Claude Code.
- **Libraries** — *Framework libraries*: build one (module + demo app) or **Install** one into the open project through the interactive wizard (parameters from the library's `library.json`). *UI libraries*: two panes (hot-swappable AXF kits / third-party), multi-select, **Compare** opens each in a floating tab group (undock, drag tabs between groups and windows, split vertical/horizontal/four-way/custom grid with even distribution, minimize to corner title bars or a floating toolbar, tree ↔ grid element explorer with hot-swap editing of tokens / style parameters / flags, drag a tree node out into its own ELEMENT window), **Import** ports a third-party library into a new AmberX UI library (clone → refactor to tokens → save as a hot-swappable kit → apply to the project).
- **Boilerplates** — browse by category, assemble one from catalog features with a live phone preview, import third-party boilerplates for porting, create an app from one.
- **Demos / Modules / Components / Assets** — demo apps per library, the Android port's module list, the component vocabulary rendered live, the hot-swap studio.
- **Output terminal** — every install / import / hot swap / kit fallback, auto-scrolling, as a floating window, dock tab or dialog; follows the API's log live over SSE.

```bash
npm install && npm run dev                      # console at :5173, /api proxied to the Python API at :7090
cd server && pip install -r requirements.txt && uvicorn main:app --port 7090 --reload
npm run build                                   # dist/ — served by the API (or any static host; data falls back to public/data)
```

Without the API the console still runs on the static data synced into `public/data` and *records* engine commands (copy the script, run it with Claude Code). With it, every wizard runs for real and writes to the repo.

Deploy: `server/Dockerfile` (Node 22 + Python 3.12, one container) — point Coolify at it with the repo root as build context. The Android app in `apps/console` is the framework's **Android showcase** of the same console views.

## Plugins

The console loads plugins from `plugins/` (web part bundled at build time, optional FastAPI router mounted at
`/api/plugins/<folder>/` behind the console token). Manage them under Framework → Plugins. To write one, copy
`plugins/_template` and read `plugins/README.md`.
