#!/usr/bin/env node
/**
 * Merge queue runner (build merge-queue, Brett Nov 4 2026). Plain Node: git and the GitHub REST API, no model calls.
 * Runs on the VPS host as part of every auto-land round (`land.mjs run`, cron every 3 minutes); the console reads
 * what it writes (merge-queue.json in the push banner's data folder) and writes Brett's commands to
 * merge-queue-control.json. The rules are merge-queue-core.mjs.
 *
 *   node apps/console-web/plugins/push-banner/land/merge-queue.mjs run [--dry-run] [--json]   one round
 *   … list [--json] | add <pr> | remove <pr> [--why "…"] | move <pr> <index>                 (0 = front)
 *   … settings [--mode batch|stack] [--size 1-10] [--ai on|off] [--fix on|off] [--tries 0-5] [--queue on|off]         read / change the settings
 *
 * Batch mode (the default since Nov 10 2026, Brett: "Take all the pull requests as soon as they're ready, have the
 * orchestrator combine them, like five at a time, into one big build. Then pull main and merge it as one."): see
 * batchRound below. Stack mode (queueMode "stack", the Nov 4 queue):
 *
 * One round (batch mode, the default since Nov 10 2026: batchRound below): finished builds without a PR get one; the
 * open PRs line up; the batch on queue/batch-<n> is checked (green: it merges as one; red: split in half, or the
 * one PR to blame kicked out); a new batch is combined and pushed. The stack round (queueMode 'stack'):
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

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }
const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

export const queueFile = (s) => join(s.dataDir, 'merge-queue.json');
export const queueControlFile = (s) => join(s.dataDir, 'merge-queue-control.json');
export const readQueue = (s) => readJson(queueFile(s), { $axf: q.QUEUE_FRAME, items: [], stack: [], waiting: [], kicked: [], merged: [] });
export const readQueueControl = (s) => readJson(queueControlFile(s), { $axf: q.QUEUE_CONTROL_FRAME, order: [], removed: {}, kicked: {}, added: [] });
export function readQueueConfig(s) {
  return q.queueSettings(readJson(join(s.dataDir, 'config.json'), {}) || {});
}
/** Change the queue settings from the host (CLI): the same keys and bounds as the push banner's PUT /config. */
export function writeQueueConfig(s, patch = {}) {
  const f = join(s.dataDir, 'config.json'); const cur = readJson(f, {}) || {};
  const next = { ...cur };
  if ('mergeQueue' in patch) next.mergeQueue = patch.mergeQueue === true;
  if ('queueMode' in patch) { if (!q.QUEUE_MODES.includes(patch.queueMode)) throw new Error(`queueMode is ${q.QUEUE_MODES.join(' or ')}`); next.queueMode = patch.queueMode; }
  if ('batchSize' in patch) { const n = Number(patch.batchSize); if (!Number.isInteger(n) || n < 1 || n > q.BATCH_SIZE_MAX) throw new Error(`batchSize is 1 to ${q.BATCH_SIZE_MAX}`); next.batchSize = n; }
  if ('batchAiResolve' in patch) next.batchAiResolve = patch.batchAiResolve === true;
  if ('batchAutoFix' in patch) next.batchAutoFix = patch.batchAutoFix === true;
  if ('batchFixTries' in patch) { const n = Number(patch.batchFixTries); if (!Number.isInteger(n) || n < 0 || n > q.FIX_TRIES_MAX) throw new Error(`batchFixTries is 0 to ${q.FIX_TRIES_MAX}`); next.batchFixTries = n; }
  if ('queueDepth' in patch) { const n = Number(patch.queueDepth); if (!Number.isInteger(n) || n < 1 || n > q.QUEUE_DEPTH_MAX) throw new Error(`queueDepth is 1 to ${q.QUEUE_DEPTH_MAX}`); next.queueDepth = n; }
  writeJson(f, { $axf: 'push-banner-config@1', ...next });
  return q.queueSettings(next);
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
async function syncVariable(s, gh, want, prev, now = Date.now()) {
  const value = want ? 'on' : 'off';
  if (prev?.variable === value) return { variable: value };
  // a token that may not write Actions variables (403) is asked again once an hour, not every round; CI reads the
  // committed .github/merge-queue.json meanwhile, so PRs still run the light checks
  if (prev?.variableError && prev?.variableTried && now - Date.parse(prev.variableTried) < 60 * 60000) return { variable: prev.variable || '', variableError: prev.variableError, variableTried: prev.variableTried };
  try {
    try { await gh('PATCH', `/repos/${s.slug}/actions/variables/AXF_MERGE_QUEUE`, { name: 'AXF_MERGE_QUEUE', value }); }
    catch (e) { if (e.status !== 404) throw e; await gh('POST', `/repos/${s.slug}/actions/variables`, { name: 'AXF_MERGE_QUEUE', value }); }
    return { variable: value };
  } catch (e) { return { variable: prev?.variable || '', variableTried: new Date(now).toISOString(), variableError: `couldn't set the repo variable AXF_MERGE_QUEUE (${String(e.message).slice(0, 160)}); CI follows .github/merge-queue.json instead` }; }
}

const agentOf = (b, pr) => {
  const by = String(b?.agent || b?.origin?.by || '').replace(/\s*\(.*$/, '');
  return by && !/^(backfill|brett|console|orchestrator)$/i.test(by) ? by : (pr?.user?.login || '');
};

export async function queueRound({ s, git, gh, api, dry = false, now = () => new Date(), log = () => {}, fetched = false, conflictJob = null, fixJob = null } = {}) {
  const cfg = readQueueConfig(s); const prev = readQueue(s); let ctl = readQueueControl(s);
  const at = now().toISOString();
  const base = { $axf: q.QUEUE_FRAME, at, on: cfg.mergeQueue, depth: cfg.depth, mode: cfg.mode, batchSize: cfg.batchSize, aiResolve: cfg.aiResolve, autoFix: cfg.autoFix, fixTries: cfg.fixTries };
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

  // 0. every finished build goes into the queue (Nov 10 2026, no exceptions): a finished build whose branch is on GitHub
  // but has no PR gets one here, whether auto-land is on or not; the PR's light checks run and it joins the next batch
  const enlisted = dry ? [] : await enlist({ s, git, gh, builds, pulls, log });

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
    fact.why = q.notReady(fact, ctl, { waitUi: cfg.waitUi, redJoins: cfg.mode === 'batch' });
    prs.push(fact);
  }
  ctl = q.pruneControl(ctl, prs.map((p) => p.number));
  const ready = q.queueOrder(prs.filter((p) => !p.why), ctl, rank, prev.stack || []);
  if (cfg.mode === 'batch') return batchRound({ s, git, gh, api, dry, at, log, cfg, prev, ctl, prs, ready: q.greenFirst(ready, ctl), rank, mainSha, base, enlisted, ...(conflictJob ? { conflictJob } : {}), ...(fixJob ? { fixJob } : {}) });

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
  for (const n of d.merge) {
    const e = stack.find((x) => x.pr === n);
    const p = prs.find((x) => x.number === n);
    if (dry) { e.state = 'merging'; continue; }
    const r = await mergeTested({ s, git, gh, e, p, log });
    if (!r.merged) { e.state = 'passed'; e.why = r.why; log(`queue: #${n} passed but didn't merge: ${r.why}`); break; }
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
  return st;
}

/** At most this many PRs are opened for finished builds in one round (the GitHub token is shared). */
const ENLIST_MAX = 5;

/** Open a PR for every finished build (land-core isCandidate) whose branch is on GitHub and has none. Returns [{ build, pr }]. */
export async function enlist({ s, git, gh, builds, pulls, log = () => {} }) {
  const open = new Set((pulls || []).map((p) => p?.head?.ref));
  const out = [];
  for (const b of core.uniqueByBranch(builds.filter(core.isCandidate))) {
    if (out.length >= ENLIST_MAX) break;
    if (open.has(b.branch) || q.isQueueBranch(b.branch)) continue;
    if (git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${b.branch}`]).code) continue; // not pushed yet
    if (git(['rev-list', '--count', `${s.remote}/${s.base}..${s.remote}/${b.branch}`]).out === '0') continue; // nothing to land
    try {
      const pr = await gh('POST', `/repos/${s.slug}/pulls`, { title: String(b.title || b.id).slice(0, 120), head: b.branch, base: s.base, body: `Build \`${b.id}\` is finished. Opened by the merge queue: every finished build goes into the queue, is combined with the other ready ones into one batch build, and lands when that batch's one CI run is green.\n\n${String(b.detail || '').slice(0, 1500)}` });
      out.push({ build: b.id, pr: pr?.number || 0 });
      log(`queue: opened #${pr?.number} for finished build ${b.id}`);
    } catch (e) { if (e.status !== 422) log(`queue: couldn't open a PR for ${b.id}: ${e.message}`); }
  }
  return out;
}

/** CI on one queue commit: { ci, failing, runUrl, startedAt, span } (span = minutes of a finished run, else null). */
async function commitCi({ s, gh, sha }) {
  const runs = (await gh('GET', `/repos/${s.slug}/commits/${sha}/check-runs?per_page=100`))?.check_runs || [];
  const c = ciOf(runs);
  const started = runs.map((r) => Date.parse(r.started_at || '')).filter((x) => x > 0);
  return { ci: c.ci, failing: c.failing, span: c.ci !== 'running' ? runSpan(runs) : null, runUrl: runs.find((r) => r.html_url)?.html_url?.replace(/\/job\/\d+$/, '') || '', startedAt: started.length ? new Date(Math.min(...started)).toISOString() : '' };
}

/**
 * The AI fallback for a code conflict inside a batch (setting batchAiResolve, off by default). The queue itself never
 * calls a model: the later PR is left for the next batch as in plain mode, and one agent job (job type queue-conflict,
 * through framework/cli/agent-job.mjs, once per PR head) makes its branch work with the PRs it clashed with and pushes
 * it. The new head rejoins the queue by itself and still has to pass the batch's CI run.
 */
export function defaultConflictJob(s, type = 'queue-conflict') {
  return (input) => {
    const args = [join(s.repo, 'framework/cli/agent-job.mjs'), type, ...Object.entries(input).flatMap(([k, v]) => ['--input', `${k}=${v}`]), '--json'];
    const r = spawnSync('node', args, { cwd: s.repo, encoding: 'utf8', timeout: 120000 });
    let out = {}; try { out = JSON.parse(r.stdout || '{}'); } catch { /* plain text */ }
    return { exit: r.status ?? 1, session: out.session || '', why: r.status === 0 ? '' : String(out.error || r.stdout || r.stderr || '').slice(-200) };
  };
}

/**
 * Send the PR the bisect found back to its build (setting batchAutoFix, on by default): one agent job (job type
 * queue-fix, through framework/cli/agent-job.mjs, once per PR head) continues the build on its branch, fixes what broke
 * CI, notes it on the build and pushes. The queue never calls a model; the new head rejoins and is retested.
 */
export function defaultFixJob(s) { return defaultConflictJob(s, 'queue-fix'); }

/**
 * One round in batch mode (Brett, Nov 10 2026: "Take all the pull requests as soon as they're ready, have the
 * orchestrator combine them, like five at a time, into one big build. Then pull main and merge it as one."):
 *   1. last round's batch holds while every PR in it is unchanged and main didn't move in code;
 *   2. its one CI run: green → main is pulled in (when GitHub can't merge it as is) and the batch merges as one PR;
 *      red with one PR → that PR is kicked out; red with more → its PRs become suspects and are halved until the one
 *      that broke it is found (the green halves merge on the way);
 *   3. no batch: the next `batchSize` ready PRs (or the first half of the suspects) are combined on the latest main in
 *      queue order (builds files newer-wins, logs unioned, generated files regenerated; a code conflict with main kicks
 *      the PR, one with a PR earlier in the batch leaves it for the next batch, or goes to the AI fallback when on),
 *      pushed as queue/batch-<id>, and CI runs on it once (android.yml runs on queue/**).
 */
async function batchRound({ s, git, gh, api, dry, at, log, cfg, prev, ctl, prs, ready, rank, mainSha, base, enlisted = [], conflictJob = defaultConflictJob(s), fixJob = defaultFixJob(s) }) {
  const history = [...(prev.history || [])];
  const merged = [...(prev.merged || [])].slice(-30);
  const kicked = [...(prev.kicked || [])].slice(-20);
  const batches = [...(prev.batches || [])].slice(-10);
  let suspects = (prev.suspects || []).filter((n) => ready.some((p) => p.number === n));
  let seq = Number.isInteger(prev.batchSeq) ? prev.batchSeq : 0;
  // AI fallback jobs already sent, one per PR head (kept while the PR is open)
  const aiJobs = Object.fromEntries(Object.entries(prev.aiJobs || {}).filter(([n]) => prs.some((p) => p.number === Number(n))));
  // queue-fix jobs sent for the PRs that broke a batch (tries per PR, kept while it is open) and the red batch being split
  const fixJobs = Object.fromEntries(Object.entries(prev.fixJobs || {}).filter(([n]) => prs.some((p) => p.number === Number(n))));
  let bisect = prev.bisect || null;
  const bisects = [...(prev.bisects || [])].slice(-10);
  const tell = async (path, body) => { if (dry) return; try { await api('POST', path, body); } catch (e) { log(`queue: ${path}: ${e.message}`); } };
  const alert = (a) => tell('/api/alerts', a);
  const pb = prev.batch || null;
  const mainMoved = !!pb && (!pb.base || git(['cat-file', '-e', `${pb.base}^{commit}`]).code !== 0 || !q.sameCodeFiles(lines(git(['diff', '--name-only', pb.base, mainSha]).out)));
  let batch = pb && q.keepBatch(pb, ready, { mainMoved }) ? { ...pb } : null;
  if (pb && !batch) log(`queue: batch ${pb.id} is rebuilt (${mainMoved ? 'main moved in code outside the queue' : 'a PR in it changed or left the queue'})`);
  if (batch) { delete batch.state; delete batch.why; }
  let expect = prev.expect || mainSha;
  const prOf = (n) => prs.find((x) => x.number === n) || {};
  const mergedNow = new Set();

  // 2. the batch's one CI run
  if (batch && !['success', 'failure'].includes(batch.ci)) {
    try {
      const c = await commitCi({ s, gh, sha: batch.sha });
      batch.ci = c.ci; batch.failing = c.failing; batch.runUrl = c.runUrl || batch.runUrl || ''; if (c.startedAt) batch.startedAt = c.startedAt;
      if (c.span != null) history.push(c.span);
    } catch { batch.ci = batch.ci || 'running'; }
    if (batch.ci === 'none' && !dry && !batch.dispatched && Date.parse(at) - Date.parse(batch.builtAt || at) > q.NO_RUN_MIN * 60000) {
      try { await gh('POST', `/repos/${s.slug}/actions/workflows/${s.workflow || 'android.yml'}/dispatches`, { ref: batch.branch }); batch.dispatched = at; } catch (err) { log(`queue: dispatch batch ${batch.id}: ${err.message}`); }
    }
  }
  const d = batch ? q.decideBatch(batch, batch.ci) : { action: 'wait' };
  const holdDeploy = join(s.dataDir, 'queue-merging');
  if (d.action === 'merge') {
    if (dry) batch.state = 'merging';
    else {
      writeFileSync(holdDeploy, `${at}\n`);
      const r = await mergeBatch({ s, git, gh, batch, prOf, log });
      if (r.merged) {
        for (const m of batch.members) { merged.push({ pr: m.pr, title: prOf(m.pr).title || m.title || '', sha: r.sha, queueSha: batch.sha, at, retested: false, branch: batch.branch, batch: batch.id, batchPr: r.pr, agent: prOf(m.pr).agent || '' }); mergedNow.add(m.pr); }
        batches.push({ id: batch.id, prs: batch.members.map((m) => m.pr), result: 'merged', sha: r.sha, pr: r.pr, at, runUrl: batch.runUrl || '' });
        bisect = q.trackBisect(bisect, batch, 'merge');
        await tell('/api/alerts/resolve', { keys: batch.members.map((m) => `queue:${m.pr}`) });
        suspects = q.nextSuspects(suspects, batch, 'merge'); expect = r.sha; batch = null;
      } else if (r.rebuild) { log(`queue: batch ${batch.id} rebuilt: ${r.why}`); batch = null; }
      else { batch.state = 'passed'; batch.why = r.why; if (r.sha) Object.assign(batch, { sha: r.sha, ci: 'running', failing: [], builtAt: at, dispatched: '' }); log(`queue: batch ${batch.id} passed but didn't merge: ${r.why}`); }
      rmSync(holdDeploy, { force: true });
    }
  } else if (d.action === 'kick') {
    const m = batch.members[0];
    const p0 = prOf(m.pr);
    const why = q.kickReason(m.pr, { failing: batch.failing, url: batch.runUrl });
    // send it back to its build for an automatic fix (once per head, bounded tries), then tell the PR, the console and AmberX
    const plan = q.planSendBack(m.pr, m.head, { fixJobs, autoFix: cfg.autoFix, fixTries: cfg.fixTries, build: p0.build || '' });
    let sent = { exit: 0, session: '', why: '' };
    if (plan.send && !dry) {
      sent = fixJob({ branch: p0.branch || '', pr: String(m.pr), build: p0.build || '', failing: (batch.failing || []).slice(0, 6).join(', ') || 'see the run', run: batch.runUrl || '', batch: String(batch.id), attempt: `${plan.attempt} of ${plan.max}` });
      fixJobs[m.pr] = { head: m.head, tries: plan.attempt, at, exit: sent.exit, session: sent.session || '', why: sent.why || '', build: p0.build || '' };
      log(`queue: #${m.pr} broke batch ${batch.id}; queue-fix ${sent.exit === 0 ? `sent${sent.session ? ` (${sent.session})` : ''}` : `failed: ${sent.why}`}`);
    }
    const back = q.sendBackLine(m.pr, plan, { build: p0.build || '', session: sent.session, why: plan.send && sent.exit !== 0 ? sent.why || 'agent job failed' : '' });
    if (!dry) {
      ctl = q.applyQueueControl(ctl, 'kick', m.pr, { why, head: m.head, at });
      await gh('POST', `/repos/${s.slug}/issues/${m.pr}/comments`, { body: `**Kicked out of the merge queue.** ${why}\n\n${back}\n\nAny new commit on this branch rejoins the queue by itself; the next batch goes on without it.` }).catch(() => {});
      const stuck = plan.reason === 'limit' || (plan.send && sent.exit !== 0) || plan.reason === 'off';
      await alert({ source: 'push-banner', key: `queue:${m.pr}`, severity: stuck ? 'error' : 'warning', link: '/settings/plugins/push-banner',
        title: `Merge queue: #${m.pr} broke CI, ${stuck ? 'needs a fix' : 'sent back for a fix'}`.slice(0, 200), body: `${why} ${back}`.slice(0, 2000) });
    }
    kicked.push({ pr: m.pr, title: p0.title || '', head: m.head, why, at, runUrl: batch.runUrl || '', sentBack: back, build: p0.build || '', fix: fixJobs[m.pr] || null });
    bisect = q.trackBisect(bisect, batch, 'kick');
    const p = prs.find((x) => x.number === m.pr); if (p) p.why = `kicked out: ${why}`;
    batches.push({ id: batch.id, prs: [m.pr], result: 'kicked', at, runUrl: batch.runUrl || '' });
    suspects = q.nextSuspects(suspects, batch, 'kick'); batch = null;
  } else if (d.action === 'split') {
    log(`queue: batch ${batch.id} is red; ${d.suspects.map((n) => `#${n}`).join(', ')} are halved to find the one that broke it`);
    batches.push({ id: batch.id, prs: d.suspects, result: 'red', at, runUrl: batch.runUrl || '', failing: batch.failing || [] });
    const fresh = !bisect;
    bisect = q.startBisect(bisect, batch, at);
    if (!fresh) bisect = { ...bisect, runs: (bisect.runs || 0) + 1 };
    else await alert(q.bisectStartAlert(bisect));
    suspects = q.nextSuspects(suspects, batch, 'split'); batch = null;
  }

  // 3. a new batch on the latest main
  const left = new Map();
  // green PR checks first, then none, then red: in batch mode the batch's one full run is the real gate (Nov 10 2026)
  const line = q.greenFirst(q.queueOrder(prs.filter((p) => !p.why && !mergedNow.has(p.number)), ctl, rank, []), ctl);
  suspects = suspects.filter((n) => line.some((p) => p.number === n));
  if (bisect && q.bisectDone(bisect, suspects)) {
    const done = { ...bisect, doneAt: at };
    await alert(q.bisectDoneAlert(done));
    await tell('/api/alerts/resolve', { keys: [`queue:bisect-${bisect.of}`] });
    log(`queue: red batch ${bisect.of} split in ${bisect.runs} run(s): merged ${done.merged.map((n) => `#${n}`).join(', ') || 'none'}, sent back ${done.sentBack.map((n) => `#${n}`).join(', ') || 'none'}`);
    bisects.push(done); bisect = null;
  }
  if (!batch && line.length) {
    if (!dry) git(['fetch', '-q', s.remote, s.base]);
    const parent = git(['rev-parse', `${s.remote}/${s.base}`]).out || mainSha;
    const pick = q.pickBatch(line, { size: cfg.batchSize, suspects });
    const bisecting = suspects.length > 0;
    const candidates = bisecting ? pick : line;
    const limit = bisecting ? pick.length : cfg.batchSize;
    const id = seq + 1;
    const members = []; let cur = parent;
    for (const p of candidates) {
      if (members.length >= limit) break;
      git(['fetch', '-q', s.remote, `+refs/heads/${p.branch}:refs/remotes/${s.remote}/${p.branch}`]);
      const withPrs = members.map((m) => `#${m.pr}`);
      const c = combine({ s, git, parent: cur, head: p.head, message: `Merge queue batch ${id}: #${p.number}${withPrs.length ? ` with ${withPrs.join(', ')}` : ''} on main\n\n${p.title}` });
      if (c.conflicts) {
        if (!members.length && git(['merge-tree', '--write-tree', '--quiet', parent, p.head]).code === 1) {
          const why = `#${p.number} conflicts with main in code (${c.conflicts.slice(0, 3).join(', ')}). Merge main in and fix them.`;
          if (!dry) ctl = q.applyQueueControl(ctl, 'kick', p.number, { why, head: p.head, at });
          kicked.push({ pr: p.number, title: p.title, head: p.head, why, at }); p.why = `kicked out: ${why}`;
        } else {
          let why = `conflicts in code with ${withPrs.join(', ')} in batch ${id} (${c.conflicts.slice(0, 3).join(', ')}); goes in the next batch once they merge`;
          const job = aiJobs[p.number];
          if (cfg.aiResolve && job?.head === p.head) why += job.exit === 0 ? '; an agent is resolving it on its branch' : `; the AI fallback couldn't start (${job.why})`;
          else if (cfg.aiResolve && !dry) {
            const withBranches = members.map((m) => prOf(m.pr).branch).filter(Boolean);
            const r = conflictJob({ branch: p.branch, pr: String(p.number), with: withBranches.join(' '), files: c.conflicts.slice(0, 10).join(' ') });
            aiJobs[p.number] = { head: p.head, at, ...r };
            why += r.exit === 0 ? '; the AI fallback sent an agent to resolve it on its branch' : `; the AI fallback couldn't start (${r.why})`;
            log(`queue: #${p.number} conflicts inside batch ${id}; agent job queue-conflict ${r.exit === 0 ? `started${r.session ? ` (${r.session})` : ''}` : `failed: ${r.why}`}`);
          }
          left.set(p.number, why);
        }
        continue;
      }
      if (c.error) { left.set(p.number, `couldn't be combined into batch ${id} (${c.error})`); continue; }
      cur = c.sha; members.push({ pr: p.number, head: p.head, title: p.title });
    }
    if (members.length) {
      let pushed = true;
      if (!dry) {
        const r = git(['push', '-q', '--force', s.remote, `${cur}:refs/heads/${q.batchBranch(id)}`], { timeout: 90000 });
        if (r.code) { pushed = false; log(`queue: couldn't push ${q.batchBranch(id)} (${r.err.slice(-160)})`); for (const m of members) left.set(m.pr, `couldn't push ${q.batchBranch(id)}; tried again next round`); }
      }
      if (pushed) {
        seq = id; expect = parent;
        batch = { id, branch: q.batchBranch(id), sha: cur, base: parent, members, left: [...left].map(([pr, why]) => ({ pr, why })), bisect: bisecting, builtAt: at, ci: 'running', failing: [] };
        log(`queue: batch ${id} = ${members.map((m) => `#${m.pr}`).join(', ')} on main ${parent.slice(0, 8)}${bisecting ? ' (narrowing down a red batch)' : ''}`);
      }
    }
  }

  // 4. tidy queue branches (a merged batch is kept an hour, so main's CI sees it already ran); the state the console shows
  const keepRefs = new Set([...(batch ? [batch.branch] : []), ...batches.filter((b) => b.result === 'merged' && Date.parse(at) - Date.parse(b.at) < 60 * 60000).map((b) => q.batchBranch(b.id))]);
  if (!dry) {
    for (const ref of lines(git(['for-each-ref', '--format=%(refname:strip=3)', `refs/remotes/${s.remote}/queue/`]).out)) {
      if (q.isQueueBranch(ref) && !keepRefs.has(ref)) git(['push', '-q', s.remote, '--delete', ref], { timeout: 60000 });
    }
  }
  const v = dry ? {} : await syncVariable(s, gh, true, prev);
  const avg = q.runMinutes(history);
  const startedMin = batch?.startedAt ? (Date.parse(at) - Date.parse(batch.startedAt)) / 60000 : 0;
  const running = !!batch && batch.ci !== 'success';
  const items = [];
  for (const m of batch?.members || []) {
    const p = prOf(m.pr);
    items.push({ pr: m.pr, title: p.title || m.title || '', url: p.url || '', branch: p.branch || '', head: m.head, build: p.build || '', agent: p.agent || '', priority: p.priority || '', prCi: p.ci,
      state: batch.state || (batch.ci === 'success' ? 'passed' : 'testing'), ci: batch.ci, batch: batch.id, inBatch: true, queueBranch: batch.branch, queueSha: batch.sha, with: batch.members.filter((x) => x.pr !== m.pr).map((x) => x.pr), runUrl: batch.runUrl || '',
      why: batch.why || '', etaMin: q.batchEtaMinutes(0, { inBatch: true, avg, startedMin, running }) });
  }
  const rest = line.filter((p) => !p.why && !(batch?.members || []).some((m) => m.pr === p.number));
  for (const [j, p] of rest.entries()) {
    const why = left.get(p.number) || (batch?.left || []).find((x) => x.pr === p.number)?.why || (suspects.includes(p.number) ? 'in a red batch; tested in a smaller batch while the queue finds which PR broke it' : '');
    items.push({ pr: p.number, title: p.title, url: p.url, branch: p.branch, head: p.head, build: p.build, agent: p.agent, priority: p.priority, prCi: p.ci, state: 'waiting', ci: '', why, etaMin: q.batchEtaMinutes(j, { size: cfg.batchSize, avg, startedMin, running }) });
  }
  const waiting = prs.filter((p) => p.why && !mergedNow.has(p.number)).map((p) => ({ pr: p.number, title: p.title, url: p.url, branch: p.branch, head: p.head, build: p.build, agent: p.agent, state: p.why.startsWith('kicked out') ? 'kicked' : 'held', why: p.why, prCi: p.ci }));
  const st = { ...base, mainSha, expect, avgMin: avg, history: history.slice(-20), batch, batchSeq: seq, suspects, aiJobs, fixJobs, bisect, bisects: bisects.slice(-10), batches: batches.slice(-10), enlisted, stack: [], items, waiting, kicked: kicked.filter((k) => prs.some((p) => p.number === k.pr && !mergedNow.has(p.number))).slice(-20), merged: merged.slice(-30), ...v };
  if (!dry) { writeJson(queueFile(s), st); writeJson(queueControlFile(s), ctl); }
  return st;
}

/**
 * Merge a green batch as one: a PR from queue/batch-<id> into main (opened now, so the batch never paid for PR checks),
 * merged with its tested head pinned. When GitHub can't merge it as is (main moved on by status commits, a builds-file
 * clash), latest main is pulled into the batch (same data rules) and that commit is merged, as long as its code equals
 * what CI tested; if main moved in code the batch is rebuilt. Then every PR in it is closed as landed, its branch
 * deleted. Returns { merged, sha, pr } or { merged: false, why, rebuild?, sha? }.
 */
async function mergeBatch({ s, git, gh, batch, prOf, log }) {
  const title = q.batchTitle(batch.id, batch.members);
  let pr = batch.prNumber || 0;
  if (!pr) {
    try {
      const r = await gh('POST', `/repos/${s.slug}/pulls`, { head: batch.branch, base: s.base, title, body: q.batchBody(batch.id, batch.members.map((m) => ({ ...m, ...prOf(m.pr), number: m.pr })), { base: batch.base, left: batch.left || [] }) });
      pr = r?.number || 0; batch.prNumber = pr; batch.prUrl = r?.html_url || '';
    } catch (e) { return { merged: false, why: `couldn't open the batch PR (${String(e.message).slice(0, 160)})` }; }
    if (!pr) return { merged: false, why: "GitHub didn't open the batch PR" };
  }
  const tryMerge = (sha) => gh('PUT', `/repos/${s.slug}/pulls/${pr}/merge`, { merge_method: 'merge', sha, commit_title: `${title} (merge queue: tested once as ${batch.branch} ${batch.sha.slice(0, 8)})`.slice(0, 250) });
  let r;
  try { r = await tryMerge(batch.sha); }
  catch (err) {
    if (![405, 409, 422].includes(err.status)) return { merged: false, why: String(err.message).slice(0, 200) };
    // pull latest main into the batch, then merge that
    git(['fetch', '-q', s.remote, s.base]);
    const c = combine({ s, git, parent: batch.sha, head: `${s.remote}/${s.base}`, message: `Merge main into merge queue batch ${batch.id}` });
    if (!c.sha) return { merged: false, rebuild: true, why: c.conflicts ? `main conflicts with it in ${c.conflicts.slice(0, 3).join(', ')}` : c.error || 'main could not be pulled in' };
    const base = git(['merge-base', batch.sha, `${s.remote}/${s.base}`]).out;
    if (!q.sameCodeFiles(lines(git(['diff', '--name-only', base || batch.base, `${s.remote}/${s.base}`]).out))) return { merged: false, rebuild: true, why: 'main moved in code; the batch is rebuilt on it and tested again' };
    const p = git(['push', '-q', s.remote, `${c.sha}:refs/heads/${batch.branch}`], { timeout: 90000 });
    if (p.code) return { merged: false, why: `couldn't push main into ${batch.branch} (${p.err.slice(-160)})` };
    try { r = await tryMerge(c.sha); }
    catch (err2) { return { merged: false, sha: c.sha, why: `main pulled in; GitHub wants checks on the new head first (${String(err2.message).slice(0, 120)})` }; }
  }
  if (!r?.merged) return { merged: false, why: r?.message || 'GitHub did not merge it' };
  git(['fetch', '-q', s.remote, s.base]);
  const all = batch.members.map((m) => `#${m.pr}`);
  for (const m of batch.members) {
    try {
      const p = await gh('GET', `/repos/${s.slug}/pulls/${m.pr}`);
      if (p?.state === 'open') {
        await gh('POST', `/repos/${s.slug}/issues/${m.pr}/comments`, { body: `**Landed in main** in merge queue batch ${batch.id} (#${pr}), tested once together with ${all.filter((x) => x !== `#${m.pr}`).join(', ') || 'nothing else'} on the latest main.` }).catch(() => {});
        await gh('PATCH', `/repos/${s.slug}/pulls/${m.pr}`, { state: 'closed' });
      }
    } catch { /* GitHub already marked it merged */ }
    const br = prOf(m.pr).branch;
    try { if (br) await gh('DELETE', `/repos/${s.slug}/git/refs/heads/${br}`); } catch { /* left for the banner */ }
  }
  log(`queue: merged batch ${batch.id} (${all.join(', ')}) as #${pr} at ${String(r.sha).slice(0, 8)}, tested once`);
  return { merged: true, sha: r.sha, pr };
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
    try { r = await tryMerge(head); } catch (err2) { return { merged: false, why: err2.message }; }
  }
  if (!r?.merged) return { merged: false, why: r?.message || 'GitHub did not merge it' };
  git(['fetch', '-q', s.remote, s.base]);
  const same = q.sameCodeFiles(lines(git(['diff', '--name-only', e.sha, r.sha]).out));
  try { if (p?.branch) await gh('DELETE', `/repos/${s.slug}/git/refs/heads/${p.branch}`); } catch { /* left for the banner */ }
  log(`queue: merged #${e.pr} at ${String(r.sha).slice(0, 8)} (tested once as ${e.sha.slice(0, 8)}${same ? '' : '; main differs in code, so main CI runs'})`);
  return { merged: true, sha: r.sha, same };
}

// ------------------------------------------------------------------ CLI

const lineOf = (x, i) => `${String(i + 1).padStart(2)}. #${x.pr} ${(q.STATES[x.state] || x.state).padEnd(9)} ${x.title}${x.batch ? ` · batch ${x.batch}` : ''}${x.agent ? ` · ${x.agent}` : ''}${x.etaMin ? ` · ~${x.etaMin} min` : ''}${x.why ? ` · ${x.why}` : ''}`;
const modeLine = (c) => (c.mergeQueue ? (c.mode === 'batch' ? `merge queue on: batches of ${c.batchSize}, one CI run each, merged as one; a red batch is split in halves, ${c.autoFix ? `the PR that broke it goes back to its build for a fix (up to ${c.fixTries} tries)` : 'the PR that broke it waits for a fix by hand'}${c.aiResolve ? ' (AI conflict fallback on)' : ''}` : `merge queue on: stacked, ${c.depth} PRs tested at once`) : 'merge queue off');

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
    return print(st, [modeLine(readQueueConfig(s)), ...(st.bisect ? [q.bisectLine(st.bisect, st.suspects || [])] : []), (st.items || []).map(lineOf).join('\n') || 'the merge queue is empty', ...(st.waiting || []).map((x) => `    #${x.pr} not in the queue: ${x.why}`)].join('\n'));
  }
  if (cmd === 'settings') {
    const patch = {};
    const onOff = (v, k) => { if (!['on', 'off'].includes(v)) throw new Error(`--${k} on|off`); return v === 'on'; };
    if (opt('mode')) patch.queueMode = opt('mode');
    if (opt('size')) patch.batchSize = Number(opt('size'));
    if (opt('depth')) patch.queueDepth = Number(opt('depth'));
    if (opt('ai')) patch.batchAiResolve = onOff(opt('ai'), 'ai');
    if (opt('fix')) patch.batchAutoFix = onOff(opt('fix'), 'fix');
    if (opt('tries')) patch.batchFixTries = Number(opt('tries'));
    if (opt('queue')) patch.mergeQueue = onOff(opt('queue'), 'queue');
    if (args.includes('--on')) patch.mergeQueue = true;
    const c = Object.keys(patch).length ? writeQueueConfig(s, patch) : readQueueConfig(s);
    return print({ ok: true, settings: c }, modeLine(c));
  }
  if (['add', 'remove', 'move'].includes(cmd)) {
    const pr = rest[0]; if (!pr) throw new Error(`${cmd} <pr>${cmd === 'move' ? ' <index>' : ''}`);
    const d = queueControl(s, cmd, pr, { why: opt('why'), to: cmd === 'move' ? Number(rest[1] ?? 0) : 0 });
    return print({ ok: true, control: d }, `${cmd}: #${String(pr).replace(/^#/, '')}${cmd === 'move' ? ` to ${rest[1] ?? 0}` : ''} (takes effect at the next round, within 3 minutes)`);
  }
  throw new Error('usage: merge-queue.mjs run [--dry-run] | list | add <pr> | remove <pr> [--why …] | move <pr> <index> | settings [--mode batch|stack] [--size 1-10] [--ai on|off] [--fix on|off] [--tries 0-5] [--queue on|off | --on] [--depth 1-6]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
