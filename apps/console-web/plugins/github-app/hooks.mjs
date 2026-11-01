/** Lifecycle hooks (plugin-lifecycle@1). The plugin keeps no files of its own; the app's credentials belong to the broker. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log('ready: Settings → Plugins → GitHub → Create GitHub App'); }
export async function onUninstall(ctx) { ctx.log('GitHub App credentials in .axf-console/github-app are kept (git and gh use them); forget them with: node framework/cli/github-token.mjs forget --all'); }
export async function checks(ctx) {
  return [{ id: 'broker', ok: existsSync(join(ctx.root, 'framework', 'cli', 'github-token.mjs')), detail: 'framework/cli/github-token.mjs' }];
}
