/**
 * Tracking files and the lander (build stop-auto-lander-committing-tracking s13), on real git repos in a temp folder:
 *   1. reset before land: a finished build's worktree never commits tracking files; dirty ones and ones its own commits
 *      carried are put back to the merge-base copy with main (one reset commit), code stays
 *   2. a tracking-file conflict when main is merged in takes main's copy and the merge goes on
 *   3. a generated-file conflict takes main's copy, then the generator runs and its output is committed with the merge;
 *      a unioned catalog status reruns the tracker (`then`)
 *   4. any other conflict still stops the merge, files named
 * The generators are stand-ins written into the temp repo (same paths as generated-files@1 names).
 *
 *   node apps/console-web/plugins/push-banner/land/tracking.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cleanWorktree, makeGit, mergeMain } from './land.mjs';
import { verdict, messageFor } from '../../../../../framework/cli/check-tracking-files.mjs';

process.env.AXF_CREW_SAY = 'off';
let pass = 0; let fail = 0;
const check = (ok, what) => { if (ok) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}`); } };

const tmp = mkdtempSync(join(tmpdir(), 'axf-land-tracking-'));
const sh = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const origin = join(tmp, 'origin.git'); const repo = join(tmp, 'repo');
const cfg = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const put = (p, t, cwd = repo) => { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), t); };
const commit = (msg, cwd = repo) => { sh(['add', '-A'], cwd); sh([...cfg, 'commit', '-q', '-m', msg], cwd); };
const show = (rev, p) => sh(['show', `${rev}:${p}`], repo);

try {
  sh(['init', '-q', '--bare', '-b', 'main', origin], tmp);
  sh(['clone', '-q', origin, repo], tmp);
  sh(['checkout', '-q', '-b', 'main'], repo);
  // stand-in generators (control inventory from its source, tracker from catalog status) and the manifest's tests
  put('apps/console-web/scripts/control-inventory.mjs', "import { readFileSync, writeFileSync } from 'node:fs';\nif (!process.argv.includes('--check')) writeFileSync('apps/console-web/src/control/inventory.json', JSON.stringify({ from: readFileSync('src.txt', 'utf8').trim(), regenerated: true }) + '\\n');\n");
  put('framework/cli/tracker.mjs', "import { readFileSync, writeFileSync } from 'node:fs';\nif (!process.argv.includes('--check')) writeFileSync('tracker.json', JSON.stringify({ features: Object.keys(JSON.parse(readFileSync('framework/catalog/status.json', 'utf8'))).sort() }) + '\\n');\n");
  put('framework/spec/check-project-fixtures.mjs', 'process.exit(0);\n');
  put('src.txt', 'base\n'); put('apps/console-web/src/control/inventory.json', '{"from":"base"}\n');
  put('framework/catalog/status.json', '{"a":{"status":"partial"}}\n'); put('tracker.json', '{"features":["a"]}\n');
  put('_claude/builds/store.json', '{"rev":1}\n'); put('_claude/builds/origins.json', '{"origins":{}}\n'); put('framework/plan/pending.json', '{"items":[]}\n');
  put('app.ts', 'one\n');
  commit('base'); sh(['push', '-q', 'origin', 'main'], repo);
  const git = makeGit(repo);
  const s = { repo, slug: 'x/y', dataDir: join(tmp, 'data'), archive: join(tmp, 'archive'), console: 'off', api: '', workflow: 'w', projects: join(tmp, 'projects'), remote: 'origin', base: 'main' };
  const branch = (id, fn) => { sh(['checkout', '-q', '-b', `claude/${id}`, 'main'], repo); fn(); commit(`${id} work`); sh(['push', '-q', 'origin', `claude/${id}`], repo); sh(['checkout', '-q', 'main'], repo); };

  console.log('reset before land');
  branch('reset', () => { put('_claude/builds/store.json', '{"rev":2,"from":"session"}\n'); put('feature.ts', 'x\n'); });
  const wt = join(tmp, 'wt-reset');
  sh(['worktree', 'add', '-q', wt, 'claude/reset'], repo);
  put('_claude/builds/origins.json', '{"origins":{"dirty":1}}\n', wt); put('framework/plan/pending.json', '{"items":[1]}\n', wt);
  const c = cleanWorktree({ s, git, b: { id: 'reset', branch: 'claude/reset' }, wt, dry: false, now: Date.now() + 3600e3 });
  const mb = sh(['merge-base', 'HEAD', 'origin/main'], wt);
  check(!c.committed.length && c.code.length === 0, 'nothing committed for the build, no code held');
  check(['_claude/builds/origins.json', 'framework/plan/pending.json', '_claude/builds/store.json'].every((p) => c.reset.includes(p)), `dirty and branch-committed tracking files reset (${c.reset.join(', ')})`);
  check(!!c.resetCommit && sh(['diff', '--name-only', mb, 'HEAD'], wt) === 'feature.ts', "one reset commit: the branch's diff against main is its code only");
  check(readFileSync(join(wt, '_claude/builds/origins.json'), 'utf8') === '{"origins":{}}\n' && sh(['status', '--porcelain'], wt).split('\n').filter((l) => l && !l.endsWith('.claude-sync-hold')).length === 0, "the worktree holds main's base copies and is clean (the lander's sync hold aside)");
  check(sh(['log', '-1', '--format=%s', 'origin/claude/reset'], repo).includes("reset tracking files to main's base copy"), 'the reset commit is pushed');

  // main moves on: tracking files, generated files, catalog status and code
  console.log('merging main into a build');
  branch('track', () => { put('_claude/builds/store.json', '{"rev":5,"from":"branch"}\n'); put('framework/plan/pending.json', '{"items":["branch"]}\n'); put('t.ts', 'x\n'); });
  branch('gen', () => { put('apps/console-web/src/control/inventory.json', '{"from":"branch"}\n'); put('framework/catalog/status.json', '{"a":{"status":"partial"},"b":{"status":"built"}}\n'); put('g.ts', 'x\n'); });
  branch('code', () => { put('app.ts', 'branch\n'); put('_claude/builds/store.json', '{"rev":6,"from":"code"}\n'); });
  put('_claude/builds/store.json', '{"rev":9,"from":"main"}\n'); put('framework/plan/pending.json', '{"items":["main"]}\n');
  put('src.txt', 'main\n'); put('apps/console-web/src/control/inventory.json', '{"from":"main-stale"}\n');
  put('framework/catalog/status.json', '{"a":{"status":"built"},"c":{"status":"partial"}}\n');
  put('app.ts', 'main\n');
  commit('main moves'); sh(['push', '-q', 'origin', 'main'], repo);
  sh(['fetch', '-q', 'origin'], repo);

  const t = mergeMain({ s, git, b: { id: 'track', branch: 'claude/track' }, dry: true });
  check(t.merged && t.tracking?.includes('_claude/builds/store.json') && t.tracking.includes('framework/plan/pending.json'), `tracking conflicts resolved, the merge went on (${(t.tracking || []).join(', ')})`);
  check(t.merged && show(t.sha, '_claude/builds/store.json').includes('"from":"main"') && show(t.sha, 'framework/plan/pending.json').includes('main'), "main's copy of each tracking file is in the merge");

  const g = mergeMain({ s, git, b: { id: 'gen', branch: 'claude/gen' }, dry: true });
  check(g.merged && g.regenerated?.includes('control-inventory'), `a generated-file conflict regenerates (${(g.regenerated || []).join(', ')})`);
  check(g.merged && JSON.parse(show(g.sha, 'apps/console-web/src/control/inventory.json')).regenerated === true && JSON.parse(show(g.sha, 'apps/console-web/src/control/inventory.json')).from === 'main', 'the regenerated inventory (not either side) is committed with the merge');
  check(g.merged && g.regenerated.includes('tracker') && JSON.parse(show(g.sha, 'tracker.json')).features.join() === 'a,b,c', 'a unioned catalog status reruns the tracker: tracker.json has both sides');

  const k = mergeMain({ s, git, b: { id: 'code', branch: 'claude/code' }, dry: true });
  check(!k.merged && k.conflicts?.join() === 'app.ts', `any other conflict still stops, file named (${(k.conflicts || []).join(', ')})`);
  check(sh(['rev-parse', 'origin/claude/code'], repo) === sh(['rev-parse', 'claude/code'], repo), 'the stopped build is left as it was');

  console.log('CI guard (framework/cli/check-tracking-files.mjs)');
  const commits = { '_claude/builds/store.json': [{ sha: 'a'.repeat(40), subject: 'my work', files: ['_claude/builds/store.json', 'x.ts'] }], '_claude/builds/origins.json': [{ sha: 'b'.repeat(40), subject: 'Builds live: x [skip ci]', files: ['_claude/builds/origins.json'] }] };
  const v = verdict([{ status: 'M', path: '_claude/builds/store.json' }, { status: 'M', path: '_claude/builds/origins.json' }, { status: 'D', path: '_claude/builds/journal/2026-11.jsonl' }, { status: 'M', path: 'x.ts' }], (p) => commits[p] || []);
  check(!v.ok && v.offending.map((o) => o.path).join() === '_claude/builds/store.json', 'a tracking file changed by a work commit fails; a status commit and removing a journal part do not');
  check(/_claude\/builds\/store\.json is a tracking file \(builds-store\)/.test(messageFor(v.offending[0])) && /git checkout origin\/main -- _claude\/builds\/store\.json/.test(messageFor(v.offending[0])), 'the message names the file and the fix');
} catch (e) { fail++; console.log(`  ✗ ${e.stack || e.message}`); }
finally { rmSync(tmp, { recursive: true, force: true }); }

console.log(`tracking files: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`);
if (fail) process.exitCode = 1;
