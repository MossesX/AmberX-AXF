#!/usr/bin/env node
// Profile clean-up engine checks: scratch store + scratch data folder, nothing in the checkout is touched.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'axf-maint-profiles-'));
const data = join(scratch, 'data');
Object.assign(process.env, {
  AXF_DATA_DIR: data, AXF_BUILDS_STORE: join(scratch, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILDS_EXPORT: '0',
  AXF_MAINT_DATA_DIR: join(scratch, 'maint'), AXF_MAINT_NO_REPLAN: '1', AXF_MAINT_MERGED_PRS: '90001', AXF_BUILD_PROFILE: '',
});
const w = (f, j) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, JSON.stringify(j)); };
const tracker = { $axf: 'tracker@1', items: [{ id: 'f.one', status: 'planned' }, { id: 'f.two', status: 'built' }] };
w(join(data, 'framework/plan/profiles.json'), { $axf: 'build-profiles@1', active: 'main-framework', profiles: [{ id: 'main-framework', name: 'Main framework' }, { id: 'side', name: 'Side' }] });
w(join(data, 'tracker.json'), tracker);
w(join(data, 'framework/plan/profiles/side/tracker.json'), tracker);
w(join(data, 'framework/catalog/status.json'), {});

const core = await import('../../../../../framework/plan/builds-store-core.mjs');
const st = (id, done) => ({ id, title: id, done });
const B = (o) => core.normBuild({ status: 'pending', createdAt: '2026-10-01T00:00:00Z', ...o }, { now: '2026-10-01T00:00:00Z' });
const store = core.emptyStore('2026-10-01T00:00:00Z');
store.builds = [
  B({ id: 'merged-pr', title: 'Merged PR build', pr: '#90001' }),
  B({ id: 'all-ticked', title: 'All ticked', steps: [st('s1', true), st('s2', true)] }),
  B({ id: 'patches-web', title: 'Patches web tabs' }),
  B({ id: 'x-done', title: 'Thing X', status: 'complete' }),
  B({ id: 'x-again', title: 'Thing X!', steps: [st('s1', false)] }),
  B({ id: 'y-old', title: 'Thing Y', steps: [st('s1', false)], createdAt: '2026-09-01T00:00:00Z' }),
  B({ id: 'y-new', title: 'thing y', steps: [st('s1', true), st('s2', false), st('s3', false)], profiles: ['side'] }),
  B({ id: 'busy', title: 'Running build', status: 'running', pr: '#90001' }),
  B({ id: 'plain', title: 'Still to do', steps: [st('s1', false)] }),
  B({ id: 'built-wait', title: 'Built and waiting', status: 'built', pr: '#99999', steps: [st('s1', true)] }),
];
writeFileSync(process.env.AXF_BUILDS_STORE, JSON.stringify(store));

const P = await import('./profiles.mjs');
const { readStoreNow } = await import('../../../../../framework/cli/builds-store.mjs');
let pass = 0; let fail = 0;
const check = (ok, what) => { if (ok) pass += 1; else { fail += 1; console.error(`FAIL ${what}`); } };

const plan = P.savePlan(P.audit());
const items = Object.fromEntries(plan.profiles.flatMap((p) => p.items).map((i) => [i.key, i]));
const v = (k) => items[k]?.verdict;
check(plan.$axf === 'profile-cleanup@1' && plan.mode === 'basic' && P.RUN_ID.test(plan.run), 'preview is saved with a run id, Basic mode');
check(v('build:merged-pr') === 'done' && items['build:merged-pr'].proof.label === 'PR #90001', 'merged PR → done, with the PR as proof');
check(v('build:all-ticked') === 'done', 'every step ticked → done');
check(v('build:patches-web') === 'not-needed' && items['build:patches-web'].proof.path.endsWith('kill-patches-pilot.md'), 'retired app → not needed, report as proof');
check(v('build:x-again') === 'duplicate' && items['build:x-again'].into === 'x-done', 'same title as a finished build → duplicate of it');
check(v('build:y-new') === 'merge' && items['build:y-new'].into === 'y-old', 'same title as an older open build → merge into it');
check(v('build:y-old') === 'keep', 'the older twin is kept');
check(v('build:busy') === 'keep' && items['build:busy'].locked, 'running builds are locked, even with a merged PR');
check(v('build:plain') === 'keep' && v('build:built-wait') === 'keep', 'open and built-waiting builds are kept');
check(!items['build:x-done'], 'finished builds are not listed');
check(v('tracker:side') === 'duplicate' && items['tracker:side'].items === 2, 'a profile\'s copied tracker is a duplicate');
const side = plan.profiles.find((p) => p.id === 'side');
check(side.totals.merge === 1 && side.totals.duplicate === 1 && side.emptyAfter === true, 'totals per profile; a profile with nothing left is flagged');
check(plan.empty.includes('side'), 'empty profiles listed');

const r = P.apply(plan.run, { skip: ['build:patches-web'], by: 'test' });
const after = new Map(readStoreNow().builds.map((b) => [b.id, b]));
check(after.get('merged-pr').status === 'complete' && /done already.*PR #90001/.test(after.get('merged-pr').notes.at(-1).text), 'done → complete with the date and proof in a note');
check(after.get('patches-web').status === 'pending', 'an unticked item is left alone');
check(after.get('x-again').status === 'archived' && !after.get('x-again').deleted, 'duplicate → archived, never deleted');
check(after.get('y-new').status === 'archived' && after.get('y-old').steps.length === 3, 'merge folds the open steps into the target');
check(after.get('y-old').steps.at(-1).origin?.build === 'y-new', 'folded steps remember where they came from');
check(after.get('busy').status === 'running' && after.get('plain').status === 'pending', 'running and kept builds untouched');
check(!existsSync(join(data, 'framework/plan/profiles/side/tracker.json')), 'copied tracker moved out of the profile');
check(existsSync(join(process.env.AXF_MAINT_DATA_DIR, 'profile-cleanup/archive', plan.run, 'side/tracker.json')), '… into the run\'s archive');
check(r.skipped.some((s) => s.key === 'build:patches-web' && s.why === 'unticked'), 'the run records what was unticked');
let threw = false; try { P.apply(plan.run); } catch { threw = true; }
check(threw, 'a preview applies once');

// a build changed after the run is left alone by undo
const { withStore } = await import('../../../../../framework/cli/builds-store.mjs');
withStore((s) => { s.builds.find((b) => b.id === 'all-ticked').notes.push({ text: 'later edit', at: '2026-11-04T00:00:00Z' }); return s; }, { by: 'test' });
const u = P.undo(plan.run, { by: 'test' });
const back = new Map(readStoreNow().builds.map((b) => [b.id, b]));
check(back.get('merged-pr').status === 'pending' && back.get('x-again').status === 'pending' && back.get('y-new').status === 'pending', 'undo puts the builds back');
check(back.get('y-old').steps.length === 1, 'undo takes the folded steps back out');
check(back.get('all-ticked').status === 'complete' && u.undo.left.some((l) => l.id === 'all-ticked'), 'a build changed after the run is left and reported');
check(existsSync(join(data, 'framework/plan/profiles/side/tracker.json')), 'undo puts the tracker copy back');
threw = false; try { P.undo(plan.run); } catch { threw = true; }
check(threw, 'one undo per run');
const runs = P.listRuns();
check(runs[0].run === plan.run && runs[0].state === 'undone', 'runs list shows the run and its state');

// a build changed between preview and apply is skipped
const p2 = P.savePlan(P.audit());
withStore((s) => { s.builds.find((b) => b.id === 'merged-pr').title = 'Renamed'; return s; }, { by: 'test' });
const r2 = P.apply(p2.run, { by: 'test' });
check(r2.skipped.some((s) => s.key === 'build:merged-pr' && /changed/.test(s.why)), 'a build changed since the preview is skipped');

rmSync(scratch, { recursive: true, force: true });
console.log(`profile clean-up: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
