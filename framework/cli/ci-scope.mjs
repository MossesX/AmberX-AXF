#!/usr/bin/env node
/**
 * CI scope (build merge-queue, Brett Nov 4 2026: "We're paying to do these CI checks twice."). Decides, from the files a
 * change touches, which CI jobs and app builds it needs, and whether a push to main is code the merge queue already
 * tested. Plain Node, no install, no model calls. `.github/workflows/android.yml`'s `scope` job runs it first and every
 * other job reads its outputs.
 *
 *   node framework/cli/ci-scope.mjs files <file>…                    the scope of these paths (JSON)
 *   node framework/cli/ci-scope.mjs gha --event <e> --ref <r> [--before <sha>]   GitHub Actions outputs (key=value lines)
 *   node framework/cli/ci-scope.mjs light [--run]                     the light PR checks for this change (or run them)
 *
 * Three modes:
 *   full   a queue branch (queue/pr-<n>), a workflow_dispatch, or any PR while the merge queue is off: every job the
 *          change touches (path filters below), nothing else;
 *   light  a PR while the merge queue is on (repo variable AXF_MERGE_QUEUE=on, set by the queue runner): the cheap
 *          checks only (framework validators, the console type-check, the touched plugins' own tests); the full set
 *          runs once, in the merge queue;
 *   main   a push to main: when the merge queue already ran CI green on the same code (a queue/pr-* commit whose files
 *          match main's outside _claude/), nothing runs again except the Android publish when Android changed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPE_FRAME = 'ci-scope@1';
/** The jobs (and app builds inside the console job) a change can need. */
export const KEYS = Object.freeze(['engine', 'console', 'axhubweb', 'amberxweb', 'molly', 'walkthrough', 'amberx', 'android']);
const ALL = Object.freeze(Object.fromEntries(KEYS.map((k) => [k, true])));

/** Paths → what they need, first match wins. Anything not listed runs everything (an unknown path is never skipped). */
export const RULES = Object.freeze([
  // the shared framework every app bakes, the fixtures both ports must match, and CI itself: everything
  { re: /^\.github\//, needs: 'all' },
  { re: /^framework\/(core|react|ui|schemas|libs|assets)\//, needs: 'all' },
  { re: /^framework\/spec\/fixtures\//, needs: 'all' },
  { re: /^framework\/android\//, needs: ['engine', 'android'] },
  { re: /^framework\//, needs: ['engine', 'console'] },
  { re: /^apps\/console-web\//, needs: ['engine', 'console'] },
  { re: /^apps\/axhub-web\//, needs: ['engine', 'console', 'axhubweb'] },
  { re: /^apps\/amberx-droid\//, needs: ['engine', 'console', 'amberxweb', 'amberx'] },
  { re: /^apps\/molly\//, needs: ['engine', 'console', 'molly'] },
  { re: /^apps\/walkthrough-studio\//, needs: ['engine', 'console', 'walkthrough'] },
  { re: /^apps\/(console|voicevault|axhub-android)\//, needs: ['engine', 'android'] },
  { re: /^apps\/demo\//, needs: ['engine'] },
  { re: /^deploy\//, needs: ['engine', 'console'] },
  // data and docs: the builds store, tracker and manifests are checked by the engine sweep
  { re: /^_claude\//, needs: ['engine'] },
  { re: /^(tracker\.json|project\.manifest\.json|\.mcp\.json)$/, needs: ['engine'] },
  { re: /^[^/]+\.md$/, needs: [] },
  { re: /^\.(gitignore|gitattributes|axf-queue\.log)$/, needs: [] },
]);

const clean = (p) => String(p || '').trim().replace(/^\.\//, '');

/** What one path needs: a list of keys, or 'all'. */
export function needsOf(path) {
  const p = clean(path);
  const r = RULES.find((x) => x.re.test(p));
  return r ? r.needs : 'all';
}

/** The scope of a change: { engine: bool, console: bool, … , files: n, why: { key: first path that needs it } }. */
export function scopeFor(files) {
  const out = Object.fromEntries(KEYS.map((k) => [k, false]));
  const why = {};
  const list = (files || []).map(clean).filter(Boolean);
  for (const f of list) {
    const n = needsOf(f);
    for (const k of n === 'all' ? KEYS : n) { if (!out[k]) why[k] = f; out[k] = true; }
  }
  return { ...out, files: list.length, why };
}

/** Is the code at two commits the same, given the files that differ between them? Status data under _claude/ doesn't count. */
export const sameCode = (diffFiles) => (diffFiles || []).map(clean).filter(Boolean).every((f) => f.startsWith('_claude/'));

/** The console plugins a change touches (folder names). */
export function touchedPlugins(files) {
  const out = new Set();
  for (const f of (files || []).map(clean)) { const m = f.match(/^apps\/console-web\/plugins\/([^/_][^/]*)\//); if (m) out.add(m[1]); }
  return [...out].sort();
}

/**
 * The light PR checks, as shell commands. Always the cheap framework validators; the console type-check when the
 * console or the framework it bakes changed; each touched plugin's own tests (test.py, test.mjs, test.mts,
 * land/*.test.mjs …) found on disk (`exists`).
 */
export function lightCommands(files, { exists = () => false, list = () => [] } = {}) {
  const s = scopeFor(files);
  const cmds = [
    'node framework/cli/axf.mjs validate --framework',
    'node framework/cli/tracker.mjs --check',
    'node framework/cli/project.mjs validate --all',
    'node framework/cli/builds-store.mjs verify',
    'node framework/cli/check-theme.mjs',
    'node framework/cli/check-controls.mjs',
    'node framework/cli/check-toolbars.mjs',
  ];
  if (s.console) {
    cmds.push('(cd apps/console-web && rm -rf src/axf && mkdir -p src/axf && for d in core react ui schemas libs; do cp -r ../../framework/$d src/axf/; done && node ../../framework/cli/shared-assets.mjs bake . && npm ci --no-audit --no-fund --silent && npx tsc --noEmit)');
  }
  for (const p of touchedPlugins(files)) {
    const dir = `apps/console-web/plugins/${p}`;
    if (exists(`${dir}/test.py`)) cmds.push(`python ${dir}/test.py`);
    if (exists(`${dir}/test.mjs`)) cmds.push(`node ${dir}/test.mjs`);
    if (exists(`${dir}/test.mts`)) cmds.push(`node --experimental-strip-types ${dir}/test.mts`);
    for (const t of list(dir).filter((x) => /\.test\.mjs$/.test(x))) cmds.push(`node ${dir}/${t}`);
  }
  if (files.map(clean).includes('framework/cli/ci-scope.mjs') || files.map(clean).some((f) => f.startsWith('.github/'))) cmds.push('node framework/spec/check-ci-scope.mjs');
  return cmds;
}

/**
 * The outputs for the workflow: mode + one true/false per key + light + tested.
 *   event: pull_request | push | workflow_dispatch …; ref: the branch; queueOn: repo variable AXF_MERGE_QUEUE == 'on';
 *   files: what the change touches; tested: (main pushes) the merge queue already ran CI green on this code.
 */
export function outputs({ event, ref, queueOn = false, files = [], tested = false }) {
  const s = scopeFor(files);
  const off = Object.fromEntries(KEYS.map((k) => [k, false]));
  let mode = 'full'; let jobs = s; let light = false;
  if (event === 'pull_request' && queueOn) { mode = 'light'; jobs = off; light = true; }
  else if (event === 'push' && ref === 'main' && tested) { mode = 'main-tested'; jobs = { ...off, android: s.android }; }
  else if (event === 'push' && ref === 'main') mode = 'main';
  else if (event === 'workflow_dispatch' && ref === 'main') { mode = 'full'; jobs = ALL; }
  return { mode, light, tested: !!tested, ...Object.fromEntries(KEYS.map((k) => [k, !!jobs[k]])) };
}

// ------------------------------------------------------------------ IO (CI only)

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const git = (args) => { const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status ?? 1, out: (r.stdout || '').trim() }; };
const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);

/** The files this change touches: main pushes against the previous main, everything else against where it left main. */
export function changedFiles({ event, ref, before = '' }) {
  const zero = /^0+$/.test(before);
  if (event === 'push' && ref === 'main' && before && !zero && git(['cat-file', '-e', `${before}^{commit}`]).code === 0) return lines(git(['diff', '--name-only', before, 'HEAD']).out);
  const base = git(['merge-base', 'origin/main', 'HEAD']);
  if (base.code || !base.out || base.out === git(['rev-parse', 'HEAD']).out) return null; // no base, or this is main itself: everything
  return lines(git(['diff', '--name-only', base.out, 'HEAD']).out);
}

/**
 * Has the merge queue already run CI green on this code? A queue/pr-* branch whose files equal HEAD's outside
 * _claude/, and whose head commit has a successful run of this workflow (GitHub API, the job's own token).
 */
export async function queueTested({ repo = process.env.GITHUB_REPOSITORY, token = process.env.GH_TOKEN, workflow = process.env.GITHUB_WORKFLOW } = {}) {
  git(['fetch', '-q', 'origin', '+refs/heads/queue/*:refs/remotes/origin/queue/*']);
  const refs = lines(git(['for-each-ref', '--format=%(objectname)', 'refs/remotes/origin/queue/']).out);
  for (const sha of refs) {
    if (!sameCode(lines(git(['diff', '--name-only', sha, 'HEAD']).out))) continue;
    if (!repo || !token) return { tested: false, why: 'no token to read the queue run' };
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
      const runs = (await r.json())?.workflow_runs || [];
      if (runs.some((x) => x.name === workflow && x.event === 'push' && x.conclusion === 'success')) return { tested: true, sha };
    } catch { /* not tested, then */ }
  }
  return { tested: false };
}

async function main(argv) {
  const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] ?? d : d; };
  const [cmd = 'help', ...rest] = argv;
  if (cmd === 'files') return console.log(JSON.stringify(scopeFor(rest)));
  if (cmd === 'gha') {
    const event = opt('event'); const ref = opt('ref');
    // no base to compare with (main itself, a brand-new history): treat it as touching everything
    const files = changedFiles({ event, ref, before: opt('before') }) || ['*'];
    const queueOn = String(process.env.AXF_MERGE_QUEUE || '').toLowerCase() === 'on';
    const tested = event === 'push' && ref === 'main' && files[0] !== '*' ? (await queueTested()).tested : false;
    const o = outputs({ event, ref, queueOn, files, tested });
    for (const [k, v] of Object.entries(o)) console.log(`${k}=${v}`);
    const s = scopeFor(files);
    console.error(`ci-scope: ${o.mode}; ${files[0] === '*' ? 'no base: everything' : `${files.length} file(s)`}; runs ${KEYS.filter((k) => o[k]).join(', ') || 'nothing heavy'}${o.light ? ' + light checks' : ''}`);
    for (const [k, f] of Object.entries(s.why)) console.error(`  ${k}: ${f}`);
    return;
  }
  if (cmd === 'light') {
    const files = changedFiles({ event: 'pull_request', ref: '' }) || [];
    const cmds = lightCommands(files, { exists: (p) => existsSync(join(ROOT, p)), list: (d) => { try { return lines(git(['ls-files', d]).out).filter((f) => !f.slice(d.length + 1).includes('/') || /\/land\//.test(f)).map((f) => f.slice(d.length + 1)); } catch { return []; } } });
    if (!argv.includes('--run')) return console.log(cmds.join('\n'));
    for (const c of cmds) {
      console.log(`== ${c}`);
      const r = spawnSync('bash', ['-c', c], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, AXF_BUILD_PROFILE: 'main-framework' } });
      if (r.status !== 0) { console.error(`light check failed: ${c}`); process.exitCode = 1; return; }
    }
    return;
  }
  console.log('usage: ci-scope.mjs files <file>… | gha --event <e> --ref <r> [--before <sha>] | light [--run]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
