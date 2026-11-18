/** Lifecycle hooks (plugin-lifecycle@1) for the Terminal. Everything stays inside ctx.dataDir. */
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Where senders outside the console park Claude link events while it is down (framework/cli/claude-link-emit.mjs). */
const spoolOf = (ctx) => process.env.AXF_CLAUDE_LINK_SPOOL || join(ctx.root, '.axf-console', 'claude-link-spool.jsonl');

export async function onInstall(ctx) {
  mkdirSync(join(ctx.dataDir, 'ssh'), { recursive: true, mode: 0o700 });
  mkdirSync(join(ctx.dataDir, 'claude-link'), { recursive: true, mode: 0o700 }); // Claude link tab: events.jsonl + view.json
  const f = join(ctx.dataDir, 'settings.json');
  if (!existsSync(f)) {
    writeFileSync(f, JSON.stringify({ $axf: 'terminal-settings@1', idleMinutes: 60, moshKeepMinutes: 30 }, null, 2));
    chmodSync(f, 0o600);
    ctx.log('seeded settings.json');
  } else ctx.log('kept the existing settings.json');
}

export async function onUninstall(ctx) {
  ctx.log('removing settings, the VPS SSH key, the Claude Code token, the session log and the Claude link log (claude-link/events.jsonl, view.json); also remove the "axf-console-terminal" line from the VPS ~/.ssh/authorized_keys');
  // the Claude link spool lives outside the dataDir (senders can't know the plugin's folder): it goes too
  const spool = spoolOf(ctx);
  if (existsSync(spool)) { rmSync(spool, { force: true }); ctx.log(`removed the Claude link spool ${spool}`); }
}

export async function checks(ctx) {
  const has = (c) => spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).status === 0;
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'ssh-client', ok: has('ssh'), detail: has('ssh') ? 'ssh available (VPS tab)' : 'no ssh client: the VPS tab needs openssh-client in the console image' },
    { id: 'claude-link', ok: true, detail: existsSync(join(ctx.dataDir, 'claude-link', 'events.jsonl')) ? 'Claude link log present' : 'no Claude link events yet' },
    { id: 'claude-link-spool', ok: !existsSync(spoolOf(ctx)), detail: existsSync(spoolOf(ctx)) ? 'events waiting in the spool: the console drains them on its next read' : 'spool empty' },
    { id: 'vps-key', ok: true, detail: existsSync(join(ctx.dataDir, 'ssh', 'id_ed25519')) ? 'VPS key made' : 'no VPS key yet (Settings → Plugins → Terminal → VPS host)' },
  ];
}
