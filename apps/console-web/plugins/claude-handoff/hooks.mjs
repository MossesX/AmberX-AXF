/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes stays in ctx.dataDir (+ the published kit). */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { claudeSettings, hooks } from './handoff.mjs';
import * as files from '../../../../framework/core/data-files.mjs';

/** The plugin's rows on axf-data (data-store@1 namespace plugins/claude-handoff): one per record, one per machine. */
const ROWS = ['state.json', 'config.json', 'claude-ai.json', 'session.json', 'session.md', 'last-assembly.json'];
export function removeRows(dataDir) {
  let n = 0;
  for (const rel of [...ROWS, ...files.listSync(join(dataDir, 'machines')).map((f) => `machines/${f}`)]) {
    const p = join(dataDir, rel);
    if (!files.existsAnySync(p)) continue;
    files.removeSync(p); n += 1;
  }
  return n;
}

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }

/** Removes the plugin's rows from the data store, and this machine's SessionStart collect hook from ~/.claude/settings.json (only our entry). */
export async function onUninstall(ctx) {
  try { ctx.log(`data rows removed: ${removeRows(ctx.dataDir)}`); } catch (e) { ctx.log(`data rows left on axf-data: ${e.message}`); }
  try { ctx.log(`Claude Code hook: ${hooks('remove', claudeSettings())}`); } catch (e) { ctx.log(`Claude Code hook left alone: ${e.message}`); }
}

export async function checks(ctx) {
  const kit = join(ctx.root ?? process.cwd(), '_claude/handoff/handoff.json');
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'kit', ok: existsSync(kit), detail: existsSync(kit) ? 'handoff kit published' : 'no handoff kit yet: Tools → Claude handoff → Publish' },
  ];
}
