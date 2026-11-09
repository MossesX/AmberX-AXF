// Self-test: node apps/console-web/plugins/build-orchestrator/queues.test.mjs
// Build queues (multi-queues-api-panel): the pure engine (queues, moves, rules, caps) and the CLI + dispatcher end to end
// on a scratch store with fake subscription and API accounts, a fake launcher and fake spend.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Q from './queues-core.mjs';
import * as P from './pipeline-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
let n = 0; const t = (name, fn) => { try { fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const now = '2026-11-09T01:00:00.000Z';
const step = (id, model, done = false) => ({ id, uid: `u-${id}`, text: `${id} work`, model, estimate: '25 min', done, doneAt: done ? now : '', skip: false });
const build = (id, status, extra = {}) => ({ id, title: id, status, steps: [step('s1', 'Opus')], createdAt: now, updatedAt: now, notes: [], approvals: [], upgradeRequests: [], deleted: false, hidden: false, pipeline: { queuedAt: now }, ...extra });
const sub = (name, extra = {}) => ({ name, role: 'worker', plan: 'max', fable: true, parallel: 1, running: 0, free: 1, usable: true, why: '', ...extra });
const apiRow = (name, extra = {}) => ({ name, kind: 'api', role: 'api-worker', label: name.toUpperCase(), hasKey: true, building: 2, running: [], spend: { day: 0, week: 0, dayCap: 10, weekCap: 50, alertAt: 0.8, state: 'ok', why: '' }, ...extra });
const slots = { free: 6, used: 0, cap: 6 };
const ok = (d, change, owner = false) => Q.apply(d, change, { owner, now }).doc;

// ---------------- the document
t('defaults: Main (subscriptions) and API (hulu-api, mossesx-api), overflow off, a max-cost rule on', () => {
  const d = Q.defaultDoc();
  assert.deepEqual(d.queues.map((q) => [q.id, q.uses]), [['main', 'subscription'], ['api', 'api']]);
  assert.deepEqual(d.queues[1].apiAccounts, ['hulu-api', 'mossesx-api']);
  assert.equal(d.rules.find((r) => r.kind === 'overflow').enabled, false);
  assert.equal(Q.maxCostFor(d, 'api'), 5);
});
t('normDoc: junk dropped, ids unique, members only for real queues, never empty', () => {
  const d = Q.normDoc({ queues: [{ name: 'A' }, { name: 'A' }, { name: 'B', uses: 'nope', maxParallel: 99, priority: -3, costCapUsd: -1 }], members: { x: 'a', y: 'gone', 'Bad Id!': 'a' } });
  assert.deepEqual(d.queues.map((q) => q.id), ['a', 'a-2', 'b']);
  assert.equal(d.queues[2].uses, 'subscription'); assert.equal(d.queues[2].maxParallel, 12); assert.equal(d.queues[2].priority, 1); assert.equal(d.queues[2].costCapUsd, 0);
  assert.deepEqual(d.members, { x: 'a' });
  assert.equal(Q.normDoc({}).queues.length, 1);
});

// ---------------- create, rename, reorder, pause, delete
t('create / rename / reorder / pause / resume / delete', () => {
  let d = Q.defaultDoc();
  d = ok(d, { action: 'create', name: 'Night runs', maxParallel: 1, priority: 7 });
  assert.equal(d.queues[2].id, 'night-runs'); assert.equal(d.queues[2].uses, 'subscription');
  assert.throws(() => Q.apply(d, { action: 'create', name: 'night runs' }), /exists/);
  assert.throws(() => Q.apply(d, { action: 'create', name: '' }), /needs a name/);
  d = ok(d, { action: 'rename', queue: 'night-runs', name: 'Overnight' }); assert.equal(Q.findQueue(d, 'night-runs').name, 'Overnight');
  assert.equal(Q.findQueue(d, 'overnight').id, 'night-runs', 'found by name too');
  d = ok(d, { action: 'move', queue: 'night-runs', to: 'top' }); assert.deepEqual(d.queues.map((q) => q.id), ['night-runs', 'main', 'api']);
  d = ok(d, { action: 'move', queue: 'night-runs', to: 'down' }); assert.deepEqual(d.queues.map((q) => q.id), ['main', 'night-runs', 'api']);
  assert.deepEqual(Q.queues(d).map((q) => q.id), ['main', 'api', 'night-runs'], 'start order is priority, then list order');
  d = ok(d, { action: 'pause', queue: 'main' }); assert.equal(d.queues[0].paused, true);
  d = ok(d, { action: 'resume', queue: 'main' }); assert.equal(d.queues[0].paused, false);
  d = ok(d, { action: 'assign', build: 'b1', queue: 'night-runs' });
  d = ok(d, { action: 'delete', queue: 'night-runs' });
  assert.equal(d.members.b1, 'main', 'its builds move to the first subscription queue');
  assert.throws(() => Q.apply(Q.normDoc({ queues: [{ name: 'Only' }] }), { action: 'delete', queue: 'only' }), /last queue/);
});
t('deleting a queue drops the rules that point at it and switches off its max-cost rule', () => {
  let d = Q.defaultDoc();
  d = ok(d, { action: 'delete', queue: 'api' }, true);
  assert.equal(d.rules.some((r) => r.kind === 'overflow'), false);
  assert.equal(d.rules.find((r) => r.kind === 'max-cost').enabled, false);
});

// ---------------- moves
t('moves: Pending → any queue, queue → queue, back to Pending; each build in one queue', () => {
  let d = Q.defaultDoc();
  const b = build('b1', 'queued');
  assert.equal(Q.queueOf(d, b), 'main', 'no member record: the first subscription queue (migration)');
  d = ok(d, { action: 'assign', build: 'b1', queue: 'api' }); assert.equal(Q.queueOf(d, b), 'api');
  const r = Q.apply(d, { action: 'assign', build: 'b1', queue: 'main' }); assert.match(r.log[0], /API → Main/); d = r.doc;
  assert.equal(Object.values(d.members).filter((q) => q).length, 1);
  d = ok(d, { action: 'unassign', build: 'b1' }); assert.equal(d.members.b1, undefined);
  assert.throws(() => Q.apply(d, { action: 'assign', build: 'b1', queue: 'nope' }), /no queue/);
});

// ---------------- rules
t('route rules: by category or by model, first match wins, off rules skipped', () => {
  let d = Q.defaultDoc();
  d = ok(d, { action: 'create', name: 'Docs' });
  d = ok(d, { action: 'rule-add', rule: { kind: 'route', name: 'Docs builds', to: 'docs', when: { categories: ['docs'] } } });
  d = ok(d, { action: 'rule-add', rule: { kind: 'route', name: 'Fable to API', to: 'api', when: { models: ['Fable'] } } }, true);
  assert.equal(Q.queueOf(d, build('x', 'queued', { category: 'Docs' })), 'docs');
  assert.equal(Q.queueOf(d, build('y', 'queued', { steps: [step('s1', 'Fable')] })), 'api');
  assert.equal(Q.queueOf(d, build('z', 'queued')), 'main');
  d = ok(d, { action: 'rule-off', rule: 'docs-builds' });
  assert.equal(Q.queueOf(d, build('x', 'queued', { category: 'docs' })), 'main');
  assert.throws(() => Q.apply(d, { action: 'rule-add', rule: { kind: 'route', to: 'docs' } }), /category or a model/);
  assert.throws(() => Q.apply(d, { action: 'rule-add', rule: { kind: 'overflow', from: 'main', to: 'main' } }), /one queue to another/);
  d = ok(d, { action: 'rule-move', rule: 'fable-to-api', to: 0 }); assert.equal(d.rules[0].id, 'fable-to-api');
  d = ok(d, { action: 'rule-remove', rule: 'Fable to API' }); assert.equal(d.rules.some((r) => r.id === 'fable-to-api'), false);
});
t('owner-only: raising a cap, switching a max-cost rule off, API use for a queue, approving an API run', () => {
  const d = Q.defaultDoc();
  assert.throws(() => Q.apply(d, { action: 'update', queue: 'api', patch: { costCapUsd: 50 } }), /only Brett/);
  assert.throws(() => Q.apply(d, { action: 'update', queue: 'api', patch: { costCapUsd: 0 } }), /only Brett/, 'removing a cap raises it');
  assert.equal(ok(d, { action: 'update', queue: 'api', patch: { costCapUsd: 4 } }).queues[1].costCapUsd, 4, 'lowering is anyone\'s');
  assert.throws(() => Q.apply(d, { action: 'rule-off', rule: 'api-max-cost' }), /only Brett/);
  assert.throws(() => Q.apply(d, { action: 'rule-remove', rule: 'api-max-cost' }), /only Brett/);
  assert.throws(() => Q.apply(d, { action: 'update', queue: 'main', patch: { uses: 'both' } }), /now uses API accounts/);
  assert.throws(() => Q.apply(d, { action: 'create', name: 'More API', uses: 'api' }), /only Brett/);
  assert.throws(() => Q.apply(d, { action: 'approve', build: 'b1' }), /needs Brett's OK/);
  assert.equal(ok(d, { action: 'update', queue: 'api', patch: { costCapUsd: 50 } }, true).queues[1].costCapUsd, 50);
  const a = ok(d, { action: 'approve', build: 'b1', maxCostUsd: 3, by: 'brett', via: 'console' }, true);
  assert.equal(a.approvals.b1.maxCostUsd, 3); assert.equal(Q.maxCostFor(a, 'api', 'b1'), 3, 'the lower of rule ($5) and approval ($3)');
});

// ---------------- the plan
const subs = [sub('w-1')];
const apis = Q.apiViews([apiRow('mossesx-api'), apiRow('hulu-api', { hasKey: false })]);
t('apiViews: a missing key, a cap or an off switch makes an API account unusable', () => {
  assert.equal(apis[0].usable, true); assert.equal(apis[1].usable, false); assert.match(apis[1].why, /no key/);
  const capped = Q.apiViews([apiRow('x', { spend: { state: 'capped', why: 'daily cap $10 reached' } })])[0]; assert.equal(capped.usable, false); assert.match(capped.why, /daily cap/);
  assert.equal(Q.apiViews([apiRow('x', { role: 'api-off' })])[0].usable, false);
});
t('plan: Main starts on subscriptions, API waits for Brett\'s OK, then starts on the keyed account', () => {
  let d = Q.defaultDoc(); d = ok(d, { action: 'assign', build: 'b-api', queue: 'api' });
  const builds = [build('b-main', 'queued'), build('b-api', 'queued')];
  let p = Q.plan({ doc: d, builds, subs, apis, slots, now: Date.parse(now) });
  assert.deepEqual(p.launches.map((l) => [l.id, l.account, l.kind, l.queue]), [['b-main', 'w-1', 'subscription', 'main']]);
  assert.match(p.waits.find((w) => w.id === 'b-api').why, /needs your OK/); assert.deepEqual(p.asks, [{ id: 'b-api', queue: 'api', account: 'mossesx-api' }]);
  d = ok(d, { action: 'approve', build: 'b-api' }, true);
  p = Q.plan({ doc: d, builds, subs, apis, slots, now: Date.parse(now) });
  const l = p.launches.find((x) => x.id === 'b-api'); assert.equal(l.account, 'mossesx-api'); assert.equal(l.kind, 'api'); assert.equal(l.maxCostUsd, 5);
});
t('plan: max parallel per queue, pause, queue cost cap, no free agent slot', () => {
  let d = Q.defaultDoc(); d = ok(d, { action: 'update', queue: 'main', patch: { maxParallel: 1 } });
  const two = [sub('w-1'), sub('w-2')];
  const builds = [build('a', 'queued'), build('b', 'queued')];
  let p = Q.plan({ doc: d, builds, subs: two, apis: [], slots });
  assert.equal(p.launches.length, 1); assert.match(p.waits[0].why, /max parallel \(1\/1\)/);
  d = ok(d, { action: 'pause', queue: 'main' }); p = Q.plan({ doc: d, builds, subs: two, apis: [], slots });
  assert.equal(p.launches.length, 0); assert.match(p.waits[0].why, /paused/);
  p = Q.plan({ doc: ok(Q.defaultDoc(), { action: 'update', queue: 'main', patch: {} }), builds, subs: two, apis: [], slots: { free: 0, used: 6, cap: 6 } });
  assert.match(p.waits[0].why, /no free agent slot/);
  let c = ok(Q.defaultDoc(), { action: 'assign', build: 'a', queue: 'api' }); c = ok(c, { action: 'approve', build: 'a' }, true);
  c.runs.push({ build: 'old', queue: 'api', account: 'mossesx-api', kind: 'api', session: 's-old', at: now, end: now, maxCostUsd: 0, overflowFrom: '', why: '' });
  p = Q.plan({ doc: c, builds: [build('a', 'queued')], subs: [], apis, slots, costs: { 's-old': 10 }, now: Date.parse(now) + 60e3 });
  assert.equal(p.launches.length, 0); assert.match(p.waits[0].why, /\$10\.00 cost cap/);
});
t('plan: overflow sends a Main build to the API queue only while subscriptions are full and the rule is on', () => {
  let d = Q.defaultDoc(); d = ok(d, { action: 'approve', build: 'b' }, true);
  const busy = [sub('w-1', { running: 1, free: 0 })];
  let p = Q.plan({ doc: d, builds: [build('b', 'queued')], subs: busy, apis, slots });
  assert.equal(p.launches.length, 0, 'overflow off: it waits');
  d = ok(d, { action: 'rule-on', rule: 'overflow-to-api' });
  p = Q.plan({ doc: d, builds: [build('b', 'queued')], subs: busy, apis, slots });
  assert.deepEqual(p.launches.map((l) => [l.id, l.account, l.queue, l.overflowFrom]), [['b', 'mossesx-api', 'api', 'main']]);
  p = Q.plan({ doc: d, builds: [build('b', 'queued')], subs: [sub('w-1')], apis, slots });
  assert.equal(p.launches[0].kind, 'subscription', 'a free subscription always wins');
  const noOk = ok(Q.defaultDoc(), { action: 'rule-on', rule: 'overflow-to-api' });
  p = Q.plan({ doc: noOk, builds: [build('b', 'queued')], subs: busy, apis, slots });
  assert.match(p.waits[0].why, /overflow to API: needs your OK/); assert.equal(p.asks[0].id, 'b');
});
t('plan: a queue on named API accounts only; both = subscriptions first', () => {
  let d = ok(Q.defaultDoc(), { action: 'update', queue: 'api', patch: { apiAccounts: ['hulu-api'] } });
  d = ok(d, { action: 'assign', build: 'b', queue: 'api' }); d = ok(d, { action: 'approve', build: 'b' }, true);
  let p = Q.plan({ doc: d, builds: [build('b', 'queued')], subs, apis, slots });
  assert.equal(p.launches.length, 0); assert.match(p.waits[0].why, /no key saved/);
  d = ok(d, { action: 'update', queue: 'api', patch: { uses: 'both', apiAccounts: [] } });
  p = Q.plan({ doc: d, builds: [build('b', 'queued')], subs, apis, slots }); assert.equal(p.launches[0].account, 'w-1');
});
t('mergePlan keeps the pipeline idle note only when nothing launches', () => {
  const base = P.plan({ builds: [build('b', 'queued')], accounts: [], slots });
  assert.ok(base.idle);
  const m = Q.mergePlan(base, Q.plan({ doc: Q.defaultDoc(), builds: [build('b', 'queued')], subs, apis: [], slots }));
  assert.equal(m.idle, null); assert.equal(m.launches.length, 1); assert.ok(m.perQueue.main);
});
t('claim / release: a claim carries queue, account, kind and max cost; release keeps the run for spend', () => {
  let d = Q.claim(Q.defaultDoc(), 'b', { queue: 'api', account: 'mossesx-api', kind: 'api', session: 's1', maxCostUsd: 5, overflowFrom: 'main' }, now);
  assert.equal(d.claims.b.kind, 'api'); assert.equal(d.members.b, 'main', 'an overflow run stays a member of its own queue');
  assert.equal(Q.runningIn(d, 'api', [build('b', 'running')]).length, 1, 'it counts against the API queue while it runs');
  assert.equal(Q.queueSpend(d, 'api', { s1: 2.5 }, Date.parse(now)), 2.5);
  d = Q.release(d, 'b', { why: 'finished', now }); assert.equal(d.claims.b, undefined); assert.equal(d.runs.at(-1).session, 's1');
  assert.equal(Q.queueSpend(d, 'api', { s1: 2.5 }, Date.parse(now) + 3600e3), 2.5); assert.equal(Q.queueSpend(d, 'api', { s1: 2.5 }, Date.parse(now) + 86400e3 + 1), 0);
});

// ---------------- spend safety
t('enforce: 80 % notice, hard stop at an account cap, a queue cap, and a job over its max cost', () => {
  const d = Q.claim(Q.defaultDoc(), 'b', { queue: 'api', account: 'mossesx-api', kind: 'api', session: 's1', maxCostUsd: 5 }, now);
  const running = [build('b', 'running', { pipeline: { account: 'mossesx-api', session: 's1' } })];
  let e = Q.enforce({ doc: d, builds: running, apiRows: [apiRow('mossesx-api', { spend: { day: 8.2, dayCap: 10, alertAt: 0.8, state: 'warn', why: '$8.20 of the $10 daily cap' } })], costs: { s1: 1 }, now: Date.parse(now) });
  assert.deepEqual(e.stop, []); assert.deepEqual(e.alerts.map((a) => a.key), ['queues:spend:mossesx-api:warn']); assert.match(e.alerts[0].title, /80%/);
  e = Q.enforce({ doc: d, builds: running, apiRows: [apiRow('mossesx-api', { spend: { state: 'capped', why: 'daily cap $10 reached ($10.40)' } })], costs: { s1: 1 }, now: Date.parse(now) });
  assert.equal(e.stop[0].id, 'b'); assert.match(e.stop[0].why, /daily cap/); assert.ok(e.alerts.some((a) => a.key === 'queues:spend:mossesx-api:stop')); assert.ok(e.alerts.some((a) => a.key === 'queues:stop:b'));
  e = Q.enforce({ doc: d, builds: running, apiRows: [apiRow('mossesx-api')], costs: { s1: 5.01 }, now: Date.parse(now) });
  assert.match(e.stop[0].why, /over its \$5\.00 max per job/);
  e = Q.enforce({ doc: d, builds: running, apiRows: [apiRow('mossesx-api')], costs: { s1: 10 }, now: Date.parse(now) });
  assert.match(e.stop[0].why, /queue API reached its \$10\.00 cost cap/);
  e = Q.enforce({ doc: { ...d, alerts: { 'queues:spend:mossesx-api:warn': now } }, builds: running, apiRows: [apiRow('mossesx-api')], costs: { s1: 0 }, now: Date.parse(now) });
  assert.deepEqual(e.clear, ['queues:spend:mossesx-api:warn'], 'back under 80 %: the spell is over');
  e = Q.enforce({ doc: Q.defaultDoc(), builds: [build('s', 'running', { pipeline: { account: 'w-1', session: 'x' } })], apiRows: [apiRow('mossesx-api')], costs: { x: 99 } });
  assert.deepEqual(e.stop, [], 'a subscription run is never stopped for money');
});

// ---------------- the CLI and the dispatcher end to end
const e2e = process.env.AXF_QUEUES_TEST_E2E !== 'off';
if (e2e) {
  const tmp = mkdtempSync(join(tmpdir(), 'axf-queues-'));
  const storeFile = join(tmp, 'store.json');
  const pipeDir = join(tmp, 'pipeline'); const slotsDir = join(tmp, 'slots'); const hdir = join(tmp, 'headless'); const accountsDir = join(tmp, 'accounts'); const workersDir = join(tmp, 'workers'); const wtRoot = join(tmp, 'worktrees');
  for (const d of [pipeDir, slotsDir, hdir, accountsDir, workersDir, wtRoot]) mkdirSync(d, { recursive: true });
  for (const name of ['console', 'w-max']) { mkdirSync(join(accountsDir, name), { recursive: true }); writeFileSync(join(accountsDir, name, '.credentials.json'), '{}'); }
  mkdirSync(join(accountsDir, 'mossesx-api'), { recursive: true }); writeFileSync(join(accountsDir, 'mossesx-api', 'apikey'), 'test-not-a-key\n');
  writeFileSync(join(accountsDir, '.active'), 'console\n');
  writeFileSync(join(workersDir, 'seen.json'), JSON.stringify({ console: { email: 'c@x', plan: 'max' }, 'w-max': { email: 'max@x', plan: 'max' } }));
  writeFileSync(join(workersDir, 'workers.json'), JSON.stringify({ workers: ['w-max'], api: { 'mossesx-api': { label: 'Moses X API', enabled: true, dailyCapUsd: 10, weeklyCapUsd: 50 }, 'hulu-api': { label: 'Hulu API', enabled: true, dailyCapUsd: 10, weeklyCapUsd: 50 } } }));
  const launcher = join(tmp, 'launcher.sh');
  writeFileSync(launcher, `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "${tmp}/launches.log"
name=""; account=""
while [[ $# -gt 0 ]]; do case "$1" in --name) name="$2"; shift 2;; --account) account="$2"; shift 2;; --) shift;; *) shift;; esac; done
echo "{\\"event\\":\\"session-login\\",\\"session\\":\\"axf-$name--fake\\",\\"name\\":\\"$name\\",\\"account\\":\\"$account\\",\\"at\\":\\"$(date -u +%FT%TZ)\\"}" >> "${hdir}/events.jsonl"
echo "started axf-$name--fake in $(pwd)"
`); chmodSync(launcher, 0o755);
  const base = { ...process.env };
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT', 'AXF_SURFACE', 'AXF_SESSION', 'AXF_APPROVER', 'AXF_APPROVER_VIA']) delete base[k];
  const env = { ...base, AXF_BUILDS_STORE: storeFile, AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_PIPELINE_DIR: pipeDir, AXF_SLOTS_DIR: slotsDir, AXF_SLOTS_TMUX: 'off', AXF_SLOTS_MEM_GB: '8', AXF_HEADLESS_DIR: hdir,
    AXF_CLAUDE_ACCOUNTS: accountsDir, AXF_CLAUDE_SEEN: join(workersDir, 'seen.json'), AXF_CLAUDE_WORKERS: workersDir, AXF_CLAUDE_HOME: join(tmp, 'claude-home'), AXF_CLAUDE_GLOBAL: join(tmp, 'claude.json'), AXF_WORKERS_ALIVE: '',
    AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_SPLITTER: 'false', AXF_PIPELINE_WORKTREES: wtRoot, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_PIPELINE_SETTINGS: JSON.stringify({ parallelPerAccount: 1, idleAfterMin: 0, splitProvider: 'off' }), AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all' };
  mkdirSync(join(tmp, 'claude-home'), { recursive: true }); writeFileSync(join(tmp, 'claude.json'), '{}');
  const brett = { AXF_APPROVER: 'brett', AXF_APPROVER_VIA: 'console' };
  const run = (file, args, extra = {}) => { const r = spawnSync(process.execPath, [join(HERE, file), ...args], { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120000 }); return r; };
  const json = (r) => { const j = JSON.parse(r.stdout.trim().split('\n').pop()); return j; };
  const qs = (args, extra) => { const r = run('queues.mjs', [...args, '--json'], extra); const j = json(r); if (!j.ok) throw new Error(`queues ${args.join(' ')}: ${j.error}`); return j; };
  const qsFail = (args, extra) => { const r = run('queues.mjs', [...args, '--json'], extra); assert.notEqual(r.status, 0, `expected refusal: ${args.join(' ')}`); return json(r); };
  const pipe = (args, extra) => json(run('pipeline.mjs', [...args, '--json'], extra));
  const orch = (...a) => { const r = run('orchestrator.mjs', a); if (r.status !== 0) throw new Error(r.stderr); };
  const store = () => JSON.parse(readFileSync(storeFile, 'utf8'));
  const find = (id) => store().builds.find((b) => b.id === id);
  const qdoc = () => JSON.parse(readFileSync(join(pipeDir, 'queues.json'), 'utf8'));
  const st = [{ text: 'do it', model: 'Opus', estimate: '20 min' }];
  orch('act', JSON.stringify({ action: 'add', id: 'old-queued', title: 'Already queued', steps: st }));
  run('pipeline.mjs', ['queue', 'old-queued']);
  for (const id of ['main-job', 'api-job', 'spare']) orch('act', JSON.stringify({ action: 'add', id, title: id, steps: st }));

  t('e2e first use: Main and API made, today\'s Queue migrated into Main', () => {
    const s = qs(['status']);
    assert.deepEqual(s.queues.map((q) => q.id), ['main', 'api']);
    assert.equal(qdoc().members['old-queued'], 'main');
    const api = Object.fromEntries(s.api.map((a) => [a.name, a]));
    assert.equal(api['mossesx-api'].key, 'set'); assert.equal(api['hulu-api'].key, 'missing');
    assert.ok(!JSON.stringify(s).includes('test-not-a-key'), 'never the key value');
  });
  t('e2e moves: Pending → API queue, API → Main, Main → Pending, a queue → another', () => {
    qs(['assign', 'api-job', 'api']); assert.equal(find('api-job').status, 'queued'); assert.equal(qdoc().members['api-job'], 'api');
    qs(['assign', 'spare', 'API']); qs(['assign', 'spare', 'main']); assert.equal(qdoc().members.spare, 'main'); assert.equal(find('spare').status, 'queued');
    qs(['pending', 'spare']); assert.equal(find('spare').status, 'pending'); assert.equal(qdoc().members.spare, undefined);
    qs(['assign', 'main-job', 'main']);
    qsFail(['assign', 'nope', 'main']);
  });
  t('e2e create / rename / move / pause / delete through the CLI', () => {
    qs(['create', 'Night', '--parallel', '1', '--priority', '8']);
    qs(['rename', 'night', 'Overnight']); qs(['move', 'night', 'top']);
    assert.deepEqual(qdoc().queues.map((q) => q.name), ['Overnight', 'Main', 'API']);
    qs(['pause', 'night']); assert.equal(qdoc().queues[0].paused, true);
    qs(['delete', 'night']); assert.deepEqual(qdoc().queues.map((q) => q.id), ['main', 'api']);
    const r = qsFail(['create', 'Spendy', '--uses', 'api']); assert.match(r.error, /only Brett/);
    qs(['create', 'Spendy', '--uses', 'api'], brett); qs(['delete', 'spendy']);
    assert.match(qsFail(['update', 'api', '--cap', '100']).error, /only Brett/);
    assert.match(qsFail(['update', 'api', '--cap', '100'], { ...brett, CLAUDECODE: '1' }).error, /only Brett/, 'a Claude session is never Brett');
  });
  t('e2e tick: Main job starts on the subscription; the API job waits and asks Brett once', () => {
    const r = pipe(['tick']);
    assert.deepEqual(r.launched.map((l) => [l.id, l.account, l.queue, l.kind]), [['old-queued', 'w-max', 'main', 'subscription']], JSON.stringify(r.plan.waits));
    assert.match(r.plan.waits.find((w) => w.id === 'main-job').why, /parallel cap/);
    assert.ok(!r.launched.some((l) => l.id === 'api-job'));
    assert.match(r.plan.waits.find((w) => w.id === 'api-job').why, /needs your OK/);
    assert.deepEqual(r.queues.asked, ['api-job']);
    assert.deepEqual(pipe(['tick']).queues.asked, [], 'asked once');
  });
  t('e2e approve (Brett only) → the API job starts on mossesx-api, claimed in the API queue', () => {
    assert.match(qsFail(['approve', 'api-job']).error, /Brett's OK/);
    qs(['approve', 'api-job', '--max', '3'], brett);
    const r = pipe(['tick']);
    const l = r.launched.find((x) => x.id === 'api-job'); assert.ok(l, JSON.stringify(r.plan.waits));
    assert.equal(l.account, 'mossesx-api'); assert.equal(l.kind, 'api'); assert.equal(l.maxCostUsd, 3);
    assert.match(readFileSync(join(tmp, 'launches.log'), 'utf8'), /--name api-job .*--account mossesx-api/);
    const c = qdoc().claims['api-job']; assert.equal(c.queue, 'api'); assert.equal(c.kind, 'api'); assert.equal(c.session, 'axf-api-job--fake');
    const s = qs(['status']); assert.equal(s.queues.find((q) => q.id === 'api').running[0].id, 'api-job');
  });
  t('e2e hard stop: the API job goes over its max cost → session stopped, build back in Pending, AmberX notice', () => {
    writeFileSync(join(hdir, 'axf-api-job--fake.meter.json'), JSON.stringify({ costUsd: 3.4 }));
    const r = pipe(['tick'], { AXF_WORKERS_ALIVE: 'axf-api-job--fake' });
    assert.deepEqual(r.queues.stopped.map((s) => s.id), ['api-job'], JSON.stringify(r.queues));
    assert.equal(find('api-job').status, 'pending'); assert.match(find('api-job').notes.at(-1).text, /over its \$3\.00 max per job/);
    assert.ok(r.queues.alerts.includes('queues:stop:api-job'));
    assert.equal(qdoc().claims['api-job'], undefined); assert.equal(qdoc().runs.at(-1).build, 'api-job');
  });
  t('e2e 80 % and cap notices for an API account', () => {
    appendFileSync(join(hdir, 'events.jsonl'), `${JSON.stringify({ event: 'session-end', session: 'axf-api-job--fake', account: 'mossesx-api', exit: 0, costUsd: 8.5, at: new Date().toISOString() })}\n`);
    let r = pipe(['tick']); assert.ok(r.queues.alerts.includes('queues:spend:mossesx-api:warn'), JSON.stringify(r.queues));
    const s = qs(['spend']); assert.equal(s.api.find((a) => a.name === 'mossesx-api').costToday, 8.5);
    appendFileSync(join(hdir, 'events.jsonl'), `${JSON.stringify({ event: 'session-login', session: 'x2', account: 'mossesx-api', at: new Date().toISOString() })}\n${JSON.stringify({ event: 'session-end', session: 'x2', account: 'mossesx-api', exit: 0, costUsd: 2, at: new Date().toISOString() })}\n`);
    r = pipe(['tick']); assert.ok(r.queues.alerts.includes('queues:spend:mossesx-api:stop'), JSON.stringify(r.queues));
    qs(['assign', 'api-job', 'api']);
    r = pipe(['tick']); assert.ok(!r.launched.some((l) => l.id === 'api-job'), 'capped: nothing new starts on it');
    assert.match(r.plan.waits.find((w) => w.id === 'api-job').why, /daily cap|cost cap/);
  });
  t('e2e rules through the CLI: add, off, move, remove', () => {
    qs(['rule', 'add', '--rule', JSON.stringify({ kind: 'route', name: 'Docs to Main', to: 'main', when: { categories: ['docs'] } })]);
    qs(['rule', 'off', 'docs-to-main']); qs(['rule', 'move', 'docs-to-main', '0']);
    assert.equal(qdoc().rules[0].id, 'docs-to-main'); assert.equal(qdoc().rules[0].enabled, false);
    qs(['rule', 'remove', 'docs-to-main']); assert.ok(!qdoc().rules.some((r) => r.id === 'docs-to-main'));
    assert.match(qsFail(['rule', 'off', 'api-max-cost']).error, /only Brett/);
  });
  assert.ok(existsSync(join(pipeDir, 'queues.json')));
}

console.log(`queues: ${n} checks passed${e2e ? '' : ' (CLI end-to-end skipped)'}`);
