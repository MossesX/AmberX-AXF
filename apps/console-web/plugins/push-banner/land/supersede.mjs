#!/usr/bin/env node
/**
 * Supersede check (build land-finish-auto-land-live-clear-backlog): for each finished build not on main, is there any
 * work in it that main doesn't already have? Plain git, no model calls.
 *
 * A branch deleted on GitHub is read from its PR's head (refs/pull/<n>/head), which GitHub keeps.
 *
 * Unique work = commits on the branch whose patch is not on main (`git cherry`: `+` lines; merge commits and commits
 * that touch only status files are left out), narrowed to the files those commits touch whose content on the branch
 * still differs from main's (file level: a change main took in another form, a squash or a re-do, is not unique).
 * Status / log files (builds store, THREADS, journals, generated files) never count: they are regenerated on landing.
 *
 *   superseded  nothing unique: the branch head is kept as tag archive/<build>, its PR closed with a note, the build's
 *               land state set to archived (builds-live). Nothing is deleted.
 *   unique      the land state is set to flagged, with the unique files in the attempt note; the lander takes it.
 *
 *   node apps/console-web/plugins/push-banner/land/supersede.mjs [<build>…] [--apply] [--json] [--limit n]
 *     no build ids = the whole backlog (backlog.mjs order). Without --apply nothing is changed (dry run).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './land-core.mjs';
import { backlog, storeBuilds } from './backlog.mjs';
import { makeGit, makeGitHub, settings } from './land.mjs';

export const FRAME = 'land-supersede@1';
export const resultFile = (s) => join(s.dataDir, 'land-supersede.json');
const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
const still0 = (files) => files.size > 0;
/** Files that never make a build unique: status, logs and generated files (regenerated or merged on landing). */
export const noise = (p) => ['builds', 'union', 'generated'].includes(core.classifyPath(p)) || /^_claude\/(builds|sessions|logs)\//.test(p) || /(^|\/)THREADS\.md$|(^|\/)STATUS\.md$/.test(p);

/**
 * What a branch adds that main lacks. Returns { branch, head, plus: [sha], files: [paths], unique: bool, why }.
 * `ref` = the branch's ref (e.g. origin/claude/x); `main` = main's ref.
 */
export function uniqueWork({ git, ref, main }) {
  const head = git(['rev-parse', '-q', '--verify', `${ref}^{commit}`]);
  if (head.code) return { head: '', plus: [], files: [], unique: false, missing: true, why: `${ref} is not there` };
  const cherry = git(['cherry', main, ref]);
  const plus = lines(cherry.out).filter((l) => l.startsWith('+')).map((l) => l.slice(2).trim());
  const files = new Set();
  const counted = [];
  for (const c of plus) {
    const parents = lines(git(['rev-list', '--parents', '-n', '1', c]).out.split(' ').slice(1).join('\n'));
    if (parents.length > 1) continue; // a merge brings main (or another branch) in: not this build's own work
    const touched = lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', c]).out).filter((p) => !noise(p));
    if (!touched.length) continue;
    counted.push(c);
    for (const p of touched) files.add(p);
  }
  // file level: what main already holds the same way is not unique, and neither is a version main once had and has
  // moved on from since (a batch or squash landed it under another commit; main edited the file after)
  const since = still0(files) ? git(['merge-base', main, ref]).out : '';
  const onMainOnce = (p) => {
    const blob = git(['rev-parse', '-q', '--verify', `${ref}:${p}`]);
    if (blob.code) return git(['cat-file', '-e', `${main}:${p}`]).code !== 0; // deleted on the branch: unique only while main still has it
    // only main's history since the branch left it: the version can't have reached main before the branch made it
    return !!git(['log', '-1', '--format=%H', `--find-object=${blob.out}`, since ? `${since}..${main}` : main, '--', p], { timeout: 60000 }).out;
  };
  const still = [...files].filter((p) => git(['diff', '--quiet', main, ref, '--', p]).code !== 0 && !onMainOnce(p)).sort();
  const why = !counted.length ? (plus.length ? 'only merges and status files are missing from main' : 'every commit is on main')
    : !still.length ? `main has (or had) the same content in ${files.size} file(s)` : `${still.length} file(s) main does not have: ${still.slice(0, 6).join(', ')}${still.length > 6 ? ' …' : ''}`;
  return { head: head.out, plus: counted, files: still, unique: still.length > 0, why };
}

/** builds-live land: the build's state (and a note with the files) on its land record, live. */
export function markBuild(s, id, state, note = '') {
  const args = [join(s.repo, 'framework/cli/builds-live.mjs'), 'land', id, '--state', state, '--json'];
  if (note) args.splice(4, 0, '--attempt', JSON.stringify({ at: new Date().toISOString(), outcome: '', note: note.slice(0, 300) }));
  const r = spawnSync('node', args, { cwd: s.repo, encoding: 'utf8', timeout: 120000 });
  return { ok: r.status === 0, text: `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-300) };
}

/**
 * Check builds (backlog rows or { id, branch, pr }) and, with `apply`, act on them. `gh` closes PRs (null = skip);
 * `mark` writes the land state. Returns { at, rows: [{ id, verdict: superseded | unique | missing, files, why, tag?, closed? }] }.
 */
export async function supersede({ s = settings(), git = makeGit(s.repo), gh = null, rows, apply = false, mark = markBuild, log = () => {} }) {
  const main = `${s.remote}/${s.base}`;
  const out = [];
  for (const b of rows) {
    let w = uniqueWork({ git, ref: `${s.remote}/${b.branch}`, main });
    // the branch is gone (deleted after its PR closed): GitHub keeps the PR's head at refs/pull/<n>/head
    const prN = Number(String(b.pr || '').replace(/\D/g, '')) || 0;
    if (w.missing && prN) {
      const ref = `refs/remotes/${s.remote}/pr/${prN}`;
      if (git(['fetch', '-q', s.remote, `+refs/pull/${prN}/head:${ref}`], { timeout: 120000 }).code === 0) { w = uniqueWork({ git, ref, main }); w.viaPr = true; }
    }
    const r = { id: b.id, branch: b.branch, pr: b.pr || '', verdict: w.missing ? 'missing' : w.unique ? 'unique' : 'superseded', files: w.files, commits: w.plus.length, why: w.why, ...(w.viaPr ? { from: `pull/${prN}/head (branch deleted)` } : {}) };
    if (apply && r.verdict === 'superseded') {
      const tag = `archive/${b.id}`;
      const t = git(['push', '-q', s.remote, `${w.head}:refs/tags/${tag}`], { timeout: 90000 });
      r.tag = t.code && !/already exists/.test(t.err) ? '' : tag;
      if (!r.tag) { r.error = `tag: ${t.err.slice(-160)}`; out.push(r); log(`${b.id}: could not keep the branch as ${tag}; left as it is`); continue; }
      const n = Number(String(b.pr || '').replace(/\D/g, '')) || 0;
      if (n && gh) {
        try {
          await gh('POST', `/repos/${s.slug}/issues/${n}/comments`, { body: `Superseded: everything in this branch is already on main (${w.why}). The head is kept as tag \`${tag}\`; closing.` });
          await gh('PATCH', `/repos/${s.slug}/pulls/${n}`, { state: 'closed' }); r.closed = n;
        } catch (e) { r.error = `PR: ${e.message.slice(0, 160)}`; }
      }
      const m = mark(s, b.id, 'archived', `Superseded: ${w.why}. Kept as ${tag}.`); if (!m.ok) r.error = `${r.error ? `${r.error}; ` : ''}mark: ${m.text}`;
    } else if (apply && r.verdict === 'unique') {
      const m = mark(s, b.id, 'flagged', `Unique work: ${w.files.slice(0, 12).join(', ')}${w.files.length > 12 ? ` (+${w.files.length - 12})` : ''}`); if (!m.ok) r.error = `mark: ${m.text}`;
    }
    log(`${b.id}: ${r.verdict} (${r.why})`);
    out.push(r);
  }
  const res = { $axf: FRAME, at: new Date().toISOString(), applied: apply, rows: out };
  if (apply) { mkdirSync(dirname(resultFile(s)), { recursive: true }); const tmp = `${resultFile(s)}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(res, null, 1)}\n`); renameSync(tmp, resultFile(s)); }
  return res;
}

export const readResult = (s) => { try { return JSON.parse(readFileSync(resultFile(s), 'utf8')); } catch { return null; } };

export async function main(argv) {
  const s = settings(); const git = makeGit(s.repo); const json = argv.includes('--json'); const apply = argv.includes('--apply');
  const i = argv.indexOf('--limit'); const limit = i >= 0 ? Number(argv[i + 1]) || 0 : 0;
  const ids = argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--limit');
  git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
  let rows = backlog(storeBuilds(s, git));
  if (ids.length) rows = ids.map((id) => rows.find((r) => r.id === id) || storeBuilds(s, git).find((b) => b.id === id)).filter((b) => b?.branch);
  if (limit) rows = rows.slice(0, limit);
  const res = await supersede({ s, git, gh: apply ? makeGitHub(s) : null, rows, apply, log: (m) => !json && console.error(m) });
  if (apply) {
    // the batch summary on the phone: archived and flagged (no redeploy: nothing landed)
    const { afterBatch } = await import('./land-one.mjs');
    await afterBatch({ s, ran: res.rows.filter((r) => r.verdict === 'unique').map((r) => ({ build: r.id, outcome: 'clash' })), archived: res.rows.filter((r) => r.verdict === 'superseded' && r.tag).map((r) => r.id) });
  }
  if (json) console.log(JSON.stringify(res, null, 1));
  else {
    const n = (v) => res.rows.filter((r) => r.verdict === v).length;
    console.log(`${res.rows.length} checked${apply ? '' : ' (dry run)'}: ${n('superseded')} superseded, ${n('unique')} unique, ${n('missing')} missing`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
