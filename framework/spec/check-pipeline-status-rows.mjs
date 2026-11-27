#!/usr/bin/env node
// Pipeline status is rows of the builds store, never a status file (Nov 25 2026).
//   a status write changes one build row (one journalled change) and writes no status file
//   a paged read by status / project returns the right page, totals and counts, and never steps or notes
//   node framework/spec/check-pipeline-status-rows.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATUS_FILE, findOnDisk } from './check-no-pipeline-status-file.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

// a test store in a scratch folder: exports ON, so a writer that still produced the status file would show it here
const dir = mkdtempSync(join(tmpdir(), 'pipeline-status-rows-'));
process.env.AXF_BUILDS_STORE = join(dir, 'store.json');
process.env.AXF_BUILD_PROFILE = 'all';
process.env.AXF_BUILDS_EXPORT = '1';
process.env.AXF_BUILDS_LIVE = '0';
process.env.AXF_BUILD_HOOKS = '0';
process.env.AXF_DATA_DIR = join(dir, 'data');
delete process.env.AXF_ORCH_FILE; delete process.env.AXF_PENDING_FILE;
const io = await import('../cli/builds-store.mjs');

for (const fn of ['readBuild', 'withBuild', 'queryBuilds', 'pipelineSummary']) assert.equal(typeof io[fn], 'function', `builds-store.mjs exports ${fn}`);

// 60 builds: 40 pending, 12 queued, 8 running; every third one also belongs to project `side`
const STATUS = (i) => (i < 40 ? 'pending' : i < 52 ? 'queued' : 'running');
const stamp = (i) => `2026-11-25T10:${String(i).padStart(2, '0')}:00.000Z`;
const seed = Array.from({ length: 60 }, (_, i) => ({
  id: `row-${String(i).padStart(2, '0')}`, title: `Row ${i}`, status: STATUS(i), profiles: i % 3 === 0 ? ['all', 'side'] : ['all'], updatedAt: stamp(i),
  detail: 'x'.repeat(2000), steps: [{ id: 's1', text: 'one', model: 'Opus', estimate: '10 min' }, { id: 's2', text: 'two', model: 'Opus', estimate: '10 min' }],
  notes: [{ text: `note of row ${i}`, at: stamp(i) }],
}));
io.withStore((s) => { s.builds.push(...seed); return s; }, { by: 'test', action: 'add' });
const all = () => io.loadStore().builds.filter((b) => !b.deleted);
const strip = (b) => { const { rev, updatedAt, statusAt, statusBy, ...rest } = b; return JSON.stringify(rest); };
assert.equal(all().length, 60, 'the store holds the 60 seeded builds');

// ------------------------------------------------------------------ a status write is one build row
t('a status write changes one build row, as one journalled change', () => {
  const before = new Map(all().map((b) => [b.id, JSON.stringify(b)]));
  const rev0 = io.loadStore().rev;
  const w = io.withBuild('row-05', (b) => { b.status = 'queued'; b.branch = 'claude/row-05'; b.pr = '#77'; b.notes.push({ text: 'queued by the test', at: stamp(59) }); }, { by: 'test', action: 'status' });
  assert.deepEqual(w.changes.map((x) => x.id), ['row-05'], 'the write reports one changed build');
  assert.equal(w.build.status, 'queued'); assert.equal(w.build.pr, '#77');
  const after = all();
  const changed = after.filter((b) => before.get(b.id) !== JSON.stringify(b)).map((b) => b.id);
  assert.deepEqual(changed, ['row-05'], 'no other build row changed');
  assert.equal(after.length, 60);
  assert.equal(io.loadStore().rev, rev0 + 1, 'one store revision');
  const got = io.readBuild('row-05');
  assert.equal(got.status, 'queued'); assert.equal(got.branch, 'claude/row-05'); assert.ok(got.notes.some((x) => x.text === 'queued by the test'));
  const hist = io.journalOf('row-05');
  assert.ok(hist.length >= 2, 'the build has its own journal lines (added, then changed)');
});
t('a write to one build leaves every other build byte for byte', () => {
  const before = new Map(all().map((b) => [b.id, strip(b)]));
  io.withBuild('row-41', (b) => ({ ...b, status: 'running' }), { by: 'test', action: 'status' });
  const moved = all().filter((b) => before.get(b.id) !== strip(b)).map((b) => b.id);
  assert.deepEqual(moved, ['row-41']);
});
t('an unknown build is refused and nothing is written', () => {
  const rev0 = io.loadStore().rev;
  assert.throws(() => io.withBuild('no-such-build', (b) => { b.status = 'queued'; }, { by: 'test' }), /no build/);
  assert.equal(io.readBuild('no-such-build'), null);
  assert.equal(io.loadStore().rev, rev0);
});

// ------------------------------------------------------------------ a status read is a page of rows
// after the two writes: pending 39 (row-05 left), queued 12 (+row-05, −row-41), running 9
const expect = (status, project = '') => all().filter((b) => (!status.length || status.includes(b.status)) && (!project || b.profiles.includes(project)))
  .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1)).map((b) => b.id);
t('a page by status: the right rows, total, limit, offset and next', () => {
  const want = expect(['pending']);
  assert.equal(want.length, 39);
  const p1 = io.queryBuilds({ status: 'pending', limit: 10 });
  assert.equal(p1.$axf, 'builds-page@1');
  assert.equal(p1.total, 39); assert.equal(p1.limit, 10); assert.equal(p1.offset, 0); assert.equal(p1.next, 10);
  assert.deepEqual(p1.items.map((r) => r.id), want.slice(0, 10), 'page 1 is the 10 newest pending builds');
  const p2 = io.queryBuilds({ status: 'pending', limit: 10, offset: 10 });
  assert.deepEqual(p2.items.map((r) => r.id), want.slice(10, 20), 'page 2 follows page 1');
  assert.equal(p2.offset, 10); assert.equal(p2.next, 20);
  const last = io.queryBuilds({ status: 'pending', limit: 10, offset: 30 });
  assert.deepEqual(last.items.map((r) => r.id), want.slice(30)); assert.equal(last.items.length, 9); assert.equal(last.next, null, 'the last page has no next');
  const past = io.queryBuilds({ status: 'pending', limit: 10, offset: 500 });
  assert.deepEqual(past.items, []); assert.equal(past.total, 39); assert.equal(past.next, null);
});
t('walking the pages gives every matching build once', () => {
  const seen = [];
  for (let off = 0, guard = 0; off !== null && guard < 50; guard += 1) { const p = io.queryBuilds({ status: ['queued', 'running'], limit: 4, offset: off }); seen.push(...p.items.map((r) => r.id)); off = p.next; }
  assert.deepEqual(seen, expect(['queued', 'running']));
  assert.equal(new Set(seen).size, 21);
});
t('a page by status and project: totals are the filtered rows, counts are per status within the project', () => {
  const want = expect(['pending'], 'side');
  const p = io.queryBuilds({ status: 'pending', project: 'side', limit: 5 });
  assert.equal(p.total, want.length); assert.deepEqual(p.items.map((r) => r.id), want.slice(0, 5));
  assert.ok(p.items.every((r) => r.status === 'pending' && r.profiles.includes('side')));
  const inSide = all().filter((b) => b.profiles.includes('side'));
  assert.equal(Object.values(p.counts).reduce((a, x) => a + x, 0), inSide.length, 'counts cover every status of the project');
  assert.equal(p.counts.pending, want.length);
  assert.equal(p.counts.running, inSide.filter((b) => b.status === 'running').length);
  assert.equal(io.queryBuilds({ project: 'no-such-project' }).total, 0);
  assert.deepEqual(io.queryBuilds({}).counts, { pending: 39, queued: 12, running: 9 });
});
t('a page is rows, not builds: no steps, notes or detail, and the limit is capped', () => {
  const p = io.queryBuilds({ limit: 100000 });
  assert.equal(p.limit, io.QUERY_MAX); assert.ok(p.items.length <= io.QUERY_MAX);
  for (const r of p.items) { assert.equal(typeof r.steps, 'number'); assert.ok(!('notes' in r) && !('detail' in r) && !('origin' in r)); }
  const text = JSON.stringify(io.queryBuilds({ status: 'pending', limit: 10 }));
  assert.ok(text.length < 10 * 1024, `a page of 10 rows is small (${text.length} bytes)`);
  assert.ok(text.length < readFileSync(process.env.AXF_BUILDS_STORE).length / 10, 'and a fraction of the store');
});
t('pipelineSummary: counts, the head of the queue and the running rows, a few KB', () => {
  const sum = io.pipelineSummary();
  assert.equal(sum.$axf, 'pipeline-summary@1'); assert.equal(sum.total, 60);
  assert.deepEqual(sum.counts, { pending: 39, queued: 12, running: 9 });
  assert.equal(sum.queued.status, 'queued');
  assert.deepEqual(sum.running.map((r) => r.id).sort(), expect(['running']).sort());
  const text = JSON.stringify(sum);
  assert.ok(!text.includes('"notes"') && !text.includes('note of row'), 'no notes in the summary');
  assert.ok(text.length < 16 * 1024, `the summary is small (${text.length} bytes)`);
});

// ------------------------------------------------------------------ and none of it made a status file
t('no status file anywhere the store writes: its folder, the data folder, the checkout', () => {
  const made = [...findOnDisk(dir)];
  assert.deepEqual(made, [], `no ${STATUS_FILE} under the test store (${made.join(', ')})`);
  assert.ok(!readdirSync(dir).some((f) => f.includes('orchestrator')), 'nothing named after the old tracker next to the store');
  assert.deepEqual(io.orchestratorExports(io.loadStore()), [], 'the status file is not an export');
  const repo = new URL('../../_claude/builds/', import.meta.url);
  assert.deepEqual(findOnDisk(repo.pathname), [], 'none in the checkout under _claude/builds');
});

console.log(`check-pipeline-status-rows: ${n} checks ok`);
