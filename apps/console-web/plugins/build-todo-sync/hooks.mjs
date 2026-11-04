/**
 * Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes lives in ctx.dataDir (links.json, asks.json,
 * state.json, settings.json, sync.log); the one thing outside it is its line in the builds-events subscribers file,
 * added on install and removed on uninstall (`framework/cli/builds-events.mjs`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSubscribers, subscribe, subscribersFile, unsubscribe } from '../../../../framework/cli/builds-events.mjs';

export const FOLDER = 'build-todo-sync';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The console's public URL for the event subscription (AXF_CONSOLE_URL, else the console's panel settings, else the default). */
export function consoleUrl(env = process.env) {
  if (env.AXF_CONSOLE_URL) return env.AXF_CONSOLE_URL.replace(/\/+$/, '');
  try { const j = JSON.parse(readFileSync(join(ROOT, '.axf-console', 'panel.json'), 'utf8')); if (typeof j?.consoleUrl === 'string' && /^https?:\/\//.test(j.consoleUrl)) return j.consoleUrl.replace(/\/+$/, ''); } catch { /* none */ }
  return 'https://console.amberxai.com';
}

/** The console token the subscription posts with: AXF_TOKEN, else the AXF_TOKEN line of .axf-console/env. */
export function consoleToken(env = process.env) {
  if (env.AXF_TOKEN) return env.AXF_TOKEN;
  try { const m = /^AXF_TOKEN=(.+)$/m.exec(readFileSync(join(ROOT, '.axf-console', 'env'), 'utf8')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; } catch { return ''; }
}

export async function onInstall(ctx) {
  const url = `${consoleUrl()}/api/plugins/${FOLDER}/events`;
  const token = consoleToken();
  subscribe({ id: FOLDER, url, token, tokenEnv: token ? '' : 'AXF_TOKEN' });
  ctx.log(`ready: ${ctx.dataDir}; store events → ${url}${token ? '' : ' (no console token found: set AXF_TOKEN where builds are written)'} (${subscribersFile()})`);
}

export async function onUninstall(ctx) {
  unsubscribe(FOLDER);
  ctx.log(`unsubscribed from builds store events (${subscribersFile()}); the to-do lists stay, their sync note says they stopped syncing`);
}

export async function checks(ctx) {
  const sub = readSubscribers().find((s) => s.id === FOLDER);
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'store-events', ok: !!sub, detail: sub ? sub.url : `not in ${subscribersFile()} (run install.mjs; the plugin still reconciles on its timer)` },
  ];
}
