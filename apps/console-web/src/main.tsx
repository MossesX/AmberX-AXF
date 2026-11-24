import { installFetchShare } from './fetchShare';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAxf, type AxfManifest } from './axf/core';
import { AxfProvider } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';
import { registerPluginSettingsActions } from './pluginSettingsActions';
import { App } from './App';
import { installPullRefresh } from './place/pullRefresh';
import './axf/ui/axf.css';
import './console.css';

// Hot-swappable assets, in order (framework/cli/shared-assets.mjs): every shareable asset, baked from the framework at
// src/axf/assets (every app ships them all, so the one look on axHub resolves everywhere); then this app's own (its
// menus, toolbar, help, access policy); then the few shared ids this app tunes for itself (src/assets-overrides).
// One shared read per source for every card, a quiet background tab and 5xx backoff (src/fetchShare.ts).
installFetchShare();

const sharedAssets = import.meta.glob('./axf/assets/**/*.json', { eager: true, import: 'default' });
const ownAssets = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });
const overrideAssets = import.meta.glob('./assets-overrides/**/*.json', { eager: true, import: 'default' });
// Plugin Home cards (card@1 at plugins/<folder>/assets/card/*.json; the VPS writes missing ones, build rule home-card).
const pluginCards = import.meta.glob(['../plugins/*/assets/card/*.json', '!../plugins/_*/**'], { eager: true, import: 'default' });
// Page toolbars (page-toolbar@1 at plugins/<folder>/assets/toolbar/*.json, scoped to the plugin's page; build
// rebuild-every-toolbar-page-specific): each plugin page draws its own through <PageToolbar>.
// UI Review options (tag ui-choice) are left out: an option is used only once it is picked (it joins the library through
// UI Review's choices/assets), so the page's own asset stays the one its scope picks.
const pluginToolbars = Object.fromEntries(Object.entries(import.meta.glob(['../plugins/*/assets/toolbar/*.json', '!../plugins/_*/**'], { eager: true, import: 'default' }))
  .filter(([, a]) => !((a as { tags?: string[] }).tags ?? []).includes('ui-choice')));
// Plugin settings interfaces (settings-iface@1, settings asset with data.builtFor = plugin:<folder>, at
// plugins/<folder>/assets/settings/*.json): each plugin's default-<folder> and any other interface built for it, so its
// Settings → Plugins tab can pick between them. UI Review options (ui-choice) are left out like toolbars.
const pluginSettings = Object.fromEntries(Object.entries(import.meta.glob(['../plugins/*/assets/settings/*.json', '!../plugins/_*/**'], { eager: true, import: 'default' }))
  .filter(([, a]) => !((a as { tags?: string[] }).tags ?? []).includes('ui-choice')));
const assetModules = { ...sharedAssets, ...ownAssets, ...pluginCards, ...pluginToolbars, ...pluginSettings, ...overrideAssets };

const axf = createAxf({
  manifest: manifest as AxfManifest,
  assets: Object.values(assetModules),
});
registerActions(axf);
registerPluginSettingsActions(axf);

// One-time move to the new default toolbar for browsers that saved their choices before saves recorded the
// app's defaults (newer saves carry them, and the runtime adopts a changed default by itself).
try {
  const raw = localStorage.getItem(`axf:${manifest.app.id}`);
  const saved = raw ? (JSON.parse(raw) as { active?: { toolbar?: string }; defaults?: unknown }) : null;
  if (saved && !saved.defaults && saved.active?.toolbar === 'standard-icons') axf.swapAll({ toolbar: manifest.defaults.toolbar });
} catch { /* storage unavailable */ }

if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);

// A pull-down refresh on the phone saves the place first, like every other reload (src/place/pullRefresh.ts).
installPullRefresh(axf);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AxfProvider runtime={axf}>
      <App />
    </AxfProvider>
  </StrictMode>,
);
