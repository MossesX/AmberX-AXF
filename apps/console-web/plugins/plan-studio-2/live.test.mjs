#!/usr/bin/env node
// Self-test: node apps/console-web/plugins/plan-studio-2/live.test.mjs
// Sent plans (plan-live@1), on a scratch tree and a scratch builds store (the repo and the hub are never touched):
// one source of truth (statuses read from the builds store, nothing copied), replace on split (the orchestrator's
// steps listed in place of the sent planning steps, marked From orchestrator, the planning steps kept in the item's
// history), live check-off as the orchestrator moves a step, every state, the lock, the way back on a cancel, the
// orchestrator-action target, the build-hook listener, and the looks.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ps2-live-'));
Object.assign(process.env, { AXF_PLAN_TREE_DIR: join(dir, 'tree'), AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off', AXF_PLAN_BUILDS_TTL: '0' });
const tc = await import('./web/tree-core.mjs');
const live = await import('./web/live-core.mjs');
const T = await import('./tree.mjs');
const BS = await import('../../../../framework/cli/builds-store.mjs');
const P2 = await import('../../../../framework/core/pipeline-status.mjs');
const core = await import('../../../../framework/plan/builds-store-core.mjs');
const hook = await import('./build-hook.mjs');

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const api = (r) => T.api(r, { by: 'test' });
const state = () => api({ op: 'state' });
const row = (title) => state().items.find((i) => i.title === title);
const stored = () => JSON.parse(readFileSync(join(dir, 'tree', 'tree.json'), 'utf8'));
const history = () => JSON.parse(readFileSync(join(dir, 'tree', 'sent-history.json'), 'utf8'));
const refused = (r) => { try { api(r); } catch (e) { return e; } return null; };
const move = (id, to, o = {}) => BS.setFlowStatus(id, to, { by: 'orchestrator', ...o });
/** The orchestrator's split: its own steps, filed in the builds store. */
const split = (id, texts) => {
  const at = new Date().toISOString();
  move(id, 'splitting');
  move(id, 'split', { mutate: (rec) => { rec.steps = texts.map((text, i) => core.normStep(P2.transition({ id: `s${i + 1}`, text, model: i ? 'Opus' : 'Fable', estimate: '10 min' }, 'pending', { at, by: 'orchestrator', kind: 'step' }).rec, i)); } });
};

const plan = api({ op: 'add', kind: 'plan', title: 'Launch' }).item;
api({ op: 'add', kind: 'note', title: 'Why', body: 'Because', parent: plan.id });
const design = api({ op: 'add', kind: 'step', title: 'Design it', parent: plan.id }).item;
api({ op: 'add', kind: 'step', title: 'Ship it', parent: plan.id });
api({ op: 'add', kind: 'step', title: 'Already done', parent: plan.id });
api({ op: 'edit', id: 'Already done', patch: { done: true } });
const other = api({ op: 'add', kind: 'plan', title: 'Other plan' }).item;
let build = '';

await t('before a send: nothing is live, nothing is locked', () => {
  const s = state();
  assert.equal(s.sent, 0); assert.equal(s.watch, false);
  assert.ok(s.items.every((i) => !i.live && !i.locked && !i.origin));
  assert.deepEqual(s.states, ['sent', 'building', 'merging', 'recompiling', 'ci', 'waiting', 'landed', 'failed']);
  assert.match(refused({ op: 'target', id: plan.id }).message, /not sent to the orchestrator yet/);
});

await t('send: the plan is locked at once and its steps show as sent to the orchestrator (still its own steps)', () => {
  build = api({ op: 'build', id: plan.id }).build.id;
  const s = state();
  assert.equal(s.sent, 1); assert.equal(s.watch, true);
  const p = s.items.find((i) => i.id === plan.id);
  assert.ok(p.locked && p.live.build === build && p.live.state === 'sent' && p.live.stateLabel === 'Sent to orchestrator' && p.live.split === false);
  assert.equal(row('Design it').live.state, 'sent'); assert.equal(row('Ship it').live.state, 'sent');
  assert.ok(row('Design it').locked && row('Why').locked && row('Already done').locked, 'everything under a sent plan is locked');
  assert.ok(!row('Already done').live && !row('Why').live, 'only the steps that were sent carry a state');
  assert.ok(!s.items.some((i) => i.origin), 'no orchestrator steps before the split');
  assert.ok(!row('Other plan').locked);
});

await t('the lock: no edit, rename, add, move, reorder, indent, duplicate or delete; folding still works', () => {
  for (const r of [
    { op: 'add', kind: 'step', title: 'Sneak one in', parent: plan.id }, { op: 'rename', id: design.id, title: 'x' }, { op: 'edit', id: design.id, patch: { done: true } },
    { op: 'edit', id: plan.id, patch: { title: 'x' } }, { op: 'move', id: design.id, parent: null }, { op: 'move', id: other.id, parent: plan.id }, { op: 'nudge', id: design.id, delta: 1 },
    { op: 'indent', id: 'Ship it' }, { op: 'outdent', id: design.id }, { op: 'duplicate', id: design.id }, { op: 'delete', id: design.id }, { op: 'delete', id: plan.id },
    { op: 'import', data: [{ id: 'a', kind: 'step', title: 'Imported' }], parent: plan.id }, { op: 'restore-steps', id: plan.id },
  ]) { const e = refused(r); assert.ok(e && e.code === 'locked', `${r.op} ${r.id ?? r.parent} is refused as locked: ${e?.message}`); assert.match(e.message, /locked until the build lands or is cancelled/); }
  assert.equal(api({ op: 'collapse', id: plan.id, collapsed: true }).ok, true, 'folding is display only');
  api({ op: 'collapse', id: plan.id, collapsed: false });
  assert.match(api({ op: 'validate', id: design.id }).errors.map((e) => e.why).join(' '), /locked until that build lands/, 'a step inside a sent plan is not sent on its own');
  assert.equal(api({ op: 'rename', id: other.id, title: 'Other plan' }).ok, true, 'other plans are not locked');
});

await t('replace on split: the sent planning steps leave the list, the orchestrator\'s steps are listed exactly as filed', () => {
  split(build, ['Build the schema\nWith the details', 'Build the page', 'Write the tests']);
  const s = state();
  assert.ok(!s.items.some((i) => ['Design it', 'Ship it'].includes(i.title)), 'the planning steps that were sent are gone from the list');
  assert.ok(row('Already done') && row('Why'), 'what was not sent stays');
  const orch = s.items.filter((i) => i.origin === 'orchestrator');
  assert.deepEqual(orch.map((i) => i.title), ['Build the schema', 'Build the page', 'Write the tests']);
  assert.deepEqual(orch.map((i) => i.id), [1, 2, 3].map((k) => `orch--${build}--s${k}`));
  assert.ok(orch.every((i) => i.parent === plan.id && i.kind === 'step' && i.locked && !i.done && i.live.state === 'sent' && i.live.build === build));
  assert.deepEqual(orch.map((i) => [i.model, i.minutes, i.live.step]), [['Fable', 10, 's1'], ['Opus', 10, 's2'], ['Opus', 10, 's3']]);
  assert.equal(orch[0].body, 'Build the schema\nWith the details');
  assert.ok(orch[0].order > row('Already done').order, 'after the plan\'s own children, in the orchestrator\'s order');
  assert.equal(s.items.find((i) => i.id === plan.id).live.split, true);
});

await t('From orchestrator: received steps are marked, the plan\'s own steps never are', async () => {
  const s = state();
  assert.equal(s.originLabel, 'From orchestrator');
  assert.ok(s.items.filter((i) => i.live?.step).every((i) => i.origin === 'orchestrator' && i.by === 'orchestrator'));
  assert.ok(s.items.filter((i) => !i.live?.step).every((i) => !i.origin));
  const text = [];
  const log = console.log; console.log = (x) => text.push(x);
  try { await T.main(['tree']); } finally { console.log = log; }
  assert.match(text.join('\n'), /Build the schema.*\[From orchestrator · Sent to orchestrator: Pending\]/);
  assert.match(text.join('\n'), /Launch.*\[locked · Sent to orchestrator: Pending\]/);
});

await t('one source of truth: the tree stores no orchestrator step and no status, only the history of what was replaced', () => {
  const raw = stored();
  assert.ok(!raw.items.some((i) => i.origin || i.live || i.locked || /^orch--/.test(i.id)), 'nothing from the builds store is written into the tree');
  assert.deepEqual(raw.items.map((i) => i.title).sort(), ['Already done', 'Launch', 'Other plan', 'Why']);
  assert.ok(raw.items.every((i) => !('history' in i)), 'plan-tree@1 items are unchanged: the history is its own document');
  assert.equal(history().$axf, 'plan-history@1');
  const h = history().items[plan.id];
  assert.equal(h.length, 1); assert.equal(h[0].build, build); assert.deepEqual(h[0].items.map((i) => i.title), ['Design it', 'Ship it']);
  // a writer that only knows plan-tree@1 (an older checkout) rewrites the tree: the history is out of its reach
  T.save(tc.normalize(JSON.parse(JSON.stringify(raw))));
  assert.deepEqual(history().items[plan.id][0].items.map((i) => i.title), ['Design it', 'Ship it']);
  const hist = api({ op: 'history', id: plan.id }).history;
  assert.deepEqual(hist[0].steps.map((x) => x.title), ['Design it', 'Ship it'], 'the planning steps are recoverable from the history');
  const rev = raw.rev;
  state(); state();
  assert.equal(stored().rev, rev, 'reading again changes nothing (the replace happens once per build)');
});

await t('live check-off: a step changes state in place as the orchestrator moves it, with no write to the tree', () => {
  const rev = stored().rev;
  const s1 = () => row('Build the schema');
  move(build, 'pulling-main');
  for (const to of ['pulling-main', 'ready']) move(build, to, { step: 's1' });
  assert.equal(s1().live.state, 'sent'); assert.equal(s1().live.label, 'Ready');
  assert.equal(row('Launch').live.state, 'building');
  move(build, 'sending', { step: 's1' }); move(build, 'building', { step: 's1' });
  assert.equal(s1().live.state, 'building'); assert.equal(s1().done, false);
  move(build, 'completed', { step: 's1' });
  assert.equal(s1().done, true, 'checked off the moment the orchestrator completes it');
  assert.equal(s1().live.state, 'waiting'); assert.equal(s1().live.stateLabel, 'Waiting for merge');
  assert.equal(row('Build the page').done, false);
  assert.deepEqual(row('Launch').live.steps, { done: 1, total: 3 });
  assert.deepEqual(api({ op: 'get', id: plan.id }).item.progress, { done: 2, total: 4, minutes: 30 }, 'progress counts the orchestrator\'s steps');
  assert.equal(stored().rev, rev, 'statuses are read from the builds store, never copied into the tree');
});

await t('every state: failed, building, merging, recompiling, running CI, waiting for merge, landed', () => {
  move(build, 'ready', { step: 's2' }); move(build, 'sending', { step: 's2' }); move(build, 'failed', { step: 's2', why: 'launch refused' });
  assert.equal(row('Build the page').live.state, 'failed'); assert.equal(row('Build the page').live.label, 'Failed, attempt 1');
  move(build, 'ready', { step: 's2' });
  for (const sid of ['s2', 's3']) for (const to of ['ready', 'sending', 'building', 'completed']) move(build, to, { step: sid });
  const seen = [];
  for (const to of ['ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main']) { move(build, to); seen.push([to, row('Launch').live.state, row('Write the tests').live.state]); }
  assert.deepEqual(seen.slice(2), [['building', 'building', 'waiting'], ['build-complete', 'waiting', 'waiting'], ['merging-pr', 'merging', 'merging'], ['pr-pulling-main', 'recompiling', 'recompiling'], ['running-ci', 'ci', 'ci'], ['merging-main', 'merging', 'merging']]);
  move(build, 'failed', { why: 'CI red' });
  assert.equal(row('Launch').live.state, 'failed'); assert.equal(row('Launch').live.label, 'Failed, attempt 1');
  assert.equal(row('Write the tests').live.state, 'merging', 'a built step shows where its build failed');
  assert.equal(state().watch, true, 'a failed build is still being watched');
  move(build, 'merging-main');
  move(build, 'landed', { mutate: (rec) => { const at = new Date().toISOString(); rec.pr = 901; rec.mergedAt = at; rec.landed = { pr: 901, mergedAt: at, sha: 'abc1234', ci: 'success' }; } }); // the lander's evidence: a merged PR, CI green
  const s = state();
  const p = s.items.find((i) => i.id === plan.id);
  assert.equal(p.live.state, 'landed'); assert.ok(!p.locked, 'a landed plan is no longer locked');
  assert.ok(s.items.filter((i) => i.origin).every((i) => i.done && i.live.state === 'landed'));
  assert.equal(s.watch, false, 'nothing left to watch');
  assert.equal(api({ op: 'add', kind: 'step', title: 'Follow-up', parent: plan.id }).ok, true, 'the landed plan takes new steps again');
});

await t('history after landing: the planning steps come back on request, once', () => {
  const r = api({ op: 'restore-steps', id: plan.id });
  assert.equal(r.restored, 2);
  assert.ok(row('Design it') && row('Ship it'));
  assert.match(refused({ op: 'restore-steps', id: plan.id }).message, /no planning steps to bring back/);
  assert.ok(api({ op: 'history', id: plan.id }).history[0].restoredAt);
  state();
  assert.ok(row('Design it'), 'a later read does not replace them again');
});

await t('another plan, split through the store\'s change event, then cancelled: it unlocks and its planning steps come back', async () => {
  const p3 = api({ op: 'add', kind: 'plan', title: 'Third' }).item;
  api({ op: 'add', kind: 'step', title: 'Alpha', parent: p3.id }); api({ op: 'add', kind: 'step', title: 'Beta', parent: p3.id });
  const b3 = api({ op: 'build', id: p3.id }).build.id;
  split(b3, ['Orchestrator step one', 'Orchestrator step two']);
  assert.equal(hook.wants([{ event: 'status', build: { id: b3 } }], new Set([b3])), true); assert.equal(hook.wants([{ event: 'step-done', build: { id: 'someone-elses' } }], new Set([b3])), false, 'a build that was not sent from a plan costs nothing');
  assert.equal(hook.wants([{ event: 'status', build: { id: 'any' } }], null), true, 'before the first read every build event counts');
  const r = await hook.onBuildEvents([{ event: 'status', to: 'split', build: { id: b3 } }]);
  assert.equal(r.synced, true, 'the builds store\'s change event replaces the steps without waiting for a read');
  assert.deepEqual(r.replaced, [{ item: p3.id, build: b3, steps: 2 }]);
  assert.ok(!stored().items.some((i) => ['Alpha', 'Beta'].includes(i.title)));
  assert.deepEqual(state().items.filter((i) => i.parent === p3.id).map((i) => i.title), ['Orchestrator step one', 'Orchestrator step two']);
  // the target of an orchestrator action: a step row names its build and step; a plan row its build
  const target = (id) => { const x = api({ op: 'target', id }); return [x.build, x.step]; };
  assert.deepEqual(target(`orch--${b3}--s2`), [b3, 's2']);
  assert.deepEqual(target(p3.id), [b3, '']);
  assert.match(refused({ op: 'rename', id: `orch--${b3}--s1`, title: 'x' }).message, /filed by the orchestrator/);
  assert.match(refused({ op: 'delete', id: `orch--${b3}--s1` }).message, /filed by the orchestrator/);
  move(b3, 'archived', { why: 'cancel' });
  const s = state();
  assert.deepEqual(s.items.filter((i) => i.parent === p3.id).map((i) => [i.title, !!i.locked, !!i.origin]), [['Alpha', false, false], ['Beta', false, false]], 'cancelled: the orchestrator\'s steps are gone, the planning steps are back');
  assert.ok(!s.items.find((i) => i.id === p3.id).live && !history().items[p3.id], 'the entry is gone with the cancelled build');
  assert.equal(api({ op: 'rename', id: 'Alpha', title: 'Alpha 2' }).ok, true, 'and the plan is open again');
});

await t('the sent builds are kept beside the tree: a fresh read is reused, a stale one is refreshed by the store\'s change event', async () => {
  const cache = () => JSON.parse(readFileSync(join(dir, 'tree', T.BUILDS_CACHE), 'utf8'));
  const p4 = api({ op: 'add', kind: 'plan', title: 'Fourth' }).item;
  api({ op: 'add', kind: 'step', title: 'Gamma', parent: p4.id });
  process.env.AXF_PLAN_BUILDS_TTL = '300';
  try {
    const b4 = api({ op: 'build', id: p4.id }).build.id;
    assert.ok(cache().builds.some((b) => b.id === b4 && b.planRef === p4.id), 'a send is known at once');
    assert.ok(cache().builds.every((b) => b.planRef && !('notes' in b) && !('statusLog' in b)), 'only sent builds, trimmed to what the page shows');
    assert.equal(row('Fourth').live.state, 'sent'); assert.ok(row('Fourth').locked);
    assert.ok(T.sentBuildIds().has(b4));
    split(b4, ['Delta']);
    assert.ok(row('Gamma') && !state().items.some((i) => i.title === 'Delta'), 'inside the fresh window the builds store is not read again');
    const r = await hook.onBuildEvents([{ event: 'status', to: 'split', build: { id: b4 } }]);
    assert.equal(r.synced, true);
    assert.deepEqual(state().items.filter((i) => i.parent === p4.id).map((i) => [i.title, i.origin]), [['Delta', 'orchestrator']], 'the change event reads the build again: the page shows it without reading the store itself');
    assert.equal((await hook.onBuildEvents([{ event: 'status', build: { id: 'not-from-a-plan' } }])).synced, false);
    move(b4, 'archived', { why: 'cancel' });
    assert.equal(api({ op: 'sync', fresh: true }).changed, true, 'an orchestrator action asks for a fresh read');
    assert.ok(row('Gamma') && !row('Fourth').locked);
  } finally { process.env.AXF_PLAN_BUILDS_TTL = '0'; }
});

await t('pure core: states, row ids, lock lookup, a store that cannot be read changes nothing', () => {
  const b = { id: 'x', flow: 'pipeline-2', planRef: 'p', status: 'building', createdAt: '1', steps: [{ id: 's1', status: 'building' }, { id: 's2', status: 'pending' }, { id: 's3', status: 'in-pr', done: true, prNumber: 9 }] };
  assert.equal(live.buildState(b), 'building');
  assert.deepEqual(b.steps.map((s) => live.stepState(b, s)), ['building', 'sent', 'waiting']);
  assert.equal(live.stepState({ ...b, status: 'failed', failedFrom: 'running-ci' }, b.steps[2]), 'ci');
  assert.equal(live.stepState({ ...b, status: 'landed' }, b.steps[1]), 'landed');
  for (const st of P2.BUILD_STATUSES) assert.ok(live.STATES.includes(live.buildState({ status: st })), `build status ${st} has a state`);
  for (const st of P2.STEP_STATUSES) assert.ok(live.STATES.includes(live.stepState({ status: 'building' }, { status: st })), `step status ${st} has a state`);
  assert.deepEqual(live.parseStepRowId(live.stepRowId('fix-main-ci-red-', 's12')), { build: 'fix-main-ci-red-', step: 's12' });
  assert.equal(live.parseStepRowId('launch-ab12'), null);
  assert.equal(live.stepRow(b, b.steps[2], 'p', 0).live.pr, 9);
  let s = tc.add(tc.emptyState(), { kind: 'plan', title: 'P' }).state; const p = s.items[0];
  s = tc.add(s, { kind: 'step', title: 'Mine', parent: p.id }).state;
  const builds = [{ ...b, planRef: p.id }];
  assert.equal(live.lockOf(s, builds, s.items[1].id).item.id, p.id, 'a step is locked by the sent plan above it');
  assert.equal(live.lockOf(s, [{ ...builds[0], status: 'landed' }], p.id), null);
  assert.equal(live.lockOf(s, [{ ...builds[0], status: 'archived' }], p.id), null);
  assert.equal(live.lockOf(s, [{ ...builds[0], deleted: true }], p.id), null);
  const r = live.syncSent(s, builds);
  assert.ok(r.changed && r.state.items.length === 1 && r.history.items[p.id][0].items[0].title === 'Mine');
  assert.equal(live.syncSent(r.state, builds, r.history).changed, false, 'idempotent');
  assert.equal(live.syncSent(r.state, [], r.history).changed, false, 'a build missing from the list (an unreadable store) gives nothing back');
  const back = live.syncSent(r.state, [{ ...builds[0], status: 'archived' }], r.history);
  assert.ok(back.changed && back.state.items.length === 2 && !back.history.items[p.id], 'an archived build gives the steps back and drops the entry');
  assert.deepEqual(live.normHistory({ items: { x: [{ id: 'h-1', items: [] }, { nope: true }], y: 'junk' } }).items, { x: [{ id: 'h-1', at: '', by: '', build: '', kind: 'sent-steps', title: '', items: [] }] });
  assert.equal(live.liveView(s, []), s);
  assert.equal(tc.stored(live.liveView(s, builds)).items.length, s.items.length, 'a save never keeps a view row');
});

await t('looks: every state has one, picks outside the lists fall back, classes come from the picks', () => {
  const d = live.normLooks(null);
  assert.deepEqual(Object.keys(d), [...live.STATES]);
  assert.equal(d.landed.strike, true); assert.equal(d.landed.mark, 'check'); assert.equal(d.failed.tone, 'danger');
  const saved = live.normLooks(JSON.stringify({ building: { tone: 'success', fill: 'accent', font: 'mono', weight: 'strong', style: 'italic', strike: true, mark: 'none', badge: false }, failed: { tone: 'red; background:url(x)', mark: 'star' } }));
  assert.equal(live.lookClasses(saved.building), 'is-strike is-tone-success is-fill-accent is-font-mono is-weight-strong is-style-italic');
  assert.equal(saved.building.badge, false); assert.equal(saved.building.mark, 'none');
  assert.equal(saved.failed.tone, 'danger'); assert.equal(saved.failed.mark, 'box', 'nothing free-form reaches a class');
  const css = readFileSync(new URL('./web/plan-studio-2.css', import.meta.url), 'utf8');
  for (const tone of live.LOOK_TONES.filter(Boolean)) { assert.match(css, new RegExp(`is-tone-${tone} `)); assert.match(css, new RegExp(`is-fill-${tone} `)); }
  for (const c of ['is-strike', 'is-font-mono', 'is-font-display', 'is-weight-medium', 'is-weight-strong', 'is-style-italic', 'is-orch-tint']) assert.match(css, new RegExp(c));
});

await t('the page and the server: a From orchestrator badge, a lock, the orchestrator menu, taps go to the VPS', () => {
  const here = new URL('.', import.meta.url).pathname;
  const ui = readFileSync(join(here, 'web/ui.tsx'), 'utf8'); const lv = readFileSync(join(here, 'web/live.tsx'), 'utf8');
  const idx = readFileSync(join(here, 'web/index.tsx'), 'utf8'); const srv = readFileSync(join(here, 'server/__init__.py'), 'utf8');
  assert.match(ui, /<OrchBadge \/>/); assert.match(ui, /<LockMark orch=\{orch\} \/>/); assert.match(ui, /useLiveProgress\(/); assert.match(ui, /<SentEditor /);
  assert.match(lv, /live\.ORIGIN_LABEL/); assert.match(lv, /data-status=\{l\.status\}/, 'the badge carries the VPS status for status styles and badge packs');
  for (const a of live.ACTIONS) assert.match(idx, new RegExp(`plan-studio-2\\.orch:${a}'`), `menu action ${a}`);
  assert.match(idx, /plan-studio-2\.orch-open/); assert.match(idx, /plan-studio-2\.build/);
  assert.doesNotMatch(`${ui}${lv}${idx}`, /status === '(split|building|landed|running-ci)'/, 'the console never reads a build status to decide anything');
  assert.match(srv, /plugin_services\.get\(DISPATCH_CAP\)/); assert.doesNotMatch(srv, /build-orchestrator/, 'the orchestrator is reached through its capability, never by folder name');
  assert.deepEqual(srv.match(/ORCH_ACTIONS = \(([^)]*)\)/)[1].split(',').map((x) => x.trim().replace(/"/g, '')), [...live.ACTIONS]);
  const m = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'));
  assert.equal(m.buildHooks, 'build-hook.mjs'); assert.ok(m.optional.includes('axf.build-dispatch@1'));
  for (const id of ['orchestrate', 'history', 'restore-steps', 'sync']) assert.ok(m.commands.items.some((c) => c.id === id), `command ${id}`);
});

/* ------------------------------------------------------------------ the build of a sent plan (GET plans/<id>/build) */

await t('a plan that was not sent: no build, its own status, its own steps', async () => {
  const idle = api({ op: 'add', kind: 'plan', title: 'Parked idea', status: 'parked' }).item;
  api({ op: 'add', kind: 'step', title: 'Think about it', parent: idle.id });
  const r = api({ op: 'plan-build', id: idle.id });
  assert.ok(r.ok && r.build === null && r.steps.length === 0); assert.equal(r.plan.status, 'parked');
  assert.match(r.say, /has not been sent to build/);
  assert.equal(row('Parked idea').status, 'parked', 'a plan with no build keeps its own status');
  const ps = await import('./plans.mjs');
  const p = ps.getPlan(idle.id);
  assert.equal(p.status, 'parked'); assert.equal(p.steps.length, 1); assert.ok(!p.build);
  assert.equal(refused({ op: 'plan-build', id: 'no such plan at all' }).code, 'not_found');
});

await t('a sent plan reads from its build: never parked with 0 steps, the steps are the store\'s, nothing is written to the tree', async () => {
  const p = api({ op: 'add', kind: 'plan', title: 'Watch test', status: 'parked' }).item;
  api({ op: 'add', kind: 'step', title: 'Seed step', parent: p.id });
  const id = api({ op: 'build', id: p.id }).build.id;
  let r = api({ op: 'plan-build', id: p.id });
  assert.equal(r.build.id, id); assert.equal(r.build.status, 'pending'); assert.equal(r.steps.length, 0); assert.equal(r.plan.status, 'active');
  assert.equal(row('Watch test').status, 'active', 'a sent plan no longer lists as parked');
  split(id, ['Write the doc\nOne line', 'Check the doc']);
  r = api({ op: 'plan-build', id: p.id });
  const before = JSON.stringify(stored()); // after the one sync a split brings (the sent planning steps move to the history)
  assert.equal(r.build.status, 'split'); assert.equal(r.build.label, 'Pending'); assert.equal(r.build.landed, false);
  assert.deepEqual(r.steps.map((x) => [x.id, x.title, x.model, x.status, x.minutes]), [['s1', 'Write the doc', 'Fable', 'pending', 10], ['s2', 'Check the doc', 'Opus', 'pending', 10]]);
  const inStore = BS.loadStore().builds.find((b) => b.id === id);
  assert.deepEqual(r.steps.map((x) => x.uid), inStore.steps.map((x) => x.uid ?? ''), 'each step carries the unique id the store gave it');
  assert.ok(r.steps.every((x) => x.row === `orch--${id}--${x.id}`));
  if (!('pipelineView' in inStore) && typeof P2.pipelineView !== 'function') assert.equal(r.build.pipelineView, null, 'no pipeline view from the store yet: null, and the raw status is the state');
  else assert.ok(r.build.pipelineView && typeof r.build.pipelineView === 'object', 'the store\'s pipeline view is passed on as it is');
  // read live on every call: a move in the store shows on the very next read, with no sync in between
  move(id, 'pulling-main'); for (const to of ['pulling-main', 'ready', 'sending', 'building']) move(id, to, { step: 's1' });
  r = api({ op: 'plan-build', id: p.id });
  assert.equal(r.build.status, 'pulling-main'); assert.equal(r.steps[0].status, 'building'); assert.equal(r.steps[0].label, 'Building'); assert.equal(r.steps[1].status, 'pending');
  api({ op: 'plan-build', id: p.id });
  assert.equal(JSON.stringify(stored()), before, 'reading the build writes nothing to the plan tree');
  assert.ok(!stored().items.some((i) => /^orch--/.test(i.id) || i.live), 'no step and no status of the build is copied into the tree');
  assert.equal(stored().items.find((i) => i.id === p.id).status, 'parked', 'the stored plan keeps what it had; only the read follows the build');
  // plans@1 and the CLI list read the same thing
  const ps = await import('./plans.mjs');
  const pl = ps.getPlan(p.id);
  assert.equal(pl.status, 'building'); assert.deepEqual(pl.steps.map((x) => x.id), ['s1', 's2']); assert.equal(pl.build.id, id); assert.equal(pl.build.status, 'pulling-main');
  const text = []; const log = console.log; console.log = (x) => text.push(x);
  try { await T.main(['build-status', p.id]); await T.main(['list', '--kind', 'step', '--under', p.id]); } finally { console.log = log; }
  // the head names the build by the number the store gave it (its id before it has one) and reads the store's pipeline
  // view when the build carries one (the raw status label before)
  const num = String(BS.loadStore().builds.find((x) => x.id === id).number ?? ''); const pv = r.build.pipelineView;
  if (pv) assert.equal(pv.state, 'pulling-main', 'the pipeline view follows the move');
  assert.equal(text[0].split('\n')[0], `build ${num ? `#${num}` : id} (${id}) · ${pv ? pv.label : 'Pulling in main'}`);
  if (pv?.line) assert.equal(text[0].split('\n')[1], pv.line, 'the status line is the pipeline view\'s');
  assert.match(text[0], /s1\s+Fable\s+Building\s+Write the doc/);
  assert.match(text[1], /Write the doc/, 'the CLI list shows the build\'s steps under the sent plan');
  BS.setFlowStatus(id, 'archived', { by: 'test', why: 'cancelled' });
  assert.equal(api({ op: 'plan-build', id: p.id }).build, null, 'a cancelled build is no longer the plan\'s build');
  assert.equal(row('Watch test').status, 'parked', 'and the plan has its own status back');
});

await t('the build as the page shows it: number, pipeline view, waiting reason, split mark, merge line, clash options, step columns', () => {
  const b = {
    id: 'watch', number: 41, title: 'Watch', flow: 'pipeline-2', planRef: 'p1', status: 'build-complete', attempt: 2, profiles: ['amberx'], pr: 912,
    pipelineView: { state: 'waiting-to-merge', label: 'Waiting to merge', tone: 'warning', icon: 'clock', line: 'Built. In line to merge.', attempt: 2, waitingOn: null, mergeLine: { position: 2, waitingFor: { number: 40, buildId: 'other', title: 'Other build' } } },
    split: { by: 'vps', model: 'claude-fable-5-2', at: '2026-11-24T00:00:00Z', stepCount: 2 },
    steps: [{ id: 's1', uid: 'st-aaa', text: 'One', splitBy: 'vps-fable', model: 'Fable', modelBy: 'triage', status: 'completed', done: true }, { id: 's2', uid: 'st-bbb', text: 'Two', status: 'pending', estimate: '5 min', waitsFor: { number: 39 } }],
  };
  const d = live.buildDetail(b);
  assert.equal(d.build.number, '41'); assert.equal(d.build.pr, 912); assert.deepEqual(d.build.split, { by: 'vps', model: 'claude-fable-5-2', at: '2026-11-24T00:00:00Z', stepCount: 2 });
  assert.deepEqual(d.steps.map((x) => [x.id, x.uid, x.splitBy, x.model, x.modelBy, x.status]), [['s1', 'st-aaa', 'vps-fable', 'Fable', 'triage', 'completed'], ['s2', 'st-bbb', 'vps-fable', '', '', 'pending']]);
  assert.equal(d.steps[1].label, 'Deferred, waiting for build #39'); assert.equal(d.steps[1].minutes, 5);
  assert.ok(live.byTriage(d.steps[0]) && !live.byTriage(d.steps[1])); assert.equal(live.modelText(d.steps[0]), 'Fable'); assert.equal(live.modelText(d.steps[1]), 'Model not assigned yet');
  const sum = live.buildSummary(d.build);
  assert.deepEqual([sum.name, sum.state, sum.label, sum.tone, sum.raw, sum.line, sum.attempt], ['#41', 'waiting-to-merge', 'Waiting to merge', 'warning', false, 'Built. In line to merge.', 2]);
  assert.equal(sum.merge, '2nd to merge, waiting for build #40'); assert.equal(sum.split, 'Split by Fable on the VPS'); assert.equal(sum.splitByVps, true); assert.equal(sum.waiting, '');
  assert.equal(live.buildLive(b).number, '41', 'the plan row carries the build number too');
  // waiting for the active place: the store's words, else a plain sentence
  assert.equal(live.waitingText({ buildId: 'x', title: 'Big build', reason: '' }), 'Waiting: Big build holds the active place');
  assert.equal(live.waitingText({ buildId: 'x', title: 'Big build', reason: 'Waiting: Big build holds the active place' }), 'Waiting: Big build holds the active place');
  assert.equal(live.waitingText(null), '');
  assert.equal(live.mergeLineText({ position: 1 }), '1st to merge'); assert.equal(live.mergeLineText({ position: 3, waitingFor: 12 }), '3rd to merge, waiting for build #12');
  assert.equal(live.mergeLineText({ position: 11, waitingFor: 'some-build' }), '11th to merge, waiting for build some-build'); assert.equal(live.mergeLineText(null), '');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(live.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  assert.equal(live.splitLabel('vps', 'Opus'), 'Split by Opus on the VPS'); assert.equal(live.splitLabel('vps-fable'), 'Split by Fable on the VPS'); assert.equal(live.splitLabel(''), '');
  // no pipeline view yet (the store's read does not carry one): the raw status, a plain badge, no lines
  const raw = live.buildSummary(live.buildDetail({ id: 'old', flow: 'pipeline-2', planRef: 'p1', status: 'assigning-models', steps: [] }).build);
  assert.deepEqual([raw.name, raw.state, raw.label, raw.tone, raw.raw, raw.line, raw.merge, raw.split], ['old', 'assigning-models', 'Assigning models', '', true, '', '', '']);
  assert.equal(live.buildSummary({ id: 'x', status: 'brand-new-state' }).label, 'brand-new-state', 'a status nobody knows shows as it is, and never throws');
  assert.equal(live.buildSummary(null).label, 'Unknown');
  // a rejected build: the reason and the options, each deferred step naming the build it waits for
  const c = live.clashOf({ id: 'r', clash: { reason: 'Touches files build #40 has not merged yet', with: [{ number: 40, title: 'Other build' }], options: [{ id: 'run-all', label: 'Run all now' }, { id: 'defer', steps: [{ step: 's2', uid: 'st-bbb', waitsFor: { number: 40 } }] }] } });
  assert.equal(c.rejected, true); assert.equal(c.reason, 'Touches files build #40 has not merged yet'); assert.deepEqual(c.with.map(live.refName), ['build #40']);
  assert.deepEqual(c.options.map((o) => [o.id, o.label, o.action]), [['run-all', 'Run all now', 'run-all'], ['defer', 'Run the clean steps now, defer 1 step', 'defer']]);
  assert.equal(live.deferLine(c.options[1].steps[0].waitsFor), 'Deferred, waiting for build #40');
  assert.deepEqual(live.clashOf({ clash: { reason: 'x', deferred: [{ step: 's3', waitsFor: 'other-build' }] } }).options.map((o) => [o.id, o.steps[0].step, live.deferLine(o.steps[0].waitsFor)]), [['defer', 's3', 'Deferred, waiting for build other-build']]);
  assert.equal(live.clashOf({ id: 'fine' }), null);
  assert.deepEqual(live.CLASH_ACTIONS, ['run-all', 'defer']);
});

await t('the route and the page: the build is read through the server op, drawn as a table, and refreshed by the builds event stream', () => {
  const srv = readFileSync(new URL('./server/__init__.py', import.meta.url), 'utf8');
  assert.match(srv, /@router\.get\("\/plans\/\{plan_id\}\/build"\)[\s\S]{0,900}"op": "plan-build"/);
  assert.deepEqual(srv.match(/CLASH_ACTIONS = \(([^)]*)\)/)[1].split(',').map((x) => x.trim().replace(/"/g, '')), [...live.CLASH_ACTIONS]);
  const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
  assert.ok(JSON.stringify(manifest).includes('GET /plans/{plan_id}/build'), 'the route is a plugin command (REST, MCP, CLI)');
  const panel = readFileSync(new URL('./web/build-panel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /<th[^>]*>Step ID<\/th>/, 'the step\'s unique id has its own column');
  for (const col of ['Step', 'Split', 'Model', 'Status']) assert.match(panel, new RegExp(`<th[^>]*>${col}</th>`), `column ${col}`);
  const feed = readFileSync(new URL('./web/build-feed.ts', import.meta.url), 'utf8');
  assert.match(feed, /new ES\(EVENTS_URL\)/); assert.match(feed, /'\/api\/builds\/events'/); assert.match(feed, /builds\.updated/); assert.match(feed, /\.close\(\)/, 'the stream is closed when the last panel goes');
  assert.match(feed, /visibilitychange|'focus'/, 'read again on focus');
});

rmSync(dir, { recursive: true, force: true });
console.log(`plan-studio-2 live: ${n} checks passed`);
