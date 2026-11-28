#!/usr/bin/env node
// Self-test: node apps/console-web/plugins/plan-studio-2/shipped.test.mjs
// A plan sent from Plan Studio 2.0 receives its build's shipped-manifest@1: validated with the shared validator, stored
// field for field, refused and flagged when invalid, idempotent on id + rev; and end to end through the real chain
// (send → the build lands → framework/cli/shipped.mjs ship → build-hook@1 `shipped` → the plan). Scratch folders only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as SM from '../../../../framework/core/shipped-manifest.mjs';
import * as tc from './web/tree-core.mjs';
import * as sc from './shipped.mjs';

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const here = new URL('.', import.meta.url).pathname;
const repo = join(here, '../../../..');
const PR = 398;

const MANIFEST = {
  $axf: 'shipped-manifest@1', id: 'sm-launch', rev: 1, source: 'orchestrator', shippedAt: '2026-11-09T02:00:00Z',
  build: { id: 'launch', title: 'Launch', profile: 'all' },
  said: { text: 'Make sure the plan studio gets the manifest. It has to be valid.', verbatim: true },
  steps: [{ id: 's1', text: 'Do A', model: 'Opus', estimate: '20 min', done: true, doneAt: '2026-11-09T01:30:00Z' }],
  branch: 'claude/launch', pr: { number: PR, url: `https://github.com/MossesX/AmberX-AXF/pull/${PR}` }, landedCommit: 'abcdef1234567', mergedAt: '2026-11-09T02:00:00Z',
  files: ['apps/console-web/plugins/plan-studio-2/shipped.mjs'], tests: [{ name: 'self-test', command: 'node test.mjs', result: 'pass' }], cost: { usd: 1.25 }, open: [],
};

// ---------------------------------------------------------------- pure: shipped.mjs receive
let s = tc.add(tc.emptyState(), { kind: 'plan', title: 'Launch' }).state;
const planId = s.items[0].id;
await t('a valid manifest is stored on the plan, every field, with links and done', () => {
  const r = sc.receive(s, planId, MANIFEST, { now: '2026-11-09T03:00:00Z' });
  assert.ok(r.ok && r.changed && !r.refused);
  const it = tc.byId(r.state, planId);
  assert.deepEqual(SM.validateManifest(it.shipped), { ok: true, errors: [] });
  assert.deepEqual(it.shipped, SM.normManifest(MANIFEST, { now: '2026-11-09T03:00:00Z' }), 'the normalised manifest, field for field');
  assert.equal(it.shipped.said.text, MANIFEST.said.text); assert.equal(it.shipped.said.verbatim, true);
  assert.equal(it.status, 'done', 'landed with every step done');
  assert.ok(it.links.some((l) => l.type === 'shipped' && l.ref === 'launch'));
  assert.ok(it.links.some((l) => l.type === 'url' && l.ref.endsWith(`/pull/${PR}`)));
  // survives the store's normalize and the stored() form
  const back = tc.byId(tc.normalize(tc.stored(r.state)), planId);
  assert.deepEqual(back.shipped, it.shipped);
  s = r.state;
});
await t('the same id + rev changes nothing; an older rev is ignored; a newer rev updates', () => {
  assert.equal(sc.receive(s, planId, MANIFEST).changed, false);
  const s2 = sc.receive(s, planId, { ...MANIFEST, rev: 2, open: ['a follow-up'] }).state;
  assert.equal(tc.byId(s2, planId).shipped.rev, 2); assert.deepEqual(tc.byId(s2, planId).shipped.open, ['a follow-up']);
  const old = sc.receive(s2, planId, MANIFEST); assert.ok(old.unchanged && old.stale); assert.equal(tc.byId(old.state, planId).shipped.rev, 2);
});
await t('an invalid manifest is refused with the field errors: the plan is flagged, the valid one stays', () => {
  const bad = { ...MANIFEST, rev: 3, said: { text: '' }, landedCommit: 'not-a-sha', models: ['Gpt'] };
  const r = sc.receive(s, planId, bad, { now: '2026-11-10T00:00:00Z' });
  assert.ok(!r.ok && r.refused && r.changed);
  assert.deepEqual(r.errors.map((e) => e.field).sort(), ['landedCommit', 'models', 'said.text']);
  const it = tc.byId(r.state, planId);
  assert.equal(it.shipped.rev, 1, 'nothing of a refused manifest is stored as the plan\'s manifest');
  assert.equal(it.shippedProblem.$axf, 'plan-shipped-problem@1'); assert.equal(it.shippedProblem.rev, 3); assert.match(it.shippedProblem.reason, /said\.text/);
  assert.equal(sc.receive(r.state, planId, bad).changed, false, 'the same refusal again changes nothing');
  const fixed = sc.receive(r.state, planId, { ...MANIFEST, rev: 3 });
  assert.ok(fixed.ok); assert.equal(tc.byId(fixed.state, planId).shippedProblem, undefined, 'a later valid manifest clears the flag');
  // a plan that never had one is flagged the same way
  const fresh = tc.add(tc.emptyState(), { kind: 'plan', title: 'Other' }).state;
  const f = sc.receive(fresh, fresh.items[0].id, { build: {} });
  assert.ok(f.refused); assert.equal(tc.byId(f.state, fresh.items[0].id).shipped, undefined);
});
await t('a copy is a new plan: duplicate and import drop the manifest', () => {
  const d = tc.duplicate(s, planId); assert.equal(d.item.shipped, undefined);
  const imp = tc.importItems(tc.emptyState(), tc.toJson(s, planId)); assert.ok(imp.state.items.every((i) => !i.shipped));
});
await t('check-shipped: a shipped sent build needs its valid manifest on its plan, at the shipped rev', () => {
  const builds = [{ id: 'launch', planRef: planId, flow: 'pipeline-2', status: 'landed', shipped: { id: 'sm-launch', rev: 1 } }, { id: 'not-from-a-plan', status: 'complete', shipped: { id: 'sm-x', rev: 1 } }];
  assert.deepEqual(sc.checkShipped(s, builds, () => MANIFEST), { ok: true, checked: 1, problems: [] }, 'builds not sent from a plan are not checked');
  const ahead = sc.checkShipped(s, [{ ...builds[0], shipped: { id: 'sm-launch', rev: 2 } }], () => MANIFEST);
  assert.equal(ahead.ok, false); assert.match(ahead.problems[0].problem, /rev 2 shipped/);
  const none = sc.checkShipped(tc.add(tc.emptyState(), { kind: 'plan', title: 'Launch' }).state, [{ ...builds[0], planRef: 'missing-0000' }], () => MANIFEST);
  assert.match(none.problems[0].problem, /not in the tree/);
});

// ---------------------------------------------------------------- end to end on scratch stores
const dir = mkdtempSync(join(tmpdir(), 'ps2-shipped-'));
const env = { ...process.env, AXF_PLAN_TREE_DIR: join(dir, 'tree'), AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_SHIPPED_DIR: join(dir, 'shipped'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_PLAN_BUILDS_TTL: '0' };
const cli = (args, e = env) => { try { return JSON.parse(execFileSync('node', [join(here, 'tree.mjs'), ...args, '--json'], { env: e, encoding: 'utf8' }).trim().split('\n').at(-1)); } catch (x) { if (!x.stdout) throw x; return { ...JSON.parse(String(x.stdout).trim().split('\n').at(-1)), exit: x.status }; } };
const storeFile = join(dir, 'store.json');
/** The orchestrator's part, done by hand on the scratch store: the sent build was split, built and landed. */
const land = (id) => {
  const st = JSON.parse(readFileSync(storeFile, 'utf8'));
  const b = st.builds.find((x) => x.id === id);
  Object.assign(b, { status: 'landed', branch: `claude/${id}`, pr: `#${PR}`, mergedAt: '2026-11-09T02:00:00Z', builtAt: '2026-11-09T02:00:00Z', updatedAt: '2026-11-09T02:00:00Z', rev: (b.rev || 1) + 1,
    origin: { said: MANIFEST.said.text, at: '2026-11-09T01:00:00Z', source: 'voice', by: 'Brett', verbatim: true, addenda: [] },
    steps: [{ id: 's1', uid: `st-${id}-1`, text: 'Do A', model: 'Opus', estimate: '20 min', status: 'done', done: true, doneAt: '2026-11-09T01:30:00Z' }, { id: 's2', uid: `st-${id}-2`, text: 'Do B', model: 'Fable', estimate: '30 min', status: 'done', done: true, doneAt: '2026-11-09T01:55:00Z' }] });
  writeFileSync(storeFile, JSON.stringify(st));
};
await t('end to end: send → land → shipped.mjs ship → build-hook@1 `shipped` → the sent plan carries the same valid manifest', () => {
  cli(['add', 'plan', 'Ship it end to end']); cli(['add', 'step', 'Do A', '--in', 'Ship it end to end']);
  const sent = cli(['build', 'Ship it end to end', '--id', 'ship-it-e2e', '--said', MANIFEST.said.text]); assert.ok(sent.ok, JSON.stringify(sent));
  const item = cli(['show', 'Ship it end to end']).item;
  land('ship-it-e2e');
  const envE = { ...env, AXF_BUILD_HOOKS: 'on', AXF_BUILD_HOOKS_DIR: join(dir, 'hooks'), AXF_BUILD_HOOKS_SYNC: '1' };
  cli(['refresh-builds'], envE); // what the plugin last read (the hook's filter knows the build)
  const ship = JSON.parse(execFileSync('node', [join(repo, 'framework/cli/shipped.mjs'), 'ship', 'ship-it-e2e', '--source', 'orchestrator', '--by', 'orchestrator', '--json'], { env: envE, cwd: repo, encoding: 'utf8' }).trim().split('\n').at(-1));
  assert.ok(ship.ok, JSON.stringify(ship));
  const events = readFileSync(join(dir, 'hooks/events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === 'shipped' && e.build.id === 'ship-it-e2e'), 'the store write fired `shipped`');
  // the hook delivered it: the tree file already carries the manifest, before any read of Plan Studio
  const stored = tc.byId(JSON.parse(readFileSync(join(dir, 'tree/tree.json'), 'utf8')), item.id);
  const sidecar = JSON.parse(readFileSync(join(dir, 'shipped/ship-it-e2e.json'), 'utf8'));
  assert.deepEqual(SM.validateManifest(sidecar), { ok: true, errors: [] });
  assert.ok(stored.shipped, 'build-hook@1 handed the manifest to the plan');
  for (const k of Object.keys(sidecar)) assert.deepEqual(stored.shipped[k], sidecar[k], `manifest field ${k} reached the plan`);
  assert.equal(stored.shipped.said.text, MANIFEST.said.text); assert.equal(stored.shipped.said.verbatim, true);
  assert.equal(stored.status, 'done'); assert.ok(stored.links.some((l) => l.type === 'shipped' && l.ref === 'ship-it-e2e'));
  // every surface reads it back the same way
  const got = cli(['shipped-show', '--build', 'ship-it-e2e']); assert.ok(got.ok); assert.equal(got.item, item.id); assert.equal(got.summary.build, 'ship-it-e2e'); assert.equal(got.complete, true);
  assert.equal(cli(['shipped', 'ship-it-e2e']).unchanged, true, 'receiving it again changes nothing');
  assert.equal(cli(['check-shipped']).ok, true);
  assert.ok(cli(['shipped-log']).entries.some((e) => e.build === 'ship-it-e2e' && e.ok));
});
await t('end to end: an invalid manifest is refused at every surface (exit 2, field errors) and flags the plan', () => {
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ ...MANIFEST, id: SM.manifestId('ship-it-e2e'), rev: 9, build: { id: 'ship-it-e2e' }, said: { text: '' }, landedCommit: 'zzz' }));
  const r = cli(['shipped', bad]);
  assert.equal(r.exit, 2); assert.equal(r.ok, false); assert.equal(r.refused, true);
  assert.deepEqual(r.errors.map((e) => e.field).sort(), ['landedCommit', 'said.text']);
  const shown = cli(['shipped-show', '--build', 'ship-it-e2e']);
  assert.match(shown.problem.reason, /said\.text/); assert.equal(shown.shipped.rev, 1, 'the valid manifest it had stays');
  const ck = cli(['check-shipped']); assert.equal(ck.ok, false); assert.match(ck.problems[0].problem, /refused/);
  assert.equal(cli(['shipped', bad]).exit, 2);
  assert.ok(cli(['shipped', 'ship-it-e2e']).ok, 'the sidecar again (valid) clears the flag');
  assert.equal(cli(['check-shipped']).ok, true);
});
await t('a build no plan sent never reaches the tree', () => {
  const before = readFileSync(join(dir, 'tree/tree.json'), 'utf8');
  const r = cli(['shipped', 'nobody-sent-this']); assert.equal(r.ok, false); assert.equal(r.code, 'not_found');
  assert.match(r.error, /not sent from a plan/);
  assert.equal(readFileSync(join(dir, 'tree/tree.json'), 'utf8'), before, 'nothing written');
});
rmSync(dir, { recursive: true, force: true });

console.log(`plan-studio-2 shipped: ${n} checks passed`);
