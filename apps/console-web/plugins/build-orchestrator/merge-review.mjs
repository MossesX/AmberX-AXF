#!/usr/bin/env node
/**
 * Merge review runner (build merge-review-one-by-one-every-built-but-unmerged, Brett Nov 11 2026). Plain Node and git,
 * no model calls. Supersedes the land-all-97 auto landing: every build in status `built` is checked against current
 * main, oldest first, and presented to Brett one at a time; nothing merges without his yes. Rules: merge-review-core.mjs.
 *
 *   node apps/console-web/plugins/build-orchestrator/merge-review.mjs scan [--build <id>] [--limit n] [--no-fetch]
 *        analyse (scratch merge on current main, no worktree touched): changes, overlap with newer main work, lines the
 *        merge would lose, conflicts, already-on-main, PR CI; writes the review state
 *   … pause                         hold every reviewed PR out of the merge queue and auto-land; land-all-97 → blocked
 *   … next [--test] [--no-push]     present the oldest undecided build (console alert + AmberX push); --test runs the
 *                                   light checks on main + this branch (conflicts resolved toward main) first
 *   … test <build>                  the same test run for one build
 *   … list | show <build> | summary
 *   … decide <build> merge|skip|rebuild --by <who> [--why "…"]   Brett's answer (console click, voice, CLI):
 *        merge   → the PR goes back into the merge queue (the queue lands it; this tool never merges);
 *        skip    → the build is archived, its PR stays held;
 *        rebuild → the build is queued again to be rebuilt on current main, its PR stays held.
 *   Every command takes --json. State: <AXF_CONSOLE_ROOT or /opt/axf>/.axf-console/plugins/build-orchestrator/
 *   merge-review.json (the console reads the same file: GET /api/plugins/build-orchestrator/merge-review).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './merge-review-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const ORCH = join(HERE, 'orchestrator.mjs');
const LAND_DIR = join(HERE, '..', 'push-banner', 'land');
const LAND_ALL = 'land-all-97-built-but-unmerged-builds-skins-firs';
const consoleRoot = () => process.env.AXF_CONSOLE_ROOT || (existsSync('/opt/axf/.axf-console') ? '/opt/axf' : REPO);
export const stateFile = () => process.env.AXF_MERGE_REVIEW_FILE || join(consoleRoot(), '.axf-console', 'plugins', 'build-orchestrator', 'merge-review.json');

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }
export const readState = () => readJson(stateFile(), { $axf: core.FRAME, items: [] });
const saveState = (s) => writeJson(stateFile(), { ...s, $axf: core.FRAME, updatedAt: new Date().toISOString() });

function git(args, { cwd = REPO, timeout = 120000, input } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout, input, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: (r.stdout || '').trimEnd(), err: (r.stderr || '').trim() };
}
const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

function store() {
  const t = git(['show', 'origin/main:_claude/builds/store.json']);
  if (!t.code) return JSON.parse(t.out);
  return readJson(join(REPO, '_claude/builds/store.json'), { builds: [] });
}

/** PR number → { prCi, state } from the merge queue's last round (no GitHub calls). */
function queueInfo() {
  const d = readJson(join(consoleRoot(), '.axf-console', 'plugins', 'push-banner', 'merge-queue.json'), {});
  const m = new Map();
  for (const k of ['items', 'waiting', 'kicked', 'merged']) for (const x of d[k] || []) if (x?.pr) m.set(x.pr, { ci: x.prCi || x.ci || '', state: k === 'merged' ? 'merged' : x.state || k, why: x.why || '' });
  return m;
}

/** One build against current main. Scratch only: `git merge-tree` writes objects, never a worktree or a ref. */
export function analyse(b, { main = 'origin/main', queue = new Map(), prs = new Map() } = {}) {
  const ref = b.branch ? (git(['rev-parse', '-q', '--verify', `refs/remotes/origin/${b.branch}`]).code ? (git(['rev-parse', '-q', '--verify', `refs/heads/${b.branch}`]).code ? '' : b.branch) : `origin/${b.branch}`) : '';
  const pr = core.prNumber(b.pr);
  const q = pr ? queue.get(pr) : null;
  const a = { at: new Date().toISOString(), branch: b.branch || '', ref, ci: q?.ci || '', queueState: q?.state || '', prState: prs.get(pr) || '' };
  if (!ref) return { ...a, missing: true };
  a.head = git(['rev-parse', ref]).out;
  a.mainSha = git(['rev-parse', main]).out;
  const base = git(['merge-base', main, ref]).out;
  a.base = base;
  a.ahead = Number(git(['rev-list', '--count', `${main}..${ref}`]).out) || 0;
  a.behind = Number(git(['rev-list', '--count', `${ref}..${main}`]).out) || 0;
  a.unique = lines(git(['cherry', main, ref]).out).filter((l) => l.startsWith('+')).length;
  const changed = lines(git(['diff', '--name-status', '--no-renames', base, ref]).out).map((l) => { const [st, ...f] = l.split('\t'); return { st, file: f.join('\t') }; });
  a.codeFiles = changed.filter((c) => !core.isBookkeeping(c.file)).map((c) => `${c.st} ${c.file}`);
  a.bookkeeping = changed.length - a.codeFiles.length;
  const mainTouched = new Set(lines(git(['diff', '--name-only', '--no-renames', base, main]).out));
  a.overlap = changed.map((c) => c.file).filter((f) => !core.isBookkeeping(f) && mainTouched.has(f));
  const mt = git(['merge-tree', '--write-tree', '--name-only', '--no-messages', main, ref]);
  const out = lines(mt.out);
  a.tree = out[0] || '';
  a.conflicts = mt.code === 1 ? out.slice(1).filter((f) => !core.isBookkeeping(f) && !core.isGenerated(f)) : [];
  a.generatedConflicts = mt.code === 1 ? out.slice(1).filter(core.isGenerated) : [];
  a.bookkeepingConflicts = mt.code === 1 ? out.slice(1).filter(core.isBookkeeping).length : 0;
  if (mt.code > 1) a.mergeError = (mt.err || mt.out).slice(-300);
  // lines main added since the fork that the merged result would no longer have (overwritten or reverted newer code)
  a.reverts = [];
  for (const f of a.overlap.slice(0, 60)) {
    if (a.conflicts.includes(f)) continue;
    const merged = a.tree ? git(['show', `${a.tree}:${f}`]) : { code: 1 };
    const lost = core.lostLines(git(['diff', '-U0', base, main, '--', f]).out, merged.code ? '' : merged.out);
    if (lost.length) a.reverts.push({ file: f, lines: lost.length, sample: lost.slice(0, 3).map((x) => x.trim().slice(0, 120)), deleted: !!merged.code });
  }
  // newer work: the main commits since the fork that touched the overlapping files (most recent first)
  a.newer = a.overlap.length ? lines(git(['log', '--format=%h %s', '-n', '6', `${base}..${main}`, '--', ...a.overlap.slice(0, 40)]).out).filter((s) => !/\[skip ci\]/.test(s)).slice(0, 5) : [];
  return a;
}

/** Light checks on main + this branch, conflicts resolved toward main, in a scratch worktree (heavy slot). */
export function test(b) {
  const a = analyse(b);
  if (a.missing) return { ok: false, skipped: 'branch not found' };
  const dir = mkdtempSync(join(tmpdir(), 'merge-review-'));
  try {
    const wt = git(['worktree', 'add', '-q', '--detach', dir, 'origin/main']);
    if (wt.code) return { ok: false, error: wt.err.slice(-300) };
    const m = git(['-c', 'user.name=AXF merge review', '-c', 'user.email=merge-review@amberxai.com', 'merge', '-q', '--no-edit', '-X', 'ours', a.ref], { cwd: dir });
    if (m.code) return { ok: false, error: `merge failed: ${(m.err || m.out).slice(-300)}` };
    const slots = join(REPO, 'framework', 'cli', 'agent-slots.mjs');
    const r = spawnSync('node', [slots, 'heavy', '--', 'node', 'framework/cli/ci-scope.mjs', 'light', '--run'], { cwd: dir, encoding: 'utf8', timeout: 25 * 60000, maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, code: r.status, tail: `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-12).join('\n').slice(-1500), at: new Date().toISOString() };
  } finally {
    git(['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
}

function fetchAll(builds) {
  const refs = [...new Set(builds.map((b) => b.branch).filter(Boolean))].map((br) => `+refs/heads/${br}:refs/remotes/origin/${br}`);
  git(['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { timeout: 300000 });
  // one fetch per chunk; a branch that is gone makes the whole fetch fail, so retry those one by one
  for (let i = 0; i < refs.length; i += 25) {
    const chunk = refs.slice(i, i + 25);
    if (git(['fetch', '-q', 'origin', ...chunk], { timeout: 300000 }).code) for (const r of chunk) git(['fetch', '-q', 'origin', r], { timeout: 120000 });
  }
}

/** PR number → open | closed | merged, from GitHub (a few list calls; empty when GitHub can't be reached). */
async function prStates() {
  const m = new Map();
  try {
    const { land, s } = await queueTools();
    const gh = land.makeGitHub(s);
    for (let page = 1; page <= 8; page++) {
      const list = await gh('GET', `/repos/${s.slug}/pulls?state=all&per_page=100&page=${page}`);
      for (const p of list || []) m.set(p.number, p.merged_at ? 'merged' : p.state);
      if (!list || list.length < 100) break;
    }
  } catch { /* the review works without it */ }
  return m;
}

export async function scan({ only = '', limit = 0, fetch = true, log = () => {} } = {}) {
  let list = core.candidates(store());
  if (only) list = list.filter((b) => b.id === only);
  if (limit) list = list.slice(0, limit);
  if (fetch) fetchAll(list);
  const queue = queueInfo();
  const prs = await prStates();
  const prev = readState();
  const old = new Map((prev.items || []).map((x) => [x.id, x]));
  const fresh = list.map((b, i) => {
    log(`${i + 1}/${list.length} ${b.id}`);
    const analysis = analyse(b, { queue, prs });
    const was = old.get(b.id) || {};
    return { ...was, id: b.id, title: b.title, pr: b.pr || '', branch: b.branch || '', builtAt: b.builtAt || b.updatedAt || '', createdAt: b.createdAt || '', analysis: { ...analysis, test: was.analysis?.head === analysis.head ? was.analysis?.test : undefined }, verdict: core.verdict(analysis) };
  });
  // a full scan keeps the order (oldest first) and drops builds no longer built unless Brett already answered them
  const ids = new Set(fresh.map((x) => x.id));
  const items = only ? (prev.items || []).map((x) => (x.id === only ? fresh[0] || x : x)).concat(fresh.filter((x) => !old.has(x.id)))
    : [...fresh, ...(prev.items || []).filter((x) => !ids.has(x.id) && x.decision)];
  const st = { ...prev, items, scannedAt: new Date().toISOString(), main: git(['rev-parse', 'origin/main']).out };
  saveState(st);
  return st;
}

function orch(...args) {
  const r = spawnSync('node', [ORCH, 'act', ...args], { cwd: REPO, encoding: 'utf8', timeout: 120000, env: { ...process.env, AXF_ACTOR: 'merge-review' } });
  return { ok: r.status === 0, out: (r.stdout || r.stderr || '').trim().slice(-400) };
}

async function queueTools() {
  const mq = await import(join(LAND_DIR, 'merge-queue.mjs'));
  const land = await import(join(LAND_DIR, 'land.mjs'));
  return { mq, land, s: land.settings() };
}

/** Hold every reviewed PR out of the merge queue and auto-land, and stop land-all-97. Idempotent. */
export async function pause() {
  const st = readState();
  const { mq, land, s } = await queueTools();
  const held = [];
  for (const x of st.items || []) {
    if (x.decision === 'merge') continue;
    const pr = core.prNumber(x.pr);
    if (pr && !readJson(mq.queueControlFile(s), {}).removed?.[pr]) { mq.queueControl(s, 'remove', pr, { why: core.HOLD_WHY }); held.push(pr); }
    land.control(s, 'hold', x.id, { why: core.HOLD_WHY });
  }
  const b = (store().builds || []).find((x) => x.id === LAND_ALL);
  let landAll = 'not found';
  if (b && !['blocked', 'archived', 'complete'].includes(b.status)) {
    orch('status', LAND_ALL, 'blocked');
    orch('note', LAND_ALL, 'Paused: superseded by merge-review-one-by-one-every-built-but-unmerged. Brett decides each built build one at a time (merge, skip or rebuild); nothing lands without his yes.');
    landAll = 'blocked';
  } else if (b) landAll = b.status;
  saveState({ ...st, pausedAt: new Date().toISOString() });
  return { held, landAll };
}

async function consoleApi() {
  const { land, s } = await queueTools();
  return land.makeConsole(s);
}

/** Present the oldest undecided build: console alert (AmberX push through the notify type merge-review.next). */
export async function present({ runTest = false, push = true } = {}) {
  let st = readState();
  const item = core.next(st);
  if (!item) return { done: true, summary: core.summary(st) };
  if (runTest) {
    const b = (store().builds || []).find((x) => x.id === item.id) || item;
    item.analysis = { ...item.analysis, test: test(b) };
    item.verdict = core.verdict(item.analysis);
    st = { ...st, items: st.items.map((x) => (x.id === item.id ? item : x)) };
  }
  const undecided = st.items.filter((x) => !x.decision);
  const pos = { index: st.items.indexOf(st.items.find((x) => x.id === item.id)) + 1, total: st.items.length };
  const alert = core.alertFor(item, pos);
  let sent = false;
  if (push) { const api = await consoleApi(); sent = !!(await api('POST', '/api/alerts', alert)); }
  saveState({ ...st, current: item.id, presentedAt: new Date().toISOString() });
  return { item, card: core.card(item, pos), alert, left: undecided.length, sent };
}

/** Brett's answer. merge → back into the merge queue; skip → archived; rebuild → queued again on current main. */
export async function answer(id, decision, { by = '', why = '' } = {}) {
  if (!by) throw new Error('say who answered (--by): only Brett decides');
  let st = core.decide(readState(), id, decision, { by, why });
  const item = st.items.find((x) => x.id === id);
  const pr = core.prNumber(item.pr);
  const { mq, land, s } = await queueTools();
  const done = [];
  if (decision === 'merge') {
    if (pr) { mq.queueControl(s, 'add', pr); done.push(`PR #${pr} back in the merge queue`); }
    land.control(s, 'release', id);
    orch('note', id, `Merge review: Brett said merge (${by}).${why ? ` ${why}` : ''} The merge queue lands it.`);
  } else if (decision === 'skip') {
    if (pr) mq.queueControl(s, 'remove', pr, { why: 'Merge review: Brett skipped it' });
    orch('status', id, 'archived');
    orch('note', id, `Merge review: Brett skipped it (${by}); archived.${why ? ` ${why}` : ''}`);
    done.push('archived');
  } else {
    if (pr) mq.queueControl(s, 'remove', pr, { why: 'Merge review: rebuild on current main' });
    orch('note', id, `Merge review: Brett said rebuild on current main (${by}). Start from main; keep every newer change. Findings: ${item.verdict?.why || ''}${why ? ` ${why}` : ''}`);
    orch('status', id, 'queued');
    done.push('queued to rebuild');
  }
  const api = await consoleApi();
  await api('POST', '/api/alerts/resolve', { keys: [core.alertKey(id)] });
  saveState(st);
  return { id, decision, done, next: core.next(st)?.id || '' };
}

// ------------------------------------------------------------------ CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd = 'list', ...rest] = process.argv.slice(2);
  const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : ''; };
  const json = rest.includes('--json');
  const print = (v, text) => { console.log(json ? JSON.stringify(v) : text ?? JSON.stringify(v, null, 1)); };
  try {
    if (cmd === 'scan') {
      const st = await scan({ only: flag('--build'), limit: Number(flag('--limit')) || 0, fetch: !rest.includes('--no-fetch'), log: json ? () => {} : (m) => process.stderr.write(`${m}\n`) });
      const s = core.summary(st);
      print({ ok: true, summary: s }, `scanned ${st.items.length}: ${Object.entries(s.risk).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    } else if (cmd === 'pause') print({ ok: true, ...(await pause()) });
    else if (cmd === 'next') { const r = await present({ runTest: rest.includes('--test'), push: !rest.includes('--no-push') }); print({ ok: true, ...r }, r.done ? 'merge review done' : `${r.card}\n(${r.left} left${r.sent ? ', sent to console + AmberX' : ''})`); }
    else if (cmd === 'test') { const b = (store().builds || []).find((x) => x.id === rest[0]); if (!b) throw new Error(`no build ${rest[0]}`); print({ ok: true, test: test(b) }); }
    else if (cmd === 'decide') print({ ok: true, ...(await answer(rest[0], rest[1], { by: flag('--by') || process.env.AXF_APPROVER || '', why: flag('--why') })) });
    else if (cmd === 'show') { const st = readState(); const x = st.items.find((i) => i.id === rest[0]); if (!x) throw new Error(`no build ${rest[0]} in the merge review`); print({ ok: true, item: x }, `${core.card(x, { index: st.items.indexOf(x) + 1, total: st.items.length })}\n${JSON.stringify(x.analysis, null, 1)}`); }
    else if (cmd === 'summary') { const st = readState(); print({ ok: true, summary: core.summary(st), current: st.current || '', pausedAt: st.pausedAt || '' }); }
    else if (cmd === 'list') { const st = readState(); print({ ok: true, items: st.items.map((x) => ({ id: x.id, title: x.title, pr: x.pr, builtAt: x.builtAt, risk: x.verdict?.risk, advice: x.verdict?.advice, why: x.verdict?.why, decision: x.decision || '' })) }, st.items.map((x, i) => `${String(i + 1).padStart(3)} ${(x.decision || '·').padEnd(7)} ${(x.verdict?.risk || '?').padEnd(8)} ${x.pr || '    '} ${x.id}`).join('\n')); }
    else throw new Error(`unknown command ${cmd}`);
  } catch (e) {
    print({ ok: false, error: e.message }, `merge-review: ${e.message}`);
    process.exitCode = 1;
  }
}
