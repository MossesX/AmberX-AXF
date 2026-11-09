#!/usr/bin/env node
/**
 * workers-api-routing: the pure router (deploy/worker-routing.mjs): defaults, roles, per-account building / queue
 * limits, routing rules (job type, model, size, priority, profile, subscriptions-busy fallback, order, on/off), API
 * spend caps and alerts, and who may raise a cap. Also its stdin CLI, which the console server runs.
 *
 *   node deploy/worker-routing.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './worker-routing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const ok = (v, what) => { if (!v) { console.error(`✗ ${what}`); process.exit(1); } passed += 1; console.log(`  ✓ ${what}`); };

const sub = (name, o = {}) => ({ name, kind: 'subscription', active: false, limited: null, running: 0, queued: 0, costToday: 0, costWeek: 0, ...o });
const api = (name, o = {}) => ({ name, kind: 'api', hasKey: true, active: false, limited: null, running: 0, queued: 0, costToday: 0, costWeek: 0, ...o });
const team = (o = {}) => [sub('console', { active: true, ...(o.console ?? {}) }), sub('w1', o.w1), sub('w2', o.w2), api('hulu-api', o.hulu), api('mx-api', o.mx)];
const caps = { 'hulu-api': { label: 'Hulu API', dailyCapUsd: 10, weeklyCapUsd: 50 }, 'mx-api': { label: 'Moses X API', dailyCapUsd: 10, weeklyCapUsd: 50 } };

console.log('config');
const d = R.normConfig(null);
ok(d.interactiveTakesJobs === true && d.limits.building === 3 && d.limits.queue === 5 && d.rules.length === 0, 'defaults: console account takes jobs, 3 building, 5 queued, no rules');
const c1 = R.normConfig({ limits: { building: 99, queue: -4 }, workers: ['w2', 'BAD NAME', 'w2'], rules: [{ name: 'Big', to: 'api' }, { name: 'Big' }, { to: 'weird', when: { models: 'Fable, sonnet', priorities: ['urgent', 'low', 'nope'], subs: 'busy' } }] });
ok(c1.limits.building === R.MAX_LIMIT && c1.limits.queue === 0, 'limits are clamped');
ok(c1.workers.join() === 'w2', 'bad and repeated names dropped');
ok(c1.rules.map((r) => r.id).join() === 'big,big-2,rule-3', 'rule ids are unique');
ok(c1.rules[2].to === 'api' && c1.rules[2].when.models.join() === 'fable,opus' && c1.rules[2].when.priorities.join() === 'P0,P3' && c1.rules[2].when.subs === 'busy', 'words become models / priorities (Sonnet runs as Opus)');

console.log('roles');
const ro = R.roster({ excluded: ['w2'], api: { 'hulu-api': caps['hulu-api'] } }, team());
const role = (n) => ro.find((r) => r.name === n).role;
ok(role('console') === 'interactive' && role('w1') === 'worker' && role('w2') === 'saved', 'every subscription login is a worker unless stopped; the active one is interactive');
ok(role('hulu-api') === 'api-worker' && role('mx-api') === 'api-off', 'an API key works only once it is set up');
ok(R.roster({ api: caps }, [api('hulu-api', { hasKey: false })])[0].takesJobs === false, 'an API slot with no key takes nothing');

console.log('subscriptions, no rules');
let x = R.decide({ api: caps }, team(), { model: 'opus' });
ok(x.state === 'run' && x.account === 'w1' && x.kind === 'subscription', 'the first idle worker');
x = R.decide({ api: caps }, team({ w1: { running: 1 } }), {});
ok(x.account === 'w2', 'the least busy worker');
x = R.decide({ api: caps }, team({ w1: { running: 3 }, w2: { running: 3 } }), {});
ok(x.account === 'console' && x.state === 'run', 'workers full = the console\'s own account (setting on)');
x = R.decide({ api: caps }, team({ w1: { running: 1 }, w2: { running: 1 } }), {});
ok(x.account === 'w1', 'the console\'s account goes after the workers, even when idle');
x = R.decide({ api: caps, interactiveTakesJobs: false }, team({ w1: { running: 3 }, w2: { running: 3 } }), {});
ok(x.state === 'queue' && x.account === 'w1' && x.position === 1, 'console account off + workers full = wait in a worker\'s queue');
x = R.decide({ api: caps, interactiveTakesJobs: false }, team({ w1: { running: 3, queued: 2 }, w2: { running: 3, queued: 1 } }), {});
ok(x.state === 'queue' && x.account === 'w2' && x.position === 2, 'the shortest queue');
x = R.decide({ api: caps, interactiveTakesJobs: false, limits: { queue: 2 } }, team({ w1: { running: 3, queued: 2 }, w2: { running: 3, queued: 2 } }), {});
ok(x.state === 'none' && /queue is full/.test(x.why), 'every queue full = none');
x = R.decide({ api: caps, perAccount: { w1: { building: 1 } } }, team({ w1: { running: 1 } }), {});
ok(x.account === 'w2', 'a per-account building limit');
ok(R.normConfig({ perAccount: { w1: { fable: true }, w2: { fable: 'yes' } } }).perAccount.w1.fable === true && !R.normConfig({ perAccount: { w2: { fable: 'yes' } } }).perAccount.w2, 'perAccount.fable: a boolean only (the orchestrator reads it)');
ok(R.roster({ perAccount: { w1: { fable: false } } }, team()).find((r) => r.name === 'w1').fable === false && R.roster({}, team()).find((r) => r.name === 'w2').fable === null, 'roster carries Fable by hand (null = auto)');
x = R.decide({ api: caps }, team({ w1: { limited: { until: 'later', reason: 'hit its limit' } } }), {});
ok(x.account === 'w2', 'a limited account is skipped');
ok(R.decide({ api: caps }, team(), { model: 'fable' }).kind === 'subscription', 'no rule = API accounts never get a job');

console.log('rules');
const rules = [
  { name: 'Keep urgent on subs', to: 'subscription', when: { priorities: ['P0'] } },
  { name: 'Small Opus jobs to API', to: 'api', accounts: ['hulu-api'], when: { models: ['opus'], maxSteps: 3, jobTypes: ['walkthrough', 'ui-shots'] } },
  { name: 'Overflow', to: 'api', when: { subs: 'busy' } },
];
const cfg = { api: caps, rules };
x = R.decide(cfg, team(), { model: 'opus', jobType: 'walkthrough', steps: 2 });
ok(x.state === 'run' && x.account === 'hulu-api' && x.kind === 'api' && x.rule === 'small-opus-jobs-to-api', 'a matching rule sends it to its API account');
ok(R.decide(cfg, team(), { model: 'opus', jobType: 'walkthrough', steps: 5 }).kind === 'subscription', 'size: too many steps');
ok(R.decide(cfg, team(), { model: 'fable', jobType: 'walkthrough', steps: 1 }).kind === 'subscription', 'model must match');
ok(R.decide(cfg, team(), { model: 'opus', jobType: 'build', steps: 1 }).kind === 'subscription', 'job type must match');
x = R.decide(cfg, team(), { model: 'opus', jobType: 'walkthrough', steps: 1, priority: 'urgent' });
ok(x.kind === 'subscription' && x.rule === 'keep-urgent-on-subs', 'order: the first matching rule wins');
x = R.decide({ ...cfg, rules: [{ ...rules[0], enabled: false }, ...rules.slice(1)] }, team(), { model: 'opus', jobType: 'walkthrough', steps: 1, priority: 'urgent' });
ok(x.kind === 'api' && x.considered[0].why === 'switched off', 'a switched-off rule is skipped');
ok(R.decide({ api: caps, rules: [{ to: 'api', when: { profiles: ['refactor'] } }] }, team(), { profile: 'refactor' }).kind === 'api', 'profile');
ok(R.decide({ api: caps, rules: [{ to: 'api', when: { maxMinutes: 30 } }] }, team(), { minutes: 45 }).kind === 'subscription', 'estimated minutes');
ok(R.decide({ api: caps, rules: [{ to: 'api', when: { minSteps: 10 } }] }, team(), { steps: 12 }).kind === 'api', 'minimum steps');

console.log('fallback when subscriptions are busy or limited');
const out = { until: 'later', reason: 'hit its limit' };
ok(R.decide(cfg, team(), { model: 'fable' }).kind === 'subscription', 'subs free = the fallback rule does not apply');
x = R.decide(cfg, team({ console: { running: 3 }, w1: { running: 3 }, w2: { running: 3 } }), { model: 'fable' });
ok(x.kind === 'api' && x.rule === 'overflow' && x.account === 'hulu-api', 'every subscription full = overflow to the least busy API account');
x = R.decide(cfg, team({ console: { limited: out }, w1: { limited: out }, w2: { limited: out }, hulu: { running: 1 } }), { model: 'fable' });
ok(x.kind === 'api' && x.account === 'mx-api', 'every subscription limited = overflow too, least busy API first');

console.log('spend caps');
const s = R.spendOf({ costToday: 8.5, costWeek: 20 }, caps['hulu-api']);
ok(s.state === 'warn' && /8.50 of the \$10 daily cap/.test(s.why), '80% of a cap = warn');
ok(R.spendOf({ costToday: 10, costWeek: 20 }, caps['hulu-api']).state === 'capped', 'at the daily cap = capped');
ok(R.spendOf({ costToday: 1, costWeek: 50.2 }, caps['hulu-api']).state === 'capped', 'over the weekly cap = capped');
ok(R.spendOf({ costToday: 1000 }, { dailyCapUsd: 0 }).state === 'ok', 'no cap = never capped');
x = R.decide(cfg, team({ hulu: { costToday: 10 } }), { model: 'opus', jobType: 'walkthrough', steps: 1 });
ok(x.kind === 'subscription' && /daily cap \$10 reached/.test(x.why), 'a capped API account takes nothing more: the job falls through to a subscription');
x = R.decide(cfg, team({ console: { running: 3 }, w1: { running: 3 }, w2: { running: 3 }, hulu: { costWeek: 60 }, mx: { costToday: 11 } }), {});
ok(x.state === 'queue' && x.kind === 'subscription' && x.account === 'w1' && /no API account free/.test(x.why), 'every API account capped: back to the subscriptions, waiting in a worker\'s queue');
const al = R.alerts(cfg, team({ hulu: { costToday: 9 }, mx: { costWeek: 55, hasKey: false } }));
ok(al.length === 3 && al.find((a) => a.account === 'hulu-api').level === 'warn' && al.find((a) => a.account === 'mx-api' && a.kind === 'spend').level === 'error' && al.some((a) => a.kind === 'key'), 'alerts: near a cap, over a cap, no key');

console.log('raising a cap');
ok(R.raisedCaps({ api: caps }, { api: { ...caps, 'hulu-api': { ...caps['hulu-api'], dailyCapUsd: 20 } } }).length === 1, 'a higher cap is a raise');
ok(R.raisedCaps({ api: caps }, { api: { ...caps, 'hulu-api': { ...caps['hulu-api'], weeklyCapUsd: 0 } } }).length === 1, 'removing a cap is a raise');
ok(R.raisedCaps({ api: caps }, { api: { ...caps, 'hulu-api': { ...caps['hulu-api'], dailyCapUsd: 5 } } }).length === 0, 'lowering is not');
ok(R.raisedCaps({}, { api: { new: { dailyCapUsd: 5 } } }).length === 1 && R.raisedCaps({}, { api: { new: { dailyCapUsd: 5, weeklyCapUsd: 20 } } }).length === 0, 'a new API account needs both caps');

console.log('CLI (stdin JSON, the console server\'s way in)');
const run = (op, input) => spawnSync(process.execPath, [join(HERE, 'worker-routing.mjs'), op], { input: JSON.stringify(input), encoding: 'utf8' });
const r1 = JSON.parse(run('decide', { config: cfg, accounts: team(), job: { model: 'opus', jobType: 'walkthrough', steps: 2 } }).stdout);
ok(r1.account === 'hulu-api' && r1.considered.length === 2, 'decide');
ok(JSON.parse(run('normalize', { config: {} }).stdout).$axf === 'claude-workers@1', 'normalize');
ok(run('nope', {}).status === 2, 'an unknown op is refused');

console.log(`✓ worker-routing: ${passed} checks passed`);
