#!/usr/bin/env node
/**
 * Lander: the server-side merge runner (build merge-all-ready-buttons-server-side-lander, Brett Nov 12 2026).
 * Plain Node on the VPS host: git and the GitHub REST API, no model calls, no Claude session. It replaces the merge
 * queue: ready PRs merge into main one at a time through the main gate (rules: lander-core.mjs).
 *
 *   node apps/console-web/plugins/push-banner/land/lander.mjs serve            the service (systemd axf-lander.service,
 *                                                                            Restart=always): a step every 30-90 s, forever
 *   … step [--dry-run] [--json]                                              one step by hand
 *   … status [--json]                                                        what is merging, ready, blocked, merged
 *   … merge-all | merge <pr> | unblock <pr> | finish <build> | stop          commands (the banner, REST, MCP, voice)
 *   … gate-log [--limit n] [--json]                                          the main gate's entries
 *   … account [--json]                                                       the Claude account the conflict fixer uses
 *
 * Files (the push banner's data folder): lander.json (state the console reads), lander-control.json (commands),
 * gate-log.jsonl (Server gate log entries: every merge, block, account switch and restart).
 * Every switch and restart is also sent as an AmberX FYI (console alert, severity info).
 */
import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from './lander-core.mjs';
import * as core from './land-core.mjs';
import { ciOf, mergeMain, settings, makeGit, makeGitHub, makeConsole } from './land.mjs';

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }
const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const stateFile = (s) => join(s.dataDir, 'lander.json');
export const controlFile = (s) => join(s.dataDir, 'lander-control.json');
export const gateLogFile = (s) => join(s.dataDir, 'gate-log.jsonl');
export const readState = (s) => readJson(stateFile(s), { $axf: L.LANDER_FRAME, items: [], merged: [], blocked: [] });
export const readControl = (s) => readJson(controlFile(s), { $axf: L.LANDER_CONTROL_FRAME, finished: [], requested: [], blocked: {}, finishedBuilds: [] });
export function readConfig(s) {
  const c = readJson(join(s.dataDir, 'config.json'), {}) || {};
  return { on: c.lander !== false, waitUi: c.landerWaitUi !== false && c.landWaitUi !== false, fixConflicts: c.landerFixConflicts !== false };
}
export function control(s, cmd, arg, at = new Date().toISOString()) {
  const d = L.applyControl(readControl(s), cmd, arg, { at });
  writeJson(controlFile(s), d);
  gateLog(s, L.gateEntry({ at, gate: 'main gate', pr: Number(arg) || 0, build: cmd === 'finish' ? String(arg) : '', by: process.env.AXF_LANDER_BY || 'command', did: cmd }));
  return d;
}

const GATE_LOG_MAX = 5000;
export function gateLog(s, entry) {
  try {
    mkdirSync(s.dataDir, { recursive: true });
    const f = gateLogFile(s);
    appendFileSync(f, `${JSON.stringify(entry)}\n`);
    if (statSync(f).size > 2 << 20) { const keep = readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-GATE_LOG_MAX); writeFileSync(f, `${keep.join('\n')}\n`); }
  } catch { /* the log never stops a merge */ }
}
export function readGateLog(s, limit = 200) {
  try { return readFileSync(gateLogFile(s), 'utf8').split('\n').filter(Boolean).slice(-limit).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean).reverse(); } catch { return []; }
}

/** An AmberX FYI: a console alert (severity info) that reaches Brett's phone through the alert routing. */
async function fyi(api, key, title, body = '') {
  try { await api('POST', '/api/alerts', { source: 'push-banner', severity: 'info', key: `lander:${key}`.slice(0, 120), title: title.slice(0, 200), body: body.slice(0, 600), link: '/?show=push-banner:lander' }); } catch { /* best effort */ }
}

/** claude-workers@1 status rows (the host's saved accounts), [] when the script isn't there. */
function workerAccounts(s) {
  const r = spawnSync('node', [join(s.repo, 'deploy/claude-workers.mjs'), 'status', '--json'], { cwd: s.repo, encoding: 'utf8', timeout: 30000 });
  try { return JSON.parse(r.stdout || '{}').accounts || []; } catch { return []; }
}

/** The code files of main the PR's head lacks: 0 when only status-only commits ([skip ci] under _claude/) are missing. */
function behindInCode({ s, git, head }) {
  const msgs = lines(git(['log', '--format=%s', `${head}..${s.remote}/${s.base}`]).out);
  if (!msgs.length) return 0;
  const files = lines(git(['diff', '--name-only', `${head}...${s.remote}/${s.base}`]).out);
  return core.statusOnly(msgs, files) ? 0 : msgs.length;
}

async function openPulls(s, gh) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh('GET', `/repos/${s.slug}/pulls?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.filter((p) => p?.base?.ref === s.base && (p?.head?.repo?.full_name || '').toLowerCase() === s.slug.toLowerCase() && !/^queue\//.test(p?.head?.ref || ''));
}

/** Finished builds named by `finish <build>`: their PR (opened when missing) goes to the front. Returns the control doc. */
async function resolveFinished({ s, git, gh, ctl, pulls, builds, log }) {
  const left = [];
  for (const id of ctl.finishedBuilds || []) {
    const b = builds.find((x) => x.id === id);
    if (!b?.branch) { left.push(id); continue; }
    let p = pulls.find((x) => x.head.ref === b.branch);
    if (!p) {
      if (git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${b.branch}`]).code) { left.push(id); continue; }
      if (git(['rev-list', '--count', `${s.remote}/${s.base}..${s.remote}/${b.branch}`]).out === '0') continue; // nothing to land
      try {
        p = await gh('POST', `/repos/${s.slug}/pulls`, { title: String(b.title || b.id).slice(0, 120), head: b.branch, base: s.base, body: `Build \`${b.id}\` is finished. Opened by the lander: it merges into main by itself once its tests pass on top of the latest main.\n\n${String(b.detail || '').slice(0, 1500)}` });
        p.head = p.head || { ref: b.branch, sha: '' }; pulls.push(p);
        log(`lander: opened #${p.number} for finished build ${id}`);
      } catch (e) { log(`lander: couldn't open a PR for ${id}: ${e.message}`); left.push(id); continue; }
    }
    if (p?.number && !(ctl.finished || []).includes(p.number)) ctl.finished = [...(ctl.finished || []), p.number];
  }
  ctl.finishedBuilds = left;
  return ctl;
}

/**
 * One step. Takes the PR in flight (or the next eligible one) through the gate: catch up with main, wait for its
 * tests, merge it, or block it with the reason. Several PRs whose gate says block right away are passed in one step.
 */
export async function step({ s = settings(), git = makeGit(s.repo), gh = makeGitHub(s), api = makeConsole(s), dry = false, now = () => new Date(), log = () => {}, agentJob = null } = {}) {
  const cfg = readConfig(s); const prev = readState(s); let ctl = readControl(s);
  const at = now().toISOString();
  git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
  const storeText = git(['show', `${s.remote}/${s.base}:_claude/builds/store.json`]);
  const builds = storeText.code ? [] : (JSON.parse(storeText.out).builds || []).filter((b) => !b.deleted);
  const buildOf = (br) => builds.find((b) => b.branch === br);
  let pulls;
  try { pulls = await openPulls(s, gh); } catch (e) { log(`lander pulls: ${e.message}`); const st = { ...prev, at, error: e.message }; if (!dry) writeJson(stateFile(s), st); return st; }
  ctl = await resolveFinished({ s, git, gh, ctl, pulls, builds, log });
  ctl = L.pruneControl(ctl, pulls.map((p) => p.number));
  const landCtl = readJson(join(s.dataDir, 'land-control.json'), {}) || {};

  const facts = pulls.map((p) => {
    const b = buildOf(p.head.ref);
    return { number: p.number, title: String(p.title || '').slice(0, 200), branch: p.head.ref, head: p.head.sha, draft: !!p.draft, createdAt: p.created_at, url: p.html_url || '', build: b?.id || '', priority: b?.priority || '', held: b && landCtl.holds?.[b.id] ? (landCtl.holds[b.id].why || 'held') : '', blocked: ctl.blocked?.[p.number] || null, ui: prev.ui?.[p.number]?.head === p.head.sha ? prev.ui[p.number].hold : '' };
  });
  const factOf = (n) => facts.find((f) => f.number === n);
  const merged = [...(prev.merged || [])].slice(-50);
  const ui = { ...(prev.ui || {}) };
  let current = prev.current && factOf(prev.current.pr) ? { ...prev.current } : null;
  if (prev.current && !current) log(`lander: #${prev.current.pr} is no longer open`);
  const block = async (f, why) => {
    ctl.blocked = { ...(ctl.blocked || {}), [f.number]: { head: f.head, why, at } };
    f.blocked = ctl.blocked[f.number];
    if (!dry) gateLog(s, L.gateEntry({ at, pr: f.number, build: f.build, did: 'blocked', why }));
    log(`lander: blocked #${f.number}: ${why}`);
    if (!dry && (ctl.finished || []).includes(f.number)) await fyi(api, `blocked:${f.number}`, `Build ${f.build || `#${f.number}`} didn't merge: ${why}`, `PR #${f.number}. It merges by itself once it gets a new commit; Unblock tries again as it is.`);
    ctl.finished = (ctl.finished || []).filter((n) => n !== f.number); ctl.requested = (ctl.requested || []).filter((n) => n !== f.number);
  };

  let passes = 0;
  while (passes++ < 8) {
    if (!current) {
      if (ctl.stop && !(ctl.finished || []).length) break;
      const next = L.eligible(facts, ctl, { on: cfg.on && !ctl.stop, waitUi: cfg.waitUi })[0];
      if (!next) { if (ctl.drain) { ctl.drain = false; if (!dry) await fyi(api, 'drained', 'Merge all ready: done', `${merged.length} merged so far; ${Object.keys(ctl.blocked || {}).length} blocked (each with its reason in the banner).`); } break; }
      if (cfg.waitUi && !dry) {
        const u = await api('GET', `/api/plugins/push-banner/ui-hold?branch=${encodeURIComponent(next.branch)}&pr=${next.number}`);
        const hold = u ? String(u.hold || '') : '';
        if (hold) { ui[next.number] = { head: next.head, hold }; next.ui = hold; continue; }
      }
      current = { pr: next.number, head: next.head, phase: 'testing', since: at, catchUps: 0 };
      if (!dry) gateLog(s, L.gateEntry({ at, pr: next.number, build: next.build, did: 'started' }));
    }
    const f = factOf(current.pr);
    if (f.head !== current.head) { current = { ...current, head: f.head, since: at }; } // a new commit: its tests start over
    const behind = behindInCode({ s, git, head: f.head });
    let ci = { ci: 'none', failing: [] };
    if (!behind) { try { ci = ciOf((await gh('GET', `/repos/${s.slug}/commits/${f.head}/check-runs?per_page=100`))?.check_runs || []); } catch { ci = { ci: 'running', failing: [] }; } }
    const g = L.gate({ ci: ci.ci, failing: ci.failing, behind, catchUps: current.catchUps, testingMin: (Date.parse(at) - Date.parse(current.since)) / 60000 });
    current.why = g.why;
    if (g.act === 'wait') { current.phase = 'testing'; break; }
    if (g.act === 'block') { await block(f, g.why); current = null; continue; }
    if (g.act === 'catch-up') {
      current.phase = 'catching';
      if (dry) break;
      const m = mergeMain({ s, git, b: { id: f.build || `pr-${f.number}`, branch: f.branch }, dry });
      if (m.conflicts?.length) {
        await block(f, L.gate({ conflicts: m.conflicts }).why);
        if (cfg.fixConflicts && agentJob && f.build) { const r = agentJob({ type: 'land-build', input: { build: f.build, branch: f.branch, checks: `resolve the code conflict with main in ${m.conflicts.slice(0, 5).join(', ')}, then the build's own tests` } }); log(`lander: conflict fixer for #${f.number}: ${r.exit ? r.why : 'started'}`); }
        current = null; continue;
      }
      if (!m.merged) { current.why = `main couldn't be merged in yet (${m.pushError || 'push failed'}); tried again next step`; break; }
      git(['fetch', '-q', s.remote, `+refs/heads/${f.branch}:refs/remotes/${s.remote}/${f.branch}`]);
      f.head = m.sha; current = { ...current, head: m.sha, phase: 'testing', since: at, catchUps: current.catchUps + 1, why: 'main merged in; its tests run on the new head' };
      gateLog(s, L.gateEntry({ at, pr: f.number, build: f.build, did: 'caught up with main', why: g.why }));
      break;
    }
    // merge: pinned to the exact head the tests passed on
    current.phase = 'merging';
    if (dry) break;
    try {
      const r = await gh('PUT', `/repos/${s.slug}/pulls/${f.number}/merge`, { merge_method: 'merge', sha: f.head, commit_title: `Merge pull request #${f.number} from ${f.branch} (lander: tests passed on ${f.head.slice(0, 8)})`.slice(0, 250) });
      if (!r?.merged) throw new Error(r?.message || 'GitHub did not merge it');
      gateLog(s, L.gateEntry({ at, pr: f.number, build: f.build, did: 'merged', why: g.why }));
      log(`lander: merged #${f.number} (${f.title})`);
      merged.push({ pr: f.number, title: f.title, build: f.build, sha: r.sha, at });
      if ((ctl.finished || []).includes(f.number)) await fyi(api, `merged:${f.number}`, `Merged: ${f.build || f.title}`, `PR #${f.number} is on main; its tests passed on top of the latest main.`);
      ctl.finished = (ctl.finished || []).filter((n) => n !== f.number); ctl.requested = (ctl.requested || []).filter((n) => n !== f.number);
      try { await gh('DELETE', `/repos/${s.slug}/git/refs/heads/${f.branch}`); } catch { /* left for the banner */ }
      git(['fetch', '-q', s.remote, s.base]);
      facts.splice(facts.indexOf(f), 1);
      current = null;
      break; // one merge per step: main moved, the next PR catches up next step
    } catch (e) {
      // 405/409: GitHub says it isn't mergeable at this head (main moved): catch up next step, never force
      if ([405, 409, 422].includes(e.status)) { current.phase = 'catching'; current.why = `GitHub refused the merge (${String(e.message).slice(0, 120)}); main is merged in next step`; break; }
      await block(f, `the merge failed (${String(e.message).slice(0, 160)})`); current = null;
    }
  }

  const items = L.order(facts, ctl).map((f) => {
    const why = L.notReady(f, { waitUi: cfg.waitUi });
    const state = current?.pr === f.number ? current.phase : f.blocked && f.blocked.head === f.head ? 'blocked' : why ? 'waiting' : 'ready';
    return { pr: f.number, title: f.title, branch: f.branch, build: f.build, url: f.url, head: f.head, createdAt: f.createdAt, state, why: current?.pr === f.number ? current.why : why, finished: (ctl.finished || []).includes(f.number), requested: (ctl.requested || []).includes(f.number) };
  });
  const st = { $axf: L.LANDER_FRAME, at, on: cfg.on, drain: !!ctl.drain, stop: !!ctl.stop, current, items, merged, ui, account: prev.account || null, heartbeat: at, pid: process.pid, startedAt: prev.startedAt || at, restarts: prev.restarts || 0, github: { calls: gh.calls, cached: gh.cached } };
  st.progress = L.progress(st);
  gh.save?.();
  if (!dry) { writeJson(stateFile(s), st); writeJson(controlFile(s), { ...readControl(s), blocked: ctl.blocked, finished: ctl.finished, requested: ctl.requested, finishedBuilds: ctl.finishedBuilds, drain: ctl.drain }); }
  return st;
}

/** Check the Claude account; on a change, log it in the gate log and send an AmberX FYI. Returns the pick. */
export async function checkAccount({ s, api, accounts = workerAccounts(s), at = new Date().toISOString() }) {
  const st = readState(s); const pick = L.pickAccount(accounts);
  const was = st.account?.account ?? null;
  if (was !== pick.account) {
    const did = pick.account ? `switched to ${pick.label}` : 'no Claude account can run';
    gateLog(s, L.gateEntry({ at, gate: 'account switch', by: 'lander', did, why: pick.why || (was ? `${was} can run again` : 'first check') }));
    if (was !== null) await fyi(api, `account:${pick.account || 'none'}`, `Lander: ${did}`, pick.why || 'Moses X is back.');
    writeJson(stateFile(s), { ...readState(s), account: { ...pick, at } });
  }
  return pick;
}

function agentJobOn(s, account) {
  return (job) => {
    const args = [join(s.repo, 'framework/cli/agent-job.mjs'), job.type, ...Object.entries(job.input).flatMap(([k, v]) => ['--input', `${k}=${v}`]), '--json'];
    const r = spawnSync('node', args, { cwd: s.repo, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...(account ? { AXF_CLAUDE_ACCOUNT: account } : {}) } });
    let out = {}; try { out = JSON.parse(r.stdout || '{}'); } catch { /* plain text */ }
    return { exit: r.status ?? 1, session: out.session || '', why: r.status === 0 ? '' : (out.error || r.stdout || r.stderr || '').slice(-200) };
  };
}

/** The service loop: never exits by itself; a crash is restarted by systemd (Restart=always) and logged here. */
export async function serve({ s = settings(), log = (m) => console.error(`${new Date().toISOString()} ${m}`) } = {}) {
  const api = makeConsole(s); const at = new Date().toISOString();
  const prev = readState(s);
  const gap = prev.heartbeat ? Math.round((Date.parse(at) - Date.parse(prev.heartbeat)) / 60000) : null;
  const why = gap == null ? 'first start' : `last heartbeat ${gap} min ago${prev.pid ? ` (pid ${prev.pid})` : ''}`;
  writeJson(stateFile(s), { ...prev, pid: process.pid, startedAt: at, heartbeat: at, restarts: (prev.restarts || 0) + 1 });
  gateLog(s, L.gateEntry({ at, gate: 'lander service', did: 'started', why }));
  await fyi(api, `restart:${at.slice(0, 16)}`, 'Lander started', `The server-side lander (axf-lander.service) started: ${why}.`);
  let stopping = false;
  const bye = (sig) => { stopping = true; gateLog(s, L.gateEntry({ at: new Date().toISOString(), gate: 'lander service', did: 'stopping', why: sig })); };
  process.on('SIGTERM', () => bye('SIGTERM')); process.on('SIGINT', () => bye('SIGINT'));
  let pick = { account: '' }; let lastAccount = 0;
  while (!stopping) {
    let st = null;
    try {
      if (Date.now() - lastAccount > 5 * 60000) { pick = await checkAccount({ s, api }); lastAccount = Date.now(); }
      st = await step({ s, api, log, agentJob: agentJobOn(s, pick.account) });
    } catch (e) { log(`lander step: ${e.stack || e.message}`); }
    const busy = st?.current || (st?.items || []).some((x) => x.state === 'ready');
    for (let i = 0; i < (busy ? L.STEP_SEC : L.IDLE_SEC) && !stopping; i++) await sleep(1000);
  }
  process.exit(0);
}

// ------------------------------------------------------------------ CLI

const lineOf = (x) => `#${String(x.pr).padEnd(5)} ${(L.STATES[x.state] || x.state).padEnd(18)} ${x.title}${x.why ? ` · ${x.why}` : ''}`;

export async function main(argv) {
  const json = argv.includes('--json'); const dry = argv.includes('--dry-run');
  const args = argv.filter((a) => !['--json', '--dry-run'].includes(a));
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] || '' : ''; };
  const [cmd = 'status', arg] = args;
  const s = settings();
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'serve') return serve({ s });
  if (cmd === 'step') { const st = await step({ s, dry, log: (m) => !json && console.error(m) }); return print(st, `${st.progress?.text || ''}\n${(st.items || []).slice(0, 40).map(lineOf).join('\n')}`); }
  if (cmd === 'status') { const st = readState(s); st.progress = L.progress(st); return print(st, `${st.progress.text}${st.account?.label ? ` · fixer account ${st.account.label}` : ''}\n${(st.items || []).map(lineOf).join('\n')}`); }
  if (cmd === 'gate-log') { const e = readGateLog(s, Number(opt('limit')) || 50); return print({ items: e }, e.map((x) => `${x.at} ${x.gate.padEnd(14)} ${x.pr ? `#${x.pr} ` : ''}${x.build ? `${x.build} ` : ''}${x.did}${x.why ? ` · ${x.why}` : ''}`).join('\n') || 'no entries'); }
  if (cmd === 'account') { const p = await checkAccount({ s, api: makeConsole(s) }); return print(p, p.account ? `${p.label} (${p.account})${p.why ? ` · ${p.why}` : ''}` : `none: ${p.why}`); }
  if (L.LANDER_COMMANDS.some((c) => c.cli === cmd)) {
    const d = control(s, cmd, arg);
    return print({ ok: true, control: d }, `${cmd}${arg ? ` ${arg}` : ''}: the lander takes it at its next step (within a minute)`);
  }
  throw new Error('usage: lander.mjs serve | step [--dry-run] | status | merge-all | merge <pr> | unblock <pr> | finish <build> | stop | gate-log [--limit n] | account');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
