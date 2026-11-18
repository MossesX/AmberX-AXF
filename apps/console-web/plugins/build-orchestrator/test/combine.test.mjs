#!/usr/bin/env node
/** combine.mjs (split-plan@1): all-or-nothing combine of part branches on a real git repo and a test store. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-combine-'));
Object.assign(process.env, { AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_SHIPPED: 'off', AXF_DATA_DIR: 'off', AXF_COMBINE_PUSH: 'off', AXF_SLOTS_TMUX: 'off', AXF_PIPELINE_WORKTREES: join(tmp, 'wt') });
const S = await import('../../../../../framework/core/build-split.mjs');
const C = await import('../combine.mjs');
const { loadStore } = await import('../../../../../framework/cli/builds-store.mjs');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const repo = join(tmp, 'repo');
const g = (...a) => { const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
spawnSync('git', ['init', '-q', '-b', 'main', repo]);
g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
writeFileSync(join(repo, 'shared.txt'), 'base\n'); g('add', '.'); g('commit', '-qm', 'base');
const base = g('rev-parse', 'HEAD');
const branchWith = (branch, file, text) => { g('checkout', '-q', '-B', branch, base); writeFileSync(join(repo, file), text); g('add', '.'); g('commit', '-qm', `${branch} ${file}`); const h = g('rev-parse', 'HEAD'); g('checkout', '-q', 'main'); return h; };
process.env.AXF_COMBINE_GIT = repo;

const steps = [{ id: 's1', text: 'a', files: ['a.txt'], done: true }, { id: 's2', text: 'b', files: ['b.txt'], done: true }];
const mkStore = (id, heads, builds = []) => {
  const plan0 = S.planParts({ id, steps: steps.map((s) => ({ ...s, done: false })) }, 2, {}, { base }).plan;
  const plan = { ...plan0, run: 'combining', parts: plan0.parts.map((p, i) => ({ ...p, status: 'done', head: heads[i] })) };
  const lock = S.lockMain({}, { build: id, splitId: plan.id, base, at: new Date().toISOString() }).meta;
  writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify({ $axf: 'builds@1', rev: 1, meta: lock, builds: [{ id, title: id, status: 'running', steps, splitId: plan.id, split: S.normSplit(plan, { build: id }) }, ...builds] }));
};

t('clean combine: both parts merged onto the base, head recorded, build landing, main still locked', () => {
  const h1 = branchWith('claude/ok--r1-p1', 'a.txt', 'a\n'); const h2 = branchWith('claude/ok--r1-p2', 'b.txt', 'b\n');
  mkStore('ok', [h1, h2]);
  const r = C.combineRun('ok'); assert.equal(r.ok, true, r.why); assert.deepEqual(r.merged, ['p1', 'p2']);
  const b = loadStore().builds[0]; assert.equal(b.split.combine.head, r.head); assert.equal(b.status, 'landing'); assert.equal(b.branch, 'claude/ok'); assert.equal(b.split.run, 'combining');
  assert.ok(loadStore().meta.mainLock, 'main stays locked until the landing finishes');
  const files = g('ls-tree', '--name-only', r.head).split('\n').sort(); assert.deepEqual(files, ['a.txt', 'b.txt', 'shared.txt']);
  assert.equal(C.combineRun('ok').skipped, true, 'a second combine does nothing');
});
t('clash: the run fails, nothing lands, main unlocks, the part and files are named', () => {
  const h1 = branchWith('claude/bad--r1-p1', 'shared.txt', 'one\n'); const h2 = branchWith('claude/bad--r1-p2', 'shared.txt', 'two\n');
  mkStore('bad', [h1, h2]);
  const r = C.combineRun('bad'); assert.equal(r.ok, false); assert.equal(r.clash.part, 'p2'); assert.deepEqual(r.clash.files, ['shared.txt']);
  const s = loadStore(); const b = s.builds[0];
  assert.equal(b.split.run, 'failed'); assert.equal(b.split.failure.part, 'p2'); assert.match(b.split.failure.why, /clash/); assert.equal(b.status, 'fixing'); assert.equal(b.split.combine.head, '');
  assert.ok(!s.meta.mainLock, 'main unlocked'); assert.ok(b.notes.some((x) => /Nothing landed; main is unlocked/.test(x.text)));
});
t('a part not done: combineTick fails the run whole (all or nothing)', () => {
  const h1 = branchWith('claude/half--r1-p1', 'a.txt', 'a\n');
  mkStore('half', [h1, h1]);
  const st = JSON.parse(JSON.stringify(loadStore())); st.builds[0].split.parts[1].status = 'failed'; st.builds[0].split.parts[1].rebuilds = 2; st.builds[0].split.run = 'building';
  st.builds[0].split = S.applyRollUp(S.normSplit(st.builds[0].split, { build: 'half' })).plan; writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify(st));
  assert.equal(loadStore().builds[0].split.run, 'failed');
  const r = C.combineTick(); assert.deepEqual(r.failed.map((f) => f.id), ['half']);
  const s = loadStore(); assert.equal(s.builds[0].status, 'fixing'); assert.ok(!s.meta.mainLock);
});
t('landing hand-off: the combine PR walks ci → merging → merged → live → finished; main unlocks at finished only', () => {
  const h1 = branchWith('claude/land--r1-p1', 'a.txt', 'a\n'); const h2 = branchWith('claude/land--r1-p2', 'b.txt', 'b\n');
  mkStore('land', [h1, h2]); assert.equal(C.combineRun('land').ok, true);
  const edit = (fn) => { const st = loadStore(); fn(st.builds[0]); writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify(st)); };
  const run = () => loadStore().builds[0].split.run;
  assert.equal(C.landingTick().moved.length, 0, 'no PR yet: still combining'); assert.equal(run(), 'combining');
  edit((b) => { b.pr = '#77'; }); C.landingTick(); assert.equal(run(), 'ci'); assert.equal(loadStore().builds[0].split.combine.pr, 77);
  C.landingTick({ items: new Map([['land', { id: 'land', state: 'landing' }]]) }); assert.equal(run(), 'merging');
  const at = new Date().toISOString();
  edit((b) => { b.mergedAt = at; }); C.landingTick(); assert.equal(run(), 'merged'); assert.ok(loadStore().meta.mainLock, 'merged: main still locked');
  edit((b) => { b.status = 'landed'; b.landed = { pr: 77, sha: 'c'.repeat(40), mergedAt: at, ci: 'success', ciAt: at }; }); C.landingTick(); assert.equal(run(), 'live');
  assert.equal(S.mainLocked(loadStore().meta, { builds: loadStore().builds }).locked, true, 'live (landed): the split run still holds main');
  edit((b) => { b.status = 'complete'; b.landed = { ...b.landed, verifiedAt: at, verifyHow: 'check' }; });
  const r = C.landingTick(); assert.equal(run(), 'finished'); assert.deepEqual(r.unlocked, ['land']); assert.ok(!loadStore().meta.mainLock, 'finished: main unlocked');
  assert.deepEqual(loadStore().builds[0].split.history.slice(-5).map((h) => h.to), ['ci', 'merging', 'merged', 'live', 'finished']);
});
t('landing stopped (escalated): the run fails and main unlocks', () => {
  const h1 = branchWith('claude/esc--r1-p1', 'a.txt', 'a\n'); const h2 = branchWith('claude/esc--r1-p2', 'b.txt', 'b\n');
  mkStore('esc', [h1, h2]); C.combineRun('esc');
  const st = loadStore(); st.builds[0].status = 'escalated'; writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify(st));
  assert.deepEqual(C.landingTick().unlocked, ['esc']); assert.equal(loadStore().builds[0].split.run, 'failed'); assert.ok(!loadStore().meta.mainLock);
});
console.log(`combine: ${n} checks passed`);
