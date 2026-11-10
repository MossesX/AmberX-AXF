import { createAxf, type AxfManifest, type AxfRuntime } from './axf/core';
import manifest from '../axf.manifest.json';
import { registerActions } from './actions';

/**
 * The console's runtime, shared by its own page (main.tsx) and its native surface (surface.tsx, mounted by a shell
 * such as Molly). Hot-swappable assets, in order (framework/cli/shared-assets.mjs): every shareable asset, baked from
 * the framework at src/axf/assets (every app ships them all, so the one look on axHub resolves everywhere); then this
 * app's own (its menus, toolbar, help, access policy); then the few shared ids this app tunes for itself
 * (src/assets-overrides).
 */
const sharedAssets = import.meta.glob('./axf/assets/**/*.json', { eager: true, import: 'default' });
const ownAssets = import.meta.glob('./assets/**/*.json', { eager: true, import: 'default' });
const overrideAssets = import.meta.glob('./assets-overrides/**/*.json', { eager: true, import: 'default' });

export function createConsoleRuntime(): AxfRuntime {
  const assetModules = { ...sharedAssets, ...ownAssets, ...overrideAssets };
  const axf = createAxf({ manifest: manifest as AxfManifest, assets: Object.values(assetModules) });
  registerActions(axf);
  if (axf.loadErrors.length) console.warn('[axf] assets skipped:', axf.loadErrors);
  return axf;
}
