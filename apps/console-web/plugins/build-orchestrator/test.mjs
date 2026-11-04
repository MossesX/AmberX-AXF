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
// Model switches (Brett, Nov 3 2026): a downgrade passes by itself (recorded), an upgrade needs Brett
const BRETT = { by: 'brett', via: 'console' };
t('downgrade Fable → Opus passes by itself', () => { const x = c.nextUp(b()); assert.equal(x.needsApproval, false); assert.equal(x.phase.kind, 'downgrade'); assert.equal(x.step.id, 's3'); assert.notEqual(b().status, 'waiting'); });
t('brief: a downgrade is fine, upgrades need Brett', () => { const br = c.brief(b(), s.rules); assert.match(br, /downgrades Fable → Opus: fine/); assert.match(br, /never approve it yourself/); assert.doesNotMatch(br, /act approve/); });
t('brief carries only the current phase', () => { const br = c.brief(b(), s.rules); assert.match(br, /s3/); assert.doesNotMatch(br, /s4/); assert.match(br, /no sub-agents/); });
s = c.apply(s, { action: 'step', id: 'demo-build', step: 's3' }).state;
t('ticking a downgrade phase records the downgrade (by auto)', () => { const a = b().approvals.find((x) => x.phase === 1); assert.equal(a.kind, 'downgrade'); assert.equal(a.by, 'auto'); assert.equal(a.to, 'Opus'); });
t('upgrade Opus → Fable waits for Brett, even with the approveModelSwitch rule off', () => {
  assert.equal(c.nextUp(b()).needsApproval, true); assert.equal(c.nextUp(b(), { ...s.rules, approveModelSwitch: false }).needsApproval, true); assert.equal(b().status, 'waiting');
  const br = c.brief(b(), s.rules); assert.match(br, /STOP: demo-build: phase 3 upgrades Opus 5\.5 → Fable 5\.1/); assert.match(br, /request-upgrade demo-build 2/); assert.doesNotMatch(br, /act approve/);
});
t('ticking a step of an unapproved upgrade is refused', () => assert.throws(() => c.apply(s, { action: 'step', id: 'demo-build', step: 's4' }), /needs Brett's approval/));
t('approving an upgrade without Brett is refused (session, orchestrator, forged via)', () => {
  assert.throws(() => c.apply(s, { action: 'approve', id: 'demo-build', phase: 2 }), /needs Brett's approval/);
  assert.throws(() => c.apply(s, { action: 'approve', id: 'demo-build', phase: 2, approver: { by: 'brett', via: 'session' } }), /needs Brett's approval/);
});
t('an old self-approval marked in the audit does not count', () => { const x = c.normalizeState(s); x.builds[0].approvals.push({ phase: 2, from: 'Opus', to: 'Fable', at: 'x', selfApproved: true }); assert.equal(c.nextUp(x.builds[0]).needsApproval, true); });
s = c.apply(s, { action: 'request-upgrade', id: 'demo-build', phase: 2, by: 'build:demo' }).state;
t('request-upgrade files one open request (no duplicates), approves nothing', () => {
  s = c.apply(s, { action: 'request-upgrade', id: 'demo-build', phase: 2, by: 'build:demo' }).state;
  assert.equal(b().upgradeRequests.length, 1); assert.equal(b().upgradeRequests[0].state, 'open'); assert.equal(c.nextUp(b()).needsApproval, true);
  assert.throws(() => c.apply(s, { action: 'request-upgrade', id: 'demo-build', phase: 1 }), /not a model upgrade/);
});
s = c.apply(s, { action: 'approve', id: 'demo-build', phase: 2, approver: BRETT }).state;
t('Brett\'s approval opens the upgrade and records who, how and the request', () => {
  assert.equal(c.nextUp(b()).needsApproval, false); const a = b().approvals.find((x) => x.phase === 2);
  assert.equal(a.by, 'brett'); assert.equal(a.via, 'console'); assert.equal(a.kind, 'upgrade'); assert.equal(a.request, b().upgradeRequests[0].id); assert.equal(b().upgradeRequests[0].state, 'approved');
});
t('raising an open step\'s model is an upgrade too', () => {
  const x = c.apply(c.emptyState(), { action: 'add', title: 'E', steps: [{ text: 'a', model: 'Opus' }] }).state;
  assert.throws(() => c.apply(x, { action: 'edit-step', id: 'e', step: 's1', stepData: { model: 'Fable' } }), /needs Brett's approval/);
  assert.throws(() => c.apply(x, { action: 'update', id: 'e', steps: [{ id: 's1', text: 'a', model: 'Fable' }] }), /needs Brett's approval/);
  assert.equal(c.apply(x, { action: 'edit-step', id: 'e', step: 's1', stepData: { model: 'Fable' }, approver: BRETT }).state.builds[0].steps[0].model, 'Fable');
  const y = c.apply(c.emptyState(), { action: 'add', title: 'D', steps: [{ text: 'a', model: 'Fable' }] }).state;
  assert.equal(c.apply(y, { action: 'edit-step', id: 'd', step: 's1', stepData: { model: 'Opus' } }).state.builds[0].steps[0].model, 'Opus'); // lowering is fine
});
t('deny-upgrade needs Brett too', () => {
  let x = c.apply(c.emptyState(), { action: 'add', title: 'U', steps: [{ text: 'a', model: 'Opus' }, { text: 'b', model: 'Fable' }] }).state;
  x = c.apply(x, { action: 'request-upgrade', id: 'u', phase: 1 }).state;
  assert.throws(() => c.apply(x, { action: 'deny-upgrade', id: 'u', phase: 1 }), /needs Brett's approval/);
  assert.equal(c.apply(x, { action: 'deny-upgrade', id: 'u', phase: 1, approver: BRETT }).state.builds[0].upgradeRequests[0].state, 'denied');
});
s = c.apply(s, { action: 'step', id: 'demo-build', step: 's4' }).state;
t('all done → complete with builtAt', () => { assert.equal(b().status, 'complete'); assert.ok(b().builtAt); });
t('estimates', () => { assert.equal(c.estimateMinutes('2 h'), 120); assert.equal(c.estimateMinutes('1.5 d'), 720); assert.equal(c.estimateMinutes('x'), null); });
t('split check flags big steps', () => { const r = c.apply(c.emptyState(), { action: 'add', title: 'Big', steps: [{ text: 'all', estimate: '2 h' }] }); assert.equal(c.splitCheck(r.state.builds[0]).needsSplit, true); });
t('import from pending keeps the model', () => { const r = c.apply(c.emptyState(), { action: 'import', item: { id: 'p1', title: 'P', model: 'Fable', subPrompts: [{ text: 'a', estimate: '10 min' }] } }); assert.equal(r.state.builds[0].steps[0].model, 'Fable'); assert.equal(r.state.builds[0].pendingId, 'p1'); });
t('hide, archive, move, edit, remove step', () => {
  let x = c.apply(c.emptyState(), { action: 'add', title: 'M', steps }).state;
  x = c.apply(x, { action: 'hide', id: 'm' }).state; assert.equal(x.builds[0].hidden, true);
  x = c.apply(x, { action: 'move-step', id: 'm', step: 's3', dir: 'up' }).state; assert.equal(x.builds[0].steps[1].id, 's3');
  x = c.apply(x, { action: 'edit-step', id: 'm', step: 's3', stepData: { model: 'Fable' }, approver: BRETT }).state; assert.equal(c.phases(x.builds[0]).length, 1);
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
t('rename keeps the id; an empty name is refused', () => {
  let x = c.apply(c.emptyState(), { action: 'add', title: 'R', steps }).state;
  x = c.apply(x, { action: 'rename', id: 'r', title: 'New name' }).state; assert.equal(x.builds[0].id, 'r'); assert.equal(x.builds[0].title, 'New name');
  x = c.apply(x, { action: 'rename-step', id: 'r', step: 's2', title: 'Step name' }).state; assert.equal(x.builds[0].steps[1].title, 'Step name'); assert.equal(x.builds[0].steps[1].text, 'contract');
  assert.throws(() => c.apply(x, { action: 'rename', id: 'r', title: ' ' }), /needs a name/);
});
// CLI round-trip on a scratch builds store (builds@1): the orchestrator writes the store, the Pending list is its projection
const dir = mkdtempSync(join(tmpdir(), 'orch-')); process.env.AXF_BUILDS_STORE = join(dir, 'store.json'); delete process.env.AXF_ORCH_FILE; delete process.env.AXF_PENDING_FILE;
const cli = await import('./orchestrator.mjs');
const { loadPending } = await import('../../../../framework/cli/pending.mjs');
cli.act({ action: 'add', title: 'Cli', steps: [{ text: 'one', model: 'Opus', estimate: '5 min' }] });
cli.act({ action: 'step', id: 'cli', step: 's1' });
t('CLI: an approver comes only from Brett\'s environment, never from the change', () => {
  assert.equal(cli.withApprover({ action: 'approve', approver: { by: 'brett', via: 'console' } }, { CLAUDECODE: '1' }).approver, undefined, 'a session passing an approver in --json');
  assert.equal(cli.withApprover({ action: 'approve' }, { AXF_SURFACE: 'headless', AXF_APPROVER: 'brett', AXF_APPROVER_VIA: 'console' }).approver, undefined, 'a headless build setting the env itself');
  assert.deepEqual(cli.withApprover({ action: 'approve' }, { AXF_APPROVER: 'brett', AXF_APPROVER_VIA: 'console' }).approver, { by: 'brett', via: 'console' });
});
t('CLI: a session can ask for an upgrade (axHub confirm call) but not approve it', () => {
  cli.act({ action: 'add', title: 'Up', steps: [{ text: 'a', model: 'Opus', estimate: '5 min' }, { text: 'b', model: 'Fable', estimate: '5 min' }] });
  cli.act({ action: 'step', id: 'up', step: 's1' });
  const saved = { ...process.env }; process.env.CLAUDECODE = '1'; process.env.AXF_APPROVER = 'brett'; process.env.AXF_APPROVER_VIA = 'console';
  try { assert.throws(() => cli.act({ action: 'approve', id: 'up', phase: 1, approver: { by: 'brett', via: 'console' } }), /needs Brett's approval/); } finally { for (const k of ['CLAUDECODE', 'AXF_APPROVER', 'AXF_APPROVER_VIA']) if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  const r = cli.act({ action: 'request-upgrade', id: 'up', phase: 1, by: 'build:up' }); const b2 = r.build; const ask = cli.upgradeAsk(b2, c.phases(b2)[1], b2.upgradeRequests[0]);
  assert.equal(ask.tool, 'axf.orchestrator_upgrade_approve'); assert.match(ask.reason.title, /^Upgrade up phase 2: Opus → Fable/); assert.deepEqual(ask.arguments, { build: 'up', phase: 1, request: b2.upgradeRequests[0].id });
  assert.equal(c.nextUp(b2).needsApproval, true);
});
t('every change shows on Pending builds at once (one store, no sync)', () => { const it = loadPending().items.find((x) => x.id === 'cli'); assert.ok(it); assert.equal(it.status, 'complete'); assert.equal(it.subPrompts[0].text, '[Opus] one'); assert.equal(it.subPrompts[0].done, true); });
t('CLI saves the store (versioned)', () => { const f = JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8')); assert.equal(f.$axf, 'builds@1'); assert.ok(f.rev >= 2); assert.equal(f.builds.find((b) => b.id === 'cli').status, 'complete'); });
// the orchestrator's own builds in the real store keep the small-steps rule (Pending-only items are warned about by pending.mjs --check-steps)
const store = JSON.parse(readFileSync(new URL('../../../../_claude/builds/store.json', import.meta.url), 'utf8'));
// same scope as before the store: the Main framework orchestrator's builds, plus builds added through the orchestrator since
// finished builds are out of scope: the small-steps rule is about work still to do
const own = store.builds.filter((x) => !x.deleted && ((x.legacy ?? []).some((l) => l.file === '_claude/builds/orchestrator.json') || (!x.pending && x.kind !== 'epic' && !(x.legacy ?? []).length && x.steps.length)));
t('repo store: orchestrator builds are valid and small-stepped', () => { assert.equal(store.$axf, 'builds@1'); const st = c.normalizeState({ builds: own }); assert.ok(st.builds.length >= 1); for (const bb of st.builds.filter((x) => !['built', 'complete', 'archived'].includes(x.status))) assert.equal(c.splitCheck(bb, st.rules).needsSplit, false, bb.id); });
// feature-matrix@1 Apply engine output (framework/spec/fixtures/feature-matrix.json): skipped steps leave sums, next and the brief
const fmx = JSON.parse(readFileSync(new URL('../../../../framework/spec/fixtures/feature-matrix.json', import.meta.url), 'utf8'));
t('matrix-applied build: skipped step leaves progress, phases and the brief', () => {
  const b2 = c.normalizeState({ builds: [fmx.apply.after.build] }).builds[0];
  assert.equal(c.progress(b2).minutesLeft, 60); assert.equal(c.progress(b2).skipped, 1);
  const ph = c.phases(b2); assert.equal(ph[1].minutesLeft, 35); assert.equal(ph[1].groups[0].skipped, 1);
  const one = { ...b2, steps: b2.steps.map((st) => ({ ...st, model: 'Fable' })) };
  assert.match(c.brief(one), /\[skip\] s3/); assert.match(c.brief(one), /\[ \] fm-dark-mode-shots/); assert.match(c.brief(one), /3 left, ~1 h/);
});
t('every brief carries the asset-conformance rule', () => {
  const b2 = c.normalizeState({ builds: [fmx.apply.after.build] }).builds[0];
  assert.ok(c.brief(b2).includes(c.ASSET_RULE));
});

// ---- build-package@1 (Brett, Nov 4 2026): package waiting steps into one build, send to a helper or queue it
{
  const P = await import('./web/packager-core.mjs');
  const S = await import('../../../../framework/plan/builds-store-core.mjs');
  const st = (id, model, extra = {}) => ({ id, uid: `u-${id}`, text: `${id} work`, model, estimate: '20 min', files: ['framework/core/x.mjs'], ...extra });
  const mk = (id, status, steps, extra = {}) => S.normBuild({ id, title: id.toUpperCase(), status, steps, profiles: ['p'], ...extra });
  let store = S.normalizeStore({ builds: [
    mk('alpha', 'running', [st('s1', 'Opus', { done: true, doneAt: 'x' }), st('s2', 'Opus'), st('s3', 'Fable'), st('s4', 'Fable'), st('s5', 'Opus')], { order: { p: 0 } }),
    mk('beta', 'pending', [st('s1', 'Fable'), st('s2', 'Fable')], { order: { p: 1 } }),
    mk('gamma', 'complete', [st('s1', 'Fable', { done: true, doneAt: 'x' })], { order: { p: 2 } }),
    mk('empty', 'pending', [], { order: { p: 3 } }),
  ] });
  const plans = [{ id: 'pl', title: 'Plan', status: 'ready', steps: [{ id: 'a', text: 'plan step', model: 'Fable', minutes: 15 }] }, { id: 'pl2', title: 'Parked', status: 'parked', steps: [{ id: 'a', text: 'x', model: 'Fable' }] }];
  const L = () => P.candidates(store.builds, { plans });
  t('packager: every waiting step, not the one a running build is on, not done / finished builds; ready plans only', () => {
    const { candidates, skipped } = L();
    assert.deepEqual(candidates.map((x) => x.key), ['alpha/u-s3', 'alpha/u-s4', 'alpha/u-s5', 'beta/u-s1', 'beta/u-s2', 'plan:pl/a']);
    assert.deepEqual(skipped.inProgress, ['alpha/u-s2']); assert.deepEqual(skipped.noSteps, ['empty']);
    assert.deepEqual(candidates[0].areas, ['kernel']);
  });
  t('packager: default filter is Fable, and the audit recommendation counts', () => {
    assert.deepEqual(P.filterCandidates(L().candidates).map((x) => x.key), ['alpha/u-s3', 'alpha/u-s4', 'beta/u-s1', 'beta/u-s2', 'plan:pl/a']);
    const rec = P.candidates([{ id: 'd', status: 'pending', profiles: ['p'], steps: [st('s1', 'Opus', { recommendedModel: 'Fable' })] }]).candidates; // model-advice@1 field (raw record)
    assert.equal(P.filterCandidates(rec).length, 1);
  });
  t('packager: select all / none / group toggle / invert; the preset only pre-ticks', () => {
    const keys = L().candidates.map((x) => x.key);
    let sel = P.select([], 'all', keys); assert.equal(sel.length, 6);
    sel = P.select(sel, 'none', keys.slice(0, 2)); assert.equal(sel.length, 4);
    sel = P.select(sel, 'invert', keys); assert.deepEqual(sel, keys.slice(0, 2));
    sel = P.select(sel, 'toggle', ['alpha/u-s3', 'alpha/u-s4']); assert.deepEqual(sel, []);
    assert.deepEqual(P.presetKeys(L().candidates), ['alpha/u-s3', 'alpha/u-s4', 'beta/u-s1', 'beta/u-s2', 'plan:pl/a']);
  });
  t('packager: drag order kept, but steps of one build keep their own order', () => {
    const r = P.keepDeps(['beta/u-s2', 'alpha/u-s4', 'beta/u-s1', 'alpha/u-s3'], L().candidates);
    assert.deepEqual(r.order, ['beta/u-s1', 'alpha/u-s3', 'beta/u-s2', 'alpha/u-s4']);
    assert.deepEqual(P.move(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
  });
  t('packager: dependencies warn (incl. the step being built now) and bring along adds the selectable ones', () => {
    const d = P.dependencies(L().candidates, ['alpha/u-s4', 'beta/u-s2']);
    const a = d.find((x) => x.key === 'alpha/u-s4');
    assert.deepEqual(a.needs.map((x) => [x.key, x.selectable, x.inProgress]), [['alpha/u-s2', false, true], ['alpha/u-s3', true, false]]);
    assert.deepEqual(P.bringAlong(['alpha/u-s4', 'beta/u-s2'], d), ['alpha/u-s3', 'alpha/u-s4', 'beta/u-s1', 'beta/u-s2']);
  });
  t('packager: makePackage = ordered steps linked to their sources; raising Opus → Fable is listed as an upgrade', () => {
    const p = P.makePackage(L().candidates, ['beta/u-s1', 'alpha/u-s5'], { name: 'Night shift', model: 'Fable', taken: ['pkg-night-shift'] });
    assert.equal(p.build.id, 'pkg-night-shift-2'); assert.deepEqual(p.upgrades, ['alpha/u-s5']);
    assert.deepEqual(p.build.steps.map((x) => x.origin), [{ build: 'beta', step: 'u-s1', how: 'package' }, { build: 'alpha', step: 'u-s5', how: 'package' }]);
    assert.throws(() => P.makePackage(L().candidates, ['alpha/u-s2']), /no longer waiting/);
    assert.match(P.confirmLines(L().candidates, ['beta/u-s2', 'beta/u-s1'])[0], /^1\. \[Fable\] s1 work/);
  });
  t('packager: addPackage refuses an upgrade without Brett, writes the package at the top and marks the sources', () => {
    const up = P.makePackage(L().candidates, ['alpha/u-s5'], { model: 'Fable' });
    assert.throws(() => S.addPackage(store, 'p', up), /only Brett/);
    const pkg = P.makePackage(L().candidates, ['alpha/u-s3', 'alpha/u-s4', 'beta/u-s1'], { name: 'Fable now' });
    const r = S.addPackage(store, 'p', pkg, { position: 0 });
    store = r.store;
    assert.deepEqual(S.buildsOf(store, 'p').map((b) => b.id), ['pkg-fable-now', 'alpha', 'beta', 'gamma', 'empty']);
    const alpha = store.builds.find((b) => b.id === 'alpha');
    assert.deepEqual(alpha.steps.map((x) => x.packagedInto ?? ''), ['', '', 'pkg-fable-now', 'pkg-fable-now', '']);
    assert.ok(!L().candidates.some((x) => x.key === 'alpha/u-s3'), 'packaged steps are no longer waiting');
    assert.throws(() => S.addPackage(store, 'p', pkg), /already/);
  });
  t('packager: the source build skips packaged steps (next, brief) and refuses ticking them there', () => {
    const o = c.normalizeState(S.projectOrchestrator(store, 'p'));
    const alpha = o.builds.find((b) => b.id === 'alpha');
    assert.equal(alpha.steps[2].packagedInto, 'pkg-fable-now');
    assert.equal(c.nextUp(alpha).step.id, 's2');
    assert.match(c.brief({ ...alpha, steps: alpha.steps.map((x) => (x.id === 's2' || x.id === 's5' ? { ...x, done: true } : x)) }), /packaged into pkg-fable-now/);
    assert.throws(() => c.apply(o, { action: 'step', id: 'alpha', step: 's3' }), /tick it there/);
  });
  t('packager: ticking a package step ticks its source (syncPackaged), and an emptied package lets its steps go', () => {
    const pk = store.builds.find((b) => b.id === 'pkg-fable-now'); pk.steps[0].done = true; pk.steps[0].doneAt = 'now';
    S.syncPackaged(store);
    assert.equal(store.builds.find((b) => b.id === 'alpha').steps[2].done, true);
    assert.throws(() => S.removePackage(store, 'pkg-fable-now'), /archive it instead/);
    pk.steps[0].done = false; S.syncPackaged(store); assert.equal(store.builds.find((b) => b.id === 'alpha').steps[2].done, false);
    const r = S.removePackage(store, 'pkg-fable-now');
    assert.deepEqual(r.store.builds.find((b) => b.id === 'alpha').steps.map((x) => x.packagedInto ?? ''), ['', '', '', '', '']);
  });
  t('packager: re-analyze puts a package after what it needs and before what needs it; running builds never move', () => {
    const e = P.packageEdges(store.builds);
    assert.ok(e.some((x) => x.before === 'alpha' && x.after === 'pkg-fable-now')); // alpha s2 first
    assert.ok(e.some((x) => x.before === 'pkg-fable-now' && x.after === 'alpha')); // alpha s5 after
    const ids = S.buildsOf(store, 'p').map((b) => b.id);
    const r = P.reanalyze(store.builds, ids);
    assert.equal(r.conflicts.length, 1); assert.deepEqual(r.order, ids); // steps on both sides: side by side, no move
    const b2 = store.builds.map((b) => (b.id === 'beta' ? { ...b, status: 'pending' } : b));
    // a package of beta's s2 only: beta s1 must come first → the package moves after beta
    const s2 = S.addPackage(S.normalizeStore({ builds: b2.filter((b) => b.id !== 'pkg-fable-now').map((b) => (b.id === 'alpha' ? { ...b, steps: b.steps.map((x) => ({ ...x, packagedInto: undefined })) } : b.id === 'beta' ? { ...b, steps: b.steps.map((x) => ({ ...x, packagedInto: undefined })) } : b)) }), 'p',
      P.makePackage(P.candidates(b2.map((b) => (b.id === 'beta' ? { ...b, steps: b.steps.map((x) => ({ ...x, packagedInto: undefined })) } : b))).candidates, ['beta/u-s2'], { name: 'late' }), { position: 0 }).store;
    const r2 = P.reanalyze(s2.builds, S.buildsOf(s2, 'p').map((b) => b.id));
    assert.deepEqual(r2.moves.map((m) => m.id), ['pkg-late']); assert.ok(r2.order.indexOf('pkg-late') > r2.order.indexOf('beta'));
    const r3 = P.reanalyze(s2.builds.map((b) => (b.id === 'pkg-late' ? { ...b, status: 'running' } : b)), S.buildsOf(s2, 'p').map((b) => b.id));
    assert.deepEqual(r3.moves.map((m) => m.id), ['beta'], 'a running package stays; its prerequisite moves before it');
  });
}

// ---- build optimizer (build-optimize@1): plain-code planner, store apply / undo / move, AI answers checked by code
{
  const O = await import('./web/optimizer-core.mjs');
  const S = await import('../../../../framework/plan/builds-store-core.mjs');
  const st = (id, text, model = 'Opus', extra = {}) => ({ id, uid: `${extra.b ?? 'x'}-${id}`, text, model, estimate: '20 min', ...extra });
  const mk = (id, steps, extra = {}) => ({ id, title: id, category: extra.category ?? 'Console', status: extra.status ?? 'pending', profiles: ['p'], order: { p: extra.order ?? 0 }, createdAt: '2026-11-01T00:00:00Z', origin: { said: `do ${id}` }, ...extra, steps: steps.map((x) => ({ ...x, uid: `${id}-${x.id}` })) });
  const builds = () => S.normalizeStore({ builds: [
    mk('a', [st('s1', 'Grid sorting in the datagrid', 'Opus', { files: ['apps/console-web/plugins/changes-grid/web/x.tsx'] }), st('s2', 'Grid column picker', 'Opus', { files: ['apps/console-web/plugins/changes-grid/web/y.tsx'] })], { order: 0 }),
    mk('b', [st('s1', 'Grid export to csv', 'Opus', { files: ['apps/console-web/plugins/changes-grid/web/z.tsx'] })], { order: 1 }),
    mk('c', [st('s1', 'Kernel contract for widgets', 'Fable', { files: ['framework/core/engines/w.ts'] })], { order: 2 }),
    mk('d', [st('s1', 'Engine fixture for widgets', 'Fable', { files: ['framework/core/engines/v.ts'] })], { order: 3 }),
    mk('run', [st('s1', 'Being built now', 'Opus'), st('s2', 'Waiting after it', 'Opus', { files: ['apps/console-web/plugins/changes-grid/web/w.tsx'] })], { order: 4, status: 'running' }),
    mk('pin', [st('s1', 'Pinned work on the grid', 'Opus', { files: ['apps/console-web/plugins/changes-grid/web/q.tsx'] })], { order: 5, pinned: true }),
    mk('done', [{ ...st('s1', 'Grid export to csv file', 'Opus'), done: true }], { order: 6, status: 'complete', pr: '#1' }),
  ] });
  const store0 = builds(); store0.builds.find((b) => b.id === 'pin').pinned = true; // normBuild drops unknown keys: pins come from settings too
  const settings = { pins: ['pin'] };
  t('optimizer scope: never the step a running build is on, never pinned builds, filters narrow it', () => {
    const sc = O.scope(store0.builds, { settings });
    const keys = sc.items.map((c) => c.key);
    assert.ok(!keys.includes('run/run-s1') && sc.inProgress.includes('run/run-s1'), 'running step left alone');
    assert.ok(keys.includes('run/run-s2'), 'an unstarted step of a running build may move');
    assert.ok(!keys.some((k) => k.startsWith('pin/')), 'pinned build left alone');
    assert.ok(!O.scope(store0.builds, { settings: { ...settings, safety: { pullFromRunning: false } } }).items.some((c) => c.build === 'run'));
    assert.deepEqual([...new Set(O.scope(store0.builds, { settings, filter: { models: ['Fable'] } }).items.map((c) => c.build))].sort(), ['c', 'd']);
    assert.ok(O.scope(store0.builds, { settings, filter: { exclude: ['a'] } }).items.every((c) => c.build !== 'a'));
  });
  t('optimizer plan (Basic): same area goes together, Fable and Opus apart, fewer builds, zero AI', () => {
    const sc = O.scope(store0.builds, { settings });
    const pl = O.plan(sc.items, { settings, builds: store0.builds });
    assert.equal(pl.mode, 'basic');
    const grid = pl.packs.find((p) => p.keys.includes('a/a-s1'));
    assert.ok(grid.keys.includes('b/b-s1') && grid.keys.includes('run/run-s2'), 'claims on changes-grid packed together');
    const kern = pl.packs.find((p) => p.keys.includes('c/c-s1'));
    assert.ok(kern.keys.includes('d/d-s1') && kern.model === 'Fable' && kern !== grid, 'Fable work apart, kernel claims together');
    assert.deepEqual(grid.keys.slice(0, 2), ['a/a-s1', 'a/a-s2'], 'a build keeps its step order');
    assert.equal(pl.summary.packs, 2); assert.ok(pl.summary.emptied.includes('a') && pl.summary.emptied.includes('b') && !pl.summary.emptied.includes('run'));
    assert.ok(pl.flags['b/b-s1']?.kind === 'built', 'looks already built is flagged');
    assert.deepEqual(O.plan(sc.items, { settings, builds: store0.builds }).packs.map((p) => p.keys), pl.packs.map((p) => p.keys), 'deterministic');
  });
  t('optimizer caps: never more steps than the cap, and a build is never split just to fit', () => {
    const sc = O.scope(store0.builds, { settings });
    const pl = O.plan(sc.items, { settings: { ...settings, maxSteps: 2 }, builds: store0.builds });
    assert.ok(pl.packs.every((p) => p.keys.length <= 2 || p.sources.length === 1));
    assert.ok(!pl.packs.some((p) => p.keys.includes('a/a-s1')) || pl.packs.find((p) => p.keys.includes('a/a-s1')).keys.includes('a/a-s2'));
  });
  t('optimizer deps: a step dropped before what it needs keeps its order; missing prerequisites are named', () => {
    const sc = O.scope(store0.builds, { settings }); let pl = O.plan(sc.items, { settings, builds: store0.builds });
    const grid = pl.packs.find((p) => p.keys.includes('a/a-s1'));
    pl = O.moveKeys(pl, ['a/a-s2'], grid.id, 0, { items: sc.items, settings: pl.settings });
    const g2 = pl.packs.find((p) => p.id === grid.id).keys;
    assert.ok(g2.indexOf('a/a-s1') < g2.indexOf('a/a-s2'), 'a drop before what it needs is put back after it (dependencies hold)');
    const pl2 = O.moveKeys(pl, ['a/a-s2'], '+', null, { items: sc.items, settings: pl.settings });
    assert.ok(pl2.packs.some((p) => p.keys.length === 1 && p.keys[0] === 'a/a-s2'));
    assert.deepEqual(O.missingPrereqs(pl2, ['a/a-s2'], pl2.packs.at(-1).id, sc.items), ['a/a-s1']);
    const o = O.orderPacks(pl2.packs, new Map(sc.items.map((c) => [c.key, c])));
    const ids = o.packs.map((p) => p.id); const solo = pl2.packs.at(-1).id;
    assert.ok(ids.indexOf(solo) > ids.indexOf(grid.id), 'the pack needing a-s1 runs after the pack holding it');
  });
  t('optimizer apply: steps move over (uid kept, linked back), emptied builds archived, one undo puts it all back', () => {
    const sc = O.scope(store0.builds, { settings }); const pl = O.plan(sc.items, { settings, builds: store0.builds });
    const r = S.applyOptimize(store0, O.applyRequest(pl), { items: sc.items, runId: 'opt-test', now: '2026-11-04T10:00:00.000Z', profile: 'p' });
    assert.equal(r.created.length, 2); assert.ok(r.emptied.includes('a') && r.emptied.includes('b'));
    const nb = r.store.builds.find((b) => b.id === r.created[0]);
    assert.ok(nb.steps.every((x) => x.origin.how === 'optimized') && nb.optimized.run === 'opt-test' && nb.origin.said.includes('[a] do a'));
    assert.equal(r.store.builds.find((b) => b.id === 'a').status, 'archived');
    const run = r.store.builds.find((b) => b.id === 'run'); assert.equal(run.status, 'running'); assert.deepEqual(run.steps.map((x) => x.id), ['s1'], 'running build keeps its current step');
    assert.equal(S.validateStore(r.store).ok, true, JSON.stringify(S.validateStore(r.store).errors.slice(0, 3)));
    assert.throws(() => S.applyOptimize(r.store, O.applyRequest(pl), { items: sc.items }), /no longer waiting|gone/);
    const u = S.undoOptimize(r.store, 'opt-test', { now: '2026-11-04T10:05:00.000Z' });
    const live = (s) => s.builds.filter((b) => !b.deleted).map((b) => `${b.id}:${b.status}:${b.steps.map((x) => x.uid).join(',')}`).sort();
    assert.deepEqual(live(u.store), live(store0)); assert.equal(S.validateStore(u.store).ok, true);
    assert.throws(() => S.undoOptimize(u.store, 'opt-test'), /already undone/);
  });
  t('optimizer undo is refused once work has started in a new build', () => {
    const sc = O.scope(store0.builds, { settings }); const pl = O.plan(sc.items, { settings, builds: store0.builds });
    const r = S.applyOptimize(store0, O.applyRequest(pl), { items: sc.items, runId: 'opt-2' });
    r.store.builds.find((b) => b.id === r.created[0]).steps[0].done = true;
    assert.throws(() => S.undoOptimize(r.store, 'opt-2'), /has started/);
  });
  t('move steps between builds: drop position = order, running steps refused, one undo', () => {
    const m = S.moveSteps(store0, ['b/b-s1'], 'a', { index: 1, runId: 'mv-1', now: '2026-11-04T11:00:00.000Z' });
    assert.deepEqual(m.store.builds.find((b) => b.id === 'a').steps.map((x) => x.uid), ['a-s1', 'b-s1', 'a-s2']);
    assert.deepEqual(m.archived, ['b']); assert.equal(m.store.builds.find((b) => b.id === 'a').steps[1].origin.build, 'b');
    assert.throws(() => S.moveSteps(store0, ['run/run-s1'], 'a'), /being built right now/);
    assert.throws(() => S.moveSteps(store0, ['a/a-s1'], 'done'), /complete/);
    const u = S.undoOptimize(m.store, 'mv-1', { now: '2026-11-04T11:01:00.000Z' });
    assert.deepEqual(u.store.builds.find((b) => b.id === 'a').steps.map((x) => x.uid), ['a-s1', 'a-s2']); assert.equal(u.store.builds.find((b) => b.id === 'b').status, 'pending');
  });
  t('Deep mode answers are checked by code: unknown keys and running steps are rejected, names and drops shown', () => {
    const sc = O.scope(store0.builds, { settings }); const pl = O.plan(sc.items, { settings, builds: store0.builds });
    const ai = { packs: [{ id: pl.packs[0].id, name: 'Grid polish', why: 'all on the changes grid' }], moves: [{ key: 'run/run-s1', to: pl.packs[0].id }, { key: 'nope/x', to: 'pack-1' }],
      drops: [{ key: 'b/b-s1', kind: 'built', ref: 'done s1', why: 'csv export shipped in #1' }], notes: [{ key: 'a/a-s1', why: 'contract work', model: 'Fable' }], deps: [{ key: 'd/d-s1', needs: 'c/c-s1', why: 'fixture needs the contract' }] };
    const d = O.applyAi(pl, ai, sc.items, { builds: store0.builds });
    assert.equal(d.mode, 'deep'); assert.equal(d.packs[0].ai.name, 'Grid polish');
    assert.equal(d.rejected.length, 2); assert.equal(d.flags['b/b-s1'].ai, true);
    assert.equal(d.notes['a/a-s1'].upgrade, true, 'an upgrade is only a suggestion');
    assert.ok(d.packs.flatMap((p) => p.keys).every((k) => k !== 'run/run-s1'));
    assert.equal(d.reasons['d/d-s1'].kind, 'dependency');
  });
  t('optimizer settings: locked safety stays on, presets lay over, notifications per setting', () => {
    const n = O.normSettings({ safety: { neverTouchRunning: false, requireConfirm: false }, maxSteps: 999, mode: 'nope' });
    assert.equal(n.safety.neverTouchRunning, true); assert.equal(n.safety.requireConfirm, true); assert.equal(n.maxSteps, 40); assert.equal(n.mode, 'auto');
    assert.equal(O.withPreset({}, O.PRESETS.safe).safety.pullFromRunning, false);
    assert.equal(O.shouldNotify('no-ai', { fellBack: true }), true); assert.equal(O.shouldNotify('no-ai', { fellBack: false }), false);
    assert.equal(O.shouldNotify('every', { fellBack: false }), true); assert.equal(O.shouldNotify('off', { fellBack: true }), false);
    assert.match(O.notice({ mode: 'basic', summary: { line: '3 builds become 1' } }, { fellBack: true }), /^Ran in Basic mode, AI wasn't available: 3 builds become 1/);
  });
}
console.log(`build-orchestrator: ${n} checks passed`);
