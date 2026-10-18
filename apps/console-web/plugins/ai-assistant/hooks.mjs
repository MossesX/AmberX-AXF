/** Lifecycle hooks (plugin-lifecycle@1) for the AI assistant. Everything stays inside ctx.dataDir. */
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function onInstall(ctx) {
  mkdirSync(join(ctx.dataDir, 'conversations'), { recursive: true, mode: 0o700 });
  const cfg = join(ctx.dataDir, 'config.json');
  if (!existsSync(cfg)) {
    // The server fills in every default on first read; this marks the install and keeps the file private from the start.
    writeFileSync(cfg, JSON.stringify({ $axf: 'ai-assistant-config@1', setupComplete: false, profiles: {} }, null, 2));
    chmodSync(cfg, 0o600);
    ctx.log('seeded config.json (run the setup wizard in Settings → AI assistant)');
  } else ctx.log('kept the existing config.json');
}

export async function onUninstall(ctx) {
  ctx.log('removing settings, provider profiles (stored keys included), conversations and usage');
}

export async function checks(ctx) {
  const out = [];
  out.push({ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir });
  const envKeys = (ctx.manifest?.lifecycle?.env ?? []).filter((k) => k.endsWith('_KEY') || k.endsWith('_TOKEN'));
  const present = envKeys.filter((k) => process.env[k]);
  out.push({ id: 'provider-keys-in-env', ok: true, detail: present.length ? present.join(', ') : 'none (add keys in the wizard instead)' });
  const cli = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' });
  out.push({ id: 'claude-cli', ok: true, detail: cli.status === 0 ? 'installed (Claude Code subscription provider available)' : 'not installed (subscription provider unavailable)' });
  return out;
}
