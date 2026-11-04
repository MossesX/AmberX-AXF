#!/usr/bin/env node
/**
 * Requests ledger CLI (request@1): every single thing Brett asked for, where it lives, its status and place in line.
 * The console's Build Breaker page, its REST routes, the console MCP tools (requests_list, request_get,
 * request_update, request_link) and any session use this one file.
 *
 *   node apps/console-web/plugins/build-breaker/requests.mjs list [--open] [--status s,s] [--kind k,k] [--profile p] [--q words] [--limit N] [--json]
 *   … get <id | build id | words> [--json]          one request with everything known about it ("where's that thing I asked for")
 *   … update <id> [--status S] [--title T] [--agent A] [--superseded-by ID] [--note "…"] [--by who] [--json]
 *   … link <id> <kind> <ref> [--label "…"] [--by who] [--json]     kinds: build step bug plan follow-up memory thread ask pr
 *   … add --said "his exact words" [--kind bug|setting|crew|follow-up|plan|build|addendum] [--title T] [--source voice|chat|console]
 *         [--by Amber] [--parent ID] [--link kind:ref] [--status S] [--at ISO] [--json]
 *   … capture --build <id> [--by agent]            a build launch: record it (first seen + "Launched by …"), zero tokens
 *   … sync [--json]                                 record status / place-in-line changes into the ledger's history
 *   … export --json [--record]                      every request + summary + fingerprint (the console reads this)
 *   … summary --json                                counts for the banner and the Home card
 *   … paths                                         where each source and the ledger are read from
 *
 * Sources (read on every call, so nothing goes stale): the builds store (origin.said + addenda, status, steps, queue
 * order), agent-slots (running / waiting), the change log (cost), every build brief (.brief.md: his words + addenda),
 * Plan Studio plans, bugs-board bugs, memory files (follow-ups.md, vision.md, naming.md), THREADS.md and the old
 * build-asks@1 list. The ledger file keeps only hand-captured requests, patches and history (request-ledger@1).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rq from './web/requests-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const firstDir = (...ds) => ds.find((d) => d && existsSync(d)) ?? '';
const firstFile = (...fs) => fs.find((f) => f && existsSync(f)) ?? '';

async function persistRoot() {
  if (process.env.AXF_REQUESTS_NO_HUB) return null;
  try { return (await import('../../../../framework/cli/persist.mjs')).persistRoot(); } catch { return null; }
}

/** Where everything is read from (env overrides for tests). */
export async function paths() {
  const data = await persistRoot();
  const projects = data ? dirname(dirname(data)) : '';
  return {
    // like Plan Studio's plans: on the hub's shared data where it exists (every session and the console see one ledger)
    ledger: process.env.AXF_REQUESTS_LEDGER || (data ? join(data, 'build-breaker', 'requests-ledger.json') : join(ROOT, '.axf-console/plugins/build-breaker/requests-ledger.json')),
    builds: process.env.AXF_REQUESTS_BUILDS_DIR ?? firstDir('/root/axf-builds', '/hostfs/axf-builds'),
    changes: process.env.AXF_REQUESTS_CHANGES ?? firstDir(data && join(data, 'changes'), join(ROOT, 'changes')),
    // bug@1 (bugs-board, queued): kept with the builds store, or in its plugin data folder; every place that exists is read
    bugs: process.env.AXF_REQUESTS_BUGS !== undefined ? [process.env.AXF_REQUESTS_BUGS].filter(Boolean) : [join(ROOT, '_claude/builds/bugs.json'), join(ROOT, '_claude/builds/bugs'), data && join(data, 'bugs-board'), join(ROOT, '.axf-console/plugins/bugs-board')].filter((f) => f && existsSync(f)),
    threads: process.env.AXF_REQUESTS_THREADS ?? firstFile(join(ROOT, '_claude/THREADS.md')),
    memory: process.env.AXF_REQUESTS_MEMORY !== undefined ? process.env.AXF_REQUESTS_MEMORY.split(',').filter(Boolean).map((x) => { const [file, kind = 'follow-up'] = x.split('='); return { path: file, kind }; }) : [
      { path: firstFile(projects && join(projects, 'amberx-axf/_claude/memory/follow-ups.md'), join(ROOT, '_claude/memory/follow-ups.md')), kind: 'follow-up' },
      { path: firstFile(projects && join(projects, '_shared/_claude/memory/vision.md'), join(ROOT, '_claude/shared/memory/vision.md')), kind: 'plan' },
      { path: firstFile(projects && join(projects, '_shared/_claude/memory/naming.md'), join(ROOT, '_claude/shared/memory/naming.md')), kind: 'crew' },
    ].filter((m) => m.path),
  };
}

/* ------------------------------------------------------------------ sources */

function walkJson(dir, out = [], depth = 0) {
  if (!dir || depth > 3) return out;
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const f = join(dir, n);
    if (n.endsWith('.json')) { const j = readJson(f); if (j) out.push(j); } else if (!n.includes('.')) { try { if (statSync(f).isDirectory()) walkJson(f, out, depth + 1); } catch { /* gone */ } }
  }
  return out;
}

async function loadBuilds() {
  if (process.env.AXF_REQUESTS_STORE) return Object.values(readJson(process.env.AXF_REQUESTS_STORE, {})?.builds ?? {});
  try { const { loadStore } = await import('../../../../framework/cli/builds-store.mjs'); return Object.values(loadStore()?.builds ?? {}); } catch { return []; }
}
async function loadSlots() {
  if (process.env.AXF_REQUESTS_SLOTS !== undefined) return readJson(process.env.AXF_REQUESTS_SLOTS, null);
  try { return (await import('../../../../framework/cli/agent-slots.mjs')).loadState(); } catch { return null; }
}
async function loadPlans() {
  if (process.env.AXF_REQUESTS_PLANS !== undefined) return walkJson(process.env.AXF_REQUESTS_PLANS);
  try { return (await import('../plan-studio/plans.mjs')).loadPlans() ?? []; } catch { return []; }
}
function loadRoster() {
  const r = readJson(process.env.AXF_REQUESTS_ROSTER || join(HERE, '../agent-swarm/agents/roster.json'), {});
  return (Array.isArray(r?.agents) ? r.agents : []).map((a) => ({ id: String(a.id ?? ''), name: String(a.name ?? '') })).filter((a) => a.id && a.name);
}
async function loadAsks() {
  if (process.env.AXF_REQUESTS_ASKS !== undefined) return [];
  try { return (await import('./asks.mjs')).load().doc.asks ?? []; } catch { return []; }
}
function loadBriefs(dir) {
  const out = [];
  if (!dir) return out;
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) { const t = readText(join(dir, n, '.brief.md')); if (t) out.push({ folder: n, text: t }); }
  return out;
}
function loadBugs(places) {
  const flat = [];
  const take = (j) => { if (Array.isArray(j?.bugs)) flat.push(...j.bugs); else if (j?.bugs && typeof j.bugs === 'object') flat.push(...Object.values(j.bugs)); else if (j?.id && (j.$axf === 'bug@1' || j.title)) flat.push(j); };
  for (const p of places ?? []) {
    if (p.endsWith('.json')) { take(readJson(p)); continue; }
    for (const j of walkJson(p)) take(j);
    for (const l of readText(join(p, 'bugs.jsonl')).split('\n')) { try { const v = JSON.parse(l); if (v?.id) flat.push(v); } catch { /* not a line */ } }
  }
  const seen = new Set();
  return flat.filter((g) => g?.id && !seen.has(g.id) && seen.add(g.id));
}

/** Every source, read now. */
export async function gather() {
  const p = await paths();
  const [builds, slots, plans, asks] = await Promise.all([loadBuilds(), loadSlots(), loadPlans(), loadAsks()]);
  return {
    p,
    src: {
      builds, slots, plans, asks, roster: loadRoster(), costs: walkJson(p.changes), briefs: loadBriefs(p.builds), bugs: loadBugs(p.bugs),
      memory: p.memory.map((m) => ({ file: basename(m.path), text: readText(m.path), kind: m.kind, mtime: (() => { try { return statSync(m.path).mtime.toISOString(); } catch { return ''; } })() })).filter((m) => m.text),
      threads: rq.parseThreads(readText(p.threads)),
    },
  };
}

/* ------------------------------------------------------------------ the ledger file */

export function readLedger(file) { return rq.normLedger(readJson(file, rq.emptyLedger())); }
function withLock(file, fn) {
  mkdirSync(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  for (let i = 0; ; i++) {
    try { mkdirSync(lock); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 15000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { /* raced */ }
      if (i > 200) throw new Error(`ledger is locked (${lock})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    const before = readLedger(file);
    const after = fn(before);
    if (after && after !== before) { const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(after, null, 1)}\n`); renameSync(tmp, file); }
    return after ?? before;
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

/** Every request, assembled now. record = write status / queue changes into the ledger's history. */
export async function requests({ record = false } = {}) {
  const { p, src } = await gather();
  let ledger = readLedger(p.ledger);
  let all = rq.assemble(src, ledger);
  if (record) {
    let changed = [];
    try {
      ledger = withLock(p.ledger, (L) => { const r = rq.recordChanges(all, L); changed = r.changed; return r.changed.length || r.ledger.updatedAt !== L.updatedAt || Object.keys(r.ledger.records).length !== Object.keys(L.records).length ? r.ledger : L; });
      if (changed.length) all = rq.assemble(src, ledger);
    } catch { /* read-only place: show what we have */ }
  }
  const counts = { builds: src.builds.length, briefs: src.briefs.length, plans: src.plans.length, bugs: src.bugs.length, memory: src.memory.length, threads: src.threads.length, asks: src.asks.length, costs: src.costs.length, ledger: Object.keys(ledger.records).length };
  return { all, counts, p };
}

/** One request by id, by build id, or the best match for a few words. */
export function find(all, key) {
  const k = String(key ?? '').trim();
  if (!k) return null;
  const exact = all.find((r) => r.id === k) ?? all.find((r) => r.id === `build:${k}`) ?? all.find((r) => r.id.endsWith(`:${k}`));
  if (exact) return exact;
  const words = k.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  let best = null, score = 0;
  for (const r of all) {
    const t = rq.searchText(r);
    const s = words.filter((w) => t.includes(w)).length + (words.every((w) => String(r.title).toLowerCase().includes(w)) ? 2 : 0) + (rq.isOpen(r) ? 0.5 : 0);
    if (s > score) { best = r; score = s; }
  }
  return score >= Math.max(1, words.length * 0.6) ? best : null;
}

/** The request plus its family: parent, addenda, what it supersedes / was superseded by. */
export function withFamily(all, r) {
  if (!r) return null;
  const by = new Map(all.map((x) => [x.id, x]));
  const brief = (x) => (x ? { id: x.id, kind: x.kind, title: x.title, status: x.status, said: x.said } : null);
  return { ...r, family: { parent: brief(by.get(r.parent)), addenda: all.filter((x) => x.parent === r.id).map(brief), supersededBy: brief(by.get(r.supersededBy)), supersedes: (r.supersedes ?? []).map((id) => brief(by.get(id))).filter(Boolean) } };
}

/* ------------------------------------------------------------------ commands */

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2), next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[k] = true; else { flags[k] = next; i++; }
  }
  return { pos, flags };
}
const csv = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const line = (r) => `${rq.statusInfo(r.status).label.padEnd(22)} ${r.queue ? `#${String(r.queue.position).padEnd(3)}` : '    '} ${r.kind.padEnd(9)} ${r.id}  ${r.title}`;

export async function run(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0] ?? 'list';
  const by = typeof flags.by === 'string' ? flags.by : process.env.AXF_AGENT || process.env.AXF_ACTOR || 'cli';
  if (cmd === 'paths') { const p = await paths(); return { ok: true, ...p, text: Object.entries(p).map(([k, v]) => `${k.padEnd(8)} ${typeof v === 'string' ? v || '(none)' : JSON.stringify(v)}`).join('\n') }; }
  if (cmd === 'add' || cmd === 'capture') {
    const p = await paths();
    let id, record;
    if (cmd === 'capture') {
      if (typeof flags.build !== 'string') throw new Error('capture needs --build <id>');
      id = `build:${flags.build}`;
      record = { history: [{ at: new Date().toISOString(), text: `Launched${by && by !== 'cli' ? ` by ${by}` : ''}` }] };
      withLock(p.ledger, (L) => { const rec = L.records[id] ?? {}; return { ...L, updatedAt: new Date().toISOString(), records: { ...L.records, [id]: { ...rec, firstSeen: rec.firstSeen || new Date().toISOString(), history: [...(rec.history ?? []), ...record.history] } } }; });
      return { ok: true, id, text: `captured ${id}` };
    }
    const link = typeof flags.link === 'string' && flags.link.includes(':') ? { kind: flags.link.split(':')[0], id: flags.link.slice(flags.link.indexOf(':') + 1) } : null;
    ({ id, record } = rq.captureRecord({ said: flags.said, title: flags.title, kind: flags.kind, source: flags.source, by, parent: flags.parent, link, status: flags.status, at: flags.at, id: flags.id }));
    withLock(p.ledger, (L) => { if (L.records[id]?.kind) throw new Error(`${id} is already in the ledger`); return rq.patchLedger(L, id, record, { by }); });
    const { all } = await requests();
    return { ok: true, request: rq.normRequest(all.find((r) => r.id === id) ?? { id, ...record }), text: `added ${id}` };
  }
  if (cmd === 'update' || cmd === 'link') {
    const key = pos[1];
    if (!key) throw new Error(`${cmd} needs a request id`);
    const { all, p } = await requests();
    const r = find(all, key);
    if (!r) throw new Error(`no request "${key}"`);
    const patch = {};
    if (cmd === 'link') {
      const [, , kind, ref] = pos;
      if (!kind || !ref) throw new Error('link needs <kind> <ref>');
      patch.link = { kind, id: ref, ...(typeof flags.label === 'string' ? { label: flags.label } : {}) };
    } else {
      if (typeof flags.status === 'string') patch.status = flags.status;
      for (const [f, k] of [['title', 'title'], ['agent', 'agent'], ['superseded-by', 'supersededBy'], ['note', 'note'], ['pr', 'pr']]) if (typeof flags[f] === 'string') patch[k] = flags[f];
      if (!Object.keys(patch).length) throw new Error('nothing to change (--status --title --agent --superseded-by --note --pr)');
      if (patch.supersededBy && !find(all, patch.supersededBy)) throw new Error(`no request "${patch.supersededBy}" to supersede it`);
      if (patch.supersededBy) patch.supersededBy = find(all, patch.supersededBy).id;
    }
    withLock(p.ledger, (L) => rq.patchLedger(L, r.id, patch, { by }));
    const after = await requests();
    const got = withFamily(after.all, after.all.find((x) => x.id === r.id));
    return { ok: true, request: got, text: `${r.id}: ${rq.statusInfo(got?.status).label}` };
  }
  const record = cmd === 'sync' || !!flags.record;
  const { all, counts, p } = await requests({ record });
  if (cmd === 'sync') { const s = rq.summarize(all); return { ok: true, summary: s, counts, ledger: p.ledger, text: `${s.total} requests, ${s.open} open (${s.running} running, ${s.queued} queued, ${s.awaitingMerge} awaiting merge) · ledger ${p.ledger}` }; }
  if (cmd === 'export') return { ok: true, generatedAt: new Date().toISOString(), fingerprint: rq.fingerprint(all), summary: rq.summarize(all), counts, requests: all };
  if (cmd === 'summary') {
    const s = rq.summarize(all);
    const open = rq.sortRequests(all.filter(rq.isOpen), 'updated');
    return { ok: true, ...s, fingerprint: rq.fingerprint(all), items: open.slice(0, Number(flags.limit) || 8).map((r) => ({ id: r.id, title: r.title, status: rq.statusInfo(r.status).label, queue: r.queue ? `#${r.queue.position}` : '', agent: r.agent || '', updatedAt: r.updatedAt })), text: `${s.open} open of ${s.total}` };
  }
  if (cmd === 'get') {
    const key = pos.slice(1).join(' ');
    const r = withFamily(all, find(all, key));
    if (!r) throw new Error(`no request matches "${key}"`);
    const text = [`${r.title}  [${rq.statusInfo(r.status).label}]  ${r.id}`, r.said ? `Brett said: "${r.said}"` : '(no recorded words)', `Asked ${r.at || 'unknown'} · ${r.source}${r.capturedBy ? ` · captured by ${r.capturedBy}` : ''}`,
      rq.whereLine(r) && `Where: ${rq.whereLine(r)}`, r.agent && `Agent: ${r.agent}`, r.pr && `PR: ${r.pr} ${rq.prUrl(r.pr)}`, r.costUsd != null && `Cost so far: $${r.costUsd}${r.costEstimated ? ' (estimate)' : ''}`,
      r.supersededBy && `Superseded by: ${r.supersededBy}`, ...r.where.map((w) => `  ${w.kind} ${w.id}${w.label ? ` (${w.label})` : ''}`)].filter(Boolean).join('\n');
    return { ok: true, request: r, text };
  }
  if (cmd === 'list') {
    let rs = rq.filterRequests(all, { q: typeof flags.q === 'string' ? flags.q : '', statuses: csv(flags.status), kinds: csv(flags.kind), profiles: csv(flags.profile), open: flags.open ? true : undefined });
    rs = rq.sortRequests(rs, typeof flags.sort === 'string' ? flags.sort : 'newest');
    const limit = Number(flags.limit) || 0;
    const shown = limit ? rs.slice(0, limit) : rs;
    return { ok: true, count: rs.length, requests: shown, text: shown.map(line).join('\n') || 'no requests' };
  }
  throw new Error(`unknown command ${cmd} (list | get | update | link | add | capture | sync | export | summary | paths)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes('--json');
  run(process.argv.slice(2)).then((r) => { if (json) { const { text, ...rest } = r; console.log(JSON.stringify(rest)); } else console.log(r.text ?? JSON.stringify(r, null, 1)); }).catch((e) => {
    if (json) console.log(JSON.stringify({ ok: false, error: e.message }));
    else console.error(`requests: ${e.message}`);
    process.exitCode = 1;
  });
}
