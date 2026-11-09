#!/usr/bin/env node
/**
 * queues.mjs — named build queues: the store, the CLI and the dispatcher's interface (IO side of queues-core.mjs).
 *
 * Brett, Nov 9 2026: "I need to be able to make separate queues. I need to be able to make multiple queue lists." Ships
 * with Main (subscription accounts; today's Queue migrated in) and API (hulu-api, mossesx-api, billed per token).
 *
 * The store is queues.json (build-queues@1) in the pipeline folder (pipeline.mjs pipeDir()), written under queues.lock.
 * The dispatcher (pipeline.mjs) calls this module in one place each: hookPlan() for the tick's launches and afterTick()
 * for claims, releases, the API OK asks and spend safety. Builds stay in the one builds store: a build in any queue has
 * status `queued` (or running), Pending builds sit in no queue; which queue holds it is `members` here.
 *
 *   node apps/console-web/plugins/build-orchestrator/queues.mjs status [--json]       every queue, its builds and running jobs, API accounts, rules, next tick
 *   … create <name> [--uses subscription|api|both] [--parallel n] [--priority 1-9] [--model opus|fable] [--cap usd] [--api a,b] [--subs a,b]
 *   … update <queue> [same flags] · rename <queue> <name> · move <queue> up|down|top|bottom|<index>
 *   … pause <queue> · resume <queue> · delete <queue> [--into <queue>]
 *   … assign <build> <queue>      Pending → that queue, or from one queue to another (a running build counts there next)
 *   … pending <build>             a queued build back to Pending
 *   … rules · rule add --rule '{rule}' [--at i] · rule update <id> --rule '{patch}' · rule remove|on|off <id> · rule move <id> <to>
 *   … approve <build> [--max usd]   Brett's OK for a build to run on an API key (only Brett: console click / axHub approval)
 *   … revoke <build>
 *   … spend [--json]              API accounts: key set / missing (never the value), caps, spend today / this week; queue caps
 *   --json on any command prints JSON; --by <who> names the actor.
 *
 * Owner-only (raising a cost cap, switching a max-cost rule off, giving a queue API accounts, approving an API run): only
 * when this process carries Brett's approver (AXF_APPROVER + AXF_APPROVER_VIA from his console click or an axHub-approved
 * tool, framework/core/model-switch.mjs approverFrom). Exit 0 ok, 2 refused / usage.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Q from './queues-core.mjs';
import * as P from './pipeline-core.mjs';
import * as PL from './pipeline.mjs';
import * as BP from '../../../../framework/core/build-pipeline.mjs';
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import { loadStore } from '../../../../framework/cli/builds-store.mjs';
import { approverFrom } from '../../../../framework/core/model-switch.mjs';
import { sessionCosts, status as workersStatus } from '../../../../deploy/claude-workers.mjs';

export const SOURCE = 'queues';
/** The console opens the Queues & API screen for this link (alerts' Open button, banners). */
export const LINK = 'view:build-queues';
const nowIso = () => new Date().toISOString();
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const fail = (msg) => { throw Object.assign(new Error(msg), { code: 2 }); };

export const file = (env = process.env) => env.AXF_QUEUES_FILE || join(PL.pipeDir(env), 'queues.json');

function withLock(fn, env = process.env) {
  const f = file(env); mkdirSync(dirname(f), { recursive: true });
  const lock = `${f}.lock`;
  for (let i = 0; ; i++) {
    try { closeSync(openSync(lock, 'wx')); break; }
    catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 10e3) { rmSync(lock, { force: true }); continue; } } catch { continue; }
      if (i > 200) fail('queues store is locked (another writer for over 10 s)');
      sleep(50);
    }
  }
  try { return fn(); } finally { rmSync(lock, { force: true }); }
}
function write(doc, env = process.env) { const f = file(env); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(doc, null, 1)}\n`); renameSync(tmp, f); return doc; }

/** First run: the default queues, with every build already in the Queue (or building) placed in Main. */
export function migrate(builds) {
  const d = Q.defaultDoc();
  for (const b of builds) if (!b.deleted && ['queued', 'running', 'waiting'].includes(b.status)) d.members[b.id] = 'main';
  return Q.normDoc({ ...d, updatedAt: nowIso() });
}

/** The queues document (made and saved on first use). */
export function load(env = process.env) {
  const raw = readJson(file(env));
  if (raw) return Q.normDoc(raw);
  return withLock(() => { const again = readJson(file(env)); if (again) return Q.normDoc(again); let builds = []; try { builds = loadStore().builds; } catch { builds = []; } return write(migrate(builds), env); }, env);
}
/** Read, change, write under the lock. */
export function edit(fn, env = process.env) { load(env); return withLock(() => { const d = Q.normDoc(readJson(file(env))); const r = fn(d) ?? { doc: d }; write(r.doc, env); return r; }, env); }

/** Is this process Brett (console click or axHub-approved tool)? */
export const owner = (env = process.env) => approverFrom(env).ok;

// ------------------------------------------------------------------ changes

/** One queue change (queues-core apply), plus the pipeline move a queue assignment implies. */
export function act(change, { by = process.env.AXF_ACTOR || 'cli', env = process.env } = {}) {
  const a = approverFrom(env); const isOwner = a.ok;
  const c = { ...change };
  if (c.action === 'approve') Object.assign(c, { by: a.by || by, via: a.via || '' });
  if (c.action === 'assign') {
    const doc = load(env); const qx = Q.findQueue(doc, c.queue); if (!qx) fail(`no queue "${c.queue}"`);
    const b = storeCore.findBuild(loadStore(), c.build); if (!b) fail(`no build "${c.build}"`);
    c.build = b.id; c.queue = qx.id;
    if (BP.canQueue(b)) PL.queue(b.id, { by });
    else if (!['queued', 'running', 'waiting'].includes(b.status)) fail(`${b.id} is ${b.status}${b.hidden ? ' (hidden)' : ''}: only a Pending, queued or building build goes into a queue`);
  }
  if (c.action === 'unassign') {
    const b = storeCore.findBuild(loadStore(), c.build); if (!b) fail(`no build "${c.build}"`);
    c.build = b.id;
    if (b.status === 'running' || b.status === 'waiting') fail(`${b.id} is building: it goes back to Pending when its session ends`);
    if (BP.canUnqueue(b)) PL.unqueue(b.id, { by });
  }
  return edit((d) => Q.apply(d, c, { owner: isOwner }), env);
}

// ------------------------------------------------------------------ reads

const apiRows = (ws) => (ws?.accounts ?? []).filter((r) => r.kind === 'api');
function workers() { try { return workersStatus(); } catch { return { accounts: [], config: { api: {} } }; } }
function costs() { try { return sessionCosts(); } catch { return {}; } }
/** API accounts as the panel shows them: key set / missing (never the value), on/off, caps, spend, what runs on them. */
export function apiAccounts(ws = workers()) {
  return apiRows(ws).map((r) => ({ name: r.name, label: r.label || '', role: r.role, enabled: !!ws.config?.api?.[r.name]?.enabled, setUp: !!ws.config?.api?.[r.name], key: r.hasKey === false ? 'missing' : 'set',
    running: (r.running ?? []).length, building: r.building ?? 0, costToday: r.costToday ?? 0, costWeek: r.costWeek ?? 0, spend: r.spend ?? null, why: r.why || '' }));
}

/** The pipeline-core plan() of this tick with every queue's launches merged in: the dispatcher hook. */
export function hookPlan(args, basePlan = P.plan, opts = {}) {
  const base = basePlan(args);
  try { return queuePlan(args, base, opts); }
  catch (e) { return { ...base, queuesError: e.message }; } // the queues never stop the dispatcher: it falls back to the one Queue
}
function queuePlan(args, base, { doc = load(), ws = workers(), cost = costs() } = {}) {
  const running = {};
  for (const b of args.builds ?? []) if ((b.status === 'running' || b.status === 'waiting') && b.pipeline?.account) running[b.pipeline.account] = (running[b.pipeline.account] || 0) + 1;
  // a build's own run already shows in claude-workers' running list when its session logged in: count the store only for the rest
  const apis = Q.apiViews(apiRows(ws).map((r) => ({ ...r, running: [] })), running);
  const qp = Q.plan({ doc, builds: args.builds, subs: args.accounts, apis, slots: args.slots, rules: args.rules, costs: cost });
  return Q.mergePlan(base, qp);
}

/** Everything the panel, the CLI and the MCP status tool show. */
export function status() {
  const s = PL.status(); const doc = load(); const store = loadStore(); const ws = workers(); const cost = costs();
  const live = store.builds.filter((b) => !b.deleted);
  const rowOf = Object.fromEntries([...s.table.pending, ...s.table.queued, ...s.table.building].map((r) => [r.id, r]));
  const lists = Q.queues(doc).map((q) => ({
    ...q,
    queued: Q.queuedIn(doc, q.id, live).map((b) => ({ ...(rowOf[b.id] ?? { id: b.id, title: b.title }), wait: s.plan.waits.find((w) => w.id === b.id)?.why ?? '', launch: s.plan.launches.find((l) => l.id === b.id) ?? null, apiOk: !!doc.approvals[b.id], asked: doc.asks[b.id] ?? '' })),
    running: Q.runningIn(doc, q.id, live).map((b) => ({ ...(rowOf[b.id] ?? { id: b.id, title: b.title }), claim: doc.claims[b.id] ?? null, costUsd: Number(cost[doc.claims[b.id]?.session || b.pipeline?.session]) || 0 })),
    stats: s.plan.perQueue?.[q.id] ?? { running: 0, queued: 0, launches: 0, spentToday: Q.queueSpend(doc, q.id, cost), paused: q.paused, full: false },
    maxCostUsd: Q.maxCostFor(doc, q.id),
  }));
  return { ok: true, $axf: 'build-queues-status@1', at: nowIso(), owner: owner(), queues: lists, pending: s.table.pending, rules: doc.rules, approvals: doc.approvals, asks: doc.asks,
    api: apiAccounts(ws), subscriptions: s.accounts, slots: s.slots, plan: { launches: s.plan.launches, waits: s.plan.waits, asks: s.plan.asks ?? [], idle: s.plan.idle }, recent: doc.runs.slice(-20).reverse() };
}

// ------------------------------------------------------------------ after a tick (the second dispatcher hook)

function killSession(session) {
  if (!session || process.env.AXF_SLOTS_TMUX === 'off') return false;
  const r = spawnSync('tmux', ['kill-session', '-t', `=${session}`], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

/**
 * After the dispatcher's launches: record a claim per launch, release the builds whose session ended, ask Brett once per
 * build waiting for an API OK, and enforce money: stop API jobs over a cap or their max cost (back to Pending), 80 % and
 * stop notices to AmberX through the console alerts API. `send(alert)` posts one alert, `resolve(keys)` clears them.
 */
export function afterTick({ launched = [], ended = [], plan = {}, store = loadStore(), send = () => null, resolve: clearKeys = () => null, stopSession = killSession, env = process.env } = {}) {
  const ws = workers(); const cost = costs(); const now = nowIso();
  const out = { claimed: [], released: [], asked: [], stopped: [], alerts: [] };
  const sendOnce = (d, a) => { if (d.alerts[a.key]) return; send({ source: SOURCE, link: LINK, meta: { kind: a.key.split(':')[1] }, ...a }); d.alerts[a.key] = now; out.alerts.push(a.key); };
  edit((d) => {
    let doc = d;
    for (const l of launched) { doc = Q.claim(doc, l.id, { queue: l.queue || Q.queueOf(doc, l.id), account: l.account, kind: l.kind || 'subscription', session: l.session || '', maxCostUsd: l.maxCostUsd || 0, overflowFrom: l.overflowFrom || '' }, now); out.claimed.push(l.id); }
    for (const e of ended) {
      doc = Q.release(doc, e.id, { why: e.outcome || '', now }); out.released.push(e.id);
      if (e.status === 'pending' || e.status === 'built' || e.status === 'complete' || e.status === 'failed') delete doc.members[e.id];
    }
    for (const a of plan.asks ?? []) {
      if (doc.asks[a.id]) continue;
      doc.asks[a.id] = now; out.asked.push(a.id);
      const acct = apiAccounts(ws).find((x) => x.name === a.account);
      const b = storeCore.findBuild(store, a.id);
      send({ source: SOURCE, key: `queues:ask:${a.id}`, severity: 'warning', link: `build-queues.open:${a.id}`, meta: { kind: 'ask', build: a.id, account: a.account },
        title: `OK to run ${b?.title || a.id} on ${acct?.label || a.account}?`, body: `It waits in the ${Q.findQueue(doc, a.queue)?.name ?? a.queue} queue for an API key (billed per token, max ${Q.maxCostFor(doc, a.queue, a.id) ? `$${Q.maxCostFor(doc, a.queue, a.id).toFixed(2)}` : 'no limit'} a run). Approve it in Queues & API.` });
    }
    const live = loadStore().builds.filter((b) => !b.deleted);
    const e = Q.enforce({ doc, builds: live, apiRows: apiRows(ws), costs: cost });
    for (const s of e.stop) {
      const killed = stopSession(s.session);
      try { PL.setPipeline(s.id, { session: '', slot: '', note: `stopped: ${s.why}` }, { status: 'pending', note: `Stopped by the queues' spend safety: ${s.why}${killed ? '' : ' (session already gone)'}.`, by: 'queues', action: 'queues:stop' }); } catch { /* the build may be gone */ }
      doc = Q.release(doc, s.id, { why: `stopped: ${s.why}`, now }); delete doc.members[s.id];
      out.stopped.push({ ...s, killed });
    }
    for (const a of e.alerts) sendOnce(doc, a);
    if (e.clear.length) { clearKeys(e.clear); for (const k of e.clear) delete doc.alerts[k]; }
    return { doc: Q.normDoc(doc) };
  }, env);
  return out;
}

// ------------------------------------------------------------------ CLI

const QUEUE_FLAGS = { uses: 'uses', parallel: 'maxParallel', priority: 'priority', model: 'defaultModel', cap: 'costCapUsd', api: 'apiAccounts', subs: 'subAccounts', note: 'note', name: 'name' };

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const flag = (n, d = undefined) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
  const pos = []; for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { i++; continue; } pos.push(args[i]); }
  const by = flag('by', process.env.AXF_ACTOR || 'cli');
  const out = (o, text) => console.log(json ? JSON.stringify({ ok: true, ...o }) : text);
  const fields = () => { const o = {}; for (const [f, k] of Object.entries(QUEUE_FLAGS)) if (flag(f) !== undefined) o[k] = ['apiAccounts', 'subAccounts'].includes(k) ? flag(f).split(',').filter(Boolean) : flag(f); return o; };
  const done = (r) => out({ log: r.log, queue: r.queue, rule: r.rule, doc: r.doc }, r.log.join('\n'));
  const [cmd = 'status', ...rest] = pos;
  if (cmd === 'status' || cmd === 'list') {
    const s = status();
    if (json) return out(s);
    const lines = [`Queues · ${s.at} · slots ${s.slots.used}/${s.slots.cap}`];
    for (const q of s.queues) {
      lines.push(Q.queueLine(q, q.stats));
      for (const r of q.running) lines.push(`    building ${r.id}${r.claim ? ` on ${r.claim.account} (${r.claim.kind})` : ''}${r.costUsd ? ` · $${r.costUsd.toFixed(2)}` : ''}`);
      for (const r of q.queued) lines.push(`    queued   ${r.id}${r.launch ? ` → next tick on ${r.launch.account}` : r.wait ? ` · ${r.wait}` : ''}`);
    }
    lines.push(`Pending (${s.pending.length})`);
    lines.push(...s.api.map((a) => `API ${a.label || a.name} [${a.name}] key ${a.key} · ${a.enabled ? 'on' : 'off'} · $${(a.spend?.day ?? a.costToday).toFixed(2)}/${a.spend?.dayCap ? `$${a.spend.dayCap}` : '—'} today · $${(a.spend?.week ?? a.costWeek).toFixed(2)}/${a.spend?.weekCap ? `$${a.spend.weekCap}` : '—'} week${a.why ? ` · ${a.why}` : ''}`));
    lines.push(`Rules: ${s.rules.map((r) => `${r.name}${r.enabled ? '' : ' (off)'}`).join(' · ') || 'none'}`);
    return out(s, lines.join('\n'));
  }
  if (cmd === 'spend') { const a = apiAccounts(); const doc = load(); const c = costs(); const qs = doc.queues.filter((q) => q.costCapUsd).map((q) => ({ id: q.id, name: q.name, cap: q.costCapUsd, spent: Q.queueSpend(doc, q.id, c) }));
    return out({ api: a, queues: qs }, [...a.map((x) => `${x.label || x.name}: key ${x.key}, ${x.enabled ? 'on' : 'off'}, $${x.costToday.toFixed(2)} today, $${x.costWeek.toFixed(2)} this week${x.spend?.state && x.spend.state !== 'ok' ? ` (${x.spend.why})` : ''}`), ...qs.map((q) => `queue ${q.name}: $${q.spent.toFixed(2)} of $${q.cap} today`)].join('\n') || 'No API accounts.'); }
  if (cmd === 'create') return done(act({ action: 'create', ...fields(), name: rest.join(' ') || flag('name') }, { by }));
  if (cmd === 'update') return done(act({ action: 'update', queue: rest[0], patch: fields() }, { by }));
  if (cmd === 'rename') return done(act({ action: 'rename', queue: rest[0], name: rest.slice(1).join(' ') }, { by }));
  if (cmd === 'move') return done(act({ action: 'move', queue: rest[0], to: rest[1] }, { by }));
  if (cmd === 'pause' || cmd === 'resume') return done(act({ action: cmd, queue: rest[0] }, { by }));
  if (cmd === 'delete') return done(act({ action: 'delete', queue: rest[0], into: flag('into') }, { by }));
  if (cmd === 'assign') return done(act({ action: 'assign', build: rest[0], queue: rest[1] }, { by }));
  if (cmd === 'pending') return done(act({ action: 'unassign', build: rest[0] }, { by }));
  if (cmd === 'approve') return done(act({ action: 'approve', build: rest[0], maxCostUsd: flag('max') }, { by }));
  if (cmd === 'revoke') return done(act({ action: 'revoke', build: rest[0] }, { by }));
  if (cmd === 'rules') { const d = load(); return out({ rules: d.rules }, d.rules.map((r, i) => `${i + 1}. ${r.name} [${r.id}] ${r.kind}${r.enabled ? '' : ' (off)'} ${JSON.stringify(r.kind === 'overflow' ? { from: r.from, to: r.to } : r.kind === 'route' ? { to: r.to, ...r.when } : { queue: r.queue || 'any', maxCostUsd: r.maxCostUsd })}`).join('\n') || 'No rules.'); }
  if (cmd === 'rule') {
    const [sub, id, to] = rest; const j = flag('rule') ? JSON.parse(flag('rule')) : {};
    if (sub === 'add') return done(act({ action: 'rule-add', rule: j, at: flag('at') }, { by }));
    if (sub === 'update') return done(act({ action: 'rule-update', rule: id, patch: j }, { by }));
    if (sub === 'remove') return done(act({ action: 'rule-remove', rule: id }, { by }));
    if (sub === 'on' || sub === 'off') return done(act({ action: `rule-${sub}`, rule: id }, { by }));
    if (sub === 'move') return done(act({ action: 'rule-move', rule: id, to }, { by }));
  }
  if (cmd === 'act') return done(act(JSON.parse(rest[0] || '{}'), { by }));
  fail('usage: queues.mjs status | create <name> [--uses …] | update|rename|move|pause|resume|delete <queue> … | assign <build> <queue> | pending <build> | rules | rule add|update|remove|on|off|move … | approve|revoke <build> | spend | act \'{json}\' [--json]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`queues: ${e.message}`);
    process.exit(e.code === 2 ? 2 : 1);
  });
}
