/**
 * Lifecycle hooks (plugin-lifecycle@1) of the Session sync plugin. Everything the plugin leaves outside its folder is
 * put there here and taken away here: the `/sync` command (`.claude/commands/sync.md` in the repo and, for every project
 * on this device, `~/.claude/commands/sync.md`), the one CLAUDE.md line ("On start, if _claude/sync/ exists, read it")
 * and the Claude Code hook in ~/.claude/settings.json (installed only with --hooks, since it is per machine).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..', '..');
const MARK = '<!-- axf-plugin:session-sync -->';
export const CLAUDE_LINE = `- **Session sync (Nov 4 2026):** on start, if \`_claude/sync/\` exists, read \`_claude/sync/<project>.md\` (handoff@1: who is on, claims, work, offers) before touching anything; \`/sync\` joins the session link and refreshes it (\`framework/spec/HANDOFF.md\`). ${MARK}`;
const COMMAND_SRC = join(HERE, 'commands', 'sync.md');
const commandTargets = () => [join(ROOT, '.claude', 'commands', 'sync.md'), join(homedir(), '.claude', 'commands', 'sync.md')];

export function installCommand(log = () => {}) {
  const out = [];
  for (const f of commandTargets()) { try { mkdirSync(dirname(f), { recursive: true }); copyFileSync(COMMAND_SRC, f); out.push(f); log(`/sync command: ${f}`); } catch (e) { log(`/sync command not written to ${f}: ${e.message}`); } }
  return out;
}
export function removeCommand(log = () => {}) {
  for (const f of commandTargets()) if (existsSync(f) && readFileSync(f, 'utf8').includes('Session sync (`framework/spec/HANDOFF.md`')) { rmSync(f); log(`removed ${f}`); }
}
export function addClaudeLine(file = join(ROOT, 'CLAUDE.md'), log = () => {}) {
  if (!existsSync(file)) return false;
  const t = readFileSync(file, 'utf8');
  if (t.includes(MARK)) return false;
  const i = t.indexOf('## Status');
  const next = i >= 0 ? `${t.slice(0, i)}${CLAUDE_LINE}\n\n${t.slice(i)}` : `${t.replace(/\s*$/, '')}\n\n${CLAUDE_LINE}\n`;
  writeFileSync(file, next); log(`CLAUDE.md: added the sync line`); return true;
}
export function removeClaudeLine(file = join(ROOT, 'CLAUDE.md')) {
  if (!existsSync(file)) return false;
  const t = readFileSync(file, 'utf8'); if (!t.includes(MARK)) return false;
  writeFileSync(file, t.split('\n').filter((l) => !l.includes(MARK)).join('\n').replace(/\n{3,}/g, '\n\n')); return true;
}

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true, mode: 0o700 });
  installCommand(ctx.log);
  addClaudeLine(undefined, ctx.log);
  if (process.argv.includes('--hooks')) { const { installHooks } = await import('./sync.mjs'); const r = installHooks(); ctx.log(`Claude Code hook installed in ${r.file}`); }
  else ctx.log('Claude Code hook: node apps/console-web/plugins/session-sync/sync.mjs hooks install (once per machine)');
  ctx.log(`ready: ${ctx.dataDir}`);
}
export async function onUninstall(ctx) {
  ctx.log('removing the Session sync plugin data, the /sync command and the CLAUDE.md line');
  removeCommand(ctx.log); removeClaudeLine();
  try { const { removeHooks } = await import('./sync.mjs'); removeHooks(); } catch { /* the folder may already be gone */ }
}
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'sync-command', ok: existsSync(commandTargets()[0]), detail: commandTargets()[0] },
    { id: 'claude-line', ok: existsSync(join(ROOT, 'CLAUDE.md')) && readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8').includes(MARK), detail: 'CLAUDE.md "On start, if _claude/sync/ exists, read it"' },
  ];
}
