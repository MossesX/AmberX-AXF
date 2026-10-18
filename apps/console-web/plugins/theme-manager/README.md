# Theme manager (console plugin)

`ai.amberx.axf.console.theme-manager` · built on Opus · Fable rebuild pending (`theme-manager-plugin`, starts with `uninstall.mjs --all`).

Roll colour / style / layout themes, or everything themeable, and choose exactly which tokens a roll may change.

- **Tree** of every token, built from `framework/schemas/asset-types.json` + the registered assets (new asset types appear by themselves): tri-state ticks, locks (never rolled), filter, presets (all / none / colors only / accents only / invert + your own named presets, saved server-side), "only" this branch. On a phone it drills down one level at a time.
- **Sane rolls** (`web/rollEngine.ts`): colour themes get a harmonious palette with contrast-checked text and status colours; numbers stay inside the range the known themes use; enums pick known values. Readability warnings for the active colour theme.
- **Live preview** through the engines (`registry.register` + `rt.swap` on `tm-preview-<type>-a|b`), undo/redo (50 steps), pin favourites, edit any value by hand, back to the saved look.
- **Save as asset**: one standard asset@1 per changed type (name, tags), kept in `.axf-console/plugins/theme-manager/themes/<type>/<id>.json`, registered on start; the ones you applied last come back on reload. Apply, rename, duplicate, export, import, delete. Built-in ids are refused, so built-ins are never changed.

Routes (console token, 404 when disabled): `GET/POST /themes`, `PUT/DELETE /themes/{type}/{id}`, `GET/PUT /presets`.
Self-test: `python3 apps/console-web/plugins/theme-manager/test.py`.
