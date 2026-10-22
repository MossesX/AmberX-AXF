/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin's private data folder holds nothing yet (the log is shared data, see
 * below); this machine's queue and pointers live in ~/.axf-changes (AXF_CHANGES_HOME).
 *
 * Uninstall removes its Claude Code hooks from this machine's ~/.claude/settings.json (backup .bak) and its pointers
 * folder when nothing is waiting in the queue. It never deletes the permanent log (changes/ in the shared data folder:
 * /projects/amberx-axf/_data/changes on axHub, and the repo's changes/ snapshot), not even with --all.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { claudeSettings, homeDir, hooksInstalled, removeHooks } from './changes.mjs';

const queued = () => { const q = join(homeDir(), 'queue'); if (!existsSync(q)) return 0; let n = 0; const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { if (f.isDirectory()) walk(join(d, f.name)); else if (f.name.endsWith('.json')) n++; } }; walk(q); return n; };

export async function onInstall(ctx) {
  ctx.log(`ready: ${ctx.dataDir}. For Claude Code sessions on this machine: node apps/console-web/plugins/codebase-changes/changes.mjs hooks install`);
}
export async function onUninstall(ctx) {
  if (removeHooks(claudeSettings())) ctx.log(`removed its Claude Code hooks from ${claudeSettings()}`);
  const n = queued();
  if (n) ctx.log(`kept ${homeDir()}: ${n} entr${n === 1 ? 'y' : 'ies'} still waiting in the local queue (send them with changes.mjs flush before removing it)`);
  else if (existsSync(homeDir())) { rmSync(homeDir(), { recursive: true, force: true }); ctx.log(`removed ${homeDir()} (pointers only, nothing queued)`); }
  ctx.log('the permanent log (changes/ in the shared data folder on axHub) is kept: it is Brett\'s record');
}
export async function checks(ctx) {
  const n = queued();
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'claude-hooks', ok: true, detail: hooksInstalled(claudeSettings()) ? 'Claude Code hooks installed on this machine' : 'Claude Code hooks not installed on this machine (run changes.mjs hooks install)' },
    { id: 'queue', ok: n === 0, detail: n ? `${n} entr${n === 1 ? 'y' : 'ies'} waiting in ${join(homeDir(), 'queue')}: run changes.mjs flush` : 'nothing queued on this machine' },
  ];
}
