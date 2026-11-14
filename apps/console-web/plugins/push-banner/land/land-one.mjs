#!/usr/bin/env node
/**
 * Serial lander: land one finished build (build land-finish-auto-land-live-clear-backlog, Brett Nov 14 2026: "We need
 * to make sure things are landing as soon as they're built and merged as soon as they're built. I keep getting too many
 * commits behind"). Plain Node: git and the GitHub REST API, no model calls.
 *
 * One call takes one build and runs one attempt, recorded as a land-run@1 (framework/core/land-run.mjs):
 *   1. holds the landing line's lock (land.mjs takeLandLock): a second land-one, a land.mjs round or the merge queue
 *      never runs at the same time; a busy line is refused at once ({ ran: false, owner }), never waited on by default;
 *   2. merges origin/main into the build's branch (land.mjs mergeMain: builds files newer-wins, logs unioned, generated
 *      files from main then regenerated, a code clash aborted and listed as `unresolved`), pushes the branch;
 *   3. writes the attempt to land-runs.jsonl in the push banner's data folder (append-only, one land-run@1 per line).
 * Later steps of the same attempt (checks, CI on the merged head, the merge to main) extend the same record.
 *
 *   node apps/console-web/plugins/push-banner/land/land-one.mjs <build> [--dry-run] [--json]   one attempt now
 *   … runs [<build>] [--json]                                                                the recorded attempts
 *   … lock                                                                                   who holds the line
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lr from '../../../../../framework/core/land-run.mjs';
import { dropLandLock, lockOwner, makeGit, mergeMain, settings, takeLandLock } from './land.mjs';

export const runsFile = (s) => join(s.dataDir, 'land-runs.jsonl');

/** Every recorded attempt, oldest first; `build` filters to one build. */
export function readRuns(s, build = '') {
  let text = '';
  try { text = readFileSync(runsFile(s), 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { const r = lr.normLandRun(JSON.parse(l)); if (r && (!build || r.build === build)) out.push(r); } catch { /* a torn line */ } }
  return out;
}

/** Append one attempt (settled: outcome from its facts, note filled). Refuses a record that doesn't validate. */
export function recordRun(s, run, now = new Date().toISOString()) {
  const r = lr.settleLandRun(run, now);
  const v = lr.validateLandRun(r);
  if (!v.ok) throw new Error(`land-run@1: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  mkdirSync(dirname(runsFile(s)), { recursive: true });
  appendFileSync(runsFile(s), `${JSON.stringify(r)}\n`);
  return r;
}

/** The build record from main's builds store (the newest status is there), or null. */
export function buildFromMain({ s, git, id }) {
  const t = git(['show', `${s.remote}/${s.base}:_claude/builds/store.json`]);
  if (t.code) return null;
  try { return (JSON.parse(t.out).builds || []).find((b) => !b.deleted && b.id === id) || null; } catch { return null; }
}

/**
 * One attempt for one build. `build` is a builds@1 record ({ id, branch, pr? }) or an id looked up on main.
 * Resolves { ran: false, owner } when the line is busy; otherwise { ran: true, run } with the recorded land-run@1.
 * The lock is always released. `merge` is land.mjs mergeMain (tests pass their own).
 */
export async function landOne({ s = settings(), git = makeGit(s.repo), build, dry = false, now = () => new Date(), merge = mergeMain, wait = 0, log = () => {} } = {}) {
  const at = now().toISOString();
  const id = typeof build === 'string' ? build : build?.id;
  if (!id) throw new Error('land-one: which build?');
  if (!(await takeLandLock({ wait, who: `land-one ${id}` }))) return { ran: false, owner: lockOwner() };
  try {
    git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
    const b = typeof build === 'object' && build.branch ? build : buildFromMain({ s, git, id });
    const run = { ...lr.emptyLandRun(), id: lr.newLandRunId(id, at), build: id, startedAt: at, branch: b?.branch || '', pr: b?.pr || 0 };
    if (!b?.branch) return { ran: true, run: finish(s, { ...run, error: 'no branch on record for this build' }, dry, now) };
    run.base = git(['rev-parse', `${s.remote}/${s.base}`]).out;
    const h = git(['rev-parse', `${s.remote}/${b.branch}`]);
    if (h.code) return { ran: true, run: finish(s, { ...run, error: `branch ${b.branch} is not on ${s.remote}` }, dry, now) };
    run.head = h.out;
    log(`land-one ${id}: merging ${s.remote}/${s.base} (${run.base.slice(0, 8)}) into ${b.branch} (${run.head.slice(0, 8)})`);
    const m = merge({ s, git, b, dry, log });
    run.regenerated = m.regenerated || [];
    if (m.conflicts?.length) run.unresolved = m.conflicts;
    else if (!m.merged) run.error = m.pushError || 'merge failed';
    else run.merged = m.sha;
    return { ran: true, run: finish(s, run, dry, now) };
  } finally { dropLandLock(); }
}

/** A finished attempt (clash / error) is settled and stored; one still going (merged, CI next) is stored as it stands. */
function finish(s, run, dry, now) {
  const at = now().toISOString();
  const done = run.error || run.unresolved.length;
  if (dry) return done ? lr.settleLandRun(run, at) : lr.normLandRun(run);
  if (done) return recordRun(s, run, at);
  const r = lr.normLandRun(run); r.note = lr.landRunLine(r);
  mkdirSync(dirname(runsFile(s)), { recursive: true });
  appendFileSync(runsFile(s), `${JSON.stringify(r)}\n`);
  return r;
}

export async function main(argv) {
  const s = settings(); const json = argv.includes('--json'); const dry = argv.includes('--dry-run');
  const args = argv.filter((a) => !a.startsWith('--'));
  const out = (v, text) => console.log(json ? JSON.stringify(v, null, 1) : text);
  if (args[0] === 'lock') { const o = lockOwner(); out({ owner: o }, o || 'free'); return 0; }
  if (args[0] === 'runs') { const r = readRuns(s, args[1] || ''); out(r, r.map((x) => `${x.startedAt}  ${x.build}  ${x.outcome || 'going'}  ${x.note}`).join('\n') || 'no attempts yet'); return 0; }
  if (!args[0]) throw new Error('usage: land-one.mjs <build> [--dry-run] [--json] | runs [<build>] | lock');
  const r = await landOne({ s, build: args[0], dry, log: (m) => !json && console.error(m) });
  if (!r.ran) { out(r, `the landing line is busy: ${r.owner}`); return 2; }
  out(r.run, `${r.run.build}: ${r.run.note}`);
  return ['error', 'clash', 'red'].includes(r.run.outcome) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
