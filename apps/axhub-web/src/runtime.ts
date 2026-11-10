import { createAxf, type AxfManifest, type AxfRuntime } from './axf/core';
import { HubAppearanceSource, DEFAULT_HUB } from './axf/react';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';

/**
 * axHub web's runtime, shared by its own page (main.tsx) and its native surface (surface.tsx, mounted by a shell such as
 * Molly). Hot-swappable assets, in order (framework/cli/shared-assets.mjs): every shareable asset, baked from the
 * framework at src/axf/assets; then this app's own (its menus, toolbar, help, access policy); then the few shared ids
 * this app tunes for itself (src/assets-overrides).
 */
const sharedAssets = import.meta.glob('./axf/assets/**/*.json', { eager: true, import: 'default' });
const ownAssets = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });
const overrideAssets = import.meta.glob('./assets-overrides/**/*.json', { eager: true, import: 'default' });

/** `look`: read the shared look from axHub (its own page). A hosted surface leaves the look to the shell. */
export function createHubWebRuntime({ look = true }: { look?: boolean } = {}): AxfRuntime {
  const axf = createAxf({ manifest: manifest as AxfManifest, assets: Object.values({ ...sharedAssets, ...ownAssets, ...overrideAssets }) });
  registerActions(axf);
  // The look comes from axHub only (Brett, Nov 1 2026): this app always reads and writes the shared look on axHub's data
  // server (manifest `developer.hub`, else the default hub) and waits for the hub instead of running without it.
  if (look) axf.attachAppearanceSource(new HubAppearanceSource({ hub: manifest.developer?.hub ?? DEFAULT_HUB, appId: manifest.app.id }));
  if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);
  return axf;
}
