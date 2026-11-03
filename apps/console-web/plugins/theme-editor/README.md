# Theme editor (console plugin)

`ai.amberx.axf.console.theme-editor` · built on Opus.

Edit colour and style themes token by token; copy, save and load them.

- **Two sections**, Colour and Style, each a collapsible card, with **collapsible categories** (Colour: Scheme,
  Surfaces, Text, Accent, Status, Effects; Style: Typography, Spacing, Shape, Depth, Transparency, Motion, Layout).
  Every possible token is listed: the asset type's fields (`asset-types.json`) and every field any known theme of the
  type has, so a token added there shows up by itself (a new nested group gets its own category, anything else goes
  under Other). Tokens the theme being edited leaves out are marked "not set" (Settings → hide them).
- **Views** (toolbar): Tree, Grid, Swatches, Compare (draft next to another theme, differences marked, *Take* a value).
- **Copy** starts a new draft from the theme being edited; **Copy as JSON** / **Paste** / **Load a file** move
  standard asset@1 themes in and out; **Load** picks any colour or style theme the app has.
- **Drafts never leave the editor**: the preview card draws them with the theme engine's own variables
  (`colorThemeVars` / `styleThemeVars`), scoped to that card. **Save & apply** stores asset@1 themes
  (`<name>-colors`, `<name>-style`) in `.axf-console/plugins/theme-editor/themes/<type>/<id>.json`, registers them and
  swaps to them; the swap is the hub look (appearance@1), so every app follows.
- **Token tree**: the Theme manager's (`buildTree` / `leaves` / `getAt` / `setAt`) through the web capability
  `axf.token-tree@1` (`globalThis.__axfWebServices`), never an import of its folder. Without it the editor says so.

Known gap: the appearance document holds ids only, so an app that doesn't have a saved theme's body keeps its default
for that slot. Sharing saved theme bodies across apps (a hub theme library) is a follow-up.

Routes (console token, 404 when disabled): `GET/POST /themes`, `DELETE /themes/{type}/{id}`.
Self-tests: `python3 apps/console-web/plugins/theme-editor/test.py`, `npx -y tsx apps/console-web/plugins/theme-editor/test.mts`.
