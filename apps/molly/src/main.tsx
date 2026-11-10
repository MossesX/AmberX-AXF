import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider, HubAppearanceSource, DEFAULT_HUB } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';
import { App } from './App';
import { deepLink } from './molly/apps';
import { attachMollyCredentials } from './molly/host';
import './axf/ui/axf.css';
import './molly/molly.css';

// Hot-swappable assets, in order (framework/cli/shared-assets.mjs): every shareable asset baked at src/axf/assets, then
// Molly's own (its menus and toolbar), then the few shared ids it tunes (src/assets-overrides).
const sharedAssets = import.meta.glob('./axf/assets/**/*.json', { eager: true, import: 'default' });
const ownAssets = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });
const overrideAssets = import.meta.glob('./assets-overrides/**/*.json', { eager: true, import: 'default' });

// A deep link (#/<app>/<route>) opens straight on that app.
const link = deepLink(window.location.hash);
const axf = createAxf({
  manifest: (link ? { ...manifest, startView: link.app.id } : manifest) as AxfManifest,
  assets: Object.values({ ...sharedAssets, ...ownAssets, ...overrideAssets }),
});
// One sign-in reaches every app backend (molly-sign-in-once): the credential seam reads its API-base overrides from
// Molly's settings and keeps each app's token in this browser; native screens call through molly/host.ts.
attachMollyCredentials({ settings: { get: (k) => axf.settings.get(k), onChange: (k, fn) => axf.settings.onChange(k, fn) } });
registerActions(axf);
window.addEventListener('hashchange', () => { const l = deepLink(window.location.hash); if (l) axf.navigate(l.app.id); });

// The look comes from axHub only (Brett, Nov 1 2026): Molly reads and writes the one shared look on axHub's data server.
axf.attachAppearanceSource(new HubAppearanceSource({ hub: manifest.developer?.hub ?? DEFAULT_HUB, appId: manifest.app.id }));

if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
