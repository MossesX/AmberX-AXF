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
import * as sc from './web/shots-core.mjs';
import * as gc from './web/groups-core.mjs';

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

t('screenshots core: normShot, pairs, filters, sorting, groups', () => {
  const { shot, problems } = sc.normShot({ title: ' Home ', source: 'check', pr: '#7', pair: 'BR 1', side: 'after', file: 's-1.png', extra: 1, takenAt: '2026-11-01T02:03:04.567Z' }, { now: AT });
  assert.deepEqual(problems, []); assert.equal(shot.title, 'Home'); assert.equal(shot.pr, 7); assert.equal(shot.pair, 'br-1'); assert.equal(shot.side, 'after');
  assert.equal(shot.takenAt, '2026-11-01T02:03:04Z'); assert.equal(shot.extra, 1); assert.equal(shot.$axf, 'ui-screenshot@1'); assert.match(shot.id, /^s-20261030-/);
  assert.equal(sc.normShot({ title: 'x', source: 'nope' }).shot.source, 'manual');
  assert.equal(sc.normShot({ file: 'home-phone.png' }).shot.title, 'Home');
  assert.equal(sc.normShot({ file: 'home-phone.png' }).shot.viewport, 'phone');
  assert.equal(sc.normShot({ title: 'x', side: 'after' }).shot.side, '', 'no pair, no side');
  assert.equal(sc.normShot({ title: '', pr: 'x' }).problems.length, 2); assert.equal(sc.normShot({ title: 'x', file: '../a.png' }).problems.length, 1);
  const a = { ...sc.normShot({ id: 'a', title: 'A', app: 'Breakroom', screen: '/b', source: 'check', pair: 'p', side: 'before', takenAt: '2026-10-31T10:00:00Z' }).shot };
  const b = { ...sc.normShot({ id: 'b', title: 'B', app: 'Console', source: 'pr', pair: 'p', side: 'after', viewport: 'phone', takenAt: '2026-11-01T10:00:00Z' }).shot };
  const c = { ...sc.normShot({ id: 'c', title: 'C note', source: 'manual', note: 'clock overlaps', takenAt: '2026-11-01T11:00:00Z' }).shot };
  const xs = [a, b, c];
  assert.equal(sc.sideFor([a], 'p'), 'after'); assert.equal(sc.sideFor([], 'p'), 'before'); assert.equal(sc.sideFor([a], ''), '');
  assert.deepEqual(Object.values(sc.pairOf(xs, b)).map((x) => x.id), ['a', 'b']); assert.equal(sc.pairOf(xs, c), null); assert.equal(sc.pairOf([a], a), null);
  assert.deepEqual(sc.filterShots(xs, { q: 'overlaps' }).map((x) => x.id), ['c']);
  assert.deepEqual(sc.filterShots(xs, { app: 'Breakroom' }).map((x) => x.id), ['a']);
  assert.deepEqual(sc.filterShots(xs, { viewport: 'phone' }).map((x) => x.id), ['b']);
  assert.deepEqual(sc.sortShots(xs).map((x) => x.id), ['c', 'b', 'a']); assert.deepEqual(sc.sortShots(xs, 'oldest').map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(sc.groupShots(xs, 'day').map((g) => [g.id, g.shots.length]), [['2026-11-01', 2], ['2026-10-31', 1]]);
  assert.deepEqual(sc.groupShots(xs, 'app').map((g) => g.label), ['Breakroom', 'Console', 'No app']);
  assert.deepEqual(sc.groupShots(xs, 'source').map((g) => g.label), ['Check', 'PR', 'Upload']);
  assert.equal(sc.groupShots(xs, 'none')[0].shots.length, 3);
});

t('screenshots core: migrateItems moves only "Breakroom check:" items', () => {
  const items = [
    mk({ id: 'r-1', title: 'Breakroom check: home', app: 'Breakroom', shots: ['items/r-1/home-phone.png', 'items/r-1/home-desktop.png'] }),
    mk({ id: 'r-2', title: 'Breakroom lobby' }), { id: 'pack:x', title: 'Breakroom check: pack' },
  ];
  const r = sc.migrateItems(items, { now: AT });
  assert.deepEqual(r.moved, ['r-1']); assert.deepEqual(r.keep.map((x) => x.id), ['r-2', 'pack:x']);
  assert.deepEqual(r.shots.map((x) => [x.shot.viewport, x.shot.source, x.from]), [['phone', 'check', 'items/r-1/home-phone.png'], ['desktop', 'check', 'items/r-1/home-desktop.png']]);
  assert.equal(r.shots[0].shot.migratedFrom, 'r-1'); assert.equal(r.shots[0].shot.app, 'Breakroom');
});

t('groups: auto name, same name same day reuses, next day makes a new one (console time zone)', () => {
  const at = '2026-11-01T00:20:00Z'; // Oct 31 8:20 PM in New York
  assert.equal(gc.dayKey(at), '2026-10-31'); assert.equal(gc.stamp(at), '2026-10-31 20:20');
  assert.equal(gc.autoName('breakroom-shots', at), 'breakroom-shots - 2026-10-31 20:20');
  assert.equal(gc.suggestName('Breakroom check', at), 'Breakroom check - Oct 31 8:20 PM');
  assert.equal(gc.stamp(at, 'UTC'), '2026-11-01 00:20', 'zone is a parameter');
  const a = gc.resolveGroup([], { name: 'Breakroom check', source: 'check', session: 's-1', app: 'Breakroom' }, at);
  assert.ok(a.created); assert.ok(gc.isGroupId(a.group.id)); assert.equal(a.group.$axf, 'shot-group@1'); assert.equal(a.group.session, 's-1'); assert.equal(a.group.createdAt, at);
  const b = gc.resolveGroup([a.group], { name: '  breakroom   CHECK ' }, '2026-11-01T03:59:00Z');
  assert.equal(b.created, false); assert.equal(b.group.id, a.group.id, 'case and spaces ignored, same day (still Oct 31 local)');
  assert.ok(gc.resolveGroup([a.group], { name: 'Breakroom check' }, '2026-11-01T05:00:00Z').created, 'Nov 1 local = a new group');
  const auto = gc.resolveGroup([], { session: 'sess-7', source: 'check' }, at);
  assert.equal(auto.group.name, 'sess-7 - 2026-10-31 20:20'); assert.equal(gc.resolveGroup([], { source: 'pr' }, at).group.name, 'pr - 2026-10-31 20:20');
  assert.equal(gc.resolveGroup([], {}, at).group.name, 'Screenshots - 2026-10-31 20:20');
});

t('groups: rows (count, cover, newest first), search by name / date / app / source', () => {
  const g1 = gc.normGroup({ id: 'g-20261030-aaaa', name: 'Breakroom check - Oct 30', createdAt: '2026-10-30T20:00:00Z', source: 'check', app: 'Breakroom' });
  const g2 = gc.normGroup({ id: 'g-20261101-bbbb', name: 'PR 181 before/after', createdAt: '2026-11-01T15:00:00Z', source: 'pr' });
  const g3 = gc.normGroup({ id: 'g-20261101-cccc', name: 'Empty', createdAt: '2026-11-01T16:00:00Z' });
  const shots = [{ id: 's1', group: g1.id, takenAt: '2026-10-30T20:02:00Z', app: 'Breakroom' }, { id: 's0', group: g1.id, takenAt: '2026-10-30T20:01:00Z' }, { id: 's2', group: g2.id, takenAt: '2026-11-01T15:01:00Z', app: 'Console' }];
  const rows = gc.groupRows([g1, g2, g3], shots);
  assert.deepEqual(rows.map((r) => [r.id, r.count]), [[g3.id, 0], [g2.id, 1], [g1.id, 2]]);
  assert.equal(rows[2].cover.id, 's0', 'cover = the first shot'); assert.equal(rows[0].cover, null); assert.deepEqual(rows[1].apps, ['Console']);
  const hit = (q) => rows.filter((r) => gc.matchGroup(r, q)).map((r) => r.id);
  assert.deepEqual(hit(''), rows.map((r) => r.id));
  assert.deepEqual(hit('breakroom'), [g1.id]); assert.deepEqual(hit('console'), [g2.id], 'app of a shot');
  assert.deepEqual(hit('pr'), [g2.id]); assert.deepEqual(hit('2026-10-30'), [g1.id]); assert.deepEqual(hit('oct 30'), [g1.id]);
  assert.deepEqual(hit('check oct 30'), [g1.id], 'every word must match'); assert.deepEqual(hit('nothing-here'), []);
});

t('groups: rename, merge, move; errors', () => {
  const a = gc.normGroup({ id: 'g-1-aaaa', name: 'A', createdAt: AT }), b = gc.normGroup({ id: 'g-1-bbbb', name: 'B', createdAt: AT });
  const shots = [{ id: 's1', group: a.id }, { id: 's2', group: a.id }, { id: 's3', group: b.id }];
  assert.equal(gc.renameGroup([a, b], a.id, ' Alpha ').find((g) => g.id === a.id).name, 'Alpha');
  assert.throws(() => gc.renameGroup([a, b], a.id, ' '), /name/); assert.throws(() => gc.renameGroup([a], 'g-x-zzzz', 'n'), /no such/);
  const m = gc.mergeGroups([a, b], shots, a.id, b.id);
  assert.equal(m.moved, 2); assert.deepEqual(m.groups.map((g) => g.id), [b.id]); assert.ok(m.shots.every((x) => x.group === b.id));
  assert.throws(() => gc.mergeGroups([a, b], shots, a.id, a.id), /different/); assert.throws(() => gc.mergeGroups([a], shots, a.id, b.id), /no such/);
  const mv = gc.moveShots([a, b], shots, ['s1', 's3'], b.id);
  assert.equal(mv.moved, 1, 's3 is already there'); assert.equal(mv.shots.find((x) => x.id === 's1').group, b.id); assert.equal(mv.shots.find((x) => x.id === 's2').group, a.id);
  assert.throws(() => gc.moveShots([a], shots, ['s1'], 'g-x-zzzz'), /no such/);
});

t('groups: migration puts loose shots in "<title prefix> - <their date time>" groups, once', () => {
  const loose = [
    { id: 'm2', title: 'Breakroom check: Group chat', takenAt: '2026-11-01T00:21:00Z', source: 'check', app: 'Breakroom' },
    { id: 'm1', title: 'Breakroom check: Breakroom · Home phone', takenAt: '2026-11-01T00:20:00Z', source: 'check', app: 'Breakroom' },
    { id: 'u1', title: 'My upload', takenAt: '2026-10-29T12:00:00Z', source: 'manual', session: '' },
  ];
  const r = gc.assignGroups([], loose);
  assert.deepEqual(r.made.sort(), ['Breakroom check - 2026-10-31 20:20', 'manual - 2026-10-29 08:00']);
  const bc = r.groups.find((g) => g.name.startsWith('Breakroom check'));
  assert.ok(['m1', 'm2'].every((id) => r.shots.find((x) => x.id === id).group === bc.id), 'one check session = one group');
  assert.equal(bc.app, 'Breakroom'); assert.equal(bc.createdAt, '2026-11-01T00:20:00Z', 'the group takes its first shot\'s time');
  const again = gc.assignGroups(r.groups, r.shots); assert.deepEqual(again.made, [], 'idempotent'); assert.equal(again.groups.length, 2);
});

t('shot CLI: add (local) → pair → list → promote → migrate; never in the review queue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-shots-test-'));
  const env = { ...process.env, AXF_UI_REVIEW_DIR: dir }; delete env.AXF_CONSOLE_URL; delete env.AXF_TOKEN;
  const shot = (...a) => spawnSync(process.execPath, [join(HERE, '../../../../framework/cli/shot.mjs'), ...a], { env, encoding: 'utf8' });
  const axf = (...a) => spawnSync(process.execPath, [join(HERE, '../../../../framework/cli/axf.mjs'), ...a], { env, encoding: 'utf8' });
  const img = readFileSync(join(HERE, 'packs', JSON.parse(readFileSync(join(HERE, 'packs/index.json'), 'utf8')).packs[0].files[0].src));
  const p = join(dir, 'breakroom-home-phone.png'), d = join(dir, 'breakroom-home-desktop.png'); writeFileSync(p, img); writeFileSync(d, img);
  const one = shot('--local', p, '--title', 'Breakroom home', '--app', 'Breakroom', '--screen', '/breakroom', '--source', 'check', '--session', 's-9', '--pair', 'br', '--json');
  assert.equal(one.status, 0, one.stderr);
  const a = JSON.parse(one.stdout).shots[0];
  assert.equal(a.viewport, 'phone'); assert.equal(a.side, 'before'); assert.equal(a.session, 's-9'); assert.ok(existsSync(join(dir, 'screenshots', 'files', a.file)));
  const two = axf('shot', d, '--pair', 'br', '--source', 'pr', '--json'); assert.equal(two.status, 0, two.stderr);
  const b = JSON.parse(two.stdout).shots[0]; assert.equal(b.title, 'Breakroom home'); assert.equal(b.side, 'after'); assert.equal(b.viewport, 'desktop');
  assert.equal(JSON.parse(shot('list', '--app', 'Breakroom', '--json').stdout).shots.length, 1);
  assert.ok(!existsSync(join(dir, 'items.json')), 'saving screenshots never writes the review queue');
  assert.notEqual(shot(p, '--source', 'nope').status, 0); assert.notEqual(shot(join(dir, 'nope.png')).status, 0); assert.notEqual(shot('add').status, 0); assert.match(shot().stdout, /--source/, 'no arguments = help');
  writeFileSync(join(dir, 'fake.png'), 'not a png'); assert.notEqual(shot(join(dir, 'fake.png')).status, 0, 'content is checked, not only the name');
  const pr = shot('promote', a.id, '--json'); assert.equal(pr.status, 0, pr.stderr);
  const item = JSON.parse(pr.stdout).items[0]; assert.equal(item.status, 'waiting'); assert.equal(item.fromShot, a.id);
  assert.deepEqual(item.shots.map((x) => x.src), [`items/${item.id}/breakroom-phone.png`]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'screenshots', 'index.json'), 'utf8')).shots.find((x) => x.id === a.id).promoted, [item.id]);
  // migration: a check session's items in the review queue move out
  const rev = (...x) => spawnSync(process.execPath, [join(HERE, 'review.mjs'), ...x], { env, encoding: 'utf8' });
  assert.equal(rev('submit', '--kind', 'screen', '--title', 'Breakroom check: lobby', '--app', 'Breakroom', '--shots', `${p},${d}`).status, 0);
  const mig = shot('migrate', '--json'); assert.equal(mig.status, 0, mig.stderr);
  const m = JSON.parse(mig.stdout); assert.equal(m.moved.length, 1); assert.equal(m.shots.length, 2);
  const left = JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')).items.map((x) => x.title);
  assert.deepEqual(left, ['Breakroom home'], 'only the promoted item stays in the queue');
  assert.equal(JSON.parse(shot('list', '--json').stdout).shots.length, 4);
  assert.equal(JSON.parse(shot('migrate', '--json').stdout).moved.length, 0, 'idempotent');
});

t('shot CLI: --group files shots in a named group (reused the same day), groups / group / move commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-shot-groups-test-'));
  const env = { ...process.env, AXF_UI_REVIEW_DIR: dir }; delete env.AXF_CONSOLE_URL; delete env.AXF_TOKEN;
  const shot = (...a) => { const r = spawnSync(process.execPath, [join(HERE, '../../../../framework/cli/shot.mjs'), ...a, '--json'], { env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  const img = readFileSync(join(HERE, 'packs', JSON.parse(readFileSync(join(HERE, 'packs/index.json'), 'utf8')).packs[0].files[0].src));
  const p = join(dir, 'home-phone.png'), d = join(dir, 'home-desktop.png'); writeFileSync(p, img); writeFileSync(d, img);
  const two = shot(p, d, '--title', 'Breakroom', '--group', 'Breakroom check - Oct 31 8:20 PM').shots;
  assert.equal(two.length, 2); assert.equal(two[0].group, two[1].group, 'one call = one group');
  const again = shot(p, '--group', 'breakroom check - oct 31 8:20 pm').shots[0]; assert.equal(again.group, two[0].group, 'same name today = same group');
  const auto = shot(d, '--session', 'sess-9').shots[0]; assert.notEqual(auto.group, two[0].group);
  let gs = shot('groups').groups;
  assert.equal(gs.length, 2); assert.equal(gs.find((g) => g.id === two[0].group).count, 3); assert.match(gs.find((g) => g.id === auto.group).name, /^sess-9 - \d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(shot('groups', '--q', 'sess-9').groups.length, 1);
  assert.equal(shot('group', 'rename', auto.group, 'Lobby check').group.name, 'Lobby check');
  assert.equal(shot('move', again.id, auto.group).moved, 1);
  const moved = shot('move', two[0].id, 'Brand new group'); assert.equal(moved.moved, 1);
  gs = shot('groups').groups; assert.equal(gs.length, 3);
  assert.equal(shot('group', 'merge', auto.group, two[0].group).moved, 2);
  const nu = gs.find((g) => g.name === 'Brand new group');
  const del = shot('group', 'delete', nu.id); assert.equal(del.removed.length, 1);
  gs = shot('groups').groups; assert.deepEqual(gs.map((g) => g.count), [3]);
  const kept = shot('group', 'new', 'Spare'); const del2 = shot('group', 'delete', gs[0].id, '--into', kept.group.id); assert.equal(del2.moved, 3, 'delete --into keeps the shots');
  assert.ok(shot('list').shots.every((x) => x.group === kept.group.id), 'every screenshot still has exactly one group');
});

t('shot.mjs finds its handler by capability (ui-screenshots@1), never by folder name', () => {
  const src = readFileSync(join(HERE, '../../../../framework/cli/shot.mjs'), 'utf8');
  assert.match(src, /service:ui-screenshots@1/); assert.ok(!src.includes('plugins/ui-review'));
  assert.ok(JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8')).provides.includes('service:ui-screenshots@1'));
});

console.log(`ui-review: ${n} checks ok`);
