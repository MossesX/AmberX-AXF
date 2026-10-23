/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes stays in ctx.dataDir (+ the published kit). */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { claudeSettings, hooks } from './handoff.mjs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }

/** Takes this machine's SessionStart collect hook out of ~/.claude/settings.json (only our entry). */
export async function onUninstall(ctx) {
  try { ctx.log(`Claude Code hook: ${hooks('remove', claudeSettings())}`); } catch (e) { ctx.log(`Claude Code hook left alone: ${e.message}`); }
}

export async function checks(ctx) {
  const kit = join(ctx.root ?? process.cwd(), '_claude/handoff/handoff.json');
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'kit', ok: existsSync(kit), detail: existsSync(kit) ? 'handoff kit published' : 'no handoff kit yet: Tools → Claude handoff → Publish' },
  ];
}
