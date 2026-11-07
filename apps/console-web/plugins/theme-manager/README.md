# Theme manager (console plugin)

`ai.amberx.axf.console.theme-manager` · built on Opus.

Roll colour / style / layout themes, or everything themeable, and choose exactly which tokens a roll may change.

- **Tree** of every token, built from `framework/schemas/asset-types.json` + the registered assets (new asset types appear by themselves): tri-state ticks, locks (never rolled), filter, presets (all / none / colors only / accents only / invert + your own named presets, saved server-side), "only" this branch. On a phone it drills down one level at a time.
- **Sane rolls** (`web/rollEngine.ts`): colour themes get a harmonious palette with contrast-checked text and status colours; numbers stay inside the range the known themes use; enums pick known values. Readability warnings for the active colour theme.
- **Live preview** through the engines (`registry.register` + `rt.swap` on `tm-preview-<type>-a|b`), undo/redo (50 steps), pin favourites, edit any value by hand, back to the saved look.
- **Save as asset**: one standard asset@1 per changed type (name, tags), kept in `.axf-console/plugins/theme-manager/themes/<type>/<id>.json`, registered on start; the ones you applied last come back on reload. Apply, rename, duplicate, export, import, delete. Built-in ids are refused, so built-ins are never changed.

- **Appearance and skins:** this plugin's page and Settings → Appearance are one shared panel (`AppearancePanel`, framework/libs/settings): Skin (picker with live preview, Apply, Reset) and the Use skin switch (off by default, this app only), Style / Colour / Layout theme, Visible parts, Navigation menu, Restore to default with one undo. With a skin on, a pick overrides that part only (a dot and Back to skin). Right-click any chrome for Restore to default too. Design packages show as skins. The format is skin@1 + app-look@1 (`framework/core/engines/skin.ts`, `framework/spec/APPEARANCE-SOURCE.md`).

Routes (console token, 404 when disabled): `GET/POST /themes`, `PUT/DELETE /themes/{type}/{id}`, `GET/PUT /presets`, `GET /skins`, `POST /skins/{app}/use` (`{skin}`), `/off`, `/back` (`{slot}`), `/restore`, `/undo`. They become MCP tools by themselves (plugin-commands@1); the CLI is `node framework/cli/skins.mjs`. Voice: "use the Windows skin in the console" and "restore AmberX to default" go through these tools; inside an app, the actions `skin.use:<id>`, `skin.off`, `skin.restore`, `skin.undo`.
Self-test: `python3 apps/console-web/plugins/theme-manager/test.py`.
