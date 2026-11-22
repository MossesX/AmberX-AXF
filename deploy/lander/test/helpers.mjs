// Shared by the lander's end-to-end tests: real git (a bare origin and a working clone), a fake GitHub, a clock.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.AXF_CREW_SAY = 'off';
const { makeGit } = await import('../git.mjs');
const L = await import('../lander-core.mjs');

export const sh = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };

/** A bare origin with main and one branch per step; a working clone the lander runs in. */
export function repo(steps) {
  const dir = mkdtempSync(join(tmpdir(), 'lander-run-'));
  const origin = join(dir, 'origin.git'); const work = join(dir, 'work');
  sh(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(dir, 'clone', '-q', origin, work);
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false']]) sh(work, 'config', k, v);
  writeFileSync(join(work, 'base.txt'), 'base\n'); writeFileSync(join(work, 'shared.txt'), 'one\ntwo\nthree\n');
  sh(work, 'add', '-A'); sh(work, 'commit', '-q', '-m', 'base'); sh(work, 'push', '-q', 'origin', 'HEAD:main');
  for (const [branch, files] of Object.entries(steps)) {
    sh(work, 'checkout', '-q', '-B', branch, 'origin/main');
    for (const [f, t] of Object.entries(files)) { mkdirSync(dirname(join(work, f)), { recursive: true }); writeFileSync(join(work, f), t); }
    sh(work, 'add', '-A'); sh(work, 'commit', '-q', '-m', `${branch} work`); sh(work, 'push', '-q', 'origin', `HEAD:${branch}`);
  }
  sh(work, 'checkout', '-q', '--detach', 'origin/main');
  sh(work, 'fetch', '-q', 'origin');
  return { dir, origin, work, s: { repo: work, slug: 'o/r', dataDir: join(dir, 'data'), api: '', remote: 'origin', base: 'main' } };
}

/** One check run of the fake GitHub. */
export const check = (name, conclusion = 'success', more = {}) => ({ id: more.id ?? 1, name, status: conclusion === null ? 'in_progress' : 'completed', conclusion, details_url: 'https://github.com/o/r/actions/runs/42/job/1', ...more });

/**
 * A fake GitHub: PRs, check runs per head, merges done in git. `ci(head)` → 'success' | 'failure' | 'running' | 'none' |
 * 'light', or the check runs themselves (an array: served 100 a page, like GitHub). `gh.logs` = { jobId: text } for
 * gh.text; `gh.mergeByHand(n)` merges a PR behind the lander's back.
 */
export function github(r, ci = () => 'success') {
  const prs = new Map(); let next = 1; const calls = [];
  const mergeInGit = (p, sha) => {
    sh(r.work, 'fetch', '-q', 'origin');
    if (sha) assert.equal(sh(r.work, 'rev-parse', `origin/${p.head.ref}`), sha, 'the merge is pinned to the tested head');
    p.head.sha = sh(r.work, 'rev-parse', `origin/${p.head.ref}`);
    sh(r.work, 'checkout', '-q', '--detach', 'origin/main');
    sh(r.work, 'merge', '-q', '--no-ff', '-m', `Merge #${p.number}`, `origin/${p.head.ref}`);
    sh(r.work, 'push', '-q', 'origin', 'HEAD:main'); sh(r.work, 'fetch', '-q', 'origin');
    p.state = 'closed'; p.merged = true; p.merged_at = '2026-11-19T12:00:00Z'; p.merge_commit_sha = sh(r.work, 'rev-parse', 'origin/main');
    return p;
  };
  const gh = async (method, path, body) => {
    calls.push(`${method} ${path.replace(/^\/repos\/o\/r/, '')}`);
    let m;
    if (method === 'GET' && (m = path.match(/\/pulls\?state=open&head=[^:]+%3A(.+)$/))) { const h = decodeURIComponent(m[1]); return [...prs.values()].filter((p) => p.head.ref === h && p.state === 'open'); }
    if (method === 'POST' && path.endsWith('/pulls')) { const p = { number: next++, state: 'open', head: { ref: body.head }, title: body.title, body: body.body, mergeable: true }; prs.set(p.number, p); return p; }
    if (method === 'GET' && (m = path.match(/\/pulls\/(\d+)$/))) return prs.get(Number(m[1])) || null;
    if (method === 'PATCH' && (m = path.match(/\/pulls\/(\d+)$/))) { const p = prs.get(Number(m[1])); Object.assign(p, body); return p; }
    if (method === 'GET' && (m = path.match(/\/commits\/([0-9a-f]+)\/check-runs\?per_page=(\d+)&page=(\d+)$/))) {
      const c = ci(m[1]);
      if (Array.isArray(c)) { const per = Number(m[2]); const page = Number(m[3]); return { total_count: c.length, check_runs: c.slice((page - 1) * per, page * per) }; }
      if (c === 'none') return { check_runs: [] };
      if (c === 'running') return { check_runs: [{ status: 'in_progress', name: 'tests' }] };
      if (c === 'light') return { check_runs: [{ status: 'completed', conclusion: 'success', name: 'scope' }, { status: 'completed', conclusion: 'success', name: 'Light PR checks (full run happens once, in the merge queue)' }] };
      return { check_runs: [{ id: 7, status: 'completed', conclusion: c, name: 'tests', details_url: 'https://github.com/o/r/actions/runs/42/job/7' }] };
    }
    if (method === 'PUT' && (m = path.match(/\/pulls\/(\d+)\/merge$/))) { const p = mergeInGit(prs.get(Number(m[1])), body.sha); return { merged: true, sha: p.merge_commit_sha }; }
    if (method === 'POST' && /rerun-failed-jobs|dispatches/.test(path)) return null;
    throw new Error(`fake GitHub: ${method} ${path}`);
  };
  gh.logs = {};
  gh.text = async (path) => { calls.push(`TEXT ${path.replace(/^\/repos\/o\/r/, '')}`); return gh.logs[path.match(/\/jobs\/(\d+)\/logs$/)?.[1]] || ''; };
  gh.mergeByHand = (n) => mergeInGit(prs.get(n), '');
  gh.prs = prs; gh.calls = calls;
  return gh;
}

export const build = (steps, extra = {}) => ({ id: 'b', title: 'Build B', status: 'build-complete', steps: steps.map(([id, branch]) => ({ id, status: 'completed', branch, title: id })), ...extra });
export const clock = (start = Date.parse('2026-11-19T12:00:00Z')) => { let t = start; const f = () => new Date(t).toISOString(); f.add = (min) => { t += min * 60000; }; return f; };
export const onMain = (r, f) => { sh(r.work, 'fetch', '-q', 'origin'); return spawnSync('git', ['cat-file', '-e', `origin/main:${f}`], { cwd: r.work }).status === 0; };
export const statuses = (b) => (b.statusLog || []).map((x) => x.status);
/** The tick's options: real git in the clone, the fakes, build rules that pass, a fix session that "starts". */
export const base = (r, gh, store, now, more = {}) => ({ s: r.s, git: makeGit(r.work), gh, store, now, cfg: L.normConfig({}), buildRules: () => ({ ok: true, failing: [], fixed: [] }), fixSession: () => ({ exit: 0, session: 'fixer' }), say: () => {}, ...more });

export const one = (id, branch, extra = {}) => ({ id, title: `Build ${id}`, status: 'build-complete', steps: [{ id: 's1', status: 'completed', branch, title: 's1' }], ...extra });
export const byId = (store, id) => store.list.find((b) => b.id === id);
export const holds = (r, ref, older) => spawnSync('git', ['merge-base', '--is-ancestor', older, ref], { cwd: r.work }).status === 0;
/** A commit straight onto main (someone else's landing). */
export function pushMain(r, files, msg = 'other work lands') {
  sh(r.work, 'fetch', '-q', 'origin'); sh(r.work, 'checkout', '-q', '--detach', 'origin/main');
  for (const [f, t] of Object.entries(files)) writeFileSync(join(r.work, f), t);
  sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '-m', msg); sh(r.work, 'push', '-q', 'origin', 'HEAD:main'); sh(r.work, 'fetch', '-q', 'origin');
  return sh(r.work, 'rev-parse', 'origin/main');
}
