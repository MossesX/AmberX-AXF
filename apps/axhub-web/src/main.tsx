import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider, HubAppearanceSource } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';
import { App } from './App';
import './axf/ui/axf.css';

// Every JSON file under src/assets is registered as a hot-swappable asset.
const assetModules = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });

const axf = createAxf({
  manifest: manifest as AxfManifest,
  assets: Object.values(assetModules),
});
registerActions(axf);

// Developer app (manifest `developer: { hub }`, `axf init --developer`): its look and settings come from axHub's data
// server; it waits for the hub instead of running without it. Ordinary apps have no `developer` and skip this.
if (manifest.developer?.hub) axf.attachAppearanceSource(new HubAppearanceSource({ hub: manifest.developer.hub, appId: manifest.app.id }));

if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
