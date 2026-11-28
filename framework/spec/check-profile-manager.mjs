#!/usr/bin/env node
// Build profiles manager (build-profiles@1): the registry and store changes behind the manager page.
// Numbers per profile, look (colour / icon), duplicate, merge, move builds, archive, remove → restore, the owner-only
// purge, and the cleanup scan + fix. Runs on a scratch data folder and a scratch store, never the real ones.
//   node framework/spec/check-profile-manager.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'axf-profile-manager-'));
Object.assign(process.env, {
  AXF_DATA_DIR: dir, AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_BUILDS_EXPORT: '0', AXF_BUILDS_LIVE: '0',
  AXF_HEADLESS_DIR: join(dir, 'meters'), AXF_CONSOLE_ROOT: 'off', AXF_ACTOR: 'check',
});
delete process.env.AXF_BUILD_PROFILE;

const core = await import('../plan/builds-store-core.mjs');
const io = await import('../cli/builds-store.mjs');
const persist = await import('../cli/persist.mjs');
const profiles = await import('../cli/profiles.mjs');

let n = 0; const t = (name, fn) => { try { fn(); n += 1; console.log(`  ✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } };
const NOW = '2026-11-20T10:00:00.000Z';
const steps = (done, total) => Array.from({ length: total }, (_, i) => ({ id: `s${i + 1}`, text: `step ${i + 1}`, model: 'Opus', done: i < done, doneAt: i < done ? `2026-11-2${i + 1}T09:00:00.000Z` : '' }));
const landed = { pr: 7, mergedAt: '2026-11-19T08:00:00.000Z', sha: 'a'.repeat(40), ci: 'success', verifiedAt: '2026-11-19T09:00:00.000Z', verifyHow: 'check' };
const build = (id, profile, status, done, total, more = {}) => core.normBuild({ id, title: `Build ${id}`, status, profiles: [profile], steps: steps(done, total), createdAt: NOW, updatedAt: NOW, ...more }, { now: NOW, seed: id });
const store = () => io.loadStore();
const one = (id) => core.findBuild(store(), id);
const reg = () => persist.readProfiles();
const act = (c) => profiles.act(c);

try {
  // a registry with the base profile only, and two profiles made through the CLI module
  mkdirSync(join(dir, 'framework/plan'), { recursive: true });
  writeFileSync(join(dir, 'framework/plan/profiles.json'), JSON.stringify({ $axf: 'build-profiles@1', active: 'all', profiles: [{ id: 'all', name: 'All builds', catalog: true }] }));
  act({ action: 'create', name: 'Alpha', id: 'pm-alpha', description: 'first' });
  act({ action: 'create', name: 'Beta', id: 'pm-beta' });
  const seed = core.emptyStore(NOW); seed.migratedAt = NOW;
  seed.builds.push(
    build('a-run', 'pm-alpha', 'running', 2, 4),
    build('a-wait', 'pm-alpha', 'pending', 0, 3),
    build('a-done', 'pm-alpha', 'complete', 2, 2, { pr: '7', branch: 'claude/a-done', mergedAt: landed.mergedAt, landed }),
    build('a-arch-merged', 'pm-alpha', 'archived', 2, 2, { pr: '7', branch: 'claude/a-arch-merged', mergedAt: landed.mergedAt, landed }),
    build('a-arch-steps', 'pm-alpha', 'archived', 3, 3),
    build('a-arch-open', 'pm-alpha', 'archived', 1, 3),
    build('a-fail', 'pm-alpha', 'failed', 1, 2),
    build('b-one', 'pm-beta', 'pending', 0, 2),
    build('ghost', 'pm-gone', 'pending', 0, 1),
    build('base-one', 'all', 'pending', 0, 1),
  );
  seed.builds.forEach((b, i) => { b.order[b.profiles[0]] = i; });
  seed.rules['pm-alpha'] = { ...core.DEFAULT_RULES, sameSession: false };
  writeFileSync(io.storeFile(), `${JSON.stringify(core.compactStore(seed), null, 1)}\n`);
  assert.deepEqual(core.validateStore(io.readStoreNow()).errors ?? [], [], 'the seeded store is a valid builds@1 store');
  // session meters: $6 on a-run (2 steps done → $3 a step), $4 on a-done
  mkdirSync(join(dir, 'meters'), { recursive: true });
  writeFileSync(join(dir, 'meters/x.meter.json'), JSON.stringify({ session: 'axf-a-run--s1', build: 'a-run', costUsd: 6, startedAt: NOW }));
  writeFileSync(join(dir, 'meters/y.meter.json'), JSON.stringify({ session: 'axf-a-done--s1', build: 'a-done', costUsd: 4, startedAt: NOW }));

  // ---------------------------------------------------------------- stats
  t('stats: builds by status, pending, queue, steps, last activity', () => {
    const s = profiles.state();
    const a = s.profiles.find((p) => p.id === 'pm-alpha').stats;
    assert.equal(a.builds, 7);
    assert.deepEqual(a.byStatus, { running: 1, pending: 1, complete: 1, archived: 3, failed: 1 });
    assert.deepEqual([a.running, a.pending, a.complete, a.archived, a.attention], [1, 1, 1, 3, 1]);
    assert.equal(a.pendingItems, 3, 'running + pending + failed are still on the Pending list');
    assert.equal(a.queueSteps, 0);
    assert.deepEqual(a.steps, { total: 11, done: 5, left: 6 }, 'archived builds left out');
    assert.ok(a.lastActivity >= NOW && a.firstCreated === NOW);
    assert.equal(s.profiles.find((p) => p.id === 'pm-beta').stats.builds, 1);
  });
  t('stats: cost spent from the session meters, cost left estimated from the spend per done step', () => {
    const c = profiles.state().profiles.find((p) => p.id === 'pm-alpha').stats.cost;
    assert.equal(c.spentUsd, 10);
    assert.equal(c.basis, 'profile-average');
    assert.equal(c.perStepUsd, 2.5, '$10 over 4 done steps of builds with spend');
    assert.equal(c.leftUsd, 15, '6 open steps × $2.50');
    assert.equal(c.budgetLeftUsd, null, 'no per-build cap set');
    const b = profiles.state().profiles.find((p) => p.id === 'pm-beta').stats.cost;
    assert.deepEqual([b.spentUsd, b.basis, b.leftUsd], [0, 'store-average', 5], 'a profile with no spend uses the store-wide rate');
  });
  t('stats: a per-build cap gives the budget left; no rate at all gives leftUsd null', () => {
    const s = store();
    const st = core.profileStats(s, 'pm-alpha', { spend: { byBuild: { 'a-run': 6 } }, perBuildUsd: 20 });
    assert.equal(st.cost.budgetLeftUsd, 14 + 20 + 20, 'running, pending and failed builds: cap minus spend');
    assert.deepEqual([core.profileStats(s, 'pm-beta').cost.leftUsd, core.profileStats(s, 'pm-beta').cost.basis], [null, 'none']);
  });
  t('get: one profile with its builds in order, progress and spend', () => {
    const g = profiles.get('pm-alpha');
    assert.equal(g.profile.id, 'pm-alpha'); assert.equal(g.builds.length, 7);
    assert.deepEqual(g.builds[0], { ...g.builds[0], id: 'a-run', steps: 4, stepsDone: 2, pct: 50, costUsd: 6 });
    assert.throws(() => profiles.get('nope'), /no build profile/);
  });

  // ---------------------------------------------------------------- look
  t('update: colour and icon are asset names; \'\' clears; a literal colour is refused', () => {
    assert.deepEqual((({ color, icon }) => ({ color, icon }))(act({ action: 'update', id: 'pm-alpha', color: 'accent', icon: 'rocket' }).profile), { color: 'accent', icon: 'rocket' });
    assert.equal(reg().profiles.find((p) => p.id === 'pm-alpha').icon, 'rocket');
    assert.throws(() => act({ action: 'update', id: 'pm-alpha', color: '#ff0000' }), /colour asset/);
    act({ action: 'update', id: 'pm-alpha', icon: '' });
    const p = reg().profiles.find((x) => x.id === 'pm-alpha');
    assert.equal(p.color, 'accent'); assert.equal('icon' in p, false);
    assert.equal(p.name, 'Alpha', 'name untouched');
  });

  // ---------------------------------------------------------------- archive
  t('archive / unarchive: hidden flag; the base and the active profile can\'t be archived; an archived one can\'t be selected', () => {
    assert.throws(() => act({ action: 'archive', id: 'all' }), /main profile stays/);
    act({ action: 'select', id: 'pm-beta' });
    assert.throws(() => act({ action: 'archive', id: 'pm-beta' }), /active/);
    act({ action: 'select', id: 'all' });
    assert.equal(act({ action: 'archive', id: 'pm-beta' }).profile.archived, true);
    assert.ok(reg().profiles.find((p) => p.id === 'pm-beta').archivedAt);
    assert.throws(() => act({ action: 'select', id: 'pm-beta' }), /archived/);
    act({ action: 'unarchive', id: 'pm-beta' });
    assert.equal('archived' in reg().profiles.find((p) => p.id === 'pm-beta'), false);
  });

  // ---------------------------------------------------------------- duplicate
  t('duplicate: a new profile with the look and files; the builds are the same records, shown in both', () => {
    const r = act({ action: 'duplicate', id: 'pm-alpha', name: 'Alpha two' });
    assert.equal(r.profile.id, 'alpha-two'); assert.equal(r.profile.copiedFrom, 'pm-alpha'); assert.equal(r.profile.color, 'accent');
    assert.equal(r.shared, 7);
    assert.deepEqual(one('a-run').profiles, ['pm-alpha', 'alpha-two']);
    assert.deepEqual(core.buildsOf(store(), 'alpha-two').map((b) => b.id), core.buildsOf(store(), 'pm-alpha').map((b) => b.id), 'same order');
    assert.equal(store().rules['alpha-two'].sameSession, false, 'rules copied');
    assert.ok(existsSync(profiles.profileFiles('alpha-two')['framework/plan/pending.json']));
    assert.equal(act({ action: 'duplicate', id: 'pm-alpha', name: 'Alpha two' }).profile.id, 'alpha-two-2', 'a taken id gets a number');
    const bare = act({ action: 'duplicate', id: 'pm-alpha', name: 'Bare', builds: false });
    assert.equal(bare.shared, 0); assert.equal(core.buildsOf(store(), 'bare').length, 0);
    assert.deepEqual(core.validateStore(io.readStoreNow()).errors ?? [], []);
  });

  // ---------------------------------------------------------------- move builds
  t('move-builds: builds leave one profile for another, keep id / status / steps, get a note', () => {
    const r = act({ action: 'move-builds', ids: ['a-wait', 'nope', 'b-one'], from: 'pm-alpha', to: 'pm-beta' });
    assert.deepEqual(r.report.moved, ['a-wait']);
    assert.deepEqual(r.report.skipped.map((x) => x.id), ['nope', 'b-one']);
    const b = one('a-wait');
    assert.deepEqual(b.profiles, ['alpha-two', 'alpha-two-2', 'pm-beta'], 'it left pm-alpha only');
    assert.equal(b.status, 'pending'); assert.equal(b.steps.length, 3);
    assert.match(b.notes.at(-1).text, /Moved from build profile "pm-alpha" to "pm-beta"/);
    assert.deepEqual(core.buildsOf(store(), 'pm-beta').map((x) => x.id), ['b-one', 'a-wait'], 'at the end of the target');
    assert.deepEqual(core.buildsOf(store(), 'pm-alpha').map((x) => x.order['pm-alpha']), [0, 1, 2, 3, 4, 5], 'the source is renumbered');
  });
  t('move-builds without --from: the build leaves every profile it was in', () => {
    act({ action: 'move-builds', ids: ['a-wait'], to: 'pm-alpha' });
    assert.deepEqual(one('a-wait').profiles, ['pm-alpha']);
    assert.throws(() => act({ action: 'move-builds', ids: [], to: 'pm-alpha' }), /name the builds/);
    assert.throws(() => act({ action: 'move-builds', ids: ['a-wait'], to: 'nope' }), /no build profile/);
    assert.deepEqual(core.validateStore(io.readStoreNow()).errors ?? [], []);
  });

  // ---------------------------------------------------------------- remove → restore
  t('remove: off the list, kept as restorable; restore brings it back with its fields', () => {
    assert.throws(() => act({ action: 'remove', id: 'bare', confirm: 'x' }), /confirm/);
    act({ action: 'remove', id: 'bare', confirm: 'bare' });
    assert.equal(reg().profiles.some((p) => p.id === 'bare'), false);
    const gone = reg().removed.find((p) => p.id === 'bare');
    assert.ok(gone.removedAt); assert.equal(gone.removedBy, 'check'); assert.equal(gone.name, 'Bare');
    assert.throws(() => act({ action: 'select', id: 'bare' }), /restore it first/);
    assert.equal(profiles.get('bare').profile.removed, true);
    const back = act({ action: 'restore', id: 'bare' }).profile;
    assert.equal(back.name, 'Bare'); assert.equal('removedAt' in back, false);
    assert.equal(reg().removed.length, 0);
    assert.throws(() => act({ action: 'restore', id: 'bare' }), /on the list already/);
  });
  t('create with the id of a removed profile brings it back with its data (the older way to restore)', () => {
    act({ action: 'remove', id: 'bare', confirm: 'bare' });
    const p = act({ action: 'create', name: 'Bare again', id: 'bare' }).profile;
    assert.equal(p.copiedFrom, 'pm-alpha', 'kept from before'); assert.equal(p.name, 'Bare again');
    assert.equal(reg().removed.length, 0);
  });

  // ---------------------------------------------------------------- merge
  t('merge: every build of one profile moves to the other; the source comes off the list, restorable', () => {
    assert.throws(() => act({ action: 'merge', from: 'all', into: 'pm-beta' }), /main profile stays/);
    assert.throws(() => act({ action: 'merge', from: 'pm-beta', into: 'pm-beta' }), /two different/);
    act({ action: 'select', id: 'pm-beta' });
    const r = act({ action: 'merge', from: 'pm-beta', into: 'pm-alpha' });
    assert.equal(r.report.moved, 1);
    assert.equal(reg().active, 'pm-alpha', 'the active pick follows the merge');
    assert.deepEqual(one('b-one').profiles, ['pm-alpha']); assert.equal(one('b-one').fromProfile, 'pm-beta');
    assert.match(one('b-one').notes.at(-1).text, /^Merged from build profile "pm-beta" into "pm-alpha"\.$/);
    assert.equal(reg().removed.find((p) => p.id === 'pm-beta').mergedInto, 'pm-alpha');
    assert.equal(core.buildsOf(store(), 'pm-beta', { withDeleted: true }).length, 0);
    // shared builds stay one record
    const k = act({ action: 'merge', from: 'alpha-two-2', into: 'alpha-two', keep: true });
    assert.equal(k.report.moved, 0); assert.equal(k.report.shared.length, 6);
    assert.ok(reg().profiles.some((p) => p.id === 'alpha-two-2'), '--keep leaves it on the list');
    assert.deepEqual(core.validateStore(io.readStoreNow()).errors ?? [], []);
    act({ action: 'select', id: 'all' });
  });

  // ---------------------------------------------------------------- cleanup
  t('cleanup scan: archived builds that are finished, and builds in a profile that no longer exists', () => {
    const r = profiles.cleanup();
    const by = Object.fromEntries(r.findings.map((f) => [f.id, f]));
    assert.deepEqual(Object.keys(by).sort(), ['a-arch-merged', 'a-arch-steps', 'ghost']);
    assert.deepEqual([by['a-arch-merged'].kind, by['a-arch-merged'].evidence, by['a-arch-merged'].fixable, by['a-arch-merged'].to], ['archived-complete', 'merged', true, 'complete']);
    assert.deepEqual([by['a-arch-steps'].evidence, by['a-arch-steps'].fixable], ['steps-done', false]);
    assert.match(by['a-arch-steps'].why, /merged PR/, 'done means merged: no proof, no fix');
    assert.deepEqual([by.ghost.kind, by.ghost.evidence, by.ghost.to], ['orphan-profile', 'pm-gone', 'all']);
    assert.equal(r.fixable, 2);
    assert.deepEqual(profiles.cleanup({ profile: 'pm-alpha' }).findings.map((f) => f.id).sort(), ['a-arch-merged', 'a-arch-steps']);
  });
  t('cleanup fix: one build by id, then the rest; what has no proof stays flagged', () => {
    const r1 = act({ action: 'cleanup-fix', ids: ['ghost'] });
    assert.deepEqual(r1.report.fixed, [{ kind: 'orphan-profile', id: 'ghost', to: 'all' }]);
    assert.deepEqual(one('ghost').profiles, ['all']); assert.equal(one('ghost').fromProfile, 'pm-gone');
    const r2 = act({ action: 'cleanup-fix' });
    assert.deepEqual(r2.report.fixed, [{ kind: 'archived-complete', id: 'a-arch-merged', to: 'complete' }]);
    assert.equal(one('a-arch-merged').status, 'complete');
    assert.match(one('a-arch-merged').notes.at(-1).text, /^Cleanup: it was archived but it is finished/);
    assert.equal(one('a-arch-steps').status, 'archived');
    assert.deepEqual(profiles.cleanup().findings.map((f) => f.id), ['a-arch-steps']);
    assert.deepEqual(act({ action: 'cleanup-fix' }).report.fixed, [], 'running it again changes nothing');
    assert.deepEqual(core.validateStore(io.readStoreNow()).errors ?? [], []);
  });

  // ---------------------------------------------------------------- purge
  t('purge: owner only, typed confirm, never the base or the active profile', () => {
    assert.throws(() => act({ action: 'purge', id: 'pm-beta', confirm: 'delete pm-beta' }), /only the owner/);
    assert.throws(() => act({ action: 'purge', id: 'pm-beta', owner: true, confirm: 'pm-beta' }), /can't be undone/);
    assert.throws(() => act({ action: 'purge', id: 'all', owner: true, confirm: 'delete all' }), /main profile stays/);
    act({ action: 'select', id: 'alpha-two' });
    assert.throws(() => act({ action: 'purge', id: 'alpha-two', owner: true, confirm: 'delete alpha-two' }), /active/);
    act({ action: 'select', id: 'all' });
  });
  t('purge: a removed profile\'s folder and entry go; builds shared with another profile stay there', () => {
    const folder = join(dir, 'framework/plan/profiles/pm-beta');
    assert.ok(existsSync(folder));
    const r = act({ action: 'purge', id: 'pm-beta', owner: true, confirm: 'delete pm-beta' });
    assert.equal(existsSync(folder), false); assert.ok(r.files.includes(folder));
    assert.equal(reg().removed.some((p) => p.id === 'pm-beta'), false);
    const before = core.buildsOf(store(), 'pm-alpha').length;
    const p = act({ action: 'purge', id: 'alpha-two', owner: true, confirm: 'delete alpha-two' });
    assert.equal(p.report.deleted.length, 0); assert.equal(p.report.untagged.length, 6);
    assert.equal(core.buildsOf(store(), 'pm-alpha').length, before, 'nothing lost in the profile they also live in');
    assert.equal(one('a-run').profiles.includes('alpha-two'), false);
    assert.equal('alpha-two' in store().rules, false);
  });
  t('purge: builds that lived only in the profile are deleted from the store', () => {
    const ids = core.buildsOf(store(), 'pm-alpha').map((b) => b.id);
    const r = act({ action: 'purge', id: 'pm-alpha', owner: true, confirm: 'delete pm-alpha' });
    assert.deepEqual(r.report.deleted.sort(), [...ids].sort());
    assert.equal(core.buildsOf(store(), 'pm-alpha').length, 0);
    assert.equal(one('a-run').deleted, true);
    assert.equal(reg().profiles.some((p) => p.id === 'pm-alpha'), false);
    assert.equal(one('base-one').deleted, false, 'other profiles untouched');
    assert.deepEqual(core.validateStore(io.readStoreNow()).errors ?? [], []);
  });
  t('the registry file keeps build-profiles@1 and what older readers expect', () => {
    const raw = JSON.parse(readFileSync(join(dir, 'framework/plan/profiles.json'), 'utf8'));
    assert.equal(raw.$axf, 'build-profiles@1'); assert.equal(raw.active, 'all');
    assert.ok(raw.profiles.every((p) => p.id && p.name && !('base' in p)));
  });
  console.log(`check-profile-manager: ok (${n} checks)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
