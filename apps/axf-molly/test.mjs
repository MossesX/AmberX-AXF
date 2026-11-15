#!/usr/bin/env node
/**
 * axf-molly tests: the HTTP handler (health without a token, bearer auth, tool routing, owner-only refusals, reason on
 * changes), the CLI argument shaping for every tool, the lease file round trip (cutover / renew / undo through the CLI),
 * the shadow log, and the host bridge end to end over a temporary socket with a fake tmux and a fake launcher.
 *   node apps/axf-molly/test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../../framework/core/axf-molly.mjs';
import * as molly from './molly.mjs';
import { handle } from './server.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ta = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const tmp = mkdtempSync(join(tmpdir(), 'axf-molly-'));
const env = { ...process.env, AXF_MOLLY_DIR: join(tmp, 'molly'), AXF_PIPELINE_DIR: join(tmp, 'pipeline'), AXF_MOLLY_TOKEN: 'secret-token-1234', AXF_MOLLY_SIDE: 'axf-molly', AXF_DATA_URL: '' };
mkdirSync(env.AXF_PIPELINE_DIR, { recursive: true });

// ------------------------------------------------------------------ the HTTP handler
const calls = [];
const fakeRun = (name, params, o) => { calls.push({ name, params, by: o.by }); return name === 'orchestrator.tick' ? { ok: true, launched: [] } : { ok: true, name, params }; };
const H = { authorization: 'Bearer secret-token-1234' };

t('health needs no token and says who acts', () => {
  const r = handle({ method: 'GET', path: '/v1/health', env, run: fakeRun });
  assert.equal(r.status, 200); assert.equal(r.json.side, 'axf-molly'); assert.equal(r.json.owner, 'console'); assert.equal(r.json.acting, false);
});
t('every other route needs the bearer token', () => {
  assert.equal(handle({ method: 'GET', path: '/v1/orchestrator/status', env, run: fakeRun }).status, 401);
  assert.equal(handle({ method: 'GET', path: '/v1/orchestrator/status', headers: { authorization: 'Bearer nope' }, env, run: fakeRun }).status, 401);
  assert.equal(handle({ method: 'GET', path: '/v1/orchestrator/status', headers: H, env: { ...env, AXF_MOLLY_TOKEN: '' }, run: fakeRun }).json.error, 'the container has no AXF_MOLLY_TOKEN');
});
t('tools route by method and path; params come from the path, the query and the body', () => {
  let r = handle({ method: 'GET', path: '/v1/orchestrator/status', headers: H, env, run: fakeRun });
  assert.equal(r.status, 200); assert.equal(r.json.tool, 'orchestrator.status');
  r = handle({ method: 'POST', path: '/v1/orchestrator/builds/my-build/hold', headers: { ...H, 'x-axf-actor': 'brett' }, body: { why: 'wait', reason: { title: 'Hold', description: 'needs the skins build first' } }, env, run: fakeRun });
  assert.equal(r.status, 200); assert.deepEqual(calls.at(-1), { name: 'orchestrator.hold', params: { why: 'wait', id: 'my-build' }, by: 'brett' });
  r = handle({ method: 'GET', path: '/v1/features?since=2026-11-01&q=skins', headers: H, env, run: fakeRun });
  assert.deepEqual(calls.at(-1).params, { since: '2026-11-01', q: 'skins' });
  assert.equal(handle({ method: 'GET', path: '/v1/nothing', headers: H, env, run: fakeRun }).status, 404);
  assert.equal(handle({ method: 'POST', path: '/v1/orchestrator/builds/..%2Fetc/queue', headers: H, env, run: fakeRun }).status, 404);
});
t('a change needs a reason when the container is told so (axHub rule)', () => {
  const strict = { ...env, AXF_MOLLY_REASON: 'required' };
  assert.equal(handle({ method: 'POST', path: '/v1/lander/on', headers: H, body: {}, env: strict, run: fakeRun }).status, 400);
  assert.equal(handle({ method: 'POST', path: '/v1/lander/on', headers: H, body: { reason: { title: 'On', description: 'resume landing' } }, env: strict, run: fakeRun }).status, 200);
  assert.equal(handle({ method: 'GET', path: '/v1/lander/status', headers: H, env: strict, run: fakeRun }).status, 200);
});
t('a tool that fails answers its code', () => {
  const r = handle({ method: 'POST', path: '/v1/orchestrator/tick', headers: H, body: {}, env, run: () => ({ ok: false, error: 'refused: shadow', code: 409 }) });
  assert.equal(r.status, 409); assert.equal(r.json.error, 'refused: shadow');
  assert.equal(handle({ method: 'POST', path: '/v1/orchestrator/tick', headers: H, body: {}, env, run: () => ({ ok: false, error: 'bad', code: 2 }) }).status, 400);
});

// ------------------------------------------------------------------ the real runner: owner-only tools refuse in shadow
t('runTool refuses owner-only tools while the console side owns, and passes the rest through', () => {
  const r = molly.runTool('orchestrator.tick', {}, { env });
  assert.equal(r.ok, false); assert.equal(r.code, 409); assert.match(r.error, /shadow mode/);
  assert.equal(molly.runTool('lander.run', {}, { env }).code, 409);
  assert.equal(molly.runTool('features.landed', {}, { env }).code, 409);
  assert.equal(molly.runTool('nope.x', {}, { env }).code, 2);
  const s = molly.runTool('molly.status', {}, { env });
  assert.equal(s.ok, true); assert.equal(s.owner, 'console'); assert.equal(s.side, 'axf-molly');
});

// ------------------------------------------------------------------ CLI argument shaping
t('cliArgs shapes every tool: positionals in order, named flags, booleans', () => {
  assert.deepEqual(molly.cliArgs('orchestrator.queue', { id: 'my-build' }), ['queue', 'my-build']);
  assert.deepEqual(molly.cliArgs('orchestrator.hold', { id: 'b', why: 'wait' }), ['hold', 'b', '--why', 'wait']);
  assert.deepEqual(molly.cliArgs('orchestrator.request', { title: 'T', detail: 'D', priority: 'P1', route: 'api', queue: true }), ['request', '--title', 'T', '--detail', 'D', '--priority', 'P1', '--route', 'api', '--queue']);
  assert.deepEqual(molly.cliArgs('orchestrator.route', { id: 'b', route: 'api' }), ['route', 'b', 'api']);
  assert.deepEqual(molly.cliArgs('orchestrator.step', { id: 'b', step: 's1', state: 'done' }), ['act', 'step', 'b', 's1', 'done']);
  assert.deepEqual(molly.cliArgs('orchestrator.note', { id: 'b', text: 'hello there' }), ['act', 'note', 'b', 'hello there']);
  assert.deepEqual(molly.cliArgs('orchestrator.selfcheck', { reason: 'voice' }), ['selfcheck', '--request', '--reason', 'voice']);
  assert.deepEqual(molly.cliArgs('lander.off', {}), ['settings', '--off']);
  assert.deepEqual(molly.cliArgs('lander.hold', { id: 'b', why: 'w' }), ['hold', 'b', '--why', 'w']);
  assert.deepEqual(molly.cliArgs('features.landed', { since: '2026-11-01', max: 2 }), ['landed', '--since', '2026-11-01', '--max', '2']);
  assert.deepEqual(molly.cliArgs('features.ship', { id: 'b', source: 'manual' }), ['ship', 'b', '--source', 'manual']);
  assert.throws(() => molly.cliArgs('orchestrator.queue', {}), /missing id/);
  for (const name of M.toolNames()) { const t = M.toolFor(name); const params = Object.fromEntries(t.args.map((a) => [a.replace(/\?$/, ''), 'x'])); assert.ok(Array.isArray(molly.cliArgs(name, params)), name); }
});

// ------------------------------------------------------------------ lease + shadow log through the CLI
const cli = (...a) => { const r = spawnSync(process.execPath, [join(HERE, 'molly.mjs'), ...a, '--json'], { encoding: 'utf8', env }); const out = r.stdout.trim().split('\n').filter(Boolean).at(-1) || '{}'; return { code: r.status, json: JSON.parse(out) }; };
t('status / owner / cutover / renew / undo through the CLI, lease on disk', () => {
  let r = cli('status'); assert.equal(r.json.owner, 'console'); assert.equal(r.json.acting, false);
  r = cli('owner', 'console'); assert.equal(r.code, 0);
  r = cli('owner', 'axf-molly'); assert.equal(r.code, 3);
  r = cli('cutover'); assert.equal(r.code, 2); assert.match(r.json.error, /needs a reason/);
  r = cli('cutover', '--reason', 'shadow clean', '--by', 'brett'); assert.equal(r.code, 0); assert.equal(r.json.lease.owner, 'axf-molly');
  const onDisk = JSON.parse(readFileSync(join(env.AXF_MOLLY_DIR, 'lease.json'), 'utf8')); assert.equal(onDisk.$axf, M.LEASE_FRAME); assert.equal(onDisk.by, 'brett');
  r = cli('owner', 'axf-molly'); assert.equal(r.code, 0);
  assert.equal(molly.acts(env), true, 'this side (axf-molly) acts after cutover');
  assert.equal(molly.acts(env, 'console'), false);
  const before = molly.readLease(env).until;
  r = cli('renew'); assert.equal(r.code, 0); assert.ok(r.json.lease.until >= before);
  r = cli('undo', '--reason', 'testing'); assert.equal(r.code, 0); assert.equal(r.json.lease.mode, 'shadow'); assert.equal(r.json.lease.owner, 'console');
  r = cli('shadow'); assert.equal(r.json.entries.filter((e) => e.kind === 'mode').length, 2, 'cutover and undo are logged');
  r = cli('tools'); assert.equal(r.json.tools.length, Object.keys(M.TOOLS).length);
  r = cli('axhub-service'); assert.equal(r.json.service, 'axf-molly');
});
t('shadow entries and the summary', () => {
  molly.shadowLog(M.diffEntry('tick', { diffs: [] }), env);
  const s = molly.shadowSummary(env);
  assert.ok(s.lines >= 3); assert.equal(s.differing, 0);
});

// ------------------------------------------------------------------ the host bridge end to end
await ta('bridge: a fake tmux and launcher over a temporary socket; the allow-list holds on both ends', async () => {
  const bin = join(tmp, 'bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\necho "tmux $*"\ncase "$1" in has-session) case "$3" in =axf-live) exit 0;; *) exit 1;; esac;; esac\nexit 0\n'); chmodSync(join(bin, 'tmux'), 0o755);
  const repo = join(tmp, 'repo'); mkdirSync(join(repo, 'deploy'), { recursive: true }); mkdirSync(join(repo, 'framework/core'), { recursive: true });
  writeFileSync(join(repo, 'deploy/claude-headless.sh'), '#!/bin/sh\n[ -n "$AXF_DISPATCH_TOKEN" ] || { echo "no token" >&2; exit 3; }\necho "args: $*"\necho "started axf-$2 in $(pwd)"\n');
  const wt = join(tmp, 'wt'); mkdirSync(join(wt, 'my-build'), { recursive: true }); writeFileSync(join(wt, 'my-build/.axf-brief.md'), '# brief\n');
  spawnSync('git', ['init', '-q', join(wt, 'my-build')]);
  const sock = join(tmp, 'b.sock');
  const benv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AXF_MOLLY_BRIDGE: sock, AXF_REPO_ROOT: repo, AXF_PIPELINE_WORKTREES: wt, AXF_MOLLY_BRIDGE_LOG: join(tmp, 'bridge.log'), AXF_HEADLESS_DIR: join(tmp, 'headless') };
  const { spawn } = await import('node:child_process');
  const daemon = spawn(process.execPath, [join(HERE, '../../deploy/molly-bridge.mjs'), 'serve', '--socket', sock], { env: benv, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res) => daemon.stdout.on('data', (d) => { if (/listening/.test(String(d))) res(); }));
  try {
    const { bridge } = await import('./bridge-client.mjs');
    const o = { env: benv, timeout: 10000 };
    let r = await bridge('bridge.ping', [], o); assert.equal(r.ok, true); assert.equal(r.stdout.trim(), 'pong');
    r = await bridge('tmux.has', ['axf-live'], o); assert.equal(r.ok, true);
    r = await bridge('tmux.has', ['axf-dead'], o); assert.equal(r.ok, false); assert.equal(r.status, 1);
    r = await bridge('tmux.has', ['molly'], o); assert.equal(r.ok, false); assert.match(r.error, /bad session/);
    r = await bridge('docker', ['ps'], o); assert.match(r.error, /unknown bridge command/);
    r = await bridge('git', ['my-build', 'status', '--short'], o); assert.equal(r.ok, true);
    r = await bridge('git', ['my-build', 'push'], o); assert.match(r.error, /not allowed/);
    r = await bridge('git', ['other', 'status'], o); assert.equal(r.ok, false); assert.match(r.stderr, /no worktree/);
    r = await bridge('launch', ['my-build', 'mossesx-max-', 'fable', '.axf-brief.md', 'my-build.log'], o); assert.equal(r.ok, false); assert.match(r.stderr, /no token/);
    r = await bridge('launch', ['my-build', 'mossesx-max-', 'fable', '.axf-brief.md', 'my-build.log', 'tok_0123456789', 'high'], o);
    assert.equal(r.ok, true); assert.match(r.stdout, /started axf-my-build in/); assert.match(r.stdout, /--model claude-/); assert.doesNotMatch(r.stdout, /tok_0123456789/);
    r = await bridge('events.tail', ['5'], o); assert.equal(r.ok, true);
    // the shim speaks tmux's argv on the container side
    const shim = spawnSync(process.execPath, [join(HERE, 'bin/tmux'), 'has-session', '-t', '=axf-live'], { env: benv, encoding: 'utf8' }); assert.equal(shim.status, 0);
    const shim2 = spawnSync(process.execPath, [join(HERE, 'bin/tmux'), 'new-session'], { env: benv, encoding: 'utf8' }); assert.equal(shim2.status, 2);
    // the launcher shim forwards exactly the launch request (token from the environment, never argv after --)
    const l = spawnSync('bash', [join(HERE, 'bin/claude-headless.sh'), '--name', 'my-build', '--account', 'mossesx-max-', '--brief', '.axf-brief.md', '--log', 'my-build.log', '--', '--model', 'x', '--dangerously-skip-permissions'], { env: { ...benv, AXF_DISPATCH_TOKEN: 'tok_0123456789', AXF_MODEL: 'fable', AXF_PRIORITY: 'normal' }, encoding: 'utf8' });
    assert.equal(l.status, 0, l.stderr); assert.match(l.stdout, /started axf-my-build/); assert.doesNotMatch(l.stdout, /dangerously/);
    // the daemon checks on its own too: a raw request that skips the client's check is refused there
    const { connect } = await import('node:net');
    const raw = await new Promise((res) => { const c = connect(sock); let buf = ''; c.on('connect', () => c.write(`${JSON.stringify({ $axf: M.BRIDGE_FRAME, id: 'raw1', cmd: 'docker', args: ['ps'] })}\n`)); c.on('data', (d) => { buf += d; }); c.on('close', () => res(JSON.parse(buf))); });
    assert.equal(raw.ok, false); assert.match(raw.error, /unknown bridge command/);
    const log = readFileSync(join(tmp, 'bridge.log'), 'utf8'); assert.doesNotMatch(log, /tok_0123456789/, 'the bridge log never holds a token'); assert.match(log, /"refused"/);
  } finally { daemon.kill('SIGTERM'); }
});

rmSync(tmp, { recursive: true, force: true });
console.log(`axf-molly: ${n} checks passed`);
