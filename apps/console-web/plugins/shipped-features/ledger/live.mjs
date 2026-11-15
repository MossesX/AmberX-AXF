/**
 * Shipped features: when things went live. Reads the deploy log (deploy-log@1, one JSON line per deploy, written by
 * every deploy script through axf_deploy_log) and gives each merged feature and edit its live date per target: the
 * first successful deploy whose commit contains the merge commit (git decides "contains"). Merged → Live.
 *
 * Backfill (no deploy log back then): when the commit a target runs now contains the merge commit, the feature was
 * live by then; its date is the merge time, marked guessed (shown with ~ everywhere). Never invents a date for a
 * target it can't check.
 *
 * Log: AXF_DEPLOY_LOG, else <repo>/.axf-console/deploys/log.jsonl (the console sees the same file at /axf/…).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Dl from '../../../../../framework/core/deploy-log.mjs';
import * as L from '../../../../../framework/core/feature-ledger.mjs';
import * as D from './db.mjs';
import { repoPath } from './importers.mjs';

export const deployLogFile = () => process.env.AXF_DEPLOY_LOG || join(D.REPO_ROOT, '.axf-console', 'deploys', 'log.jsonl');
export function readDeployLog(file = deployLogFile()) { try { return Dl.parseLog(readFileSync(file, 'utf8')); } catch { return { records: [], skipped: 0 }; } }

/** git's answer to "does deploy commit X contain merge commit Y", cached; unknown (no checkout / commit) = false. */
export function gitContains(repoOf = (t) => Dl.TARGETS[t]?.repo || 'amberx-axf') {
  const cache = new Map();
  const fn = (deploySha, mergeSha, target = 'console') => {
    const k = `${target}|${deploySha}|${mergeSha}`; if (cache.has(k)) return cache.get(k);
    const cwd = repoPath(repoOf(target)); let ok = false;
    if (cwd && existsSync(cwd)) { try { execFileSync('git', ['merge-base', '--is-ancestor', mergeSha, deploySha], { cwd, stdio: 'ignore' }); ok = true; } catch { ok = false; } }
    cache.set(k, ok); return ok;
  };
  return fn;
}

/** Live dates for one merge commit from the deploy records, per target (each target checked in its own repo). */
export function liveFor(records, mergeSha, repo, contains) {
  const out = {};
  for (const t of Dl.targetsIn(records)) {
    if ((Dl.TARGETS[t]?.repo || 'amberx-axf') !== L.normRepo(repo)) continue;
    const d = Dl.firstContaining(records, t, mergeSha, (dep, m) => contains(dep, m, t));
    if (d) out[t] = { at: d.at, guessed: d.guessed, deploy: d.id };
  }
  return out;
}

/** What each repo's main target runs now, for the backfill: the newest deploy record, else the checkout's HEAD. */
export function runningNow(records) {
  const latest = Dl.latestPerTarget(records); const out = {};
  for (const [t, d] of Object.entries(latest)) out[t] = d.sha;
  if (!out.console) { try { out.console = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: D.REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* no checkout */ } }
  const ax = repoPath('axhub'); if (!out.axhub && ax && existsSync(ax)) { try { out.axhub = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ax, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* none */ } }
  return out;
}

export async function syncDeploys(db, { contains = gitContains(), backfill = true } = {}) {
  const { records, skipped } = readDeployLog();
  D.tx(db, () => { for (const r of records) D.putDeploy(db, r); });
  const all = D.listDeploys(db); const now = backfill ? runningNow(all) : {};
  let live = 0; let guessed = 0;
  D.tx(db, () => {
    for (const f of D.listFeatures(db)) {
      if (!f.mergeCommit || !['merged', 'live'].includes(f.status)) continue;
      let liveAt = liveFor(all, f.mergeCommit, f.repo, contains);
      if (!Object.keys(liveAt).length && !Object.keys(f.liveAt).length && backfill) {
        const t = L.normRepo(f.repo) === 'axhub' ? 'axhub' : 'console';
        if (now[t] && contains(now[t], f.mergeCommit, t)) { liveAt = { [t]: { at: f.mergedAt, guessed: true, deploy: '' } }; guessed += 1; }
      }
      if (!Object.keys(liveAt).length) continue;
      const next = L.normFeature({ ...f, liveAt: { ...liveAt, ...f.liveAt } });
      if (JSON.stringify(next.liveAt) !== JSON.stringify(f.liveAt) || next.status !== f.status) { D.putFeature(db, next, { replace: true, why: 'went live' }); live += 1; }
    }
    for (const e of D.listEdits(db)) {
      if (!e.commit || !['merged', 'live'].includes(e.status)) continue;
      const liveAt = liveFor(all, e.commit, e.repo, contains);
      if (Object.keys(liveAt).length && JSON.stringify({ ...liveAt, ...e.liveAt }) !== JSON.stringify(e.liveAt)) D.putEdit(db, { ...e, liveAt: { ...liveAt, ...e.liveAt }, status: 'live' });
    }
  });
  return { deploys: records.length, skipped, featuresUpdated: live, guessed };
}
