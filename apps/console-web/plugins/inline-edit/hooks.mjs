/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps the master switch, each user's dialog / list state and the
 * side ledger (which app a change was made in) in ctx.dataDir. The overrides themselves are axHub look settings
 * (`axf.inline.<root>`, inline-override@1) and stay when the plugin goes: reset them first from the overrides list or
 * `axf inline-edit overrides reset <id>` if they should go too.
 */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  ctx.log(`ready: ${ctx.dataDir} (master switch, dialog and list state, ledger)`);
}
export async function onUninstall(ctx) { ctx.log('removing the inline edit switch and list state (overrides in the axHub look stay: reset them from the overrides list first if they should go)'); }
export async function checks(ctx) {
  const { runOp, appearanceFile } = await import('./engine.mjs');
  const mode = runOp({ op: 'mode.get' });
  const list = runOp({ op: 'overrides.list', input: {} });
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'engine', ok: mode.ok === true, detail: mode.ok ? `inline edit mode ${mode.data.on ? 'on' : 'off'}` : mode.message },
    { id: 'look', ok: list.ok === true, detail: list.ok ? `${list.data.total} overrides in ${appearanceFile()}` : list.message },
  ];
}
