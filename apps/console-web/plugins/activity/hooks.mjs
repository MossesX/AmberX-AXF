/** Lifecycle hooks (plugin-lifecycle@1). Data: reports/ + config.json in the data folder. */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hooksInstalled, removeHooks } from './activity.mjs';

const claudeSettings = () => join(homedir(), '.claude', 'settings.json');

export async function onInstall(ctx) {
  mkdirSync(join(ctx.dataDir, 'reports'), { recursive: true, mode: 0o700 });
  ctx.log(`ready: ${ctx.dataDir}. For Claude Code sessions on the VPS: node apps/console-web/plugins/activity/activity.mjs hooks install`);
}
export async function onUninstall(ctx) {
  // Its Claude Code hooks point at this folder: take them out of this machine's ~/.claude/settings.json (backup .bak).
  if (removeHooks(claudeSettings())) ctx.log(`removed its Claude Code hooks from ${claudeSettings()}`);
}
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'claude-hooks', ok: true, detail: hooksInstalled(claudeSettings()) ? 'Claude Code hooks installed on this machine' : 'Claude Code hooks not installed on this machine (optional)' },
  ];
}
