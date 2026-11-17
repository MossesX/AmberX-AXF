/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps no data of its own (ctx.dataDir holds nothing durable): the
 * console's data is on axf-data, the mode document in <data>/data-store/mode.json belongs to the data layer, not to this
 * plugin, so an uninstall leaves both alone.
 */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) { mkdirSync(ctx.dataDir, { recursive: true }); ctx.log(`ready: ${ctx.dataDir} (the data itself is on axf-data)`); }
export async function onUninstall(ctx) { ctx.log('the Data store screen goes; the data stays on axf-data and the mode document stays in place'); }
export async function checks(ctx) {
  const url = process.env.AXF_DATA_URL || '';
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'axf-data', ok: true, detail: url ? `axf-data at ${url}` : 'AXF_DATA_URL unset: run deploy/install-data.sh, then re-install the console (the screen shows "not connected")' },
  ];
}
