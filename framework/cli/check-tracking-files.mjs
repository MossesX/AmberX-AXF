#!/usr/bin/env node
/**
 * CI guard (build stop-auto-lander-committing-tracking s11): a PR branch may not change tracking files
 * (framework/core/tracking-paths.mjs, tracking-paths@1: the builds store, orchestrator exports, origins, journal parts,
 * pending and build-queue exports). They carry live build status; builds-live publishes them on main as status-only
 * `[skip ci]` commits and the hub keeps the live copy. A build branch that carries them drags stale status into main
 * when it merges (PR 733: green → red).
 *
 *   node framework/cli/check-tracking-files.mjs [--base <ref>] [--head <ref>] [--json]
 *
 * Looks at what the branch changes against its merge-base with main (`git diff base...head`, so main merged in never
 * counts). A tracking file the branch changed fails unless every commit of the branch that touched it is a builds-live
 * status commit (`[skip ci]`, only _claude/ files). Removing a tracking file (the journal leaving git) is allowed.
 * On main itself, or without a base, there is nothing to compare: it passes and says so.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTracking, trackingEntry, trackingPathspecs } from '../core/tracking-paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATUS_MARK = '[skip ci]';

const git = (args, cwd = ROOT) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 }); return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };

/** Is a commit a builds-live status commit: `[skip ci]` in its subject and only _claude/ files? */
export function isStatusCommit(subject, files) {
  return String(subject || '').includes(STATUS_MARK) && Array.isArray(files) && files.length > 0 && files.every((f) => /^_claude\//.test(f));
}

/**
 * The verdict from plain data (no git): `changed` = [{ status: 'M'|'A'|'D'|…, path }], `commitsOf(path)` =
 * [{ sha, subject, files }] (the branch's non-merge commits that touched it). → { ok, offending: [{ path, id, commits }] }
 */
export function verdict(changed, commitsOf) {
  const offending = [];
  for (const c of changed || []) {
    if (!isTracking(c.path) || c.status.startsWith('D')) continue;
    const bad = (commitsOf(c.path) || []).filter((x) => !isStatusCommit(x.subject, x.files));
    if (bad.length || !(commitsOf(c.path) || []).length) offending.push({ path: c.path, id: trackingEntry(c.path)?.id || '', commits: bad.map((x) => `${x.sha.slice(0, 8)} ${x.subject}`.slice(0, 120)) });
  }
  return { ok: !offending.length, offending };
}

/** The plain message for one offending file. */
export const messageFor = (o) => `${o.path} is a tracking file (${o.id}): a build branch must not change it${o.commits.length ? ` (changed by ${o.commits.join('; ')})` : ''}. Put it back to main's copy: git checkout origin/main -- ${o.path} && git commit -m "Drop tracking file changes"`;

export function check({ base = '', head = 'HEAD', cwd = ROOT } = {}) {
  const branch = git(['rev-parse', '--abbrev-ref', head], cwd).out;
  const ref = base || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
  if (!base && (branch === 'main' || process.env.GITHUB_REF === 'refs/heads/main')) return { ok: true, skipped: 'on main: nothing to compare' };
  const mb = git(['merge-base', ref, head], cwd);
  if (mb.code || !mb.out) return { ok: true, skipped: `no merge-base with ${ref}` };
  const lines = git(['diff', '--name-status', '--no-renames', `${mb.out}...${head}`, '--', ...trackingPathspecs()], cwd).out.split('\n').filter(Boolean);
  const changed = lines.map((l) => { const [status, ...p] = l.split('\t'); return { status, path: p.join('\t') }; });
  const commitsOf = (path) => git(['log', '--no-merges', '--format=%H%x09%s', `${mb.out}..${head}`, '--', path], cwd).out.split('\n').filter(Boolean).map((l) => {
    const [sha, ...s] = l.split('\t');
    return { sha, subject: s.join('\t'), files: git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha], cwd).out.split('\n').filter(Boolean) };
  });
  return { ...verdict(changed, commitsOf), base: ref, mergeBase: mb.out };
}

function main(argv) {
  const json = argv.includes('--json');
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] || '' : ''; };
  const r = check({ base: opt('base'), head: opt('head') || 'HEAD' });
  if (json) console.log(JSON.stringify(r));
  else if (r.skipped) console.log(`check-tracking-files: skipped (${r.skipped})`);
  else if (r.ok) console.log('check-tracking-files: ok (no tracking files changed on this branch)');
  else { for (const o of r.offending) console.error(`✗ ${messageFor(o)}`); console.error(`check-tracking-files: ${r.offending.length} tracking file(s) changed on this branch`); }
  if (!r.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
