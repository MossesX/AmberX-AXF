#!/usr/bin/env node
// check-land-resolve.mjs: proves the land resolver regenerates generated files and stops on a real source clash.
//
//   node framework/spec/check-land-resolve.mjs [--keep]
//
// Builds a scratch git repo (outside the main checkout, nothing shared with it), copies in the host shim
// (deploy/axf-batch/resolve.py, installed as /opt/axf-batch/resolve.py) and the repo resolver
// (framework/cli/land-resolve.py), plus the generated-files@1 manifest with the same file rules and each generator
// swapped for a stub that writes its output from the merged sources. Then:
//   1. a branch and main both change apps/console-web/axf.lock.json, apps/console-web/src/control/inventory.json and
//      apps/console-web/src/assets/help/framework.json: merging main must resolve all three with no abort, each one
//      regenerated from the merged sources (both sides' new source files listed) and staged;
//   2. both sides change a source file (src/app.mjs) as well: the resolver must stop with exit 1 and
//      "UNRESOLVED: src/app.mjs", and run no generator.
// Exit 0 when both hold. Build land-batch-merge-main-each-finished (Nov 13 2026).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const keep = process.argv.includes('--keep');
const dir = mkdtempSync(join(tmpdir(), 'axf-land-resolve-'));
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };

const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
const put = (p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); };
const read = (p) => readFileSync(join(dir, p), 'utf8');
const commitAll = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
const resolveRun = () => spawnSync('python3', ['-I', join(dir, 'resolve.py'), 'ours'], { cwd: dir, encoding: 'utf8', env: { ...process.env, AXF_ROOT: '/nonexistent' } });

const GENERATED = {
  'rebake': 'apps/console-web/axf.lock.json',
  'control-inventory': 'apps/console-web/src/control/inventory.json',
  'help-sync': 'apps/console-web/src/assets/help/framework.json',
};

try {
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'check'); git('config', 'user.email', 'check@localhost'); git('config', 'commit.gpgsign', 'false');

  // the resolver as deployed: host shim + repo copy, real file rules, stub generators
  copyFileSync(join(ROOT, 'deploy/axf-batch/resolve.py'), join(dir, 'resolve.py'));
  put('framework/cli/land-resolve.py', readFileSync(join(ROOT, 'framework/cli/land-resolve.py'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(ROOT, 'framework/spec/generated-files.json'), 'utf8'));
  for (const [id, gen] of Object.entries(manifest.generators)) {
    const out = GENERATED[id] ? GENERATED[id] : (gen.outputs[0] || '').replace('{app}', 'console-web');
    gen.run = ['node', 'gen.mjs', id, out]; gen.check = null; delete gen.optional;
  }
  manifest.tests = [];
  for (const id of Object.keys(GENERATED)) ok(manifest.files.some((f) => f.generator === id && new RegExp(f.match).test(GENERATED[id])), `manifest rule regenerates ${GENERATED[id]} with ${id}`);
  put('framework/spec/generated-files.json', JSON.stringify(manifest, null, 2) + '\n');
  put('gen.mjs', `import { readdirSync, writeFileSync, appendFileSync } from 'node:fs';
const [id, out] = process.argv.slice(2);
appendFileSync('gen.log', id + '\\n');
writeFileSync(out, JSON.stringify({ generator: id, sources: readdirSync('sources').sort() }, null, 2) + '\\n');
`);
  put('.gitignore', 'gen.log\n');
  put('sources/base.txt', 'base\n');
  put('src/app.mjs', 'export const side = "base";\n');
  for (const f of Object.values(GENERATED)) put(f, JSON.stringify({ generator: 'base', sources: ['base.txt'] }, null, 2) + '\n');
  commitAll('base');

  // 1. generated-file clashes only
  git('checkout', '-q', '-b', 'feat');
  put('sources/feat.txt', 'feat\n');
  for (const f of Object.values(GENERATED)) put(f, JSON.stringify({ generator: 'feat-hand', sources: ['base.txt', 'feat.txt'], stamp: 'feat' }, null, 2) + '\n');
  commitAll('feat');
  git('checkout', '-q', 'main');
  put('sources/main.txt', 'main\n');
  for (const f of Object.values(GENERATED)) put(f, JSON.stringify({ generator: 'main-hand', sources: ['base.txt', 'main.txt'], stamp: 'main' }, null, 2) + '\n');
  commitAll('main');
  git('checkout', '-q', 'feat');
  const m1 = spawnSync('git', ['merge', '-q', '--no-edit', 'main'], { cwd: dir, encoding: 'utf8' });
  const clashed = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean).sort();
  ok(m1.status !== 0 && clashed.length === 3, `merge of main clashes in the three generated files (${clashed.join(', ')})`);
  const r1 = resolveRun();
  ok(r1.status === 0, `generated-file clash resolves with no abort (exit ${r1.status}: ${(r1.stdout + r1.stderr).trim()})`);
  ok(git('diff', '--name-only', '--diff-filter=U').trim() === '', 'no file left in conflict');
  ok(git('diff', '--name-only').trim() === '', 'regenerated outputs are staged (nothing left unstaged)');
  for (const [id, f] of Object.entries(GENERATED)) {
    let j = {}; try { j = JSON.parse(read(f)); } catch { /* checked below */ }
    ok(j.generator === id && ['base.txt', 'feat.txt', 'main.txt'].every((s) => (j.sources || []).includes(s)), `${f} regenerated by ${id} from the merged sources`);
  }
  git('commit', '-q', '--no-edit');

  // 2. a real source clash next to a generated one: stop with the file list, run no generator
  git('checkout', '-q', '-b', 'feat2');
  put('src/app.mjs', 'export const side = "feat2";\n');
  put(GENERATED['control-inventory'], '{"generator":"feat2-hand"}\n');
  commitAll('feat2');
  git('checkout', '-q', 'main');
  put('src/app.mjs', 'export const side = "main2";\n');
  put(GENERATED['control-inventory'], '{"generator":"main2-hand"}\n');
  commitAll('main2');
  git('checkout', '-q', 'feat2');
  writeFileSync(join(dir, 'gen.log'), '');
  spawnSync('git', ['merge', '-q', '--no-edit', 'main'], { cwd: dir, encoding: 'utf8' });
  const r2 = resolveRun();
  ok(r2.status === 1 && /UNRESOLVED: .*src\/app\.mjs/.test(r2.stdout), `source clash stops with the file list (exit ${r2.status}: ${r2.stdout.trim()})`);
  ok(read('gen.log').trim() === '', 'no generator ran while a source clash is open');
  ok(git('diff', '--name-only', '--diff-filter=U').includes('src/app.mjs'), 'src/app.mjs is left in conflict for a person');
} catch (e) {
  fails.push(String(e && e.message || e)); console.log('FAIL ' + (e && e.message || e));
} finally {
  if (keep) console.log('scratch repo kept: ' + dir); else rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `check-land-resolve: ${fails.length} failed` : 'check-land-resolve: ok');
process.exit(fails.length ? 1 : 0);
