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
process.env.AXF_FABLE_UPGRADE_APPROVAL = '1'; // these checks cover the approval rule (setting on); the off case is below
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
t('repo store: orchestrator builds are valid and small-stepped', () => { assert.equal(store.$axf, 'builds@1'); const st = c.normalizeState({ builds: own }); assert.ok(st.builds.length >= 1); for (const bb of st.builds.filter((x) => !['built', 'complete', 'archived'].includes(x.status))) {
  // the repo store is live data (every session's builds land on main within a minute): a step over the limit fails,
  // a step still waiting for its estimate is flagged (pending.mjs --check-steps warns the same way), so a build another
  // session is still writing can't turn every PR's CI red (Nov 4 2026, land-merge-queue-first)
  const { reasons } = c.splitCheck(bb, st.rules);
  const big = reasons.filter((r) => !/has no estimate|no steps yet/.test(r));
  if (reasons.length > big.length) console.warn(`  ! ${bb.id}: ${reasons.length - big.length} step(s) without an estimate yet`);
  assert.deepEqual(big, [], bb.id);
} });
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
t('a build that touches UI carries the UI = API rule (ui-api@1); one that does not, does not', () => {
  const ui = c.normalizeState({ builds: [{ id: 'ui-x', title: 'New settings dialog for the Terminal', steps: [{ text: 'Dialog + toolbar', model: 'Opus', estimate: 20 }] }] }).builds[0];
  const eng = c.normalizeState({ builds: [{ id: 'eng-x', title: 'Kernel fixture regen', steps: [{ text: 'Regenerate fixtures', model: 'Opus', estimate: 20 }] }] }).builds[0];
  assert.ok(c.brief(ui).includes(c.API_PARITY_RULE)); assert.ok(!c.brief(eng).includes(c.API_PARITY_RULE));
  assert.ok(c.touchesUi({ steps: [{ text: 'x', files: ['apps/console-web/plugins/x/web/index.tsx'] }] }));
  assert.match(c.API_PARITY_RULE, /ui-parity\.mjs check/);
});
// Fable upgrades need my approval = off (Brett, Nov 4 2026: "If it needs Fable, set it to be Fable."): upgrades run by themselves, recorded
t('approvals off: an upgrade phase is clear, ticking it records the switch (approvals + a build note)', () => {
  c.setUpgradePolicy({ approvalRequired: false, source: 'test' });
  try {
    let x = c.apply(c.emptyState(), { action: 'add', title: 'Auto', steps: [{ text: 'a', model: 'Opus', estimate: '5 min' }, { text: 'b', model: 'Fable', estimate: '5 min' }] }).state;
    x = c.apply(x, { action: 'step', id: 'auto', step: 's1' }).state;
    assert.equal(c.nextUp(x.builds[0]).needsApproval, false); assert.notEqual(x.builds[0].status, 'waiting');
    const br = c.brief(x.builds[0], x.rules); assert.doesNotMatch(br, /STOP/); assert.match(br, /no approval needed/); assert.match(br, /set to Fable and runs on Fable/);
    const r = c.apply(x, { action: 'step', id: 'auto', step: 's2' }); x = r.state;
    const a = x.builds[0].approvals.find((y) => y.phase === 1);
    assert.equal(a.kind, 'upgrade'); assert.equal(a.by, 'auto'); assert.equal(a.via, 'policy'); assert.match(a.note, /Fable upgrades need my approval is off/);
    assert.match(x.builds[0].notes.at(-1).text, /Model switch: phase 2 Opus → Fable/); assert.ok(r.log.some((l) => /upgraded by itself/.test(l)));
  } finally { c.setUpgradePolicy({ approvalRequired: true, source: 'test' }); }
});
t('approvals off: request-upgrade upgrades at once (closes nothing open), raising a step needs nobody, deny still needs Brett', () => {
  c.setUpgradePolicy({ approvalRequired: false, source: 'test' });
  try {
    let x = c.apply(c.emptyState(), { action: 'add', title: 'Req', steps: [{ text: 'a', model: 'Opus', estimate: '5 min', done: true }, { text: 'b', model: 'Fable', estimate: '5 min' }] }).state;
    x = c.apply(x, { action: 'request-upgrade', id: 'req', phase: 1 }).state;
    assert.equal(x.builds[0].upgradeRequests.length, 0); assert.equal(x.builds[0].approvals[0].via, 'policy');
    x = c.apply(x, { action: 'add', title: 'Raise', steps: [{ text: 'a', model: 'Opus', estimate: '5 min' }] }).state;
    x = c.apply(x, { action: 'edit-step', id: 'raise', step: 's1', stepData: { model: 'Fable' } }).state; assert.equal(x.builds[1].steps[0].model, 'Fable');
    assert.throws(() => c.apply(x, { action: 'deny-upgrade', id: 'req', phase: 1 }), /needs Brett's approval/);
  } finally { c.setUpgradePolicy({ approvalRequired: true, source: 'test' }); }
});
t('approvals off: an open request filed while they were on is closed when the phase starts', () => {
  let x = c.apply(c.emptyState(), { action: 'add', title: 'Old', steps: [{ text: 'a', model: 'Opus', estimate: '5 min', done: true }, { text: 'b', model: 'Fable', estimate: '5 min' }] }).state;
  x = c.apply(x, { action: 'request-upgrade', id: 'old', phase: 1 }).state; assert.equal(x.builds[0].upgradeRequests[0].state, 'open');
  c.setUpgradePolicy({ approvalRequired: false, source: 'test' });
  try { x = c.apply(x, { action: 'step', id: 'old', step: 's2' }).state; assert.equal(x.builds[0].upgradeRequests[0].state, 'approved'); }
  finally { c.setUpgradePolicy({ approvalRequired: true, source: 'test' }); }
});
console.log(`build-orchestrator: ${n} checks passed`);
