#!/usr/bin/env node
/**
 * Drift keeper (build land-finish-auto-land-live-clear-backlog, Brett Nov 14 2026: "I keep getting too many commits
 * behind"). Plain Node: git only, no model calls. Every REFRESH_MS (30 min) each running build gets origin/main merged
 * into its branch in its own worktree, its generated files regenerated (generated-files@1), the result pushed, so it
 * lands as a small step instead of hundreds of commits behind. Every running build's `behindMain` (commits on main it
 * lacks) goes on its land record through builds-live, so every build row can show it.
 *
 * A build is left alone this turn (and tried again next turn) when:
 *   - it has no worktree here or its branch is not on GitHub;
 *   - its worktree has uncommitted changes (the session is mid-edit);
 *   - a session holds a lock on it: a git operation in progress (index.lock, MERGE_HEAD, a rebase), or the hold file
 *     `.axf-fresh-hold` a session writes to keep the keeper out;
 *   - its worktree is behind its own branch on GitHub.
 * A clash in code is aborted and noted; the build's own session settles it when it finishes (the lander files a fix
 * build if it still clashes then).
 *
 *   node apps/console-web/plugins/push-banner/land/keep-fresh.mjs run [--dry-run] [--force] [--json]   one turn now
 *   … status [--json]                                                                             the last turn
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './land-core.mjs';
import { makeGit, mergeMain, settings, worktrees } from './land.mjs';

export const FRAME = 'keep-fresh@1';
export const HOLD_FILE = '.axf-fresh-hold';
/** At most this many merges a turn, so CI isn't flooded; the rest wait their turn (oldest first). */
export const MAX_PER_TURN = 4;

export const freshFile = (s) => join(s.dataDir, 'keep-fresh.json');
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }

/** A session holds this worktree: a git operation is in progress or it asked the keeper to stay out. */
export function sessionHold(git, wt) {
  if (existsSync(join(wt, HOLD_FILE))) return 'its session asked the keeper to wait (.axf-fresh-hold)';
  const gd = git(['rev-parse', '--git-dir'], { cwd: wt }).out;
  const dir = gd ? resolve(wt, gd) : '';
  if (!dir) return '';
  for (const [f, why] of [['index.lock', 'a git command is running in it'], ['MERGE_HEAD', 'a merge is in progress'], ['rebase-merge', 'a rebase is in progress'], ['rebase-apply', 'a rebase is in progress'], ['CHERRY_PICK_HEAD', 'a cherry-pick is in progress']]) {
    if (existsSync(join(dir, f))) return why;
  }
  return '';
}

/** Commits on main the branch lacks (null when either ref is missing). */
export function behindCount({ s, git, br }) {
  const r = git(['rev-list', '--count', `${s.remote}/${br}..${s.remote}/${s.base}`]);
  return r.code ? null : Number(r.out) || 0;
}

/** builds-live: a build's commits behind main on its land record (reaches main at once). */
export function recordBehind(s, id, behind) {
  const r = spawnSync('node', [join(s.repo, 'framework/cli/builds-live.mjs'), 'land', id, '--behind', String(behind), '--json'], { cwd: s.repo, encoding: 'utf8', timeout: 120000 });
  return { ok: r.status === 0, text: `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-300) };
}

/**
 * One turn. `builds` = the builds store's records (running ones are picked); `force` ignores the 30-minute clock.
 * Returns the keep-fresh@1 state: { at, builds: { <id>: { at, state: merged | current | skipped | clash | failed, why?,
 * sha?, behind } } }.
 */
export function keepFresh({ s = settings(), git = makeGit(s.repo), builds, wts = worktrees(git), dry = false, force = false, nowMs = Date.now(), merge = mergeMain, record = recordBehind, log = () => {} } = {}) {
  const prev = readJson(freshFile(s), { builds: {} }) || { builds: {} };
  const at = new Date(nowMs).toISOString();
  const out = { $axf: FRAME, at, builds: { ...(prev.builds || {}) } };
  const running = (builds || []).filter(core.isRunning);
  const due = force ? running : core.refreshDue(running, prev.builds || {}, nowMs);
  git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
  let n = 0;
  for (const b of due) {
    const rec = { at, state: 'skipped' };
    const keepClock = () => { rec.at = prev.builds?.[b.id]?.at || ''; }; // skipped for a session: try again next turn, not in 30 min
    const wt = wts[b.branch];
    const remote = git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${b.branch}`]).code === 0;
    if (!wt || !existsSync(wt) || !remote) rec.why = 'no worktree or branch on GitHub here';
    else if (behindCount({ s, git, br: b.branch }) === 0) rec.state = 'current';
    else {
      const hold = sessionHold(git, wt);
      const dirty = hold ? null : core.strayPlan(git(['status', '--porcelain', '--untracked-files=no'], { cwd: wt }).out);
      if (hold) { rec.why = hold; keepClock(); }
      else if (dirty.code.length || dirty.commit.length) { rec.why = 'its session has uncommitted changes; next turn'; keepClock(); }
      else if (git(['rev-list', '--count', `HEAD..${s.remote}/${b.branch}`], { cwd: wt }).out !== '0') { rec.why = 'its worktree is behind GitHub; next turn'; keepClock(); }
      else if (n >= MAX_PER_TURN) { rec.why = 'turn full; next turn'; keepClock(); }
      else {
        n++;
        const m = merge({ s, git, b, dry, inPlace: wt, regenAfter: true, log });
        if (m.merged) Object.assign(rec, { state: 'merged', sha: m.sha, regenerated: m.regenerated || [] });
        else Object.assign(rec, { state: m.conflicts?.length ? 'clash' : 'failed', files: (m.conflicts || []).slice(0, 20), why: m.pushError || m.checkError || (m.conflicts?.length ? 'main clashes with it in code; its session settles it' : 'merge failed') });
        if (!dry && m.merged) git(['fetch', '-q', s.remote, b.branch], { timeout: 120000 });
      }
    }
    rec.behind = rec.state === 'merged' && !dry ? 0 : behindCount({ s, git, br: b.branch });
    out.builds[b.id] = rec;
    log(`keep-fresh ${b.id}: ${rec.state}${rec.why ? ` (${rec.why})` : ''}${rec.behind != null ? `, ${rec.behind} behind main` : ''}`);
  }
  // every running build's count, even ones not due this turn: the column stays current
  for (const b of running) {
    const behind = out.builds[b.id]?.at === at ? out.builds[b.id].behind : behindCount({ s, git, br: b.branch });
    if (behind == null || dry) continue;
    if (out.builds[b.id]) out.builds[b.id].behind = behind; else out.builds[b.id] = { at: prev.builds?.[b.id]?.at || '', state: 'waiting', behind };
    const r = record(s, b.id, behind); if (!r.ok) log(`behind ${b.id}: ${r.text}`);
  }
  const live = new Set(running.map((b) => b.id));
  for (const id of Object.keys(out.builds)) if (!live.has(id)) delete out.builds[id];
  if (!dry) writeJson(freshFile(s), out);
  return out;
}

export function storeBuilds(s, git) {
  const t = git(['show', `${s.remote}/${s.base}:_claude/builds/store.json`]);
  try { return t.code ? [] : (JSON.parse(t.out).builds || []).filter((b) => !b.deleted); } catch { return []; }
}

export async function main(argv) {
  const s = settings(); const json = argv.includes('--json');
  const out = (v, text) => console.log(json ? JSON.stringify(v, null, 1) : text);
  const cmd = argv.find((a) => !a.startsWith('--')) || 'run';
  const lines = (st) => Object.entries(st.builds || {}).map(([id, r]) => `${id}: ${r.state}${r.why ? ` (${r.why})` : ''}${r.behind != null ? ` · ${r.behind} behind` : ''}`).join('\n') || 'no running builds';
  if (cmd === 'status') { const st = readJson(freshFile(s), { $axf: FRAME, at: '', builds: {} }); out(st, `last turn ${st.at || 'never'}\n${lines(st)}`); return 0; }
  if (cmd === 'run') {
    const git = makeGit(s.repo);
    git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
    const st = keepFresh({ s, git, builds: storeBuilds(s, git), dry: argv.includes('--dry-run'), force: argv.includes('--force'), log: (m) => !json && console.error(m) });
    out(st, lines(st)); return 0;
  }
  throw new Error('usage: keep-fresh.mjs run [--dry-run] [--force] [--json] | status [--json]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
