import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider, devServerUrl, useDevServer } from './axf/react';
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

if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);

// Live reload: open the demo with ?axfDev=http://<pc-ip>:7070 (or ?axfDev=1) while `axf dev apps/demo` runs.
const devUrl = devServerUrl(location.search);
function DevReload() { useDevServer(devUrl); return null; }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      {devUrl && <DevReload />}
      <App />
    </AxfProvider>
  </StrictMode>,
);
