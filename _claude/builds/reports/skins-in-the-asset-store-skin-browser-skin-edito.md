# Skins in the asset store: skin browser + skin editor

Build `skins-in-the-asset-store-skin-browser-skin-edito` · phase 1 · Opus · branch `claude/skins-in-the-asset-store-skin-browser-skin-edito`

**Brett (Nov 11 2026, verbatim):** "Get the skin stuff done. In the asset store, the skins."

## Result
- Assets has a **Skins** tab (first tab) listing all 28 skins: skin@1 assets plus design packages. Each card has a live thumbnail drawn from the skin's own layout, colour and style themes. There is search and a filter (All / Favourites / Mine / Skins / Design packages). Card actions: Apply, Preview, Everywhere, Edit, Duplicate, Export, a favourite star, and Delete for saved skins.
- If the app has per-part overrides, Apply asks first and names them (the apply-skin override question).
- **Skin editor** dialog covers the style theme, colour theme, layout, behaviour, icon pack and 21 more slots. The app behind the dialog shows the draft live. Save as new / Overwrite (saved skins only) / Save and apply. Closing restores the look.
- **Import skins** dialog: paste JSON or pick files. Taken ids get a free one.
- Entry points: Assets → Skins, Settings → Appearance → Browse skins, the console screen `skins`, and the `skins.browse` action.

## Where
- `framework/core/skin-library.ts` (`rt.skins`, the `skins.*` actions, capability `axf.skin-store@1`); `AssetRegistry.remove`; runtime `refreshLook`.
- `framework/react/studio/SkinBrowser.tsx`, `AssetStudio.tsx` (Skins tab), `AppShell.tsx` (dialogs), `framework/ui/axf.css` (`.axf-skinthumb`, `.axf-skineditor`).
- `framework/libs/settings/index.tsx` (Browse skins button); `apps/console-web/src/App.tsx` (screen `skins`).
- theme-manager: `/skin-library` routes, web service `axf.skin-store@1`, plugin.json, README, test.py.
- Baked copies synced in console-web, axhub-web, molly and amberx-droid.

## API parity
- REST: `GET /skin-library`, `GET /skin-library/saved`, `GET /skin-library/{id}/export`, `POST /skin-library`, `POST /skin-library/import`, `POST /skin-library/{id}/duplicate`, `POST /skin-library/{id}/favourite`, `DELETE /skin-library/{id}`; apply with `/skins/{app}/use` and `/skins/global`.
- MCP / CLI / voice: the plugin commands `skin-library`, `skin-library-saved`, `skin-library-run`, `skin-library-import`, `skin-library-by-iid-{export,duplicate,favourite,delete}`.
- In-app actions (`console_action`, palette, voice): `skins.browse`, `skins.new[:<from>]`, `skins.edit:<id>`, `skins.preview:<id>|off`, `skins.apply:<id>`, `skins.everywhere:<id>|off`, `skins.favourite:<id>[:on|off]`, `skins.duplicate:<id>`, `skins.delete:<id>`, `skins.export:<id>`, `skins.import`.
- Deep links: `console_open` screen `skins`, dialog `axf.skin.editor` (arg id), dialog `axf.skin.import`.

## Tests
- `framework/spec/check-skin-library.mts`: 61 checks, new, added to CI (`.github/workflows/android.yml`).
- `theme-manager/test.py`: 55 checks (20 new).
- `check-skin.mts` 356, `check-hub-look.mts` 110, `check-customize.mts` 163, `check-design-package.mts` 1158.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `check-skin-coverage`, `axf validate --framework`, plugin-lifecycle, and console tsc all pass.
- Live check in headless Chromium with `AXF_APPEARANCE_HUB=off`: browser, editor and Appearance on desktop and phone. Preview turns the whole app into the Windows skin. The editor draft shows on the app.

## Choices and gaps
- **No background asset type** in the registry: the background comes from the colour theme, and the editor says so. A wallpaper slot would need a new asset type, which is a Fable step.
- **Banner Skins context menu** is another build (`banner-skins-context-menu-item-with-sub-menu-of-all-skins-widget-hidden`), not on main yet. Its items can call `skins.browse` / `skins.edit:<id>`.
- **Kotlin twin deferred**, recorded in `framework/spec/PORTING.md`.
- **Any preview, not just this build's, ends when a look change is saved**, for example the day/night colour switch (`changeLook` clears it). The editor re-applies its draft when that happens. The browser's Preview does not, which is the same as Settings' skin picker.
- **Plugin disable**: no unregister hook exists for web services, so a disabled theme-manager stays the skin store until reload.
