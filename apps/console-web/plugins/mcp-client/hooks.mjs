/**
 * Lifecycle hooks (plugin-lifecycle@1) for the MCP client plugin. Data lives in ctx.dataDir (mcp-servers.json, 0600).
 * onInstall moves the pre-lifecycle file `.axf-console/mcp-servers.json` (Opus build, Oct 18 2026) into the data folder once.
 */
import { chmodSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  const legacy = join(ctx.root, '.axf-console/mcp-servers.json');
  const target = join(ctx.dataDir, 'mcp-servers.json');
  if (existsSync(legacy) && !existsSync(target)) { renameSync(legacy, target); chmodSync(target, 0o600); ctx.log('moved .axf-console/mcp-servers.json into the plugin data folder'); }
  ctx.log(`ready: servers in ${ctx.dataDir}/mcp-servers.json (AXF_MCP_SERVERS overrides)`);
}
export async function onUninstall(ctx) { ctx.log('removing the MCP server records (tokens stored server-side go with them)'); }
export async function checks(ctx) {
  const file = process.env.AXF_MCP_SERVERS || join(ctx.dataDir, 'mcp-servers.json');
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'servers-file', ok: true, detail: existsSync(file) ? `${file} present` : `${file} not created yet (no servers)` },
  ];
}
