<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=80-80 tokens=168 -->
## Status (as of Oct 21 2026)

- *[retired]* **Build Pilot hooks (Oct 19 2026, built on Opus):** for the plugin-driven app designer in `MossesX/Build-Pilot`. `init` takes `slots` (`{ assetType: assetId }`, checked by `checkSlotPicks` against the assets the new app will ship; they win over the registry and boilerplate defaults); `listFrameworkAssets(template)` lists them per type (engine-rpc `framework-assets`, console `GET /api/framework-assets?template=`); console `GET /api/build-options` serves the build-options registry. Build Pilot calls the console's `/api/init` + `/api/validate` with the console token (server-side only) and writes apps to `apps/pilot-<id>`.
