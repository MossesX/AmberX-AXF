/** Lifecycle hooks (plugin-lifecycle@1) for the Systems check. Everything stays inside ctx.dataDir. */
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function onInstall(ctx) {
  mkdirSync(join(ctx.dataDir, 'whatsnew'), { recursive: true, mode: 0o700 });
  const f = join(ctx.dataDir, 'settings.json');
  if (!existsSync(f)) {
    writeFileSync(f, JSON.stringify({ $axf: 'systems-check-settings@1', ai: { systems: false, whatsnew: false }, whatsNewBanner: true }, null, 2));
    chmodSync(f, 0o600);
    ctx.log('seeded settings.json (AI off; turn it on in Settings → Plugins → Systems check once the AI assistant and Mosses are installed)');
  } else ctx.log('kept the existing settings.json');
}

export async function onUninstall(ctx) {
  ctx.log('removing settings, the saved AI routine and What’s-new summaries; the console credentials stay (they belong to the core)');
}

export async function checks(ctx) {
  const git = spawnSync('git', ['-C', ctx.root ?? '.', 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'git-clone', ok: git.status === 0, detail: git.status === 0 ? `What’s new reads commits (at ${git.stdout.trim()})` : 'not a git clone: What’s new has nothing to compare' },
  ];
}
