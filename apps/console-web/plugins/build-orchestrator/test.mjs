// Self-test: node apps/console-web/plugins/build-orchestrator/test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from './web/orchestrator-core.mjs';

let n = 0; const t = (name, fn) => { fn(); n += 1; };
const steps = [{ text: 'design', model: 'Fable', estimate: '25 min' }, { text: 'contract', model: 'Fable', estimate: '20 min' }, { text: 'wire', model: 'Opus', estimate: '30 min' }, { text: 'review', model: 'Fable', estimate: '15 min' }];
let s = c.apply(c.emptyState(), { action: 'add', title: 'Demo build', steps }).state;
const b = () => s.builds[0];
t('phases group same-model steps', () => { const p = c.phases(b()); assert.equal(p.length, 3); assert.deepEqual(p.map((x) => x.model), ['Fable', 'Opus', 'Fable']); assert.equal(p[0].gate, false); assert.equal(p[1].gate, true); });
t('progress + by model', () => { const p = c.progress(b()); assert.equal(p.minutesLeft, 90); assert.equal(p.byModel.Fable, 60); assert.equal(p.switches, 2); });
t('first phase needs no approval', () => { const x = c.nextUp(b()); assert.equal(x.needsApproval, false); assert.equal(x.step.id, 's1'); });
s = c.apply(s, { action: 'step', id: 'demo-build', step: 's1' }).state;
s = c.apply(s, { action: 'step', id: 'demo-build', step: 's2' }).state;
t('switch to Opus waits for approval', () => { const x = c.nextUp(b()); assert.equal(x.needsApproval, true); assert.equal(b().status, 'waiting'); });
t('ticking a gated step is refused', () => assert.throws(() => c.apply(s, { action: 'step', id: 'demo-build', step: 's3' }), /approve the switch/));
s = c.apply(s, { action: 'approve', id: 'demo-build', phase: 1 }).state;
t('approved switch opens the phase', () => { assert.equal(c.nextUp(b()).needsApproval, false); assert.equal(b().status, 'running'); });
t('brief carries only the current phase', () => { const br = c.brief(b(), s.rules); assert.match(br, /s3/); assert.doesNotMatch(br, /s4/); assert.match(br, /no sub-agents/); });
s = c.apply(s, { action: 'step', id: 'demo-build', step: 's3' }).state;
s = c.apply(s, { action: 'approve', id: 'demo-build', phase: 2 }).state;
s = c.apply(s, { action: 'step', id: 'demo-build', step: 's4' }).state;
t('all done → complete with builtAt', () => { assert.equal(b().status, 'complete'); assert.ok(b().builtAt); });
t('estimates', () => { assert.equal(c.estimateMinutes('2 h'), 120); assert.equal(c.estimateMinutes('1.5 d'), 720); assert.equal(c.estimateMinutes('x'), null); });
t('split check flags big steps', () => { const r = c.apply(c.emptyState(), { action: 'add', title: 'Big', steps: [{ text: 'all', estimate: '2 h' }] }); assert.equal(c.splitCheck(r.state.builds[0]).needsSplit, true); });
t('import from pending keeps the model', () => { const r = c.apply(c.emptyState(), { action: 'import', item: { id: 'p1', title: 'P', model: 'Fable', subPrompts: [{ text: 'a', estimate: '10 min' }] } }); assert.equal(r.state.builds[0].steps[0].model, 'Fable'); assert.equal(r.state.builds[0].pendingId, 'p1'); });
t('hide, archive, move, edit, remove step', () => {
  let x = c.apply(c.emptyState(), { action: 'add', title: 'M', steps }).state;
  x = c.apply(x, { action: 'hide', id: 'm' }).state; assert.equal(x.builds[0].hidden, true);
  x = c.apply(x, { action: 'move-step', id: 'm', step: 's3', dir: 'up' }).state; assert.equal(x.builds[0].steps[1].id, 's3');
  x = c.apply(x, { action: 'edit-step', id: 'm', step: 's3', stepData: { model: 'Fable' } }).state; assert.equal(c.phases(x.builds[0]).length, 1);
  x = c.apply(x, { action: 'remove-step', id: 'm', step: 's4' }).state; assert.equal(x.builds[0].steps.length, 3);
  x = c.apply(x, { action: 'archive', id: 'm' }).state; assert.equal(x.builds[0].status, 'archived');
});
t('duplicate id refused', () => assert.throws(() => c.apply(s, { action: 'add', title: 'Demo build' }), /already/));
t('labelled phases + groups + categories', () => {
  const st = [{ text: 'a', model: 'Fable', estimate: '10 min', phase: 'P1', group: 'G1' }, { text: 'b', model: 'Fable', estimate: '10 min', phase: 'P1', group: 'G2' }, { text: 'c', model: 'Fable', estimate: '10 min', phase: 'P2', group: 'G3' }, { text: 'd', model: 'Opus', estimate: '10 min', phase: 'P3' }];
  const x = c.apply(c.emptyState(), { action: 'add', title: 'L', category: 'Cat', steps: st }).state; const ps = c.phases(x.builds[0]);
  assert.deepEqual(ps.map((p) => p.name), ['P1', 'P2', 'P3']); assert.deepEqual(ps.map((p) => p.gate), [false, false, true]);
  assert.deepEqual(ps[0].groups.map((g) => g.label), ['G1', 'G2']); assert.equal(x.builds[0].category, 'Cat');
  const y = c.apply(x, { action: 'add', title: 'Other' }).state; assert.deepEqual(c.categories(y.builds).map((k) => k.name), ['Cat', c.UNCATEGORISED]);
  assert.match(c.brief(x.builds[0]), /— G1 —/); assert.equal(c.sortBuilds(y.builds, 'title')[0].title, 'L');
  const z = c.apply(y, { action: 'update', id: 'other', category: 'New' }).state; assert.equal(z.builds[1].category, 'New');
});
// CLI round-trip on a scratch tracker
const dir = mkdtempSync(join(tmpdir(), 'orch-')); process.env.AXF_ORCH_FILE = join(dir, 'o.json'); process.env.AXF_PENDING_FILE = join(dir, 'p.json');
const cli = await import('./orchestrator.mjs');
cli.act({ action: 'add', title: 'Cli', steps: [{ text: 'one', model: 'Opus', estimate: '5 min' }] });
cli.act({ action: 'step', id: 'cli', step: 's1' });
t('every save publishes the build to Pending builds (orch-sync)', () => { const p = JSON.parse(readFileSync(process.env.AXF_PENDING_FILE, 'utf8')); const it = p.items.find((x) => x.id === 'cli'); assert.ok(it); assert.equal(it.status, 'complete'); assert.equal(it.subPrompts[0].text, '[Opus] one'); assert.equal(it.subPrompts[0].done, true); });
t('CLI saves the tracker', () => { const f = JSON.parse(readFileSync(process.env.AXF_ORCH_FILE, 'utf8')); assert.equal(f.$axf, 'orchestrator@1'); assert.equal(f.builds[0].status, 'complete'); });
const repo = JSON.parse(readFileSync(new URL('../../../../_claude/builds/orchestrator.json', import.meta.url), 'utf8'));
t('repo tracker is valid', () => { const st = c.normalizeState(repo); assert.ok(st.builds.length >= 1); for (const bb of st.builds) assert.equal(c.splitCheck(bb, st.rules).needsSplit, false, bb.id); });
// feature-matrix@1 Apply engine output (framework/spec/fixtures/feature-matrix.json): skipped steps leave sums, next and the brief
const fmx = JSON.parse(readFileSync(new URL('../../../../framework/spec/fixtures/feature-matrix.json', import.meta.url), 'utf8'));
t('matrix-applied build: skipped step leaves progress, phases and the brief', () => {
  const b2 = c.normalizeState({ builds: [fmx.apply.after.build] }).builds[0];
  assert.equal(c.progress(b2).minutesLeft, 60); assert.equal(c.progress(b2).skipped, 1);
  const ph = c.phases(b2); assert.equal(ph[1].minutesLeft, 35); assert.equal(ph[1].groups[0].skipped, 1);
  const one = { ...b2, steps: b2.steps.map((st) => ({ ...st, model: 'Fable' })) };
  assert.match(c.brief(one), /\[skip\] s3/); assert.match(c.brief(one), /\[ \] fm-dark-mode-shots/); assert.match(c.brief(one), /3 left, ~1 h/);
});
console.log(`build-orchestrator: ${n} checks passed`);
