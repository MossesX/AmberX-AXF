#!/usr/bin/env node
/**
 * fix-account-attribution: who a headless run is really signed in as. Unit checks for deploy/claude-whoami.mjs, the
 * mismatch record and alert in claude-workers / worker-routing, then claude-headless.sh end to end with a fake claude and
 * a fake count_tokens endpoint: an account whose saved token belongs to another login is logged, recorded and charged
 * as that login; a dead account stops the launch and is taken out, with no fallback.
 *
 *   node deploy/claude-whoami.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const ok = (v, what) => { if (!v) { console.error(`✗ ${what}`); process.exit(1); } passed += 1; console.log(`  ✓ ${what}`); };
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const until = async (fn, ms = 30_000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };

const ORG_MOSES = '11111111-2222-3333-4444-555555555555';
const ORG_HULU = '99999999-8888-7777-6666-555555555555';
const tmp = mkdtempSync(join(tmpdir(), 'axf-whoami-test-'));
const A = join(tmp, 'accounts'); const SH = join(tmp, 'claude-home'); const W = join(tmp, 'workers'); const HD = join(tmp, 'headless');
for (const d of [SH, W, HD]) mkdirSync(d, { recursive: true });
const creds = (s, expiresAt = Date.now() + 3600e3) => JSON.stringify({ claudeAiOauth: { accessToken: `fake-${s}`, refreshToken: `fake-${s}-r`, expiresAt } });
for (const n of ['moses', 'hulu', 'gone']) { mkdirSync(join(A, n), { recursive: true }); writeFileSync(join(A, n, '.credentials.json'), creds(n)); }
writeFileSync(join(A, 'hulu', 'token'), 'fake-moses-setup-token\n');   // the bug: hulu's saved token is moses's
writeFileSync(join(A, '.active'), 'moses\n');
writeFileSync(join(SH, '.credentials.json'), creds('moses'));
writeFileSync(join(SH, 'settings.json'), '{}');
writeFileSync(join(W, 'seen.json'), JSON.stringify({ moses: { email: 'moses@example.com' }, hulu: { email: 'hulu@example.com' }, gone: { email: 'gone@example.com' } }));
const ENV = { AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: SH, AXF_CLAUDE_GLOBAL: join(tmp, 'g.json'), AXF_CLAUDE_SEEN: join(W, 'seen.json'), AXF_CLAUDE_WORKERS: W, AXF_HEADLESS_DIR: HD };
Object.assign(process.env, ENV);
delete process.env.CLAUDE_CODE_OAUTH_TOKEN; delete process.env.ANTHROPIC_API_KEY; delete process.env.CLAUDE_CONFIG_DIR;
const Y = await import('./claude-whoami.mjs');
const X = await import('./claude-workers.mjs');
const R = await import('./worker-routing.mjs');
const env = { ...process.env };
const fakeProbe = (map) => async (cred) => map[cred.key] ?? { http: 200, orgId: '' };

console.log('which credential Claude Code uses');
ok(Y.credentialOf({ ...env, ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't' }).kind === 'api', 'an API key beats everything');
ok(Y.credentialOf({ ...env, CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CONFIG_DIR: join(A, 'hulu') }).kind === 'oauth_token', 'a token beats the config dir login');
ok(Y.credentialOf({ ...env, CLAUDE_CONFIG_DIR: join(A, 'hulu') }).key === 'fake-hulu', 'otherwise the config dir\'s login');

console.log('learning org ids');
ok(Y.learn(ORG_MOSES, 'Moses@Example.com', env) && Y.loadOrgs(env)[ORG_MOSES] === 'moses@example.com', 'an org id and its email are kept');
ok(!Y.learn('not-a-uuid', 'x@example.com', env) && !Y.learn(ORG_HULU, 'not an email', env), 'nothing malformed is kept');
ok(!/fake-/.test(read(Y.orgsFile(env))), 'orgs.json holds no credential');
Y.learn(ORG_HULU, 'hulu@example.com', env);

console.log('identify');
const status = (j) => () => j;
let r = await Y.identify({ account: 'moses', email: 'moses@example.com' }, env, { status: status({ loggedIn: true, authMethod: 'claude.ai', email: 'moses@example.com', orgId: ORG_MOSES }) });
ok(r.state === 'ok' && r.account === 'moses' && r.email === 'moses@example.com', 'the picked login, confirmed by email');
r = await Y.identify({ account: 'hulu', email: 'hulu@example.com' }, { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'fake-moses-setup-token' },
  { status: status({ loggedIn: true, authMethod: 'oauth_token' }), probe: fakeProbe({ 'fake-moses-setup-token': { http: 200, orgId: ORG_MOSES } }) });
ok(r.state === 'mismatch' && r.account === 'moses' && r.email === 'moses@example.com' && r.picked === 'hulu', 'a token from another login: mismatch, named by its org');
r = await Y.identify({ account: 'hulu', email: 'hulu@example.com' }, { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'fake-hulu-token' },
  { status: status({ loggedIn: true, authMethod: 'oauth_token' }), probe: fakeProbe({ 'fake-hulu-token': { http: 200, orgId: ORG_HULU } }) });
ok(r.state === 'ok' && r.account === 'hulu', 'a token from the right login: ok');
r = await Y.identify({ account: 'hulu', email: 'hulu@example.com' }, env, { status: status({ loggedIn: false, authMethod: 'none' }) });
ok(r.state === 'dead', 'not signed in: dead');
r = await Y.identify({ account: 'hulu', email: 'hulu@example.com' }, { ...env, CLAUDE_CODE_OAUTH_TOKEN: 'revoked' }, { status: status({ loggedIn: true, authMethod: 'oauth_token' }), probe: fakeProbe({ revoked: { http: 401, orgId: '' } }) });
ok(r.state === 'dead' && /401/.test(r.why), 'a refused token: dead');
const old = join(tmp, 'old'); mkdirSync(old); writeFileSync(join(old, '.credentials.json'), creds('old', 1));
r = await Y.identify({ account: 'hulu', email: 'hulu@example.com' }, { ...env, CLAUDE_CONFIG_DIR: old }, { status: status({ loggedIn: true, authMethod: 'claude.ai' }), probe: fakeProbe({ 'fake-old': { http: 401, orgId: '' } }) });
ok(r.state === 'unverified', 'an expired access token Claude Code would refresh is not called dead');
r = await Y.identify({ account: 'hulu', email: 'hulu@example.com' }, env, { status: () => null, probe: fakeProbe({}) });
ok(r.state === 'unverified', 'no answer at all: unverified, never a guess');
r = await Y.identify({ account: 'shared' }, env, { status: status({ loggedIn: true, authMethod: 'claude.ai', email: 'moses@example.com' }) });
ok(r.state === 'ok' && r.account === 'moses', 'the shared login is named after the saved account it is');
ok((await Y.identify({ account: 'hulu' }, { ...env, AXF_WHOAMI: 'off' })).state === 'unverified', 'AXF_WHOAMI=off skips it');

console.log('mismatch record and alert');
X.markMismatch('hulu', { real: 'moses', email: 'moses@example.com', session: 's1' }, env);
const row = X.status(env).accounts.find((a) => a.name === 'hulu');
ok(row.mismatch?.real === 'moses', 'claude-workers status shows it on the picked account');
const al = R.alerts({}, X.status(env).accounts);
ok(al.some((a) => a.account === 'hulu' && a.kind === 'login' && a.level === 'error' && /moses@example\.com/.test(a.text)), 'and the alerts (Claude accounts, systems check) raise it');
rmSync(join(W, 'worker-state.json'));

console.log('cost goes to the real login');
const led = X.ledger([
  { event: 'session-login', session: 's2', account: 'moses', picked: 'hulu', mismatch: true, at: '2026-11-09T10:00:00Z' },
  { event: 'session-end', session: 's2', costUsd: 3, at: '2026-11-09T11:00:00Z' },
]);
ok(led.moses?.runs[0]?.costUsd === 3 && !led.hulu, 'a mismatched run is charged to the login that ran it');

console.log('backfill');
writeFileSync(join(HD, 'events.jsonl'), [
  { event: 'session-login', session: 'old', account: 'hulu', at: '2026-11-08T10:00:00Z' },
  { event: 'session-login', session: 'today', account: 'hulu', email: 'hulu@example.com', at: '2026-11-09T10:00:00Z' },
  { event: 'session-end', session: 'today', costUsd: 7, at: '2026-11-09T11:00:00Z' },
  { event: 'session-login', session: 'other', account: 'moses', at: '2026-11-09T10:00:00Z' },
].map((x) => JSON.stringify(x)).join('\n') + '\nnot json\n');
const dry = Y.backfill({ picked: 'hulu', real: 'moses', email: 'moses@example.com', since: '2026-11-09T00:00:00Z' }, env);
ok(dry.changed === 1 && !dry.applied && /"account":"hulu","email":"hulu@example.com"/.test(read(join(HD, 'events.jsonl'))), 'a dry run changes nothing');
const done = Y.backfill({ picked: 'hulu', real: 'moses', email: 'moses@example.com', since: '2026-11-09T00:00:00Z', apply: true, reason: 'token is moses' }, env);
const evs = read(join(HD, 'events.jsonl')).split('\n');
ok(done.applied && done.sessions.join() === 'today', 'only runs in the window are re-attributed');
ok(JSON.parse(evs[1]).account === 'moses' && JSON.parse(evs[1]).picked === 'hulu' && JSON.parse(evs[1]).backfilled.reason === 'token is moses', 'with what was picked and why');
ok(JSON.parse(evs[0]).account === 'hulu' && evs.includes('not json'), 'everything else stays as it was');
ok(X.ledger(evs.flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })).moses.runs.some((r) => r.costUsd === 7), 'its cost now counts on moses');
ok(spawnSync('ls', [HD], { encoding: 'utf8' }).stdout.includes('events.jsonl.bak-'), 'a backup is kept');
rmSync(HD, { recursive: true, force: true }); mkdirSync(HD);

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
if (hasTmux) {
  console.log('end to end (claude-headless.sh, fake claude, fake count_tokens)');
  // count_tokens: the org of each fake credential (headers only, like the real one)
  const orgOf = { 'fake-moses-setup-token': ORG_MOSES, 'fake-moses': ORG_MOSES };
  const server = createServer((req, res) => {
    const key = String(req.headers.authorization || '').replace(/^Bearer /, '') || String(req.headers['x-api-key'] || '');
    req.resume();
    if (!orgOf[key]) { res.writeHead(401); res.end('{}'); return; }
    res.writeHead(200, { 'anthropic-organization-id': orgOf[key], 'content-type': 'application/json' }); res.end('{"input_tokens":1}');
  });
  await new Promise((ok2) => server.listen(0, '127.0.0.1', ok2));
  const url = `http://127.0.0.1:${server.address().port}`;
  const home = join(tmp, 'home'); const bin = join(home, '.local', 'bin'); mkdirSync(bin, { recursive: true });
  const sock = join(tmp, 'tmux'); mkdirSync(sock);
  // auth status: a token login has no email; a dead login is not signed in. A run records nothing secret.
  writeFileSync(join(bin, 'claude'), `#!/bin/bash
who="$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.env.CLAUDE_CONFIG_DIR+"/.credentials.json")).claudeAiOauth.accessToken)}catch{console.log("")}')"
if [ "$1" = auth ]; then
  if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then echo '{"loggedIn":true,"authMethod":"oauth_token"}'
  elif [ "$who" = fake-gone ]; then echo '{"loggedIn":false,"authMethod":"none"}'
  else echo '{"loggedIn":true,"authMethod":"claude.ai"}'; fi
  exit 0
fi
echo ran >> "$PWD/attempts"
echo '{"type":"result","result":"done","total_cost_usd":2.5}'
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const runEnv = { ...env, HOME: home, PATH: `${bin}:${process.env.PATH}`, TMUX_TMPDIR: sock, AXF_SLOTS: 'off', AXF_AGENT_BOOK: 'off', AXF_WATCH_LIVE: 'off', AXF_LOOK_GATE: 'off',
    AXF_ORIGIN: 'off', AXF_LOGIN_NOTE: 'off', AXF_TOKEN: '', AXF_WORKERS: 'off', AXF_ACCOUNT_SWITCHES: '0', AXF_WHOAMI_URL: url };
  for (const k of ['TMUX', 'CLAUDE_CONFIG_DIR', 'AXF_AGENT', 'AXF_AGENT_NAME', 'AXF_AGENT_BOOKED', 'AXF_SESSION', 'AXHUB_TOKEN', 'AXF_CLAUDE_ACCOUNT', 'AXF_MODEL', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']) delete runEnv[k];
  const launch = (dir, name, account) => { mkdirSync(dir); writeFileSync(join(dir, 'brief.md'), 'Do the thing.\n');
    return spawnSync('bash', [join(HERE, 'claude-headless.sh'), '--name', name, '--account', account, '--brief', 'brief.md', '--log', 'run.log', '--'], { cwd: dir, env: runEnv, encoding: 'utf8', timeout: 30_000 }); };
  const events = () => read(join(HD, 'events.jsonl')).split('\n').filter(Boolean).map((x) => JSON.parse(x));

  const d1 = join(tmp, 'b1');
  const r1 = launch(d1, 'wrong-login', 'hulu');
  ok(/started/.test(r1.stdout), `a run picked for hulu starts: ${r1.stdout}${r1.stderr}`.slice(0, 200));
  ok(await until(() => events().some((e) => e.event === 'session-end' && e.name === 'wrong-login')), 'it ends');
  const log1 = read(join(d1, 'run.log'));
  ok(/^# login moses \(moses@example\.com\) · own copy \(saved\) · MISMATCH: picked hulu \(hulu@example\.com\), Claude Code is signed in as moses \(moses@example\.com\); cost counts on moses$/m.test(log1), 'the log header names the real login and the mismatch');
  const login1 = events().find((e) => e.event === 'session-login' && e.name === 'wrong-login');
  ok(login1?.account === 'moses' && login1.email === 'moses@example.com' && login1.picked === 'hulu' && login1.mismatch === true, 'the run record carries the real login and what was picked');
  const st = X.status(env).accounts;
  ok(st.find((a) => a.name === 'hulu').mismatch?.real === 'moses', 'claude-workers flags hulu');
  ok(st.find((a) => a.name === 'hulu').runsToday === 0 && st.find((a) => a.name === 'moses').runsToday === 1, 'the run counts on moses, not hulu');

  const d2 = join(tmp, 'b2');
  launch(d2, 'dead-login', 'gone');
  ok(await until(() => events().some((e) => e.event === 'session-end' && e.name === 'dead-login')), 'a run on a dead login ends');
  ok(!read(join(d2, 'attempts')), 'claude never ran on another login');
  ok(/no usable Claude login/.test(read(join(d2, 'run.log'))), 'it says so in the log');
  ok(events().find((e) => e.event === 'session-end' && e.name === 'dead-login')?.exit === 4, 'and ends with exit 4');
  ok(X.status(env).accounts.find((a) => a.name === 'gone').limited?.kind === 'auth', 'the dead account is taken out');
  ok(!events().some((e) => e.event === 'session-login' && e.name === 'dead-login'), 'no account is charged for it');
  ok(!/fake-/.test(read(join(HD, 'events.jsonl')) + log1 + read(join(d2, 'run.log'))), 'no credential in the events or the logs');
  spawnSync('tmux', ['kill-server'], { env: runEnv });
  server.close();
} else console.log('(tmux missing: skipped the end-to-end checks)');

rmSync(tmp, { recursive: true, force: true });
console.log(`✓ claude-whoami: ${passed} checks passed`);
