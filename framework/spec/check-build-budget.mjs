#!/usr/bin/env node
/**
 * build-budget@1 checks: the budget engine (framework/core/build-budget.mjs) against its fixture, so a port answers the
 * same, and the rules themselves (no cap until one is saved, a build's spend is every session of it, the day's spend
 * is today's sessions, a stop is released when the cap allows it again). The Claude settings plugin's own test holds
 * the registry's defaults for the two settings to the engine's.
 *   node framework/spec/check-build-budget.mjs            check
 *   node framework/spec/check-build-budget.mjs --write    regenerate framework/spec/fixtures/build-budget.json from the engine
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from '../core/build-budget.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = join(ROOT, 'framework/spec/fixtures/build-budget.json');
let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

const DAY = Date.parse('2026-11-23T00:00:00.000Z');
const IDS = ['alpha', 'alpha-two', 'beta', 'hand-one'];
const METERS = [
  { session: 'axf-alpha--s1--earl', name: 'alpha--s1', costUsd: 20, startedAt: '2026-11-23T08:00:00.000Z' },
  { session: 'axf-alpha--s2--gina', name: 'alpha--s2', costUsd: 12.5, startedAt: '2026-11-22T23:00:00.000Z' },
  { session: 'axf-lander-fix-pr12-1--joey', name: 'lander-fix-pr12-1', cwd: '/root/axf-builds/lander-fix-alpha', costUsd: 3, startedAt: '2026-11-23T09:00:00.000Z' },
  { session: 'axf-alpha-two--s1--earl', name: 'alpha-two--s1', costUsd: 7, startedAt: '2026-11-23T10:00:00.000Z' },
  { session: 'axf-hand-one--paulie', name: 'hand-one', costUsd: 40, startedAt: '2026-11-23T11:00:00.000Z' },
  { session: 'axf-chat--sully', name: 'chat', costUsd: 5, startedAt: '2026-11-23T12:00:00.000Z' },
  { session: 'axf-beta--s1--earl', name: 'beta--s1', build: 'beta', costUsd: 0, startedAt: '2026-11-23T12:00:00.000Z' },
];
const out = (id, more = {}) => ({ id, flow: 'pipeline-2', status: 'building', steps: [{ id: 's1', status: 'building' }], ...more });
const BUILDS = [
  out('alpha'), out('alpha-two'), out('hand-one', { hand: { at: '2026-11-23T11:00:00.000Z', by: 'x' } }),
  { id: 'beta', flow: 'pipeline-2', status: 'split', steps: [{ id: 's1', status: 'pending' }] },
];
const spend = B.spendOf(METERS, { ids: IDS, dayStart: DAY });
const CAPS = [
  {}, { 'builds.budgetPerBuildUsd': 30 }, { 'builds.budgetDailyUsd': 60 }, { 'builds.budgetPerBuildUsd': 30, 'builds.budgetDailyUsd': 60 },
  { 'builds.budgetPerBuildUsd': 0, 'builds.budgetDailyUsd': 0 }, { 'builds.budgetPerBuildUsd': 'x', 'builds.budgetDailyUsd': -1 },
];
const STOPPED = [
  out('alpha', { budgetStop: { at: 'T', kind: 'build', spentUsd: 35.5, capUsd: 30 }, steps: [{ id: 's1', status: 'failed' }] }),
  out('hand-one', { status: 'failed', budgetStop: { at: 'T', kind: 'daily', spentUsd: 75, capUsd: 60 }, steps: [{ id: 's1', status: 'failed' }] }),
];

const fixture = {
  $axf: 'build-budget-fixture@1', schema: B.SCHEMA, keys: B.KEYS, defaults: B.DEFAULTS,
  caps: CAPS.map((values) => ({ values, caps: B.capsOf(values) })),
  sessions: ['axf-alpha--s1--earl', 'alpha--s2', 'axf-alpha-two--s1--earl', 'lander-fix-alpha', 'axf-hand-one--paulie', 'axf-alphabet--earl', 'axf-chat--sully', ''].map((name) => ({ name, build: B.buildOfSession(name, IDS) })),
  spend: { meters: METERS, ids: IDS, dayStart: DAY, ...spend },
  decisions: CAPS.map((values) => ({ values, ...B.decide({ builds: BUILDS, caps: B.capsOf(values), spend }) })),
  releases: CAPS.map((values) => ({ values, clears: B.decide({ builds: STOPPED, caps: B.capsOf(values), spend }).clears })),
  sessionOut: [...BUILDS, ...STOPPED, { id: 'r', status: 'running', steps: [] }, { id: 'a', status: 'archived', steps: [{ id: 's1', status: 'building' }] }, { id: 'd', status: 'building', deleted: true, steps: [{ id: 's1', status: 'building' }] }].map((b) => ({ id: b.id, status: b.status, out: B.hasSessionOut(b) })),
  lines: [{ id: 'alpha', kind: 'build', spentUsd: 35.5, capUsd: 30 }, { id: 'hand-one', kind: 'daily', spentUsd: 75, capUsd: 60 }].map((stop) => ({ stop, line: B.stopLine(stop, { title: 'A title' }) })),
};
if (process.argv.includes('--write')) { writeFileSync(FIX, `${JSON.stringify(fixture, null, 1)}\n`); console.log(`wrote ${FIX}`); process.exit(0); }
let fx = null; try { fx = JSON.parse(readFileSync(FIX, 'utf8')); } catch { ok(false, `fixture ${FIX} missing: run with --write`); }
if (fx) eq(fx, JSON.parse(JSON.stringify(fixture)), 'the engine answers as its fixture says');

// ---- the rules themselves
eq([B.capsOf({}).perBuildUsd, B.capsOf({}).dailyUsd], [0, 0], 'no cap until a number is saved');
eq(spend.byBuild, { alpha: 35.5, 'alpha-two': 7, 'hand-one': 40 }, 'a build\'s spend: its steps, its own session, its fix sessions; over its whole life');
eq(spend.dayUsd, 75, 'the day\'s spend: every session started today, build or not');
eq(B.decide({ builds: BUILDS, caps: B.capsOf({}), spend }).stops, [], 'no cap, no stop');
eq(B.decide({ builds: BUILDS, caps: B.capsOf({ 'builds.budgetPerBuildUsd': 30 }), spend }).stops.map((s) => [s.id, s.kind]), [['alpha', 'build'], ['hand-one', 'build']], 'the per-build cap stops the builds at or over it, hand builds too');
eq(B.decide({ builds: BUILDS, caps: B.capsOf({ 'builds.budgetDailyUsd': 60 }), spend }).stops.map((s) => [s.id, s.kind]), [['alpha', 'daily'], ['alpha-two', 'daily'], ['hand-one', 'daily']], 'the daily cap stops every build with a session out; a waiting build has nothing to stop');
ok(B.decide({ builds: BUILDS, caps: B.capsOf({ 'builds.budgetDailyUsd': 75 }), spend }).daily.reached && !B.decide({ builds: BUILDS, caps: B.capsOf({ 'builds.budgetDailyUsd': 75.01 }), spend }).daily.reached, 'reached means at the cap, not past it');
eq(B.decide({ builds: STOPPED, caps: B.capsOf({ 'builds.budgetPerBuildUsd': 30, 'builds.budgetDailyUsd': 60 }), spend }).clears, [], 'a stop stays while its cap still says so');
eq(B.decide({ builds: STOPPED, caps: B.capsOf({ 'builds.budgetPerBuildUsd': 100 }), spend }).clears.map((c) => c.id), ['alpha', 'hand-one'], 'a raised or removed cap releases the stop');
eq(B.decide({ builds: STOPPED, caps: B.capsOf({ 'builds.budgetPerBuildUsd': 30, 'builds.budgetDailyUsd': 60 }), spend: { ...spend, dayUsd: 0 } }).clears.map((c) => c.id), ['hand-one'], 'a new day releases a daily stop, never a per-build one');
eq(B.alertOf([], { reached: false }), null, 'nothing stopped, no alert');
ok(/Budget per build \(USD\)/.test(B.stopLine({ id: 'a', kind: 'build', spentUsd: 1, capUsd: 1 })) && /Daily budget \(USD\)/.test(B.stopLine({ id: 'a', kind: 'daily', spentUsd: 1, capUsd: 1 })), 'every stop names the one setting that moves it');

console.log(`${failed ? 'FAILED' : 'ok'} build-budget@1: ${n - failed}/${n}`);
process.exit(failed ? 1 : 0);
