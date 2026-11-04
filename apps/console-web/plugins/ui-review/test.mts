// @ts-nocheck: a Node test, not part of the console's build
/**
 * UI Review self-test: the pure core (kinds registry, items, decisions, filters, sorting, grouping, tree, selection,
 * picks, ui-review@1 state), the shipped design packs, and the review.mjs CLI end to end in a scratch data folder.
 *   node --experimental-strip-types apps/console-web/plugins/ui-review/test.mts   (or npx -y tsx …)
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/review-core.mjs';
import * as sc from './web/shots-core.mjs';
import * as gc from './web/groups-core.mjs';
import * as cf from './web/conform.mjs';
import { caller, fieldsOf } from './review.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0; const t = (name: string, f: () => void) => { try { f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const AT = '2026-10-30T12:00:00Z';
/** A child env with no Claude session in it (so CI and a Claude Code run behave the same), + the data folder. */
const cleanEnv = (dir) => { const e = { ...process.env, AXF_UI_REVIEW_DIR: dir }; for (const k of ['AXF_CONSOLE_URL', 'AXF_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ATTENDED', 'AXF_SESSION']) delete e[k]; return e; };
const WHO = ['--source', 'headless', '--by', 'build:claude/t'];
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
  assert.deepEqual(core.normItem({ kind: 'Bad Kind', pr: 'x' }).problems.length, 2, 'a missing name is the schema\'s to refuse (conform.mjs)');
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
  const gs = core.packGroups(ix);
  for (const x of pi) assert.deepEqual(cf.reviewToStored(x, gs).errors, [], `${x.id} is a valid ui-review-item@1`);
  for (const g of gs) assert.deepEqual(cf.schema.validateGroup(g).errors, []);
});

t('conform: working records ↔ ui-review-item@1, both ways', () => {
  const groups = [{ $axf: 'ui-review-group@1', id: 'g-20261101-aaaa', name: 'Level pass', createdAt: AT, source: 'headless' }];
  const w = { ...mk({ id: 'r-1', title: 'Level bar', kind: 'settings', app: 'Console', screen: 'Settings', source: 'headless', submittedBy: 'build:claude/t', shots: ['a-phone.png'], build: 'b1', step: 's2', pr: 4 }), group: 'g-20261101-aaaa' };
  const r = cf.reviewToStored(w, groups);
  assert.deepEqual(r.errors, []);
  assert.equal(r.item.name, 'Level bar'); assert.equal(r.item.kind, 'review'); assert.equal(r.item.section, 'settings'); assert.equal(r.item.status, 'pending');
  assert.deepEqual(r.item.group, { id: 'g-20261101-aaaa', name: 'Level pass' }); assert.deepEqual(r.item.build, { id: 'b1', step: 's2' }); assert.equal(r.item.viewport, 'phone');
  const back = cf.storedToReview(r.item);
  assert.equal(back.title, 'Level bar'); assert.equal(back.kind, 'settings'); assert.equal(back.status, 'waiting'); assert.equal(back.group, 'g-20261101-aaaa'); assert.equal(back.shots[0].device, 'phone');
  assert.deepEqual(cf.reviewToStored(back, groups).item, r.item, 'round trip is stable');
  const missing = cf.reviewToStored({ ...w, title: '', screen: '' }, groups).errors.map((e) => e.field);
  assert.deepEqual(missing, ['name', 'screen']);
  const sh = { ...sc.normShot({ id: 's-1', title: 'Home', app: 'Breakroom', screen: '/b', source: 'watch-live', session: 'sess-1', file: 's-1.png', viewport: 'phone', pair: 'p', side: 'after', takenAt: AT }).shot, group: 'g-20261101-aaaa' };
  const sr = cf.shotToStored(sh, groups);
  assert.deepEqual(sr.errors, []); assert.equal(sr.item.kind, 'screenshot'); assert.ok(!('status' in sr.item)); assert.deepEqual(sr.item.files.after, [{ src: 's-1.png', viewport: 'phone' }]);
  assert.deepEqual(sr.item.submittedBy, { type: 'session', id: 'sess-1' }); assert.equal(sr.item.pairId, 'p');
  const sb = cf.storedToShot(sr.item); assert.equal(sb.title, 'Home'); assert.equal(sb.file, 's-1.png'); assert.equal(sb.group, 'g-20261101-aaaa'); assert.equal(sb.pair, 'p'); assert.equal(sb.takenAt, AT);
  assert.deepEqual(cf.shotToStored(sb, groups).item, sr.item, 'round trip is stable');
});

t('caller: source + sender from the Claude Code session, never guessed', () => {
  assert.deepEqual(caller({}), { source: '', submittedBy: undefined, session: '' });
  assert.deepEqual(caller({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'abcdef123456' }), { source: 'claude-code', submittedBy: { type: 'session', id: 'abcdef123456' }, session: 'session abcdef12' });
  assert.deepEqual(caller({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_SESSION_ATTENDED: '0' }, 'claude/review-schema'), { source: 'headless', submittedBy: { type: 'build', id: 'claude/review-schema' }, session: 'claude/review-schema' });
  const f = fieldsOf({ name: 'N', app: 'A', screen: 'S', source: 'manual', by: 'user:brett' }, {});
  assert.equal(f.title, 'N'); assert.equal(f.source, 'manual'); assert.equal(f.submittedBy, 'user:brett');
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
  const env = cleanEnv(dir);
  const cli = (...a) => spawnSync(process.execPath, [join(HERE, 'review.mjs'), ...a], { env, encoding: 'utf8' });
  const shotA = join(dir, 'home-phone.png'), shotB = join(dir, 'home-desktop.png');
  writeFileSync(shotA, readFileSync(join(HERE, 'packs', JSON.parse(readFileSync(join(HERE, 'packs/index.json'), 'utf8')).packs[0].files[0].src))); writeFileSync(shotB, readFileSync(shotA));
  // refused without a name, a screen, or someone sending it (no Claude session in this env): the field is named
  for (const [drop, field] of [['--title', 'name'], ['--screen', 'screen'], ['--source', 'source']]) {
    const a = ['submit', '--kind', 'settings', '--title', 'Level bar', '--app', 'Console', '--screen', 'Settings', ...WHO, '--shots', shotA];
    const i = a.indexOf(drop); a.splice(i, 2);
    const r = cli(...a); assert.equal(r.status, 2); assert.match(r.stderr, new RegExp(`ui-review-item@1 rejected: .*${field} is missing`));
  }
  assert.ok(!existsSync(join(dir, 'items.json')) && !existsSync(join(dir, 'shots')), 'a refused submit writes nothing');
  const sub = cli('submit', '--kind', 'settings', '--name', 'Level bar', '--app', 'Console', '--screen', 'Settings', '--group', 'Level pass', '--branch', 'claude/t', '--pr', '42', ...WHO, '--shots', `${shotA},${shotB}`, '--json');
  assert.equal(sub.status, 0, sub.stderr);
  const item = JSON.parse(sub.stdout).item;
  assert.equal(item.$axf, 'ui-review-item@1'); assert.equal(item.group.name, 'Level pass'); assert.match(item.createdAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(item.files.after.map((s) => s.viewport), ['phone', 'desktop']); assert.ok(existsSync(join(dir, 'shots', item.id, 'home-phone.png')));
  // a Claude Code session is detected: source + sender filled from it
  const viaSession = spawnSync(process.execPath, [join(HERE, 'review.mjs'), 'submit', '--name', 'From a session', '--app', 'Console', '--screen', 'Home', '--shots', shotA, '--json'], { env: { ...env, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'sess-abc' }, encoding: 'utf8' });
  assert.equal(viaSession.status, 0, viaSession.stderr);
  const vs = JSON.parse(viaSession.stdout).item; assert.equal(vs.source, 'claude-code'); assert.deepEqual(vs.submittedBy, { type: 'session', id: 'sess-abc' }); assert.match(vs.group.name, /^session sess-abc - /);
  assert.equal(JSON.parse(cli('list', '--status', 'waiting', '--json').stdout).items.length, 2);
  assert.match(cli('check').stdout, /all ui-review-item@1/);
  const held = cli('state', '--pr', '42', '--exit-code'); assert.equal(held.status, 3); assert.match(held.stdout, /waiting \(holds the merge\)/);
  assert.equal(cli('decide', item.id, 'approve', '--comment', 'good').status, 0);
  const st = JSON.parse(cli('state', '--branch', 'claude/t', '--json', '--exit-code').stdout); assert.equal(st.state, 'approved');
  assert.equal(cli('state', '--branch', 'claude/t', '--exit-code').status, 0);
  assert.equal(cli('decide', 'pack:graphite-pro', 'changes').status, 0, 'a design pack can be decided too');
  const doc = JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8'));
  assert.equal(doc.packDecisions['pack:graphite-pro'].status, 'changes');
  assert.equal(doc.items.find((x) => x.id === item.id).history.at(-1).comment, 'good'); assert.equal(doc.items.find((x) => x.id === item.id).status, 'approved');
  assert.deepEqual(cf.storeErrors(doc.items, doc.groups), [], 'items.json is all ui-review-item@1');
  assert.notEqual(cli('submit', '--kind', 'Bad Kind', '--title', 'x').status, 0);
  assert.notEqual(cli('submit', '--title', 'x', '--shots', join(dir, 'nope.png')).status, 0);
  assert.notEqual(cli('submit', '--name', 'r-20261101-ab12', '--app', 'A', '--screen', 'S', ...WHO, '--shots', shotA).status, 0, 'an id is not a human name');
  assert.match(execFileSync(process.execPath, [join(HERE, 'review.mjs'), 'kinds'], { env, encoding: 'utf8' }), /design-pack\s+Design packs/);
});

t('rebuild-shots has the --submit option, found by capability', () => {
  const src = readFileSync(join(HERE, '../../../../framework/cli/rebuild-shots.mjs'), 'utf8');
  assert.match(src, /args\.submit/); assert.match(src, /service:ui-review@1/); assert.ok(!src.includes('plugins/ui-review'), 'never by folder name');
  const pj = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8')); assert.ok(pj.provides.includes('service:ui-review@1'));
});

t('screenshots core: normShot, pairs, filters, sorting, groups', () => {
  const { shot, problems } = sc.normShot({ title: ' Home ', source: 'claude-code', pr: '#7', pair: 'BR 1', side: 'after', file: 's-1.png', extra: 1, takenAt: '2026-11-01T02:03:04.567Z' }, { now: AT });
  assert.deepEqual(problems, []); assert.equal(shot.title, 'Home'); assert.equal(shot.pr, 7); assert.equal(shot.pair, 'br-1'); assert.equal(shot.side, 'after');
  assert.equal(shot.takenAt, '2026-11-01T02:03:04Z'); assert.equal(shot.extra, 1); assert.equal(shot.$axf, 'ui-screenshot@1'); assert.match(shot.id, /^s-20261030-/);
  assert.equal(sc.normShot({ title: 'x', source: 'nope' }).shot.source, 'nope', 'kept as sent: ui-review-item@1 refuses it');
  assert.equal(sc.normShot({ file: 'home-phone.png' }).shot.title, '', 'no name from the file name (the schema refuses a missing one)');
  assert.equal(sc.normShot({ file: 'home-phone.png' }).shot.viewport, 'phone');
  assert.equal(sc.normShot({ title: 'x', side: 'after' }).shot.side, '', 'no pair, no side');
  assert.equal(sc.normShot({ title: '', pr: 'x' }).problems.length, 1); assert.equal(sc.normShot({ title: 'x', file: '../a.png' }).problems.length, 1);
  const a = { ...sc.normShot({ id: 'a', title: 'A', app: 'Breakroom', screen: '/b', source: 'claude-code', pair: 'p', side: 'before', takenAt: '2026-10-31T10:00:00Z' }).shot };
  const b = { ...sc.normShot({ id: 'b', title: 'B', app: 'Console', source: 'headless', pair: 'p', side: 'after', viewport: 'phone', takenAt: '2026-11-01T10:00:00Z' }).shot };
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
  assert.deepEqual(sc.groupShots(xs, 'source').map((g) => g.label), ['Claude Code', 'Headless build', 'Upload']);
  assert.deepEqual(sc.SOURCE_IDS, cf.schema.REGISTRY.sources, 'Screenshots uses the schema\'s sources');
  assert.equal(sc.groupShots(xs, 'none')[0].shots.length, 3);
});

t('screenshots core: migrateItems moves only "Breakroom check:" items', () => {
  const items = [
    mk({ id: 'r-1', title: 'Breakroom check: home', app: 'Breakroom', shots: ['items/r-1/home-phone.png', 'items/r-1/home-desktop.png'] }),
    mk({ id: 'r-2', title: 'Breakroom lobby' }), { id: 'pack:x', title: 'Breakroom check: pack' },
  ];
  const r = sc.migrateItems(items, { now: AT });
  assert.deepEqual(r.moved, ['r-1']); assert.deepEqual(r.keep.map((x) => x.id), ['r-2', 'pack:x']);
  assert.deepEqual(r.shots.map((x) => [x.shot.viewport, x.shot.source, x.from]), [['phone', 'claude-code', 'items/r-1/home-phone.png'], ['desktop', 'claude-code', 'items/r-1/home-desktop.png']]);
  assert.equal(r.shots[0].shot.migratedFrom, 'r-1'); assert.equal(r.shots[0].shot.app, 'Breakroom');
});

t('groups: auto name, same name same day reuses, next day makes a new one (console time zone)', () => {
  const at = '2026-11-01T00:20:00Z'; // Oct 31 8:20 PM in New York
  assert.equal(gc.dayKey(at), '2026-10-31'); assert.equal(gc.stamp(at), '2026-10-31 20:20');
  assert.equal(gc.autoName('breakroom-shots', at), 'breakroom-shots - 2026-10-31 20:20');
  assert.equal(gc.suggestName('Breakroom check', at), 'Breakroom check - Oct 31 8:20 PM');
  assert.equal(gc.stamp(at, 'UTC'), '2026-11-01 00:20', 'zone is a parameter');
  const a = gc.resolveGroup([], { name: 'Breakroom check', source: 'check', session: 's-1', app: 'Breakroom' }, at);
  assert.ok(a.created); assert.ok(gc.isGroupId(a.group.id)); assert.equal(a.group.$axf, 'ui-review-group@1'); assert.equal(a.group.session, 's-1'); assert.equal(a.group.createdAt, at);
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

t('shot CLI: refuses without a name / app / screen / source; add (local) → pair → list → promote; never in the review queue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-shots-test-'));
  const env = cleanEnv(dir);
  const shot = (...a) => spawnSync(process.execPath, [join(HERE, '../../../../framework/cli/shot.mjs'), ...a], { env, encoding: 'utf8' });
  const axf = (...a) => spawnSync(process.execPath, [join(HERE, '../../../../framework/cli/axf.mjs'), ...a], { env, encoding: 'utf8' });
  const img = readFileSync(join(HERE, 'packs', JSON.parse(readFileSync(join(HERE, 'packs/index.json'), 'utf8')).packs[0].files[0].src));
  const p = join(dir, 'breakroom-home-phone.png'), d = join(dir, 'breakroom-home-desktop.png'); writeFileSync(p, img); writeFileSync(d, img);
  for (const [drop, field] of [['--title', 'name'], ['--app', 'app'], ['--screen', 'screen'], ['--source', 'source']]) {
    const a = ['--local', p, '--title', 'Breakroom home', '--app', 'Breakroom', '--screen', '/breakroom', '--source', 'claude-code', '--session', 's-9'];
    a.splice(a.indexOf(drop), 2);
    const r = shot(...a); assert.equal(r.status, 2, `without ${drop}`); assert.match(r.stderr, new RegExp(`${field} is missing`));
  }
  assert.ok(!existsSync(join(dir, 'screenshots')), 'a refused screenshot writes nothing, not even a group');
  const one = shot('--local', p, '--title', 'Breakroom home', '--app', 'Breakroom', '--screen', '/breakroom', '--source', 'claude-code', '--session', 's-9', '--pair', 'br', '--json');
  assert.equal(one.status, 0, one.stderr);
  const a = JSON.parse(one.stdout).shots[0];
  assert.equal(a.$axf, 'ui-review-item@1'); assert.equal(a.kind, 'screenshot'); assert.equal(a.viewport, 'phone'); assert.equal(a.side, 'before'); assert.deepEqual(a.submittedBy, { type: 'session', id: 's-9' });
  assert.ok(existsSync(join(dir, 'screenshots', 'files', a.files.after[0].src)));
  const two = axf('shot', d, '--name', 'Breakroom home', '--app', 'Breakroom', '--screen', '/breakroom', '--pair', 'br', '--source', 'headless', '--build', 'claude/shots', '--json'); assert.equal(two.status, 0, two.stderr);
  const b = JSON.parse(two.stdout).shots[0]; assert.equal(b.name, 'Breakroom home'); assert.equal(b.side, 'after'); assert.equal(b.viewport, 'desktop'); assert.deepEqual(b.submittedBy, { type: 'build', id: 'claude/shots' });
  assert.equal(JSON.parse(shot('list', '--app', 'Breakroom', '--json').stdout).shots.length, 2);
  assert.ok(!existsSync(join(dir, 'items.json')), 'saving screenshots never writes the review queue');
  assert.notEqual(shot(p, '--source', 'nope').status, 0); assert.notEqual(shot(join(dir, 'nope.png')).status, 0); assert.notEqual(shot('add').status, 0); assert.match(shot().stdout, /--source/, 'no arguments = help');
  writeFileSync(join(dir, 'fake.png'), 'not a png'); assert.notEqual(shot(join(dir, 'fake.png'), '--name', 'Fake one', '--app', 'A', '--screen', 'S', '--source', 'manual', '--by', 'user:brett').status, 0, 'content is checked, not only the name');
  const pr = shot('promote', a.id, '--json'); assert.equal(pr.status, 0, pr.stderr);
  const item = JSON.parse(pr.stdout).items[0]; assert.equal(item.status, 'pending'); assert.equal(item.fromShot, a.id); assert.equal(item.screen, '/breakroom');
  assert.equal(item.group.name, a.group.name, 'promoted into a queue group named like its screenshot group');
  assert.deepEqual(item.files.after.map((x) => x.src), [`items/${item.id}/breakroom-phone.png`]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'screenshots', 'index.json'), 'utf8')).shots.find((x) => x.id === a.id).promoted, [item.id]);
  const rev = (...x) => spawnSync(process.execPath, [join(HERE, 'review.mjs'), ...x], { env, encoding: 'utf8' });
  assert.match(rev('check').stdout, /all ui-review-item@1/, 'both stores conform');
});

t('shot CLI: --group files shots in a named group (reused the same day), groups / group / move commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-shot-groups-test-'));
  const env = cleanEnv(dir);
  const F = ['--app', 'Breakroom', '--screen', '/breakroom', '--source', 'claude-code', '--session', 'sess-9'];
  const shot = (...a) => { const r = spawnSync(process.execPath, [join(HERE, '../../../../framework/cli/shot.mjs'), ...a, '--json'], { env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  const img = readFileSync(join(HERE, 'packs', JSON.parse(readFileSync(join(HERE, 'packs/index.json'), 'utf8')).packs[0].files[0].src));
  const p = join(dir, 'home-phone.png'), d = join(dir, 'home-desktop.png'); writeFileSync(p, img); writeFileSync(d, img);
  const two = shot(p, d, '--title', 'Breakroom', ...F, '--group', 'Breakroom check - Oct 31 8:20 PM').shots;
  assert.equal(two.length, 2); assert.equal(two[0].group.id, two[1].group.id, 'one call = one group'); assert.equal(two[0].name, 'Breakroom · Home', 'several files: "<name> · <file>"');
  const again = shot(p, '--name', 'Again', ...F, '--group', 'breakroom check - oct 31 8:20 pm').shots[0]; assert.equal(again.group.id, two[0].group.id, 'same name today = same group');
  const auto = shot(d, '--name', 'Auto', ...F).shots[0]; assert.notEqual(auto.group.id, two[0].group.id);
  let gs = shot('groups').groups;
  assert.equal(gs.length, 2); assert.equal(gs.find((g) => g.id === two[0].group.id).count, 3); assert.match(gs.find((g) => g.id === auto.group.id).name, /^sess-9 - \d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.equal(shot('groups', '--q', 'sess-9').groups.length, 2, 'both groups came from session sess-9'); assert.equal(shot('groups', '--q', 'breakroom check').groups.length, 1);
  assert.equal(shot('group', 'rename', auto.group.id, 'Lobby check').group.name, 'Lobby check');
  assert.equal(shot('list').shots.find((x) => x.id === auto.id).group, auto.group.id);
  assert.equal(JSON.parse(readFileSync(join(dir, 'screenshots', 'index.json'), 'utf8')).shots.find((x) => x.id === auto.id).group.name, 'Lobby check', 'a rename reaches the stored group name');
  assert.equal(shot('move', again.id, auto.group.id).moved, 1);
  const moved = shot('move', two[0].id, 'Brand new group'); assert.equal(moved.moved, 1);
  gs = shot('groups').groups; assert.equal(gs.length, 3);
  assert.equal(shot('group', 'merge', auto.group.id, two[0].group.id).moved, 2);
  const nu = gs.find((g) => g.name === 'Brand new group');
  const del = shot('group', 'delete', nu.id); assert.equal(del.removed.length, 1);
  gs = shot('groups').groups; assert.deepEqual(gs.map((g) => g.count), [3]);
  const kept = shot('group', 'new', 'Spare'); const del2 = shot('group', 'delete', gs[0].id, '--into', kept.group.id); assert.equal(del2.moved, 3, 'delete --into keeps the shots');
  assert.ok(shot('list').shots.every((x) => x.group === kept.group.id), 'every screenshot still has exactly one group');
});

t('migration: older queue items + screenshots → ui-review-item@1 (dry run first, then apply, idempotent)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-review-migrate-'));
  const env = cleanEnv(dir);
  const rev = (...x) => spawnSync(process.execPath, [join(HERE, 'review.mjs'), ...x], { env, encoding: 'utf8' });
  const img = readFileSync(join(HERE, 'packs', JSON.parse(readFileSync(join(HERE, 'packs/index.json'), 'utf8')).packs[0].files[0].src));
  mkdirSync(join(dir, 'shots', 'r-20261030-abc12'), { recursive: true }); writeFileSync(join(dir, 'shots', 'r-20261030-abc12', 'a-phone.png'), img);
  mkdirSync(join(dir, 'screenshots', 'files'), { recursive: true }); writeFileSync(join(dir, 'screenshots', 'files', 's-1.png'), img);
  const items = { $axf: 'ui-review-items@1', items: [
    { $axf: 'review-item@1', id: 'r-20261030-abc12', kind: 'settings', title: 'Level bar', app: '', build: '', branch: 'claude/levels', pr: 180, shots: [{ src: 'items/r-20261030-abc12/a-phone.png', device: 'phone', name: 'A' }], notes: 'n', status: 'changes', comment: 'tighter', source: 'cli',
      history: [{ at: '2026-10-30T10:00:00Z', by: 'build', action: 'submitted', status: 'waiting' }], submittedAt: '2026-10-30T10:00:00Z', updatedAt: '2026-10-30T11:00:00Z' },
    { id: 'pack:graphite-pro', kind: 'design-pack', status: 'approved', comment: '', history: [] }] };
  const shots = { $axf: 'ui-screenshots@1', groups: [{ $axf: 'shot-group@1', id: 'g-20261031-aaaa', name: 'Breakroom check - Oct 31 8:20 PM', createdAt: '2026-11-01T00:20:00Z', source: 'check' }],
    shots: [{ $axf: 'ui-screenshot@1', id: 's-1', title: '', source: 'check', app: 'Breakroom', screen: 'Lobby', viewport: 'phone', takenAt: '', file: 's-1.png', group: 'g-20261031-aaaa', pair: '', side: '', promoted: [] }] };
  writeFileSync(join(dir, 'items.json'), JSON.stringify(items)); writeFileSync(join(dir, 'screenshots', 'index.json'), JSON.stringify(shots));
  assert.equal(rev('check').status, 1, 'older data does not conform');
  const dry = rev('migrate', '--report', join(dir, 'report.md'));
  assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, /dry run/); assert.match(readFileSync(join(dir, 'report.md'), 'utf8'), /\| queue \| `r-20261030-abc12` \| Level bar \|/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')), items, 'the dry run writes nothing');
  const ap = JSON.parse(rev('migrate', '--apply', '--json').stdout);
  assert.ok(ap.applied); assert.equal(ap.backups.length, 2); assert.deepEqual(ap.errors, []);
  assert.match(rev('check').stdout, /all ui-review-item@1/);
  const mi = JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')); const ms = JSON.parse(readFileSync(join(dir, 'screenshots', 'index.json'), 'utf8'));
  const q = mi.items[0];
  assert.equal(q.name, 'Level bar'); assert.equal(q.createdAt, '2026-10-30T10:00:00Z'); assert.equal(q.status, 'changes'); assert.equal(q.section, 'settings'); assert.equal(q.source, 'claude-code');
  assert.equal(q.group.name, 'claude/levels - 2026-10-30'); assert.equal(q.comment, 'tighter'); assert.equal(mi.packDecisions['pack:graphite-pro'].status, 'approved');
  const s1 = ms.shots[0];
  assert.equal(s1.name, 'Lobby', 'no title: the name comes from the screen'); assert.match(s1.createdAt, /^\d{4}-/); assert.deepEqual(s1.group, { id: 'g-20261031-aaaa', name: 'Breakroom check - Oct 31 8:20 PM' });
  assert.equal(ms.groups[0].$axf, 'ui-review-group@1'); assert.equal(ms.groups[0].source, 'claude-code');
  assert.equal(JSON.parse(rev('migrate', '--json').stdout).changed, 0, 'idempotent');
  // the stores read migrated data the same as before
  assert.equal(JSON.parse(rev('list', '--json').stdout).items[0].title, 'Level bar');
});

t('shot.mjs finds its handler by capability (ui-screenshots@1), never by folder name', () => {
  const src = readFileSync(join(HERE, '../../../../framework/cli/shot.mjs'), 'utf8');
  assert.match(src, /service:ui-screenshots@1/); assert.ok(!src.includes('plugins/ui-review'));
  assert.ok(JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8')).provides.includes('service:ui-screenshots@1'));
});

console.log(`ui-review: ${n} checks ok`);
