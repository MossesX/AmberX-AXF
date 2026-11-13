/** Lifecycle hooks (plugin-lifecycle@1) for the GitHub client. Everything it writes stays inside ctx.dataDir. */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  for (const d of ['jobs', 'imports', 'work']) mkdirSync(join(ctx.dataDir, d), { recursive: true });
  ctx.log('ready: Builds → GitHub client (needs GITHUB_TOKEN on the console server; the GitHub App keeper sets it)');
}
export async function onUninstall(ctx) { ctx.log('removing settings, batches, jobs, scratch clones and the git log; nothing on GitHub changes'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
