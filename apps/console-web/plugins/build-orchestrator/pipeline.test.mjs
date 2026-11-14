// Self-test: node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs
// Pipeline core (pure) + the CLI end to end on a scratch store with a fake launcher, fake accounts and a fake splitter.
process.env.AXF_CREW_SAY ??= 'off'; // group-chat posts (crew-say.mjs) stay out of the real Breakroom
process.env.AXF_BUILD_LIMIT ??= 'off'; // the hard build limit counts the VPS's real builds: keep these tests off it (check-build-limit.mjs covers it)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './pipeline-core.mjs';
import * as OC from './web/orchestrator-core.mjs';
import { verdict as dispatchVerdict } from '../../../../framework/cli/dispatch-gate.mjs';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import { setUpgradePolicy } from '../../../../framework/core/model-switch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
let n = 0; const t = (name, fn) => { try { fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } n += 1; };
const now = '2026-11-08T01:00:00.000Z';
const step = (id, model, done = false) => ({ id, uid: `u-${id}`, text: `${id} work`, model, estimate: '25 min', done, doneAt: done ? now : '', skip: false, files: [], checks: [], session: 'same', agent: false, why: '', phase: '', group: '', note: '' });
const build = (id, status, steps, extra = {}) => ({ id, title: id, status, steps, createdAt: now, updatedAt: now, notes: [], approvals: [], upgradeRequests: [], deleted: false, hidden: false, ...extra });

// ---------------- build-pipeline@1 record
t('normPipeline: empty → null, fields in shape', () => {
  assert.equal(BP.normPipeline(null), null); assert.equal(BP.normPipeline({}), null);
  const p = BP.normPipeline({ queuedAt: now, queuedBy: 'brett', account: 'Bad Name', runs: 2.5, lastRun: { exit: 1, outcome: 'nope', stepsLeft: 3 }, split: { provider: 'claude', steps: 8 } });
  assert.equal(p.queuedAt, now); assert.equal(p.account, ''); assert.equal(p.runs, 0); assert.equal(p.lastRun.outcome, 'finished'); assert.equal(p.lastRun.stepsLeft, 3); assert.equal(p.split.provider, 'claude');
});
t('table: pending / queued / building; built and failed are off the table', () => {
  assert.equal(BP.tableOf({ status: 'pending' }), 'pending'); assert.equal(BP.tableOf({ status: 'queued' }), 'queued'); assert.equal(BP.tableOf({ status: 'running' }), 'building'); assert.equal(BP.tableOf({ status: 'waiting' }), 'building'); assert.equal(BP.tableOf({ status: 'built' }), '');
});
t('queue order: priority first, then the moment queued', () => {
  const a = build('a', 'queued', [], { pipeline: { queuedAt: '2026-11-08T00:10:00Z' }, priority: 'P2' });
  const b = build('b', 'queued', [], { pipeline: { queuedAt: '2026-11-08T00:20:00Z' }, priority: 'P0' });
  const c = build('c', 'queued', [], { pipeline: { queuedAt: '2026-11-08T00:05:00Z' }, priority: 'P2' });
  const d = build('d', 'pending', []);
  assert.deepEqual(BP.queueOrder([a, b, c, d], (x) => x.priority).map((x) => x.id), ['b', 'c', 'a']);
});
t('outcomeOf: finished / returned / requeued / failed after maxRuns', () => {
  assert.equal(BP.outcomeOf({ exit: 0, stepsLeft: 0, runs: 1 }), 'finished');
  assert.equal(BP.outcomeOf({ exit: 0, stepsLeft: 2, runs: 1 }), 'returned');
  assert.equal(BP.outcomeOf({ exit: 1, stepsLeft: 2, runs: 1 }), 'requeued');
  assert.equal(BP.outcomeOf({ exit: 1, stepsLeft: 2, runs: 3 }), 'failed');
  assert.equal(BP.outcomeOf({ exit: 1, stepsLeft: 2, runs: 2 }, 2), 'failed');
  assert.equal(BP.outcomeOf({ exit: 0, stepsLeft: 2, runs: 1, phaseSwitch: true }), 'requeued', 'a phase ended: the next phase queues for its own account');
});

// ---------------- accounts
const settings = P.normSettings({ parallelPerAccount: 2 });
const rows = [
  { name: 'console', role: 'interactive', email: 'c@x', plan: 'max', limited: null, running: [] },
  { name: 'w-pro', role: 'worker', email: 'p@x', plan: 'pro', limited: null, running: ['s1'] },
  { name: 'w-max', role: 'worker', email: 'm@x', plan: 'max', limited: null, running: [] },
  { name: 'w-out', role: 'worker', email: 'o@x', plan: 'max', limited: { until: '2026-11-09T00:00:00Z', reason: 'hit its limit' }, running: [] },
];
t('accountView: Fable from the plan, override and probe win over it; parallel per account', () => {
  const v = P.accountViews(rows, { 'w-pro': { fable: true }, 'w-max': { probe: { fable: false, at: now }, parallel: 3 } }, { settings, now: Date.parse(now) + 1000 });
  const by = Object.fromEntries(v.map((a) => [a.name, a]));
  assert.equal(by.console.fable, true); assert.equal(by.console.fableFrom, 'plan');
  assert.equal(by['w-pro'].fable, true); assert.equal(by['w-pro'].fableFrom, 'override');
  assert.equal(by['w-max'].fable, false); assert.equal(by['w-max'].fableFrom, 'probe'); assert.equal(by['w-max'].parallel, 3); assert.equal(by['w-max'].free, 3);
  assert.equal(by['w-pro'].free, 1);
});
t('usable: workers only when any worker exists; the console account when none; never a limited one', () => {
  const v = P.accountViews(rows, {}, { settings });
  const by = Object.fromEntries(v.map((a) => [a.name, a]));
  assert.equal(by.console.usable, false); assert.match(by.console.why, /not a worker/);
  assert.equal(by['w-pro'].usable, true); assert.equal(by['w-out'].usable, false); assert.match(by['w-out'].why, /hit its limit/);
  const solo = P.accountViews([rows[0]], {}, { settings }); assert.equal(solo[0].usable, true);
  const off = P.accountViews([rows[0]], {}, { settings: P.normSettings({ useConsoleAccount: false }) }); assert.equal(off[0].usable, false);
  const stale = P.accountViews(rows, { 'w-max': { probe: { fable: false, at: '2026-01-01T00:00:00Z' } } }, { settings, now: Date.parse(now) });
  assert.equal(stale.find((a) => a.name === 'w-max').fableFrom, 'plan');
});
t('candidates: Fable only on Fable accounts, fewest running first', () => {
  const v = P.accountViews(rows, {}, { settings });
  assert.deepEqual(P.candidates(v, 'Fable').map((a) => a.name), ['w-max']);
  assert.deepEqual(P.candidates(v, 'Opus').map((a) => a.name), ['w-max', 'w-pro'], 'fewest running first, then non-Fable accounts');
  assert.match(P.noAccountWhy(v.filter((a) => a.name === 'w-pro'), 'Fable'), /no account with Fable/);
  assert.match(P.noAccountWhy(v.map((a) => ({ ...a, free: 0 })), 'Opus'), /parallel cap/);
  assert.match(P.noAccountWhy([], 'Opus'), /no Claude account/);
});

// ---------------- the plan of a tick
const q1 = build('q1', 'queued', [step('s1', 'Fable'), step('s2', 'Opus')], { pipeline: { queuedAt: '2026-11-08T00:01:00Z' }, priority: 'P1' });
const q2 = build('q2', 'queued', [step('s1', 'Opus')], { pipeline: { queuedAt: '2026-11-08T00:02:00Z' } });
const q3 = build('q3', 'queued', [], { pipeline: { queuedAt: '2026-11-08T00:03:00Z' } });
const q4 = build('q4', 'queued', [step('s1', 'Opus')], { pipeline: { queuedAt: '2026-11-08T00:04:00Z' } });
const p1 = build('p1', 'pending', [step('s1', 'Opus')]);
t('plan: one launch per free slot in Queue order, Fable to a Fable account, the rest wait with a reason', () => {
  const v = P.accountViews(rows, {}, { settings });
  const r = P.plan({ builds: [q4, q2, q1, q3, p1], accounts: v, slots: { free: 2, used: 1, cap: 3 }, settings });
  assert.deepEqual(r.queue, ['q1', 'q2', 'q3', 'q4']);
  assert.deepEqual(r.launches.map((l) => [l.id, l.account, l.model]), [['q1', 'w-max', 'Fable'], ['q2', 'w-pro', 'Opus']], 'Opus work keeps the Fable account free');
  assert.deepEqual(r.waits.map((w) => w.id), ['q3', 'q4']);
  assert.match(r.waits[0].why, /no steps yet/); assert.match(r.waits[1].why, /no free agent slot/);
  assert.equal(r.idle, null);
});
t('plan: account caps hold a launch even with slots free; Fable work waits when no Fable account is free', () => {
  const v = P.accountViews(rows.filter((x) => x.name === 'w-pro'), {}, { settings: P.normSettings({ parallelPerAccount: 1 }) });
  const r = P.plan({ builds: [q1, q2], accounts: v, slots: { free: 5, used: 0, cap: 5 }, settings });
  assert.equal(r.launches.length, 0); assert.match(r.waits[0].why, /no account with Fable/); assert.match(r.waits[1].why, /parallel cap/);
  assert.equal(r.idle.kind, 'stuck'); assert.match(r.idle.reason, /2 builds in the Queue, nothing running/);
});
t('plan: idle when the Queue is empty and Pending has work; quiet when something runs', () => {
  const v = P.accountViews(rows, {}, { settings });
  const r = P.plan({ builds: [p1], accounts: v, slots: { free: 2, used: 0, cap: 3 }, settings });
  assert.equal(r.idle.kind, 'empty'); assert.match(r.idle.reason, /1 build wait in Pending/);
  const r2 = P.plan({ builds: [p1, build('r', 'running', [step('s1', 'Opus')])], accounts: v, slots: { free: 2, used: 1, cap: 3 }, settings });
  assert.equal(r2.idle, null);
  const r3 = P.plan({ builds: [], accounts: v, slots: { free: 2, used: 0, cap: 3 }, settings });
  assert.equal(r3.idle, null);
});
t('plan: an unapproved upgrade phase waits for Brett', () => {
  const up = build('up', 'queued', [step('s1', 'Opus', true), step('s2', 'Fable')], { pipeline: { queuedAt: now } });
  const v = P.accountViews(rows, {}, { settings });
  setUpgradePolicy({ approvalRequired: true, source: 'test' });
  const held = P.plan({ builds: [up], accounts: v, slots: { free: 2, used: 0, cap: 3 }, settings });
  assert.equal(held.launches.length, 0); assert.match(held.waits[0].why, /needs Brett's approval: upgrade Opus → Fable/);
  // Fable upgrades need my approval is off (Brett's standing order): it launches on a Fable account
  setUpgradePolicy({ approvalRequired: false, source: 'test' });
  const was = P.plan({ builds: [up], accounts: v, slots: { free: 2, used: 0, cap: 3 }, settings });
  assert.equal(was.launches.length, 1); assert.equal(was.launches[0].account, 'w-max'); assert.equal(was.launches[0].model, 'Fable');
});

// ---------------- session end
t('endOutcome: finished → built with a PR, complete without; crash requeues; clean stop returns to Pending; failed after maxRuns', () => {
  const done = build('d', 'running', [step('s1', 'Opus', true)], { pipeline: { runs: 1, account: 'w-pro', session: 'axf-d' } });
  assert.equal(P.endOutcome(done, { exit: 0 }).status, 'complete');
  assert.equal(P.endOutcome({ ...done, pr: '12' }, { exit: 0 }).status, 'built');
  const crashed = P.endOutcome(build('c', 'running', [step('s1', 'Opus')], { pipeline: { runs: 1, account: 'w-pro' } }), { exit: 1 });
  assert.equal(crashed.status, 'queued'); assert.match(crashed.note, /back in the Queue/);
  const stopped = P.endOutcome(build('s', 'running', [step('s1', 'Opus')], { pipeline: { runs: 1, model: 'Opus' } }), { exit: 0 });
  assert.equal(stopped.status, 'pending'); assert.match(stopped.note, /back in Pending for Brett/);
  const phase = P.endOutcome(build('p', 'running', [step('s1', 'Fable', true), step('s2', 'Opus')], { pipeline: { runs: 1, model: 'Fable' } }), { exit: 0 });
  assert.equal(phase.status, 'queued', 'Fable phase done, Opus phase next: back in the Queue for an Opus account');
  const dead = P.endOutcome(build('f', 'running', [step('s1', 'Opus')], { pipeline: { runs: 3 } }), { exit: 137 });
  assert.equal(dead.status, 'failed'); assert.match(dead.note, /failed/);
});

// ---------------- split
const raw = build('raw', 'pending', [], { title: 'Icon browser', detail: 'Add an icon browser plugin.\nList every icon pack.\nSearch by name.', origin: { said: 'I want an icon browser, dude.', addenda: [] } });
t('splitPrompt carries the title, detail, his words and the JSON shape', () => {
  const p = P.splitPrompt(raw);
  assert.match(p, /Icon browser/); assert.match(p, /icon browser, dude/); assert.match(p, /"steps"/); assert.match(p, /10 minutes or less/); assert.match(p, /checkpoints inside ONE session/); assert.match(p, /no step gets its own prompt or relaunch/); assert.match(p, /Fable ONLY for/);
  assert.match(P.splitPrompt(raw, { maxStepMinutes: 30 }), /every step 10 minutes or less/, 'a stored 30 reads as the 10-minute ceiling');
  assert.match(P.splitPrompt(raw, { maxStepMinutes: 5 }), /every step 5 minutes or less/, 'the rule can lower it');
});
t('parseSplit: JSON inside prose, models coerced, estimates checked', () => {
  const ok = P.parseSplit('Here you go:\n{"steps":[{"text":"Design the icon-pack schema","model":"fable","estimate":"10 min","why":"schema"},{"text":"Write the docs","model":"Opus","estimate":"8"},{"text":"Wire the route","model":"Opus 5.5","estimate":9}]}\nDone.');
  assert.equal(ok.error, ''); assert.equal(ok.steps.length, 3); ok.steps.splice(1, 1); assert.equal(ok.steps[0].model, 'Fable'); assert.equal(ok.steps[1].model, 'Opus'); assert.equal(ok.steps[1].estimate, '9 min'); assert.equal(ok.steps[0].id, 's1');
  assert.match(P.parseSplit('nothing here').error, /no JSON/);
  assert.match(P.parseSplit('{"steps":[]}').error, /no steps/);
  assert.match(P.parseSplit('{"steps":[{"text":"Too big a step","model":"Opus","estimate":"2 h"}]}').error, /120 min \(limit 10\)/);
  assert.match(P.parseSplit('{"steps":[{"text":"Was fine before","model":"Opus","estimate":"25 min"}]}').error, /25 min \(limit 10\)/);
  assert.match(P.parseSplit('{"steps":[{"text":"No estimate","model":"Opus"}]}').error, /no estimate/);
  assert.equal(P.parseSplit('{"steps":[{"text":"Sonnet is never allowed","model":"Sonnet","estimate":"5 min"}]}').steps[0].model, 'Opus');
});
t('rulesSplit: one step per line, Fable for foundation words first, a closing test + PR step', () => {
  const s = P.rulesSplit(build('r', 'pending', [], { title: 'Thing', detail: 'Add the plugin UI.\nDesign the asset type schema for packs.\nWire the API route.' }));
  assert.equal(s.length, 4); assert.equal(s[0].model, 'Fable'); assert.match(s[0].text, /schema/); assert.equal(s[3].model, 'Opus'); assert.match(s[3].text, /report _claude\/builds\/reports\/r\.md/);
  assert.ok(s.every((x) => (P.needsSplit({ status: 'pending', steps: [x] }) === false))); assert.ok(s.every((x) => x.estimate === '10 min'));
  const bare = P.rulesSplit(build('b', 'pending', [], { title: 'Just a title' })); assert.equal(bare.length, 2); assert.equal(bare[0].text, 'Just a title');
});
t('needsSplit: no steps, a step over the limit or without an estimate; never a finished build', () => {
  assert.equal(P.needsSplit(raw), true);
  assert.equal(P.needsSplit(build('x', 'pending', [{ ...step('s1', 'Opus'), estimate: '10 min' }])), false);
  assert.equal(P.needsSplit(build('x', 'pending', [step('s1', 'Opus')])), true, '25 min is over the 10-minute limit');
  assert.equal(P.needsSplit(build('x', 'pending', [{ ...step('s1', 'Opus'), createdAt: '2026-11-01T00:00:00.000Z' }])), false, 'a step written before the change keeps the 30-minute limit');
  assert.equal(P.needsSplit(build('x', 'pending', [{ ...step('s1', 'Opus'), estimate: '40 min', createdAt: '2026-11-01T00:00:00.000Z' }])), true);
  assert.equal(P.needsSplit(build('x', 'pending', [{ ...step('s1', 'Opus'), estimate: '2 h' }])), true);
  assert.equal(P.needsSplit(build('x', 'pending', [{ ...step('s1', 'Opus'), estimate: '' }])), true);
  assert.equal(P.needsSplit(build('x', 'complete', [])), false);
});
t('self-check: each account gets a state; blocked ones are the alert; a new problem or a fix notifies, the same one does not', () => {
  const s = P.normSettings({});
  const rows = [
    { name: 'w', role: 'worker', plan: 'max', running: [] },
    { name: 'full', role: 'worker', plan: 'max', running: ['x'] },
    { name: 'lim', role: 'worker', plan: 'max', running: [], limited: { kind: 'auth', until: '2099-01-01T00:00:00Z', reason: 'login failed' } },
    { name: 'con', role: 'interactive', plan: 'max', running: [] },
    { name: 'k', role: 'api-worker', kind: 'api', hasKey: true, building: 2, running: [] },
    { name: 'nokey', role: 'api-worker', kind: 'api', hasKey: false, building: 2, running: [] },
  ];
  const views = P.accountViews(rows, {}, { settings: s });
  const f = Object.fromEntries(views.map((v, i) => [v.name, P.checkAccount(v, rows[i])]));
  assert.equal(f.w.state, 'ready'); assert.equal(f.full.state, 'busy'); assert.equal(f.lim.state, 'blocked'); assert.equal(f.lim.signedIn, false);
  assert.equal(f.con.state, 'standby'); assert.equal(f.k.state, 'ready'); assert.equal(f.k.keyOk, true); assert.equal(f.nokey.state, 'blocked'); assert.equal(f.nokey.keySaved, false);
  const sum = P.checkSummary(Object.values(f), ['released x']);
  assert.match(sum.line, /6 accounts: 2 ready, 1 busy, 1 standby, 2 blocked · fixed 1/); assert.equal(sum.problems.length, 2);
  const cur = { findings: Object.values(f), fixes: [], signature: sum.signature };
  assert.equal(P.checkNotify(cur, null), true, 'first sight of a blocked account');
  assert.equal(P.checkNotify(cur, { signature: sum.signature, findings: cur.findings }), false, 'the same problem again: quiet');
  assert.equal(P.checkNotify({ ...cur, fixes: ['x'] }, { signature: sum.signature }), true, 'a fix always tells');
  const a = P.alertFor('selfcheck', { fixes: ['released x'], problems: sum.problems, line: sum.line });
  assert.equal(a.key, 'pipeline:selfcheck'); assert.equal(a.severity, 'warning'); assert.match(a.title, /fixed 1, 2 accounts can't work/); assert.match(a.body, /Can't use lim/);
});
t('alertFor: idle keyed once, per-build run keys, every kind has a title', () => {
  const idle = P.alertFor('idle', { kind: 'stuck', reason: 'why' }); assert.equal(idle.key, 'pipeline:idle'); assert.equal(idle.severity, 'warning'); assert.equal(idle.source, 'pipeline');
  assert.equal(P.alertFor('idle', { kind: 'empty', reason: 'why' }).severity, 'info');
  assert.equal(P.alertFor('launched', { id: 'b', title: 'B', account: 'w', model: 'Opus' }).key, 'pipeline:run:b');
  assert.equal(P.alertFor('failed', { id: 'b', title: 'B', note: 'n' }).severity, 'error'); assert.equal(P.alertFor('failed', { id: 'b' }).key, 'pipeline:end:b');
  assert.equal(P.alertFor('ended', { id: 'b', outcome: 'finished' }).severity, 'success');
  assert.throws(() => P.alertFor('bogus'), /unknown alert kind/);
  const oa = P.alertFor('oauth', { id: 'b', title: 'B', account: 'w', error: 'OAuth token has expired', everyMin: 5 });
  assert.equal(oa.key, 'pipeline:oauth:b'); assert.equal(oa.severity, 'error'); assert.match(oa.title, /login failed: w/); assert.match(oa.body, /OAuth token has expired[\s\S]*back to the Queue by itself/);
  assert.equal(P.alertFor('oauth-ok', { id: 'b', account: 'w' }).key, 'pipeline:oauth:b', 'the recovery replaces the failure alert');
});
t('authFailureOf: Claude Code\'s sign-in errors at the end of a run log; talk about tokens or a usage limit is not one', () => {
  assert.equal(P.authFailureOf('working…\nAPI Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}\n── finished (exit 1) ──'), 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}');
  assert.match(P.authFailureOf('Invalid API key · Please run /login'), /Please run \/login/);
  assert.match(P.authFailureOf('\x1b[31mOAuth token has expired. Please obtain a new token or refresh your existing token.\x1b[0m'), /^OAuth token has expired/);
  assert.equal(P.authFailureOf('I wrote the refresh-token save-back and the oauth alert.\nAll steps done.'), '', 'a build about tokens is not a login failure');
  assert.equal(P.authFailureOf("You've hit your weekly limit · resets Mon"), '', 'a usage limit is not a login failure');
  assert.equal(P.authFailureOf(['OAuth token has expired', ...Array(40).fill('later work')].join('\n')), '', 'only the end of the log counts');
});
t('authRecovered: a health answer newer than the failure that signs in; once', () => {
  const w = { account: 'w', at: '2026-11-14T10:00:00Z', requeued: false };
  assert.equal(P.authRecovered(w, { signedIn: true, at: '2026-11-14T10:05:00Z' }), true);
  assert.equal(P.authRecovered(w, { signedIn: true, at: '2026-11-14T09:55:00Z' }), false, 'an answer from before the failure says nothing');
  assert.equal(P.authRecovered(w, { signedIn: false, at: '2026-11-14T10:05:00Z' }), false);
  assert.equal(P.authRecovered(w, { signedIn: true, at: '2026-11-14T10:05:00Z', skipped: true }), false, 'a skipped call proves nothing');
  assert.equal(P.authRecovered({ ...w, requeued: true }, { signedIn: true, at: '2026-11-14T10:05:00Z' }), false, 're-queued once only');
});
t('settings normalise and clamp', () => {
  const s = P.normSettings({ parallelPerAccount: 99, maxRuns: 0, fablePlans: ['Max', 'TEAM'], splitProvider: 'nope', autoQueue: 'yes' });
  assert.equal(s.parallelPerAccount, 12); assert.equal(s.maxRuns, 1); assert.deepEqual(s.fablePlans, ['max', 'team']); assert.equal(s.splitProvider, 'claude'); assert.equal(s.autoQueue, false);
});

// ---------------- API jobs (Brett, Nov 9 2026: "I'm also gonna be able to have the orchestrator send jobs to the API, right?")
const apiRow = (name, extra = {}) => ({ name, kind: 'api', role: 'api-worker', plan: '', email: '', limited: null, running: [], hasKey: true, building: 1, spend: { day: 0, week: 0, state: 'ok', why: '' }, ...extra });
const subsFull = [{ name: 'w-max', role: 'worker', plan: 'max', limited: null, running: ['a', 'b'] }];
t('settings: subscriptions first, then any API: the overflow rule is on by default; API account list parsed', () => {
  assert.equal(P.normSettings({}).apiOverflow, true); assert.equal(P.normSettings({ apiOverflow: false }).apiOverflow, false); assert.equal(P.normSettings({}).healthEveryMin, 5); assert.deepEqual(P.normSettings({}).apiAccounts, []);
  assert.equal(P.normSettings({ apiOverflow: true }).apiOverflow, true); assert.equal(P.normSettings({ apiOverflow: 'yes' }).apiOverflow, false);
  assert.deepEqual(P.normSettings({ apiAccounts: 'hulu-api,Bad Name,mossesx-api' }).apiAccounts, ['hulu-api', 'mossesx-api']);
});
t('API accounts: never usable as a subscription; ready only with a key, switched on, under caps, with room', () => {
  const s = P.normSettings({ parallelPerAccount: 2 });
  const v = P.accountViews([...subsFull, apiRow('hulu-api'), apiRow('mossesx-api', { hasKey: false }), apiRow('capped-api', { spend: { day: 10, week: 10, state: 'capped', why: 'daily cap $10 reached ($10.00)' } }), apiRow('off-api', { role: 'api-off', why: 'API worker switched off' })], {}, { settings: s });
  const by = Object.fromEntries(v.map((a) => [a.name, a]));
  for (const n of ['hulu-api', 'mossesx-api', 'capped-api', 'off-api']) { assert.equal(by[n].kind, 'api'); assert.equal(by[n].usable, false, `${n} never takes a build by itself`); }
  assert.equal(by['hulu-api'].api.usable, true); assert.equal(by['hulu-api'].parallel, 1, 'its own building limit');
  assert.equal(by['mossesx-api'].api.usable, false); assert.match(by['mossesx-api'].api.why, /no API key saved .*savekey mossesx-api/);
  assert.equal(by['capped-api'].api.usable, false); assert.match(by['capped-api'].api.why, /spend cap reached: daily cap \$10/);
  assert.equal(by['off-api'].api.usable, false); assert.match(by['off-api'].api.why, /switched off/);
  assert.equal(P.accountViews([apiRow('x', { running: ['s'] })], {}, { settings: s })[0].api.usable, false, 'full: no room');
  assert.match(P.accountViews([apiRow('x', { running: ['s'] })], {}, { settings: s })[0].api.why, /full \(1\/1\)/);
  assert.equal(P.accountViews([apiRow('hulu-api')], {}, { settings: P.normSettings({ apiAccounts: ['mossesx-api'] }) })[0].api.usable, false, 'not in the pipeline list');
});
t('routeFor: subscriptions first; overflow off = wait and say so; overflow on = API under its caps; override api / subscription', () => {
  const free = P.accountViews([{ name: 'w-max', role: 'worker', plan: 'max', limited: null, running: [] }, apiRow('hulu-api')], {}, { settings: P.normSettings({}) });
  assert.deepEqual([P.routeFor(build('x', 'queued', []), free, 'Opus').account, P.routeFor(build('x', 'queued', []), free, 'Opus').kind], ['w-max', 'subscription']);
  const full = P.accountViews([...subsFull, apiRow('hulu-api'), apiRow('mossesx-api', { hasKey: false })], {}, { settings: P.normSettings({ parallelPerAccount: 2 }) });
  const off = P.routeFor(build('x', 'queued', []), full, 'Opus', P.normSettings({ apiOverflow: false }));
  assert.equal(off.account, ''); assert.match(off.why, /API overflow is off/);
  const on = P.routeFor(build('x', 'queued', []), full, 'Opus', P.normSettings({ apiOverflow: true }));
  assert.deepEqual([on.account, on.kind, on.rule], ['hulu-api', 'api', 'overflow']);
  const noKeys = P.accountViews([...subsFull, apiRow('mossesx-api', { hasKey: false }), apiRow('capped-api', { spend: { day: 0, week: 60, state: 'capped', why: 'weekly cap $50 reached ($60.00)' } })], {}, { settings: P.normSettings({ parallelPerAccount: 2 }) });
  const skip = P.routeFor(build('x', 'queued', []), noKeys, 'Opus', P.normSettings({ apiOverflow: true }));
  assert.equal(skip.account, ''); assert.match(skip.why, /mossesx-api: no API key saved/); assert.match(skip.why, /capped-api: spend cap reached: weekly cap/);
  const ov = P.routeFor(build('x', 'queued', [], { pipeline: { route: 'api' } }), free, 'Opus');
  assert.deepEqual([ov.account, ov.kind, ov.rule], ['hulu-api', 'api', 'override'], 'per-build override: API even while a subscription is free');
  const ovNone = P.routeFor(build('x', 'queued', [], { pipeline: { route: 'api' } }), noKeys, 'Opus');
  assert.equal(ovNone.account, ''); assert.match(ovNone.why, /set to run on API, no API account can take it/);
  const subOnly = P.routeFor(build('x', 'queued', [], { pipeline: { route: 'subscription' } }), full, 'Opus', P.normSettings({ apiOverflow: true }));
  assert.equal(subOnly.account, ''); assert.match(subOnly.why, /kept off API accounts/);
});
t('plan: overflow fills an API account up to its cap, then the rest wait with the reason', () => {
  const s = P.normSettings({ parallelPerAccount: 2, apiOverflow: true });
  const accts = P.accountViews([...subsFull, apiRow('hulu-api')], {}, { settings: s });
  const q = (id, at) => build(id, 'queued', [step('s1', 'Opus')], { pipeline: { queuedAt: at } });
  const r = P.plan({ builds: [q('one', '2026-11-08T00:01:00Z'), q('two', '2026-11-08T00:02:00Z')], accounts: accts, slots: { free: 4, used: 0, cap: 6 }, settings: s });
  assert.deepEqual(r.launches.map((l) => [l.id, l.account, l.kind, l.rule]), [['one', 'hulu-api', 'api', 'overflow']]);
  assert.equal(r.waits[0].id, 'two'); assert.match(r.waits[0].why, /hulu-api: full/);
  assert.equal(BP.normPipeline({ route: 'api' }).route, 'api'); assert.equal(BP.normPipeline({ route: 'nope', queuedAt: now }).route, '');
});
// ---------------- Nov 10 2026: tabs, subscriptions first then API, plan at split, final pick, account health
t('tabs: pending / queue / active / incomplete / complete / errors', () => {
  const tab = (status, extra = {}, steps = [step('s1', 'Opus')]) => BP.tabOf(build('x', status, steps, extra));
  assert.equal(tab('pending'), 'pending'); assert.equal(tab('queued'), 'queue'); assert.equal(tab('running'), 'active'); assert.equal(tab('waiting'), 'active');
  assert.equal(tab('pending', {}, [step('s1', 'Opus', true), step('s2', 'Opus')]), 'incomplete', 'started, stopped with steps left');
  assert.equal(tab('pending', { pipeline: { runs: 1 } }), 'incomplete'); assert.equal(tab('blocked'), 'incomplete');
  assert.equal(tab('built'), 'complete'); assert.equal(tab('complete'), 'archive', 'merged builds go to the Archive'); assert.equal(tab('failed'), 'errors');
  assert.equal(tab('queued', { pipeline: { note: 'launch failed: launcher exit 1' } }), 'errors');
  assert.equal(tab('archived'), 'archive'); assert.equal(tab('pending', { hidden: true }), '');
  assert.equal(tab('queued', { deleted: true }), 'deleted'); assert.equal(tab('archived', { deleted: true, hidden: true }), 'deleted');
  assert.deepEqual(BP.TABS, ['pending', 'queue', 'active', 'incomplete', 'complete', 'errors', 'archive', 'deleted']);
  const p = BP.normPipeline({ planned: { model: 'Fable', account: 'w-max', kind: 'subscription', at: now, why: 'x' }, tried: ['a-1', 'Bad Name'], pickedAt: now });
  assert.deepEqual([p.planned.account, p.planned.kind, p.tried, p.pickedAt], ['w-max', 'subscription', ['a-1'], now]);
});
t('hold: a queued build On hold stays in the Queue tab, the dispatcher skips it, the idle alert ignores it', () => {
  const held = build('held', 'queued', [step('s1', 'Opus')], { pipeline: { queuedAt: '2026-11-08T00:01:00Z', heldAt: now, heldBy: 'brett', heldWhy: 'later' } });
  const next = build('next', 'queued', [step('s1', 'Opus')], { pipeline: { queuedAt: '2026-11-08T00:02:00Z' } });
  assert.equal(BP.isHeld(held), true); assert.equal(BP.tabOf(held), 'queue'); assert.equal(BP.isHeld(next), false);
  assert.deepEqual(BP.normPipeline({ heldBy: 'x' }), null, 'no heldAt: not held, nothing kept');
  assert.equal(BP.normPipeline(held.pipeline).heldWhy, 'later');
  const accts = P.accountViews([{ name: 'w-max', role: 'worker', plan: 'max', running: [] }], {}, { settings: P.normSettings({}) });
  const r = P.plan({ builds: [held, next], accounts: accts, slots: { free: 4, used: 0, cap: 6 }, settings: P.normSettings({}) });
  assert.deepEqual(r.launches.map((l) => l.id), ['next']); assert.deepEqual(r.held, ['held']);
  assert.match(r.waits.find((w) => w.id === 'held').why, /on hold \(brett\)/);
  const only = P.plan({ builds: [held], accounts: accts, slots: { free: 4, used: 0, cap: 6 }, settings: P.normSettings({}) });
  assert.equal(only.launches.length, 0); assert.equal(only.idle, null, 'a Queue of held builds is not stuck');
});
t('actions: Queue → back to Pending / hold / archive / delete; live builds are never archived or deleted; Deleted → restore', () => {
  const q = build('q', 'queued', [step('s1', 'Opus')], { pipeline: { queuedAt: now } });
  assert.deepEqual(BP.actionsFor(q), ['unqueue', 'hold', 'archive', 'delete']);
  assert.deepEqual(BP.actionsFor(build('h', 'queued', [], { pipeline: { queuedAt: now, heldAt: now } })), ['unqueue', 'release', 'archive', 'delete']);
  assert.deepEqual(BP.actionsFor(build('r', 'running', [])), []); assert.deepEqual(BP.actionsFor(build('w', 'waiting', [])), []);
  assert.deepEqual(BP.actionsFor(build('a', 'archived', [])), ['unarchive', 'delete']);
  assert.deepEqual(BP.actionsFor(build('d', 'pending', [], { deleted: true })), ['restore']);
  assert.equal(BP.unarchivedStatus(build('x', 'archived', [step('s1', 'Opus', true)])), 'built');
  assert.equal(BP.unarchivedStatus(build('x', 'archived', [step('s1', 'Opus', true)], { mergedAt: now })), 'complete');
  assert.equal(BP.unarchivedStatus(build('x', 'archived', [step('s1', 'Opus')])), 'pending');
});
t('one build account: only it takes builds, whatever its role; every other one (API too) is off, overflow included', () => {
  const pick = (r) => ({ ...r, buildPick: 'console' });
  const v = P.accountViews([...rows, apiRow('hulu-api')].map(pick), { console: { use: false } }, { settings });
  const by = Object.fromEntries(v.map((a) => [a.name, a]));
  assert.equal(P.buildPick(v.length ? [...rows, apiRow('hulu-api')].map(pick) : []), 'console');
  assert.equal(by.console.usable, true, 'the pick wins over the pipeline\'s own off and over workers existing');
  assert.equal(by.console.buildAccount, true);
  for (const n of ['w-pro', 'w-max']) { assert.equal(by[n].usable, false); assert.match(by[n].why, /off for builds: console takes every build/); }
  assert.equal(by['hulu-api'].api.usable, false, 'API accounts are off too');
  assert.equal(P.routeFor(build('x', 'queued', []), v, 'Opus', P.normSettings({ apiOverflow: true })).account, 'console');
  const busy = P.accountViews([...rows, apiRow('hulu-api')].map((r) => pick(r.name === 'console' ? { ...r, running: ['a', 'b'] } : r)), {}, { settings });
  const r = P.routeFor(build('x', 'queued', []), busy, 'Opus', P.normSettings({ apiOverflow: true }));
  assert.equal(r.account, '', 'the pick full = the build waits, no overflow');
  const gone = P.accountViews(rows.map((x) => ({ ...x, buildPick: 'ghost' })), {}, { settings });
  assert.ok(gone.every((a) => !a.usable)); assert.match(P.noAccountWhy(gone, 'Opus'), /one build account ghost is not saved/);
  assert.equal(P.buildPick(rows), '', 'no pick = the normal routing');
});
t('routeOptions: every subscription in Brett\'s order, then every API account; route overrides respected', () => {
  const s = P.normSettings({});
  const rows = [{ name: 'b-sub', role: 'worker', plan: 'max', running: [] }, { name: 'a-sub', role: 'worker', plan: 'max', running: [] }, apiRow('hulu-api')];
  const own = { 'b-sub': { order: 1 }, 'a-sub': { order: 2 } };
  const v = P.accountViews(rows, own, { settings: s });
  assert.deepEqual(P.routeOptions(build('x', 'queued', []), v, 'Opus', s).map((o) => [o.account, o.kind]), [['b-sub', 'subscription'], ['a-sub', 'subscription'], ['hulu-api', 'api']]);
  assert.deepEqual(P.routeOptions(build('x', 'queued', [], { pipeline: { route: 'subscription' } }), v, 'Opus', s).map((o) => o.account), ['b-sub', 'a-sub']);
  assert.deepEqual(P.routeOptions(build('x', 'queued', [], { pipeline: { route: 'api' } }), v, 'Opus', s).map((o) => o.account), ['hulu-api']);
  assert.deepEqual(P.routeOptions(build('x', 'queued', []), v, 'Opus', P.normSettings({ apiOverflow: false })).map((o) => o.kind), ['subscription', 'subscription']);
});
t('planFor: model + account planned at split time, even while every account is busy', () => {
  const s = P.normSettings({ parallelPerAccount: 1 });
  const v = P.accountViews([{ name: 'w-max', role: 'worker', plan: 'max', running: ['busy'] }, { name: 'w-pro', role: 'worker', plan: 'pro', running: [] }], {}, { settings: s });
  const f = P.planFor(build('x', 'pending', [step('s1', 'Fable')]), v, s, now);
  assert.deepEqual([f.model, f.account, f.kind, f.at], ['Fable', 'w-max', 'subscription', now], 'Fable needs the Fable account, busy or not');
  assert.equal(P.planFor(build('x', 'pending', [step('s1', 'Opus')]), v, s, now).account, 'w-pro', 'Opus away from the Fable account');
  assert.equal(P.planFor(build('x', 'pending', []), v, s, now), null, 'nothing to plan before the split');
});
t('account health: classify the call, a fresh answer decides usable and Fable, stale ones are ignored; due every 5 min', () => {
  assert.deepEqual(P.healthOf({ status: 0, out: '{"type":"result","is_error":false,"result":"ok"}' }), { signedIn: true, credits: true, fable: true, error: '' });
  assert.equal(P.healthOf({ status: 1, out: 'API Error: 401 OAuth token has expired' }).signedIn, false);
  assert.equal(P.healthOf({ status: 1, out: 'Credit balance is too low' }).credits, false);
  assert.equal(P.healthOf({ status: 1, out: 'not_found_error: model' }).fable, false);
  assert.equal(P.healthOf({ status: null, error: 'spawnSync claude ETIMEDOUT' }).signedIn, null, 'a timeout says nothing');
  const s = P.normSettings({}); const t0 = Date.parse(now);
  const row = { name: 'w-max', role: 'worker', plan: 'max', running: [] };
  const fresh = (h) => P.accountView(row, { health: { at: now, ...h } }, { settings: s, now: t0 + 60e3 });
  assert.equal(fresh({ signedIn: true, credits: true, fable: true }).usable, true);
  const out = fresh({ signedIn: false }); assert.equal(out.usable, false); assert.match(out.why, /cannot sign in/);
  assert.match(fresh({ signedIn: true, credits: false }).why, /no credits/);
  const nf = fresh({ signedIn: true, credits: true, fable: false }); assert.deepEqual([nf.fable, nf.fableFrom, nf.usable], [false, 'health', true]);
  const stale = P.accountView(row, { health: { at: now, signedIn: false } }, { settings: s, now: t0 + 3600e3 }); assert.equal(stale.usable, true, 'an hour-old answer is stale');
  assert.equal(P.healthDue('', s, t0), true); assert.equal(P.healthDue(now, s, t0 + 4 * 60e3), false); assert.equal(P.healthDue(now, s, t0 + 5 * 60e3), true);
  assert.equal(P.healthDue('', P.normSettings({ healthEveryMin: 0 }), t0), false, '0 = off');
  assert.match(P.healthSummary([{ name: 'a', signedIn: true, credits: true, fable: true }, { name: 'b', signedIn: false, error: 'x' }]).line, /2 accounts: 1 ok, 1 not/);
});
t('every brief and the split prompt carry the API rule (deep link, state, every action and setting; REST / MCP / CLI / voice)', () => {
  assert.match(OC.API_RULE, /deep link/); assert.match(OC.API_RULE, /every action and setting/); assert.match(OC.API_RULE, /MCP/); assert.match(OC.API_RULE, /CLI/); assert.match(OC.API_RULE, /voice/);
  const b = OC.normalizeState({ builds: [build('ui-thing', 'queued', [step('s1', 'Opus')])] }).builds[0];
  assert.ok(OC.brief(b).includes(OC.API_RULE), 'the phase brief');
  assert.ok(P.splitPrompt(b).includes(OC.API_RULE), 'the split prompt: every UI step names its API part');
});
// ---------------- one way to start builds (framework/cli/dispatch-gate.mjs)
t('dispatch gate: a build launch needs the orchestrator token for that build; other sessions pass', () => {
  const b = { id: 'alpha' };
  const rec = { hash: '', account: 'w-max', model: 'Opus', at: new Date().toISOString(), used: '' };
  assert.equal(dispatchVerdict({ b: null, name: 'walkthrough-x' }).ok, true, 'not a build: passes');
  assert.match(dispatchVerdict({ b: null, name: 'build-feat-x' }).why, /build launch outside the orchestrator/, 'build-* names are builds even off the store');
  assert.equal(dispatchVerdict({ b: null, name: 'axf-build:y' }).ok, false);
  assert.match(dispatchVerdict({ b, name: 'alpha' }).why, /no orchestrator dispatch token.*pipeline\.mjs queue alpha/);
  assert.match(dispatchVerdict({ b, name: 'alpha', token: 'axd_x', rec: null }).why, /not dispatched by the orchestrator/);
  assert.match(dispatchVerdict({ b, name: 'alpha', token: 'axd_x', rec: { ...rec, hash: 'f'.repeat(64) } }).why, /not alpha's/);
});

// ---------------- the CLI end to end (scratch store, fake accounts, fake launcher, fake splitter)
const e2e = process.env.AXF_PIPELINE_TEST_E2E !== 'off' && existsSync(join(HERE, 'pipeline.mjs'));
if (e2e) {
  const tmp = mkdtempSync(join(tmpdir(), 'axf-pipeline-'));
  const storeFile = join(tmp, 'store.json');
  const pipeDir = join(tmp, 'pipeline'); const slotsDir = join(tmp, 'slots'); const hdir = join(tmp, 'headless'); const accountsDir = join(tmp, 'accounts'); const workersDir = join(tmp, 'workers'); const wtRoot = join(tmp, 'worktrees');
  for (const d of [pipeDir, slotsDir, hdir, accountsDir, workersDir, wtRoot]) mkdirSync(d, { recursive: true });
  // three saved accounts: the console's own (active, never a worker), a Max worker (Fable) and a Pro worker (no Fable)
  for (const name of ['console', 'w-max', 'w-pro']) { mkdirSync(join(accountsDir, name), { recursive: true }); writeFileSync(join(accountsDir, name, '.credentials.json'), '{}'); }
  writeFileSync(join(accountsDir, '.active'), 'console\n');
  writeFileSync(join(workersDir, 'seen.json'), JSON.stringify({ console: { email: 'c@x', plan: 'max' }, 'w-max': { email: 'max@x', plan: 'max' }, 'w-pro': { email: 'pro@x', plan: 'pro' } }));
  writeFileSync(join(workersDir, 'workers.json'), JSON.stringify({ workers: ['w-max', 'w-pro'] }));
  // the fake launcher records what it was asked to start and "starts" a session: an events.jsonl line + a slot entry
  const launcher = join(tmp, 'launcher.sh');
  writeFileSync(launcher, `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "${tmp}/launches.log"
name=""; account=""; model=""
while [[ $# -gt 0 ]]; do case "$1" in --name) name="$2"; shift 2;; --account) account="$2"; shift 2;; --model) model="$2"; shift 2;; --) shift;; *) shift;; esac; done
node "${ROOT}/framework/cli/dispatch-gate.mjs" consume --name "$name" >> "${tmp}/gate.log" 2>&1 || echo "GATE-REFUSED $name" >> "${tmp}/gate.log"
echo "{\\"event\\":\\"session-start\\",\\"session\\":\\"axf-$name--fake\\",\\"name\\":\\"$name\\",\\"account\\":\\"$account\\",\\"at\\":\\"$(date -u +%FT%TZ)\\"}" >> "${hdir}/events.jsonl"
echo "started axf-$name--fake in $(pwd)"
`); chmodSync(launcher, 0o755);
  // the fake splitter answers with two steps (one Fable, one Opus) whatever it is asked
  const splitter = join(tmp, 'splitter.sh');
  writeFileSync(splitter, `#!/usr/bin/env bash
cat > "${tmp}/split-prompt.txt"
echo 'Sure: {"steps":[{"text":"Design the contract","model":"Fable","estimate":"10 min","why":"contract"},{"text":"Wire the UI and tests","model":"Opus","estimate":"10 min"}]}'
`); chmodSync(splitter, 0o755);
  const env = { ...process.env, AXF_BUILDS_STORE: storeFile, AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_SHIPPED: 'off', AXF_PIPELINE_DIR: pipeDir, AXF_SLOTS_DIR: slotsDir, AXF_SLOTS_TMUX: 'off', AXF_SLOTS_MEM_GB: '8', AXF_HEADLESS_DIR: hdir,
    AXF_CLAUDE_ACCOUNTS: accountsDir, AXF_CLAUDE_SEEN: join(workersDir, 'seen.json'), AXF_CLAUDE_WORKERS: workersDir, AXF_CLAUDE_HOME: join(tmp, 'claude-home'), AXF_CLAUDE_GLOBAL: join(tmp, 'claude.json'),
    AXF_PIPELINE_LAUNCHER: launcher, AXF_PIPELINE_SPLITTER: splitter, AXF_PIPELINE_WORKTREES: wtRoot, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_PIPELINE_SETTINGS: JSON.stringify({ parallelPerAccount: 1, idleAfterMin: 0 }), AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all' };
  mkdirSync(join(tmp, 'claude-home'), { recursive: true }); writeFileSync(join(tmp, 'claude.json'), '{}');
  const run = (file, ...args) => { const r = spawnSync(process.execPath, [join(HERE, file), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 }); if (r.status !== 0 && !args.includes('--expect-fail')) throw new Error(`${file} ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`); return r; };
  const pipe = (...a) => run('pipeline.mjs', ...a);
  const orch = (...a) => run('orchestrator.mjs', ...a);
  const json = (r) => JSON.parse(r.stdout.trim().split('\n').pop());
  const store = () => JSON.parse(readFileSync(storeFile, 'utf8'));
  const find = (id) => store().builds.find((b) => b.id === id);

  orch('act', JSON.stringify({ action: 'add', id: 'alpha', title: 'Alpha feature', detail: 'Make the alpha thing.', said: 'build me alpha, kid' }));
  orch('act', JSON.stringify({ action: 'add', id: 'beta', title: 'Beta feature', steps: [{ text: 'do beta', model: 'Opus', estimate: '10 min' }] }));
  t('e2e intake: a new build with no steps is split by the orchestrator (fake Claude) and stays in Pending', () => {
    const r = json(pipe('intake', '--json'));
    assert.deepEqual(r.split.map((x) => x.id), ['alpha']);
    const a = find('alpha'); assert.equal(a.status, 'pending'); assert.equal(a.steps.length, 2); assert.equal(a.steps[0].model, 'Fable'); assert.equal(a.pipeline.split.provider, 'claude'); assert.equal(a.pipeline.split.steps, 2);
    assert.match(readFileSync(join(tmp, 'split-prompt.txt'), 'utf8'), /build me alpha, kid/);
    assert.equal(json(pipe('intake', '--json')).split.length, 0, 'a second intake splits nothing again');
  });
  t('e2e tick with an empty Queue launches nothing; status shows Pending', () => {
    const r = json(pipe('tick', '--json'));
    assert.equal(r.launched.length, 0); assert.equal(r.plan.pending, 2);
    const s = json(pipe('status', '--json')); assert.equal(s.table.pending.length, 2); assert.equal(s.table.queued.length, 0); assert.equal(s.accounts.length, 3);
    assert.equal(s.accounts.find((a) => a.name === 'console').usable, false, 'workers exist: the console account stays out');
    assert.equal(s.accounts.find((a) => a.name === 'w-max').fable, true); assert.equal(s.accounts.find((a) => a.name === 'w-pro').fable, false);
  });
  t('e2e queue: Brett moves both to the Queue; unqueue brings one back', () => {
    json(pipe('queue', 'alpha', '--by', 'brett', '--json')); json(pipe('queue', 'beta', '--by', 'brett', '--json'));
    assert.equal(find('alpha').status, 'queued'); assert.equal(find('alpha').pipeline.queuedBy, 'brett'); assert.ok(find('alpha').pipeline.queuedAt);
    json(pipe('unqueue', 'beta', '--json')); assert.equal(find('beta').status, 'pending'); assert.equal(find('beta').pipeline?.queuedAt ?? '', '');
    json(pipe('queue', 'beta', '--json'));
    const bad = pipe('queue', 'alpha', '--json', '--expect-fail'); assert.notEqual(bad.status, 0, 'queueing a queued build is refused');
  });
  t('e2e tick: one slot per account cap; the Fable build goes to the Max account, the Opus build to the Pro one', () => {
    const r = json(pipe('tick', '--json'));
    assert.deepEqual(r.launched.map((l) => [l.id, l.account, l.model]).sort(), [['alpha', 'w-max', 'Fable'], ['beta', 'w-pro', 'Opus']], JSON.stringify({ waits: r.plan.waits, failed: r.failed }));
    const log = readFileSync(join(tmp, 'launches.log'), 'utf8');
    assert.match(log, /--name alpha .*--account w-max/); assert.match(log, /--model claude-fable-5-1/); assert.match(log, /--name beta .*--account w-pro/); assert.match(log, /--model claude-opus-5-5/);
    const a = find('alpha'); assert.equal(a.status, 'running'); assert.equal(a.pipeline.account, 'w-max'); assert.equal(a.pipeline.runs, 1); assert.match(a.pipeline.session, /^axf-alpha/); assert.equal(a.pipeline.model, 'Fable');
    assert.ok(existsSync(join(wtRoot, 'alpha', '.axf-brief.md')), 'a brief file is written in the worktree');
    const brief = readFileSync(join(wtRoot, 'alpha', '.axf-brief.md'), 'utf8'); assert.match(brief, /## Brett said \(verbatim\)/); assert.match(brief, /build me alpha, kid/); assert.match(brief, /Continue build "Alpha feature" \(alpha\)/);
    assert.match(brief, /Checkpoints: Steps are checkpoints inside this ONE session/); assert.match(brief, /they are checkpoints, not separate tasks. As each step finishes, commit it on your branch, push, and tick it/);
    assert.equal(json(pipe('tick', '--json')).launched.length, 0, 'nothing free: no second launch');
  });
  t('e2e one way to start builds: every dispatcher launch carries a token the gate accepts once; anything else is refused', () => {
    const gate = readFileSync(join(tmp, 'gate.log'), 'utf8');
    assert.match(gate, /ok: alpha: dispatched by the orchestrator on w-max \(Fable\)/); assert.match(gate, /ok: beta: dispatched by the orchestrator on w-pro/); assert.doesNotMatch(gate, /GATE-REFUSED/);
    const g = (...a) => spawnSync(process.execPath, [join(ROOT, 'framework/cli/dispatch-gate.mjs'), ...a], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(g('check', '--name', 'alpha').status, 3, 'no token: refused');
    const tokens = JSON.parse(readFileSync(join(pipeDir, 'dispatch.json'), 'utf8')).tokens;
    assert.ok(tokens.alpha.used && !JSON.stringify(tokens).includes('axd_'), 'spent, and only a hash is on file');
    // the real launcher: a session (Build manager, axHub vps.build_start, a hand launch) starting alpha without the orchestrator
    const brief = join(tmp, 'brief.md'); writeFileSync(brief, 'Continue build "Alpha feature" (alpha)\n');
    const h = spawnSync('bash', [join(ROOT, 'deploy/claude-headless.sh'), '--name', 'alpha', '--brief', brief, '--log', 'x.log', '--', '-p'], { cwd: tmp, env: { ...env, AXF_DISPATCH_TOKEN: '' }, encoding: 'utf8', timeout: 60000 });
    assert.equal(h.status, 3, h.stdout + h.stderr); assert.match(h.stdout, /refused: alpha has no orchestrator dispatch token/);
    const h2 = spawnSync('bash', [join(ROOT, 'deploy/claude-headless.sh'), '--name', 'build-anything', '--brief', brief.replace('brief.md', 'none.md'), '--log', 'x.log'], { cwd: tmp, env, encoding: 'utf8', timeout: 60000 });
    assert.notEqual(h2.status, 0, 'no brief: usage error first');
    writeFileSync(join(tmp, 'plain.md'), 'Fix the thing.\n');
    const h3 = spawnSync('bash', [join(ROOT, 'deploy/claude-headless.sh'), '--name', 'build-feat-x', '--brief', join(tmp, 'plain.md'), '--log', 'x.log', '--', '-p'], { cwd: tmp, env, encoding: 'utf8', timeout: 60000 });
    assert.equal(h3.status, 3); assert.match(h3.stdout, /build launch outside the orchestrator/);
  });
  t('e2e request: every other path files a build with the orchestrator and queues it; route api is the per-build override', () => {
    const r = json(pipe('request', '--title', 'Fix the health check: mosh server', '--detail', 'Install mosh.', '--priority', 'P1', '--queue', '--by', 'health-check', '--json'));
    assert.equal(r.id, 'fix-the-health-check-mosh-server'); assert.equal(find(r.id).status, 'queued'); assert.equal(find(r.id).priority, 'P1'); assert.equal(find(r.id).pipeline.queuedBy, 'health-check');
    const r2 = json(pipe('request', '--title', 'Fix the health check: mosh server', '--json'));
    assert.equal(r2.id, 'fix-the-health-check-mosh-server-2'); assert.equal(find(r2.id).status, 'pending', 'unique id; without --queue it waits in Pending');
    json(pipe('route', r2.id, 'api', '--json')); assert.equal(find(r2.id).pipeline.route, 'api');
    json(pipe('route', r2.id, 'auto', '--json')); assert.equal(find(r2.id).pipeline?.route ?? '', '');
    assert.notEqual(pipe('route', r2.id, 'nowhere', '--json', '--expect-fail').status, 0);
    assert.equal(json(pipe('show', r.id, '--json')).build.status, 'queued');
    json(pipe('unqueue', r.id, '--json'));
  });
  t('e2e session end: a crash requeues (run 2), a clean finish with every step done = complete', () => {
    writeFileSync(join(hdir, 'events.jsonl'), readFileSync(join(hdir, 'events.jsonl'), 'utf8') + JSON.stringify({ event: 'session-end', session: find('alpha').pipeline.session, name: 'alpha', exit: 1, at: new Date().toISOString() }) + '\n');
    let r = json(pipe('tick', '--json'));
    assert.deepEqual(r.ended.map((e) => [e.id, e.outcome]), [['alpha', 'requeued']]);
    assert.equal(find('alpha').pipeline.lastRun.exit, 1); assert.equal(find('alpha').pipeline.lastRun.outcome, 'requeued');
    // the account it freed takes it again in the same tick: run 2
    assert.deepEqual(r.launched.map((l) => l.id), ['alpha']); assert.equal(find('alpha').status, 'running'); assert.equal(find('alpha').pipeline.runs, 2);
    assert.match(find('alpha').notes.map((x) => x.text).join('\n'), /back in the Queue \(run 1\)/);
    // beta's session ticks its step and ends cleanly
    orch('act', 'step', 'beta', 's1', 'done');
    writeFileSync(join(hdir, 'events.jsonl'), readFileSync(join(hdir, 'events.jsonl'), 'utf8') + JSON.stringify({ event: 'session-end', session: find('beta').pipeline.session, name: 'beta', exit: 0, at: new Date().toISOString() }) + '\n');
    r = json(pipe('tick', '--json'));
    assert.ok(['complete', 'built'].includes(find('beta').status), find('beta').status);
    assert.equal(find('beta').pipeline.lastRun.outcome, 'finished');
  });
  t('e2e session end: a clean stop with steps left goes back to Pending for Brett', () => {
    writeFileSync(join(hdir, 'events.jsonl'), readFileSync(join(hdir, 'events.jsonl'), 'utf8') + JSON.stringify({ event: 'session-end', session: find('alpha').pipeline.session, name: 'alpha', exit: 0, at: new Date().toISOString() }) + '\n');
    const r = json(pipe('tick', '--json'));
    assert.deepEqual(r.ended.map((e) => [e.id, e.outcome]), [['alpha', 'returned']]);
    assert.equal(find('alpha').status, 'pending'); assert.match(find('alpha').notes.at(-1).text, /back in Pending/);
  });
  t('e2e idle: nothing running with work in Pending raises the idle alert once, cleared when a build runs', () => {
    const st = JSON.parse(readFileSync(join(pipeDir, 'state.json'), 'utf8'));
    assert.equal(st.idle?.kind, 'empty'); assert.ok(st.alerts.some((a) => a.key === 'pipeline:idle'), 'idle recorded');
    json(pipe('queue', 'alpha', '--json'));
    json(pipe('tick', '--json'));
    const st2 = JSON.parse(readFileSync(join(pipeDir, 'state.json'), 'utf8'));
    assert.equal(st2.idle, null); assert.ok(!st2.alerts.some((a) => a.key === 'pipeline:idle'), 'idle resolved once alpha runs');
  });
  t('e2e login failure: the phone hears it, the build is held in Pending, and goes back to the Queue once the login works', () => {
    const acct = find('alpha').pipeline.account; const runsBefore0 = find('alpha').pipeline.runs; const logFile = join(tmp, 'alpha-run.log');
    writeFileSync(logFile, 'step 1…\nAPI Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}\n── finished (exit 1) ──\n');
    writeFileSync(join(hdir, 'events.jsonl'), readFileSync(join(hdir, 'events.jsonl'), 'utf8') + JSON.stringify({ event: 'session-end', session: find('alpha').pipeline.session, name: 'alpha', exit: 1, log: logFile, at: new Date().toISOString() }) + '\n');
    let r = json(pipe('tick', '--json'));
    const runsBefore = runsBefore0;
    assert.deepEqual(r.ended.map((e) => [e.id, !!e.auth]), [['alpha', true]]);
    assert.equal(find('alpha').pipeline.runs, runsBefore - 1, 'a run the login cut off does not count towards maxRuns');
    assert.equal(find('alpha').status, 'pending', 'held: a relaunch would hit the same login'); assert.equal(r.launched.length, 0);
    assert.ok(r.alertsSent.some((a) => a.key === 'pipeline:oauth:alpha'), 'phone alert sent'); assert.ok(!r.alertsSent.some((a) => a.key === 'pipeline:end:alpha'), 'one alert, the login one');
    assert.match(find('alpha').notes.at(-1).text, /Claude login failure on .*OAuth token has expired/);
    const waits = json(pipe('status', '--json')).state.authWaits; assert.equal(waits.alpha.account, acct); assert.equal(waits.alpha.requeued, false);
    assert.ok(existsSync(join(pipeDir, 'health-request.json')), 'a health sweep is asked for at once');
    r = json(pipe('tick', '--json')); assert.equal(find('alpha').status, 'pending', 'still held while the login is unproven'); assert.deepEqual(r.authRequeued, []);
    // the health sweep: the account signs in again
    const accFile = join(pipeDir, 'accounts.json'); const own = existsSync(accFile) ? JSON.parse(readFileSync(accFile, 'utf8')) : {};
    own[acct] = { ...(own[acct] ?? {}), health: { signedIn: true, credits: true, fable: true, error: '', at: new Date().toISOString() } };
    writeFileSync(accFile, JSON.stringify(own));
    r = json(pipe('tick', '--json'));
    assert.deepEqual(r.authRequeued, ['alpha']); assert.ok(r.alertsSent.some((a) => a.key === 'pipeline:oauth:alpha' && /works again/.test(a.title)), 'the phone hears it is back');
    assert.ok(['queued', 'running'].includes(find('alpha').status), find('alpha').status);
    assert.equal(json(pipe('status', '--json')).state.authWaits.alpha.requeued, true);
    // the fake launcher reuses the session name, so the old end event closes the new run on the same login error:
    // a second failure waits for a health answer newer than itself (no loop of re-queues on one sweep)
    assert.deepEqual(json(pipe('tick', '--json')).authRequeued, [], 'one health answer re-queues once');
  });
  t('e2e split request from the console is honoured on the next intake', () => {
    orch('act', JSON.stringify({ action: 'add', id: 'gamma', title: 'Gamma', steps: [{ text: 'big step', model: 'Opus', estimate: '3 h' }] }));
    json(pipe('split', 'gamma', '--request', '--json'));
    assert.ok(find('gamma').pipeline.splitRequested);
    const r = json(pipe('intake', '--json')); assert.deepEqual(r.split.map((x) => x.id), ['gamma']);
    assert.equal(find('gamma').steps.length, 2); assert.equal(find('gamma').pipeline.splitRequested, '');
  });
  t('e2e self-check: every account one by one, the host snapshot, and the console container reads it', () => {
    const r = json(pipe('selfcheck', '--reason', 'test', '--json'));
    assert.equal(r.ran, true); assert.equal(r.findings.length, 3); assert.match(r.line, /^3 accounts:/);
    assert.ok(r.findings.every((f) => ['ready', 'busy', 'standby', 'blocked'].includes(f.state)));
    assert.equal(r.findings.find((f) => f.name === 'console').state, 'standby', 'workers exist: the console account stands by');
    assert.ok(existsSync(join(pipeDir, 'accounts-host.json')));
    // the console runs in a container with no ~/.claude-accounts: it reads the host's snapshot (was: no account at all)
    const box = spawnSync(process.execPath, [join(HERE, 'pipeline.mjs'), 'status', '--json'], { cwd: ROOT, env: { ...env, AXF_CLAUDE_ACCOUNTS: join(tmp, 'no-such-dir') }, encoding: 'utf8', timeout: 120000 });
    const s = JSON.parse(box.stdout.trim().split('\n').pop());
    assert.equal(s.accountsFrom.source, 'snapshot'); assert.equal(s.accounts.length, 3); assert.equal(s.state.selfCheck.line, r.line);
    assert.ok(!s.plan.waits.some((w) => /no Claude account is signed in/.test(w.why)));
    // in the container a self-check is a request the next host tick runs
    const ask = spawnSync(process.execPath, [join(HERE, 'pipeline.mjs'), 'selfcheck', '--json'], { cwd: ROOT, env: { ...env, AXF_CLAUDE_ACCOUNTS: join(tmp, 'no-such-dir') }, encoding: 'utf8', timeout: 120000 });
    const a = JSON.parse(ask.stdout.trim().split('\n').pop()); assert.equal(a.ran, false); assert.ok(a.requested);
    assert.ok(existsSync(join(pipeDir, 'selfcheck-request.json')));
    const tk = json(pipe('tick', '--json')); assert.equal(tk.selfCheck?.reason, 'on demand'); assert.ok(!existsSync(join(pipeDir, 'selfcheck-request.json')), 'the tick ran it');
  });
  t('e2e stale reaper: a build marked running on an account with no session and no slot goes back to the Queue', () => {
    orch('act', JSON.stringify({ action: 'add', id: 'ghost', title: 'Ghost', steps: [{ text: 'never ran', model: 'Opus', estimate: '20 min' }] }));
    json(pipe('queue', 'ghost', '--json'));
    const old = new Date(Date.now() - 3600e3).toISOString();
    const st = store(); const g = st.builds.find((b) => b.id === 'ghost');
    g.status = 'running'; g.pipeline = { ...g.pipeline, account: 'w-max', session: '', slot: 'hl-gone', launchedAt: old };
    writeFileSync(storeFile, JSON.stringify(st));
    const r = json(pipe('selfcheck', '--json'));
    assert.ok(r.fixes.some((f) => /requeued ghost/.test(f)), r.fixes.join('; '));
    assert.equal(find('ghost').status, 'queued'); assert.equal(find('ghost').pipeline.account || '', '');
    json(pipe('unqueue', 'ghost', '--json'));
  });
  t('e2e double dispatch (Nov 13 2026): a live session blocks a second launch and the self-check never releases it', () => {
    const pipeWith = (extra, ...a) => { const r = spawnSync(process.execPath, [join(HERE, 'pipeline.mjs'), ...a], { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120000 }); if (r.status !== 0) throw new Error(`pipeline ${a.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`); return r; };
    const launches = () => readFileSync(join(tmp, 'launches.log'), 'utf8').split('\n').filter((l) => /--name dup /.test(l)).length;
    orch('act', JSON.stringify({ action: 'add', id: 'dup', title: 'Dup', steps: [{ text: 'one step', model: 'Opus', estimate: '10 min' }] }));
    json(pipe('queue', 'dup', '--json'));
    mkdirSync(join(wtRoot, 'dup'), { recursive: true });
    const old = new Date(Date.now() - 3600e3).toISOString();
    // (1) the self-check: marked running with no session on record, but tmux axf-dup--fake is alive → kept, session adopted
    { const st = store(); const d = st.builds.find((b) => b.id === 'dup'); d.status = 'running'; d.pipeline = { ...d.pipeline, account: 'w-pro', session: '', slot: 'hl-gone', launchedAt: old }; writeFileSync(storeFile, JSON.stringify(st)); }
    let r = json(pipeWith({ AXF_BUILD_LOCK_TMUX: 'axf-dup--fake' }, 'selfcheck', '--json'));
    assert.ok(!r.fixes.some((f) => /requeued dup/.test(f)), r.fixes.join('; '));
    assert.equal(find('dup').status, 'running'); assert.equal(find('dup').pipeline.session, 'axf-dup--fake');
    // (2) released too early (back in the Queue) while a renamed duplicate session is alive → the tick refuses to launch it again
    { const st = store(); const d = st.builds.find((b) => b.id === 'dup'); d.status = 'queued'; d.pipeline = { ...d.pipeline, account: '', session: '', slot: '' }; writeFileSync(storeFile, JSON.stringify(st)); }
    const before = launches();
    r = json(pipeWith({ AXF_BUILD_LOCK_TMUX: 'axf-dup--fake-201500,axf-dupe-other--x' }, 'tick', '--json'));
    assert.ok(!r.launched.some((l) => l.id === 'dup'), 'no second launch'); assert.equal(launches(), before);
    assert.ok(r.plan.waits.some((w) => w.id === 'dup' && /already has a live session: tmux axf-dup--fake-201500/.test(w.why)), JSON.stringify(r.plan.waits));
    assert.ok(!r.failed.some((f) => f.id === 'dup'), 'a gated launch is not a launch failure');
    assert.equal(find('dup').status, 'running', 'the live session is adopted'); assert.equal(find('dup').pipeline.session, 'axf-dup--fake-201500');
    // (3) a fresh lock alone (a launch waiting in the agent-slots queue: no tmux yet) also blocks the launch
    { const st = store(); const d = st.builds.find((b) => b.id === 'dup'); d.status = 'queued'; d.pipeline = { ...d.pipeline, session: '' }; writeFileSync(storeFile, JSON.stringify(st)); }
    writeFileSync(join(wtRoot, 'dup', '.axf-build.lock'), JSON.stringify({ $axf: 'build-lock@1', build: 'dup', session: '', beat: new Date().toISOString() }));
    r = json(pipe('tick', '--json'));
    assert.ok(!r.launched.some((l) => l.id === 'dup')); assert.equal(launches(), before); assert.equal(find('dup').status, 'queued');
    assert.ok(r.plan.waits.some((w) => w.id === 'dup' && /lock launching/.test(w.why)));
    // (4) a stale lock expires: the dispatcher launches once and writes a fresh lock with the session name
    writeFileSync(join(wtRoot, 'dup', '.axf-build.lock'), JSON.stringify({ $axf: 'build-lock@1', build: 'dup', session: 'axf-dup--old', beat: old }));
    r = json(pipe('tick', '--json'));
    assert.deepEqual(r.launched.filter((l) => l.id === 'dup').length, 1, JSON.stringify({ waits: r.plan.waits, failed: r.failed })); assert.equal(launches(), before + 1);
    const lk = JSON.parse(readFileSync(join(wtRoot, 'dup', '.axf-build.lock'), 'utf8'));
    assert.equal(lk.build, 'dup'); assert.equal(lk.session, 'axf-dup--fake'); assert.equal(lk.expired, old);
    assert.equal(json(pipe('tick', '--json')).launched.filter((l) => l.id === 'dup').length, 0, 'the next tick never launches it twice');
    // the session ends: the lock goes with it
    writeFileSync(join(hdir, 'events.jsonl'), readFileSync(join(hdir, 'events.jsonl'), 'utf8') + JSON.stringify({ event: 'session-end', session: find('dup').pipeline.session, name: 'dup', exit: 0, at: new Date().toISOString() }) + '\n');
    json(pipe('tick', '--json'));
    assert.ok(!existsSync(join(wtRoot, 'dup', '.axf-build.lock')), 'lock released at session end');
    if (find('dup').status === 'queued') json(pipe('unqueue', 'dup', '--json'));
  });
  t('e2e hold / release / archive / delete / restore, one and many at once (bulk select)', () => {
    for (const id of ['h1', 'h2', 'h3']) { orch('act', JSON.stringify({ action: 'add', id, title: id.toUpperCase(), steps: [{ text: `do ${id}`, model: 'Opus', estimate: '20 min' }] })); json(pipe('queue', id, '--json')); }
    let r = json(pipe('hold', 'h1', 'h2', '--why', 'waiting on Brett', '--by', 'brett', '--json'));
    assert.deepEqual(r.done.map((d) => [d.id, d.tab]), [['h1', 'queue'], ['h2', 'queue']]);
    assert.equal(find('h1').status, 'queued'); assert.equal(find('h1').pipeline.heldBy, 'brett'); assert.equal(find('h1').pipeline.heldWhy, 'waiting on Brett');
    const s = json(pipe('status', '--json'));
    assert.ok(s.tabs.queue.find((x) => x.id === 'h1').held); assert.deepEqual(s.tabs.queue.find((x) => x.id === 'h1').actions, ['unqueue', 'release', 'archive', 'delete']);
    assert.ok(s.plan.held.includes('h1') && !s.plan.launches.some((l) => l.id === 'h1'));
    assert.notEqual(pipe('hold', 'h1', '--json', '--expect-fail').status, 0, 'holding a held build is refused');
    r = json(pipe('release', 'h2', '--json')); assert.equal(find('h2').pipeline?.heldAt ?? '', '');
    r = json(pipe('unqueue', 'h1', '--json')); assert.equal(find('h1').status, 'pending'); assert.equal(find('h1').pipeline?.heldAt ?? '', '', 'back to Pending drops the hold');
    // archive: one queued, one pending; a running build is refused, the rest still go
    { const st = store(); st.builds.find((b) => b.id === 'ghost').status = 'running'; writeFileSync(storeFile, JSON.stringify(st)); }
    r = json(pipe('archive', 'h1', 'h2', 'ghost', '--json'));
    assert.deepEqual(r.done.map((d) => [d.id, d.tab]), [['h1', 'archive'], ['h2', 'archive']]);
    assert.equal(r.refused[0].id, 'ghost'); assert.match(r.refused[0].error, /live session/);
    assert.equal(find('h2').pipeline?.queuedAt ?? '', '', 'leaving the Queue clears it');
    assert.ok(json(pipe('tab', 'archive', '--json')).rows.some((x) => x.id === 'h1'));
    r = json(pipe('unarchive', 'h1', '--json')); assert.equal(find('h1').status, 'pending');
    // delete: soft, kept forever, restorable; a queued build comes back in Pending
    r = json(pipe('delete', 'h3', 'h1', '--why', 'not wanted', '--json'));
    assert.deepEqual(r.done.map((d) => d.tab), ['deleted', 'deleted']);
    assert.equal(find('h3').deleted, true); assert.ok(find('h3').deletedAt); assert.equal(find('h3').status, 'pending');
    const del = json(pipe('tab', 'deleted', '--json')).rows; assert.deepEqual(del.map((x) => x.id).sort(), ['h1', 'h3']); assert.deepEqual(del[0].actions, ['restore']);
    assert.ok(!json(pipe('status', '--json')).plan.queue.includes('h3'));
    orch('act', JSON.stringify({ action: 'note', id: 'beta', text: 'an orchestrator write after the delete' }));
    assert.equal(find('h3').deleted, true, 'an orchestrator write never drops or revives a deleted build');
    r = json(pipe('restore', 'h3', '--json')); assert.equal(find('h3').deleted, false); assert.equal(r.done[0].tab, 'pending');
    assert.notEqual(pipe('restore', 'h3', '--json', '--expect-fail').status, 0, 'restoring a live build is refused');
    assert.notEqual(pipe('archive', 'nope', '--json', '--expect-fail').status, 0, 'unknown build: refused');
    assert.match(readFileSync(join(pipeDir, 'log.jsonl'), 'utf8'), /"event":"hold"/);
  });
  t('e2e rules fallback when the splitter fails', () => {
    writeFileSync(splitter, '#!/usr/bin/env bash\nexit 1\n');
    orch('act', JSON.stringify({ action: 'add', id: 'delta', title: 'Delta', detail: 'Add the delta screen.\nDesign the delta schema.' }));
    const r = json(pipe('intake', '--json')); assert.deepEqual(r.split.map((x) => x.id), ['delta']);
    assert.equal(find('delta').pipeline.split.provider, 'rules'); assert.ok(find('delta').steps.length >= 3); assert.match(find('delta').pipeline.note, /rules/);
  });
}

console.log(`pipeline: ${n} checks passed${e2e ? '' : ' (CLI end-to-end skipped)'}`);
