#!/usr/bin/env node
/**
 * Helper subscriptions test (spec § 14): pairing, sealing, verify on connect, model bounce through the CLI, the launcher.
 * The two that must never regress: a helper's job NEVER falls back to the main account, and a token is NEVER logged.
 * A fake Anthropic answers the calls; a fake `claude` on PATH stands in for Claude Code. Zero tokens, nothing leaves this machine.
 *   node apps/console-web/plugins/session-sync/test-helpers.mjs
 */
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bcore from '../../../../framework/plan/builds-store-core.mjs';
import { accountId, credsApi, scrub } from './creds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const CLI = join(HERE, 'sync.mjs');
const T = mkdtempSync(join(tmpdir(), 'axf-helpers-'));
const TOKEN = `sk-ant-oat01-${'Zq7'.repeat(20)}wxyz`;
const MAIN_TOKEN_SENTINEL = 'main-account-credentials';
let fails = 0; let n = 0; const captured = [];
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ''}`); } };

const calls = []; let fable = 'no';
const fake = createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }).on('end', () => {
    calls.push({ url: req.url, auth: req.headers.authorization, body: b });
    const ok = req.headers.authorization === `Bearer ${TOKEN}`;
    const send = (st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (!ok) return send(401, { error: 'bad' });
    if (req.url === '/api/oauth/profile') return send(200, { account: { email: 'helper2@example.com' }, organization: { organization_type: 'claude_max' } });
    const model = JSON.parse(b || '{}').model ?? '';
    if (model.includes('fable') && fable === 'no') return send(403, { error: 'no access' });
    return send(200, { id: 'm' });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const API = `http://127.0.0.1:${fake.address().port}`;

const store = bcore.emptyStore();
store.builds.push(
  bcore.normBuild({ id: 'mixed', title: 'Mixed', status: 'pending', profiles: ['main-framework'], steps: [{ id: 's1', text: 'Schema', model: 'Fable', estimate: '20 min' }, { id: 's2', text: 'UI', model: 'Opus', estimate: '20 min' }] }),
  bcore.normBuild({ id: 'opus-only', title: 'Opus only', status: 'pending', profiles: ['main-framework'], steps: [{ id: 's1', text: 'Work', model: 'Opus', estimate: '20 min' }] }),
  bcore.normBuild({ id: 'main-job', title: 'Main job', status: 'pending', profiles: ['main-framework'], steps: [{ id: 's1', text: 'Work', model: 'Opus', estimate: '20 min' }] }),
);
writeFileSync(join(T, 'store.json'), JSON.stringify(store));
const DATA = join(T, 'data'); const ACCTS = join(T, 'accounts');
const base = { ...process.env, AXF_SESSION_LINK_FILE: join(DATA, 'link.json'), AXF_BUILDS_STORE: join(T, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_SYNC_PUBLISH: '0', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'main-framework', AXF_CLAUDE_ACCOUNTS_DIR: ACCTS, AXF_CLAUDE_API_URL: API, AXF_SESSION_SYNC_CREW: JSON.stringify([{ id: 'brownie', models: ['opus', 'fable'] }, { id: 'earl', models: ['opus', 'fable'] }]), AXF_SESSION_SYNC_NAMES: JSON.stringify({ brownie: 'Brownie', earl: 'Earl the Ear', paulie: 'Ping Paulie' }) };
for (const k of ['AXF_APPROVER', 'AXF_APPROVER_VIA', 'AXF_SESSION', 'AXF_AGENT', 'AXF_ACCOUNT', 'CLAUDE_CODE_OAUTH_TOKEN']) delete base[k];
const who = { A: { AXF_SESSION: 's-brett', AXF_ACCOUNT: 'brett', AXF_AGENT: 'rio', AXF_SESSION_ME_FILE: join(T, 'meA.json') }, B: { AXF_SESSION: 's-two', AXF_ACCOUNT: 'acct2', AXF_AGENT: 'paulie', AXF_SESSION_ME_FILE: join(T, 'meB.json') } };
const brett = { AXF_SESSION_SYNC_CALLER: JSON.stringify({ session: 'console-brett', account: 'brett', agent: 'rio', brett: true }) };
const sh = (cmd, args, env, input) => new Promise((res) => { const p = execFile(cmd, args, { cwd: ROOT, env, timeout: 60000 }, (err, stdout, stderr) => { captured.push(stdout, stderr); res({ code: err ? (err.code ?? 1) : 0, stdout, stderr }); }); if (input !== undefined) p.stdin.end(input); });
const run = async (w, args, opts = {}) => { const r = await sh(process.execPath, [CLI, ...args, '--json'], { ...base, ...who[w], ...(opts.env ?? {}) }, opts.input); const line = r.stdout.trim().split('\n').pop(); try { return JSON.parse(line); } catch { return { raw: r.stdout, err: r.stderr, code: r.code }; } };
const op = (name, args) => run('A', ['op', name, JSON.stringify(args)], { env: brett });
const link = () => JSON.parse(readFileSync(join(DATA, 'link.json'), 'utf8'));
const gate = async (build, extra = []) => { const r = await sh(process.execPath, [CLI, 'launch-gate', '--build', build, ...extra], { ...base, ...who.A }); return r; };
function walk(d, out = []) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; }

try {
  /* sealing: the console side can seal but not open */
  process.env.AXF_CLAUDE_ACCOUNTS_DIR = ACCTS; const A = credsApi(() => DATA);
  let r = await run('A', ['join']); check('main joins', r.ok && r.becamePrimary);
  r = await run('B', ['join']); await op('approve-account', { account: 'acct2' });
  check('the helper gets Helper 2 on join', link().accounts.acct2.helperNo === 2);
  r = await run('B', ['pair']); check('no sealing key yet: pairing refuses rather than keeping anything in the clear', r.ok === false && r.code === 'not-ready', JSON.stringify(r));
  r = await run('A', ['creds-init']); check('creds-init makes the key once', r.created === true);
  r = await run('A', ['creds-init']); check('creds-init is idempotent', r.ok && r.created === false);
  check('the key is 0600 and the accounts folder 0700', (statSync(A.keyFile()).mode & 0o777) === 0o600 && (statSync(ACCTS).mode & 0o777) === 0o700);
  r = await run('A', ['pair']); check('main needs no pairing', r.ok === false && r.code === 'primary');

  /* pairing: one time, verified, labels only */
  r = await run('B', ['pair']); const code = decodeURIComponent(new URL(r.url.replace('#/', '')).searchParams.get('pair') ?? '');
  check('pairing answers a one-time link', r.ok && code.length > 30, JSON.stringify(r).slice(0, 200));
  check('only the code hash is stored', !readFileSync(join(A.dir(), 'pairing.json'), 'utf8').includes(code));
  const ingest = (body) => run('A', ['pair-ingest'], { input: JSON.stringify(body) });
  r = await ingest({ code, token: 'not-a-token' }); check('a non-token is refused', r.ok === false && /not a subscription token/.test(r.message));
  r = await ingest({ code, token: `sk-ant-oat01-${'x'.repeat(40)}` }); check('a token Anthropic refuses is not kept, and the error does not repeat it', r.ok === false && /refused/.test(r.message) && !existsSync(A.sealedFile('acct2')));
  r = await ingest({ code: 'wrong', token: TOKEN }); check('a wrong code is refused', r.ok === false && /expired|used/.test(r.message));
  r = await ingest({ code, token: TOKEN });
  check('verify on connect names the account and its models', r.ok && r.credential.email === 'helper2@example.com' && r.credential.plan === 'max' && r.credential.last4 === 'wxyz' && r.models.opus === true && r.models.fable === false, JSON.stringify(r).slice(0, 300));
  check('the sealed file is private and holds no token', (statSync(A.sealedFile('acct2')).mode & 0o777) === 0o600 && !readFileSync(A.sealedFile('acct2'), 'utf8').includes(TOKEN.slice(12)));
  const ingested = r; await op('account-credential', { account: 'acct2', credential: ingested.credential, models: ingested.models });
  r = await ingest({ code, token: TOKEN }); check('the code works once', r.ok === false);
  check('sealing round trip, bound to the account', A.unseal('acct2') === TOKEN);
  writeFileSync(A.sealedFile('other'), readFileSync(A.sealedFile('acct2'))); let moved = false; try { A.unseal('other'); moved = true; } catch { /* refused */ } check('a sealed token can not be moved to another account', !moved); rmSync(A.sealedFile('other'));
  check('scrub hides any token', !scrub(`boom ${TOKEN}`).includes('sk-ant-oat'));

  /* model bounce through the CLI */
  r = await run('A', ['offer', 'mixed', '--to', 's-two']); const oid = r.offer.id;
  r = await run('B', ['respond', oid, 'accept']);
  check('the helper keeps the Opus step, bounces the Fable one, the desk reassigns it', r.ok && r.bounce?.bounced?.join() === 's1' && r.assignment?.steps?.join() === 's2' && r.bounce.reassigned[0].agent === 'earl', JSON.stringify(r.bounce));
  const st = JSON.parse(readFileSync(join(T, 'store.json'), 'utf8')).builds.find((b) => b.id === 'mixed');
  check('the store shows both owners', st.steps.find((s) => s.id === 's1').assignedTo?.agent === 'earl' && st.steps.find((s) => s.id === 's2').assignedTo?.agent === 'paulie', JSON.stringify(st.steps).slice(0, 300));
  const kinds = link().events.filter((e) => e.type === 'desk').map((e) => `${e.data.kind}:${e.data.from}`).join();
  check('every hop is in the channel as its actor', kinds === 'bounce:paulie,reassign:brownie,picked:earl', kinds);

  /* the launcher's gate */
  r = await gate('main-job'); check('main work runs on main', r.code === 0 && r.stdout.trim() === 'main');
  r = await gate('main-job', ['--env']); check('main work gets no helper env at all', r.code === 0 && r.stdout === '');
  r = await gate('mixed', ['--step', 's2']); check('the helper\'s step runs on the helper', r.code === 0 && r.stdout.trim() === 'helper acct2', r.stdout + r.stderr);
  r = await gate('mixed', ['--step', 's2', '--env']); check('its env carries the token unexported, for that one run', r.code === 0 && r.stdout.includes('AXF_HELPER_TOKEN=') && !/export/.test(r.stdout) && r.stdout.includes(join(ACCTS, 'acct2')));
  captured.pop(); captured.pop(); // this one answer legitimately holds the token: everything else must not
  check('its own config dir is private', (statSync(join(ACCTS, 'acct2')).mode & 0o777) === 0o700);
  const waits = async (name, prep, undo) => { await prep(); const g = await gate('mixed', ['--step', 's2']); check(`NEVER FALLS BACK: ${name} = the job waits (exit 4)`, g.code === 4 && !/^main/.test(g.stdout) && !/^helper/.test(g.stdout), `${g.code} ${g.stdout}`); const e = await gate('mixed', ['--step', 's2', '--env']); check(`NEVER FALLS BACK: ${name} = no env for a run`, e.code === 4 && !e.stdout.includes('AXF_HELPER')); await undo(); };
  const keep = readFileSync(A.sealedFile('acct2'));
  await waits('rate limit', () => run('B', ['token-limited', '--resets', '2999-01-01T00:00:00Z']), () => op('account-credential', { account: 'acct2', credential: { state: 'ok', resetsAt: '' } }));
  await waits('expired login', () => op('account-credential', { account: 'acct2', credential: { state: 'expired' } }), () => op('account-credential', { account: 'acct2', credential: { state: 'ok' } }));
  await waits('expiry date passed', () => op('account-credential', { account: 'acct2', credential: { expiresAt: '2020-01-01T00:00:00Z' } }), () => op('account-credential', { account: 'acct2', credential: { expiresAt: '2999-01-01T00:00:00Z' } }));
  await waits('sealed token missing', async () => rmSync(A.sealedFile('acct2')), async () => writeFileSync(A.sealedFile('acct2'), keep, { mode: 0o600 }));
  const sealKey = readFileSync(A.keyFile()); await waits('sealing key missing', async () => rmSync(A.keyFile()), async () => writeFileSync(A.keyFile(), sealKey, { mode: 0o600 }));
  writeFileSync(A.sealedFile('acct2'), keep, { mode: 0o600 });
  const waitLines = link().events.filter((e) => e.type === 'desk' && e.data.kind === 'waiting');
  check('a waiting job is said once per reason, by the desk', waitLines.length >= 2 && waitLines.every((e) => e.data.from === 'brownie'), String(waitLines.length));
  r = await run('B', ['token-revoke', 'acct2']); check('a session can not revoke', r.ok === false && r.code === 'owner');
  r = await run('A', ['op', 'account-credential', JSON.stringify({ account: 'acct2', credential: { state: 'ok' } })]); check('a session can not set a credential', r.ok === false);

  /* the real launcher, with a fake claude */
  if (spawnSync('sh', ['-c', 'command -v tmux']).status === 0) {
    await op('account-credential', { account: 'acct2', credential: { state: 'ok', resetsAt: '', expiresAt: '2999-01-01T00:00:00Z' } });
    r = await run('A', ['offer', 'opus-only', '--to', 's-two']); await run('B', ['respond', r.offer.id, 'accept']);
    const home = join(T, 'home'); const bin = join(home, '.local/bin'); mkdirSync(bin, { recursive: true }); const seen = join(T, 'seen.log');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "run token=\${CLAUDE_CODE_OAUTH_TOKEN:-none} dir=\${CLAUDE_CONFIG_DIR:-none} api=\${ANTHROPIC_API_KEY:-none}" >> "${seen}"\necho "You've hit your weekly limit"\nexit 1\n`); chmodSync(join(bin, 'claude'), 0o755);
    const brief = join(T, 'wt', 'brief.md'); mkdirSync(dirname(brief)); writeFileSync(brief, '# test');
    const name = 'opus-only'; const killAll = () => { for (const s of spawnSync('tmux', ['ls', '-F', '#S'], { encoding: 'utf8' }).stdout.split('\n')) if (s.startsWith(`axf-${name}`)) spawnSync('tmux', ['kill-session', '-t', `=${s}`]); };
    killAll();
    const env = { ...base, ...who.A, HOME: home, PATH: `${bin}:${process.env.PATH}`, ANTHROPIC_API_KEY: MAIN_TOKEN_SENTINEL, AXF_SLOTS: 'off', AXF_AGENT_BOOK: 'off', AXF_WATCH_LIVE: 'off', AXF_ORIGIN: 'off', AXF_LOOK_GATE: 'off', AXF_HEADLESS_DIR: join(T, 'h'), AXF_ACCOUNT_SWITCHES: '3' };
    const l = spawnSync('bash', [join(ROOT, 'deploy/claude-headless.sh'), '--name', name, '--brief', brief, '--log', 'run.log', '--', '--model', 'opus'], { cwd: dirname(brief), env, encoding: 'utf8' });
    captured.push(l.stdout, l.stderr);
    for (let i = 0; i < 200 && !(existsSync(seen) && link().accounts.acct2.credential.state === 'limited'); i++) await new Promise((res) => setTimeout(res, 100));
    killAll();
    const lines = existsSync(seen) ? readFileSync(seen, 'utf8').trim().split('\n') : [];
    const stamp = lines[0] ?? ''; rmSync(seen, { force: true });
    check('the launcher ran the job once, on the helper\'s token and config dir, without the main API key', lines.length === 1 && stamp.includes(`token=${TOKEN}`) && stamp.includes(`dir=${join(ACCTS, 'acct2')}`) && stamp.includes('api=none'), `${l.stdout.slice(0, 200)} | ${l.stderr.slice(0, 200)} | ${lines.length} | ${(() => { try { return readFileSync(join(dirname(brief), 'run.log'), 'utf8').slice(-400); } catch { return 'no log'; } })()} | ${spawnSync('tmux', ['ls'], { encoding: 'utf8' }).stdout.split('\n').filter((x) => x.includes('opus-only')).join()}`);
    check('NEVER FALLS BACK: a helper run that hits its limit is not switched or retried; the account goes limited', link().accounts.acct2.credential.state === 'limited');
    const blocked = spawnSync('bash', [join(ROOT, 'deploy/claude-headless.sh'), '--name', name, '--brief', brief, '--log', 'run2.log', '--', '--model', 'opus'], { cwd: dirname(brief), env, encoding: 'utf8' }); captured.push(blocked.stdout, blocked.stderr);
    check('NEVER FALLS BACK: the next launch is refused while limited, nothing starts', blocked.status === 3 && !existsSync(seen), `${blocked.status} ${blocked.stderr}`);
    rmSync(dirname(brief), { recursive: true, force: true }); // the log holds what the fake printed; the walk below covers the rest
  } else console.log('  (tmux missing: real launcher run skipped)');

  /* token never logged */
  const hay = [...walk(T).filter((f) => !f.endsWith('.sealed') && !f.endsWith('seen.log')), ].map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n') + captured.join('\n');
  check('TOKEN NEVER LOGGED: not in any file (link, journal, audit, store, pairing, logs) or any output', !hay.includes(TOKEN) && !hay.includes(TOKEN.slice(13, 40)));
  check('the link holds the last 4 only', link().accounts.acct2.credential.last4 === 'wxyz' && !JSON.stringify(link()).includes('sk-ant'));
  check('the token only ever went to the fake Anthropic in a header', calls.every((c) => !c.body.includes('sk-ant')));
  check('accountId is stable', accountId('Two@Example.com') === 'two-example-com');
} finally {
  fake.close();
  rmSync(T, { recursive: true, force: true });
}
console.log(`${fails ? '✗' : '✓'} session-sync helpers: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
