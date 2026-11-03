/**
 * Lifecycle hooks (plugin-lifecycle@1). ctx.dataDir keeps the confirm-token salt, the two MCP switches and the audit
 * log. The registry itself is made from the plugins' files every time, so nothing else is stored.
 */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  const { confirmSalt } = await import('./commands.mjs');
  confirmSalt();
  ctx.log(`ready: ${ctx.dataDir} (confirm salt)`);
}
export async function onUninstall(ctx) { ctx.log('removing the Plugin commands salt, switches and audit log'); }
export async function checks(ctx) {
  const { controlRegistry } = await import('../../../../framework/core/engines/control-rules.mjs');
  const { coverage } = await import('../../../../framework/cli/plugin-commands.mjs');
  const targets = Object.keys(controlRegistry().targets).filter((t) => t.startsWith('plugins.'));
  const cov = coverage();
  const bad = cov.filter((c) => !c.ok).map((c) => c.folder);
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'contract', ok: targets.length === 2, detail: `${targets.length} plugins targets: ${targets.join(', ')}` },
    { id: 'coverage', ok: bad.length === 0, detail: bad.length ? `not exposed: ${bad.join(', ')}` : `${cov.length} plugins expose every command and read` },
  ];
}
