#!/usr/bin/env node
/**
 * The build watchdog's `stale` watch (run by ../watchdog.mjs; this file is also its own CLI): the IO side of
 * stale-status@1 (./stale-core.mjs). Builds standing in one status (landing, fixing, merging) too long are pushed to
 * the next action on their ladder.
 *
 * One pass:
 *   1 read the builds store; take every builds@1 build in a watched status that has not moved for its limit
 *   2 gather the facts for those only: the PR on GitHub (framework/cli/stale-facts.mjs, ETag-cached), CI on the merge
 *     commit (and on main's newest commit when that does not prove it), live sessions, a lander fix agent in flight, and
 *     the retry ladder's answer for a fixing build (framework/core/retry-ladder.mjs)
 *   3 decide (stale-core decide), pick (the longest-standing first; maxPerPass, one launch at a time)
 *   4 apply: record the merge, set landed, record a failure, relaunch on the ladder's next rung (pipeline.mjs
 *     retryFixing), requeue, or escalate (pipeline.mjs escalateBuild: banner item + one push). Each write is one
 *     journalled store write (action watchdog-stale) with a note on the build.
 *
 *   node apps/console-web/plugins/build-orchestrator/watchdog/stale.mjs scan [--json]       what it would do; nothing changes
 *   … run [--build id] [--json]      one pass now
 *   … settings [--json] · set key=value…   enabled, intervalMin, cooldownMin, ciWaitMin, maxPerPass, maxLaunchPerPass,
 *                                          limit.landing, limit.fixing, limit.merging (minutes)
 *
 * Files (the watchdog's folder): watchdogs-stale-settings.json, watchdogs-stale.json (the last push per build: the
 * cooldown's memory, and the last scan). A launch only works on the VPS host (the Claude logins are there).
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as DF from '../../../../../framework/core/data-files.mjs';
import * as C from './stale-core.mjs';

const SELF = fileURLToPath(import.meta.url);
const str = (v, n = 400) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
// through the console's data layer (data-store@1), like every file of the watchdog
const readJson = (f, d = null) => DF.readJson(f, d);
const writeJson = (f, v) => DF.writeJson(f, v, 1);
const MAX_CI_READS = 20;
const PUSHES_KEPT = 500;

// ------------------------------------------------------------------ files, settings, memory

async function dataDir(env = process.env) { return env.AXF_WATCHDOGS_DIR || (await import('../pipeline.mjs')).pipeDir(env); }
const fileOf = async (name, env) => join(await dataDir(env), name);

/** What Settings shows for this watch. `limit.<status>` = minutes a build may stand in that status without moving. */
export const SETTINGS_SCHEMA = Object.freeze({
  enabled: { type: 'boolean', default: true, title: 'Watch builds standing in one status' },
  intervalMin: { type: 'integer', min: 1, max: 1440, default: C.DEFAULTS.intervalMin, title: 'Check every (minutes)' },
  'limit.landing': { type: 'integer', min: 5, max: 10080, default: C.DEFAULTS.limits.landing, title: 'Landing with nothing moving: stale after (minutes)' },
  'limit.fixing': { type: 'integer', min: 5, max: 10080, default: C.DEFAULTS.limits.fixing, title: 'Fixing with nothing tried: stale after (minutes)' },
  'limit.merging': { type: 'integer', min: 5, max: 10080, default: C.DEFAULTS.limits.merging, title: 'Merging with nothing moving: stale after (minutes)' },
  ciWaitMin: { type: 'integer', min: 5, max: 10080, default: C.DEFAULTS.ciWaitMin, title: 'Wait for CI on a merge commit for (minutes)' },
  cooldownMin: { type: 'integer', min: 0, max: 1440, default: C.DEFAULTS.cooldownMin, title: 'Leave a build it pushed alone for (minutes)' },
  maxPerPass: { type: 'integer', min: 1, max: 100, default: C.DEFAULTS.maxPerPass, title: 'Builds pushed per pass, at most' },
  maxLaunchPerPass: { type: 'integer', min: 0, max: 20, default: C.DEFAULTS.maxLaunchPerPass, title: 'Sessions started per pass, at most (0: never start one)' },
});
const flat = (s) => ({ enabled: s.enabled, intervalMin: s.intervalMin, ...Object.fromEntries(Object.keys(C.STATUSES).map((k) => [`limit.${k}`, s.limits[k]])), ciWaitMin: s.ciWaitMin, cooldownMin: s.cooldownMin, maxPerPass: s.maxPerPass, maxLaunchPerPass: s.maxLaunchPerPass });
const nested = (f) => { const o = { limits: {} }; for (const [k, v] of Object.entries(f ?? {})) { if (k.startsWith('limit.')) o.limits[k.slice(6)] = v; else if (k === 'limits' && v && typeof v === 'object') Object.assign(o.limits, v); else o[k] = v; } return o; };

/** The settings as stale-core reads them: defaults, the saved file, then AXF_WATCHDOG_STALE_SETTINGS (tests). */
export async function loadSettings(env = process.env) {
  let patch = {};
  try { patch = env.AXF_WATCHDOG_STALE_SETTINGS ? JSON.parse(env.AXF_WATCHDOG_STALE_SETTINGS) : {}; } catch { /* a bad patch is ignored */ }
  const saved = await readJson(await fileOf('watchdogs-stale-settings.json', env), {}) ?? {};
  const a = nested(saved); const b = nested(patch);
  return C.normSettings({ ...a, ...b, limits: { ...a.limits, ...b.limits } });
}
export async function saveSettings(patch = {}, { by = process.env.AXF_ACTOR || 'cli', env = process.env } = {}) {
  const bad = Object.keys(patch).filter((k) => !SETTINGS_SCHEMA[k]);
  if (bad.length) throw Object.assign(new Error(`unknown setting ${bad.join(', ')} (keys: ${Object.keys(SETTINGS_SCHEMA).join(', ')})`), { code: 2 });
  const next = flat(C.normSettings(nested({ ...flat(await loadSettings({ ...env, AXF_WATCHDOG_STALE_SETTINGS: '' })), ...patch })));
  await writeJson(await fileOf('watchdogs-stale-settings.json', env), { $axf: 'stale-status-settings@1', ...next, setBy: str(by, 80), setAt: new Date().toISOString() });
  return next;
}

const loadMemory = async (env) => ({ $axf: 'stale-status-memory@1', pushes: {}, lastScan: null, ...(await readJson(await fileOf('watchdogs-stale.json', env), {}) ?? {}) });
async function saveMemory(m, env) {
  const ids = Object.keys(m.pushes);
  if (ids.length > PUSHES_KEPT) for (const id of ids.sort((a, b) => String(m.pushes[a].at).localeCompare(String(m.pushes[b].at))).slice(0, ids.length - PUSHES_KEPT)) delete m.pushes[id];
  await writeJson(await fileOf('watchdogs-stale.json', env), m);
}

// ------------------------------------------------------------------ facts (every source can be handed in: tests)

/**
 * The real sources. Each one is a function so a test (or another host) hands in its own:
 *   loadStore()                        the builds store
 *   prFacts(builds)                    → { [buildId]: { pr: { state, mergedAt, mergeCommit } | null, live: bool | null }, mainHead, errors }
 *   ciOn(sha)                          → 'success' | 'failure' | 'pending' | 'none' | null
 *   landerLive(build)                  a lander fix agent is on it right now
 *   nextRung(build)                    the retry ladder's decision for a fixing build
 */
export async function realSources(env = process.env) {
  const root = resolve(dirname(SELF), '../../../../..');
  const store = await import('../../../../../framework/cli/builds-store.mjs');
  let ghc = null; let repo = ''; let cache = null; let cacheFile = '';
  const SF = await import('../../../../../framework/cli/stale-facts.mjs');
  const LL = await import('../../../../../framework/core/landing-line.mjs');
  const stats = { requests: 0, notModified: 0, errors: [] };
  const gh = async () => { ghc ??= (await import('../../../../../framework/cli/github.mjs')).createGitHub({ userAgent: 'axf-build-watchdog' }); return ghc; };
  let land = null; let pipe = null;
  const pipeline = async () => (pipe ??= await import('../pipeline.mjs'));
  return {
    loadStore: () => store.loadStore(),
    async prFacts(builds) {
      const prs = builds.map((b) => Number(String(b.pr || '').replace(/\D/g, '')) || 0).filter(Boolean);
      const f = await SF.gatherFacts({ root, wantPrs: prs, builds });
      repo = f.repo;
      const out = { mainHead: f.main?.head ?? '', errors: f.errors ?? [] };
      for (const b of builds) { const r = SF.factsForRow({ kind: 'building', id: b.id, build: b.id, pr: b.pr, branch: b.branch }, f); out[b.id] = { pr: r.pr ? { state: r.pr.state, mergedAt: r.pr.mergedAt, mergeCommit: r.pr.mergeCommit || r.main?.commit || '' } : null, live: r.session ? r.session.alive : null }; }
      return out;
    },
    async ciOn(sha) {
      if (!sha) return null;
      try {
        repo ||= SF.repoName(root);
        cacheFile ||= SF.defaultCacheFile(root); cache ??= SF.readCache(cacheFile);
        const r = await SF.cachedGet(await gh(), cache, `/repos/${repo}/commits/${sha}/check-runs?per_page=100`, stats);
        SF.writeCache(cacheFile, cache);
        return C.ciOf(LL.classifyCheckRuns(r.data?.check_runs ?? [], { head: sha }).verdict);
      } catch { return null; }
    },
    async landerLive(b) {
      try { const p = await pipeline(); land ??= p.landItems(env); const PC = await import('../pipeline-core.mjs'); return PC.landerAgentLive(land.get(b.id) ?? null, { now: Date.now() }); } catch { return false; }
    },
    async nextRung(b) {
      const p = await pipeline(); const RL = await import('../../../../../framework/core/retry-ladder.mjs'); const BP = await import('../../../../../framework/core/build-pipeline.mjs');
      const f = BP.normFailure(b.failure); if (!f) return null;
      const pinned = BP.nextModel(b) || b.pipeline?.model || 'Opus';
      let usable = []; try { usable = p.accountsNow(store.loadStore(), p.loadSettings()).filter((a) => a.usable !== false).map((a) => a.name); } catch { /* no accounts readable here (the console container) */ }
      return RL.nextStrategy(b.attempts, f, p.retryPolicy(), { pinnedModel: pinned, model: b.pipeline?.model || pinned, account: b.pipeline?.account || '', accounts: usable });
    },
  };
}

/**
 * Read and decide. → { at, settings, watching (builds in a watched status), decisions: [{ id, title, …decision }],
 * errors }. Nothing changes.
 */
export async function scan({ env = process.env, now = Date.now(), sources = null, settings = null } = {}) {
  const S = settings ?? await loadSettings(env);
  const src = sources ?? await realSources(env);
  const memory = await loadMemory(env);
  const store = await src.loadStore();
  const all = (store?.builds ?? []).filter((b) => C.watched(b, S));
  const late = all.filter((b) => C.overBy(b, { now, settings: S }) > 0);
  const errors = [];
  let pf = { errors: [] };
  if (late.length) { try { pf = await src.prFacts(late); } catch (e) { errors.push(`facts: ${str(e.message, 200)}`); pf = { errors: [] }; } }
  errors.push(...(pf.errors ?? []));
  const decisions = []; let ciReads = 0; let mainCi;
  for (const b of late) {
    const f = { ...(pf[b.id] ?? { pr: null, live: null }), ci: null };
    const pushedAt = memory.pushes[b.id]?.at ?? '';
    try {
      if (!f.live && src.landerLive && await src.landerLive(b)) f.live = true;
      const merged = f.pr?.state === 'merged' || !!C.mergedAtOf(b);
      const sha = str(b.landed?.sha, 64) || str(f.pr?.mergeCommit, 64);
      // CI is only read once the merge is on the build (the first push records it; the next pass reads CI)
      if (merged && sha && C.mergedAtOf(b) && str(b.landed?.sha, 64) && ciReads < MAX_CI_READS) {
        ciReads += 1; f.ci = await src.ciOn(sha);
        if (f.ci !== 'success' && f.ci != null && pf.mainHead) { mainCi ??= await src.ciOn(pf.mainHead); f.mainCi = mainCi; f.mainHead = pf.mainHead; }
      }
      const next = b.status === 'fixing' && b.failure ? await src.nextRung(b) : null;
      decisions.push({ id: b.id, title: str(b.title, 120), ...C.decide(b, f, { now, settings: S, pushedAt, next }) });
    } catch (e) { errors.push(`${b.id}: ${str(e.message, 200)}`); }
  }
  return { $axf: 'stale-status-scan@1', at: new Date(now).toISOString(), settings: S, watching: all.length, decisions, errors };
}

// ------------------------------------------------------------------ apply

/** The real writes. → each returns { ok, note } (never throws for a refused change: ok false and why). */
export async function realApply(env = process.env) {
  const { withStore, loadStore } = await import('../../../../../framework/cli/builds-store.mjs');
  const core = await import('../../../../../framework/plan/builds-store-core.mjs');
  const BP = await import('../../../../../framework/core/build-pipeline.mjs');
  const PC = await import('../pipeline-core.mjs');
  const p = await import('../pipeline.mjs');
  const write = (d, fn) => {
    let res = { ok: false, note: 'the build is gone' };
    withStore((s) => { const b = core.findBuild(s, d.id); if (b && b.status === d.status) res = fn(b, new Date().toISOString()) ?? res; else if (b) res = { ok: false, note: `moved on since the scan (${b.status})` }; return s; },
      { by: 'watchdog', action: C.JOURNAL_ACTION, note: `${d.id} ${d.action}`.slice(0, 300) });
    return res;
  };
  const note = (b, text, at) => { b.notes = [...(b.notes ?? []), { text: `Watchdog: ${text}`, at }]; b.updatedAt = at; };
  const alert = (kind, data) => { try { p.makeConsole(env)('POST', '/api/alerts', PC.alertFor(kind, data)); } catch { /* the banner item still shows it */ } };
  return {
    'record-merge': (d) => write(d, (b, at) => {
      b.mergedAt = b.mergedAt || d.mergedAt;
      b.landed = BP.normLanded({ ...(BP.normLanded(b.landed) ?? {}), pr: d.pr, sha: d.sha, mergedAt: b.mergedAt });
      // a failure from before the merge (red CI on the PR, a clash, a push that failed) is moot once it is on main
      const moot = b.failure && b.failure.head !== d.sha;
      if (moot) b.failure = null;
      if (b.status !== 'landing' && BP.guardStatus(b, 'landing').ok) b.status = 'landing';
      note(b, `${d.why}.${moot ? ' The failure from before the merge is cleared.' : ''}`, at);
      return { ok: true, note: `merge recorded (${d.sha.slice(0, 10)})` };
    }),
    land: (d) => write(d, (b, at) => {
      const landed = BP.normLanded({ ...(BP.normLanded(b.landed) ?? {}), ci: 'success', ciAt: at, ciRun: d.via === 'main' ? `main@${d.mainHead}` : `commit@${d.sha}` });
      const g = BP.guardStatus({ ...b, landed }, 'landed');
      if (!g.ok) return { ok: false, note: `not landed: ${g.why}` };
      b.landed = landed; b.failure = null; b.status = 'landed';
      note(b, `${d.why}.`, at);
      return { ok: true, note: 'landed' };
    }),
    fail: (d) => write(d, (b, at) => { PC.recordFailure(b, BP.normFailure(C.failureOf(d, at)), { at }); note(b, `${d.why}. The retry ladder answers it.`, at); return { ok: true, note: `${d.kind} failure recorded: fixing` }; }),
    'to-landing': (d) => write(d, (b, at) => { const g = BP.guardStatus(b, 'landing'); if (!g.ok) return { ok: false, note: g.why }; b.status = 'landing'; note(b, `${d.why}.`, at); return { ok: true, note: 'back to landing' }; }),
    requeue: (d) => { const r = p.retryBuild(d.id, { by: 'watchdog', why: d.why, noLaunch: true }); return { ok: true, note: `status ${r.status}` }; },
    ladder: (d) => {
      const settings = p.loadSettings();
      const r = p.retryFixing({ only: d.id, force: d.rung, env, settings, accounts: p.accountsNow(loadStore(), settings), alert })[0] ?? null;
      if (!r) return { ok: false, note: 'the retry runner had no answer (the build moved on)' };
      if (r.action === 'launched') return { ok: true, note: `${r.strategy}${r.fixStrategy ? ` (${r.fixStrategy})` : ''} on ${r.account} (${r.model})${r.session ? `: ${r.session}` : ''}` };
      if (r.action === 'escalated') return { ok: true, gaveUp: true, notified: true, note: `the ladder ran out: escalated (${str(r.why, 200)})` };
      return { ok: false, note: `${r.action}: ${str(r.why, 300)}` };
    },
    escalate: (d, b) => {
      const f = BP.normFailure(b.failure) ?? BP.normFailure(C.failureOf(d, new Date().toISOString()));
      p.escalateBuild(d.id, f, { by: 'watchdog', alert });
      return { ok: true, gaveUp: true, notified: true, note: 'escalated: on the systems check banner with Retry, one push sent' };
    },
  };
}

/**
 * One pass: scan, pick, apply. → { at, watching, catches: [watchdog-catch@1…], skipped: [{ id, why }], errors }.
 * `only` = one build (its cooldown still holds). `sources` / `apply` replace the real ones (tests).
 */
export async function run({ env = process.env, only = '', now = Date.now(), sources = null, apply = null, settings = null } = {}) {
  const sc = await scan({ env, now, sources, settings });
  const S = sc.settings;
  const decisions = sc.decisions.filter((d) => !only || d.id === only);
  const { act, held } = C.pick(decisions, S);
  const skipped = [...decisions.filter((d) => d.stale && d.action === 'wait').map((d) => ({ id: d.id, why: d.why })), ...held];
  const catches = []; const errors = [...sc.errors];
  const memory = await loadMemory(env);
  let ap = apply;
  if (act.length && !ap) ap = await realApply(env);
  const store = act.length ? await (sources ?? await realSources(env)).loadStore() : { builds: [] };
  for (const d of act) {
    const at = new Date().toISOString(); let res;
    try { const fn = ap[d.action]; if (!fn) throw new Error(`no way to apply ${d.action}`); res = await fn(d, (store.builds ?? []).find((b) => b.id === d.id) ?? {}); }
    catch (e) { res = { ok: false, note: str(e?.message ?? e, 300) }; errors.push(`${d.id}: ${res.note}`); }
    // the cooldown starts on every try, worked or not: a build that cannot be pushed is not hammered every pass
    memory.pushes[d.id] = { at, action: d.action, ok: !!res.ok, n: (memory.pushes[d.id]?.n ?? 0) + 1 };
    catches.push({ at, watch: 'stale', build: d.id, title: d.title, status: d.status, cause: d.cause, action: d.action, rung: d.rung ?? '', minutes: d.minutes, attempt: memory.pushes[d.id].n,
      ok: !!res.ok, gaveUp: d.action === 'escalate' || res.gaveUp === true, notified: res.notified ? at : '', note: `${d.why}. ${res.ok ? 'Done' : 'Not done'}: ${res.note}` });
  }
  memory.lastScan = { at: sc.at, watching: sc.watching, stale: sc.decisions.filter((d) => d.stale).map((d) => ({ id: d.id, title: d.title, status: d.status, minutes: d.minutes, action: d.action, rung: d.rung ?? '', why: d.why })) };
  await saveMemory(memory, env);
  return { $axf: 'stale-status-pass@1', at: sc.at, watching: sc.watching, catches, skipped, errors };
}

// ------------------------------------------------------------------ the watch (build-watchdogs@1, ../watchdog.mjs)

export const WATCH = Object.freeze({
  id: 'stale',
  label: 'Stuck statuses',
  what: 'Builds standing in landing, fixing or merging too long: the merge recorded, landed once CI is green, or pushed to the next rung of their retry ladder.',
  schema: SETTINGS_SCHEMA,
  hostOnly: true, // a relaunch needs the Claude logins on the VPS host
  settings: async (env = process.env) => flat(await loadSettings(env)),
  set: (patch, { by, env = process.env } = {}) => saveSettings(patch, { by, env }),
  async scan({ env = process.env, ...opts } = {}) {
    const sc = await scan({ env, ...opts });
    return { at: sc.at, watching: sc.watching, items: sc.decisions.filter((d) => d.stale).map((d) => ({ at: sc.at, watch: 'stale', build: d.id, title: d.title, status: d.status, cause: d.cause, action: d.action, rung: d.rung ?? '', minutes: d.minutes, note: d.why })), errors: sc.errors };
  },
  run: ({ env = process.env, only = '', ...opts } = {}) => run({ env, only, sources: opts.sources ?? null, apply: opts.apply ?? null, settings: opts.settings ?? null, ...(opts.now ? { now: opts.now } : {}) }),
  /** The last scan the host kept (the console container cannot launch, and reads this instead of scanning live). */
  lastScan: async (env = process.env) => (await loadMemory(env)).lastScan,
});

// ------------------------------------------------------------------ CLI

export async function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : ''; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--build' && argv[i - 1] !== '--by');
  const [cmd = 'scan', ...rest] = pos;
  const out = (o, print) => (json ? console.log(JSON.stringify(o, null, 1)) : print(o));
  if (cmd === 'scan') return out(await scan(), (s) => { console.log(`${s.decisions.filter((d) => d.stale).length} stale of ${s.watching} watched`); for (const d of s.decisions.filter((x) => x.stale)) console.log(`  ${d.id}: ${d.cause} → ${d.action}${d.rung ? ` (${d.rung})` : ''} · ${d.why}`); for (const e of s.errors) console.log(`  ! ${e}`); });
  if (cmd === 'run') return out(await run({ only: opt('build') }), (r) => { console.log(`${r.catches.length} pushed of ${r.watching} watched`); for (const c of r.catches) console.log(`  ${c.ok ? '✓' : '✗'} ${c.build}: ${c.cause} → ${c.action}${c.rung ? ` (${c.rung})` : ''} · ${c.note}`); for (const s of r.skipped) console.log(`  – ${s.id}: ${s.why}`); for (const e of r.errors) console.log(`  ! ${e}`); });
  if (cmd === 'settings') return out(flat(await loadSettings()), (s) => { for (const [k, v] of Object.entries(s)) console.log(`${k.padEnd(18)} ${String(v).padEnd(6)} ${SETTINGS_SCHEMA[k].title}`); });
  if (cmd === 'set') {
    const patch = Object.fromEntries(rest.map((p) => { const i = p.indexOf('='); if (i < 1) throw Object.assign(new Error('usage: set key=value…'), { code: 2 }); const v = p.slice(i + 1); return [p.slice(0, i), v === 'on' || v === 'true' ? true : v === 'off' || v === 'false' ? false : Number(v)]; }));
    return out(await saveSettings(patch, { by: opt('by') || undefined }), (s) => { for (const k of Object.keys(patch)) console.log(`${k} = ${s[k]}`); });
  }
  throw Object.assign(new Error(`unknown command ${cmd} (scan, run, settings, set)`), { code: 2 });
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(`stale watch: ${e.message}`); process.exit(e.code === 2 ? 2 : 1); });
}
