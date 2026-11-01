import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider, HubAppearanceSource, DEFAULT_HUB } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';
import { App } from './App';
import { installRouter } from './hub/route';
import './hub.css';
import './axf/ui/axf.css';

// Every JSON file under src/assets is registered as a hot-swappable asset.
const assetModules = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });

const axf = createAxf({
  manifest: manifest as AxfManifest,
  assets: Object.values(assetModules),
});
registerActions(axf);
// The address bar follows the page (the hub sends its old links here as #/<route>).
installRouter(axf);

// The look comes from axHub only (Brett, Nov 1 2026): this app always reads and writes the shared look on axHub's data
// server (manifest `developer.hub`, else the default hub) and waits for the hub instead of running without it.
axf.attachAppearanceSource(new HubAppearanceSource({ hub: manifest.developer?.hub ?? DEFAULT_HUB, appId: manifest.app.id }));

if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
