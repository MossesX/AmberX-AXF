/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes on the console is in ctx.dataDir: chats.db (the
 * store), settings.json, tts-keys.json (0600) and tts/ (the Piper venv + voices). Audio exports and the drop folder
 * live on the hub and are never removed here. */
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  try { chmodSync(ctx.dataDir, 0o700); } catch { /* not ours to fix */ }
  ctx.log('ready: Plugins → Chat viewer (Set up free voices once for audio export)');
}
export async function onUninstall(ctx) { ctx.log('removing the chat store, settings, keys and the Piper venv (hub audio files stay)'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'store', ok: true, detail: existsSync(join(ctx.dataDir, 'chats.db')) ? 'chats.db present' : 'chats.db is made on the first check for updates' },
  ];
}
