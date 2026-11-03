/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps only the confirm-token salt in ctx.dataDir; the open consoles,
 * their catalogs and the recent commands live in the console server's memory and go with it.
 */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  const { confirmSalt } = await import('./console.mjs');
  confirmSalt();
  ctx.log(`ready: ${ctx.dataDir} (confirm salt)`);
}
export async function onUninstall(ctx) { ctx.log('removing the Console commands confirm salt'); }
export async function checks(ctx) {
  const { controlRegistry } = await import('../../../../framework/core/engines/control-rules.mjs');
  const { CONSOLE_TOOLS } = await import('../../../../framework/core/engines/console-commands.mjs');
  const reg = controlRegistry();
  const targets = Object.keys(reg.targets).filter((t) => t.startsWith('console.'));
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'contract', ok: targets.length === 6, detail: `${targets.length} console targets: ${targets.join(', ')}` },
    { id: 'mcp-tools', ok: CONSOLE_TOOLS.length === 8, detail: CONSOLE_TOOLS.join(', ') },
  ];
}
