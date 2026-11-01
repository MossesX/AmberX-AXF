import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';
import { App } from './App';
import './axf/ui/axf.css';
import './console.css';

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

// One-time move to the new default toolbar for browsers that saved their choices before saves recorded the
// app's defaults (newer saves carry them, and the runtime adopts a changed default by itself).
try {
  const raw = localStorage.getItem(`axf:${manifest.app.id}`);
  const saved = raw ? (JSON.parse(raw) as { active?: { toolbar?: string }; defaults?: unknown }) : null;
  if (saved && !saved.defaults && saved.active?.toolbar === 'standard-icons') axf.swapAll({ toolbar: manifest.defaults.toolbar });
} catch { /* storage unavailable */ }

if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
