#!/usr/bin/env node
/**
 * Predicted looks (ui-prediction@1 / ui-mockup@1, framework/core/ui-predict.mjs) and their CLI
 * (framework/cli/ui-predict.mjs, offline: no browser, no console).
 *   node framework/spec/check-ui-predict.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/ui-predict.mjs';
import * as S from '../core/ui-review-schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
let n = 0; const t = (name, f) => { try { f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const AT = '2026-11-03T20:00:00.000Z';
const BUILD = {
  id: 'demo-look', title: 'Look approval for UI builds', detail: 'UI Review shows predicted pictures before a build runs.',
  steps: [
    { id: 's1', text: "s1 Setting: 'Wait for my look approval before UI builds start' (default off)" },
    { id: 's2', text: 's2 UI Review item: badge Predicted, Approve look / Ask changes / Reject buttons' },
    { id: 's3', text: 's3 Tests, report, THREADS, PR' },
    { id: 's4', text: 's4 Backfill predicted items for queued builds' },
  ],
};

t('touchesUi: words or files say so; plumbing alone does not', () => {
  assert.ok(P.touchesUi(BUILD));
  assert.ok(P.touchesUi({ title: 'x', steps: [] }, ['apps/console-web/plugins/foo/web/ui.tsx']));
  assert.ok(!P.touchesUi({ title: 'Store migration', detail: 'journal rewrite', steps: [{ text: 's1 migrate the journal' }] }, ['framework/cli/builds-store.mjs']));
});

t('screensFor: most likely first, passing mentions dropped, plugin files become screens', () => {
  assert.deepEqual(P.screensFor(BUILD).map((s) => s.id), ['ui-review']);
  const s = P.screensFor({ title: 'Toolbars: tap to confirm', steps: [{ text: 'toolbar settings dialog' }] });
  assert.equal(s[0].id, 'toolbars');
  const f = P.screensFor({ title: 'x', steps: [] }, ['apps/console-web/plugins/sample-crew/web/x.tsx'], { plugins: { 'sample-crew': 'Breakroom crew' } });
  assert.equal(f[0].title, 'Breakroom crew'); assert.equal(f[0].search, 'Breakroom crew');
  assert.equal(P.screensFor({ title: 'Something new', steps: [] }).length, 1, 'always at least one screen');
});

t('blocks: settings rows from quoted labels, actions from A / B / C runs, plumbing skipped', () => {
  const b1 = P.blockFor(BUILD.steps[0]);
  assert.equal(b1.type, 'settings'); assert.equal(b1.rows[0].label, 'Wait for my look approval before UI builds start'); assert.equal(b1.rows[0].on, false);
  const b2 = P.blockFor(BUILD.steps[1]);
  assert.ok(['chips', 'actions'].includes(b2.type)); assert.deepEqual(b2.items.slice(-3), ['Approve look', 'Ask changes', 'Reject']);
  assert.equal(P.blockFor(BUILD.steps[2]), null); assert.equal(P.blockFor(BUILD.steps[3]), null);
});

t('mockupSpec: ui-mockup@1, settings merged, rules cost $0, hash ignores the time', () => {
  const a = P.mockupSpec(BUILD, { at: AT }); const b = P.mockupSpec(BUILD, { at: '2026-11-04T00:00:00Z' });
  assert.equal(a.$axf, 'ui-mockup@1'); assert.equal(a.build, 'demo-look'); assert.deepEqual(a.cost, { usd: 0, model: 'rules', tokens: 0 });
  assert.equal(a.screens[0].blocks.filter((x) => x.type === 'settings').length, 1);
  assert.equal(P.specHash(a), P.specHash(b), 'same look = same hash');
  assert.notEqual(P.specHash(a), P.specHash(P.mockupSpec({ ...BUILD, steps: [...BUILD.steps, { text: 's5 A new dialog: confirm before delete' }] })), 'a new step = new pictures');
  assert.ok(a.demo.rows.length >= 1);
});

t('encode/decode: one screen per URL, round trip, junk = null', () => {
  const spec = P.mockupSpec(BUILD, { at: AT });
  const e = P.encodeScreen(spec, spec.screens[0].id);
  assert.match(e, /^[A-Za-z0-9_-]+$/);
  const d = P.decodeScreen(e); assert.equal(d.screens.length, 1); assert.deepEqual(d.screens[0], spec.screens[0]);
  assert.equal(P.decodeScreen('nope'), null); assert.equal(P.decodeScreen(''), null);
});

t('capturePlan: before (search) + predicted (mockup page) per screen; real = the screens only', () => {
  const spec = P.mockupSpec(BUILD, { at: AT });
  const plan = P.capturePlan(spec);
  assert.deepEqual(plan.map((x) => x.name), ['before-ui-review', 'predicted-ui-review']);
  assert.ok(plan[1].path.startsWith(`/?${P.MOCKUP_PARAM}=`)); assert.deepEqual(plan[0].viewports, ['phone', 'desktop']);
  assert.deepEqual(P.capturePlan(spec, { before: false }).map((x) => x.name), ['predicted-ui-review']);
  assert.deepEqual(P.capturePlan(spec, { role: 'real' }).map((x) => x.name), ['real-ui-review']);
  assert.equal(P.roleOf('items/r-1/before-ui-review-phone.png'), 'before'); assert.equal(P.roleOf('2-predicted-x.png'), 'predicted'); assert.equal(P.roleOf('home-phone.png'), 'real');
});

t('prediction block: fresh, validated, look decisions + addenda, real swap', () => {
  const p = P.newPrediction(P.mockupSpec(BUILD, { at: AT }), { at: AT });
  assert.equal(p.$axf, 'ui-prediction@1'); assert.equal(p.state, 'predicted'); assert.equal(p.look.status, 'waiting'); assert.deepEqual(P.predictionErrors(p), []);
  assert.ok(P.predictionErrors({ state: 'maybe' }).length >= 2);
  const c = P.decideLook(p, 'changes', { comment: 'Taller rows', at: AT });
  assert.equal(c.look.status, 'changes'); assert.equal(c.addenda[0].text, 'Taller rows'); assert.equal(c.addenda[0].sent, false);
  assert.match(P.addendumText({ prediction: c }), /Taller rows/); assert.equal(P.addendumText({ prediction: p }), '');
  assert.throws(() => P.decideLook(p, 'maybe'));
  assert.equal(P.toReal(c, { at: AT }).state, 'real');
});

t('lookVerdict: off = go, on = wait until approved, changes = go with addendum, rejected = held', () => {
  const item = (status) => ({ prediction: { look: { status } } });
  assert.ok(P.lookVerdict({ settings: {}, touches: true, item: null }).go);
  assert.ok(P.lookVerdict({ settings: { waitForLook: true }, touches: false, item: null }).go, 'no UI = no wait');
  const w = P.lookVerdict({ settings: { waitForLook: true }, touches: true, item: null }); assert.ok(!w.go && w.wait && w.look === 'none');
  assert.ok(P.lookVerdict({ settings: { waitForLook: true }, touches: true, item: item('waiting') }).wait);
  assert.ok(P.lookVerdict({ settings: { waitForLook: true }, touches: true, item: item('approved') }).go);
  assert.ok(P.lookVerdict({ settings: { waitForLook: true }, touches: true, item: item('changes') }).go);
  const h = P.lookVerdict({ settings: {}, touches: true, item: item('rejected') }); assert.ok(!h.go && !h.wait, 'rejected holds even with the setting off');
});

t('ui-review-item@1 accepts a prediction on review items only', () => {
  const base = { $axf: S.ITEM_TAG, id: 'r-1', name: 'Predicted look: demo', group: { id: 'g-1', name: 'Predicted looks - Nov 3' }, createdAt: AT, kind: 'review', source: 'headless',
    submittedBy: { type: 'build', id: 'demo-look' }, app: 'Console', screen: 'UI Review', viewport: 'mixed', files: { before: [], after: [{ src: 'items/r-1/predicted-x-phone.png', viewport: 'phone' }] }, status: 'pending' };
  assert.ok(S.validateItem({ ...base, prediction: P.newPrediction(P.mockupSpec(BUILD, { at: AT })) }).ok);
  assert.ok(!S.validateItem({ ...base, prediction: { build: 'x' } }).ok);
  assert.ok(!S.validateItem({ ...base, kind: 'screenshot', status: undefined, prediction: P.newPrediction(P.mockupSpec(BUILD, { at: AT })) }).ok);
  assert.ok(S.REGISTRY.itemOptional.includes('prediction'));
  assert.ok(JSON.parse(readFileSync(join(ROOT, 'framework/schemas/ui-review.json'), 'utf8')).itemOptional.includes('prediction'), 'registry snapshot agrees');
});

// the CLI, offline: a scratch store holding BUILD
const dir = mkdtempSync(join(tmpdir(), 'axf-predict-check-'));
const store = join(dir, 'store.json');
writeFileSync(store, JSON.stringify({ $axf: 'builds@1', rev: 1, builds: [{ ...BUILD, status: 'running', profiles: ['urgent'], branch: '', pr: '', notes: [], approvals: [], upgradeRequests: [], steps: BUILD.steps.map((s) => ({ ...s, model: 'Opus', done: false, skip: false })) }] }));
const env = { ...process.env, AXF_BUILDS_STORE: store, AXF_UI_PREDICT_CONSOLE: 'off', AXF_BUILDS_LIVE: '0' };
const cli = (...a) => spawnSync(process.execPath, [join(ROOT, 'framework/cli/ui-predict.mjs'), ...a], { env, encoding: 'utf8' });

t('cli spec + predict --dry-run: the plan, no browser, no console', () => {
  const s = JSON.parse(cli('spec', 'demo-look', '--json').stdout);
  assert.ok(s.touchesUi); assert.equal(s.spec.build, 'demo-look'); assert.equal(s.plan.length, 2);
  const d = JSON.parse(cli('predict', 'demo-look', '--dry-run', '--json').stdout);
  assert.ok(d.plan.some((x) => x.name === 'predicted-ui-review'));
});

t('cli gate never blocks a launch it cannot check; which finds the build from the brief', () => {
  const g = cli('gate', '--build', 'demo-look'); assert.equal(g.status, 0); assert.match(g.stdout, /starts/);
  const brief = join(dir, 'brief.txt'); writeFileSync(brief, 'Continue build "Look" (demo-look)\n');
  assert.equal(cli('which', '--brief', brief).stdout.trim(), 'demo-look');
  assert.equal(cli('gate', '--name', 'axf-nobody').status, 0);
  assert.equal(cli('bogus').status, 2);
});

t('launcher: look gate wired in, bash parses', () => {
  const sh = readFileSync(join(ROOT, 'deploy/claude-headless.sh'), 'utf8');
  assert.match(sh, /ui-predict\.mjs/); assert.match(sh, /look_st == 5/); assert.match(sh, /look_st == 4/); assert.match(sh, /AXF_LOOK_GATE/);
  assert.equal(spawnSync('bash', ['-n', join(ROOT, 'deploy/claude-headless.sh')]).status, 0);
});

console.log(`ui-predict: ${n} checks ok`);
