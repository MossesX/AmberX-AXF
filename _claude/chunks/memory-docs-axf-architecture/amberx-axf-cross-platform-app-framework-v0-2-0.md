<!-- memory-chunk@1 source=_claude/memory/docs/axf-architecture.md tokens=535 -->
# AmberX AXF — cross-platform app framework (v0.2.0)

AmberX AXF builds apps whose entire UI is made of **hot-swappable assets**. Every theme, layout, menu, toolbar,
dialog, popup, button, slider, container and access policy is a JSON asset in one shared format (`asset@1`),
so any app built on AmberX AXF on any port (web, Android, …) can load any other app's assets.

```
amberx-axf/
├── framework/
│   ├── core/  react/  ui/        web port: TypeScript engines + runtime (reference implementation), React layer, axf.css
│   ├── android/                  Android port (Kotlin + Jetpack Compose) — see below
│   ├── assets/                   shared starter assets (one folder per type; uac-policy/hub-accounts for apps behind axHub's wall); android/assets/ holds port-specific ones (ui-kit)
│   ├── schemas/                  asset-types.json (single source of truth) + asset-types.android.json (optional port types) + plugin.schema.json
│   ├── spec/                     PORTING.md + fixtures/ — golden engine outputs every port must reproduce (ConformanceTest)
│   ├── catalog/                  catalog.json (feature checklist) + status.json → tracker.json at the repo root
│   ├── boilerplates/             categorized boilerplate.json bundles (16 across 9 categories) + index.json
│   ├── templates/                react-ts, next-ts, android-compose, web-fastapi-wall (web + FastAPI behind axHub's wall), android-module (library) — each with template.json
│   ├── cli/                      build-engine.mjs, axf.mjs, dev-server.mjs (live reload), serve.mjs (HTTP driver), tracker.mjs, boilerplates.mjs
│   ├── deploy/                   axf-deploy.sh: shared VPS installer helpers (Coolify run, axHub wall labels, wall secret, auto-update); README.md
│   └── defaults.json             default asset per slot, baked into every new app
├── apps/demo/                    web demo (xaf.amberxai.com)
├── apps/console/                 AXF Dev Console — first Android app (tracker, catalog, library picker, demos, modules, boilerplate manager)
└── tracker.json                  what's built / partial / placeholder / planned, per feature
```
