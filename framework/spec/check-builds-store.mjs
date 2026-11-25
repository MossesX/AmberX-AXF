#!/usr/bin/env node
// builds@1 — the one builds store (master cleanup, Oct 31 2026). Pure core + the real writers on a temp store.
//   node framework/spec/check-builds-store.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as c from '../plan/builds-store-core.mjs';
import * as m from '../plan/builds-merge-core.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const at = '2026-10-31T10:00:00.000Z';
const step = (id, text, extra = {}) => ({ id, text, model: 'Opus', estimate: '10 min', ...extra });

// ------------------------------------------------------------------ migration: nothing lost
// two profiles (any number work; since Nov 7 2026 the real store has one, `all`, and `side` stands for any other)
const sources = { profiles: [
  { id: 'side', orchFile: 'o-main.json', orch: { rules: { maxStepMinutes: 30 }, builds: [
    { id: 'shared', title: 'Shared old', status: 'pending', updatedAt: '2026-10-20T00:00:00Z', steps: [step('s1', 'old a')], notes: [{ text: 'main note', at }] },
  ] },
  pending: [
    { file: 'repo:p.json', state: { items: [{ id: 'p-only', title: 'Pending only', model: 'Fable', status: 'unsafe', subPrompts: [{ text: 'do x', at, estimate: '20 min' }, { text: 'do y', at: '', done: true, doneAt: at }], notes: [{ text: 'pn', at }], createdAt: at, updatedAt: '2026-10-30T00:00:00Z', estimate: '30 min', source: 'chat' },
      { id: 'linked', title: 'Linked to epic', model: 'Opus', status: 'pending', planId: 'x.epic', subPrompts: [], notes: [], createdAt: at, updatedAt: at }] } },
    { file: 'hub:p.json', state: { items: [{ id: 'p-only', title: 'Pending only (hub, newer)', model: 'Fable', status: 'unsafe', subPrompts: [{ text: 'do x', at, estimate: '20 min' }, { text: 'do y', at: '', done: true, doneAt: at }], notes: [{ text: 'pn', at }], createdAt: at, updatedAt: '2026-10-31T00:00:00Z', estimate: '30 min', source: 'chat' }] } },
  ],
  queue: { order: ['x.epic', 'x.other'], steps: { 'x.other': { completedAt: '2026-10-10T00:00:00Z', steps: [{ text: 'q1', estimate: '5 min', done: true, doneAt: at }] } }, history: [{ at, by: 't', text: 'h' }] }, queueFile: 'q.json',
  features: [{ id: 'x.epic', kind: 'epic', title: 'Epic', status: 'planned' }, { id: 'x.other', kind: 'epic', title: 'Other', status: 'built' }],
  history: [{ file: 'p.json', commit: 'abc', items: [{ id: 'gone', title: 'Gone once', status: 'pending', subPrompts: [], notes: [] }] }] },
  { id: 'all', orchFile: 'o-ref.json', orch: { builds: [
    { id: 'shared', title: 'Shared new', status: 'running', updatedAt: '2026-10-30T00:00:00Z', steps: [step('s1', 'new a', { done: true, doneAt: at }), step('s2', 'new b')], notes: [{ text: 'ref note', at }] },
    { id: 'odd', title: 'Odd status', status: 'bogus', steps: [step('s1', 'z')] },
  ] }, pending: [{ file: 'repo:r.json', state: { items: [{ id: 'shared', title: 'Shared new', model: 'Opus', status: 'pending', subPrompts: [{ text: '[Opus] new a', at, done: true, doneAt: at }, { text: '[Opus] new b', at }], notes: [{ text: 'only on pending', at }], createdAt: at, updatedAt: '2026-10-29T00:00:00Z' }] } }, { file: 'hub:r.json', state: { items: [] } }],
  queue: { order: [], steps: {}, history: [] }, queueFile: 'rq.json', features: [], history: [] },
] };
const { store: M, report } = c.migrate(sources, { now: at });
const ids = M.builds.map((b) => b.id);
t('one record per build, no duplicate ids', () => assert.equal(ids.length, new Set(ids).size));
t('validateStore: the migrated store is a valid builds@1', () => assert.deepEqual(c.validateStore(M).errors, []));
t('validateStore names every problem by path', () => {
  const bad = JSON.parse(JSON.stringify(M));
  bad.$axf = 'nope'; bad.builds[0].status = 'bogus'; bad.builds[1].id = bad.builds[0].id; delete bad.builds[0].order[bad.builds[0].profiles[0]];
  bad.builds[0].steps[0].model = 'Sonnet'; bad.builds[0].steps.push({ ...bad.builds[0].steps[0] });
  const v = c.validateStore(bad); const paths = v.errors.map((e) => e.path).join('\n');
  assert.equal(v.ok, false);
  for (const re of [/^\$axf$/m, /\.status$/m, /\.id$/m, /\.order\./m, /steps\[0\]\.model$/m, /steps\[\d+\]\.uid$/m]) assert.match(paths, re, paths);
  assert.ok(v.errors.some((e) => /never Sonnet/.test(e.message)), 'a Sonnet step names the model policy');
  assert.equal(c.validateStore(null).ok, false); assert.equal(c.validateStore({ $axf: 'builds@1', rev: 0 }).ok, false);
});
t('the same build in two profiles = one record tagged with both, newest copy wins, the other kept', () => {
  const b = M.builds.find((x) => x.id === 'shared');
  assert.deepEqual(b.profiles.sort(), ['all', 'side']);
  assert.equal(b.title, 'Shared new'); assert.equal(b.steps.length, 2);
  assert.ok(b.copies.some((x) => JSON.stringify(x.data).includes('old a')));
  assert.ok(b.notes.some((x) => x.text === 'only on pending'));
});
t('repo + hub pending copies are unioned, newer wins, older kept', () => {
  const b = M.builds.find((x) => x.id === 'p-only');
  assert.equal(b.title, 'Pending only (hub, newer)'); assert.ok(b.copies.length >= 1);
  assert.equal(b.status, 'blocked'); assert.equal(b.pending.status, 'unsafe'); assert.equal(b.pending.model, 'Fable');
});
t('queue epics become epic records with their queue record; a linked pending item merges with its epic', () => {
  const o = M.builds.find((x) => x.id === 'x.other'); assert.equal(o.kind, 'epic'); assert.equal(o.status, 'complete'); assert.equal(o.steps[0].text, 'q1'); assert.equal(o.queue.completedAt, '2026-10-10T00:00:00Z');
  assert.ok(!ids.includes('x.epic')); assert.equal(M.builds.find((x) => x.id === 'linked').planRef, 'x.epic');
});
t('items only in git history come back archived, off the Pending list', () => {
  const g = M.builds.find((x) => x.id === 'gone'); assert.equal(g.status, 'archived');
  assert.ok(!c.projectPending(M, 'side').items.some((x) => x.id === 'gone'));
  assert.equal(report.recovered.length, 1);
});
t('an unknown orchestrator status is kept as a note', () => assert.ok(M.builds.find((x) => x.id === 'odd').notes.some((x) => x.text.includes('"bogus"'))));
// ------------------------------------------------------------------ build-watchdog@1: recoveries[] on a build
const recovery = { at: '2026-11-16T12:00:00.000Z', buildId: 'shared', phase: 'Phase 1', step: 's2', cause: 'exit-killed', exit: 143, action: 'retry', attempt: 1, account: 'hulu0241', notified: '', session: 'axf-shared--a', note: 'killed (exit 143): back in the Queue (retry 1 of 3).' };
t('a build without recoveries loads unchanged: no key invented, nothing to migrate', () => {
  assert.ok(M.builds.every((b) => !('recoveries' in b)));
  assert.ok(!('recoveries' in c.normBuild({ id: 'r0', title: 'R0', recoveries: [] })));
  assert.ok(!('recoveries' in c.normBuild({ id: 'r1', title: 'R1', recoveries: [{ action: 'none' }, { at: 'bad', action: 'retry' }] })));
});
t('normBuild keeps recoveries in shape and normalizeStore round-trips them', () => {
  const b = c.normBuild({ id: 'r2', title: 'R2', status: 'queued', recoveries: [recovery] });
  assert.deepEqual(b.recoveries, [recovery]);
  const s = c.normalizeStore({ ...M, builds: [...M.builds, b] });
  assert.deepEqual(s.builds.find((x) => x.id === 'r2').recoveries, [recovery]);
  assert.deepEqual(c.normalizeStore(JSON.parse(JSON.stringify(s))).builds.find((x) => x.id === 'r2').recoveries, [recovery]);
  assert.deepEqual(c.validateStore(s).errors, []);
});
t('recoveries are sorted oldest first and capped at the newest 50', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ ...recovery, at: `2026-11-16T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i).padStart(2, '0')}:00.000Z`, attempt: i }));
  const b = c.normBuild({ id: 'r3', title: 'R3', recoveries: [...many].reverse() });
  assert.equal(b.recoveries.length, 50); assert.equal(b.recoveries[0].attempt, 10); assert.equal(b.recoveries[49].attempt, 59);
});
t('validateStore names a bad recovery', () => {
  const bad = JSON.parse(JSON.stringify(M)); bad.builds[0].recoveries = [{ ...recovery, action: 'explode' }]; bad.builds[1].recoveries = []; bad.builds[2].recoveries = [{ ...recovery, cause: 'gremlins' }];
  const e = c.validateStore(bad).errors.map((x) => x.path);
  assert.ok(e.some((p) => p.endsWith('.recoveries[0]')), e.join(', ')); assert.ok(e.some((p) => p.endsWith('(' + bad.builds[1].id + ').recoveries'))); assert.ok(e.some((p) => p.endsWith('.recoveries[0].cause')));
});
t('a recovery write changes the record (rev bump) and the orchestrator projection → absorb keeps it', () => {
  const before = c.normalizeStore(JSON.parse(JSON.stringify(M))); const after = c.normalizeStore(JSON.parse(JSON.stringify(M)));
  const b = after.builds.find((x) => x.id === 'shared'); b.recoveries = [recovery]; b.status = 'queued';
  const ch = c.diffStores(before, after, at); assert.deepEqual(ch.map((x) => x.id), ['shared']); assert.equal(ch[0].after.rev, before.builds.find((x) => x.id === 'shared').rev + 1);
  const back = c.absorbOrchestrator(after, 'all', c.projectOrchestrator(after, 'all'), { now: at });
  assert.deepEqual(back.builds.find((x) => x.id === 'shared').recoveries, [recovery]);
});

t('verifyNothingLost passes on the migrated store', () => { const v = c.verifyNothingLost(sources, M); assert.ok(v.length > 10); assert.deepEqual(v.filter((x) => !x.ok), []); });
t('verifyNothingLost catches a lost step', () => {
  const broken = JSON.parse(JSON.stringify(M)); const b = broken.builds.find((x) => x.id === 'p-only'); b.steps = b.steps.slice(1); b.copies = []; b.defaultSteps = [];
  assert.ok(c.verifyNothingLost(sources, c.normalizeStore(broken)).some((x) => !x.ok));
});
t('steps get stable uids (same on a re-run)', () => { const again = c.migrate(sources, { now: at }).store; assert.deepEqual(again.builds.flatMap((b) => b.steps.map((s) => s.uid)), M.builds.flatMap((b) => b.steps.map((s) => s.uid))); });

// ------------------------------------------------------------------ projections round-trip
t('orchestrator projection → absorb is a no-op', () => { const back = c.absorbOrchestrator(M, 'all', c.projectOrchestrator(M, 'all'), { now: at }); assert.deepEqual(c.diffStores(M, back, at), []); });
t('pending projection → absorb is a no-op', () => { for (const p of ['side', 'all']) { const back = c.absorbPending(M, p, c.projectPending(M, p), null, { now: at }); assert.deepEqual(c.diffStores(M, back, at).map((x) => x.id), [], p); } });
t('queue projection → absorb is a no-op', () => { const q = c.projectQueue(M, 'side'); assert.deepEqual(q.order, ['linked', 'x.other'].map((id) => (id === 'linked' ? 'x.epic' : id))); const back = c.absorbQueue(M, 'side', q, sources.profiles[0].features, { now: at }); assert.deepEqual(c.diffStores(M, back, at).map((x) => x.id), []); });
t('pending projection keeps the old item fields', () => {
  const it = c.projectPending(M, 'side').items.find((x) => x.id === 'p-only');
  assert.equal(it.status, 'unsafe'); assert.equal(it.estimate, '30 min'); assert.equal(it.source, 'chat'); assert.equal(it.subPrompts[1].at, ''); assert.equal(it.subPrompts[1].done, true); assert.equal(it.subPrompts[0].text, 'do x');
});
t('a profile with no queue gives null (the queue core creates one only when missing)', () => { const s = c.normalizeStore(JSON.parse(JSON.stringify(M))); delete s.meta.queue.all; assert.equal(c.projectQueue(s, 'all'), null); });
t('removing a build on one profile untags it, the record stays', () => {
  const o = c.projectOrchestrator(M, 'all'); o.builds = o.builds.filter((b) => b.id !== 'shared');
  const s2 = c.absorbOrchestrator(M, 'all', o, { now: at }); const b = s2.builds.find((x) => x.id === 'shared');
  assert.deepEqual(b.profiles, ['side']); assert.equal(b.deleted, false);
  const o2 = c.projectOrchestrator(s2, 'side'); o2.builds = o2.builds.filter((x) => x.id !== 'shared');
  const s3 = c.absorbOrchestrator(s2, 'side', o2, { now: at }); assert.equal(s3.builds.find((x) => x.id === 'shared').deleted, true);
});
t('a foreign (old-style) file only brings in builds NEWER than the store, never reverts or removes', () => {
  const o = c.projectOrchestrator(M, 'all');
  const stale = { ...o, builds: o.builds.filter((b) => b.id !== 'odd').map((b) => (b.id === 'shared' ? { ...b, title: 'Stale title', updatedAt: '2026-01-01T00:00:00Z' } : b)) };
  const s1 = c.absorbOrchestrator(M, 'all', stale, { newerOnly: true, now: at });
  assert.equal(s1.builds.find((b) => b.id === 'shared').title, 'Shared new'); assert.equal(s1.builds.find((b) => b.id === 'odd').deleted, false);
  const newer = { ...o, builds: o.builds.map((b) => (b.id === 'shared' ? { ...b, title: 'From another session', updatedAt: '2027-01-01T00:00:00Z' } : b)) };
  assert.equal(c.absorbOrchestrator(M, 'all', newer, { newerOnly: true, now: at }).builds.find((b) => b.id === 'shared').title, 'From another session');
  const p = c.projectPending(M, 'side'); const staleP = { ...p, items: [] };
  assert.deepEqual(c.diffStores(M, c.absorbPending(M, 'side', staleP, null, { newerOnly: true, now: at }), at), [], 'an empty old Pending file removes nothing');
});
t('diffStores never drops a record and bumps revs', () => {
  const after = c.normalizeStore(JSON.parse(JSON.stringify(M))); after.builds = after.builds.filter((b) => b.id !== 'odd');
  after.builds.find((b) => b.id === 'shared').steps[1].text = 'changed';
  const ch = c.diffStores(M, after, at);
  assert.ok(after.builds.find((b) => b.id === 'odd').deleted); assert.deepEqual(ch.map((x) => x.op).sort(), ['change', 'delete']);
  assert.equal(after.builds.find((b) => b.id === 'shared').steps[1].rev, 2);
});

// ------------------------------------------------------------------ Steps view: reorder, rename, divide, harvest, restore, apply/discard
const P = 'all';
const shared = () => M.builds.find((x) => x.id === 'shared');
const [u1, u2] = shared().steps.map((s) => s.uid);
t('reorder steps (draft first, nothing changes until Apply)', () => {
  const d = c.addDraftOp(M, P, { op: 'reorder-steps', build: 'shared', uids: [u2, u1] });
  assert.equal(d.builds.find((x) => x.id === 'shared').steps[0].uid, u1, 'draft does not touch the build');
  assert.equal(c.draftOf(d, P).ops.length, 1);
  assert.equal(c.previewDraft(d, P).store.builds.find((x) => x.id === 'shared').steps[0].uid, u2);
  const a = c.applyDraft(d, P).store; const b = a.builds.find((x) => x.id === 'shared');
  assert.deepEqual(b.steps.map((s) => s.uid), [u2, u1]); assert.equal(b.rearranged, true); assert.equal(c.draftOf(a, P).ops.length, 0);
});
t('reorder refused when it does not list every step once', () => assert.throws(() => c.addDraftOp(M, P, { op: 'reorder-steps', build: 'shared', uids: [u1] }), /each of its/));
t('reorder builds in a profile', () => {
  const a = c.applyDraft(c.addDraftOp(M, P, { op: 'reorder-builds', ids: ['odd', 'shared'] }), P).store;
  assert.deepEqual(c.buildsOf(a, P).map((b) => b.id), ['odd', 'shared']);
});
t('rename build + step: empty refused, id unchanged, every view shows the new title', () => {
  assert.throws(() => c.addDraftOp(M, P, { op: 'rename-build', id: 'shared', title: '   ' }), /needs a name/);
  assert.throws(() => c.addDraftOp(M, P, { op: 'rename-step', build: 'shared', uid: u1, title: '' }), /needs a name/);
  let d = c.addDraftOp(M, P, { op: 'rename-build', id: 'shared', title: 'Renamed build' });
  d = c.addDraftOp(d, P, { op: 'rename-step', build: 'shared', uid: u1, title: 'Renamed step' });
  const a = c.applyDraft(d, P).store; const b = a.builds.find((x) => x.id === 'shared');
  assert.equal(b.id, 'shared'); assert.equal(b.title, 'Renamed build'); assert.equal(b.steps[0].title, 'Renamed step'); assert.equal(b.steps[0].uid, u1);
  assert.equal(c.projectOrchestrator(a, P).builds.find((x) => x.id === 'shared').title, 'Renamed build');
  assert.equal(c.projectPending(a, P).items.find((x) => x.id === 'shared').title, 'Renamed build');
  assert.equal(c.projectOrchestrator(a, 'side').builds.find((x) => x.id === 'shared').title, 'Renamed build', 'other profile shows it too');
});
t('rename profile goes to the registry on Apply', () => { const r = c.applyDraft(c.addDraftOp(M, P, { op: 'rename-profile', id: P, name: 'Refactor 2' }), P); assert.deepEqual(r.profileName, { id: P, name: 'Refactor 2' }); assert.throws(() => c.addDraftOp(M, P, { op: 'rename-profile', id: P, name: '' }), /needs a name/); });
t('divide a step into parts, then Restore default', () => {
  let a = c.applyDraft(c.addDraftOp(M, P, { op: 'divide-step', build: 'shared', uid: u2, parts: [{ text: 'b part 1', estimate: '5 min' }, { text: 'b part 2' }] }), P).store;
  let b = a.builds.find((x) => x.id === 'shared');
  assert.equal(b.steps.length, 3); assert.equal(b.steps[1].origin.how, 'divided'); assert.ok(b.removedSteps.some((r) => r.step.uid === u2));
  assert.equal(new Set(b.steps.map((s) => s.id)).size, 3, 'step ids unique');
  assert.throws(() => c.addDraftOp(a, P, { op: 'divide-step', build: 'shared', uid: b.steps[0].uid, parts: [{ text: 'only one' }] }), /2 or more/);
  a = c.applyDraft(c.addDraftOp(a, P, { op: 'restore-default', id: 'shared' }), P).store; b = a.builds.find((x) => x.id === 'shared');
  assert.deepEqual(b.steps.map((s) => s.uid), [u1, u2]); assert.equal(b.rearranged, false);
});
t('harvest selected steps into one new build; the source is refactored; Restore default gives them back', () => {
  const name = c.suggestName([shared().steps[1]]);
  let a = c.applyDraft(c.addDraftOp(M, P, { op: 'harvest', from: [{ build: 'shared', uid: u2 }], into: [{ title: name, uids: [u2] }] }), P).store;
  const nb = a.builds.find((x) => x.source === 'harvest');
  assert.ok(nb && nb.profiles.includes(P)); assert.equal(nb.steps[0].uid, u2, 'uid kept across a harvest'); assert.equal(nb.steps[0].origin.build, 'shared');
  assert.deepEqual(a.builds.find((x) => x.id === 'shared').steps.map((s) => s.uid), [u1]);
  a = c.applyDraft(c.addDraftOp(a, P, { op: 'restore-default', id: 'shared' }), P).store;
  assert.deepEqual(a.builds.find((x) => x.id === 'shared').steps.map((s) => s.uid), [u1, u2]);
  assert.equal(a.builds.find((x) => x.id === nb.id).steps.length, 0);
});
t('split into N builds: every selected step goes to exactly one build, default names', () => {
  const s3 = c.normalizeStore(JSON.parse(JSON.stringify(M)));
  const src = s3.builds.find((x) => x.id === 'shared'); src.steps.push(c.normStep({ id: 's3', text: 'third thing' }, 2), c.normStep({ id: 's4', text: 'fourth thing' }, 3));
  const sel = src.steps; const prop = c.proposeSplit(sel, 3);
  assert.equal(prop.length, 3); assert.deepEqual(prop.flatMap((p) => p.uids).sort(), sel.map((s) => s.uid).sort()); assert.ok(prop.every((p) => p.title));
  assert.throws(() => c.addDraftOp(s3, P, { op: 'harvest', from: sel.map((s) => ({ build: 'shared', uid: s.uid })), into: [{ title: 'x', uids: [sel[0].uid] }] }), /exactly one/);
  const a = c.applyDraft(c.addDraftOp(s3, P, { op: 'harvest', from: sel.map((s) => ({ build: 'shared', uid: s.uid })), into: prop.map((p) => ({ title: p.title, uids: p.uids })) }), P).store;
  assert.equal(a.builds.filter((x) => x.source === 'harvest').length, 3); assert.equal(a.builds.find((x) => x.id === 'shared').steps.length, 0);
});
t('Discard drops the draft, nothing applied', () => { const d = c.addDraftOp(M, P, { op: 'rename-build', id: 'shared', title: 'Nope' }); const x = c.discardDraft(d, P); assert.equal(c.draftOf(x, P).ops.length, 0); assert.equal(x.builds.find((b) => b.id === 'shared').title, 'Shared new'); });
t('a draft op that cannot apply is refused when added', () => assert.throws(() => c.addDraftOp(M, P, { op: 'rename-build', id: 'nope', title: 'x' }), /no build/));

// ------------------------------------------------------------------ progress bars
t('progress per build and per profile', () => {
  const b = c.buildProgress(shared()); assert.deepEqual([b.done, b.total, b.pct, b.active], [1, 2, 50, true]);
  const p = c.profileProgress(M, P); assert.equal(p.builds, 2); assert.equal(p.total, 3); assert.equal(p.pct, 33);
});

// ------------------------------------------------------------------ one profile (Nov 7 2026: every profile merged into `all`)
t('a record naming a retired profile reads as `all`, keeps where it came from, urgency becomes its priority', () => {
  const b = c.normBuild({ id: 'old', title: 'Old', profiles: ['urgent'], order: { urgent: 4 } });
  assert.deepEqual([b.profiles, b.order, b.fromProfile, b.priority], [['all'], { all: 4 }, 'urgent', 'P0']);
  const k = c.normBuild({ id: 'kept', title: 'Kept', profiles: ['side', 'refactor'], order: { side: 1, refactor: 2 }, priority: 'P3' });
  assert.deepEqual([k.profiles, k.order, k.fromProfile, k.priority], [['side', 'all'], { side: 1, all: 2 }, 'refactor', 'P3']);
  assert.equal(c.normBuild({ id: 'n', title: 'N', profiles: ['all'] }).fromProfile, undefined);
  assert.equal(c.resolveProfile('breakroom'), 'all'); assert.equal(c.resolveProfile('side'), 'side');
});
t('the old base main-framework is folded in too: `all` is the base, a main-framework record reads as `all`', () => {
  assert.equal(c.BASE_PROFILE, 'all'); assert.equal(c.resolveProfile('main-framework'), 'all');
  const m = c.normBuild({ id: 'm', title: 'M', profiles: ['main-framework'], order: { 'main-framework': 3 } });
  assert.deepEqual([m.profiles, m.order, m.fromProfile, m.priority], [['all'], { all: 3 }, 'main-framework', undefined]);
  const both = c.normBuild({ id: 'b', title: 'B', profiles: ['main-framework', 'all'], order: { 'main-framework': 3, all: 7 }, fromProfile: 'current' });
  assert.deepEqual([both.profiles, both.order, both.fromProfile], [['all'], { all: 7 }, 'current']);
  assert.deepEqual(c.normBuild({ id: 'd', title: 'D' }).profiles, ['all'], 'a record without profiles lands in the base');
});
t('mergeProfiles keeps ids, statuses and steps, orders by old profile, folds rules and queue meta', () => {
  const raw = { ...c.emptyStore(at), rules: { current: { maxStepMinutes: 25 }, angel: { maxStepMinutes: 30 } }, meta: { queue: { angel: { history: [{ at: '2', text: 'b' }] }, current: { history: [{ at: '1', text: 'a' }] } }, pending: {} },
    builds: [
      { id: 'a1', title: 'A1', status: 'built', profiles: ['angel'], order: { angel: 0 }, notes: [], steps: [step('s1', 'x', { done: true, doneAt: at })] },
      { id: 'c2', title: 'C2', status: 'pending', profiles: ['current'], order: { current: 1 }, notes: [], steps: [] },
      { id: 'c1', title: 'C1', status: 'running', profiles: ['current'], order: { current: 0 }, notes: [], steps: [] },
      { id: 'u1', title: 'U1', status: 'pending', profiles: ['urgent'], order: { urgent: 0 }, notes: [], steps: [], priority: 'P1' },
      { id: 'm1', title: 'M1', status: 'pending', profiles: ['main-framework'], order: { 'main-framework': 0 }, notes: [], steps: [] },
    ] };
  const { store: s, report } = c.mergeProfiles(raw, c.RETIRED_PROFILES, c.MERGED_PROFILE, { now: at });
  assert.equal(report.moved, 5);
  assert.deepEqual(c.buildsOf(s, 'all').map((b) => b.id), ['c1', 'c2', 'u1', 'a1', 'm1']);
  assert.deepEqual(s.builds.map((b) => b.fromProfile ?? ''), ['angel', 'current', 'current', 'urgent', 'main-framework']);
  assert.equal(s.builds.find((b) => b.id === 'u1').priority, 'P1', 'a stored priority is never overwritten');
  assert.equal(s.builds.find((b) => b.id === 'a1').steps[0].done, true);
  assert.deepEqual(Object.keys(s.rules), ['all']); assert.equal(s.rules.all.maxStepMinutes, 25);
  assert.deepEqual(s.meta.queue.all.history.map((h) => h.text), ['a', 'b']);
  const n = c.normalizeStore(s); assert.deepEqual(c.validateStore(n).errors, []);
  assert.equal(c.mergeProfiles(n, c.RETIRED_PROFILES, c.MERGED_PROFILE, { now: at }).report.moved, 0, 'running it again changes nothing');
});

// ------------------------------------------------------------------ the real writers on a temp store (versioned)
const dir = mkdtempSync(join(tmpdir(), 'builds-store-'));
process.env.AXF_BUILDS_STORE = join(dir, 'store.json');
process.env.AXF_BUILD_PROFILE = 'all';
delete process.env.AXF_ORCH_FILE; delete process.env.AXF_PENDING_FILE;
const io = await import('../cli/builds-store.mjs');
io.migrateNow({ sources, by: 'test' });
const pend = await import('../cli/pending.mjs');
// an orchestrator-style write: the profile's orchestrator@1 view with a new build, absorbed back (what orchestrator.mjs does)
const orchAdd = (b) => io.withStore((s) => { const o = c.projectOrchestrator(s, 'all'); o.builds.push(b); return c.absorbOrchestrator(s, 'all', o); }, { by: 'test', action: 'orchestrator:add' });
const orchView = () => c.projectOrchestrator(io.loadStore(), 'all');
orchAdd({ id: 'from-cli', title: 'From CLI', status: 'complete', steps: [{ id: 's1', text: 'one', model: 'Opus', estimate: '5 min', done: true, doneAt: at }] });
t('an orchestrator change lands in the store and shows on the Pending list (no sync step)', () => { const it = pend.loadPending().items.find((x) => x.id === 'from-cli'); assert.equal(it.status, 'complete'); assert.equal(it.subPrompts[0].done, true); });
pend.actPending({ action: 'note', id: 'from-cli', text: 'pending note' });
t('a Pending change lands in the store and shows in the orchestrator', () => assert.ok(orchView().builds.find((x) => x.id === 'from-cli').notes.some((x) => x.text === 'pending note')));
t('rename through the store: id unchanged, empty refused', () => {
  io.withStore((s) => c.applyNow(s, 'all', [{ op: 'rename-build', id: 'from-cli', title: 'Named' }]).store, { by: 'test', action: 'rename' });
  assert.equal(pend.loadPending().items.find((x) => x.id === 'from-cli').title, 'Named');
  assert.throws(() => c.applyNow(io.loadStore(), 'all', [{ op: 'rename-build', id: 'from-cli', title: '' }]), /needs a name/);
});
t('a step is ticked at once from the Builds page (never drafted), and the build status follows', () => {
  const uid = () => io.loadStore().builds.find((x) => x.id === 'from-cli').steps[0].uid;
  io.withStore((s) => c.applyNow(s, 'all', [{ op: 'step-done', build: 'from-cli', uid: uid(), done: false }]).store, { by: 'test', action: 'tick' });
  let b = io.loadStore().builds.find((x) => x.id === 'from-cli'); assert.equal(b.steps[0].done, false); assert.equal(b.status, 'running');
  assert.equal(orchView().builds.find((x) => x.id === 'from-cli').steps[0].done, false);
  io.withStore((s) => c.applyNow(s, 'all', [{ op: 'step-done', build: 'from-cli', uid: uid(), done: true }]).store, { by: 'test', action: 'tick' });
  b = io.loadStore().builds.find((x) => x.id === 'from-cli'); assert.equal(b.steps[0].done, true); assert.equal(b.status, 'landing'); assert.ok(b.steps[0].doneAt); // done-means-merged@1: every step done = landing until merged
  assert.throws(() => c.addDraftOp(io.loadStore(), 'all', { op: 'step-done', build: 'from-cli', uid: uid() }), /unknown draft op/);
  assert.throws(() => c.applyNow(io.loadStore(), 'all', [{ op: 'step-done', build: 'from-cli', uid: 'nope' }]), /no step/);
});
t('every write is versioned in the journal and can be restored', () => {
  const s = io.loadStore(); assert.ok(s.rev >= 4, `rev ${s.rev}`);
  const h = io.journalOf('from-cli'); assert.ok(h.length >= 3);
  const first = h[0].rev; io.restoreBuild('from-cli', first, 'test');
  assert.equal(io.loadStore().builds.find((x) => x.id === 'from-cli').title, 'From CLI');
  assert.ok(readdirSync(io.journalDir()).some((f) => f.endsWith('.jsonl')));
});
io.withStore((s) => c.addDraftOp(s, 'all', { op: 'rename-build', id: 'shared', title: 'Draft name' }), { by: 'test', action: 'draft' });
t('draft survives a reload, Apply writes it', () => { assert.equal(c.draftOf(io.loadStore(), 'all').ops.length, 1); io.applyDraftNow('all', 'test'); assert.equal(io.loadStore().builds.find((x) => x.id === 'shared').title, 'Draft name'); assert.equal(c.draftOf(io.loadStore(), 'all').ops.length, 0); });
t('the store on disk leaves out an unchanged default breakdown', () => { const raw = JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8')); assert.ok(raw.builds.some((b) => !('defaultSteps' in b))); });

// ------------------------------------------------------------------ step dependencies and claims (build-pipeline@1, Nov 13 2026)
const CLAIM = { runId: 'run-1', slot: 'slot-7', account: 'mossesx-max-', branch: 'claude/dep--s2', at: '2026-11-13T10:00:00.000Z', model: 'Opus' };
const depBuild = (extra = {}) => c.normBuild({ id: 'dep', title: 'Dep', profiles: ['all'], order: { all: 0 }, status: 'running', steps: [
  step('s1', 'first'), step('s2', 'second', { after: [], claim: CLAIM }), step('s3', 'third', { after: ['s1', 's2', 's3', 's3'] }), step('s4', 'fourth', { done: true, doneAt: at, claim: CLAIM }),
], ...extra }, { now: at });
t('normStep keeps after and claim; absent after stays absent (old steps are implicitly sequential)', () => {
  const b = depBuild();
  assert.equal('after' in b.steps[0], false, 'no after added to an old step');
  assert.deepEqual(b.steps[1].after, []); assert.deepEqual(b.steps[2].after, ['s1', 's2'], 'self and duplicates dropped');
  assert.deepEqual(b.steps[1].claim, { ...CLAIM, expiresAt: '2026-11-13T10:45:00.000Z' });
  assert.equal('claim' in b.steps[3], false, 'a done step carries no claim');
});
t('validateStore: a clean dependency set passes; unknown ids, self, a wrong claim model and cycles are named', () => {
  const s = { ...c.emptyStore(at), builds: [depBuild()] };
  assert.deepEqual(c.validateStore(s).errors, []);
  const bad = JSON.parse(JSON.stringify(s));
  bad.builds[0].steps[2].after = ['zz', 's3']; bad.builds[0].steps[1].claim.model = 'Fable';
  const msgs = c.validateStore(bad).errors.map((e) => `${e.path} ${e.message}`).join('\n');
  assert.match(msgs, /steps\[2\]\.after "zz" is not a step/); assert.match(msgs, /never waits on itself/); assert.match(msgs, /claim\.model "Fable" is not the step's pinned model Opus/);
  const cyc = { ...c.emptyStore(at), builds: [c.normBuild({ id: 'cyc', title: 'C', steps: [step('s1', 'a', { after: ['s3'] }), step('s2', 'b'), step('s3', 'c', { after: ['s2'] })] })] };
  assert.deepEqual(c.dependencyCycles(cyc.builds[0]), [['s1', 's3', 's2', 's1']], 'the implicit previous-step edge (s2 → s1) closes the cycle');
  assert.match(c.validateStore(cyc).errors.map((e) => e.message).join('\n'), /dependency cycle: s1 → s3 → s2 → s1/);
  assert.deepEqual(c.dependencyCycles(depBuild()), []);
});
t('the orchestrator export carries after and claim, and a write from older code (no after) keeps them', () => {
  const s = { ...c.emptyStore(at), builds: [depBuild()] };
  const doc = c.projectOrchestrator(s, 'all');
  assert.deepEqual(doc.builds[0].steps[1].after, []); assert.equal(doc.builds[0].steps[1].claim.runId, 'run-1'); assert.equal('after' in doc.builds[0].steps[0], false);
  const old = JSON.parse(JSON.stringify(doc)); for (const st of old.builds[0].steps) { delete st.after; delete st.claim; } old.builds[0].steps[2].note = 'edited by old code';
  const back = c.absorbOrchestrator(s, 'all', old, { now: '2026-11-13T11:00:00.000Z', by: 'test' }).builds[0];
  assert.deepEqual(back.steps[2].after, ['s1', 's2']); assert.equal(back.steps[2].note, 'edited by old code'); assert.equal(back.steps[1].claim.runId, 'run-1');
});
t('dependsOn is an input alias stored as after; parallel is kept only as never; the export and the merge carry it', () => {
  const b = c.normBuild({ id: 'alias', title: 'A', profiles: ['all'], order: { all: 0 }, steps: [
    step('s1', 'a', { parallel: 'auto' }), step('s2', 'b', { dependsOn: ['s1'], parallel: 'never' }), step('s3', 'c', { dependsOn: ['s1'], after: [], parallel: 'maybe' }),
  ] }, { now: at });
  assert.equal('parallel' in b.steps[0], false, 'auto is the default and is not stored');
  assert.deepEqual(b.steps[1].after, ['s1']); assert.equal('dependsOn' in b.steps[1], false); assert.equal(b.steps[1].parallel, 'never');
  assert.deepEqual(b.steps[2].after, [], 'after wins over dependsOn when both are given'); assert.equal('parallel' in b.steps[2], false, 'an unknown mode is dropped');
  const s = { ...c.emptyStore(at), builds: [b] };
  assert.deepEqual(c.validateStore(s).errors, []);
  const bad = JSON.parse(JSON.stringify(s)); bad.builds[0].steps[0].dependsOn = ['s2']; bad.builds[0].steps[1].parallel = 'sometimes';
  const msgs = c.validateStore(bad).errors.map((e) => `${e.path} ${e.message}`).join('\n');
  assert.match(msgs, /steps\[0\]\.dependsOn is an input alias/); assert.match(msgs, /steps\[1\]\.parallel "sometimes" is not one of auto, never/);
  const doc = c.projectOrchestrator(s, 'all');
  assert.equal(doc.builds[0].steps[1].parallel, 'never'); assert.equal('parallel' in doc.builds[0].steps[0], false);
  const older = JSON.parse(JSON.stringify(b)); delete older.steps[1].parallel; older.steps[1].updatedAt = '2026-10-30T09:00:00.000Z';
  assert.equal(m.mergeBuild(older, b).steps[1].parallel, 'never');
});
t('newer-wins merge: a released claim on the newer copy wins; a claim on the newer copy survives an older copy without one', () => {
  const a = depBuild(); const b = JSON.parse(JSON.stringify(a));
  delete b.steps[1].claim; b.steps[1].updatedAt = '2026-11-13T12:00:00.000Z'; b.steps[1].rev = 2;
  assert.equal('claim' in m.mergeBuild(a, b).steps[1], false);
  const older = JSON.parse(JSON.stringify(a)); delete older.steps[1].claim; older.steps[1].updatedAt = '2026-10-30T09:00:00.000Z';
  assert.equal(m.mergeBuild(older, a).steps[1].claim.runId, 'run-1'); assert.deepEqual(m.mergeBuild(older, a).steps[2].after, ['s1', 's2']);
});

t('migrateStepDeps: older builds get no dependency list, a stray dependsOn moves to after, meta.versions stamped once', () => {
  const raw = { ...c.emptyStore(at), builds: [
    { id: 'old', title: 'Old', steps: [step('s1', 'a'), step('s2', 'b')] },
    { id: 'stray', title: 'Stray', steps: [step('s1', 'a'), step('s2', 'b', { dependsOn: ['s1'] })] },
  ] };
  const r = c.migrateStepDeps(raw, { now: at, by: 'test' });
  assert.equal(r.store.builds[0].steps.some((x) => 'after' in x || 'dependsOn' in x), false, 'old steps stay sequential');
  assert.deepEqual(r.store.builds[1].steps[1].after, ['s1']);
  assert.deepEqual(r.report, { builds: 2, steps: 4, withDeps: 1, aliasMoved: 1, stamped: true, version: c.STEP_DEPS_VERSION });
  assert.deepEqual(r.store.meta.versions.stepDeps, { version: 1, at, by: 'test' });
  assert.deepEqual(c.normalizeStore(r.store).meta.versions, r.store.meta.versions, 'versions survive normalisation');
  assert.equal(c.migrateStepDeps(r.store, { now: '2026-12-01T00:00:00.000Z' }).report.stamped, false, 'second run is a no-op');
  assert.equal('versions' in c.normalizeStore(c.emptyStore(at)).meta, false, 'an unstamped store carries no versions');
});
t('stepDepsReport (verify): names a dependsOn on a missing step and every cycle', () => {
  const s = { ...c.emptyStore(at), builds: [depBuild(),
    c.normBuild({ id: 'miss', title: 'M', steps: [step('s1', 'a'), step('s2', 'b', { after: ['s9'] })] }),
    c.normBuild({ id: 'cyc', title: 'C', steps: [step('s1', 'a', { after: ['s3'] }), step('s2', 'b'), step('s3', 'c', { after: ['s2'] })] })] };
  const r = c.stepDepsReport(s);
  assert.deepEqual(r.missing, [{ build: 'miss', step: 's2', missing: 's9' }]);
  assert.deepEqual(r.cycles, [{ build: 'cyc', cycle: ['s1', 's3', 's2', 's1'] }]);
  assert.equal(r.withDeps, 3);
  assert.deepEqual(c.stepDepsReport({ builds: [depBuild()] }).missing, []);
});
t('builds-store migrateStepDepsNow writes one journalled stamp; a second run writes nothing', () => {
  const r1 = io.migrateStepDepsNow('test'); assert.equal(r1.report.stamped, true);
  assert.equal(io.loadStore().meta.versions.stepDeps.version, c.STEP_DEPS_VERSION);
  const lines = readdirSync(io.journalDir()).flatMap((f) => readFileSync(join(io.journalDir(), f), 'utf8').trim().split('\n')).map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.action === 'migrate-step-deps').length, 1);
  const r2 = io.migrateStepDepsNow('test'); assert.equal(r2.report.stamped, false); assert.equal(r2.rev, r1.rev);
});

// no status file (Nov 25 2026): a status write is one build's row, a status read is a page of rows or a short summary
await (async () => {
  const { existsSync: there, readdirSync: ls } = await import('node:fs');
  const { dirname: dir } = await import('node:path');
  io.withStore((s) => { for (let i = 0; i < 7; i += 1) s.builds.push({ id: `row-${i}`, title: `Row ${i}`, status: i < 5 ? 'pending' : 'running', profile: 'all', updatedAt: `2026-11-25T10:0${i}:00.000Z`, steps: [{ id: 's1', text: 'one' }], notes: [{ text: 'n', at: '2026-11-25T10:00:00.000Z' }] }); return s; }, { by: 'test', action: 'add' });
  t('withBuild changes one build (status, note, branch, PR) as one journalled change', () => {
    const w = io.withBuild('row-0', (b) => { b.branch = 'claude/row-0'; b.pr = '#5'; b.notes.push({ text: 'linked', at: '2026-11-25T11:00:00.000Z' }); }, { by: 'test', action: 'link' });
    assert.deepEqual(w.changes.map((x) => x.id), ['row-0']); assert.equal(w.build.pr, '#5'); assert.equal(io.readBuild('row-0').branch, 'claude/row-0'); assert.equal(io.readBuild('nope'), null);
    assert.throws(() => io.withBuild('nope', () => {}, { by: 'test' }), /no build/);
  });
  t('queryBuilds pages by status and project: rows without steps or notes, totals and counts', () => {
    const all = io.loadStore().builds.filter((b) => !b.deleted);
    const p1 = io.queryBuilds({ status: 'pending', project: 'all', limit: 2 });
    const pend = all.filter((b) => b.status === 'pending' && b.profiles.includes('all'));
    assert.equal(p1.$axf, 'builds-page@1'); assert.equal(p1.total, pend.length); assert.equal(p1.items.length, 2); assert.equal(p1.limit, 2); assert.equal(p1.offset, 0); assert.equal(p1.next, 2);
    assert.ok(p1.items.every((r) => r.status === 'pending' && typeof r.steps === 'number' && !('notes' in r)));
    const p2 = io.queryBuilds({ status: 'pending', project: 'all', limit: 2, offset: 2 });
    assert.equal(p2.offset, 2); assert.ok(!p2.items.some((r) => p1.items.some((q) => q.id === r.id)));
    const seen = []; for (let off = 0; off !== null;) { const p = io.queryBuilds({ status: ['pending', 'running'], limit: 3, offset: off }); seen.push(...p.items.map((r) => r.id)); off = p.next; }
    assert.deepEqual(seen.slice().sort(), all.filter((b) => ['pending', 'running'].includes(b.status)).map((b) => b.id).sort());
    assert.equal(p1.counts.pending, pend.length); assert.equal(Object.values(io.queryBuilds({}).counts).reduce((a, n) => a + n, 0), all.length);
    assert.equal(io.queryBuilds({ limit: 100000 }).limit, io.QUERY_MAX); assert.equal(io.queryBuilds({ project: 'no-such-project' }).total, 0);
  });
  t('pipelineSummary: counts, the queued build and the running rows, a few KB whatever the store holds', () => {
    const sum = io.pipelineSummary();
    assert.equal(sum.$axf, 'pipeline-summary@1'); assert.equal(sum.total, io.loadStore().builds.filter((b) => !b.deleted).length); assert.ok(sum.running.some((r) => r.id === 'row-5')); assert.ok(sum.counts.running >= 2);
    assert.ok(!JSON.stringify(sum).includes('"notes"'));
  });
  t('no orchestrator.json status file is written by any of it, and none is an export', () => {
    assert.deepEqual(io.orchestratorExports(io.loadStore()), []);
    assert.ok(!ls(dir(io.storeFile())).some((f) => f.endsWith('orchestrator.json')));
    assert.ok(!there(new URL('../../_claude/builds/profiles/all/orchestrator.json', import.meta.url)));
  });
})();

// builds-journal@1: the real journal lives on the hub, so CI reads the fixture journal (framework/spec/fixtures-journal)
// through AXF_BUILDS_JOURNAL in a child process (this one is pinned to a test store); no 70 MB part is needed
t('history reads the journal home (fixture journal through AXF_BUILDS_JOURNAL)', () => {
  const env = { ...process.env, AXF_BUILDS_JOURNAL: fileURLToPath(new URL('./fixtures-journal', import.meta.url)), AXF_BUILDS_LIVE: '0', AXF_BUILDS_EXPORT: '0' };
  delete env.AXF_BUILDS_STORE;
  const code = `const io = await import(${JSON.stringify(new URL('../cli/builds-store.mjs', import.meta.url).href)}); console.log(JSON.stringify({ mode: io.journalMode(), dir: io.journalDir(), h: io.journalOf('journal-fixture').map((x) => x.rev) }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(o.mode, 'explicit'); assert.ok(o.dir.endsWith('fixtures-journal')); assert.deepEqual(o.h, [1, 2]);
});

// builds-journal@1 relocation: a write goes to the journal home (here an explicit folder; the hub's <data root>/builds/journal
// works the same), never the repo; history reads it back; the pointer and verify see a changed sealed part
t('a journal write lands in the home, history reads it back, verify catches a changed sealed part', () => {
  const home = mkdtempSync(join(tmpdir(), 'axf-journal-home-')); const data = mkdtempSync(join(tmpdir(), 'axf-journal-data-'));
  const env = { ...process.env, AXF_BUILDS_JOURNAL: home, AXF_DATA_DIR: data, AXF_BUILDS_LIVE: '0', AXF_BUILDS_EXPORT: '0' };
  delete env.AXF_BUILDS_STORE;
  const mod = JSON.stringify(new URL('../cli/builds-store.mjs', import.meta.url).href);
  const code = `const io = await import(${mod}); const c = await import(${JSON.stringify(new URL('../plan/builds-store-core.mjs', import.meta.url).href)});
    io.withStore((s) => { s.builds.push(c.normBuild({ id: 'journal-move', title: 'Journal move', profile: 'all', steps: [{ id: 's1', title: 'one' }] })); return s; }, { by: 'test', action: 'write' });
    const fs = await import('node:fs'); const files = fs.readdirSync(io.journalDir()).filter((f) => f.endsWith('.jsonl'));
    const p = io.journalPointer(io.journalDir()); const ok = io.verifyJournal(p, io.journalDir()).ok;
    const k = Object.keys(p.parts)[0]; const sealed = { ...p, parts: { [k]: { ...p.parts[k], sealed: true, sha256: 'x' } } };
    console.log(JSON.stringify({ mode: io.journalMode(), dir: io.journalDir(), files, h: io.journalOf('journal-move').length, ok, bad: io.verifyJournal(sealed, io.journalDir()).failed.length }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(o.mode, 'explicit'); assert.equal(o.dir, home); assert.ok(o.files.length === 1, `files ${o.files}`);
  assert.equal(o.h, 1); assert.equal(o.ok, true); assert.equal(o.bad, 1);
  assert.ok(readdirSync(join(data, '_claude/builds')).every((f) => f !== 'journal'), 'nothing journalled next to the store');
});

// ------------------------------------------------------------------ demo-build@1: the test-build sandbox
t('demo: the tag comes from the id, never from the record', () => {
  const d = c.normBuild({ id: 'demo-crash', title: 'Demo crash', steps: [step('s1', 'x')] }, { now: at });
  assert.equal(d.demo, true);
  const real = c.normBuild({ id: 'skins', title: 'Skins', demo: true, steps: [] }, { now: at });
  assert.equal('demo' in real, false, 'a real build never gets the tag by writing it');
  assert.equal(c.isDemo(d), true); assert.equal(c.isDemo(real), false);
  assert.equal(c.isDemoId('demo-'), false); assert.equal(c.isDemoId('demonstration'), false); assert.equal(c.isDemoId('demo-a'), true);
});
t('demo: validateStore refuses a tag that disagrees with the id', () => {
  const s = c.normalizeStore({ ...c.emptyStore(at), builds: [c.normBuild({ id: 'demo-ok', title: 'ok', steps: [step('s1', 'x')] }, { now: at }), c.normBuild({ id: 'real', title: 'real', steps: [] }, { now: at })] });
  assert.deepEqual(c.validateStore(s).errors, []);
  const bad = JSON.parse(JSON.stringify(s));
  bad.builds[0].demo = false; bad.builds[1].demo = true;
  const paths = c.validateStore(bad).errors.map((e) => e.path);
  assert.ok(paths.includes('builds[0](demo-ok).demo') && paths.includes('builds[1](real).demo'), paths.join(', '));
  const missing = JSON.parse(JSON.stringify(s)); delete missing.builds[0].demo;
  assert.ok(c.validateStore(missing).errors.some((e) => e.path === 'builds[0](demo-ok).demo'), 'a demo- id without the tag is named');
});
t('demo: the projections mark it and an absorb never grants it', () => {
  const s = c.normalizeStore({ ...c.emptyStore(at), builds: [c.normBuild({ id: 'demo-ok', title: 'ok', steps: [step('s1', 'x')] }, { now: at }), c.normBuild({ id: 'real', title: 'real', steps: [step('s1', 'y')] }, { now: at })] });
  const o = c.projectOrchestrator(s, 'all');
  assert.equal(o.builds.find((b) => b.id === 'demo-ok').demo, true); assert.equal('demo' in o.builds.find((b) => b.id === 'real'), false);
  const p = c.projectPending(s, 'all');
  assert.equal(p.items.find((b) => b.id === 'demo-ok').demo, true); assert.equal('demo' in p.items.find((b) => b.id === 'real'), false);
  // an orchestrator file that claims demo on a real build, or drops it on a demo build, changes nothing
  o.builds.find((b) => b.id === 'real').demo = true; delete o.builds.find((b) => b.id === 'demo-ok').demo;
  const back = c.normalizeStore(c.absorbOrchestrator(s, 'all', o, { now: at }));
  assert.equal('demo' in back.builds.find((b) => b.id === 'real'), false); assert.equal(back.builds.find((b) => b.id === 'demo-ok').demo, true);
  // a pending file without the mark is not a change
  const p2 = JSON.parse(JSON.stringify(p)); delete p2.items.find((b) => b.id === 'demo-ok').demo;
  const back2 = c.absorbPending(s, 'all', p2, null, { now: at });
  assert.equal(back2.builds.find((b) => b.id === 'demo-ok').updatedAt, s.builds.find((b) => b.id === 'demo-ok').updatedAt, 'not touched');
  assert.deepEqual(c.validateStore(c.normalizeStore(back2)).errors, []);
});
t('demo: the guard refuses a demo write that touches a real build', () => {
  const s = c.normalizeStore({ ...c.emptyStore(at), builds: [c.normBuild({ id: 'demo-ok', title: 'ok', steps: [] }, { now: at }), c.normBuild({ id: 'real', title: 'real', steps: [] }, { now: at })] });
  const only = JSON.parse(JSON.stringify(s)); only.builds[0].status = 'queued';
  assert.deepEqual(c.demoViolations(s, only), [], 'a demo build may change');
  const both = JSON.parse(JSON.stringify(only)); both.builds[1].status = 'queued';
  assert.deepEqual(c.demoViolations(s, both).map((x) => x.id), ['real'], 'a real build may not');
  const added = JSON.parse(JSON.stringify(s)); added.builds.push(c.normBuild({ id: 'new-real', title: 'n', steps: [] }, { now: at }));
  assert.deepEqual(c.demoViolations(s, added).map((x) => x.id), ['new-real'], 'nor be added');
  const gone = JSON.parse(JSON.stringify(s)); gone.builds = gone.builds.filter((b) => b.id !== 'real');
  assert.deepEqual(c.demoViolations(s, gone).map((x) => x.id), ['real'], 'nor removed');
  assert.deepEqual(c.demoViolations(s, s), [], 'nothing changed: nothing refused');
});
t('demo: the IO guard refuses the write whole (nothing saved) and --demo on the CLI goes through it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axf-demo-'));
  const env = { ...process.env, AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILDS_EXPORT: '0', AXF_BUILD_HOOKS: '0' };
  const io = fileURLToPath(new URL('../cli/builds-store.mjs', import.meta.url));
  const code = `import * as io from ${JSON.stringify(io)}; import * as c from ${JSON.stringify(fileURLToPath(new URL('../plan/builds-store-core.mjs', import.meta.url)))};
    const at = '2026-11-17T20:00:00.000Z';
    io.withStore((s) => { s.builds.push(c.normBuild({ id: 'demo-ok', title: 'ok', steps: [] }, { now: at }), c.normBuild({ id: 'real', title: 'real', steps: [] }, { now: at })); return s; }, { by: 't' });
    let refused = ''; try { io.withStore((s) => { for (const b of s.builds) b.status = 'queued'; return s; }, { by: 't', demo: true, action: 'demo-test' }); } catch (e) { refused = e.code + ':' + (e.builds || []).join(','); }
    const after = io.loadStore();
    const okWrite = io.withStore((s) => { s.builds.find((b) => b.id === 'demo-ok').status = 'queued'; return s; }, { by: 't', demo: true });
    console.log(JSON.stringify({ refused, statuses: after.builds.map((b) => [b.id, b.status]), rev: after.rev, okRev: okWrite.rev, okStatus: io.loadStore().builds.find((b) => b.id === 'demo-ok').status }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(o.refused, 'not-demo-build:real');
  assert.deepEqual(o.statuses, [['demo-ok', 'pending'], ['real', 'pending']], 'the refused write saved nothing, not even the demo build');
  assert.equal(o.okRev, o.rev + 1); assert.equal(o.okStatus, 'queued');
  const cli = (args) => spawnSync(process.execPath, [io, ...args, '--json'], { env, encoding: 'utf8' });
  const d1 = JSON.parse(cli(['demo', 'demo-ok']).stdout); assert.equal(d1.ok, true); assert.equal(d1.demo, true);
  const d2 = cli(['demo', 'real']); assert.equal(d2.status, 1); assert.equal(JSON.parse(d2.stdout).ok, false);
  const s1 = cli(['set-status', 'real', 'queued', '--demo']); assert.notEqual(s1.status, 0, 'set-status --demo on a real build is refused');
  assert.equal(JSON.parse(cli(['verify']).stdout).demo.builds.join(','), 'demo-ok');
});

console.log(`builds-store: ${n} checks passed`);
