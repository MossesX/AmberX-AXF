// Self-test: node apps/console-web/plugins/build-orchestrator/build-id.test.mjs
// build-id@1 in the orchestrator: add / import / request make ids of at most 40 characters (the vps tools' pattern),
// titles stay whole, collisions get suffixes, and builds with older long ids get an alias that every command and the
// landing path (land-alias) accept. Runs the CLIs on a scratch store.
process.env.AXF_CREW_SAY ??= 'off';
process.env.AXF_BUILD_LIMIT ??= 'off';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as orch from './web/orchestrator-core.mjs';

const PLUGIN = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(PLUGIN, '../../../..');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LONG = 'One to-do notes and tasks plugin in the console, take it out of AmberX';

t('orchestrator core: add from a long title → valid id, title unchanged; same title again refused; a shortening collision gets a suffix', () => {
  let s = orch.emptyState();
  const r1 = orch.apply(s, { action: 'add', title: LONG }); s = r1.state;
  assert.equal(r1.build.id, 'one-to-do-notes-tasks-plugin-console'); assert.equal(r1.build.title, LONG);
  assert.throws(() => orch.apply(s, { action: 'add', title: 'one to do notes tasks plugin console' }), /already/);
  const r2 = orch.apply(s, { action: 'add', title: `${LONG} and the phone` }); s = r2.state;
  assert.equal(r2.build.id, 'one-to-do-notes-tasks-plugin-console-2'); assert.equal(r2.build.title, `${LONG} and the phone`);
  const r3 = orch.apply(s, { action: 'add', id: 'axhub-raise-per-project-memory-file-cap-from-500-to-750', title: 'Raise the cap' });
  assert.equal(r3.build.id, 'axhub-raise-per-project-memory-file-cap', 'a long id the caller gave is shortened too');
});
t('orchestrator core: import from a pending item with a long id → valid id, pendingId and title kept; importing it twice is refused', () => {
  const it = { id: 'one-to-do-notes-and-tasks-plugin-in-the-console-take-it-out-of-amberx', title: LONG, model: 'Opus', subPrompts: [{ text: 'do it' }] };
  const r = orch.apply(orch.emptyState(), { action: 'import', item: it });
  assert.match(r.build.id, RE); assert.equal(r.build.pendingId, it.id); assert.equal(r.build.title, LONG);
  assert.throws(() => orch.apply(r.state, { action: 'import', item: it }), /already/);
});
// ---------------- CLIs on a scratch store
{
  const tmp = mkdtempSync(join(tmpdir(), 'axf-build-id-'));
  const storeFile = join(tmp, 'store.json'); const wt = join(tmp, 'wt'); mkdirSync(wt, { recursive: true });
  const legacyId = `old-build-made-before-the-forty-character-rule-${process.pid}`;
  writeFileSync(storeFile, JSON.stringify({ $axf: 'builds@1', rev: 1, builds: [{ id: legacyId, title: 'Old build made before the forty character rule', status: 'built', profiles: ['all'], branch: `claude/${legacyId}`, pr: '999', steps: [{ id: 's1', text: 'one', model: 'Opus' }] }] }));
  mkdirSync(join(wt, legacyId));
  const env = { ...process.env, AXF_BUILDS_STORE: storeFile, AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_SHIPPED: 'off', AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_PIPELINE_WORKTREES: wt, AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all', AXF_ACTOR: 'check' };
  const run = (file, ...args) => { const r = spawnSync(process.execPath, [join(PLUGIN, file), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 }); if (r.status !== 0) throw new Error(`${file} ${args.join(' ')}: ${r.stderr || r.stdout}`); return JSON.parse(r.stdout.trim().split('\n').pop()); };
  const read = () => JSON.parse(readFileSync(storeFile, 'utf8'));

  t('cli request: a long title files a build with a valid id and the full title', () => {
    const a = run('pipeline.mjs', 'request', '--title', LONG, '--json');
    const b = run('pipeline.mjs', 'request', '--title', LONG, '--json');
    assert.equal(a.id, 'one-to-do-notes-tasks-plugin-console'); assert.equal(b.id, 'one-to-do-notes-tasks-plugin-console-2');
    assert.equal(a.build.title, LONG); assert.equal(b.build.title, LONG);
  });
  t('cli act add: a long title gets a valid id', () => {
    const r = run('orchestrator.mjs', 'act', JSON.stringify({ action: 'add', title: 'axhub raise per-project memory file cap from 500 to 750' }), '--json');
    assert.equal(r.build.id, 'axhub-raise-per-project-memory-file-cap'); assert.match(r.build.id, RE);
  });
  t('cli aliases: lists, then saves, an alias for the legacy long id; id, branch and PR unchanged', () => {
    const dry = run('pipeline.mjs', 'aliases', '--json'); assert.equal(dry.applied, false); assert.deepEqual(dry.aliases.map((x) => x.id), [legacyId]);
    assert.equal(read().builds.find((b) => b.id === legacyId).alias, undefined, 'a dry run writes nothing');
    const r = run('pipeline.mjs', 'aliases', '--apply', '--json'); const alias = r.aliases[0].alias; assert.match(alias, RE);
    const b = read().builds.find((x) => x.id === legacyId); assert.equal(b.alias, alias); assert.equal(b.branch, `claude/${legacyId}`); assert.equal(b.pr, '999');
    assert.equal(run('pipeline.mjs', 'aliases', '--json').aliases.length, 0, 'a second pass has nothing to do');
  });
  t('cli: every command takes the alias for the id', () => {
    const alias = read().builds.find((x) => x.id === legacyId).alias;
    assert.equal(run('pipeline.mjs', 'show', alias, '--json').build.id, legacyId);
    run('orchestrator.mjs', 'act', 'note', alias, 'noted through the alias', '--json');
    assert.ok(read().builds.find((x) => x.id === legacyId).notes.some((x) => x.text === 'noted through the alias'));
    assert.equal(run('orchestrator.mjs', 'next', alias, '--json').id, legacyId);
  });
  t('cli land-alias: the folder, the alias or the id all give the landing path; <worktrees>/<alias> is a link to the folder', () => {
    const alias = read().builds.find((x) => x.id === legacyId).alias;
    const r = run('pipeline.mjs', 'land-alias', join(wt, legacyId), '--json');
    assert.equal(r.id, legacyId); assert.equal(r.alias, alias); assert.equal(r.dir, join(wt, alias)); assert.ok(lstatSync(join(wt, alias)).isSymbolicLink());
    assert.ok(existsSync(join(wt, alias)));
    assert.equal(run('pipeline.mjs', 'land-alias', alias, '--json').linked, false, 'a second call keeps the link');
    assert.equal(run('pipeline.mjs', 'land-alias', 'one-to-do-notes-tasks-plugin-console', '--json').alias, 'one-to-do-notes-tasks-plugin-console', 'a valid id is its own landing name');
  });
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`build-orchestrator build-id: ${n} checks passed`);
