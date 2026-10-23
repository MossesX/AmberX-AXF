import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider, HubAppearanceSource } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';
import { App } from './App';
import { initStore } from './studio/store';
import './axf/ui/axf.css';

// Every JSON file under src/assets is registered as a hot-swappable asset.
const assetModules = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });

// Developer app (manifest `developer: { hub }`): look + settings from axHub's data server. `VITE_AXF_HUB` overrides the
// address for local work; `VITE_AXF_HUB=off` runs on this device's settings only (local dev and screenshots).
const envHub = (import.meta.env.VITE_AXF_HUB as string | undefined)?.trim();
const hub = envHub === 'off' ? '' : envHub || manifest.developer?.hub || '';
initStore(hub || manifest.developer?.hub || '');

const axf = createAxf({
  manifest: manifest as AxfManifest,
  assets: Object.values(assetModules),
});
registerActions(axf);

// It waits for the hub instead of running without it.
if (hub) axf.attachAppearanceSource(new HubAppearanceSource({ hub, appId: manifest.app.id }));

if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
