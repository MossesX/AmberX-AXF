/**
 * Lifecycle hooks (plugin-lifecycle@1) for the Hub plugin. Everything the plugin writes stays inside ctx.dataDir:
 * pass requests waiting for Brett's click (requests.jsonl), the relayed actions log (actions.jsonl) and the one-shot
 * settings migration report (settings-migration.json, written by framework/cli/hub-settings-migrate.mjs, step 24).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHubConsole } from '../../../../framework/core/hub-console.mjs';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const TABLE = join(ROOT, 'framework/schemas/hub-console.json');

export async function onInstall(ctx) {
  ctx.log(`ready: ${ctx.dataDir} (route table ${TABLE})`);
  // axHub web's saved settings → the console's hub-console settings, once (hub-settings-migration@1, framework/cli/hub-settings-migrate.mjs):
  // a plan first (nothing written), then apply when the hub's settings documents are in reach; the report lands in ctx.dataDir.
  const cli = join(ROOT, 'framework/cli/hub-settings-migrate.mjs');
  const report = join(ctx.dataDir, 'settings-migration.json');
  const run = (args) => { const r = spawnSync(process.execPath, [cli, ...args, '--report', report, '--json'], { encoding: 'utf8' }); try { return JSON.parse(r.stdout.trim().split('\n').pop() || '{}'); } catch { return { ok: false, error: (r.stderr || r.stdout || '').trim().slice(0, 300) }; } };
  const plan = run(['plan']);
  if (!plan.ok) { ctx.log(`settings migration: could not plan (${plan.error || 'unknown'}); run framework/cli/hub-settings-migrate.mjs by hand`); return; }
  if (!plan.sourceFound) { ctx.log('settings migration: no axHub web settings document in reach; nothing to migrate'); return; }
  const c = plan.counts || {};
  if (plan.reportExists) { ctx.log(`settings migration: already applied (report ${report})`); return; }
  if ((c.move || 0) + (c.review || 0) === 0) { ctx.log(`settings migration: nothing to move (${c.skip || 0} skipped, ${c.keep || 0} kept)`); return; }
  const applied = run(['apply']);
  ctx.log(applied.ok ? `settings migration: ${(applied.counts?.move || 0) + (applied.counts?.review || 0)} key(s) moved, report ${report}` : `settings migration: apply failed (${applied.error || 'unknown'})`);
}
export async function onUninstall(ctx) { ctx.log('removing the Hub plugin data; the hub itself keeps its approvals, passes, users and services'); }
export async function checks(ctx) {
  const table = existsSync(TABLE) ? validateHubConsole(JSON.parse(readFileSync(TABLE, 'utf8'))) : { ok: false, errors: [{ message: 'missing' }] };
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'route-table', ok: table.ok, detail: table.ok ? TABLE : table.errors.map((e) => e.message).join('; ') },
  ];
}
