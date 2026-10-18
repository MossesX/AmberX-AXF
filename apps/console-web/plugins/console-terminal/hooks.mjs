/** Lifecycle hooks (plugin-lifecycle@1) for the Terminal. Everything stays inside ctx.dataDir. */
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function onInstall(ctx) {
  mkdirSync(join(ctx.dataDir, 'ssh'), { recursive: true, mode: 0o700 });
  const f = join(ctx.dataDir, 'settings.json');
  if (!existsSync(f)) {
    writeFileSync(f, JSON.stringify({ $axf: 'terminal-settings@1', idleMinutes: 60, moshKeepMinutes: 30 }, null, 2));
    chmodSync(f, 0o600);
    ctx.log('seeded settings.json');
  } else ctx.log('kept the existing settings.json');
}

export async function onUninstall(ctx) {
  ctx.log('removing settings, the VPS SSH key, the Claude Code token and the session log; also remove the "axf-console-terminal" line from the VPS ~/.ssh/authorized_keys');
}

export async function checks(ctx) {
  const has = (c) => spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).status === 0;
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'ssh-client', ok: has('ssh'), detail: has('ssh') ? 'ssh available (VPS tab)' : 'no ssh client: the VPS tab needs openssh-client in the console image' },
    { id: 'vps-key', ok: true, detail: existsSync(join(ctx.dataDir, 'ssh', 'id_ed25519')) ? 'VPS key made' : 'no VPS key yet (Settings → Plugins → Terminal → VPS host)' },
  ];
}
