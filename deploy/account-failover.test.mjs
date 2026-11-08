#!/usr/bin/env node
/**
 * account-failover-notify: a build that dies on an account's login, limit or credits moves to the next account, Brett
 * gets a phone alert saying which account, what failed, where the build went and what to do, and every token renewal
 * lands in that login's one home. Fake accounts, fake tokens and a fake claude only.
 *
 *   node deploy/account-failover.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const ok = (v, what) => { if (!v) { console.error(`✗ ${what}`); process.exit(1); } passed += 1; console.log(`  ✓ ${what}`); };
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const until = async (fn, ms = 30_000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };

const tmp = mkdtempSync(join(tmpdir(), 'axf-failover-test-'));
const A = join(tmp, 'accounts'); const SH = join(tmp, 'claude-home'); const W = join(tmp, 'workers'); const HD = join(tmp, 'headless');
const ALERTS = join(tmp, 'alerts.jsonl');
for (const d of [SH, W, HD]) mkdirSync(d, { recursive: true });
const pair = (r, exp = 1000) => ({ claudeAiOauth: { accessToken: `fake-access-${r}`, refreshToken: `fake-refresh-${r}`, expiresAt: exp, subscriptionType: 'max' }, mcpOAuth: { keep: 'me' } });
const put = (f, r, exp) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(pair(r, exp)), { mode: 0o600 }); };
const rt = (f) => JSON.parse(read(f) || '{}')?.claudeAiOauth?.refreshToken || '';
const home = (n) => join(A, n, '.credentials.json');
const seed = () => {
  rmSync(A, { recursive: true, force: true });
  for (const n of ['console', 'w1', 'w2']) put(home(n), `${n}-0`);
  writeFileSync(join(A, '.active'), 'console\n');
  put(join(SH, '.credentials.json'), 'console-0');
  writeFileSync(join(SH, 'settings.json'), '{}');
  writeFileSync(join(W, 'workers.json'), JSON.stringify({ $axf: 'claude-workers@1', workers: ['w1', 'w2'] }));
  rmSync(join(W, 'worker-state.json'), { force: true }); rmSync(ALERTS, { force: true }); rmSync(join(W, 'account-events.jsonl'), { force: true });
};
const ENV = { AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: SH, AXF_CLAUDE_GLOBAL: join(tmp, 'g.json'), AXF_CLAUDE_SEEN: join(W, 'seen.json'), AXF_CLAUDE_WORKERS: W, AXF_HEADLESS_DIR: HD, AXF_ACCOUNT_ALERTS: `file:${ALERTS}`, AXF_CLAUDE_BUILDS: tmp, AXF_WORKERS_ALIVE: '' };
Object.assign(process.env, ENV);
const X = await import('./claude-workers.mjs');
const H = await import('./claude-home.mjs');
const T = await import('./claude-token-save.mjs');
const L = await import('./claude-login.mjs');
const env = { ...process.env };
const alerts = () => read(ALERTS).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const now = Date.parse('2026-11-08T16:33:00Z');
const DEAD = 'Failed to authenticate: OAuth session expired and could not be refreshed';

console.log('what stopped a run');
ok(X.hitOf(DEAD, 1) === 'auth', 'the Nov 8 message is a dead login (the old pattern missed it)');
ok(X.hitOf(`# login w1\n${DEAD}\n■ success · 1 s`, 0) === 'auth', 'even when claude exits 0: it opened with "Failed to authenticate:"');
ok(X.hitOf('Your credit balance is too low to access the Anthropic API', 1) === 'credits', 'no credits is its own kind');
ok(X.hitOf("You've hit your weekly limit · resets Nov 10, 2am", 0) === 'usage', 'a limit');
ok(X.hitOf('the doc mentions Failed to authenticate: somewhere', 0) === '', 'those words mid-line in a finished run are nothing');

console.log('a dead login stays out until it is signed in again');
seed();
const l = X.markLimit('w1', { kind: 'auth', text: DEAD }, env, now);
ok(l.untilSignin && l.reason === 'login expired and could not be renewed', 'marked: until signed in again');
ok(X.status(env, now + 3600e3).accounts.find((a) => a.name === 'w1').limited, 'still out an hour later (the old 10 minutes sent the next build into it again)');
ok(X.route({}, env, now + 3600e3) === 'w2', 'jobs skip it');
put(home('w1'), 'w1-signed-in-again');
ok(!X.status(env, now + 3600e3).accounts.find((a) => a.name === 'w1').limited, 'back the moment the account holds a new login');
ok((await X.revive(env, now + 3600e3)).join() === 'w1', 'the sweep takes it out of the limits');
ok(alerts().some((a) => a.path === '/api/alerts/resolve' && a.payload.keys.includes('claude-accounts:account:w1:auth')), 'and resolves its phone alert');
ok(X.markLimit('w2', { kind: 'auth', text: 'authentication_error (500)' }, env, now).untilSignin === undefined, 'a passing auth error keeps the short retry');

console.log('auth fail → failover → notify');
seed();
let r = await X.failover({ session: 's1', account: 'w1', text: DEAD, exit: 1, build: 'memory-manager' }, env, now);
ok(r.action === 'move' && r.to === 'w2' && r.hit === 'auth', `moves to the next account: ${JSON.stringify(r)}`);
let a = alerts().filter((x) => x.path === '/api/alerts').at(-1)?.payload;
ok(a?.source === 'claude-accounts' && a.key === 'claude-accounts:account:w1:auth' && a.severity === 'error', 'a phone alert, keyed per account and problem');
ok(/w1/.test(a.title) && /login expired/.test(a.title), `says which account and what failed: ${a.title}`);
ok(/memory-manager moved to w2/.test(a.body) && /Sign w1 in again/.test(a.body), `which build moved where and what to do: ${a.body}`);
ok(a.link === 'view:claude-accounts' && a.meta.movedTo === 'w2', 'opens the Claude accounts screen');
ok(JSON.parse(read(join(W, 'worker-state.json'))).claims.s1?.account === 'w2', 'the session holds a slot on w2');
const evs = read(join(W, 'account-events.jsonl')).split('\n').filter(Boolean).map((x) => JSON.parse(x));
ok(evs.some((e) => e.action === 'out' && e.account === 'w1') && evs.some((e) => e.action === 'move' && e.to === 'w2'), 'the account events log has it');

console.log('limit → failover; nobody left → wait, or stop');
r = await X.failover({ session: 's2', account: 'w2', text: "You've hit your limit · resets 9pm (UTC)", exit: 1, build: 'b2' }, env, now);
ok(r.action === 'move' && r.to === 'console', 'every worker out = the console\'s account (interactive takes jobs)');
a = alerts().at(-1).payload;
ok(a.severity === 'warning' && /comes back by itself/.test(a.body), `a limit: nothing to do, it comes back: ${a.body}`);
r = await X.failover({ session: 's3', account: 'console', text: 'Your credit balance is too low', exit: 1, build: 'b3' }, env, now);
ok(r.action === 'wait' && r.hit === 'credits', 'every account out = the run waits for one instead of dying');
ok(/Top up credits/.test(alerts().at(-1).payload.body), 'credits: top up, or wait');
X.editConfig((c) => { c.failover = { ...c.failover, waitMinutes: 0 }; }, env);
r = await X.failover({ session: 's4', account: 'console', text: DEAD, exit: 1, build: 'b4' }, env, now);
ok(r.action === 'stop' && alerts().at(-1).payload.meta.stopped === true && /no account left/.test(alerts().at(-1).payload.body), 'waiting off: it stops, and the alert says so');
ok((await X.failover({ session: 's5', account: 'w1', text: 'tests failed', exit: 1 }, env, now)).action === 'none', 'a plain failure is not an account problem');
X.editConfig((c) => { c.failover = { ...c.failover, enabled: false }; }, env);
ok((await X.failover({ session: 's6', account: 'w1', text: DEAD, exit: 1 }, env, now)).action === 'stop', 'failover off: stop (still alerted)');
X.editConfig((c) => { c.failover = { ...c.failover, alerts: false }; }, env);
const nAlerts = alerts().length;
X.markLimit('w1', { kind: 'usage' }, env, now);
(await import('./account-alerts.mjs')).raise({ account: 'w1', kind: 'usage' }, env);
ok(alerts().length === nAlerts, 'alerts off: no phone alert');

console.log('one home per login');
seed();
const b1 = join(tmp, 'b1'); const b2 = join(tmp, 'b2'); mkdirSync(b1); mkdirSync(b2);
const s1 = L.snapshot({ dir: b1, session: 's1', account: 'w1', env }); const s2 = L.snapshot({ dir: b2, session: 's2', account: 'w1', env });
put(join(s1.dir, '.credentials.json'), 'w1-1', 2000);   // build 1 renews: its copy rotated
T.saveBack(s1.dir);
ok(rt(home('w1')) === 'fake-refresh-w1-1', 'a renewal in one build goes home at once');
const m = H.meta('w1', env);
ok(m.lastRefreshAt && /build/.test(m.lastRefreshBy) && m.lineage.length === 2, `the home records when and who: ${m.lastRefreshBy}`);
T.saveBack(s2.dir);
ok(rt(join(s2.dir, '.credentials.json')) === 'fake-refresh-w1-1', 'the other build on that login is pulled forward (it would have renewed with a spent token)');
ok(JSON.parse(read(join(s2.dir, '.credentials.json'))).mcpOAuth?.keep === 'me', 'its other fields are kept');
ok(rt(home('w2')) === 'fake-refresh-w2-0' && rt(home('console')) === 'fake-refresh-console-0', 'no other login is touched');
ok(H.audit(env).filter((x) => x.owner === 'w1').every((x) => x.state === 'in step'), 'audit: every copy of w1 in step');
const odd = join(tmp, 'b3', '.axf-claude', 's3'); mkdirSync(odd, { recursive: true });
writeFileSync(join(odd, 'build-login.json'), JSON.stringify({ $axf: 'build-login@1', account: 'w1', session: 's3' }));
put(join(odd, '.credentials.json'), 'stranger', 9999);
ok(H.syncMirror(join(odd, '.credentials.json'), 'w1', { chain: [] }, env) === 'foreign' && rt(home('w1')) === 'fake-refresh-w1-1', 'a token with no lineage in common never goes into the home');
ok(rt(join(odd, '.credentials.json')) === 'fake-refresh-stranger', 'nor is it overwritten');
ok(H.audit(env).some((x) => x.session === 's3' && x.state === 'foreign'), 'audit: it shows as foreign');
put(join(odd, '.credentials.json'), 'w1-0', 1000);
ok(H.audit(env).some((x) => x.session === 's3' && x.state === 'behind' && x.owner === 'w1'), 'audit: a copy on a spent token shows as behind');
rmSync(join(tmp, 'b3'), { recursive: true, force: true });
L.release({ dir: b1, session: 's1' }); L.release({ dir: b2, session: 's2' });

console.log('the live login and its home, both ways');
seed();
T.sweep(env);   // learns the live token (it is the console account's)
put(join(SH, '.credentials.json'), 'console-1', 2000);
T.sweep(env);
ok(rt(home('console')) === 'fake-refresh-console-1', 'the console\'s own renewal goes home');
put(home('console'), 'console-2', 3000); H.adopt('console', JSON.parse(read(home('console'))).claudeAiOauth, { chain: [T.tokenHash('fake-refresh-console-1')], by: 'test' }, env);
const hm = JSON.parse(read(join(A, 'console', '.home.json'))); hm.lineage.push(T.tokenHash('fake-refresh-console-2')); writeFileSync(join(A, 'console', '.home.json'), JSON.stringify(hm));
T.sweep(env);
ok(rt(join(SH, '.credentials.json')) === 'fake-refresh-console-2', 'a build that renewed the console\'s account is pulled into the live login');
writeFileSync(join(tmp, 'g.json'), JSON.stringify({ oauthAccount: { emailAddress: 'someone@else' } }));
put(join(SH, '.credentials.json'), 'someone-else', 5000);
T.sweep(env);
ok(rt(home('console')) === 'fake-refresh-console-2', 'a new sign-in on the live login (another email) never overwrites a home');

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
if (hasTmux) {
  console.log('end to end (claude-headless.sh, fake claude)');
  seed();
  const hh = join(tmp, 'home'); const bin = join(hh, '.local', 'bin'); mkdirSync(bin, { recursive: true });
  const sock = join(tmp, 'tmux'); mkdirSync(sock, { recursive: true });
  // w1's login is dead (dies in a second, like account-1 on Nov 8); w2 renews its token mid-run and finishes
  writeFileSync(join(bin, 'claude'), `#!/bin/bash
f="$CLAUDE_CONFIG_DIR/.credentials.json"
who="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).claudeAiOauth.refreshToken)' "$f")"
echo "$who" >> "$PWD/attempts"
if [ "$who" = "fake-refresh-w1-0" ]; then echo "${DEAD}"; exit 1; fi
node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1]));d.claudeAiOauth={...d.claudeAiOauth,accessToken:"fake-access-w2-1",refreshToken:"fake-refresh-w2-1",expiresAt:5000};fs.writeFileSync(process.argv[1]+".t",JSON.stringify(d));fs.renameSync(process.argv[1]+".t",process.argv[1])' "$f"
sleep 4
echo finished
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const runEnv = { ...env, HOME: hh, PATH: `${bin}:${process.env.PATH}`, TMUX_TMPDIR: sock, AXF_SLOTS: 'off', AXF_AGENT_BOOK: 'off', AXF_WATCH_LIVE: 'off', AXF_LOOK_GATE: 'off', AXF_ORIGIN: 'off', AXF_LOGIN_NOTE: 'off', AXF_TOKEN: '' };
  for (const k of ['TMUX', 'CLAUDE_CONFIG_DIR', 'AXF_AGENT', 'AXF_AGENT_NAME', 'AXF_AGENT_BOOKED', 'AXF_SESSION', 'AXHUB_TOKEN', 'AXF_CLAUDE_ACCOUNT', 'AXF_MODEL', 'AXF_WORKERS_ALIVE']) delete runEnv[k];
  const w = join(tmp, 'build'); mkdirSync(w); writeFileSync(join(w, 'brief.md'), 'Do the thing.\n');
  // asked for w1 by name: the failover still moves it (the old code only moved worker-routed runs)
  const res = spawnSync('bash', [join(HERE, 'claude-headless.sh'), '--name', 'job', '--account', 'w1', '--brief', 'brief.md', '--log', 'run.log', '--'], { cwd: w, env: runEnv, encoding: 'utf8', timeout: 30_000 });
  ok(/started/.test(res.stdout), `the launcher starts it: ${res.stdout}${res.stderr}`.slice(0, 200));
  ok(await until(() => /"session-end"/.test(read(join(HD, 'events.jsonl')))), 'the run ends');
  ok(read(join(w, 'attempts')).trim().split('\n').join() === 'fake-refresh-w1-0,fake-refresh-w2-0', 'dead login on w1, then the same build again on w2');
  ok(/finished/.test(read(join(w, 'run.log'))), 'and it finished there');
  const al = alerts().filter((x) => x.path === '/api/alerts').map((x) => x.payload);
  ok(al.some((x) => x.key === 'claude-accounts:account:w1:auth' && /moved to w2/.test(x.body) && /Sign w1 in again/.test(x.body)), 'Brett got the alert: w1 login expired, job moved to w2, sign w1 in');
  ok(X.status(env).accounts.find((x) => x.name === 'w1').limited?.untilSignin, 'w1 is out until signed in');
  ok(await until(() => rt(home('w2')) === 'fake-refresh-w2-1'), 'w2\'s renewal during the run landed in its one home');
  ok(H.meta('w2', env).lastRefreshAt !== '', 'with the time of the last refresh');
  ok(read(join(A, '.active')).trim() === 'console' && rt(join(SH, '.credentials.json')) === 'fake-refresh-console-0', 'the console\'s account and live login never changed');
  ok(!/fake-(refresh|access)/.test(read(join(HD, 'events.jsonl')) + read(ALERTS) + read(join(W, 'account-events.jsonl'))), 'no credential in events, alerts or the account log');
  spawnSync('tmux', ['kill-server'], { env: runEnv });
} else console.log('(tmux missing: skipped the end-to-end checks)');

rmSync(tmp, { recursive: true, force: true });
console.log(`✓ account-failover: ${passed} checks passed`);
