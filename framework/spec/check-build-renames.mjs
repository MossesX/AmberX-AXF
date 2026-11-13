#!/usr/bin/env node
// build-renames@1 — builds moved to a short id: the pure core, the store, old-id lookups through every CLI, and one
// end-to-end rename (worktree, branch, PR, store, renames.json) on a scratch repo with a fake GitHub.
//   node framework/spec/check-build-renames.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as r from '../core/build-renames.mjs';
import * as c from '../plan/builds-store-core.mjs';
import * as m from '../plan/builds-merge-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const LONG = 'owner-recognized-everywhere-veto-countdown-only-on-shell-commands';
const rec = (id, extra = {}) => c.normBuild({ id, title: `Title of ${id}`, branch: `claude/${id}`, pr: '#559', profiles: ['all'], order: { all: 0 }, steps: [{ id: 's1', text: 'x', model: 'Opus' }, { id: 's2', text: 'y', model: 'Opus' }], ...extra });

// ------------------------------------------------------------------ pure core
await t('shortId: ≤ 40, filler words dropped, cut at a dash, ids that fit unchanged', () => {
  assert.equal(r.shortId(LONG), 'owner-recognized-everywhere-veto');
  assert.equal(r.shortId('fix-the-step-splitter-claude-exit-1-input-must-b'), 'fix-step-splitter-claude-exit-1-input');
  assert.equal(r.shortId('to-do-notes'), 'to-do-notes');
  for (const id of [LONG, 'a'.repeat(90), 'the-' + 'x'.repeat(60)]) { const s = r.shortId(id); assert.ok(r.ID_RE.test(s), s); }
});
await t('shortId: a collision gets -2, -3 inside 40 characters', () => {
  const taken = new Set(['owner-recognized-everywhere-veto']);
  const a = r.shortId(LONG, (x) => taken.has(x)); taken.add(a);
  const b = r.shortId(LONG, (x) => taken.has(x));
  assert.equal(a, 'owner-recognized-everywhere-veto-2'); assert.equal(b, 'owner-recognized-everywhere-veto-3'); assert.ok(b.length <= 40);
});
await t('resolveRename follows chains, leaves unknown ids alone, survives a loop', () => {
  assert.equal(r.resolveRename({ a: 'b', b: 'c' }, 'a'), 'c');
  assert.equal(r.resolveRename({ a: 'b' }, 'x'), 'x');
  assert.equal(r.resolveRename({ a: 'b', b: 'a' }, 'a'), 'a');
  assert.deepEqual(r.formerIds({ a: 'b', b: 'c', d: 'e' }, 'c').sort(), ['a', 'b']);
});
await t('addRename re-points earlier renames and refuses a renamed target', () => {
  assert.deepEqual(r.addRename({ a: 'b' }, 'b', 'c'), { a: 'c', b: 'c' });
  assert.throws(() => r.addRename({ b: 'c' }, 'a', 'b'), /renamed/);
  assert.throws(() => r.addRename({}, 'a', 'a'));
  assert.equal(r.renamesText({ z: 'y', a: 'b' }), '{\n "a": "b",\n "z": "y"\n}\n');
});
await t('renameInStore: new record keeps title, steps and notes; the old one is a soft-deleted tombstone', () => {
  const s = { ...c.emptyStore(), builds: [rec(LONG, { notes: [{ text: 'hello', at: '2026-11-01T00:00:00Z' }] })] };
  const { record, tombstone } = r.renameInStore(s, LONG, 'owner-recognized-everywhere-veto', { pr: '#600', at: '2026-11-13T00:00:00Z' });
  assert.equal(record.title, `Title of ${LONG}`); assert.equal(record.branch, 'claude/owner-recognized-everywhere-veto'); assert.equal(record.pr, '#600');
  assert.equal(record.steps.length, 2); assert.ok(record.notes.some((x) => x.text === 'hello'));
  assert.equal(tombstone.deleted, true); assert.match(tombstone.notes.at(-1).text, /Renamed to owner-recognized-everywhere-veto/);
  assert.equal(c.findBuild(s, 'owner-recognized-everywhere-veto'), record);
  assert.ok(c.validateStore(c.normalizeStore(s)).ok);
  assert.throws(() => r.renameInStore(s, LONG, 'owner-recognized-everywhere-veto'), /already a build/);
});
await t('a stale copy of the old record (an older checkout) never brings it back', () => {
  const stale = { ...c.emptyStore(), builds: [rec(LONG, { updatedAt: '2026-11-12T00:00:00Z' })] };
  const main = JSON.parse(JSON.stringify(stale));
  r.renameInStore(main, LONG, 'short-one', { at: '2026-11-13T00:00:00Z' });
  const { store } = m.mergeStores(main, stale);
  assert.equal(store.builds.find((b) => b.id === LONG).deleted, true);
  assert.equal(store.builds.filter((b) => !b.deleted).map((b) => b.id).join(), 'short-one');
});

// ------------------------------------------------------------------ store + CLIs on a temp store
const dir = mkdtempSync(join(tmpdir(), 'axf-renames-'));
const storeF = join(dir, 'store.json');
const env = { ...process.env, AXF_BUILDS_STORE: storeF, AXF_BUILDS_LIVE: '0', AXF_BUILDS_EXPORT: '0', AXF_ACTOR: 'check' };
writeFileSync(storeF, JSON.stringify({ ...c.emptyStore(), builds: [rec(LONG)] }));
const node = (file, ...args) => execFileSync(process.execPath, [join(ROOT, file), ...args], { env, encoding: 'utf8' }).trim();
process.env.AXF_BUILDS_STORE = storeF; process.env.AXF_BUILDS_LIVE = '0'; process.env.AXF_BUILDS_EXPORT = '0';
const store = await import('../cli/builds-store.mjs');

await t('renameBuildNow writes the store and renames.json next to it', () => {
  store.renameBuildNow(LONG, 'owner-veto', { pr: '#600', by: 'check' });
  assert.deepEqual(JSON.parse(readFileSync(store.renamesFile(), 'utf8')), { [LONG]: 'owner-veto' });
  const s = store.loadStore();
  assert.equal(c.findBuild(s, 'owner-veto').title, `Title of ${LONG}`);
  assert.equal(c.findBuild(s, LONG).deleted, true);
  assert.ok(c.validateStore(s).ok, 'step uids stay unique');
  assert.equal(store.resolveBuildId(LONG), 'owner-veto'); assert.equal(store.resolveBuildId('other'), 'other');
});
await t('the orchestrator CLI ticks a step by the old id on the renamed build', () => {
  node('apps/console-web/plugins/build-orchestrator/orchestrator.mjs', 'act', 'step', LONG, 's1');
  const s = store.loadStore();
  assert.equal(c.findBuild(s, 'owner-veto').steps.find((x) => x.id === 's1').done, true);
  assert.equal(c.findBuild(s, LONG).steps.length, 0, 'the tombstone has no steps: they moved');
  assert.match(node('apps/console-web/plugins/build-orchestrator/orchestrator.mjs', 'next', LONG), /\(owner-veto\)/);
});
await t('pipeline show and builds-live link take the old id', () => {
  assert.equal(JSON.parse(node('apps/console-web/plugins/build-orchestrator/pipeline.mjs', 'show', LONG, '--json')).build.id, 'owner-veto');
  node('framework/cli/builds-live.mjs', 'link', LONG, '--pr', '601');
  assert.equal(c.findBuild(store.loadStore(), 'owner-veto').pr, '#601');
  assert.equal(node('framework/cli/build-rename.mjs', 'resolve', LONG), 'owner-veto');
});

// ------------------------------------------------------------------ end to end on a scratch repo
const sh = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const origin = join(dir, 'origin.git'); const main = join(dir, 'main'); const wt = join(dir, 'wt');
sh(dir, 'init', '-q', '--bare', '-b', 'main', origin);
sh(dir, 'clone', '-q', origin, main);
sh(main, 'config', 'user.email', 'check@example.invalid'); sh(main, 'config', 'user.name', 'check');
const B = 'remove-ui-review-as-a-gate-no-screenshots-required-prs-never-held-as-draft-for';
mkdirSync(join(main, '_claude/builds/reports'), { recursive: true });
writeFileSync(join(main, '_claude/builds/reports/other.md'), '# other\n');
writeFileSync(join(main, '_claude/THREADS.md'), `| Row (\`${B}\`) |\n\n## Live build log\n- \`${B}\` added\n`);
sh(main, 'add', '-A'); sh(main, 'commit', '-q', '-m', 'base'); sh(main, 'push', '-q', 'origin', 'main');
mkdirSync(wt);
sh(main, 'worktree', 'add', '-q', '-b', `claude/${B}`, join(wt, B));
writeFileSync(join(wt, B, `_claude/builds/reports/${B}.md`), `# ${B}\nBranch: claude/${B}\n`);
sh(join(wt, B), 'add', '-A'); sh(join(wt, B), 'commit', '-q', '-m', 'work'); sh(join(wt, B), 'push', '-q', 'origin', `claude/${B}`);
writeFileSync(storeF, JSON.stringify({ ...c.emptyStore(), builds: [rec(B, { pr: '#576' })] }));
writeFileSync(store.renamesFile(), '{}\n');
const calls = [];
const gh = { json: async (method, path, body) => {
  calls.push([method, path, body]);
  if (method === 'GET') return [{ number: 576, title: 'Remove UI review as a gate', body: 'Body.', draft: false, base: { ref: 'main' }, labels: [{ name: 'build' }] }];
  if (method === 'POST' && path.endsWith('/pulls')) return { number: 590 };
  return {};
} };
process.env.AXF_PIPELINE_WORKTREES = wt; process.env.AXF_BUILD_RENAME_REPO = 'owner/repo';
const cli = await import('../cli/build-rename.mjs');

await t('apply --dry changes nothing; a new name that is a prefix of the old branch is not taken', async () => {
  const d = await cli.apply(B, 'remove-ui-review-as-a-gate-no', { dry: true, gh });
  assert.ok(d.steps.length >= 6); assert.ok(existsSync(join(wt, B)));
  assert.ok(d.steps.includes(`delete origin claude/${B}`));
});
await t('apply moves folder, branch, PR, store and renames.json; branch files follow the new id', async () => {
  const to = 'remove-ui-review-gate-no-screenshots';
  const out = await cli.apply(B, to, { gh, by: 'check' });
  assert.equal(out.pr, '#590'); assert.equal(out.replaced, '#576');
  assert.ok(!existsSync(join(wt, B)) && existsSync(join(wt, to)));
  assert.equal(sh(join(wt, to), 'rev-parse', '--abbrev-ref', 'HEAD'), `claude/${to}`);
  const heads = sh(main, 'ls-remote', '--heads', 'origin');
  assert.ok(heads.includes(`refs/heads/claude/${to}`)); assert.ok(!heads.includes(`refs/heads/claude/${B}`));
  assert.ok(existsSync(join(wt, to, `_claude/builds/reports/${to}.md`)));
  assert.match(readFileSync(join(wt, to, `_claude/builds/reports/${to}.md`), 'utf8'), new RegExp(`claude/${to}\\n`));
  const threads = readFileSync(join(wt, to, '_claude/THREADS.md'), 'utf8');
  assert.ok(threads.startsWith(`| Row (\`${to}\`) |`)); assert.ok(threads.includes(`- \`${B}\` added`), 'the live log stays history');
  assert.match(sh(join(wt, to), 'log', '-1', '--format=%s'), /^Rename build /);
  const create = calls.find(([meth, p]) => meth === 'POST' && p.endsWith('/pulls'))[2];
  assert.equal(create.head, `claude/${to}`); assert.equal(create.title, 'Remove UI review as a gate'); assert.match(create.body, /^Body\.\n\nReplaces #576/);
  assert.ok(calls.some(([meth, p, body]) => meth === 'PATCH' && p.endsWith('/pulls/576') && body.state === 'closed'));
  assert.ok(calls.some(([meth, p]) => meth === 'POST' && p.endsWith('/issues/576/comments')));
  const b = c.findBuild(store.loadStore(), to);
  assert.equal(b.pr, '#590'); assert.equal(b.branch, `claude/${to}`); assert.equal(b.title, `Title of ${B}`);
  assert.equal(store.resolveBuildId(B), to);
});
await t('apply refuses a name that is taken or too long', async () => {
  await assert.rejects(cli.apply('remove-ui-review-gate-no-screenshots', 'x'.repeat(41), { gh }), /not a valid build name/);
});

console.log(`ok: build-renames@1 (${n} checks)`);
