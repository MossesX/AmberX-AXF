/** Lifecycle hooks (plugin-lifecycle@1). Every file the plugin writes is inside ctx.dataDir (the SQLite ledger). */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  process.env.AXF_SHIPPED_FEATURES_DIR ||= ctx.dataDir;
  const db = await import('./ledger/db.mjs');
  const r = db.migrateDb(db.openDb(join(ctx.dataDir, 'ledger.sqlite')));
  ctx.log(`ledger ready (schema ${r.to}): ${ctx.dataDir}`);
}
export async function onUninstall(ctx) { ctx.log('removing the Shipped features ledger'); }
export async function checks(ctx) {
  const f = join(ctx.dataDir, 'ledger.sqlite');
  return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }, { id: 'ledger', ok: existsSync(f), detail: f }];
}
