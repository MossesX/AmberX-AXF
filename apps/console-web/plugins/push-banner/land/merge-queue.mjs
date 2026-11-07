#!/usr/bin/env node
/**
 * Merge queue runner (build merge-queue, Brett Nov 4 2026). Plain Node: git and the GitHub REST API, no model calls.
 * Runs on the VPS host as part of every auto-land round (`land.mjs run`, cron every 3 minutes); the console reads
 * what it writes (merge-queue.json in the push banner's data folder) and writes Brett's commands to
 * merge-queue-control.json. The rules are merge-queue-core.mjs.
 *
 *   node apps/console-web/plugins/push-banner/land/merge-queue.mjs run [--dry-run] [--json]   one round
 *   … list [--json] | add <pr> | remove <pr> [--why "…"] | move <pr> <index>                 (0 = front)
 *
 * One round:
 *   1. the open PRs into main: ready ones (PR checks green, not a draft, not held by UI Review or by hand, not kicked
 *      out at this head) line up in queue order;
 *   2. last round's stack is kept as far as it still holds (same PRs in the same order, same heads, main unchanged
 *      in code outside the queue);
 *   3. CI on each queue commit: the green ones at the head merge (GitHub merge, head pinned, no retest: their run
 *      tested exactly this code); the first red one whose every PR ahead passed is kicked out (a plain reason on the
 *      PR, in the view and as one console alert), and the ones behind it are rebuilt without it;
 *   4. the stack is filled up to `queueDepth`: queue/pr-<n> = the commit ahead + this PR (builds files newer-wins,
 *      logs unioned, generated files regenerated; a code conflict waits or, against main alone, kicks it out), pushed,
 *      and CI runs on it by itself (android.yml runs on queue/**);
 *   5. queue branches no longer in the stack are deleted (a merged one is kept a while, so main's CI can see it
 *      already ran), and the repo variable AXF_MERGE_QUEUE follows the setting (on = PRs run the light checks).
 */
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as q from './merge-queue-core.mjs';
import * as core from './land-core.mjs';
import { ciOf, mergeMain, settings, makeGit, makeGitHub, makeConsole } from './land.mjs';
import { conflictRound } from './conflicts.mjs';
import { isConflictRefusal } from './conflicts-core.mjs';

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }
const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

export const queueFile = (s) => join(s.dataDir, 'merge-queue.json');
export const queueControlFile = (s) => join(s.dataDir, 'merge-queue-control.json');
export const readQueue = (s) => readJson(queueFile(s), { $axf: q.QUEUE_FRAME, items: [], stack: [], waiting: [], kicked: [], merged: [] });
export const readQueueControl = (s) => readJson(queueControlFile(s), { $axf: q.QUEUE_CONTROL_FRAME, order: [], removed: {}, kicked: {}, added: [] });
export function readQueueConfig(s) {
  const c = readJson(join(s.dataDir, 'config.json'), {}) || {};
  const depth = Number.isInteger(c.queueDepth) ? Math.min(q.QUEUE_DEPTH_MAX, Math.max(1, c.queueDepth)) : q.QUEUE_DEFAULTS.queueDepth;
  return { mergeQueue: c.mergeQueue !== false, depth, waitUi: c.landWaitUi !== false };
}
export function queueControl(s, cmd, pr, opts = {}) {
  const cur = (readQueue(s).items || []).map((x) => x.pr);
  const head = opts.head ?? ((readQueue(s).items || []).find((x) => x.pr === Number(pr))?.head || (readQueue(s).waiting || []).find((x) => x.pr === Number(pr))?.head || '');
  const d = q.applyQueueControl(readQueueControl(s), cmd, pr, { ...opts, head, current: cur });
  writeJson(queueControlFile(s), d);
  return d;
}

/**
 * Combine `head` into `parent` in a temporary worktree (same data rules as auto-land's main merge) and return the
 * commit: { sha } or { conflicts: [code files] } or { error }. Nothing is pushed here.
 */
export function combine({ s, git, parent, head, message }) {
  const dir = mkdtempSync(join(tmpdir(), 'axf-queue-')); const wt = join(dir, 'wt');
  const g = (a, o = {}) => git(a, { ...o, cwd: wt });
  const live = join(s.repo, 'framework/cli/builds-live.mjs');
  const drv = ['-c', `merge.axf-builds.driver=node "${live}" merge-driver %O %A %B %P`, '-c', 'user.name=AXF merge queue', '-c', 'user.email=merge-queue@amberxai.com'];
  try {
    const r = git(['worktree', 'add', '-q', '--detach', wt, parent]);
    if (r.code) return { error: `worktree: ${r.err.slice(-200)}` };
    const m = g([...drv, 'merge', '--no-ff', '--no-edit', '-m', message, head], { timeout: 180000 });
    if (m.code) {
      const left = lines(g(['diff', '--name-only', '--diff-filter=U']).out);
      if (!left.length) { g(['merge', '--abort']); return { error: `merge: ${(m.err || m.out).slice(-200)}` }; }
      const plan = core.planConflicts(left);
      if (plan.code.length) { g(['merge', '--abort']); return { conflicts: plan.code }; }
      // the PR's builds files win here like auto-land's; main's copy is merged back in when the PR lands
      for (const p of plan.builds) { if (g(['checkout', '--theirs', '--', p]).code === 0) g(['add', '--', p]); }
      for (const p of plan.union) {
        const stage = (n) => { const x = g(['show', `:${n}:${p}`]); return x.code ? '' : `${x.out}\n`; };
        const f = (n, t) => { const x = join(dir, `${n}.txt`); writeFileSync(x, t); return x; };
        const ours = f('ours', stage(2)); const base = f('base', stage(1)); const theirs = f('theirs', stage(3));
        g(['merge-file', '--union', ours, base, theirs]); writeFileSync(join(wt, p), readFileSync(ours)); g(['add', '--', p]);
      }
      for (const p of plan.generated) { g(['checkout', '--ours', '--', p]); const cmd = core.regenFor(p); if (cmd) spawnSync(cmd[0], cmd.slice(1), { cwd: wt, timeout: 120000 }); g(['add', '--', p]); }
      if (lines(g(['diff', '--name-only', '--diff-filter=U']).out).length) { g(['merge', '--abort']); return { conflicts: left }; }
      const c = g([...drv, 'commit', '-q', '--no-edit']);
      if (c.code) { g(['merge', '--abort']); return { error: `commit: ${c.err.slice(-200)}` }; }
    }
    return { sha: g(['rev-parse', 'HEAD']).out };
  } finally { git(['worktree', 'remove', '--force', wt]); rmSync(dir, { recursive: true, force: true }); }
}

/** Run times (minutes) of a commit's finished GitHub Actions check runs, or null while any still runs. */
function runSpan(runs) {
  const ours = (runs || []).filter((r) => (r?.app?.slug || 'github-actions') === 'github-actions' && r.started_at);
  if (!ours.length || ours.some((r) => r.status !== 'completed')) return null;
  const t0 = Math.min(...ours.map((r) => Date.parse(r.started_at))); const t1 = Math.max(...ours.map((r) => Date.parse(r.completed_at || r.started_at)));
  return Math.round((t1 - t0) / 60000);
}

/** Keep the repo variable AXF_MERGE_QUEUE on what the setting says (on = PRs run only the light checks). */
async function syncVariable(s, gh, want, prev) {
  const value = want ? 'on' : 'off';
  if (prev?.variable === value) return { variable: value };
  try {
    try { await gh('PATCH', `/repos/${s.slug}/actions/variables/AXF_MERGE_QUEUE`, { name: 'AXF_MERGE_QUEUE', value }); }
    catch (e) { if (e.status !== 404) throw e; await gh('POST', `/repos/${s.slug}/actions/variables`, { name: 'AXF_MERGE_QUEUE', value }); }
    return { variable: value };
  } catch (e) { return { variable: prev?.variable || '', variableError: `couldn't set the repo variable AXF_MERGE_QUEUE (${String(e.message).slice(0, 160)}); PRs keep running the full (path-filtered) checks` }; }
}

const agentOf = (b, pr) => {
  const by = String(b?.agent || b?.origin?.by || '').replace(/\s*\(.*$/, '');
  return by && !/^(backfill|brett|console|orchestrator)$/i.test(by) ? by : (pr?.user?.login || '');
};

export async function queueRound({ s, git, gh, api, dry = false, now = () => new Date(), log = () => {}, fetched = false, watch = {} } = {}) {
  const cfg = readQueueConfig(s); const prev = readQueue(s); let ctl = readQueueControl(s);
  const at = now().toISOString();
  const base = { $axf: q.QUEUE_FRAME, at, on: cfg.mergeQueue, depth: cfg.depth };
  if (!cfg.mergeQueue) {
    const v = dry ? {} : await syncVariable(s, gh, false, prev);
    const st = { ...base, items: [], stack: [], waiting: [], kicked: [], merged: prev.merged || [], ...v };
    if (!dry) writeJson(queueFile(s), st);
    return st;
  }
  if (!fetched) git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
  git(['fetch', '-q', '--prune', s.remote, '+refs/heads/queue/*:refs/remotes/origin/queue/*'], { timeout: 120000 });
  const mainSha = git(['rev-parse', `${s.remote}/${s.base}`]).out;
  const storeText = git(['show', `${s.remote}/${s.base}:_claude/builds/store.json`]);
  const builds = storeText.code ? [] : (JSON.parse(storeText.out).builds || []).filter((b) => !b.deleted);
  const buildOf = (br) => builds.find((b) => b.branch === br);
  const land = readJson(join(s.dataDir, 'land.json'), {}) || {};
  const landCtl = readJson(join(s.dataDir, 'land-control.json'), {}) || {};
  const rank = Object.fromEntries((land.order || []).map((n, i) => [n, i]));

  let pulls = [];
  try { pulls = await gh('GET', `/repos/${s.slug}/pulls?state=open&per_page=100`); } catch (e) { log(`queue pulls: ${e.message}`); return { ...prev, at, error: e.message }; }
  pulls = (Array.isArray(pulls) ? pulls : []).filter((p) => p?.base?.ref === s.base && (p?.head?.repo?.full_name || '').toLowerCase() === s.slug.toLowerCase() && !q.isQueueBranch(p?.head?.ref));
  const prevAll = new Map([...(prev.items || []), ...(prev.waiting || [])].map((x) => [x.pr, x]));

  // 1. the open PRs, what holds each, and the ready ones in queue order
  const prs = [];
  for (const p of pulls) {
    const b = buildOf(p.head.ref); const old = prevAll.get(p.number) || {};
    const fact = { number: p.number, title: String(p.title || '').slice(0, 200), branch: p.head.ref, head: p.head.sha, draft: !!p.draft, createdAt: p.created_at, url: p.html_url || '', build: b?.id || '', agent: agentOf(b, p), priority: q.buildPriority(b) };
    if (old.head === fact.head && ['success', 'failure'].includes(old.prCi)) fact.ci = old.prCi;
    else { try { fact.ci = ciOf((await gh('GET', `/repos/${s.slug}/commits/${fact.head}/check-runs?per_page=100`))?.check_runs || []).ci; } catch { fact.ci = 'running'; } }
    // no PR checks at all: does it conflict with main? (git, no API call)
    if (fact.ci === 'none') fact.conflicted = git(['merge-tree', '--write-tree', '--quiet', `${s.remote}/${s.base}`, fact.head]).code === 1;
    if (cfg.waitUi) { const u = await api('GET', `/api/plugins/push-banner/ui-hold?branch=${encodeURIComponent(fact.branch)}&pr=${fact.number}`); fact.ui = u ? String(u.hold || '') : 'unknown'; }
    if (b && landCtl.holds?.[b.id]) fact.landHeld = landCtl.holds[b.id].why || 'held';
    fact.why = q.notReady(fact, ctl, { waitUi: cfg.waitUi });
    prs.push(fact);
  }
  ctl = q.pruneControl(ctl, prs.map((p) => p.number));
  const ready = q.queueOrder(prs.filter((p) => !p.why), ctl, rank, prev.stack || []);

  // 2. what of last round's stack still holds: main must have the code the stack was built on
  const expect = prev.expect || '';
  const mainMoved = !expect || git(['cat-file', '-e', `${expect}^{commit}`]).code !== 0 || !q.sameCodeFiles(lines(git(['diff', '--name-only', expect, mainSha]).out));
  let stack = q.keepStack(prev.stack || [], ready, { mainMoved });
  for (const e of stack) { delete e.state; delete e.why; }
  if (mainMoved && (prev.stack || []).length) log(`queue: main moved in code outside the queue; the stack is rebuilt on ${mainSha.slice(0, 8)}`);

  // 3. CI on each queue commit; merge the green head ones, kick the one to blame
  const history = [...(prev.history || [])];
  for (const e of stack) {
    if (['success', 'failure'].includes(e.ci)) continue;
    try {
      const runs = (await gh('GET', `/repos/${s.slug}/commits/${e.sha}/check-runs?per_page=100`))?.check_runs || [];
      const c = ciOf(runs); e.ci = c.ci; e.failing = c.failing;
      const span = runSpan(runs); if (span != null && c.ci !== 'running') history.push(span);
      e.runUrl = runs.find((r) => r.html_url)?.html_url?.replace(/\/job\/\d+$/, '') || e.runUrl || '';
      const started = runs.map((r) => Date.parse(r.started_at || '')).filter((x) => x > 0);
      if (started.length) e.startedAt = new Date(Math.min(...started)).toISOString();
    } catch { e.ci = e.ci || 'running'; }
    // pushed but no run started (a dropped push event): start one on the queue branch, once
    if (e.ci === 'none' && !dry && !e.dispatched && Date.parse(at) - Date.parse(e.builtAt || at) > q.NO_RUN_MIN * 60000) {
      try { await gh('POST', `/repos/${s.slug}/actions/workflows/${s.workflow || 'android.yml'}/dispatches`, { ref: q.queueBranch(e.pr) }); e.dispatched = at; } catch (err) { log(`queue: dispatch #${e.pr}: ${err.message}`); }
    }
  }
  const d = q.decide(stack, Object.fromEntries(stack.map((e) => [e.pr, e.ci])));
  const merged = [...(prev.merged || [])].slice(-20);
  // one deploy per stack: the console updater (deploy/install-console.sh) waits while this file is fresh
  const holdDeploy = join(s.dataDir, 'queue-merging');
  if (!dry && (d.merge || []).length) writeFileSync(holdDeploy, `${at}\n`);
  let newExpect = mainMoved ? mainSha : expect;
  const refused = {}; // passed, but GitHub refused it over conflicts: the conflict watch alerts on it this round
  for (const n of d.merge) {
    const e = stack.find((x) => x.pr === n);
    const p = prs.find((x) => x.number === n);
    if (dry) { e.state = 'merging'; continue; }
    const r = await mergeTested({ s, git, gh, e, p, log });
    if (!r.merged) { e.state = 'passed'; e.why = r.why; log(`queue: #${n} passed but didn't merge: ${r.why}`); if (isConflictRefusal(r.why)) refused[n] = r.why; break; }
    merged.push({ pr: n, title: p?.title || '', sha: r.sha, queueSha: e.sha, at, retested: false, branch: q.queueBranch(n), agent: p?.agent || '' });
    newExpect = r.sha;
    git(['fetch', '-q', s.remote, s.base]);
    if (!r.same) { log(`queue: main after #${n} differs in code from what was tested; the rest is rebuilt`); stack = []; break; }
    stack = stack.filter((x) => x.pr !== n);
  }
  // part of the stack merged and the rest is still running: keep the deploy waiting for it (the 15-minute staleness in
  // the updater bounds this); otherwise the stack is in, or nothing landed, and the update may run
  const holding = (d.merge || []).length || existsSync(holdDeploy);
  if (!dry && holding && stack.some((x) => x.ci !== 'failure' && x.ci !== 'success')) writeFileSync(holdDeploy, `${at}\n`);
  else if (!dry) rmSync(holdDeploy, { force: true });
  const kicked = [...(prev.kicked || [])].slice(-20);
  if (d.kick && stack.some((x) => x.pr === d.kick)) {
    const i = stack.findIndex((x) => x.pr === d.kick); const e = stack[i];
    const why = q.kickReason(e.pr, { failing: e.failing, ahead: (e.ahead || []).filter((n) => !merged.some((m) => m.pr === n)), url: e.runUrl });
    if (!dry) {
      ctl = q.applyQueueControl(ctl, 'kick', e.pr, { why, head: e.head, at });
      await gh('POST', `/repos/${s.slug}/issues/${e.pr}/comments`, { body: `**Kicked out of the merge queue.** ${why}\n\nPush a fix to this branch and it rejoins the queue by itself. The PRs behind it are retested without it.` }).catch(() => {});
      await api('POST', '/api/alerts', { source: 'push-banner', key: `queue:${e.pr}`, severity: 'warning', title: `Merge queue: #${e.pr} kicked out`.slice(0, 200), body: why });
    }
    kicked.push({ pr: e.pr, title: prs.find((x) => x.number === e.pr)?.title || '', head: e.head, why, at, runUrl: e.runUrl || '' });
    stack = stack.slice(0, i);
    const p = prs.find((x) => x.number === e.pr); if (p) p.why = `kicked out: ${why}`;
  }

  // 4. fill the stack up to depth, in queue order
  const mergedNow = new Set(merged.filter((m) => m.at === at).map((m) => m.pr));
  const order = q.queueOrder(prs.filter((p) => !p.why && !mergedNow.has(p.number)), ctl, rank, stack);
  const skipped = new Map();
  for (const p of order) {
    if (stack.length >= cfg.depth) break;
    if (stack.some((x) => x.pr === p.number)) continue;
    const parent = stack.length ? stack[stack.length - 1].sha : (merged.some((m) => m.at === at) ? git(['rev-parse', `${s.remote}/${s.base}`]).out : mainSha);
    const ahead = stack.map((x) => x.pr);
    git(['fetch', '-q', s.remote, `+refs/heads/${p.branch}:refs/remotes/${s.remote}/${p.branch}`]);
    const c = combine({ s, git, parent, head: p.head, message: `Merge queue: #${p.number} on top of ${ahead.length ? ahead.map((n) => `#${n}`).join(', ') : 'main'}\n\n${p.title}` });
    if (c.conflicts) {
      if (!ahead.length) {
        const why = `#${p.number} conflicts with main in code (${c.conflicts.slice(0, 3).join(', ')}). Merge main in and fix them.`;
        if (!dry) ctl = q.applyQueueControl(ctl, 'kick', p.number, { why, head: p.head, at });
        kicked.push({ pr: p.number, title: p.title, head: p.head, why, at }); p.why = `kicked out: ${why}`;
      } else skipped.set(p.number, `conflicts with ${ahead.map((n) => `#${n}`).join(', ')} ahead of it in code; tested once they merge`);
      continue;
    }
    if (c.error) { skipped.set(p.number, `couldn't build its queue commit (${c.error})`); continue; }
    if (!dry) {
      const r = git(['push', '-q', '--force', s.remote, `${c.sha}:refs/heads/${q.queueBranch(p.number)}`], { timeout: 90000 });
      if (r.code) { skipped.set(p.number, `couldn't push ${q.queueBranch(p.number)} (${r.err.slice(-160)})`); continue; }
    }
    stack.push({ pr: p.number, head: p.head, ahead, sha: c.sha, base: parent, builtAt: at, ci: 'running', failing: [] });
  }

  // 5. tidy queue branches; the variable; the state the console shows
  const keepRefs = new Set([...stack.map((e) => q.queueBranch(e.pr)), ...merged.filter((m) => Date.parse(at) - Date.parse(m.at) < 60 * 60000).map((m) => m.branch)]);
  if (!dry) {
    for (const ref of lines(git(['for-each-ref', '--format=%(refname:strip=3)', `refs/remotes/${s.remote}/queue/`]).out)) {
      if (q.isQueueBranch(ref) && !keepRefs.has(ref)) git(['push', '-q', s.remote, '--delete', ref], { timeout: 60000 });
    }
  }
  const v = dry ? {} : await syncVariable(s, gh, true, prev);
  const avg = q.runMinutes(history);
  const nowMs = Date.parse(at);
  const items = [];
  for (const [i, e] of stack.entries()) {
    const p = prs.find((x) => x.number === e.pr) || {};
    const startedMin = e.startedAt ? (nowMs - Date.parse(e.startedAt)) / 60000 : 0;
    const state = e.state || (e.ci === 'success' ? 'passed' : 'testing');
    const why = e.why || (e.ci === 'failure' ? 'its run failed; waits for the PRs ahead of it to finish to see which one broke it' : '');
    items.push({ pr: e.pr, title: p.title || '', url: p.url || '', branch: p.branch || '', head: e.head, build: p.build || '', agent: p.agent || '', priority: p.priority || '', state, ci: e.ci, queueBranch: q.queueBranch(e.pr), queueSha: e.sha, ahead: e.ahead, runUrl: e.runUrl || '', why, etaMin: q.etaMinutes(i, { depth: cfg.depth, avg, startedMin }) });
  }
  const rest = order.filter((p) => !stack.some((e) => e.pr === p.number) && !p.why);
  for (const [j, p] of rest.entries()) items.push({ pr: p.number, title: p.title, url: p.url, branch: p.branch, head: p.head, build: p.build, agent: p.agent, priority: p.priority, state: 'waiting', ci: '', why: skipped.get(p.number) || '', etaMin: q.etaMinutes(stack.length + j, { depth: cfg.depth, avg }) });
  const waiting = prs.filter((p) => p.why && !mergedNow.has(p.number)).map((p) => ({ pr: p.number, title: p.title, url: p.url, branch: p.branch, head: p.head, build: p.build, agent: p.agent, state: p.why.startsWith('kicked out') ? 'kicked' : 'held', why: p.why, prCi: p.ci }));
  for (const it of items) { const p = prs.find((x) => x.number === it.pr); if (p) it.prCi = p.ci; }
  const st = { ...base, mainSha, expect: newExpect || mainSha, avgMin: avg, history: history.slice(-20), stack, items, waiting, kicked: kicked.filter((k) => prs.some((p) => p.number === k.pr)).slice(-20), merged, ...v };
  if (!dry) { writeJson(queueFile(s), st); writeJson(queueControlFile(s), ctl); }
  try {
    const open = prs.filter((p) => !mergedNow.has(p.number));
    await conflictRound({ s, git, api, prs: open, mainSha: git(['rev-parse', `${s.remote}/${s.base}`]).out, refused, dry, now, log, requeue: (n) => queueControl(s, 'add', n), ...watch });
  } catch (err) { log(`conflict watch: ${err.message}`); } // never stops the queue
  return st;
}

/**
 * Merge one PR whose queue run passed, with no retest: GitHub merges its head (pinned). When GitHub can't (main moved
 * on, a builds-file clash), main is merged into the branch first like auto-land does, and that head is merged only if
 * its code equals the tested queue commit. Returns { merged, sha, same, why }.
 */
async function mergeTested({ s, git, gh, e, p, log }) {
  const tryMerge = async (sha) => gh('PUT', `/repos/${s.slug}/pulls/${e.pr}/merge`, { merge_method: 'merge', sha, commit_title: `Merge pull request #${e.pr} from ${p?.branch || ''} (merge queue: tested as ${q.queueBranch(e.pr)} ${e.sha.slice(0, 8)})`.slice(0, 250) });
  let head = e.head; let r;
  try { r = await tryMerge(head); }
  catch (err) {
    if (![405, 409, 422].includes(err.status) || !p?.branch) return { merged: false, why: err.message };
    const m = mergeMain({ s, git, b: { id: `pr-${e.pr}`, branch: p.branch }, dry: false });
    if (!m.merged) return { merged: false, why: m.conflicts?.length ? `main conflicts with it in ${m.conflicts.slice(0, 3).join(', ')}` : m.pushError || 'main could not be merged in' };
    git(['fetch', '-q', s.remote, `+refs/heads/${p.branch}:refs/remotes/${s.remote}/${p.branch}`]);
    head = m.sha;
    if (!q.sameCodeFiles(lines(git(['diff', '--name-only', e.sha, head]).out))) return { merged: false, why: 'after main was merged in, its code differs from what the queue tested; retested' };
    // GitHub works out mergeability after a push, so a refusal right after ours is not an answer yet
    for (let i = 0; ; i++) {
      try { r = await tryMerge(head); break; }
      catch (err2) { if (i >= (s.mergeRetries ?? 3) || ![405, 409].includes(err2.status)) return { merged: false, why: err2.message }; await new Promise((f) => { setTimeout(f, s.mergeWaitMs ?? 5000); }); }
    }
  }
  if (!r?.merged) return { merged: false, why: r?.message || 'GitHub did not merge it' };
  git(['fetch', '-q', s.remote, s.base]);
  const same = q.sameCodeFiles(lines(git(['diff', '--name-only', e.sha, r.sha]).out));
  try { if (p?.branch) await gh('DELETE', `/repos/${s.slug}/git/refs/heads/${p.branch}`); } catch { /* left for the banner */ }
  log(`queue: merged #${e.pr} at ${String(r.sha).slice(0, 8)} (tested once as ${e.sha.slice(0, 8)}${same ? '' : '; main differs in code, so main CI runs'})`);
  return { merged: true, sha: r.sha, same };
}

// ------------------------------------------------------------------ CLI

const lineOf = (x, i) => `${String(i + 1).padStart(2)}. #${x.pr} ${(q.STATES[x.state] || x.state).padEnd(9)} ${x.title}${x.agent ? ` · ${x.agent}` : ''}${x.etaMin ? ` · ~${x.etaMin} min` : ''}${x.why ? ` · ${x.why}` : ''}`;

export async function main(argv) {
  const json = argv.includes('--json'); const dry = argv.includes('--dry-run');
  const args = argv.filter((a) => !['--json', '--dry-run'].includes(a));
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] || '' : ''; };
  const [cmd = 'list', ...rest] = args;
  const s = settings();
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'run') {
    const git = makeGit(s.repo);
    const gh = makeGitHub(s);
    const st = await queueRound({ s, git, gh, api: makeConsole(s), dry, log: (m) => !json && console.error(m) });
    gh.save(); if (!json) console.error(`github: ${gh.calls} billed call(s), ${gh.cached} answered from cache (304)`);
    return print(st, st.on === false ? 'the merge queue is off (Settings → Plugins → Push banner)' : (st.items || []).map(lineOf).join('\n') || 'the merge queue is empty');
  }
  if (cmd === 'list') {
    const st = readQueue(s);
    return print(st, [(st.items || []).map(lineOf).join('\n') || 'the merge queue is empty', ...(st.waiting || []).map((x) => `    #${x.pr} not in the queue: ${x.why}`)].join('\n'));
  }
  if (['add', 'remove', 'move'].includes(cmd)) {
    const pr = rest[0]; if (!pr) throw new Error(`${cmd} <pr>${cmd === 'move' ? ' <index>' : ''}`);
    const d = queueControl(s, cmd, pr, { why: opt('why'), to: cmd === 'move' ? Number(rest[1] ?? 0) : 0 });
    return print({ ok: true, control: d }, `${cmd}: #${String(pr).replace(/^#/, '')}${cmd === 'move' ? ` to ${rest[1] ?? 0}` : ''} (takes effect at the next round, within 3 minutes)`);
  }
  throw new Error('usage: merge-queue.mjs run [--dry-run] | list | add <pr> | remove <pr> [--why …] | move <pr> <index>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
