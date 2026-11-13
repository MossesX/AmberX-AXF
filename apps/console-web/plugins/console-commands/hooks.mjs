/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps only the confirm-token salt in ctx.dataDir; the open consoles,
 * their catalogs and the recent commands live in the console server's memory and go with it.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Console first (drive-live-console-first): what Brett sets on axHub so pages and approvals open here first. */
const HUB_STEPS = 'axHub is not sending pages and approvals here yet (the phone still gets them). In Coolify → axHub → Environment add AXHUB_CONSOLE_URL=https://console.amberxai.com and AXHUB_CONSOLE_TOKEN=<this console\'s AXF_TOKEN: Settings → Account → Console token>, redeploy axHub (needs axHub PR #44), then approve anything or ask Amber to open a page: this turns green once the hub has reached the console.';

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
    { id: 'mcp-tools', ...mcpTools(CONSOLE_TOOLS) },
    { id: 'axhub-console-first', ...hubSeen(ctx.dataDir) },
  ];
}

/** Every console tool the engine names is one the console's MCP server registers (apps/console-web/server/mcp_server.py). */
function mcpTools(names) {
  let server = '';
  try { server = readFileSync(new URL('../../server/mcp_server.py', import.meta.url), 'utf8'); } catch { return { ok: false, detail: 'apps/console-web/server/mcp_server.py is missing' }; }
  const missing = names.filter((n) => !new RegExp(`async def ${n}\\(`).test(server));
  return missing.length ? { ok: false, detail: `not registered by the console MCP: ${missing.join(', ')}` } : { ok: true, detail: names.join(', ') };
}

/** axHub reached this console (it writes hub-console-first.json when it sends a page or an approval). */
function hubSeen(dir) {
  try {
    const at = JSON.parse(readFileSync(join(dir, 'hub-console-first.json'), 'utf8')).at;
    return { ok: true, detail: `axHub opens pages and approvals here first (last reached ${at})` };
  } catch { return { ok: false, detail: HUB_STEPS }; }
}
