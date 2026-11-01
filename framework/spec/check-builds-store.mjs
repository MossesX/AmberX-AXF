#!/usr/bin/env node
// builds@1 — the one builds store (master cleanup, Oct 31 2026). Pure core + the real writers on a temp store.
//   node framework/spec/check-builds-store.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../plan/builds-store-core.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const at = '2026-10-31T10:00:00.000Z';
const step = (id, text, extra = {}) => ({ id, text, model: 'Opus', estimate: '10 min', ...extra });

// ------------------------------------------------------------------ migration: nothing lost
const sources = { profiles: [
  { id: 'main-framework', orchFile: 'o-main.json', orch: { rules: { maxStepMinutes: 30 }, builds: [
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
  { id: 'refactor', orchFile: 'o-ref.json', orch: { builds: [
    { id: 'shared', title: 'Shared new', status: 'running', updatedAt: '2026-10-30T00:00:00Z', steps: [step('s1', 'new a', { done: true, doneAt: at }), step('s2', 'new b')], notes: [{ text: 'ref note', at }] },
    { id: 'odd', title: 'Odd status', status: 'queued', steps: [step('s1', 'z')] },
  ] }, pending: [{ file: 'repo:r.json', state: { items: [{ id: 'shared', title: 'Shared new', model: 'Opus', status: 'pending', subPrompts: [{ text: '[Opus] new a', at, done: true, doneAt: at }, { text: '[Opus] new b', at }], notes: [{ text: 'only on pending', at }], createdAt: at, updatedAt: '2026-10-29T00:00:00Z' }] } }, { file: 'hub:r.json', state: { items: [] } }],
  queue: { order: [], steps: {}, history: [] }, queueFile: 'rq.json', features: [], history: [] },
] };
const { store: M, report } = c.migrate(sources, { now: at });
const ids = M.builds.map((b) => b.id);
t('one record per build, no duplicate ids', () => assert.equal(ids.length, new Set(ids).size));
t('the same build in two profiles = one record tagged with both, newest copy wins, the other kept', () => {
  const b = M.builds.find((x) => x.id === 'shared');
  assert.deepEqual(b.profiles.sort(), ['main-framework', 'refactor']);
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
  assert.ok(!c.projectPending(M, 'main-framework').items.some((x) => x.id === 'gone'));
  assert.equal(report.recovered.length, 1);
});
t('an unknown orchestrator status is kept as a note', () => assert.ok(M.builds.find((x) => x.id === 'odd').notes.some((x) => x.text.includes('"queued"'))));
t('verifyNothingLost passes on the migrated store', () => { const v = c.verifyNothingLost(sources, M); assert.ok(v.length > 10); assert.deepEqual(v.filter((x) => !x.ok), []); });
t('verifyNothingLost catches a lost step', () => {
  const broken = JSON.parse(JSON.stringify(M)); const b = broken.builds.find((x) => x.id === 'p-only'); b.steps = b.steps.slice(1); b.copies = []; b.defaultSteps = [];
  assert.ok(c.verifyNothingLost(sources, c.normalizeStore(broken)).some((x) => !x.ok));
});
t('steps get stable uids (same on a re-run)', () => { const again = c.migrate(sources, { now: at }).store; assert.deepEqual(again.builds.flatMap((b) => b.steps.map((s) => s.uid)), M.builds.flatMap((b) => b.steps.map((s) => s.uid))); });

// ------------------------------------------------------------------ projections round-trip
t('orchestrator projection → absorb is a no-op', () => { const back = c.absorbOrchestrator(M, 'refactor', c.projectOrchestrator(M, 'refactor'), { now: at }); assert.deepEqual(c.diffStores(M, back, at), []); });
t('pending projection → absorb is a no-op', () => { for (const p of ['main-framework', 'refactor']) { const back = c.absorbPending(M, p, c.projectPending(M, p), null, { now: at }); assert.deepEqual(c.diffStores(M, back, at).map((x) => x.id), [], p); } });
t('queue projection → absorb is a no-op', () => { const q = c.projectQueue(M, 'main-framework'); assert.deepEqual(q.order, ['linked', 'x.other'].map((id) => (id === 'linked' ? 'x.epic' : id))); const back = c.absorbQueue(M, 'main-framework', q, sources.profiles[0].features, { now: at }); assert.deepEqual(c.diffStores(M, back, at).map((x) => x.id), []); });
t('pending projection keeps the old item fields', () => {
  const it = c.projectPending(M, 'main-framework').items.find((x) => x.id === 'p-only');
  assert.equal(it.status, 'unsafe'); assert.equal(it.estimate, '30 min'); assert.equal(it.source, 'chat'); assert.equal(it.subPrompts[1].at, ''); assert.equal(it.subPrompts[1].done, true); assert.equal(it.subPrompts[0].text, 'do x');
});
t('a profile with no queue gives null (the queue core creates one only when missing)', () => { const s = c.normalizeStore(JSON.parse(JSON.stringify(M))); delete s.meta.queue.refactor; assert.equal(c.projectQueue(s, 'refactor'), null); });
t('removing a build on one profile untags it, the record stays', () => {
  const o = c.projectOrchestrator(M, 'refactor'); o.builds = o.builds.filter((b) => b.id !== 'shared');
  const s2 = c.absorbOrchestrator(M, 'refactor', o, { now: at }); const b = s2.builds.find((x) => x.id === 'shared');
  assert.deepEqual(b.profiles, ['main-framework']); assert.equal(b.deleted, false);
  const o2 = c.projectOrchestrator(s2, 'main-framework'); o2.builds = o2.builds.filter((x) => x.id !== 'shared');
  const s3 = c.absorbOrchestrator(s2, 'main-framework', o2, { now: at }); assert.equal(s3.builds.find((x) => x.id === 'shared').deleted, true);
});
t('diffStores never drops a record and bumps revs', () => {
  const after = c.normalizeStore(JSON.parse(JSON.stringify(M))); after.builds = after.builds.filter((b) => b.id !== 'odd');
  after.builds.find((b) => b.id === 'shared').steps[1].text = 'changed';
  const ch = c.diffStores(M, after, at);
  assert.ok(after.builds.find((b) => b.id === 'odd').deleted); assert.deepEqual(ch.map((x) => x.op).sort(), ['change', 'delete']);
  assert.equal(after.builds.find((b) => b.id === 'shared').steps[1].rev, 2);
});

// ------------------------------------------------------------------ Steps view: reorder, rename, divide, harvest, restore, apply/discard
const P = 'refactor';
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
  assert.equal(c.projectOrchestrator(a, 'main-framework').builds.find((x) => x.id === 'shared').title, 'Renamed build', 'other profile shows it too');
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

// ------------------------------------------------------------------ the real writers on a temp store (versioned)
const dir = mkdtempSync(join(tmpdir(), 'builds-store-'));
process.env.AXF_BUILDS_STORE = join(dir, 'store.json');
process.env.AXF_BUILD_PROFILE = 'refactor';
delete process.env.AXF_ORCH_FILE; delete process.env.AXF_PENDING_FILE;
const io = await import('../cli/builds-store.mjs');
io.migrateNow({ sources, by: 'test' });
const pend = await import('../cli/pending.mjs');
// an orchestrator-style write: the profile's orchestrator@1 view with a new build, absorbed back (what orchestrator.mjs does)
const orchAdd = (b) => io.withStore((s) => { const o = c.projectOrchestrator(s, 'refactor'); o.builds.push(b); return c.absorbOrchestrator(s, 'refactor', o); }, { by: 'test', action: 'orchestrator:add' });
const orchView = () => c.projectOrchestrator(io.loadStore(), 'refactor');
orchAdd({ id: 'from-cli', title: 'From CLI', status: 'complete', steps: [{ id: 's1', text: 'one', model: 'Opus', estimate: '5 min', done: true, doneAt: at }] });
t('an orchestrator change lands in the store and shows on the Pending list (no sync step)', () => { const it = pend.loadPending().items.find((x) => x.id === 'from-cli'); assert.equal(it.status, 'complete'); assert.equal(it.subPrompts[0].done, true); });
pend.actPending({ action: 'note', id: 'from-cli', text: 'pending note' });
t('a Pending change lands in the store and shows in the orchestrator', () => assert.ok(orchView().builds.find((x) => x.id === 'from-cli').notes.some((x) => x.text === 'pending note')));
t('rename through the store: id unchanged, empty refused', () => {
  io.withStore((s) => c.applyNow(s, 'refactor', [{ op: 'rename-build', id: 'from-cli', title: 'Named' }]).store, { by: 'test', action: 'rename' });
  assert.equal(pend.loadPending().items.find((x) => x.id === 'from-cli').title, 'Named');
  assert.throws(() => c.applyNow(io.loadStore(), 'refactor', [{ op: 'rename-build', id: 'from-cli', title: '' }]), /needs a name/);
});
t('every write is versioned in the journal and can be restored', () => {
  const s = io.loadStore(); assert.ok(s.rev >= 4, `rev ${s.rev}`);
  const h = io.journalOf('from-cli'); assert.ok(h.length >= 3);
  const first = h[0].rev; io.restoreBuild('from-cli', first, 'test');
  assert.equal(io.loadStore().builds.find((x) => x.id === 'from-cli').title, 'From CLI');
  assert.ok(readdirSync(io.journalDir()).some((f) => f.endsWith('.jsonl')));
});
io.withStore((s) => c.addDraftOp(s, 'refactor', { op: 'rename-build', id: 'shared', title: 'Draft name' }), { by: 'test', action: 'draft' });
t('draft survives a reload, Apply writes it', () => { assert.equal(c.draftOf(io.loadStore(), 'refactor').ops.length, 1); io.applyDraftNow('refactor', 'test'); assert.equal(io.loadStore().builds.find((x) => x.id === 'shared').title, 'Draft name'); assert.equal(c.draftOf(io.loadStore(), 'refactor').ops.length, 0); });
t('the store on disk leaves out an unchanged default breakdown', () => { const raw = JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8')); assert.ok(raw.builds.some((b) => !('defaultSteps' in b))); });

console.log(`builds-store: ${n} checks passed`);
