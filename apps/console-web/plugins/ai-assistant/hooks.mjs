/** Lifecycle hooks (plugin-lifecycle@1) for the AI assistant. Everything stays inside ctx.dataDir. */
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function onInstall(ctx) {
  for (const d of ['conversations', 'sessions']) mkdirSync(join(ctx.dataDir, d), { recursive: true, mode: 0o700 });
  const cfg = join(ctx.dataDir, 'config.json');
  if (!existsSync(cfg)) {
    // The server fills in every default on first read; this marks the install and keeps the file private from the start.
    writeFileSync(cfg, JSON.stringify({ $axf: 'ai-assistant-config@1', schema: 1, setupComplete: false, profiles: {} }, null, 2));
    chmodSync(cfg, 0o600);
    ctx.log('seeded config.json (run the setup wizard in Settings → Plugins → AI assistant)');
  } else ctx.log('kept the existing config.json (same format as before: nothing to migrate)');
}

export async function onUninstall(ctx) {
  ctx.log('removing settings, provider profiles (stored keys included), conversations, session logs and usage');
}

export async function checks(ctx) {
  const out = [];
  out.push({ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir });
  let cfg = null;
  try { cfg = JSON.parse(readFileSync(join(ctx.dataDir, 'config.json'), 'utf8')); } catch { /* not installed or unreadable */ }
  const profiles = cfg ? Object.keys(cfg.profiles ?? {}) : [];
  out.push({ id: 'provider-set-up', ok: true, detail: cfg ? (cfg.setupComplete ? `${profiles.length} provider profile(s)` : 'setup wizard not finished') : 'no config yet' });
  const envKeys = (ctx.manifest?.lifecycle?.env ?? []).filter((k) => k.endsWith('_KEY') || k.endsWith('_TOKEN'));
  const present = envKeys.filter((k) => process.env[k]);
  out.push({ id: 'provider-keys-in-env', ok: true, detail: present.length ? present.join(', ') : 'none (add keys in the wizard instead)' });
  const cli = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' });
  out.push({ id: 'claude-cli', ok: true, detail: cli.status === 0 ? 'installed (Claude Code subscription provider available)' : 'not installed (subscription provider unavailable)' });
  out.push({ id: 'provider-registry', ok: existsSync(join(ctx.root ?? process.cwd(), 'framework/schemas/ai-providers.json')), detail: 'framework/schemas/ai-providers.json (assistant@1)' });
  return out;
}
