#!/usr/bin/env node
/**
 * bridge-client.mjs — the container's side of the host bridge (host-bridge@1, framework/core/axf-molly.mjs).
 *
 * One request per connection on the Unix socket the host mounts into the container (AXF_MOLLY_BRIDGE, default
 * /run/axf-molly/bridge.sock): a newline-terminated JSON `{ $axf, id, cmd, args }`, one newline-terminated JSON reply
 * `{ $axf, id, ok, status, stdout, stderr, error, ms }`. The command list is fixed on both ends (BRIDGE_COMMANDS); the
 * client refuses anything not on it before touching the socket.
 *
 *   node apps/axf-molly/bridge-client.mjs <cmd> [args…] [--json]     prints stdout (or the reply with --json); exit = the command's status
 *   import { bridge } from './bridge-client.mjs'; await bridge('tmux.has', ['axf-my-build'])
 */
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as M from '../../framework/core/axf-molly.mjs';

export const socketPath = (env = process.env) => env.AXF_MOLLY_BRIDGE || M.BRIDGE_SOCKET;

export function bridge(cmd, args = [], { env = process.env, timeout = 190e3 } = {}) {
  const chk = M.bridgeCheck({ cmd, args });
  if (!chk.ok) return Promise.resolve(M.bridgeReply('', { ok: false, error: chk.error }));
  const id = randomBytes(6).toString('hex');
  const req = M.bridgeRequest(cmd, chk.args, id);
  return new Promise((res) => {
    const started = Date.now();
    const sock = connect(socketPath(env));
    let buf = ''; let done = false;
    const finish = (reply) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); res(reply); };
    const timer = setTimeout(() => finish(M.bridgeReply(id, { ok: false, error: `bridge: no answer in ${Math.round(timeout / 1000)} s`, ms: Date.now() - started })), timeout);
    sock.on('connect', () => sock.write(`${JSON.stringify(req)}\n`));
    sock.on('data', (c) => { buf += c; const i = buf.indexOf('\n'); if (i >= 0) { try { finish(JSON.parse(buf.slice(0, i))); } catch { finish(M.bridgeReply(id, { ok: false, error: 'bridge: bad reply', ms: Date.now() - started })); } } });
    sock.on('error', (e) => finish(M.bridgeReply(id, { ok: false, error: `bridge: ${e.code || e.message}`, ms: Date.now() - started })));
    sock.on('close', () => { if (!done) finish(M.bridgeReply(id, { ok: false, error: 'bridge: closed without a reply', ms: Date.now() - started })); });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const json = process.argv.includes('--json'); const [cmd, ...args] = process.argv.slice(2).filter((a) => a !== '--json');
  bridge(cmd, args).then((r) => {
    if (json) console.log(JSON.stringify(r));
    else { if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : `${r.stdout}\n`); if (r.stderr) process.stderr.write(r.stderr.endsWith('\n') ? r.stderr : `${r.stderr}\n`); if (r.error) process.stderr.write(`${r.error}\n`); }
    process.exitCode = r.ok ? (r.status || 0) : (r.status || 1);
  });
}
