/** Lifecycle hooks (plugin-lifecycle@1). The plugin writes only overrides.json and changes.jsonl, both in ctx.dataDir. */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) { mkdirSync(ctx.dataDir, { recursive: true, mode: 0o700 }); ctx.log(`ready: ${ctx.dataDir} (overrides + change log)`); }
export async function onUninstall(ctx) { ctx.log('removing the UI Manager overrides and change log (the assets and skins they pointed at are untouched)'); }
export async function checks(ctx) {
  const { world } = await import('./lib/core.mjs');
  const w = world({ fresh: true });
  const tokenSets = Object.values(w.catalog.paths).filter((p) => p.length).length;
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'catalog', ok: Object.keys(w.catalog.assets).length >= 20 && tokenSets >= 6, detail: `${Object.keys(w.catalog.assets).length} asset types with assets, ${tokenSets} token sets` },
    { id: 'elements', ok: w.elements.length >= 30, detail: `${w.elements.length} selectable elements` },
  ];
}
