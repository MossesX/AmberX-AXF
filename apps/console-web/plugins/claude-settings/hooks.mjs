/**
 * Lifecycle hooks (plugin-lifecycle@1). The settings document lives on axHub (shared by every project and session), not
 * in the data folder, so uninstalling leaves it there (plugin.json → lifecycle.keeps). The data folder holds only the
 * audit log (and the settings document when /projects isn't mounted).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log('Claude settings: every Claude session reads them with claude_settings_get (or claude-settings.mjs get)'); }
export async function onUninstall(ctx) { ctx.log('Claude settings view removed; the settings document stays on axHub (/projects/_shared/_data/claude/settings.json)'); }
export async function checks() {
  return [
    { id: 'registry', ok: existsSync(join(HERE, 'registry.json')), detail: 'registry.json' },
    { id: 'cli', ok: existsSync(join(HERE, 'claude-settings.mjs')), detail: 'claude-settings.mjs' },
    { id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' },
  ];
}
