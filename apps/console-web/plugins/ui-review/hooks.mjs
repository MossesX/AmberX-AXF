/** Lifecycle hooks (plugin-lifecycle@1). Every file the plugin writes stays inside ctx.dataDir. */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * UI Review replaced the Design packs plugin (Oct 30 2026): its data folder (the picks) moves into this one once,
 * and its console-state entry goes. Packs and screenshots ship in packs/ in this folder.
 */
export function migrateOld(ctx, oldDir = join(dirname(ctx.dataDir), 'design-packs')) {
  if (!existsSync(oldDir)) return [];
  const moved = [];
  for (const n of readdirSync(oldDir)) { const to = join(ctx.dataDir, n); if (!existsSync(to)) { cpSync(join(oldDir, n), to, { recursive: true }); moved.push(n); } }
  writeFileSync(join(ctx.dataDir, 'migrated.json'), JSON.stringify({ from: oldDir, files: moved, at: new Date().toISOString() }));
  rmSync(oldDir, { recursive: true, force: true });
  const state = process.env.AXF_STATE || join(ctx.root, '.axf-console/state.json');
  try { const s = JSON.parse(readFileSync(state, 'utf8')); if (s.plugins && 'design-packs' in s.plugins) { delete s.plugins['design-packs']; writeFileSync(state, JSON.stringify(s, null, 2)); } } catch { /* no state yet */ }
  return moved;
}

export async function onInstall(ctx) {
  const moved = migrateOld(ctx);
  ctx.log(moved.length ? `moved the Design packs data in: ${moved.join(', ')}` : `ready: ${ctx.dataDir}`);
}
export async function onUninstall(ctx) { ctx.log('removing the review items, their screenshots and the design-pack picks'); }
export async function checks(ctx) {
  const ix = join(ctx.dir, 'packs/index.json');
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'kinds', ok: existsSync(join(ctx.dir, 'kinds.json')), detail: 'kinds.json (open registry of sections)' },
    { id: 'design-packs', ok: existsSync(ix), detail: existsSync(ix) ? `${JSON.parse(readFileSync(ix, 'utf8')).packs.length} packs` : 'packs/index.json missing' },
  ];
}
