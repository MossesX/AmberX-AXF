/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps only its audit log and the confirm-token salt in ctx.dataDir;
 * token overrides live in the axHub look and AmberX / planner records in their own stores, so uninstall leaves them.
 */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  const { confirmSalt } = await import('./lib/common.mjs');
  confirmSalt();
  ctx.log(`ready: ${ctx.dataDir} (audit log + confirm salt)`);
}
export async function onUninstall(ctx) { ctx.log('removing the Token control audit log and confirm salt (token overrides in the axHub look stay: reset them with axf token <set> reset)'); }
export async function checks(ctx) {
  const { controlRegistry } = await import('../../../../framework/core/engines/control-rules.mjs');
  const { appearanceFile } = await import('./lib/tokens.mjs');
  const { notesDir } = await import('./lib/amberx.mjs');
  const { providerDir } = await import('./lib/providers.mjs');
  const reg = controlRegistry();
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'contract', ok: Object.keys(reg.targets).length >= 13 && reg.tools.length === 7, detail: `${Object.keys(reg.targets).length} targets, ${reg.tools.length} tools` },
    { id: 'look', ok: true, detail: appearanceFile() },
    { id: 'amberx', ok: true, detail: notesDir() },
    { id: 'plans@1', ok: !!providerDir('plans@1'), detail: providerDir('plans@1') ?? 'no provider: planner.plans answers not_implemented' },
    { id: 'orchestrator@1', ok: !!providerDir('orchestrator@1'), detail: providerDir('orchestrator@1') ?? 'no provider: planner.builds answers not_implemented' },
  ];
}
