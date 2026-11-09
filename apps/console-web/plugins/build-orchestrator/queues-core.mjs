/**
 * build-queues@1: named build queues (pure, IO-free). Shared by the store / CLI (queues.mjs), the dispatcher hook
 * (pipeline.mjs → queues.mjs hookPlan / afterTick), the console screen and the tests.
 *
 * Brett, Nov 9 2026: "we need to make an API job control panel to set rules for it and we're gonna need a separate queue
 * for the API jobs … I need to be able to make separate queues. I need to be able to make multiple queue lists."
 *
 * The document (queues.json next to the pipeline's files):
 *   queues    ordered list (the order is the display order). Each queue:
 *               { id, name, paused, uses: subscription|api|both, apiAccounts: [] (any API worker), subAccounts: [] (any),
 *                 maxParallel 1-12, defaultModel: ''|opus|fable (for steps with no model pinned), priority 1-9 (1 starts
 *                 first), costCapUsd (0 = none: API spend of this queue's jobs in the last 24 h), note }
 *   members   { buildId: queueId }: each queued / building build sits in exactly one queue. Pending builds sit in none.
 *   rules     ordered, each on or off:
 *               overflow   { from, to }          a `from` build no subscription account can start now starts through `to`
 *               route      { to, when: { categories, models } }   a build queued without a named queue goes to `to`
 *               max-cost   { queue ('' = any), maxCostUsd }        an API run that costs more is stopped
 *   approvals { buildId: { by, via, at, maxCostUsd } }  Brett's OK for a build to run on an API key (billed per token).
 *             Every API run needs one: the dispatcher asks once (asks[buildId]) and the build waits until he says yes.
 *   claims    { buildId: { queue, account, kind, session, at, maxCostUsd, overflowFrom } }  what runs where now
 *   runs      last 200 finished claims (queue spend is the sum of their session costs in the last 24 h)
 *   alerts    { key: at } spend / stop notices already sent (one per spell)
 *
 * The dispatcher interface (queues.mjs wraps these with the store): queues(doc) → the queues in start order;
 * nextJob(doc, queueId, builds) → the next build that queue would start; claim(doc, …) / release(doc, buildId).
 */
import { nextModel, openSteps, queueOrder } from '../../../../framework/core/build-pipeline.mjs';
import { effectivePriority, priorityLabel } from '../../../../framework/core/build-priority.mjs';
import { candidates, noAccountWhy } from './pipeline-core.mjs';
import { nextUp as orchNextUp } from './web/orchestrator-core.mjs';

export const SCHEMA = 'build-queues@1';
export const USES = ['subscription', 'api', 'both'];
export const RULE_KINDS = ['overflow', 'route', 'max-cost'];
export const MODELS = ['', 'opus', 'fable'];
export const MAX_QUEUES = 20;
export const MAX_RULES = 50;
export const ALERT_AT = 0.8;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const BUILD_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

const str = (v, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : v == null ? '' : String(v).trim().slice(0, n));
const int = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
const money = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
const list = (v) => (Array.isArray(v) ? v : []);
const names = (v) => [...new Set(list(typeof v === 'string' ? v.split(',') : v).map((n) => str(n, 40)).filter((n) => NAME_RE.test(n)))];
const words = (v) => [...new Set(list(typeof v === 'string' ? v.split(',') : v).map((x) => str(x, 40).toLowerCase()).filter(Boolean))].slice(0, 30);
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const iso = (v) => { const s = str(v, 40); return s && Number.isFinite(Date.parse(s)) ? s : ''; };
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const fail = (msg) => { throw Object.assign(new Error(msg), { code: 2 }); };

/** Model words → '' | opus | fable (Sonnet and Haiku are never used: they map to Opus). */
export const normModel = (m) => { const s = str(m, 40).toLowerCase(); return !s ? '' : s.includes('fable') ? 'fable' : 'opus'; };

// ------------------------------------------------------------------ normalize

export function normQueue(q, i = 0) {
  const o = q && typeof q === 'object' ? q : {};
  const name = str(o.name, 60) || `Queue ${i + 1}`;
  return {
    id: ID_RE.test(str(o.id, 40)) ? str(o.id, 40) : slug(name) || `queue-${i + 1}`,
    name, paused: o.paused === true, uses: USES.includes(o.uses) ? o.uses : 'subscription',
    apiAccounts: names(o.apiAccounts), subAccounts: names(o.subAccounts),
    maxParallel: int(o.maxParallel, 1, 12, 3), defaultModel: MODELS.includes(normModel(o.defaultModel)) ? normModel(o.defaultModel) : '',
    priority: int(o.priority, 1, 9, 5), costCapUsd: money(o.costCapUsd), note: str(o.note, 200),
  };
}

export function normRule(r, i = 0) {
  const o = r && typeof r === 'object' ? r : {};
  const kind = RULE_KINDS.includes(o.kind) ? o.kind : 'route';
  const name = str(o.name, 80) || { overflow: 'Overflow', route: 'Route', 'max-cost': 'Max cost per job' }[kind];
  const w = o.when && typeof o.when === 'object' ? o.when : {};
  const base = { id: ID_RE.test(str(o.id, 40)) ? str(o.id, 40) : slug(name) || `rule-${i + 1}`, name, kind, enabled: o.enabled !== false };
  if (kind === 'overflow') return { ...base, from: slug(o.from) || 'main', to: slug(o.to) || 'api' };
  if (kind === 'max-cost') return { ...base, queue: slug(o.queue), maxCostUsd: money(o.maxCostUsd) };
  return { ...base, to: slug(o.to), when: { categories: words(w.categories), models: [...new Set(words(w.models).map(normModel).filter(Boolean))] } };
}

/** The two queues every install starts with: today's queue (subscriptions) and the API queue. */
export function defaultDoc() {
  return normDoc({
    queues: [
      { id: 'main', name: 'Main', uses: 'subscription', maxParallel: 6, priority: 1, note: 'Subscription accounts: today\'s queue.' },
      { id: 'api', name: 'API', uses: 'api', apiAccounts: ['hulu-api', 'mossesx-api'], maxParallel: 2, priority: 5, costCapUsd: 10, note: 'API keys, billed per token: every run needs Brett\'s OK.' },
    ],
    rules: [
      { id: 'overflow-to-api', name: 'Subscriptions full → API queue', kind: 'overflow', from: 'main', to: 'api', enabled: false },
      { id: 'api-max-cost', name: 'API job max cost', kind: 'max-cost', queue: 'api', maxCostUsd: 5, enabled: true },
    ],
  });
}

export function normDoc(d) {
  const o = d && typeof d === 'object' ? d : {};
  const seen = new Set();
  let queues = list(o.queues).slice(0, MAX_QUEUES).map((q, i) => { const x = normQueue(q, i); let id = x.id; let k = 2; while (seen.has(id)) id = `${x.id}-${k++}`; seen.add(id); return { ...x, id }; });
  if (!queues.length) queues = [normQueue({ id: 'main', name: 'Main', uses: 'subscription', maxParallel: 6, priority: 1 })];
  const ids = new Set(queues.map((q) => q.id));
  const members = {};
  for (const [b, q] of Object.entries(o.members && typeof o.members === 'object' ? o.members : {})) if (BUILD_RE.test(b) && ids.has(q)) members[b] = q;
  const rseen = new Set();
  const rules = list(o.rules).slice(0, MAX_RULES).map((r, i) => { const x = normRule(r, i); let id = x.id; let k = 2; while (rseen.has(id)) id = `${x.id}-${k++}`; rseen.add(id); return { ...x, id }; });
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const approvals = {};
  for (const [b, a] of Object.entries(obj(o.approvals))) if (BUILD_RE.test(b) && a && typeof a === 'object') approvals[b] = { by: str(a.by, 120), via: str(a.via, 20), at: iso(a.at), maxCostUsd: money(a.maxCostUsd) };
  const asks = {};
  for (const [b, at] of Object.entries(obj(o.asks))) if (BUILD_RE.test(b) && iso(at)) asks[b] = iso(at);
  const claims = {};
  for (const [b, c] of Object.entries(obj(o.claims))) if (BUILD_RE.test(b) && c && typeof c === 'object') claims[b] = normClaim(c);
  const runs = list(o.runs).filter((r) => r && typeof r === 'object' && BUILD_RE.test(str(r.build, 80))).slice(-200).map((r) => ({ build: str(r.build, 80), ...normClaim(r), end: iso(r.end), why: str(r.why, 200) }));
  const alerts = {};
  for (const [k, at] of Object.entries(obj(o.alerts))) if (iso(at)) alerts[str(k, 120)] = iso(at);
  return { $axf: SCHEMA, queues, members, rules, approvals, asks, claims, runs, alerts, updatedAt: iso(o.updatedAt) };
}
const normClaim = (c) => ({ queue: slug(c.queue), account: NAME_RE.test(str(c.account, 40)) ? str(c.account, 40) : '', kind: c.kind === 'api' ? 'api' : 'subscription', session: str(c.session, 120), at: iso(c.at), maxCostUsd: money(c.maxCostUsd), overflowFrom: slug(c.overflowFrom) });

// ------------------------------------------------------------------ reads

/** The queue a build belongs to: its member record, else the first route rule that matches, else the first queue that takes subscriptions. */
export function queueOf(doc, b) {
  const d = doc; const id = typeof b === 'string' ? b : b?.id;
  if (d.members[id] && d.queues.some((q) => q.id === d.members[id])) return d.members[id];
  return (typeof b === 'object' && routeFor(d, b)?.to) || defaultQueue(d).id;
}
export const defaultQueue = (doc) => doc.queues.find((q) => q.uses !== 'api') ?? doc.queues[0];
export const findQueue = (doc, id) => doc.queues.find((q) => q.id === id || q.name.toLowerCase() === str(id, 60).toLowerCase()) ?? null;

/** The first enabled route rule that matches a build's category or next model (null = none). */
export function routeFor(doc, b) {
  const cat = str(b?.category, 60).toLowerCase(); const model = normModel(nextModel(b));
  for (const r of doc.rules) {
    if (r.kind !== 'route' || !r.enabled || !r.to || !doc.queues.some((q) => q.id === r.to)) continue;
    if (r.when.categories.length && !r.when.categories.includes(cat)) continue;
    if (r.when.models.length && !r.when.models.includes(model)) continue;
    if (!r.when.categories.length && !r.when.models.length) continue; // a rule with no condition would swallow everything
    return r;
  }
  return null;
}

/** queues(doc): every queue in start order (priority 1 first, then the list order). Paused ones are included, flagged. */
export const queues = (doc) => doc.queues.map((q, i) => ({ ...q, position: i })).sort((a, b) => a.priority - b.priority || a.position - b.position);

/** Builds of one queue in start order (queued only). */
export function queuedIn(doc, queueId, builds) {
  return queueOrder(list(builds).filter((b) => !b.deleted && b.status === 'queued' && queueOf(doc, b) === queueId), (b) => effectivePriority(b));
}
/** nextJob(doc, queueId, builds): the build that queue starts next (one with open steps), or null. */
export const nextJob = (doc, queueId, builds) => queuedIn(doc, queueId, builds).find((b) => openSteps(b).length) ?? null;

/** Running builds per queue (claims first, then member records). */
export function runningIn(doc, queueId, builds) {
  return list(builds).filter((b) => !b.deleted && (b.status === 'running' || b.status === 'waiting') && (doc.claims[b.id]?.queue || queueOf(doc, b)) === queueId);
}

/** The max cost of one API run in a queue: the lowest of the matching max-cost rules and Brett's approval (0 = no limit). */
export function maxCostFor(doc, queueId, buildId = '') {
  const caps = doc.rules.filter((r) => r.kind === 'max-cost' && r.enabled && r.maxCostUsd > 0 && (!r.queue || r.queue === queueId)).map((r) => r.maxCostUsd);
  const a = doc.approvals[buildId]?.maxCostUsd; if (a) caps.push(a);
  return caps.length ? Math.min(...caps) : 0;
}

/** API spend of a queue's runs in the last 24 h. costs = { session: costUsd }. */
export function queueSpend(doc, queueId, costs = {}, now = Date.now()) {
  const recent = [...doc.runs, ...Object.entries(doc.claims).map(([build, c]) => ({ build, ...c, end: '' }))]
    .filter((r) => r.kind === 'api' && r.queue === queueId && r.session && now - Date.parse(r.end || r.at || 0) < 86400e3);
  return +recent.reduce((n, r) => n + (Number(costs[r.session]) || 0), 0).toFixed(2);
}

// ------------------------------------------------------------------ API accounts as the dispatcher sees them

/**
 * claude-workers status rows (kind api) → pipeline-style account views. An API account is usable when it is set up as an
 * API worker, switched on, has a key, is under its caps and not limited. API keys run every model.
 */
export function apiViews(rows, running = {}) {
  return list(rows).filter((r) => r?.kind === 'api').map((r) => {
    const n = (Array.isArray(r.running) ? r.running.length : Number(r.running) || 0) + (running[r.name] || 0);
    const parallel = int(r.building, 0, 20, 3);
    let why = '';
    if (r.role !== 'api-worker') why = r.why || 'not set up as an API worker';
    else if (r.hasKey === false) why = 'no key saved yet';
    else if (r.spend?.state === 'capped') why = r.spend.why || 'spend cap reached';
    else if (r.limited) why = `out until ${str(r.limited.until, 40)}`;
    return { name: str(r.name, 40), label: str(r.label, 40), kind: 'api', role: 'api', plan: 'api', fable: true, fableFrom: 'api', parallel, running: n, free: Math.max(0, parallel - n), usable: !why && parallel > 0, why, hasKey: r.hasKey !== false, spend: r.spend ?? null };
  });
}

/** The accounts a queue may use, from the subscription views (pipeline accountViews) and the API views. */
export function poolFor(q, subs, apis) {
  const s = q.uses === 'api' ? [] : list(subs).filter((a) => !q.subAccounts.length || q.subAccounts.includes(a.name));
  const a = q.uses === 'subscription' ? [] : list(apis).filter((x) => !q.apiAccounts.length || q.apiAccounts.includes(x.name));
  return { subs: s, apis: a };
}
const apiPick = (apis) => list(apis).filter((a) => a.usable && a.free > 0).sort((a, b) => a.running - b.running || a.name.localeCompare(b.name))[0] ?? null;

// ------------------------------------------------------------------ the plan of one tick (the dispatcher hook)

/**
 * The launches of one tick over every queue. Same shape as pipeline-core plan() plus per-queue facts:
 *   launches  [{ id, account, model, phase, priority, queue, kind, overflowFrom, maxCostUsd }]
 *   waits     [{ id, why, queue }]   asks [{ id, queue, account }] builds waiting for Brett's OK to run on an API key
 *   perQueue  { queueId: { running, queued, launches, spentToday, paused, full } }
 * `subs` = pipeline accountViews (API keys are never usable there), `apis` = apiViews(), `costs` = { session: usd }.
 */
export function plan({ doc, builds, subs, apis = [], slots, rules, costs = {}, now = Date.now() }) {
  const live = list(builds).filter((b) => !b.deleted);
  const subPool = list(subs).map((a) => ({ ...a })); const apiPool = list(apis).map((a) => ({ ...a }));
  let free = Math.max(0, Number(slots?.free) || 0);
  const launches = []; const waits = []; const asks = []; const perQueue = {};
  const order = queues(doc);
  for (const q of order) perQueue[q.id] = { running: runningIn(doc, q.id, live).length, queued: queuedIn(doc, q.id, live).length, launches: 0, spentToday: queueSpend(doc, q.id, costs, now), paused: q.paused, full: false };
  const byId = Object.fromEntries(doc.queues.map((q) => [q.id, q]));
  const roomIn = (q) => !q.paused && perQueue[q.id].running < q.maxParallel && !(q.costCapUsd && perQueue[q.id].spentToday >= q.costCapUsd);
  const why = (q) => q.paused ? `queue ${q.name} is paused` : q.costCapUsd && perQueue[q.id].spentToday >= q.costCapUsd ? `queue ${q.name} reached its ${usd(q.costCapUsd)} cost cap today (${usd(perQueue[q.id].spentToday)})` : `queue ${q.name} is at its max parallel (${perQueue[q.id].running}/${q.maxParallel})`;
  /** Try to start `b` with queue `q`'s accounts: a launch, or the reason it can't. */
  const tryQueue = (b, q, model, overflowFrom = '') => {
    if (!roomIn(q)) return { why: why(q) };
    const pool = poolFor(q, subPool, apiPool);
    const sub = candidates(pool.subs, model)[0];
    if (sub) return { account: sub, kind: 'subscription' };
    const api = apiPick(pool.apis);
    if (api) {
      if (!doc.approvals[b.id]) return { why: `needs your OK to run on API account ${api.label || api.name} (billed per token)`, ask: api.name };
      return { account: api, kind: 'api' };
    }
    const reasons = [];
    if (q.uses !== 'api') reasons.push(noAccountWhy(pool.subs, model));
    if (q.uses !== 'subscription') reasons.push(pool.apis.length ? `API: ${pool.apis.map((a) => `${a.label || a.name} ${a.why || `${a.running}/${a.parallel} running`}`).join('; ')}` : 'no API account set up for this queue');
    return { why: `${overflowFrom ? `overflow to ${q.name}: ` : ''}${reasons.join('; ')}` };
  };
  for (const q of order) {
    for (const b of queuedIn(doc, q.id, live)) {
      const wait = (w) => waits.push({ id: b.id, why: w, queue: q.id });
      if (!openSteps(b).length) { wait(b.steps?.length ? 'every step is done: nothing to run' : 'no steps yet: waiting for the split'); continue; }
      const n = orchNextUp(b, rules);
      if (n.needsApproval) { wait(`needs Brett's approval: upgrade ${n.phase.from} → ${n.phase.model}`); continue; }
      const model = nextModel(b) || (q.defaultModel ? (q.defaultModel === 'fable' ? 'Fable' : 'Opus') : 'Opus');
      if (free <= 0) { wait(`no free agent slot (${slots?.used ?? '?'}/${slots?.cap ?? '?'} in use)`); continue; }
      let got = tryQueue(b, q, model); let via = q;
      if (!got.account && !q.paused) {
        // overflow: subscriptions full → another queue (the API queue), when a rule says so and it has room
        for (const r of doc.rules.filter((x) => x.kind === 'overflow' && x.enabled && x.from === q.id && byId[x.to] && x.to !== q.id)) {
          const t = byId[r.to]; const o = tryQueue(b, t, model, q.id);
          if (o.account) { got = o; via = t; break; }
          if (o.ask && !got.ask) got = { ...o, why: `overflow to ${t.name}: ${o.why}` };
          else if (!got.ask) got = { why: `${got.why}; ${o.why}` };
        }
      }
      if (got.ask) asks.push({ id: b.id, queue: via.id, account: got.ask });
      if (!got.account) { wait(got.why); continue; }
      const a = got.account; a.running += 1; a.free -= 1; free -= 1;
      perQueue[via.id].running += 1; perQueue[via.id].launches += 1;
      launches.push({ id: b.id, account: a.name, model, phase: n.phase?.name ?? '', priority: priorityLabel(effectivePriority(b)), queue: via.id, kind: got.kind, overflowFrom: via.id === q.id ? '' : q.id, maxCostUsd: got.kind === 'api' ? maxCostFor(doc, via.id, b.id) : 0 });
    }
  }
  for (const q of order) perQueue[q.id].full = !roomIn(q);
  const queued = order.flatMap((q) => queuedIn(doc, q.id, live).map((b) => b.id));
  return { launches, waits, asks, perQueue, queue: queued };
}

/** The pipeline-core plan() result with the queue plan merged in (idle detection stays the pipeline's). */
export function mergePlan(base, qp) {
  const idle = base.idle && qp.launches.length ? null : base.idle;
  return { ...base, launches: qp.launches, waits: qp.waits, queue: qp.queue, asks: qp.asks, perQueue: qp.perQueue, idle };
}

// ------------------------------------------------------------------ claims (what runs where)

export function claim(doc, buildId, { queue, account, kind, session = '', maxCostUsd = 0, overflowFrom = '' }, now = new Date().toISOString()) {
  const d = normDoc(doc);
  d.claims[buildId] = normClaim({ queue, account, kind, session, at: now, maxCostUsd, overflowFrom });
  if (!d.members[buildId]) d.members[buildId] = overflowFrom || queue;
  delete d.asks[buildId];
  return d;
}
export function release(doc, buildId, { why = '', now = new Date().toISOString() } = {}) {
  const d = normDoc(doc); const c = d.claims[buildId];
  if (c) { d.runs = [...d.runs, { build: buildId, ...c, end: now, why: str(why, 200) }].slice(-200); delete d.claims[buildId]; }
  return d;
}

// ------------------------------------------------------------------ spend safety

/**
 * What the dispatcher must do about money now. `apiRows` = claude-workers status rows (kind api, with spend), `costs` =
 * { session: usd }, `builds` = live builds. Returns:
 *   stop    [{ id, session, account, why }]  running API jobs to stop now (account capped, queue capped, job over its max)
 *   alerts  [{ key, severity, title, body }] 80 % and stop notices (the caller sends each key once per spell)
 *   clear   [key]                            notices whose spell is over (spend back under 80 %)
 */
export function enforce({ doc, builds, apiRows = [], costs = {}, now = Date.now() }) {
  const stop = []; const alerts = []; const live = list(builds).filter((b) => !b.deleted);
  const running = live.filter((b) => (b.status === 'running' || b.status === 'waiting'));
  const api = Object.fromEntries(list(apiRows).filter((r) => r?.kind === 'api').map((r) => [r.name, r]));
  const active = new Set();
  const note = (key, severity, title, body) => { active.add(key); alerts.push({ key, severity, title, body }); };
  for (const r of Object.values(api)) {
    const s = r.spend; if (!s || r.role !== 'api-worker') continue;
    const label = r.label || r.name;
    if (s.state === 'capped') note(`queues:spend:${r.name}:stop`, 'error', `${label} stopped: ${s.why}`, `Every API job on ${label} is stopped and nothing new starts on it until the spend window rolls over. Raise the cap in Queues & API (your click only).`);
    else if (s.state === 'warn') note(`queues:spend:${r.name}:warn`, 'warning', `${label} at ${Math.round((s.alertAt || ALERT_AT) * 100)}% of its cap`, `${s.why}. At the cap every API job on it stops.`);
  }
  for (const q of doc.queues) {
    if (!q.costCapUsd) continue;
    const spent = queueSpend(doc, q.id, costs, now);
    if (spent >= q.costCapUsd) note(`queues:cap:${q.id}:stop`, 'error', `Queue ${q.name} stopped: ${usd(spent)} of its ${usd(q.costCapUsd)} cap today`, `Its API jobs are stopped and it starts nothing on API keys until the 24 h window rolls over.`);
    else if (spent >= ALERT_AT * q.costCapUsd) note(`queues:cap:${q.id}:warn`, 'warning', `Queue ${q.name} at ${Math.round((spent / q.costCapUsd) * 100)}% of its cost cap`, `${usd(spent)} of ${usd(q.costCapUsd)} today. At the cap its API jobs stop.`);
  }
  for (const b of running) {
    const c = doc.claims[b.id]; const account = c?.account || b.pipeline?.account || '';
    const row = api[account]; if (!row && c?.kind !== 'api') continue;
    const session = c?.session || b.pipeline?.session || '';
    const queue = c?.queue || queueOf(doc, b); const q = doc.queues.find((x) => x.id === queue);
    const cost = Number(costs[session]) || 0; const max = c?.maxCostUsd || maxCostFor(doc, queue, b.id);
    let why = '';
    if (row?.spend?.state === 'capped') why = `${row.label || account}: ${row.spend.why}`;
    else if (q?.costCapUsd && queueSpend(doc, q.id, costs, now) >= q.costCapUsd) why = `queue ${q.name} reached its ${usd(q.costCapUsd)} cost cap today`;
    else if (max && cost >= max) why = `this run cost ${usd(cost)}, over its ${usd(max)} max per job`;
    if (why) { stop.push({ id: b.id, session, account, why }); note(`queues:stop:${b.id}`, 'error', `Stopped API job ${b.id}`, `${why}. The build is back in Pending; queue it again (or raise the limit) to carry on.`); }
  }
  const clear = Object.keys(doc.alerts).filter((k) => !active.has(k));
  return { stop, alerts, clear };
}

// ------------------------------------------------------------------ changes (CLI, console, MCP, voice: all here)

/** Raising a money limit (queue cost cap, max cost per job) or approving an API run is Brett's own call. */
export function raisedLimits(before, after) {
  const out = [];
  const up = (x, y) => (x > 0 && y === 0) || (x > 0 && y > x);
  for (const q of after.queues) { const o = before.queues.find((x) => x.id === q.id); if (o && up(o.costCapUsd, q.costCapUsd)) out.push(`queue ${q.name} cost cap ${usd(o.costCapUsd)} → ${q.costCapUsd ? usd(q.costCapUsd) : 'none'}`); }
  for (const r of after.rules.filter((x) => x.kind === 'max-cost')) {
    const o = before.rules.find((x) => x.id === r.id);
    if (o && o.kind === 'max-cost' && ((o.enabled && !r.enabled) || up(o.maxCostUsd, r.maxCostUsd))) out.push(`${r.name} ${usd(o.maxCostUsd)} → ${r.enabled && r.maxCostUsd ? usd(r.maxCostUsd) : 'none'}`);
  }
  for (const r of before.rules.filter((x) => x.kind === 'max-cost' && x.enabled)) if (!after.rules.some((x) => x.id === r.id)) out.push(`${r.name} removed`);
  // a queue that newly takes API accounts spends money: also owner-only
  for (const q of after.queues) { const o = before.queues.find((x) => x.id === q.id); if (q.uses !== 'subscription' && (!o || o.uses === 'subscription')) out.push(`queue ${q.name} now uses API accounts`); }
  return out;
}

/**
 * One change. change = { action, … } with action:
 *   create {name, uses?, maxParallel?, …}   update {queue, …fields}   rename {queue, name}   move {queue, to: index|up|down}
 *   pause|resume {queue}   delete {queue, into?}   assign {build, queue}   unassign {build}
 *   rule-add {rule, at?}   rule-update {rule: id, patch}   rule-remove {rule}   rule-move {rule, to}   rule-on|rule-off {rule}
 *   approve {build, maxCostUsd?}   revoke {build}
 * `owner` = the change comes from Brett (console click / axHub-approved tool): needed to raise a money limit, add API
 * use to a queue, or approve an API run. Returns { doc, log: [lines], queue?, rule? }.
 */
export function apply(doc, change, { owner = false, now = new Date().toISOString() } = {}) {
  const before = normDoc(doc); const d = normDoc(doc); const c = change && typeof change === 'object' ? change : {};
  const log = [];
  const q = () => { const x = findQueue(d, c.queue); if (!x) fail(`no queue "${str(c.queue, 60)}"`); return x; };
  const rule = () => { const x = d.rules.find((r) => r.id === slug(c.rule) || r.name.toLowerCase() === str(c.rule, 80).toLowerCase()); if (!x) fail(`no rule "${str(c.rule, 80)}"`); return x; };
  const moveIn = (arr, i, to) => {
    const j = to === 'up' ? i - 1 : to === 'down' ? i + 1 : to === 'top' ? 0 : to === 'bottom' ? arr.length - 1 : int(to, 0, arr.length - 1, i);
    const k = Math.min(arr.length - 1, Math.max(0, j)); const [x] = arr.splice(i, 1); arr.splice(k, 0, x); return k;
  };
  const fields = (src) => { const o = {}; for (const k of ['name', 'paused', 'uses', 'apiAccounts', 'subAccounts', 'maxParallel', 'defaultModel', 'priority', 'costCapUsd', 'note']) if (src?.[k] !== undefined) o[k] = src[k]; return o; };
  let out = {};
  switch (c.action) {
    case 'create': {
      if (d.queues.length >= MAX_QUEUES) fail(`at most ${MAX_QUEUES} queues`);
      const name = str(c.name, 60); if (!name) fail('a queue needs a name');
      if (d.queues.some((x) => x.name.toLowerCase() === name.toLowerCase())) fail(`a queue named ${name} exists`);
      let id = slug(c.id || name) || 'queue'; let k = 2; while (d.queues.some((x) => x.id === id)) id = `${slug(c.id || name)}-${k++}`;
      const nq = normQueue({ maxParallel: 2, priority: 5, ...fields(c), id, name }, d.queues.length);
      d.queues.push(nq); out.queue = nq; log.push(`Queue ${nq.name} (${nq.id}) created: ${nq.uses}, ${nq.maxParallel} at once.`); break;
    }
    case 'update': case 'rename': {
      const x = q(); const i = d.queues.indexOf(x);
      const patch = c.action === 'rename' ? { name: c.name } : fields(c.patch ?? c);
      if (patch.name !== undefined) { const n = str(patch.name, 60); if (!n) fail('a queue needs a name'); if (d.queues.some((y) => y !== x && y.name.toLowerCase() === n.toLowerCase())) fail(`a queue named ${n} exists`); }
      d.queues[i] = normQueue({ ...x, ...patch, id: x.id }, i); out.queue = d.queues[i];
      log.push(`Queue ${d.queues[i].name}: ${Object.keys(patch).join(', ') || 'nothing'} changed.`); break;
    }
    case 'move': { const x = q(); const k = moveIn(d.queues, d.queues.indexOf(x), c.to); out.queue = x; log.push(`Queue ${x.name} moved to place ${k + 1}.`); break; }
    case 'pause': case 'resume': { const x = q(); x.paused = c.action === 'pause'; out.queue = x; log.push(`Queue ${x.name} ${x.paused ? 'paused: it starts nothing new' : 'resumed'}.`); break; }
    case 'delete': {
      const x = q(); if (d.queues.length <= 1) fail('the last queue cannot be deleted');
      const rest = d.queues.filter((y) => y !== x);
      const into = c.into ? findQueue({ queues: rest }, c.into) : (rest.find((y) => y.uses !== 'api') ?? rest[0]);
      if (!into) fail(`no queue "${str(c.into, 60)}" to move its builds into`);
      let moved = 0; for (const [b, id] of Object.entries(d.members)) if (id === x.id) { d.members[b] = into.id; moved++; }
      d.queues = rest; d.rules = d.rules.filter((r) => !(r.kind === 'overflow' && (r.from === x.id || r.to === x.id)) && !(r.kind === 'route' && r.to === x.id));
      for (const r of d.rules) if (r.kind === 'max-cost' && r.queue === x.id) r.enabled = false;
      log.push(`Queue ${x.name} deleted${moved ? `; ${moved} build${moved === 1 ? '' : 's'} moved to ${into.name}` : ''}.`); out.into = into.id; break;
    }
    case 'assign': {
      const b = str(c.build, 80); if (!BUILD_RE.test(b)) fail('bad build id'); const x = q();
      const was = d.members[b]; d.members[b] = x.id; out.queue = x;
      log.push(was && was !== x.id ? `${b}: ${findQueue(d, was)?.name ?? was} → ${x.name}.` : `${b} → ${x.name}.`); break;
    }
    case 'unassign': { const b = str(c.build, 80); delete d.members[b]; delete d.asks[b]; log.push(`${b} left its queue.`); break; }
    case 'rule-add': {
      if (d.rules.length >= MAX_RULES) fail(`at most ${MAX_RULES} rules`);
      const r = normRule(c.rule ?? c, d.rules.length); let id = r.id; let k = 2; while (d.rules.some((x) => x.id === id)) id = `${r.id}-${k++}`;
      const nr = { ...r, id }; checkRule(d, nr);
      const at = c.at === undefined ? d.rules.length : int(c.at, 0, d.rules.length, d.rules.length); d.rules.splice(at, 0, nr); out.rule = nr;
      log.push(`Rule ${nr.name} added (${nr.kind}${nr.enabled ? '' : ', off'}).`); break;
    }
    case 'rule-update': { const r = rule(); const i = d.rules.indexOf(r); const nr = normRule({ ...r, ...(c.patch ?? {}), id: r.id, kind: c.patch?.kind ?? r.kind }, i); checkRule(d, nr); d.rules[i] = nr; out.rule = nr; log.push(`Rule ${nr.name} changed.`); break; }
    case 'rule-remove': { const r = rule(); d.rules = d.rules.filter((x) => x !== r); log.push(`Rule ${r.name} removed.`); break; }
    case 'rule-move': { const r = rule(); const k = moveIn(d.rules, d.rules.indexOf(r), c.to); log.push(`Rule ${r.name} moved to place ${k + 1}.`); break; }
    case 'rule-on': case 'rule-off': { const r = rule(); r.enabled = c.action === 'rule-on'; out.rule = r; log.push(`Rule ${r.name} ${r.enabled ? 'on' : 'off'}.`); break; }
    case 'approve': {
      const b = str(c.build, 80); if (!BUILD_RE.test(b)) fail('bad build id');
      if (!owner) fail('running a build on an API key (billed per token) needs Brett\'s OK: his console click or an axHub approval he approves');
      d.approvals[b] = { by: str(c.by, 120) || 'brett', via: str(c.via, 20) || 'console', at: now, maxCostUsd: money(c.maxCostUsd) }; delete d.asks[b];
      log.push(`${b} may run on API keys${d.approvals[b].maxCostUsd ? ` (up to ${usd(d.approvals[b].maxCostUsd)} a run)` : ''}.`); break;
    }
    case 'revoke': { const b = str(c.build, 80); delete d.approvals[b]; log.push(`${b}: API OK withdrawn.`); break; }
    default: fail(`unknown queue action ${str(c.action, 40)}`);
  }
  const next = normDoc({ ...d, updatedAt: now });
  const raised = raisedLimits(before, next);
  if (raised.length && !owner) fail(`only Brett can do this (his console click or an axHub approval): ${raised.join('; ')}`);
  return { doc: next, log, ...out };
}

function checkRule(d, r) {
  const has = (id) => d.queues.some((q) => q.id === id);
  if (r.kind === 'overflow') { if (!has(r.from)) fail(`overflow: no queue "${r.from}"`); if (!has(r.to)) fail(`overflow: no queue "${r.to}"`); if (r.from === r.to) fail('overflow goes from one queue to another'); }
  if (r.kind === 'route') { if (!has(r.to)) fail(`route: no queue "${r.to}"`); if (!r.when.categories.length && !r.when.models.length) fail('route: name a category or a model'); }
  if (r.kind === 'max-cost') { if (r.queue && !has(r.queue)) fail(`max cost: no queue "${r.queue}"`); if (!r.maxCostUsd) fail('max cost: give a dollar amount'); }
}

/** A plain line for one queue (CLI, voice). */
export function queueLine(q, pq = {}) {
  const uses = q.uses === 'both' ? 'subscriptions + API' : q.uses === 'api' ? `API${q.apiAccounts.length ? ` (${q.apiAccounts.join(', ')})` : ''}` : 'subscriptions';
  return `${q.name} [${q.id}]${q.paused ? ' PAUSED' : ''} · ${uses} · ${pq.running ?? 0}/${q.maxParallel} running · ${pq.queued ?? 0} queued · priority ${q.priority}${q.costCapUsd ? ` · cap ${usd(pq.spentToday ?? 0)}/${usd(q.costCapUsd)} today` : ''}${q.defaultModel ? ` · default ${q.defaultModel}` : ''}`;
}
