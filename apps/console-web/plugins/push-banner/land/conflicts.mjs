#!/usr/bin/env node
/**
 * PR conflict watch, the runner (build merge-conflict-alerts). Plain Node and git, no model calls. Called at the end of
 * every merge queue round on the VPS host; the console reads pr-conflicts.json and writes Brett's Fix conflicts now to
 * pr-conflicts-control.json. The rules are conflicts-core.mjs.
 *
 *   node apps/console-web/plugins/push-banner/land/conflicts.mjs list [--json]
 *
 * One round: scan every open PR against main (a head already scanned is not scanned again while main is unchanged in
 * code) → raise what is new, clear what is gone → run the fixes Brett asked for: a build in the orchestrator, then the
 * conflict-fix agent job. A resolved PR is put back in the merge queue and its build is closed.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as c from './conflicts-core.mjs';
import { sameCodeFiles } from './merge-queue-core.mjs';

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }

export const conflictsFile = (s) => join(s.dataDir, 'pr-conflicts.json');
export const conflictsControlFile = (s) => join(s.dataDir, 'pr-conflicts-control.json');
export const readConflicts = (s) => readJson(conflictsFile(s), { $axf: c.CONFLICTS_FRAME, items: [] });
const consoleUrl = () => (process.env.AXF_CONSOLE_PUBLIC_URL || 'https://console.amberxai.com').replace(/\/+$/, '');

/** Scan the open PRs. `clean` remembers heads that merge clean, so a status commit on main costs no rescan. */
export function scanPrs({ git, base, prs, prev, mainSha }) {
  const sameMain = !!prev?.mainSha && (prev.mainSha === mainSha || (git(['cat-file', '-e', `${prev.mainSha}^{commit}`]).code === 0
    && sameCodeFiles(git(['diff', '--name-only', prev.mainSha, mainSha]).out.split('\n'))));
  const known = new Map((prev?.items || []).map((x) => [x.pr, x]));
  const scans = []; const clean = {};
  for (const p of prs) {
    if (p.draft) continue;
    const k = known.get(p.number);
    if (sameMain && prev.clean?.[p.number] === p.head) { clean[p.number] = p.head; continue; }
    const fact = { pr: p.number, title: p.title, branch: p.branch, url: p.url, head: p.head, build: p.build };
    if (sameMain && k?.head === p.head && !k.refused) { scans.push({ ...fact, files: k.files }); continue; }
    const r = git(['merge-tree', '--write-tree', '--name-only', base, p.head]);
    const a = c.parseMergeTree(r.code, r.out);
    if (!a) { if (k && k.head === p.head) scans.push({ ...fact, files: k.files }); continue; } // git failed: keep what we knew
    if (a.clean) clean[p.number] = p.head; else scans.push({ ...fact, files: a.files });
  }
  return { scans, clean };
}

/** Put a build in the orchestrator and start the job; { state, build, session, why }. Runs with the host's checkout. */
export function launchFix(s) {
  const env = { ...process.env, AXF_ACTOR: 'merge-queue' };
  return (it, request) => {
    const orch = join(s.repo, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs');
    const b = c.fixBuild(it, request); const job = c.fixJob(it);
    const add = spawnSync('node', [orch, 'act', '--json', JSON.stringify(b)], { cwd: s.repo, encoding: 'utf8', timeout: 60000, env });
    // a second fix on the same PR keeps its build (id taken): it goes back to running
    const taken = /already/.test(`${add.stderr}${add.stdout}`);
    if (add.status !== 0 && !taken) return { state: 'failed', build: b.id, why: `couldn't add the build: ${`${add.stderr || add.stdout}`.slice(-160)}` };
    spawnSync('node', [orch, 'act', 'status', b.id, 'running'], { cwd: s.repo, encoding: 'utf8', timeout: 60000, env });
    const args = [join(s.repo, 'framework/cli/agent-job.mjs'), job.type, ...Object.entries(job.input).flatMap(([k, v]) => ['--input', `${k}=${v}`]), '--json'];
    const r = spawnSync('node', args, { cwd: s.repo, encoding: 'utf8', timeout: 120000, env });
    let out = {}; try { out = JSON.parse(r.stdout || '{}'); } catch { /* plain text */ }
    if (r.status !== 0) { spawnSync('node', [orch, 'act', 'status', b.id, 'failed'], { cwd: s.repo, timeout: 60000, env }); return { state: 'failed', build: b.id, why: `${out.error || r.stdout || r.stderr || 'the job did not start'}`.slice(-240) }; }
    return { state: 'running', build: b.id, session: String(out.session || '') };
  };
}

/** A resolved fix: back in the queue, build closed. */
function settleFix(s, it, requeue) {
  if (requeue) requeue(it.pr);
  spawnSync('node', [join(s.repo, 'apps/console-web/plugins/build-orchestrator/orchestrator.mjs'), 'act', 'note', it.fix.build, `Conflicts gone on PR #${it.pr}: back in the merge queue.`], { cwd: s.repo, timeout: 60000, env: { ...process.env, AXF_ACTOR: 'merge-queue' } });
}

export async function conflictRound({ s, git, api, prs, mainSha, refused = {}, dry = false, now = () => new Date(), log = () => {}, launch = launchFix(s), requeue = null, settle = settleFix } = {}) {
  const at = now().toISOString(); const prev = readJson(conflictsFile(s), null);
  const { scans, clean } = scanPrs({ git, base: `${s.remote}/${s.base}`, prs, prev, mainSha });
  const r = c.reconcile(prev, scans, { at, refused });
  const opts = { consoleUrl: consoleUrl() };
  if (dry) return { items: r.items, fresh: r.fresh, resolved: r.resolved, digest: r.digest };

  if (r.digest) await api('POST', '/api/alerts', c.digestFor(r.fresh, { ...opts, baseline: r.baseline }));
  else for (const it of r.fresh) await api('POST', '/api/alerts', c.alertFor(it, opts));
  const clear = r.resolved.map((x) => c.alertKey(x.pr));
  if (!r.items.length && prev?.items?.length) clear.push(c.DIGEST_KEY);
  if (clear.length) await api('POST', '/api/alerts/resolve', { keys: clear });
  for (const o of r.resolved) if (o.fix?.state === 'running') { settle(s, o, requeue); log(`conflicts: #${o.pr} resolved by ${o.fix.build}`); }

  // running fixes that went quiet; then what Brett asked for
  for (const it of r.items) if (c.fixStale(it.fix, at)) { it.fix = { ...it.fix, state: 'failed', why: `no result after ${c.FIX_STALE_MIN} minutes` }; await api('POST', '/api/alerts', c.alertFor(it, opts)); }
  let ctl = readJson(conflictsControlFile(s), { $axf: c.CONFLICTS_CONTROL_FRAME, fix: {} });
  const { run, drop } = c.fixesToRun(ctl, r.items);
  for (const { item, request } of run) {
    const res = launch(item, request);
    item.fix = { ...res, head: item.head, at, by: request.by };
    drop.push(item.pr);
    log(`conflicts: #${item.pr} fix ${res.state}${res.why ? `: ${res.why}` : ''}`);
    if (res.state === 'failed') await api('POST', '/api/alerts', { ...c.alertFor(item, opts), title: `PR #${item.pr}: the fix job didn't start`.slice(0, 200), body: res.why || '' });
  }
  for (const n of drop) ctl = c.applyControl(ctl, 'done', n);
  writeJson(conflictsControlFile(s), ctl);
  const st = { $axf: c.CONFLICTS_FRAME, at, mainSha, count: r.items.length, items: r.items, clean };
  writeJson(conflictsFile(s), st);
  return st;
}

export async function main(argv) {
  const { settings } = await import('./land.mjs');
  const s = settings(); const st = readConflicts(s);
  if (argv.includes('--json')) return console.log(JSON.stringify(st));
  console.log((st.items || []).map((x) => `#${x.pr} ${x.title} · ${c.filesText(x.files)}${x.fix ? ` · fix ${x.fix.state}` : ''}`).join('\n') || 'no open PR conflicts with main');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
