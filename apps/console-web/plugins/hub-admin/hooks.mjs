/**
 * Lifecycle hooks (plugin-lifecycle@1) for the Hub plugin. Everything the plugin writes stays inside ctx.dataDir:
 * pass requests waiting for Brett's click (requests.jsonl), the relayed actions log (actions.jsonl) and the one-shot
 * settings migration report (settings-migration.json, written by framework/cli/hub-settings-migrate.mjs, step 24).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHubConsole } from '../../../../framework/core/hub-console.mjs';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const TABLE = join(ROOT, 'framework/schemas/hub-console.json');

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (route table ${TABLE})`); }
export async function onUninstall(ctx) { ctx.log('removing the Hub plugin data; the hub itself keeps its approvals, passes, users and services'); }
export async function checks(ctx) {
  const table = existsSync(TABLE) ? validateHubConsole(JSON.parse(readFileSync(TABLE, 'utf8'))) : { ok: false, errors: [{ message: 'missing' }] };
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'route-table', ok: table.ok, detail: table.ok ? TABLE : table.errors.map((e) => e.message).join('; ') },
  ];
}
