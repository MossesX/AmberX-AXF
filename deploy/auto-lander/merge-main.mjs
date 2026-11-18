#!/usr/bin/env node
/**
 * merge-main — the auto-lander's clash resolver (auto-lander@1 kind `clash`, framework/spec/AUTO-LANDER.md).
 *
 * For one build: fetch, merge origin/main into the build's branch in a private temporary worktree (never the build's
 * own worktree, never the checkout the service runs from), resolve every conflict a person is not needed for, commit,
 * push through the GitHub token broker (framework/cli/github-token.mjs credential) and log the attempt
 * (deploy/auto-lander/attempts.mjs).
 *
 * The merge rules are the ones the landing line already uses (push banner land/land.mjs mergeMain + resolveConflicts),
 * driven by the one generated-files@1 manifest (framework/spec/generated-files.json):
 *   builds files     newer-wins (builds-live.mjs merge driver; store.json, orchestrator.json, journal, origins)
 *   THREADS / STATUS / decisions / PORTING.md / logs   both sides' lines (union)
 *   help packs, catalog status                         both sides' keys (union-json)
 *   generated files  main's copy, then the generator runs once on the merged tree: tracker.mjs, axf schemas,
 *                    gen-fixtures, control inventory, help sync, rebake (+ the manifest's quick tests)
 *   hand-written code  nothing is touched: the merge is aborted and the result is `needs-fix` with the files, in the
 *                    shape red CI has ({ ci: 'failure', failing }) so the loop hands it to a fix session.
 *
 *   node deploy/auto-lander/merge-main.mjs <build> [--branch b] [--pr n] [--dry-run] [--no-log] [--json]
 *
 * Environment: AXF_LAND_REPO (the checkout git runs in; default this repo), AXF_AUTO_LANDER_DIR (attempt logs).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMain as landMergeMain, settings as landSettings } from '../../apps/console-web/plugins/push-banner/land/land.mjs'; // axf-plugin:push-banner
import * as attempts from './attempts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../..');
const BROKER = join(REPO_ROOT, 'framework/cli/github-token.mjs');
const NETWORK = new Set(['fetch', 'push', 'ls-remote', 'pull']);

/** git in `cwd`; fetch and push authenticate through the token broker (the token never shows in argv or the log). */
export function makeGit(cwd, { broker = BROKER } = {}) {
  return (args, o = {}) => {
    const auth = NETWORK.has(args[0]) ? ['-c', 'credential.helper=', '-c', `credential.helper=!node "${broker}" credential`] : [];
    const r = spawnSync('git', [...auth, ...args], { cwd: o.cwd || cwd, encoding: 'utf8', timeout: o.timeout || 120000, maxBuffer: 64 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(o.env || {}) } });
    return { code: r.status ?? 1, out: (r.stdout || '').replace(/\s+$/, ''), err: (r.stderr || r.error?.message || '').trim() };
  };
}

const clip = (s, n = 1800) => (String(s || '').length > n ? `…${String(s).slice(-n)}` : String(s || ''));

/**
 * Merge main into one build's branch.
 *   build    the build id (attempt log key)
 *   branch   its branch (default claude/<build>)
 *   pr       its PR number (0 = none yet)
 *   repo     the checkout to work from (a private worktree is made off it)
 *   dry      merge and resolve, never push, never log
 *   record   write the attempt (default true)
 * → { status: 'merged' | 'up-to-date' | 'needs-fix' | 'error', build, branch, head, sha, conflicts, resolved,
 *     regenerated, attempt, log, ci?, failing? }
 *   needs-fix carries { ci: 'failure', failing: ['merge main: conflict in <file>', …] } like a red CI summary.
 */
export function mergeMainFor({ build, branch = '', pr = 0, repo = process.env.AXF_LAND_REPO || REPO_ROOT, remote = 'origin', base = 'main', dry = false, record = true, account = 'server', git = null, now = () => new Date().toISOString(), log = () => {} } = {}) {
  if (!build) throw Object.assign(new Error('merge-main needs a build id'), { code: 'invalid' });
  const br = branch || `claude/${build}`;
  const s = { ...landSettings(), repo, remote, base };
  const g = git || makeGit(repo);
  const lines = [];
  const say = (m) => { lines.push(m); log(m); };
  const res = { build, branch: br, head: '', sha: '', conflicts: [], resolved: [], regenerated: [], attempt: null };
  const finish = (status, extra = {}) => {
    const out = { ...res, ...extra, status, log: clip(lines.join('\n')) };
    if (out.attempt && !dry) {
      const result = status === 'merged' ? 'ok' : status === 'up-to-date' ? 'skipped' : 'failed';
      out.attempt = attempts.end(out.attempt, result, { log: out.log, at: now(), head: out.sha || out.head });
    }
    return out;
  };

  const f = g(['fetch', '-q', '--prune', remote], { timeout: 180000 });
  if (f.code) say(`fetch: ${f.err.slice(-300)}`);
  const head = g(['rev-parse', '-q', '--verify', `refs/remotes/${remote}/${br}`]);
  if (head.code) return finish('error', { error: `${br} is not on ${remote}` });
  res.head = head.out;
  if (record && !dry) res.attempt = attempts.start(build, 'clash', { branch: br, head: res.head, pr: Number(pr) || 0, account, at: now() });

  if (g(['merge-base', '--is-ancestor', `${remote}/${base}`, `${remote}/${br}`]).code === 0) {
    say(`${br} already has ${base}: nothing to merge.`);
    return finish('up-to-date', { sha: res.head });
  }
  const m = landMergeMain({ s, git: g, b: { id: build, branch: br }, dry, log: say });
  Object.assign(res, { resolved: m.resolved || [], regenerated: m.regenerated || [], sha: m.sha || '' });
  if (m.resolved?.length) say(`resolved without a person: ${m.resolved.join(', ')}`);
  if (m.regenerated?.length) say(`regenerated: ${m.regenerated.join(', ')}`);
  if (m.conflicts?.length) {
    say(`hand-written files clash with ${base}: ${m.conflicts.join(', ')}`);
    return finish('needs-fix', { conflicts: m.conflicts, ci: 'failure', failing: m.conflicts.map((p) => `merge ${base}: conflict in ${p}`) });
  }
  if (!m.merged) {
    say(m.pushError || 'the merge did not go through');
    // a red generator check or test after regenerating is a code problem too: a fix session gets it
    const fix = /tests after regenerating|failed to regenerate|check failed/i.test(m.pushError || '');
    return finish(fix ? 'needs-fix' : 'error', fix ? { ci: 'failure', failing: [`merge ${base}: ${String(m.pushError).slice(0, 200)}`] } : { error: m.pushError || 'merge failed' });
  }
  say(dry ? `merged ${base} into ${br} at ${m.sha} (dry run: not pushed)` : `merged ${base} into ${br} and pushed ${m.sha}`);
  return finish('merged', { sha: m.sha, dry });
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2); const json = a.includes('--json');
  const opt = (k) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : ''; };
  const build = a.find((x, i) => !x.startsWith('--') && !['--branch', '--pr'].includes(a[i - 1]));
  try {
    const r = mergeMainFor({ build, branch: opt('branch'), pr: Number(opt('pr')) || 0, dry: a.includes('--dry-run'), record: !a.includes('--no-log'), log: json ? () => {} : (m) => process.stderr.write(`${m}\n`) });
    process.stdout.write(`${json ? JSON.stringify(r, null, 1) : `${r.status}: ${r.build} ${r.sha || r.head}${r.conflicts.length ? ` (${r.conflicts.join(', ')})` : ''}`}\n`);
    process.exitCode = r.status === 'merged' || r.status === 'up-to-date' ? 0 : r.status === 'needs-fix' ? 3 : 1;
  } catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = e.code === 'invalid' ? 2 : 1; }
}
