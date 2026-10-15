# {{APP_NAME}}

Initialized by the **Frame {{FRAMEWORK_VERSION}}** build engine (`react-ts` template).

```bash
npm install
npm run dev          # local dev server
npm run build        # typecheck + production build -> dist/
npm run build:single # one self-contained index.html -> dist-single/
```

## Structure

| Path | Purpose |
| --- | --- |
| `frame.manifest.json` | App identity, framework version, default asset per slot |
| `frame.lock.json` | Hashes of baked framework files (conformance) |
| `src/frame/` | Baked framework runtime — engines, React layer, base CSS. Don't edit; re-bake instead |
| `src/assets/<type>/<id>.json` | Hot-swappable assets |
| `src/views/` | Your views (register them in `src/App.tsx`) |
| `src/actions.ts` | Handlers for the standard action vocabulary |
| `src/dialogs.tsx` | App dialogs |

## Hot-swapping

Every JSON file under `src/assets` is registered at startup. Swap from the **Assets** view, the inspector,
menus, keyboard shortcuts (`Alt+C` / `Alt+S` / `Alt+L` / `Alt+R`), or programmatically:

```js
Frame.swap('color-theme', 'neon-tide');
Frame.swap('layout', 'next');
Frame.importAsset({ $frame: 'asset@1', type: 'button', id: 'my-button', ... });
```
