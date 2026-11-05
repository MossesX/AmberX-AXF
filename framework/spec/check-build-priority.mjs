#!/usr/bin/env node
/* Priority tags: levels, backfill, what waits on a build, and the agent queue following priority. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as p from '../core/build-priority.mjs';
import { normBuild } from '../plan/builds-store-core.mjs';
import { mergeBuild } from '../plan/builds-merge-core.mjs';
import { applyPriority, moveUp, normState, ordered } from '../cli/agent-slots.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; };

t('levels', () => {
  for (const [a, b] of [['urgent', 'P0'], ['High', 'P1'], ['normal', 'P2'], ['LOW', 'P3'], ['p1', 'P1'], ['boss', 'P0'], ['nope', ''], ['', '']]) assert.equal(p.normPriority(a), b);
  assert.deepEqual(p.PRIORITIES.map(p.slotLevel), ['urgent', 'high', 'normal', 'low']);
  assert.ok(p.priorityRank('P0') < p.priorityRank('P3'));
  assert.equal(p.priorityRank(undefined), 2);
});

t('backfill: Normal, Urgent when marked, a stored value wins', () => {
  const e = p.effectivePriority;
  assert.equal(e({ id: 'x', title: 'Plain build' }), 'P2');
  assert.equal(e({ id: 'urgent-main-ci', title: 'CI' }), 'P0');
  assert.equal(e({ id: 'x', title: 'Hotfix: login' }), 'P0');
  assert.equal(e({ id: 'x', title: 'x', profiles: ['urgent'] }), 'P0');
  assert.equal(e({ id: 'x', title: 'x', detail: 'URGENT: the banner is down' }), 'P0');
  assert.equal(e({ id: 'x', title: 'x', detail: 'urgent\nfix it' }), 'P0');
  assert.equal(e({ id: 'x', title: 'x', detail: 'Not urgent, whenever.' }), 'P2');
  assert.equal(e({ id: 'x', title: 'x', detail: 'A tag: Urgent / High / Normal / Low' }), 'P2');
  assert.equal(e({ id: 'urgent-x', title: 'x', priority: 'P3' }), 'P3');
});

t('store: optional field, dropped when bad, survives a merge', () => {
  assert.equal(normBuild({ id: 'a', title: 'A', priority: 'P1' }).priority, 'P1');
  assert.ok(!('priority' in normBuild({ id: 'a', title: 'A' })));
  assert.ok(!('priority' in normBuild({ id: 'a', title: 'A', priority: 'soon' })));
  const a = normBuild({ id: 'a', title: 'A', priority: 'P1', updatedAt: '2026-11-05T01:00:00Z' });
  const b = normBuild({ id: 'a', title: 'A', updatedAt: '2026-11-05T02:00:00Z' });
  assert.equal(mergeBuild(a, b).priority, 'P1');
});

t('waitingOn: every source, tappable, finished builds left out', () => {
  const builds = [
    { id: 'skins', title: 'Skins', status: 'running', branch: 'claude/skins', pr: '#40', planRef: 'x.skins' },
    { id: 'themes', title: 'Themes', status: 'pending', queue: { deps: ['x.skins'] } },
    { id: 'old', title: 'Old', status: 'complete', queue: { deps: ['skins'] } },
    { id: 'gone', title: 'Gone', status: 'pending', deleted: true, queue: { deps: ['skins'] } },
  ];
  const sources = {
    builds,
    slots: { running: [{ id: 'r', name: 'skins', state: 'running' }], queue: [{ id: 'hl-1', name: 'next-one' }] },
    epics: [{ id: 'x.layouts', title: 'Layouts', dependsOn: ['x.skins'] }],
    mergeQueue: { items: [{ pr: 39, title: 'Ahead' }, { pr: 40, title: 'Skins', build: 'skins' }, { pr: 41, title: 'Behind', url: 'https://x/41' }] },
    pulls: [{ number: 50, title: 'Stacked', base: 'claude/skins', url: 'https://x/50' }, { number: 51, title: 'Other', base: 'claude/else' }],
    ui: [{ id: 'u1', name: 'Skin shots', build: 'skins', status: 'waiting' }, { id: 'u2', name: 'Done', build: 'skins', status: 'approved' }],
    plans: [{ id: 'skins-plan', title: 'Skins plan', build: { id: 'skins' } }],
  };
  const rows = p.waitingOn('skins', sources);
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}`).sort(), ['build:themes', 'build:x.layouts', 'plan:skins-plan', 'pr:#41', 'pr:#50', 'slot:hl-1', 'ui:u1'].sort());
  for (const r of rows) assert.ok(r.route || r.url, `${r.id} opens something`);
  assert.deepEqual(p.waitingOn('themes', sources), []);
  const map = p.priorityMap(sources);
  assert.equal(map.skins.waiting, 7);
  assert.equal(map['x.skins'].id, 'skins'); // a screen that knows it by its plan epic
  assert.ok(!map.gone);
});

t('slots behind: only what is behind it when it is itself waiting', () => {
  const slots = { running: [], queue: [{ id: 'a', name: 'first' }, { id: 'b', name: 'mine', build: 'mine' }, { id: 'c', name: 'last' }] };
  assert.deepEqual(p.waitingOn('mine', { builds: [{ id: 'mine', title: 'M' }], slots }).map((r) => r.id), ['c']);
});

t('resolveBuild: id, spoken name, open first', () => {
  const b = [{ id: 'banner-widgets', title: 'Banner widgets', status: 'complete' }, { id: 'skins-v2', title: 'New skins', status: 'pending' }, { id: 'skins-old', title: 'Old skins', status: 'complete' }];
  assert.equal(p.resolveBuild(b, 'banner widgets').id, 'banner-widgets');
  assert.equal(p.resolveBuild(b, 'skins').id, 'skins-v2');
  assert.equal(p.resolveBuild(b, 'nothing'), null);
});

t('agent-slots: higher starts first, same level is FIFO, Move up wins', () => {
  const q = (id, priority, seq, build) => ({ id, name: id, priority, seq, state: 'waiting', build });
  const st = normState({ queue: [q('a', 'normal', 1), q('b', 'normal', 2, 'bb'), q('c', 'low', 3, 'cc')] });
  assert.deepEqual(ordered(st.queue).map((x) => x.id), ['a', 'b', 'c']);
  assert.equal(applyPriority(st, 'cc', 'high'), 1);
  assert.deepEqual(ordered(st.queue).map((x) => x.id), ['c', 'a', 'b']);
  moveUp(st, 'a'); // past c, by hand
  assert.deepEqual(ordered(st.queue).map((x) => x.id), ['a', 'c', 'b']);
  assert.equal(st.queue.find((x) => x.id === 'a').moved, true);
  assert.equal(applyPriority(st, 'a', 'low'), 0); // the build's priority doesn't undo his move
  assert.deepEqual(ordered(st.queue).map((x) => x.id), ['a', 'c', 'b']);
  assert.throws(() => applyPriority(st, 'a', 'soon'));
});

// set through the real store, in a scratch copy
const dir = mkdtempSync(join(tmpdir(), 'axf-priority-'));
process.env.AXF_BUILDS_STORE = join(dir, 'store.json');
process.env.AXF_BUILDS_LIVE = '0';
process.env.AXF_SLOTS_DIR = join(dir, 'slots');
writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify({ $axf: 'builds@1', rev: 1, builds: [normBuild({ id: 'banner-widgets', title: 'Banner widgets', profiles: ['current'] }), normBuild({ id: 'other', title: 'Other', profiles: ['angel'] })], meta: { queue: {}, pending: {} }, rules: {}, drafts: {} }));
const { setPriority, gather } = await import('../cli/build-priority.mjs');
const { loadStore, journalDir } = await import('../cli/builds-store.mjs');
const r = setPriority(['banner widgets', 'other'], 'urgent', 'test');
assert.deepEqual(r.ids, ['banner-widgets', 'other']);
const store = loadStore();
assert.deepEqual(store.builds.map((b) => b.priority), ['P0', 'P0']);
assert.ok(store.builds.every((b) => b.rev === 2));
assert.ok(journalDir());
assert.throws(() => setPriority(['other'], 'soon'), /unknown priority/);
assert.throws(() => setPriority(['nobody'], 'low'), /no build/);
assert.equal(p.priorityMap(gather()).other.priority, 'P0');
n++;
rmSync(dir, { recursive: true, force: true });
console.log(`✓ build priority — ${n} checks`);
