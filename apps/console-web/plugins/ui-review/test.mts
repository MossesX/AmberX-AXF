// @ts-nocheck: a Node test, not part of the console's build
/**
 * UI Review self-test: the pure core (kinds registry, items, decisions, filters, sorting, grouping, tree, selection,
 * picks, ui-review@1 state), the shipped design packs, and the review.mjs CLI end to end in a scratch data folder.
 *   node --experimental-strip-types apps/console-web/plugins/ui-review/test.mts   (or npx -y tsx …)
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/review-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0; const t = (name: string, f: () => void) => { try { f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const AT = '2026-10-30T12:00:00Z';
const mk = (o) => core.normItem({ kind: 'screen', title: 'T', ...o }, { now: o.submittedAt ?? AT }).item;

t('kinds: registry order, data-folder extras override, unlisted kinds get a section', () => {
  const base = JSON.parse(readFileSync(join(HERE, 'kinds.json'), 'utf8')).kinds;
  assert.deepEqual(base.map((k) => k.id), ['design-pack', 'app', 'screen', 'settings', 'dialog', 'menu', 'banner', 'other']);
  const k = core.mergeKinds(base, [{ id: 'screen', label: 'Pages' }, { id: 'home-card', label: 'Home cards', order: 75 }, { id: 'BAD id' }], [{ kind: 'walkthrough' }, { kind: 'screen' }]);
  assert.equal(k.find((x) => x.id === 'screen').label, 'Pages');
  assert.equal(k.find((x) => x.id === 'screen').icon, 'monitor', 'override keeps the base fields');
  assert.ok(k.findIndex((x) => x.id === 'home-card') < k.findIndex((x) => x.id === 'other'));
  const w = k.find((x) => x.id === 'walkthrough'); assert.equal(w.label, 'Walkthrough'); assert.ok(w.unlisted);
  assert.ok(!k.some((x) => x.id === 'BAD id'));
});

t('normItem: cleans, defaults, keeps unknown fields, reports problems', () => {
  const { item, problems } = core.normItem({ kind: 'settings', title: '  Level bar ', pr: '#175', shots: ['x/settings-phone.png', { src: 'y/home-desktop.png', name: 'Home' }], extra: 1, by: 'opus' }, { now: AT });
  assert.deepEqual(problems, []);
  assert.equal(item.title, 'Level bar'); assert.equal(item.pr, 175); assert.equal(item.status, 'waiting'); assert.equal(item.extra, 1);
  assert.deepEqual(item.shots.map((s) => [s.device, s.name]), [['phone', 'Settings'], ['desktop', 'Home']]);
  assert.equal(item.history[0].by, 'opus'); assert.equal(item.history[0].action, 'submitted'); assert.ok(!('by' in item));
  assert.match(item.id, /^r-20261030-/);
  assert.deepEqual(core.normItem({ kind: 'Bad Kind', pr: 'x' }).problems.length, 3);
});

t('decide + bulk: status, comment, history; unknown decision throws', () => {
  const a = mk({ id: 'a' }); const b = mk({ id: 'b' });
  const d = core.decide(a, 'changes', { comment: 'tighter rows', at: AT });
  assert.equal(d.status, 'changes'); assert.equal(d.comment, 'tighter rows'); assert.equal(d.history.at(-1).action, 'changes');
  assert.equal(core.decide(d, 'approve', { at: AT }).comment, '', 'a new decision without a comment clears the old one');
  assert.throws(() => core.decide(a, 'maybe'));
  const r = core.bulkDecide([a, b], ['a', 'b', 'zz'], 'reject', { at: AT });
  assert.deepEqual(r.changed, ['a', 'b']); assert.deepEqual(r.missing, ['zz']); assert.ok(r.items.every((x) => x.status === 'rejected'));
});

const items = [
  mk({ id: 'w1', title: 'Settings bar', kind: 'settings', app: 'Console', branch: 'claude/x', pr: 9, submittedAt: '2026-10-29T10:00:00Z' }),
  mk({ id: 'a1', title: 'Alpha menu', kind: 'menu', app: 'AmberX', status: 'approved', submittedAt: '2026-10-30T10:00:00Z' }),
  mk({ id: 'c1', title: 'Card', kind: 'banner', app: 'Console', status: 'changes', branch: 'claude/x', submittedAt: '2026-10-28T10:00:00Z' }),
  mk({ id: 'w2', title: 'Zed page', kind: 'screen', app: '', submittedAt: '2026-10-30T11:00:00Z' }),
];

t('filters + search', () => {
  assert.deepEqual(core.filterItems(items, { kind: 'settings' }).map((x) => x.id), ['w1']);
  assert.deepEqual(core.filterItems(items, { status: 'open' }).map((x) => x.id), ['w1', 'c1', 'w2']);
  assert.deepEqual(core.filterItems(items, { app: 'Console', q: 'card changes' }).map((x) => x.id), ['c1']);
  assert.deepEqual(core.filterItems(items, { q: '#9' }).map((x) => x.id), ['w1']);
  assert.deepEqual(core.filterItems(items, { pr: 9 }).map((x) => x.id), ['w1']);
});

t('sort: waiting first (newest within), newest, title, app', () => {
  assert.deepEqual(core.sortItems(items).map((x) => x.id), ['w2', 'w1', 'c1', 'a1']);
  assert.deepEqual(core.sortItems(items, 'newest').map((x) => x.id), ['w2', 'a1', 'w1', 'c1']);
  assert.deepEqual(core.sortItems(items, 'title').map((x) => x.id), ['a1', 'c1', 'w1', 'w2']);
  assert.equal(core.sortItems(items, 'app').at(-1).id, 'w2', 'no app sorts last');
});

t('counts, groups (sub-grids), tree', () => {
  const c = core.counts(items);
  assert.deepEqual(c[''], { total: 4, waiting: 2, changes: 1, rejected: 0, approved: 1 });
  assert.equal(c.settings.waiting, 1);
  const kinds = core.mergeKinds(JSON.parse(readFileSync(join(HERE, 'kinds.json'), 'utf8')).kinds);
  assert.deepEqual(core.groupItems(items, 'kind', kinds).map((g) => g.id), ['screen', 'settings', 'menu', 'banner'], 'registry order');
  assert.deepEqual(core.groupItems(items, 'app').map((g) => g.label), ['AmberX', 'Console', 'No app']);
  assert.deepEqual(core.groupItems(items, 'status').map((g) => g.id), ['waiting', 'changes', 'approved']);
  assert.deepEqual(core.groupItems(items, 'build').map((g) => g.label), ['claude/x', 'No build']);
  const tr = core.tree(items, kinds);
  assert.equal(tr.length, 4); assert.equal(tr[1].apps[0].label, 'Console'); assert.equal(tr[1].apps[0].items[0].id, 'w1');
});

t('selection helpers', () => {
  assert.deepEqual(core.toggleId(['a'], 'b'), ['a', 'b']); assert.deepEqual(core.toggleId(['a', 'b'], 'a'), ['b']);
  assert.equal(core.groupChecked(['a'], ['a', 'b']), 'some'); assert.equal(core.groupChecked(['a', 'b'], ['a', 'b']), 'all'); assert.equal(core.groupChecked([], ['a']), 'none');
  assert.deepEqual(core.setGroup(['x'], ['a', 'b'], true).sort(), ['a', 'b', 'x']); assert.deepEqual(core.setGroup(['a', 'x'], ['a', 'b'], false), ['x']);
});

t('design packs: picks stay at 3, packs become items with overlays', () => {
  assert.equal(core.MAX_PICKS, 3);
  let p = core.togglePick([], 'a').picked; p = core.togglePick(p, 'b').picked; p = core.togglePick(p, 'c').picked;
  const full = core.togglePick(p, 'd'); assert.deepEqual(full.picked, ['a', 'b', 'c']); assert.match(full.error, /pick 3/);
  assert.deepEqual(core.togglePick(p, 'b').picked, ['a', 'c']);
  const ix = JSON.parse(readFileSync(join(HERE, 'packs/index.json'), 'utf8'));
  assert.equal(ix.packs.length, 18);
  const ids = new Set();
  for (const pk of ix.packs) {
    assert.match(pk.id, /^[a-z0-9][a-z0-9-]{0,60}$/); assert.ok(!ids.has(pk.id)); ids.add(pk.id);
    assert.equal(pk.files.length, 12, `${pk.id} has 12 shots`);
    for (const f of pk.files) { assert.match(f.src, /^r\d{1,3}\/[a-z0-9][a-z0-9-]{0,120}\.(png|jpg|jpeg|webp)$/); assert.ok(existsSync(join(HERE, 'packs', f.src)), `missing ${f.src}`); }
  }
  const pi = core.packItems(ix, { [`pack:${ix.packs[0].id}`]: { status: 'approved', comment: 'yes' } });
  assert.equal(pi.length, 18); assert.ok(pi.every((x) => x.kind === core.DESIGN_KIND && x.shots.length === 12));
  assert.equal(pi[0].status, 'approved'); assert.equal(pi[1].status, 'waiting'); assert.equal(pi[0].pack.id, ix.packs[0].id);
});

t('ui-review@1 state: strictest wins, holds unless approved / none', () => {
  assert.equal(core.reviewState(items, { branch: 'claude/x' }).state, 'changes');
  assert.equal(core.reviewState(items, { pr: 9 }).state, 'waiting');
  assert.equal(core.reviewState(items, { pr: 9 }).holds, true);
  const s = core.reviewState(items, { branch: 'nope' }); assert.equal(s.state, 'none'); assert.equal(s.holds, false);
  const ok = core.reviewState([core.decide(items[0], 'approve')], { pr: 9 }); assert.equal(ok.state, 'approved'); assert.equal(ok.holds, false);
  assert.equal(core.reviewState([...items, mk({ id: 'r', branch: 'claude/x', status: 'rejected' })], { branch: 'claude/x' }).state, 'rejected');
});

t('CLI: submit → list → state (exit 3) → decide → state, kinds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-review-test-'));
  const env = { ...process.env, AXF_UI_REVIEW_DIR: dir }; delete env.AXF_CONSOLE_URL;
  const cli = (...a) => spawnSync(process.execPath, [join(HERE, 'review.mjs'), ...a], { env, encoding: 'utf8' });
  const shotA = join(dir, 'home-phone.png'), shotB = join(dir, 'home-desktop.png');
  writeFileSync(shotA, readFileSync(join(HERE, 'packs', JSON.parse(readFileSync(join(HERE, 'packs/index.json'), 'utf8')).packs[0].files[0].src))); writeFileSync(shotB, readFileSync(shotA));
  const sub = cli('submit', '--kind', 'settings', '--title', 'Level bar', '--app', 'Console', '--branch', 'claude/t', '--pr', '42', '--shots', `${shotA},${shotB}`, '--json');
  assert.equal(sub.status, 0, sub.stderr);
  const item = JSON.parse(sub.stdout).item;
  assert.deepEqual(item.shots.map((s) => s.device), ['phone', 'desktop']); assert.ok(existsSync(join(dir, 'shots', item.id, 'home-phone.png')));
  assert.equal(JSON.parse(cli('list', '--status', 'waiting', '--json').stdout).items.length, 1);
  const held = cli('state', '--pr', '42', '--exit-code'); assert.equal(held.status, 3); assert.match(held.stdout, /waiting \(holds the merge\)/);
  assert.equal(cli('decide', item.id, 'approve', '--comment', 'good').status, 0);
  const st = JSON.parse(cli('state', '--branch', 'claude/t', '--json', '--exit-code').stdout); assert.equal(st.state, 'approved');
  assert.equal(cli('state', '--branch', 'claude/t', '--exit-code').status, 0);
  assert.equal(cli('decide', 'pack:graphite-pro', 'changes').status, 0, 'a design pack can be decided too');
  const doc = JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8'));
  assert.equal(doc.items.find((x) => x.id === 'pack:graphite-pro').status, 'changes');
  assert.equal(doc.items.find((x) => x.id === item.id).history.at(-1).comment, 'good');
  assert.notEqual(cli('submit', '--kind', 'Bad Kind', '--title', 'x').status, 0);
  assert.notEqual(cli('submit', '--title', 'x', '--shots', join(dir, 'nope.png')).status, 0);
  assert.match(execFileSync(process.execPath, [join(HERE, 'review.mjs'), 'kinds'], { env, encoding: 'utf8' }), /design-pack\s+Design packs/);
});

t('rebuild-shots has the --submit option, found by capability', () => {
  const src = readFileSync(join(HERE, '../../../../framework/cli/rebuild-shots.mjs'), 'utf8');
  assert.match(src, /args\.submit/); assert.match(src, /service:ui-review@1/); assert.ok(!src.includes('plugins/ui-review'), 'never by folder name');
  const pj = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8')); assert.ok(pj.provides.includes('service:ui-review@1'));
});

console.log(`ui-review: ${n} checks ok`);
