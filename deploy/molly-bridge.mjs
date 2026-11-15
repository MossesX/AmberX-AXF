#!/usr/bin/env node
/**
 * molly-bridge.mjs — the host side of the axf-molly bridge (host-bridge@1, framework/core/axf-molly.mjs). Runs on the
 * VPS as a systemd service (deploy/install-molly.sh installs axf-molly-bridge.service), listens on a Unix socket that is
 * mounted into the axf-molly container, and runs exactly the commands in BRIDGE_COMMANDS: tmux has / list / capture /
 * kill of axf-* sessions, the build launcher in a worktree under /root/axf-builds, read-only git there, the account
 * probe and health sweep, the account names, the headless events tail. It is NOT the Docker socket: it cannot start,
 * stop or inspect containers, read other folders, print a token or run a shell.
 *
 * What it touches on the host (also in framework/spec/AXF-MOLLY.md § Host bridge):
 *   read   /root/axf-builds/<build>  (git), /var/tmp/axf-headless/events.jsonl, tmux (axf-* sessions)
 *   run    deploy/claude-headless.sh in /root/axf-builds/<build> (one build session; the dispatch token comes with the
 *          request and is spent by the launcher), pipeline.mjs probe / health (the host's Claude logins), tmux kill-session
 *          of one axf-* session (the stale reaper)
 *   write  nothing of its own except its log (/var/log/axf-molly-bridge.log: command, arguments, status, ms; never a token)
 *
 *   node deploy/molly-bridge.mjs serve [--socket /run/axf-molly/bridge.sock] [--repo /opt/axf]
 *   node deploy/molly-bridge.mjs check   the allow-list and what each command touches (no socket)
 * Env: AXF_MOLLY_BRIDGE (socket), AXF_REPO_ROOT (/opt/axf), AXF_PIPELINE_WORKTREES (/root/axf-builds), AXF_HEADLESS_DIR.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../framework/core/axf-molly.mjs';
import { MODEL_IDS, modelKey } from '../framework/core/model-policy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AXF_REPO_ROOT || resolve(HERE, '..');
const WORKTREES = process.env.AXF_PIPELINE_WORKTREES || M.WORKTREES_ROOT;
const HEADLESS = process.env.AXF_HEADLESS_DIR || '/var/tmp/axf-headless';
const LOG = process.env.AXF_MOLLY_BRIDGE_LOG || '/var/log/axf-molly-bridge.log';
const PIPELINE = join(REPO, 'apps/console-web/plugins/build-orchestrator/pipeline.mjs');
const LAUNCHER = join(REPO, 'deploy/claude-headless.sh');
/** The claude argv the dispatcher uses (pipeline.mjs CLAUDE_ARGS); rebuilt here so the request never carries argv. */
const CLAUDE_ARGS = ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash', 'Edit', 'Write', 'MultiEdit', 'Read', 'Grep', 'Glob'];
const PRIORITY_LEVELS = { urgent: 'urgent', high: 'high', normal: 'normal', low: 'low' };

const nowIso = () => new Date().toISOString();
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const logLine = (o) => { try { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, `${JSON.stringify({ at: nowIso(), ...o })}\n`); } catch { /* courtesy */ } };
const run = (cmd, args, { cwd = REPO, env = process.env, timeout = 60e3, input } = {}) => {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout, input, maxBuffer: 8 * 1024 * 1024 });
  return { ok: !r.error && r.status === 0, status: r.error ? 127 : (r.status ?? 1), stdout: r.stdout || '', stderr: r.error ? r.error.message : (r.stderr || '') };
};

/** Run one checked request. Every branch below is one entry of BRIDGE_COMMANDS; nothing else exists. */
export function execute(chk, { env = process.env } = {}) {
  const [a0, a1, a2, a3, a4, a5, a6] = chk.args;
  switch (chk.cmd) {
    case 'bridge.ping': return { ok: true, status: 0, stdout: 'pong\n', stderr: '' };
    case 'tmux.has': return run('tmux', ['has-session', '-t', `=${a0}`]);
    case 'tmux.list': return run('tmux', ['list-panes', '-a', '-F', '#{session_name}|#{pane_pid}|#{session_created}']);
    case 'tmux.capture': return run('tmux', ['capture-pane', '-p', '-t', `=${a0}`, '-S', `-${Math.min(2000, Number(a1) || 40)}`]);
    case 'tmux.kill': return run('tmux', ['kill-session', '-t', `=${a0}`]);
    case 'git': {
      const cwd = M.worktreeFor(a0, WORKTREES);
      if (!cwd || !existsSync(cwd)) return { ok: false, status: 2, stdout: '', stderr: `no worktree ${a0}` };
      return run('git', [a1, ...chk.args.slice(2)], { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120e3 });
    }
    case 'worktree.ensure': {
      // the same code path the dispatcher uses on the host (claude/<build> from origin/main, node_modules linked)
      return run(process.execPath, ['-e', `import('${PIPELINE}').then((p) => { const r = p.ensureWorktree(${JSON.stringify(a0)}); console.log(JSON.stringify(r)); })`], { timeout: 240e3 });
    }
    case 'launch': {
      const cwd = M.worktreeFor(a0, WORKTREES);
      if (!cwd || !existsSync(cwd)) return { ok: false, status: 2, stdout: '', stderr: `no worktree ${a0}: call worktree.ensure first` };
      if (!existsSync(join(cwd, a3))) return { ok: false, status: 2, stdout: '', stderr: `no brief ${a3} in the worktree` };
      const key = modelKey(a2) || 'opus';
      const args = [LAUNCHER, '--name', a0, '--account', a1, '--brief', a3, '--log', a4, '--', '--model', MODEL_IDS[key], ...CLAUDE_ARGS];
      // the dispatch token is the request's or none: the daemon's own environment never lends one
      const e = { ...env, AXF_SURFACE: 'pipeline', AXF_MODEL: key, AXF_BUILD_ID: a0, AXF_CLAUDE_ACCOUNT: a1, ...(a6 && PRIORITY_LEVELS[a6] ? { AXF_PRIORITY: a6 } : {}) };
      if (a5) e.AXF_DISPATCH_TOKEN = a5; else delete e.AXF_DISPATCH_TOKEN;
      return run('bash', args, { cwd, env: e, timeout: 180e3 });
    }
    case 'claude.probe': return run(process.execPath, [PIPELINE, 'probe', a0, '--json'], { timeout: 120e3 });
    case 'pipeline.health': {
      const child = spawn(process.execPath, [PIPELINE, 'health', '--by', 'axf-molly'], { cwd: REPO, env, detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, status: 0, stdout: `${JSON.stringify({ started: true, pid: child.pid })}\n`, stderr: '' };
    }
    case 'accounts.list': {
      const r = run(process.execPath, [PIPELINE, 'accounts', '--json'], { timeout: 60e3 });
      if (!r.ok) return r;
      try { const j = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).at(-1)); const rows = (j.accounts ?? []).map((x) => ({ name: x.name, kind: x.kind, fable: x.fable, parallel: x.parallel, running: x.running, usable: x.usable, why: x.why })); return { ok: true, status: 0, stdout: `${JSON.stringify(rows)}\n`, stderr: '' }; }
      catch { return { ok: false, status: 1, stdout: '', stderr: 'accounts: unreadable answer' }; }
    }
    case 'events.tail': {
      const f = join(HEADLESS, 'events.jsonl');
      if (!existsSync(f)) return { ok: true, status: 0, stdout: '', stderr: '' };
      const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
      return { ok: true, status: 0, stdout: `${lines.slice(-Math.min(5000, Number(a0) || 200)).join('\n')}\n`, stderr: '' };
    }
    default: return { ok: false, status: 2, stdout: '', stderr: `unknown command ${chk.cmd}` };
  }
}

export function handleLine(line) {
  const started = Date.now();
  let req = null;
  try { req = JSON.parse(line); } catch { return M.bridgeReply('', { ok: false, error: 'bad request: not JSON' }); }
  const chk = M.bridgeCheck(req);
  if (!chk.ok) { logLine({ cmd: str(req?.cmd, 40), refused: chk.error }); return M.bridgeReply(str(req?.id, 40), { ok: false, status: 2, error: chk.error }); }
  const r = execute(chk);
  const shown = chk.cmd === 'launch' ? chk.args.slice(0, 5) : chk.args; // never the dispatch token
  logLine({ cmd: chk.cmd, args: shown, ok: r.ok, status: r.status, ms: Date.now() - started });
  return M.bridgeReply(str(req.id, 40), { ok: r.ok, status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - started });
}

export function serve({ socket = process.env.AXF_MOLLY_BRIDGE || M.BRIDGE_SOCKET } = {}) {
  mkdirSync(dirname(socket), { recursive: true });
  if (existsSync(socket)) unlinkSync(socket);
  const server = createServer((sock) => {
    let buf = '';
    sock.on('data', (c) => {
      buf += c;
      const i = buf.indexOf('\n');
      if (i < 0) { if (buf.length > 64_000) sock.destroy(); return; }
      const line = buf.slice(0, i); buf = '';
      const reply = handleLine(line);
      sock.end(`${JSON.stringify(reply)}\n`);
    });
    sock.on('error', () => {});
  });
  server.listen(socket, () => { chmodSync(socket, 0o600); logLine({ event: 'listening', socket, repo: REPO, worktrees: WORKTREES }); console.log(`axf-molly bridge listening on ${socket}`); });
  const stop = () => { server.close(); try { unlinkSync(socket); } catch { /* gone */ } process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd = 'serve'] = process.argv.slice(2);
  const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
  if (cmd === 'check') { for (const [k, v] of Object.entries(M.BRIDGE_COMMANDS)) console.log(`${k.padEnd(18)} ${v.args.join(' ').padEnd(44)} ${v.touches}`); console.log(`never: ${M.BRIDGE_NEVER.join('; ')}`); }
  else if (cmd === 'serve') serve({ socket: opt('socket', process.env.AXF_MOLLY_BRIDGE || M.BRIDGE_SOCKET) });
  else { console.error('usage: molly-bridge.mjs serve [--socket path] | check'); process.exitCode = 2; }
}
