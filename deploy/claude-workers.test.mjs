#!/usr/bin/env node
/**
 * multi-account-headless-workers: worker routing, limits, the ledger, sign-in and remove, then claude-headless.sh end to
 * end with a fake claude: a job goes to a worker, the worker hits its limit, the run moves on, the console's account
 * never changes, and the cost lands per account.
 *
 *   node deploy/claude-workers.test.mjs
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
const until = async (fn, ms = 25_000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };

const tmp = mkdtempSync(join(tmpdir(), 'axf-workers-test-'));
const A = join(tmp, 'accounts'); const SH = join(tmp, 'claude-home'); const W = join(tmp, 'workers'); const HD = join(tmp, 'headless');
for (const d of [SH, W, HD]) mkdirSync(d, { recursive: true });
const creds = (s) => JSON.stringify({ claudeAiOauth: { accessToken: `fake-${s}`, refreshToken: `fake-${s}-r` } });
for (const n of ['console', 'w1', 'w2', 'w3']) { mkdirSync(join(A, n), { recursive: true }); writeFileSync(join(A, n, '.credentials.json'), creds(n)); }
mkdirSync(join(A, 'keyonly'), { recursive: true }); writeFileSync(join(A, 'keyonly', 'apikey'), 'fake-api-key');
writeFileSync(join(A, 'w3', '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'w3@example.com' } }));
writeFileSync(join(A, '.active'), 'console\n');
writeFileSync(join(SH, '.credentials.json'), creds('console'));
writeFileSync(join(SH, 'settings.json'), '{}');
const ENV = { AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: SH, AXF_CLAUDE_GLOBAL: join(tmp, 'g.json'), AXF_CLAUDE_SEEN: join(W, 'seen.json'), AXF_CLAUDE_WORKERS: W, AXF_HEADLESS_DIR: HD };
Object.assign(process.env, ENV);
const X = await import('./claude-workers.mjs');
const env = { ...process.env };
const setWorkers = (names) => writeFileSync(join(W, 'workers.json'), JSON.stringify({ $axf: X.SCHEMA, workers: names }));
const events = (lines) => writeFileSync(join(HD, 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
const now = Date.parse('2026-11-07T12:00:00Z');

console.log('reset times');
ok(new Date(X.parseReset("You've hit your limit · resets 3pm (UTC)", now)).toISOString() === '2026-11-07T15:00:00.000Z', 'today, later');
ok(new Date(X.parseReset('resets 2:30am', now)).toISOString() === '2026-11-08T02:30:00.000Z', 'already past = tomorrow');
ok(new Date(X.parseReset('You hit your weekly limit, resets Nov 10, 2am', now)).toISOString() === '2026-11-10T02:00:00.000Z', 'a date');
ok(new Date(X.parseReset('resets Jan 2, 12pm', now)).toISOString() === '2027-01-02T12:00:00.000Z', 'a date past this year = next year');
ok(X.parseReset('no time here', now) === 0 && X.parseReset('resets Foo 3, 2am', now) === 0, 'no time = 0');

console.log('what stopped a run');
ok(X.hitOf("You've hit your weekly limit", 0) === 'usage', 'a limit');
ok(X.hitOf('Invalid API key · please run /login', 1) === 'auth', 'a dead login on a failed exit');
ok(X.hitOf('the docs say: please run /login', 0) === '', 'those words in a run that finished are nothing');
ok(X.hitOf('all done', 1) === '', 'a plain failure is not a limit');

console.log('routing');
// Nov 8 2026: every saved subscription login is a worker by default, and the console's account takes jobs after them
ok(X.route({}, env, now) === 'w1', 'no config = every subscription login is a worker');
const s00 = X.status(env, now);
ok(s00.accounts.find((a) => a.name === 'keyonly').role === 'api-off', 'an API-key account is not a worker until it is set up as one');
setWorkers(['w2', 'w1']);
ok(X.route({}, env, now) === 'w2', 'workers.json orders them');
setWorkers([]); writeFileSync(join(W, 'workers.json'), JSON.stringify({ $axf: X.SCHEMA, excluded: ['w1', 'w2', 'w3'] }));
ok(X.route({}, env, now) === 'console', 'every worker stopped = the console\'s own account takes it (setting on)');
writeFileSync(join(W, 'workers.json'), JSON.stringify({ $axf: X.SCHEMA, excluded: ['w1', 'w2', 'w3'], interactiveTakesJobs: false }));
ok(X.route({}, env, now) === '', 'and nothing when that setting is off');
setWorkers(['w1', 'w2', 'console', 'keyonly', 'ghost']);
const s0 = X.status(env, now);
ok(s0.accounts.find((a) => a.name === 'console').role === 'interactive', 'the active account is interactive, even if marked');
ok(s0.accounts.find((a) => a.name === 'keyonly').role === 'api-off', 'an API key listed as a worker still is not one');
ok(X.route({}, env, now) === 'w1', 'first in the list when all are idle');
ok(X.route({ exclude: ['w1'] }, env, now) === 'w2', 'exclude');
const l = X.markLimit('w1', { kind: 'usage', text: 'hit your limit · resets 3pm (UTC)' }, env, now);
ok(l.until === '2026-11-07T15:00:00.000Z' && X.route({}, env, now) === 'w2', 'a limited worker is skipped until its reset');
ok(X.route({}, env, Date.parse('2026-11-07T15:00:01Z')) === 'w1', 'and comes back by itself');
ok(Date.parse(X.markLimit('w1', { kind: 'usage' }, env, now).until) === now + 5 * 3600e3, 'no time in the text = 5 hours');
ok(Date.parse(X.markLimit('w1', { kind: 'auth' }, env, now).until) === now + 600e3, 'a dead login gets another try in 10 minutes');
X.markLimit('w2', { kind: 'usage' }, env, now); X.markLimit('w3', { kind: 'usage' }, env, now);
ok(X.route({}, env, now) === 'console', 'every worker out = the console\'s own account');
X.markLimit('console', { kind: 'usage' }, env, now);
ok(X.route({}, env, now) === '', 'every account out = nothing free');
rmSync(join(W, 'worker-state.json'));

console.log('claims: 3 building per account, then a queue of 5, oldest first');
writeFileSync(join(W, 'workers.json'), JSON.stringify({ $axf: X.SCHEMA, workers: ['w1', 'w2'], excluded: ['w3'], interactiveTakesJobs: false, limits: { building: 2, queue: 1 } }));
process.env.AXF_WORKERS_ALIVE = 'j1,j2,j3,j4,j5,j6,j7';
const envA = { ...process.env };
const got = ['j1', 'j2', 'j3', 'j4'].map((j, i) => X.claim(j, {}, {}, envA, now + i));
ok(got.map((d) => `${d.state}:${d.account}`).join() === 'run:w1,run:w2,run:w1,run:w2', 'jobs spread across the workers in parallel');
const q5 = X.claim('j5', {}, {}, envA, now + 5); const q6 = X.claim('j6', {}, {}, envA, now + 6);
ok(q5.state === 'queue' && q5.position === 1 && q6.state === 'queue' && q6.account !== q5.account, 'full = a place in an account\'s queue');
ok(X.claim('j7', {}, {}, envA, now + 7).state === 'none', 'every queue full = none');
ok(X.status(envA, now).accounts.find((a) => a.name === 'w1').running.length === 2, 'claims count as running');
X.release('j1', envA);
ok(X.claim('j6', {}, {}, envA, now + 8).state === (q6.account === 'w1' ? 'run' : 'queue'), 'a freed slot goes to the job waiting for that account');
ok(X.claim('j5', {}, {}, envA, now + 9).state === (q5.account === 'w1' ? 'run' : 'queue'), 'a re-asked queue claim keeps its place');
process.env.AXF_WORKERS_ALIVE = 'j2';
ok(X.status({ ...process.env }, now).accounts.find((a) => a.name === 'w1').running.length === 0, 'a claim goes with its session');
delete process.env.AXF_WORKERS_ALIVE;
rmSync(join(W, 'worker-state.json'));

console.log('config: rules, API workers, spend caps');
const cli = (...a) => spawnSync(process.execPath, [join(HERE, 'claude-workers.mjs'), ...a], { env: process.env, encoding: 'utf8' });
writeFileSync(join(W, 'workers.json'), JSON.stringify({ $axf: X.SCHEMA }));
ok(cli('api', 'add', 'keyonly', '--label', 'Hulu API', '--daily', '10', '--weekly', '50').status === 0, 'an API worker slot with caps');
ok(cli('api', 'add', 'other', '--label', 'X').status === 2, 'an API worker without caps is refused (raising a cap is Brett\'s)');
ok(cli('api', 'caps', 'keyonly', '--daily', '20').status === 2 && /Brett's own click/.test(cli('api', 'caps', 'keyonly', '--daily', '20').stderr), 'a session can not raise a cap');
ok(cli('api', 'caps', 'keyonly', '--daily', '5').status === 0 && X.loadConfig(env).api.keyonly.dailyCapUsd === 5, 'but it can lower one');
ok(cli('rule', 'add', '--json', JSON.stringify({ name: 'Walkthroughs to API', to: 'api', when: { jobTypes: ['walkthrough'] } })).status === 0, 'rule add');
ok(cli('rule', 'add', '--json', JSON.stringify({ name: 'Urgent stays', to: 'subscription', when: { priorities: ['P0'] } }), '--at', '0').status === 0, 'rule add at the top');
ok(X.loadConfig(env).rules.map((r) => r.id).join() === 'urgent-stays,walkthroughs-to-api', 'order');
cli('rule', 'move', 'urgent-stays', 'down'); cli('rule', 'off', 'urgent-stays');
const rs = X.loadConfig(env).rules;
ok(rs[1].id === 'urgent-stays' && rs[1].enabled === false, 'move and switch off');
const t = JSON.parse(cli('test', '--job', JSON.stringify({ jobType: 'walkthrough', priority: 'P0' }), '--json').stdout);
ok(t.account === 'keyonly' && t.kind === 'api', `test-a-job preview: ${t.why}`);
ok(X.claim('k1', { jobType: 'walkthrough' }, {}, env, now).account === 'keyonly', 'a claim follows the rule');
X.release('k1', env);
events([{ event: 'session-login', session: 'k0', name: 'w', account: 'keyonly', at: new Date(now - 3600e3).toISOString() }, { event: 'session-end', session: 'k0', account: 'keyonly', exit: 0, costUsd: 5, at: new Date(now - 1800e3).toISOString() }]);
const capped = X.status(env, now);
ok(capped.accounts.find((a) => a.name === 'keyonly').spend.state === 'capped' && capped.alerts.some((a) => a.level === 'error'), 'at its cap: capped, with an alert');
ok(X.claim('k2', { jobType: 'walkthrough' }, {}, env, now).kind === 'subscription', 'a capped API account takes nothing more');
X.release('k2', env); rmSync(join(HD, 'events.jsonl'));
ok(cli('rule', 'remove', 'walkthroughs-to-api').status === 0 && cli('rule', 'remove', 'nope').status === 2, 'rule remove');
ok(cli('worker', 'w1', 'off').status === 0 && X.loadConfig(env).excluded.includes('w1') && X.route({}, env, now) !== 'w1', 'Stop worker');
ok(cli('worker', 'keyonly', 'on').status === 2, 'an API key is not made a worker that way');
ok(cli('set', 'building', '4').status === 0 && X.loadConfig(env).limits.building === 4, 'set building');
setWorkers(['w1', 'w2']);

console.log('ledger');
const ev = [
  { event: 'session-start', session: 's1', name: 'b1' },
  { event: 'session-login', session: 's1', name: 'b1', agent: 'R', model: 'opus', account: 'w1', at: '2026-11-07T10:00:00Z' },
  { event: 'session-part', session: 's1', account: 'w1', costUsd: 2, at: '2026-11-07T10:30:00Z' },
  { event: 'session-login', session: 's1', name: 'b1', agent: 'R', model: 'opus', account: 'w2', at: '2026-11-07T10:31:00Z' },
  { event: 'session-end', session: 's1', account: 'w2', exit: 0, costUsd: 3.5, at: '2026-11-07T11:00:00Z' },
  { event: 'session-login', session: 's2', name: 'b2', account: 'w2', at: '2026-11-07T11:30:00Z' },
  { event: 'session-login', session: 'gone', name: 'b3', account: 'w1', at: '2026-11-01T11:30:00Z' },
];
const led = X.ledger(ev, { cost: () => 1, alive: new Set(['s2']) });
ok(led.w1.runs[0].costUsd === 2 && led.w2.runs[0].costUsd === 1.5, 'a run that moved is booked on each account for what it cost there');
ok(led.w2.running.join() === 's2' && led.w1.running.length === 0, 'running = still alive; a dead session never holds a worker');
events(ev);
ok(X.noteFor('s1', env) === 'Worker accounts: w1: 1 run, $2.00; w2: 1 run, $1.50', 'the note for the build');
const s1 = X.status(env, now).accounts.find((a) => a.name === 'w1');
ok(s1.costToday === 2 && s1.runsToday === 1 && s1.recent[0].name === 'b1', 'cost and runs per account');
ok(X.status(env, now).accounts.find((a) => a.name === 'w3').email === 'w3@example.com', 'email from the account\'s own folder');

console.log('remove');
ok(/is the console's account/.test((() => { try { X.remove('console', env, now); } catch (e) { return e.message; } return ''; })()), 'never the console\'s account');
const to = X.remove('w3', env, now);
ok(!existsSync(join(A, 'w3')) && existsSync(join(to, '.credentials.json')), 'moved aside, nothing deleted');
ok(!X.status(env, now).accounts.some((a) => a.name === 'w3'), 'gone from the list');
ok(spawnSync(process.execPath, [join(HERE, 'claude-workers.mjs'), 'signin', '../evil'], { env, encoding: 'utf8' }).status === 2, 'a bad name is refused');

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
if (hasTmux) {
  console.log('end to end (claude-headless.sh, fake claude)');
  rmSync(join(HD, 'events.jsonl'));
  const home = join(tmp, 'home'); const bin = join(home, '.local', 'bin'); mkdirSync(bin, { recursive: true });
  const sock = join(tmp, 'tmux'); mkdirSync(sock);
  // first account limited, the next one finishes; records the login each attempt ran on
  writeFileSync(join(bin, 'claude'), `#!/bin/bash
who="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.CLAUDE_CONFIG_DIR+"/.credentials.json")).claudeAiOauth.accessToken)')"
echo "$who" >> "$PWD/attempts"
if [ "$who" = "fake-w1" ]; then echo "You've hit your limit · resets 3pm (UTC)"; exit 1; fi
echo finished
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const runEnv = { ...env, HOME: home, PATH: `${bin}:${process.env.PATH}`, TMUX_TMPDIR: sock, AXF_SLOTS: 'off', AXF_AGENT_BOOK: 'off', AXF_WATCH_LIVE: 'off', AXF_LOOK_GATE: 'off', AXF_ORIGIN: 'off', AXF_LOGIN_NOTE: 'off', AXF_TOKEN: '', AXF_WHOAMI: 'off' };
  for (const k of ['TMUX', 'CLAUDE_CONFIG_DIR', 'AXF_AGENT', 'AXF_AGENT_NAME', 'AXF_AGENT_BOOKED', 'AXF_SESSION', 'AXHUB_TOKEN', 'AXF_CLAUDE_ACCOUNT', 'AXF_MODEL']) delete runEnv[k];
  const w = join(tmp, 'build'); mkdirSync(w); writeFileSync(join(w, 'brief.md'), 'Do the thing.\n');
  setWorkers(['w1', 'w2']);
  const r = spawnSync('bash', [join(HERE, 'claude-headless.sh'), '--name', 'job', '--brief', 'brief.md', '--log', 'run.log', '--'], { cwd: w, env: runEnv, encoding: 'utf8', timeout: 30_000 });
  ok(/started/.test(r.stdout), `the launcher starts it: ${r.stdout}${r.stderr}`.slice(0, 200));
  ok(await until(() => /session-end/.test(read(join(HD, 'events.jsonl')))), 'the run ends');
  ok(read(join(w, 'attempts')).trim().split('\n').join() === 'fake-w1,fake-w2', 'first worker, then the next one after its limit');
  ok(read(join(A, '.active')).trim() === 'console', 'the console\'s account never changed');
  ok(read(join(SH, '.credentials.json')) === creds('console'), 'nor the live login');
  const out = X.status(env).accounts;
  ok(out.find((a) => a.name === 'w1').limited?.kind === 'usage', 'the worker that hit its limit is out');
  const lines = read(join(HD, 'events.jsonl')).split('\n').filter(Boolean).map((x) => JSON.parse(x));
  ok(lines.filter((e) => e.event === 'session-login').map((e) => e.account).join() === 'w1,w2', 'each login is recorded');
  ok(lines.some((e) => e.event === 'session-part' && e.account === 'w1'), 'the move is recorded');
  ok(!/fake-w|fake-console/.test(read(join(HD, 'events.jsonl'))), 'no credential in the events or the log');
  spawnSync('tmux', ['kill-server'], { env: runEnv });
} else console.log('(tmux missing: skipped the end-to-end checks)');

rmSync(tmp, { recursive: true, force: true });
console.log(`✓ claude-workers: ${passed} checks passed`);
