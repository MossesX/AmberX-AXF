/** Lifecycle hooks (plugin-lifecycle@1). The index lives in ctx.dataDir; the only file outside it is the published
 * ledger (conversation-ledger@1) that rules briefs read, removed on uninstall so briefs stop carrying it. */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function ledgerFile(root) {
  if (process.env.AXF_CONVERSATION_LEDGER_FILE) return process.env.AXF_CONVERSATION_LEDGER_FILE;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  return existsSync(projects) ? join(projects, '_shared', '_data', 'claude', 'conversation-ledger.json') : join(root, '.axf-console', 'conversation-ledger.json');
}

export async function onInstall(ctx) { mkdirSync(join(ctx.dataDir, 'imports'), { recursive: true }); ctx.log(`ready: ${ctx.dataDir} (drop claude.ai exports in imports/)`); }
export async function onUninstall(ctx) {
  const f = ledgerFile(ctx.root ?? process.cwd());
  if (existsSync(f)) { rmSync(f, { force: true }); ctx.log(`removed the published ledger ${f}`); }
}
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
