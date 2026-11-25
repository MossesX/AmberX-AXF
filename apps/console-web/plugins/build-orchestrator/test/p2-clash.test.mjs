#!/usr/bin/env node
/**
 * build-clash@1: a conflict with main never fails a step. On real git (a scratch origin and a step worktree):
 * pulling main into a step's branch that conflicts leaves the merge open and names the files (cutWorktree), a second
 * pull sees the same open clash, the step's brief tells its session to resolve it first, and a clean pull stays clean.
 *   node apps/console-web/plugins/build-orchestrator/test/p2-clash.test.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const tmp = mkdtempSync(join(tmpdir(), 'axf-p2clash-'));
Object.assign(process.env, { AXF_BUILDS_STORE: join(tmp, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_DATA_DIR: 'off', AXF_SHIPPED: 'off', AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_CREW_SAY: 'off', AXF_PIPELINE_CONSOLE: 'off' });
const F = await import('../pipeline2.mjs');
const BC = await import('../../../../../framework/core/build-clash.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: ${JSON.stringify(a)} != ${JSON.stringify(b)}`}`);
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };

// origin with main; a seed clone that moves main; the step's worktree on its own branch
const origin = join(tmp, 'origin.git'); mkdirSync(origin); git(origin, 'init', '-q', '--bare', '-b', 'main');
const seed = join(tmp, 'seed'); git(tmp, 'clone', '-q', origin, seed);
writeFileSync(join(seed, 'shared.txt'), 'one\n'); writeFileSync(join(seed, 'other.txt'), 'a\n');
git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'base'); git(seed, 'push', '-q', 'origin', 'HEAD:main');
const wt = join(tmp, 'wt'); mkdirSync(wt);
const b = { id: 'build', title: 'Build', steps: [] }; const s = { id: 's1', text: 'Change the shared file' };
const dir = join(wt, F.stepName(b, s));
git(tmp, 'clone', '-q', origin, dir); git(dir, 'checkout', '-q', '-b', `claude/${F.stepName(b, s)}`);
for (const k of ['user.name', 'user.email']) git(dir, 'config', k, k === 'user.name' ? 't' : 't@example.invalid');
const env = { ...process.env, AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'git' };

console.log('main moved without touching the step\'s files: a clean pull');
writeFileSync(join(seed, 'other.txt'), 'b\n'); git(seed, 'commit', '-q', '-am', 'main: other'); git(seed, 'push', '-q', 'origin', 'HEAD:main');
let r = F.cutWorktree(b, s, env);
eq([r.conflicts ?? null, readFileSync(join(dir, 'other.txt'), 'utf8')], [null, 'b\n'], 'main is in, nothing to fix');

console.log('main and the step changed the same lines: the merge stays open for the step\'s session');
writeFileSync(join(dir, 'shared.txt'), 'step\n'); git(dir, 'commit', '-q', '-am', 'step: shared');
writeFileSync(join(seed, 'shared.txt'), 'main\n'); git(seed, 'commit', '-q', '-am', 'main: shared'); git(seed, 'push', '-q', 'origin', 'HEAD:main');
let threw = null; try { r = F.cutWorktree(b, s, env); } catch (e) { threw = e; }
ok(!threw, `a conflict is not an error (${threw?.message ?? 'none'})`);
eq(r.conflicts, ['shared.txt'], 'the conflicting files are named');
ok(/<<<<<<< /.test(readFileSync(join(dir, 'shared.txt'), 'utf8')) && git(dir, 'status', '--porcelain').includes('UU shared.txt'), 'the merge is left open in the worktree');
eq(F.cutWorktree(b, s, env).conflicts, ['shared.txt'], 'a second pull sees the same open clash (no second merge on top)');

console.log('the step keeps the clash on its record and its brief says to resolve it first');
const kept = P2.normFields({ status: 'ready', clashFix: { at: 'T', with: 'main', files: r.conflicts }, waitsFor: { buildId: 'x', number: 'B-1', title: 'X' } }, 'step');
eq([kept.clashFix, kept.waitsFor], [{ at: 'T', with: 'main', files: ['shared.txt'] }, { buildId: 'x', number: 'B-1', title: 'X' }], 'clashFix and waitsFor are fields of the step contract');
ok(!('clashFix' in P2.normFields({ status: 'ready', clashFix: null }, 'step')), 'a cleared clash leaves nothing behind');
const brief = F.briefOf(b, { ...s, model: 'Opus', worktree: dir, branch: 'claude/build--s1', clashFix: kept.clashFix });
ok(/## First: the clash with main/.test(brief) && /shared\.txt/.test(brief) && brief.indexOf('## First: the clash with main') < brief.indexOf('## Your step'), 'the fix comes before the step in the brief');
ok(!/clash with main/.test(F.briefOf(b, { ...s, model: 'Opus', worktree: dir, branch: 'x' })), 'a step with no clash gets the plain brief');

console.log('once the session resolved it, the next pull is clean');
writeFileSync(join(dir, 'shared.txt'), 'main\nstep\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '--no-edit');
eq(F.cutWorktree(b, s, env).conflicts ?? null, null, 'resolved: main is in');

console.log('the answers');
const rec = BC.clashRecord({ id: 'new', steps: [{ id: 's1', files: ['a/x.mjs'] }, { id: 's2', files: ['b/y.mjs'] }] }, [{ id: 'other', flow: 'pipeline-2', status: 'building', number: 'B-0002', title: 'Other', steps: [{ id: 's1', files: ['a/'] }] }], { at: 'T' });
const auto = BC.autoAnswer({ clash: rec }, { at: 'T2' }).clash;
eq([auto.rejected, auto.answer, auto.auto, auto.answeredBy, /^Clash: /.test(auto.reason)], [false, 'run-all', true, 'pipeline', true], 'the pipeline answers run-all by itself');
ok(!BC.isRejected({ clash: auto }) && BC.canAnswer({ clash: auto }) && BC.autoAnswer({ clash: auto }) === null, 'nothing waits; a hand answer is still open; it is not answered twice');
const byHand = BC.answerClash({ id: 'new', clash: auto }, 'defer', { by: 'brett', at: 'T3' });
eq([byHand.clash.answer, byHand.clash.answeredBy, 'auto' in byHand.clash, byHand.defer.map((d) => d.step)], ['defer', 'brett', false, ['s1']], 'a hand answer replaces it');
ok(!BC.canAnswer({ clash: byHand.clash }), 'and stands');
eq(BC.normClash(JSON.parse(JSON.stringify(auto))), auto, 'the answered record survives its normaliser');

console.log(failed ? `✗ p2-clash: ${failed} of ${n} failed` : `ok p2-clash: ${n}/${n}`);
process.exit(failed ? 1 : 0);
