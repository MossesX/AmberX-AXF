# {{APP_NAME}}

Initialized by the **AmberX AXF {{FRAMEWORK_VERSION}}** build engine (`react-ts` template).

```bash
npm install
npm run dev          # local dev server
npm run build        # typecheck + production build -> dist/
npm run build:single # one self-contained index.html -> dist-single/
```

## Structure

| Path | Purpose |
| --- | --- |
| `axf.manifest.json` | App identity, framework version, default asset per slot |
| `axf.lock.json` | Hashes of baked framework files (conformance) |
| `src/axf/` | Baked framework runtime — engines, React layer, base CSS, libraries. Don't edit; re-bake instead |
| `src/axf/libs/settings` | The settings interface every app ships (`app.settings`, nav item **Settings**): Appearance, Account & security, Connections, **Plugins** (every installed library with its health), About. Plugins add groups/sub-tabs there, never their own settings screen |
| `src/assets/<type>/<id>.json` | Hot-swappable assets |
| `src/views/` | Your views (register them in `src/App.tsx`) |
| `src/actions.ts` | Handlers for the standard action vocabulary |
| `src/dialogs.tsx` | App dialogs |

## Hot-swapping

Every JSON file under `src/assets` is registered at startup. Swap from the **Assets** view, the inspector,
menus, keyboard shortcuts (`Alt+C` / `Alt+S` / `Alt+L` / `Alt+R`), or programmatically:

```js
AXF.swap('color-theme', 'neon-tide');
AXF.swap('layout', 'next');
AXF.importAsset({ $axf: 'asset@1', type: 'button', id: 'my-button', ... });
```
