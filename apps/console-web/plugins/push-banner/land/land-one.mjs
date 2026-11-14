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
 *      files from main then regenerated); what those rules call code goes once to the host resolver
 *      (/opt/axf-batch/resolve.py → framework/cli/land-resolve.py); a clash still left is aborted and listed as
 *      `unresolved`. Then generated-files@1 regenerate: the generated files the merge changed on either side are
 *      regenerated on the merged tree, checked and committed on the branch (a red check = outcome red). Pushes the branch;
 *   3. writes the attempt to land-runs.jsonl in the push banner's data folder (append-only, one land-run@1 per line).
 *   4. CI on the merged head (checkAndLand): started (workflow_dispatch) when nothing ran on it, waited for up to
 *      CI_WAIT_MS; a cancelled / superseded / stale run is dispatched again and never counts as a failure; red = outcome
 *      red with the failing jobs named; still running at the end = the attempt stays open and the next land-one of
 *      the build picks the same head up again (main unchanged = nothing to merge);
 *   5. green: main must not have moved in code since the merge (else the next attempt merges it in again); the PR is
 *      merged at exactly the tested head through the GitHub App's installation token (framework/cli/github-token.mjs
 *      installation), opened first when the build has none; the build is marked merged through builds-live (it reaches
 *      main at once and the builds store settles it complete).
 *   6. red (a check after regenerating or CI on the merged head): a P0 fix build is filed in the orchestrator
 *      (axf.build-dispatch@1 through POST /land/fix) whose `said` is Brett's verbatim words from the build plus the
 *      failing check; the attempt names it (fixBuild). Every settled attempt goes on the build's land record through
 *      builds-live (landState red / landed / flagged …), so the line moves on to the next build at once.
 *
 *   node apps/console-web/plugins/push-banner/land/land-one.mjs <build> [--dry-run] [--json] [--wait-min n] [--wait-lock n]   one attempt now (n minutes)
 *   … runs [<build>] [--json]                                                                the recorded attempts
 *   … lock                                                                                   who holds the line
 *   … enqueue <build> [--front]                     put a finished build in the landing line (the finish hook does this)
 *   … line [--max n] [--dry-run] [--json]           land the line one build at a time until it is empty (cron, hook)
 *   … show [--json]                                 the landing line (landing-line@1 view)
 *
 * The landing line (landing-line@1, landing-line.json in the data folder) holds the order. runLine takes the entry in
 * flight (an attempt whose CI was still running) or else the first waiting one, runs landOne on it and moves the entry
 * by what happened: landed → out of the line; red / clash → fix-filed (the line moves on at once); still running →
 * stays in flight and the next run resumes it; a lander error → paused with the reason, then back to waiting at the
 * end of the run (tried again next run, never in a loop).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as lr from '../../../../../framework/core/land-run.mjs';
import * as line from '../../../../../framework/core/landing-line.mjs';
import { dropLandLock, lockOwner, makeConsole, makeGit, makeGitHub, mergeMain, settings, takeLandLock, touchLandLock } from './land.mjs';
import { fixBuildFor } from './land-core.mjs';
import { sameCodeFiles } from './merge-queue-core.mjs';

export const runsFile = (s) => join(s.dataDir, 'land-runs.jsonl');
/** The host resolver vps.build_land uses too; it hands over to the checkout's framework/cli/land-resolve.py. */
export const resolverPath = () => process.env.AXF_LAND_RESOLVER ?? (existsSync('/opt/axf-batch/resolve.py') ? '/opt/axf-batch/resolve.py' : '');

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

export const CI_WAIT_MS = 40 * 60000;
export const CI_POLL_MS = 30000;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** GitHub as the App (its installation token), else the broker's token (github-token.mjs token: the old GITHUB_TOKEN
 *  while the App is not set up on this VPS). Never printed. */
export function appGitHub(s) {
  const tok = (cmd) => { const r = spawnSync('node', [join(s.repo, 'framework/cli/github-token.mjs'), cmd], { encoding: 'utf8', timeout: 30000 }); return r.status === 0 ? (r.stdout || '').trim() : ''; };
  return makeGitHub(s, () => tok('installation') || tok('token'));
}

/** builds-live: the build's PR and merge time, straight to main (the store settles a merged build complete). */
export function markLanded(s, b, { pr = 0, at = new Date().toISOString() } = {}) {
  const r = spawnSync('node', [join(s.repo, 'framework/cli/builds-live.mjs'), 'link', b.id, ...(pr ? ['--pr', String(pr)] : []), '--merged', at, '--json'], { cwd: s.repo, encoding: 'utf8', timeout: 120000 });
  return { ok: r.status === 0, text: `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-300) };
}

/**
 * CI on the merged head, then the merge to main. Mutates and returns `run` (land-run@1 fields: ci, outcome, note, pr).
 * gh = GitHub REST (the App's token); mark = markLanded; sleep / clock injectable for tests.
 */
export async function checkAndLand({ s, git, gh, b, run, dry = false, mark = markLanded, sleep = sleepMs, waitMs = CI_WAIT_MS, pollMs = CI_POLL_MS, clock = Date.now, log = () => {} }) {
  const head = run.merged; const until = clock() + waitMs;
  let dispatched = 0; let retries = 0; let verdict = 'none'; let failing = [];
  const dispatch = async (why) => {
    log(`land-one ${b.id}: starting CI on ${head.slice(0, 8)} (${why})`);
    if (dry) return;
    try { await gh('POST', `/repos/${s.slug}/actions/workflows/${s.workflow}/dispatches`, { ref: b.branch }); dispatched++; } catch (e) { log(`dispatch: ${e.message}`); }
  };
  for (;;) {
    let runs = [];
    try { runs = (await gh('GET', `/repos/${s.slug}/commits/${head}/check-runs?per_page=100`))?.check_runs || []; } catch (e) { log(`check runs: ${e.message}`); }
    ({ verdict, failing } = line.classifyCheckRuns(runs, { head }));
    if (verdict === 'green' || verdict === 'red') break;
    if (verdict === 'none' && !dispatched) await dispatch('nothing ran on it');
    if (verdict === 'retry') { retries++; await dispatch('the last run was cancelled or superseded: not a failure'); }
    if (dry || clock() >= until) break;
    touchLandLock(); // still ours: a long CI wait must not look like a dead lander
    await sleep(pollMs);
  }
  const retryNote = retries ? ` ${retries} cancelled run${retries === 1 ? '' : 's'} started again.` : '';
  if (verdict === 'red') {
    run.ci = { run: '', status: 'completed', conclusion: 'failure' };
    run.check = { ...run.check, failed: run.check.failed?.length ? run.check.failed : failing };
    run.note = `CI failed on the merged head (${failing.join(', ') || 'see the run'}).${retryNote}`;
    return run;
  }
  if (verdict !== 'green') { run.ci = { run: '', status: verdict === 'none' ? 'queued' : 'in_progress', conclusion: '' }; run.note = `CI ${verdict === 'none' ? 'queued' : 'running'} on ${head.slice(0, 7)}; the next attempt picks it up.${retryNote}`; return run; }
  run.ci = { run: '', status: 'completed', conclusion: 'success' };
  // main moved in code since the merge: what CI passed is not what would land
  git(['fetch', '-q', s.remote, s.base], { timeout: 120000 });
  const mainNow = git(['rev-parse', `${s.remote}/${s.base}`]).out;
  const moved = mainNow !== run.base && !sameCodeFiles(git(['diff', '--name-only', run.base, mainNow]).out.split('\n'));
  if (moved) { run.ci = { run: '', status: 'in_progress', conclusion: '' }; run.note = `Green, but main moved in code (${mainNow.slice(0, 7)}): merging main in again next.`; return run; }
  if (dry) { run.note = `Green on ${head.slice(0, 7)}; would merge to main (dry run).`; run.ci = { run: '', status: 'in_progress', conclusion: '' }; return run; }
  let pr = Number(String(b.pr || run.pr || '').replace(/\D/g, '')) || 0;
  try {
    if (!pr) {
      const open = await gh('GET', `/repos/${s.slug}/pulls?state=open&head=${encodeURIComponent(`${s.slug.split('/')[0]}:${b.branch}`)}`);
      pr = (Array.isArray(open) && open[0]?.number) || (await gh('POST', `/repos/${s.slug}/pulls`, { title: String(b.title || b.id).slice(0, 120), head: b.branch, base: s.base, body: `Build \`${b.id}\` is finished. Opened by the serial lander: main merged in, CI green on ${head.slice(0, 7)}, landing now.` }))?.number || 0;
    }
    await gh('PUT', `/repos/${s.slug}/pulls/${pr}/merge`, { sha: head, merge_method: 'merge', commit_title: `Land ${b.id} (#${pr}) — serial lander` });
  } catch (e) {
    // GitHub refused (head moved, main moved, not mergeable): not red; the next attempt merges main in again
    run.ci = { run: '', status: 'in_progress', conclusion: '' }; run.pr = pr;
    run.note = `Green, but GitHub refused the merge (${e.message.slice(0, 160)}): trying again next.`;
    return run;
  }
  run.pr = pr;
  const at = new Date(clock()).toISOString();
  const m = mark(s, b, { pr, at });
  run.note = `Landed on main as ${head.slice(0, 7)} (PR #${pr}).${retryNote}${m.ok ? '' : ` Marking it merged failed: ${m.text}`}`;
  return run;
}

/** Brett's verbatim words that started a build (build-origin@1), '' when it has none. */
export function originSaid(s, id) {
  const r = spawnSync('node', [join(s.repo, 'framework/cli/build-origin.mjs'), 'get', id, '--json'], { cwd: s.repo, encoding: 'utf8', timeout: 30000 });
  try { return String(JSON.parse(r.stdout || '{}').origin?.said || ''); } catch { return ''; }
}

/** The fix build's `said`: his words first (a paraphrase never replaces them), then what failed. */
export function fixSaid(said, run) {
  if (run.unresolved?.length) return `${said ? `${said}\n\n` : ''}Merging main into ${run.branch || run.build} clashes in code: ${run.unresolved.slice(0, 12).join(', ')}`;
  const failed = run.check?.failed?.length ? run.check.failed.join(', ') : 'CI on the merged head';
  const why = run.check?.note || run.note || '';
  return `${said ? `${said}\n\n` : ''}Failing check after merging main into ${run.branch || run.build}: ${failed}${why ? ` (${why.slice(0, 300)})` : ''}`;
}

/** File the P0 fix build for a red attempt; returns its builds@1 id or ''. */
export async function fileFix({ s, api, b, run, said = '', attempt = 1 }) {
  const reason = run.unresolved?.length ? { kind: 'conflict', files: run.unresolved } : { kind: 'ci', checks: run.check?.failed?.length ? run.check.failed : ['CI'] };
  const fb = fixBuildFor(b, reason, { attempt, pr: run.pr || null });
  const r = await api('POST', '/api/plugins/push-banner/land/fix', { ...fb, said: fixSaid(said, run) });
  return r && r.ok && r.id ? String(r.id) : '';
}

/** builds-live: one settled attempt on the build's land record (its state follows the outcome). */
export function recordOnBuild(s, run) {
  const r = spawnSync('node', [join(s.repo, 'framework/cli/builds-live.mjs'), 'land', run.build, '--attempt', JSON.stringify(lr.attemptOf(run)), '--json'], { cwd: s.repo, encoding: 'utf8', timeout: 120000 });
  return { ok: r.status === 0, text: `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-300) };
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
export async function landOne({ s = settings(), git = makeGit(s.repo), gh = null, api = null, build, dry = false, now = () => new Date(), merge = mergeMain, ci = true, ciOpts = {}, said = null, record = recordOnBuild, wait = 0, log = () => {} } = {}) {
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
    const m = merge({ s, git, b, dry, regenAfter: true, resolver: resolverPath(), log });
    run.regenerated = m.regenerated || [];
    if (m.conflicts?.length) run.unresolved = m.conflicts;
    else if (m.checkError) run.check = { ok: false, failed: [m.checkError.split(' ')[0]], note: m.checkError.slice(0, 400) };
    else if (!m.merged) run.error = m.pushError || 'merge failed';
    else run.merged = m.sha;
    if (ci && run.merged) await checkAndLand({ s, git, gh: gh || appGitHub(s), b, run, dry, log, ...ciOpts });
    // red: the fix build is filed before the attempt is stored, so the record names it
    // red or a code clash: a P0 fix build, once per head (a clash keeps the id in its note: land-run@1 names fixBuild on red only)
    const red = run.check?.ok === false || lr.ciState(run.ci?.status, run.ci?.conclusion) === 'failure';
    const clash = run.unresolved.length > 0;
    if ((red || clash) && !dry) {
      const prev = readRuns(s, id);
      const filed = prev.find((x) => x.head === run.head && (x.fixBuild || /Fix build \S+ filed/.test(x.note)));
      let fix = '';
      if (filed) fix = filed.fixBuild || /Fix build (\S+) filed/.exec(filed.note)?.[1] || '';
      else { try { fix = await fileFix({ s, api: api || makeConsole(s), b, run, said: said ?? originSaid(s, id), attempt: prev.filter((x) => ['red', 'clash'].includes(x.outcome)).length + 1 }); } catch (e) { log(`fix build: ${e.message}`); } }
      if (red) run.fixBuild = fix;
      const base = run.note || (clash ? `Source clash a person has to settle: ${run.unresolved.slice(0, 8).join(', ')}.` : '');
      run.note = fix ? `${base} Fix build ${fix} filed (P0)${filed ? ' earlier' : ''}.`.trim() : `${base} No fix build: the orchestrator did not take it.`.trim();
    }
    const stored = finish(s, run, dry, now);
    if (!dry && stored.outcome) { const r = record(s, stored); if (!r.ok) log(`land record: ${r.text}`); }
    return { ran: true, run: stored };
  } finally { dropLandLock(); }
}

/** A finished attempt (clash / error) is settled and stored; one still going (merged, CI next) is stored as it stands. */
function finish(s, run, dry, now) {
  const at = now().toISOString();
  const done = run.error || run.unresolved.length || run.check?.ok === false || ['success', 'failure'].includes(lr.ciState(run.ci?.status, run.ci?.conclusion));
  if (dry) return done ? lr.settleLandRun(run, at) : { ...lr.normLandRun(run), note: run.note || '' };
  if (done) return recordRun(s, run, at);
  const r = lr.normLandRun(run); r.note ||= lr.landRunLine(r);
  mkdirSync(dirname(runsFile(s)), { recursive: true });
  appendFileSync(runsFile(s), `${JSON.stringify(r)}\n`);
  return r;
}

// ------------------------------------------------------------------ the landing line

export const lineFile = (s) => join(s.dataDir, 'landing-line.json');
export function readLine(s) { try { return JSON.parse(readFileSync(lineFile(s), 'utf8')); } catch { return line.emptyLine(); } }
export function writeLine(s, l) { mkdirSync(s.dataDir, { recursive: true }); const t = `${lineFile(s)}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(l, null, 1)}\n`); renameSync(t, lineFile(s)); }

/** A finished build joins the line (at the back, or the front with `front`); already there = unchanged. */
export function enqueue(s, b, { front = false, at = new Date().toISOString() } = {}) {
  let l = readLine(s);
  const id = line.entryId({ build: b.id, pr: Number(String(b.pr || '').replace(/\D/g, '')) || 0 });
  l = line.transition(l, { type: 'add', at, entry: { build: b.id, branch: b.branch, title: b.title, pr: b.pr, priority: b.priority, head: b.head || '' } });
  if (front && line.findEntry(l, id)?.state === 'waiting') { try { l = line.moveEntry(l, id, 0, { by: 'land-on-finish', at }); } catch { /* in flight ahead */ } }
  writeLine(s, l);
  return line.findEntry(l, id);
}

/** Move a line entry by what one land-one attempt found. Pure on the line value. */
export function applyRun(l, id, run, at = new Date().toISOString()) {
  const ev = (type, x = {}) => { l = line.transition(l, { type, id, at, ...x }); };
  const st = () => line.findEntry(l, id)?.state;
  if (st() === 'waiting') ev('start', { head: run.head });
  if (run.unresolved?.length) { if (['merging-main', 'regenerating'].includes(st())) ev('conflict', { files: run.unresolved }); return l; }
  // a red check right after merging (nothing pushed): fix-filed, the line moves on
  if (run.check?.ok === false && !run.merged) { if (['merging-main', 'regenerating'].includes(st())) ev('conflict', { why: run.check.note || `checks failed after the merge: ${run.check.failed.join(', ')}`, files: [] }); return l; }
  if (run.error || !run.merged) { if (line.LIVE.includes(st()) && st() !== 'paused') ev('pause', { why: `Landing broke: ${run.error || 'merge failed'}`, by: 'lander' }); return l; }
  if (st() === 'merging-main') ev('merged-main', { sha: run.merged });
  if (st() === 'regenerating') {
    if (run.check?.ok === false) { ev('conflict', { why: run.check.note || `checks failed after the merge: ${run.check.failed.join(', ')}`, files: [] }); return l; }
    ev('regenerated', { head: run.merged });
  }
  const ci = lr.ciState(run.ci?.status, run.ci?.conclusion);
  const runOf = (conclusion, name = 'CI') => ({ name, status: 'completed', conclusion, head_sha: run.merged, app: { slug: 'github-actions' } });
  if (st() === 'checking') {
    if (run.check?.ok === false && run.check.failed?.length && ci !== 'success') ev('check', { runs: run.check.failed.map((n) => runOf('failure', n)) });
    else if (ci === 'failure') ev('check', { runs: [runOf('failure')] });
    else if (ci === 'success') ev('check', { runs: [runOf('success')] });
    else ev('check', { runs: [{ name: 'CI', status: 'in_progress', head_sha: run.merged, app: { slug: 'github-actions' } }] });
  }
  if (st() === 'landing' && run.outcome === 'landed') ev('landed', { sha: run.merged });
  return l;
}

/**
 * Land the line, one build at a time, until it is empty, `max` attempts ran, or the clock runs out. Each entry is tried
 * at most once per run. Returns { ran: [{ id, outcome, note }], busy?: owner }.
 */
export const batchesFile = (s) => join(s.dataDir, 'land-batches.jsonl');
export const updaterPath = () => process.env.AXF_CONSOLE_UPDATE ?? '/usr/local/bin/axf-console-update';

/**
 * After a lander batch that landed something: the console is redeployed once (axf-console-update) and checked for
 * doubled chrome (check-chrome-once.mjs: one banner, one menu bar on desktop and phone). A doubled console is an alert.
 * The batch (what landed / went red / was flagged, the redeploy and the check) is appended to land-batches.jsonl.
 */
export async function afterBatch({ s, ran, api = null, redeploy = null, check = null, log = () => {} }) {
  const landed = ran.filter((x) => x.outcome === 'landed').map((x) => x.build || x.id);
  const rec = { at: new Date().toISOString(), landed, red: ran.filter((x) => x.outcome === 'red').map((x) => x.build || x.id), flagged: ran.filter((x) => x.outcome === 'clash').map((x) => x.build || x.id), redeploy: null, chrome: null };
  if (landed.length) {
    const up = redeploy || (() => { const u = updaterPath(); if (!u || !existsSync(u)) return { ok: false, why: 'no axf-console-update here' }; const r = spawnSync(u, [], { encoding: 'utf8', timeout: 15 * 60000 }); return { ok: r.status === 0, why: (r.stderr || r.stdout || '').trim().split('\n').pop()?.slice(0, 200) || '' }; });
    rec.redeploy = up();
    log(`batch: ${landed.length} landed; console redeployed: ${rec.redeploy.ok ? 'ok' : rec.redeploy.why}`);
    const chk = check || (async () => (await import('./check-chrome-once.mjs')).checkChrome());
    try { rec.chrome = await chk(); } catch (e) { rec.chrome = { verdict: 'unknown', why: e.message.slice(0, 200) }; }
    log(`batch: chrome ${rec.chrome.verdict} (${rec.chrome.why})`);
    if (rec.chrome.verdict === 'doubled') {
      try { await (api || makeConsole(s))('POST', '/api/alerts', { source: 'push-banner', key: 'land:doubled-chrome', severity: 'warn', title: 'Console shows doubled chrome after landing', body: `After landing ${landed.join(', ')} the redeployed console shows ${rec.chrome.why}.`.slice(0, 600) }); } catch { /* the record says it */ }
    }
  }
  mkdirSync(s.dataDir, { recursive: true });
  appendFileSync(batchesFile(s), `${JSON.stringify(rec)}\n`);
  return rec;
}

export async function runLine({ s = settings(), max = 20, dry = false, land = landOne, now = () => new Date(), budgetMs = 50 * 60000, batch = afterBatch, log = () => {}, ...opts } = {}) {
  const ran = []; const tried = new Set(); const t0 = Date.now(); const paused = [];
  while (ran.length < max && Date.now() - t0 < budgetMs) {
    let l = readLine(s);
    if (l.on === false) break;
    const e = line.inFlight(l) && !tried.has(line.inFlight(l).id) ? line.inFlight(l) : (line.inFlight(l) ? null : (l.entries || []).find((x) => x.state === 'waiting' && !x.hold && !tried.has(x.id)));
    if (!e) break;
    tried.add(e.id);
    const r = await land({ s, build: e.build ? { id: e.build, branch: e.branch, pr: e.pr, title: e.title } : e.branch, dry, now, log, ...opts });
    if (!r.ran) { ran.push({ id: e.id, busy: r.owner }); break; }
    l = applyRun(readLine(s), e.id, r.run, now().toISOString());
    if (line.findEntry(l, e.id)?.state === 'paused') paused.push(e.id);
    if (!dry) writeLine(s, l);
    ran.push({ id: e.id, build: e.build, outcome: r.run.outcome, note: r.run.note });
    log(`line: ${e.id} → ${r.run.outcome || 'still checking'}: ${r.run.note}`);
    if (line.inFlight(l)) break; // CI still running on it: one at a time, resumed next run
  }
  // lander errors go back to waiting for the next run (never retried in a loop here)
  if (paused.length && !dry) { let l = readLine(s); for (const id of paused) { try { l = line.transition(l, { type: 'resume', id, by: 'lander' }); } catch { /* moved by hand */ } } writeLine(s, l); }
  // the batch boundary: one redeploy and one chrome check for everything this run landed
  const done = ran.filter((x) => x.outcome);
  const b = !dry && done.length && batch ? await batch({ s, ran: done, log }) : null;
  return { ran, batch: b };
}

export async function main(argv) {
  const s = settings(); const json = argv.includes('--json'); const dry = argv.includes('--dry-run');
  const args = argv.filter((a, i) => !a.startsWith('--') && !['--wait-min', '--max', '--wait-lock'].includes(argv[i - 1]));
  const out = (v, text) => console.log(json ? JSON.stringify(v, null, 1) : text);
  if (args[0] === 'lock') { const o = lockOwner(); out({ owner: o }, o || 'free'); return 0; }
  if (args[0] === 'runs') { const r = readRuns(s, args[1] || ''); out(r, r.map((x) => `${x.startedAt}  ${x.build}  ${x.outcome || 'going'}  ${x.note}`).join('\n') || 'no attempts yet'); return 0; }
  if (args[0] === 'show') { const v = line.view(readLine(s)); out(v, JSON.stringify(v, null, 1)); return 0; }
  if (args[0] === 'enqueue') {
    if (!args[1]) throw new Error('enqueue <build> [--front]');
    const git = makeGit(s.repo); const b = buildFromMain({ s, git, id: args[1] });
    if (!b?.branch) throw new Error(`no build ${args[1]} with a branch on main's builds store`);
    const e = enqueue(s, b, { front: argv.includes('--front') }); out(e, `${e.id}: ${e.state}`); return 0;
  }
  if (args[0] === 'line') {
    const i = argv.indexOf('--max'); const max = i >= 0 ? Number(argv[i + 1]) || 20 : 20;
    const r = await runLine({ s, max, dry, log: (m) => !json && console.error(m) });
    out(r, r.ran.map((x) => `${x.id}: ${x.busy ? `line busy (${x.busy})` : `${x.outcome || 'checking'} — ${x.note}`}`).join('\n') || 'the landing line is empty');
    return 0;
  }
  if (!args[0]) throw new Error('usage: land-one.mjs <build> [--dry-run] [--json] | runs [<build>] | lock | enqueue <build> [--front] | line [--max n] | show');
  const w = argv.indexOf('--wait-min'); const ciOpts = w >= 0 ? { waitMs: Math.max(0, Number(argv[w + 1]) || 0) * 60000 } : {};
  const wl = argv.indexOf('--wait-lock'); const wait = wl >= 0 ? Math.max(0, Number(argv[wl + 1]) || 0) * 60000 : 0;
  const r = await landOne({ s, build: args[0], dry, ciOpts, wait, log: (m) => !json && console.error(m) });
  if (!r.ran) { out(r, `the landing line is busy: ${r.owner}`); return 2; }
  out(r.run, `${r.run.build}: ${r.run.note}`);
  return ['error', 'clash', 'red'].includes(r.run.outcome) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
