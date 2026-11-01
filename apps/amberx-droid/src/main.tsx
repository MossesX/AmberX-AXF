// First: Mic off guards getUserMedia and SpeechRecognition before any module captures them (micguard.ts).
import './micguard';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider, HubAppearanceSource, DEFAULT_HUB } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';
import { App } from './App';
import { HUB } from './hub/useHub';
import { installVetoHost, routeHubFetch } from './native';
import './axf/ui/axf.css';

// Inside the Android shell, hub reads go through the native side (the hub session lives in Android's cookie store).
routeHubFetch(HUB);
// The veto banner plugin's phone side: Deny / Approve / Shelve with the phone's session, the alarm, notification taps.
installVetoHost();

// Hot-swappable assets, in order (framework/cli/shared-assets.mjs): every shareable asset, baked from the framework at
// src/axf/assets (every app ships them all, so the one look on axHub resolves everywhere); then this app's own (its
// menus, toolbar, help, access policy); then the few shared ids this app tunes for itself (src/assets-overrides).
const sharedAssets = import.meta.glob('./axf/assets/**/*.json', { eager: true, import: 'default' });
const ownAssets = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });
const overrideAssets = import.meta.glob('./assets-overrides/**/*.json', { eager: true, import: 'default' });
const assetModules = { ...sharedAssets, ...ownAssets, ...overrideAssets };

const axf = createAxf({
  manifest: manifest as AxfManifest,
  assets: Object.values(assetModules),
});
registerActions(axf);

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
