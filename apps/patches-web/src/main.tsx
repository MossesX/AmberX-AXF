import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider, HubAppearanceSource } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';
import { App } from './App';
import './axf/ui/axf.css';
import './patches.css';

// Every JSON file under src/assets is registered as a hot-swappable asset.
const assetModules = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });

const axf = createAxf({
  manifest: manifest as AxfManifest,
  assets: Object.values(assetModules),
});
registerActions(axf);
// Developer app (manifest `developer: { hub }`): its look and settings come from axHub's data server, shared with the
// Console, Pilot and the phone apps; it waits for the hub instead of running without it.
const developer = (manifest as AxfManifest).developer;
// VITE_AXF_HUB overrides the hub for local development (`off` = no hub: the look stays local).
const hub = (import.meta.env.VITE_AXF_HUB as string | undefined) ?? developer?.hub;
if (hub && hub !== 'off') axf.attachAppearanceSource(new HubAppearanceSource({ hub, appId: manifest.app.id }));

if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
