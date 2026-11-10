import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider, HubAppearanceSource, DEFAULT_HUB } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';
import { installLookChoices } from './molly/look';
import { installStatusSources } from './molly/status';
import { followMollyLink } from './molly/links';
import { App } from './App';
import { deepLink } from './molly/apps';
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
registerActions(axf);
// the menu's Appearance choices and Status rows (flagship skin s8)
installLookChoices(axf);
installStatusSources(axf);
window.addEventListener('hashchange', () => { const l = deepLink(window.location.hash); if (l) axf.navigate(l.app.id); else followMollyLink(axf, window.location.hash); });

// The look comes from axHub only (Brett, Nov 1 2026): Molly reads and writes the one shared look on axHub's data server.
axf.attachAppearanceSource(new HubAppearanceSource({ hub: manifest.developer?.hub ?? DEFAULT_HUB, appId: manifest.app.id }));

// a menu / skin / setting link (molly/links.ts) runs once the shell is on screen
if (!link && window.location.hash) setTimeout(() => followMollyLink(axf, window.location.hash), 400);

if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
