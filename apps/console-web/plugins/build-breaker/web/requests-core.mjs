/**
 * Requests ledger core (request@1): every distinct thing Brett asked for, one record each, with his exact words, where
 * it lives now, its status, its place in line, its agent, PR and cost. Pure: no React, no DOM, no file access. The CLI
 * (requests.mjs) reads the sources and hands them in; the page, the server part and the self-test use the same helpers.
 *
 * Most records are derived on every read from what already exists (the builds store, build briefs, Plan Studio plans,
 * memory files, THREADS, the old build-asks@1 list, bugs), so status and queue position are never stale. The ledger
 * file (request-ledger@1) only keeps what a source can't: requests captured by hand (bugs, settings, crew changes),
 * patches on derived ones (supersededBy, dropped, live, links, notes, agent) and the status history seen over time.
 *
 * request@1 = {
 *   $axf, id, kind, title, said, verbatim, at, source, capturedBy, parent?,
 *   where: [{kind: build|step|bug|plan|follow-up|memory|thread|ask, id, label?, file?}],
 *   status, supersededBy?, supersedes?, queue?: {list, position, of}, slot?: {state, position?},
 *   agent?, pr?, branch?, costUsd?, costEstimated?, profile?, app?, steps?: {done, total, next?},
 *   history: [{at, text, status?}], notes?: [{at, text, by?}], updatedAt
 * }
 * The schema is open: unknown fields are kept.
 */

export const SCHEMA = 'request@1';
export const LEDGER = 'request-ledger@1';
export const REPO = 'MossesX/AmberX-AXF';

/** Statuses, in the order a request moves through them. `open` = still on someone's plate. Open registry. */
export const STATUSES = [
  { id: 'idea', label: 'Idea', icon: 'sparkles', tone: '', open: true },
  { id: 'planned', label: 'Planned', icon: 'layers', tone: '', open: true },
  { id: 'queued', label: 'Queued', icon: 'clock', tone: 'warning', open: true },
  { id: 'running', label: 'Running', icon: 'refresh', tone: 'accent', open: true },
  { id: 'paused', label: 'Paused', icon: 'pause', tone: 'warning', open: true },
  { id: 'built', label: 'Built · awaiting merge', icon: 'upload', tone: 'accent', open: true },
  { id: 'merged', label: 'Merged', icon: 'check-circle', tone: 'success', open: false },
  { id: 'live', label: 'Live', icon: 'rocket', tone: 'success', open: false },
  { id: 'dropped', label: 'Dropped', icon: 'x-circle', tone: 'danger', open: false },
  { id: 'superseded', label: 'Superseded', icon: 'redo', tone: '', open: false },
  // a brief with no record in the builds store: launched outside it (or before it existed), so nobody can say where it is
  { id: 'untracked', label: 'Not tracked', icon: 'help', tone: '', open: false },
];
const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));
const STATUS_ALIASES = {
  'built-awaiting-merge': 'built', awaiting: 'built', complete: 'merged', completed: 'merged', done: 'merged', shipped: 'live', deployed: 'live',
  pending: 'queued', waiting: 'paused', blocked: 'paused', failed: 'paused', stopped: 'paused', held: 'paused', archived: 'dropped', removed: 'dropped',
  cancelled: 'dropped', canceled: 'dropped', parked: 'idea', 'in-progress': 'running', 'in progress': 'running',
};
export function normStatus(s) { const k = String(s ?? '').trim().toLowerCase(); return STATUS_ALIASES[k] ?? (STATUS_BY_ID.has(k) ? k : k ? k : 'idea'); }
export function statusInfo(id) { const k = normStatus(id); return STATUS_BY_ID.get(k) ?? { id: k, label: k.replace(/-/g, ' '), icon: 'info', tone: '', open: true }; }
export const isOpen = (r) => statusInfo(r?.status).open;

export const KINDS = [
  { id: 'build', label: 'Build', icon: 'hammer' }, { id: 'addendum', label: 'Addendum', icon: 'plus' }, { id: 'bug', label: 'Bug', icon: 'alert' },
  { id: 'plan', label: 'Plan', icon: 'layers' }, { id: 'follow-up', label: 'Follow-up', icon: 'clock' }, { id: 'setting', label: 'Setting', icon: 'settings' },
  { id: 'crew', label: 'Crew', icon: 'user' },
];
export const KIND_IDS = KINDS.map((k) => k.id);
export const kindInfo = (id) => KINDS.find((k) => k.id === id) ?? { id: String(id || 'build'), label: String(id || 'build'), icon: 'info' };
export const SOURCES = ['voice', 'chat', 'console', 'code', 'memory', 'unknown'];

/* ------------------------------------------------------------------ small helpers */

const str = (v, cap = 4000) => (typeof v === 'string' ? v.slice(0, cap) : v == null ? '' : String(v).slice(0, cap));
const iso = (v) => { const s = str(v, 40); if (!s) return ''; const t = Date.parse(s); return Number.isNaN(t) ? '' : s; };
export const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const prNum = (pr) => { const m = String(pr ?? '').match(/(\d+)/); return m ? Number(m[1]) : null; };
export const prUrl = (pr) => (prNum(pr) ? `https://github.com/${REPO}/pull/${prNum(pr)}` : '');
/** Text two records are compared by when deduping: words only, lower case. */
export const sameText = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const firstSentence = (s, cap = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').replace(/^["“]|["”]$/g, '').trim();
  if (!t) return '';
  const cut = t.match(/^(.{12,}?[.!?])(\s|$)/)?.[1] ?? t;
  return cut.length > cap ? `${cut.slice(0, cap - 1).trimEnd()}…` : cut;
};
const sourceOf = (s) => { const k = String(s ?? '').toLowerCase(); return SOURCES.find((x) => k.includes(x)) ?? (k.includes('claude.ai') || k.includes('text') ? 'chat' : k ? 'unknown' : ''); };

/** A request with every field in its place (unknown fields kept). */
export function normRequest(r, now = '') {
  const o = r && typeof r === 'object' ? r : {};
  const where = (Array.isArray(o.where) ? o.where : []).filter((w) => w && w.kind && w.id).map((w) => ({ ...w, kind: str(w.kind, 20), id: str(w.id, 200) }));
  return {
    ...o,
    $axf: SCHEMA,
    id: str(o.id, 200),
    kind: KIND_IDS.includes(o.kind) ? o.kind : 'build',
    title: str(o.title, 300).trim() || firstSentence(o.said) || str(o.id, 120),
    said: str(o.said, 20000),
    verbatim: o.verbatim === true || (o.verbatim !== false && !!str(o.said)),
    at: iso(o.at),
    source: sourceOf(o.source) || 'unknown',
    capturedBy: str(o.capturedBy, 120),
    where,
    status: normStatus(o.status),
    history: (Array.isArray(o.history) ? o.history : []).filter((h) => h && h.at).map((h) => ({ ...h, at: str(h.at, 40), text: str(h.text, 600) })),
    updatedAt: iso(o.updatedAt) || iso(o.at) || now,
  };
}

/* ------------------------------------------------------------------ builds store (builds@1) → requests */

/** Store build status → request status. */
export function buildStatus(b) {
  if (b?.deleted) return 'dropped';
  return ({ pending: 'queued', running: 'running', waiting: 'paused', blocked: 'paused', failed: 'paused', built: 'built', complete: 'merged', archived: 'dropped' })[b?.status] ?? 'queued';
}
const FINISHED = new Set(['built', 'complete', 'archived']);

/**
 * Place in line per profile: the profile's unfinished builds in their queue order (order[profile]). {profile: Map(id →
 * {list, position, of})}.
 */
export function queuePositions(builds) {
  const by = new Map();
  for (const b of builds ?? []) {
    if (!b || b.deleted || b.hidden || FINISHED.has(b.status)) continue;
    for (const p of b.profiles ?? []) { if (!by.has(p)) by.set(p, []); by.get(p).push(b); }
  }
  const out = new Map();
  for (const [p, list] of by) {
    list.sort((a, c) => (Number(a.order?.[p]) || 1e9) - (Number(c.order?.[p]) || 1e9) || String(a.createdAt).localeCompare(String(c.createdAt)));
    list.forEach((b, i) => { if (!out.has(b.id)) out.set(b.id, { list: p, position: i + 1, of: list.length }); });
  }
  return out;
}

/** agent-slots@1 state → Map(build id → {state, position?, agent?, session?}). A headless session is `axf-<build>--<agent>`. */
export function slotsByBuild(state) {
  const out = new Map();
  const agentOf = (s) => { const m = String(s ?? '').match(/--([a-z0-9-]+)$/i); return m ? m[1] : ''; };
  for (const r of state?.running ?? []) if (r?.name) out.set(r.name, { state: 'running', agent: r.agent || agentOf(r.session), session: str(r.session, 120), since: str(r.startedAt, 40) });
  const q = [...(state?.queue ?? [])].filter((x) => x && x.state !== 'done');
  q.forEach((x, i) => { if (x?.name && !out.has(x.name)) out.set(x.name, { state: 'waiting', position: Number(x.position) || i + 1, of: q.length, agent: x.agent || agentOf(x.session), since: str(x.enqueuedAt, 40) }); });
  return out;
}

/** The agent a build was handed to, from its notes ("Assigned: Ping Paulie", "agent Snap Sully"). */
export function agentFromNotes(notes) {
  for (const n of [...(notes ?? [])].reverse()) {
    const m = String(n?.text ?? '').match(/\b(?:Assigned(?: agent)?|Booked on|agent)\s*[:=]?\s*((?:[A-Z][a-z']+)(?:\s+(?:the\s+)?[A-Z][a-z']+)?)/);
    if (m) return m[1].trim();
  }
  return '';
}

/** change-log@1 entries → Map(build id → {usd, estimated}): actual cost when the hook counted it, else the estimate. */
export function costsByBuild(entries) {
  const out = new Map();
  for (const e of entries ?? []) {
    const id = e?.buildRef?.id || (typeof e?.buildRef === 'string' ? String(e.buildRef).replace(/^[a-z]+:/, '') : '');
    if (!id) continue;
    const actual = Number(e.actual?.costUsd), est = Number(e.estimate?.costUsd);
    const usd = Number.isFinite(actual) && actual > 0 ? actual : Number.isFinite(est) ? est : 0;
    if (!usd) continue;
    const c = out.get(id) ?? { usd: 0, estimated: false, sessions: 0 };
    c.usd += usd; c.sessions += 1; if (!(actual > 0)) c.estimated = true;
    out.set(id, c);
  }
  return out;
}

/** A build's timeline: asked, notes, steps done, built, merged (oldest first). */
export function buildHistory(b) {
  const h = [];
  if (b.origin?.at || b.createdAt) h.push({ at: iso(b.origin?.at) || b.createdAt, text: 'Asked', status: 'queued' });
  if (b.createdAt) h.push({ at: b.createdAt, text: 'Added to the orchestrator' });
  for (const s of b.steps ?? []) if (s.done && s.doneAt) h.push({ at: s.doneAt, text: `${s.id} done: ${firstSentence(s.title || s.text, 80)}` });
  for (const n of b.notes ?? []) if (n?.at) h.push({ at: n.at, text: firstSentence(n.text, 160) });
  for (const [i, a] of (b.origin?.addenda ?? []).entries()) if (a?.at) h.push({ at: iso(a.at) || b.createdAt, text: `Addendum ${i + 1}` });
  if (b.builtAt) h.push({ at: b.builtAt, text: 'Built', status: 'built' });
  if (b.mergedAt) h.push({ at: b.mergedAt, text: `Merged${b.pr ? ` (${b.pr})` : ''}`, status: 'merged' });
  return h.filter((x) => x.at).sort((a, c) => String(a.at).localeCompare(String(c.at)));
}

/** A build and its addenda as requests. ctx = {queue, slots, costs} from the helpers above. */
export function fromBuild(b, ctx = {}) {
  if (!b?.id) return [];
  const o = b.origin ?? {};
  const slot = ctx.slots?.get(b.id) ?? null;
  const cost = ctx.costs?.get(b.id) ?? null;
  const steps = (b.steps ?? []).filter((s) => !s.skip);
  const next = steps.find((s) => !s.done);
  const profile = (b.profiles ?? [])[0] ?? '';
  let status = buildStatus(b);
  if (slot?.state === 'running' && (status === 'queued' || status === 'paused')) status = 'running'; // a live session beats a stale record
  const common = {
    status, profile, branch: str(b.branch, 200), pr: str(b.pr, 40), agent: slot?.agent || agentFromNotes(b.notes),
    queue: FINISHED.has(b.status) ? null : ctx.queue?.get(b.id) ?? null, slot,
    costUsd: cost ? Math.round(cost.usd * 100) / 100 : null, costEstimated: cost ? cost.estimated : null,
    steps: { done: steps.filter((s) => s.done).length, total: steps.length, ...(next ? { next: next.id, nextText: firstSentence(next.title || next.text, 120) } : {}) },
  };
  const main = {
    id: `build:${b.id}`, kind: 'build', title: b.title, said: str(o.said), verbatim: o.verbatim !== false && !!o.said, at: iso(o.at) || b.createdAt,
    source: o.source || b.source, capturedBy: o.by && o.by !== 'Brett' ? o.by : str(o.session, 120) || (b.source === 'console' ? 'console' : ''),
    where: [{ kind: 'build', id: b.id, label: b.title }, ...(next ? [{ kind: 'step', id: `${b.id}#${next.id}`, label: `${next.id} · ${next.model}` }] : [])],
    history: buildHistory(b), updatedAt: b.updatedAt, category: str(b.category, 60), ...common,
  };
  const out = [main];
  (o.addenda ?? []).forEach((a, i) => {
    if (!a?.said) return;
    out.push({
      id: `build:${b.id}:addendum-${i + 1}`, kind: 'addendum', parent: main.id, title: `${b.title}: addendum ${i + 1}`, said: a.said, verbatim: true,
      at: iso(a.at) || main.at, source: a.source || o.source, capturedBy: a.by && a.by !== 'Brett' ? a.by : '',
      where: [{ kind: 'build', id: b.id, label: b.title }], history: [{ at: iso(a.at) || main.at, text: 'Asked (addendum)' }], updatedAt: b.updatedAt, ...common,
    });
  });
  return out;
}

/* ------------------------------------------------------------------ build briefs (.brief.md) */

const QUOTE_RE = /"([^"]{3,})"|“([^”]{3,})”/g;
const quotesIn = (text) => { const q = []; for (const m of String(text ?? '').matchAll(QUOTE_RE)) q.push(m[1] ?? m[2]); return q; };
const META_RE = /\((?:Brett,?\s*)?([^)]*)\)/;
function metaOf(heading) {
  const m = String(heading).match(META_RE);
  const inner = m ? m[1] : '';
  const date = inner.match(/([A-Z][a-z]{2}\s+\d{1,2}(?:,?\s*\d{4})?)/)?.[1] ?? '';
  return { source: sourceOf(inner), date };
}
const dateIso = (s, year = 2026) => { if (!s) return ''; const t = Date.parse(/\d{4}/.test(s) ? s : `${s} ${year}`); return Number.isNaN(t) ? '' : new Date(t).toISOString(); };

/**
 * One build brief → {build, title, said, at, source, addenda: [{n, heading, said, at, source, overrides}]}. The build id
 * comes from the first heading ("# Build: <id> (…)") or the folder name. "What Brett said" / "Brett said" blocks are his
 * words (the quoted parts when quoted, else the block); "Addendum N" / "ADDENDUM N" blocks are later asks. An addendum
 * that says OVERRIDES / SUPERSEDES / "never mind" replaces what came before it.
 */
export function parseBrief(text, folder = '') {
  const lines = String(text ?? '').split('\n');
  const head = lines.find((l) => /^#\s/.test(l)) ?? '';
  // the id only when the heading names one ("# Build: <id> (…)" or a `backticked-id`), else the folder's name
  const build = (head.match(/^#\s*(?:Build|Fix|Rebuild|Hotfix):\s*`?([a-z0-9][a-z0-9-]{1,79})`?(?:\s|$|\()/)?.[1] ?? head.match(/`([a-z0-9][a-z0-9-]{2,79})`/)?.[1] ?? '').toLowerCase() || slug(folder);
  const title = head.replace(/^#\s*/, '').replace(/^(?:Build|Fix|Rebuild):\s*/i, '').trim();
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    if (/^##\s/.test(l)) { cur = { heading: l.replace(/^##\s*/, '').trim(), body: [] }; blocks.push(cur); continue; }
    if (cur) cur.body.push(l);
  }
  const wordsOf = (b) => { const body = b.body.join('\n').trim(); const q = quotesIn(body); return q.length ? q.join(' … ') : body.split('\n').filter((x) => !/^\s*(Source|At|Session|Link):/i.test(x)).map((x) => x.replace(/^>\s?/, '')).join('\n').trim(); };
  const saidBlock = blocks.find((b) => /brett said|what brett said|brett's words/i.test(b.heading));
  const meta = saidBlock ? metaOf(saidBlock.heading) : { source: '', date: '' };
  let said = saidBlock ? wordsOf(saidBlock) : '';
  if (!said) { // older briefs: "Brett, Nov 3 2026 (voice): "…"" or a "Requested by Brett" line with a quote
    const line = lines.find((l) => /Brett\b[^"“]{0,60}["“]/.test(l) && /said|voice|chat|Brett,|Brett:/i.test(l));
    if (line) said = quotesIn(line).join(' … ');
  }
  const addenda = [];
  for (const b of blocks) {
    const m = b.heading.match(/^addendum\s*(\d+)?/i);
    if (!m) continue;
    const words = wordsOf(b);
    if (!words) continue;
    const am = metaOf(b.heading);
    const body = b.body.join('\n');
    const reverses = /never ?mind|forget (?:it|that)|scrap (?:it|that)|cancel (?:it|that)/i.test(`${words}\n${body}`);
    addenda.push({ n: Number(m[1]) || addenda.length + 1, heading: b.heading, said: words, at: dateIso(am.date), source: am.source, reverses, overrides: reverses || /overrides|supersedes|replaces/i.test(b.heading) });
  }
  return { build, title, said, at: dateIso(meta.date), source: meta.source, addenda };
}

/** Brief addenda the store doesn't have yet, as requests (deduped against the build's own addenda). */
export function fromBrief(p, buildReq = null) {
  if (!p?.build) return [];
  const parentId = buildReq?.id ?? `build:${p.build}`;
  const have = new Set((buildReq?._addenda ?? []).map(sameText));
  return p.addenda.filter((a) => !have.has(sameText(a.said))).map((a) => ({
    id: `build:${p.build}:brief-addendum-${a.n}`, kind: 'addendum', parent: parentId, title: `${buildReq?.title || p.title || p.build}: addendum ${a.n}`,
    said: a.said, verbatim: true, at: a.at || buildReq?.at || '', source: a.source, capturedBy: 'brief',
    where: [{ kind: 'build', id: p.build, label: buildReq?.title || p.title }, { kind: 'follow-up', id: `brief:${p.build}`, label: '.brief.md', file: `${p.build}/.brief.md` }],
    status: buildReq?.status ?? 'queued', ...(a.overrides ? { _overrides: a.reverses ? 'reverses' : 'amends' } : {}),
    ...(buildReq ? { profile: buildReq.profile, agent: buildReq.agent, pr: buildReq.pr, branch: buildReq.branch, queue: buildReq.queue, slot: buildReq.slot } : {}),
    history: [{ at: a.at || buildReq?.at || '', text: `Asked (${a.heading})` }],
  }));
}

/* ------------------------------------------------------------------ Plan Studio plans, bugs */

export function fromPlan(p) {
  if (!p?.id) return null;
  const built = p.build || p.buildId || p.turnedInto?.id || '';
  const status = /done|complete|built/.test(p.status) ? 'merged' : /drop|archiv|reject/.test(p.status) ? 'dropped' : built ? 'queued' : p.status === 'parked' ? 'idea' : 'planned';
  return {
    id: `plan:${p.id}`, kind: 'plan', title: p.title, said: str(p.said || p.origin?.said), verbatim: !!(p.said || p.origin?.said), at: iso(p.createdAt),
    source: p.origin?.source || (String(p.createdBy).match(/voice|chat|console/i)?.[0] ?? ''), capturedBy: str(p.createdBy, 120), category: str(p.category, 60),
    where: [{ kind: 'plan', id: p.id, label: p.title }, ...(built ? [{ kind: 'build', id: built }] : [])], status,
    history: [{ at: iso(p.createdAt), text: 'Planned' }, ...(p.updatedAt && p.updatedAt !== p.createdAt ? [{ at: p.updatedAt, text: `Plan updated (${p.status})` }] : [])],
    updatedAt: iso(p.updatedAt) || iso(p.createdAt), summary: firstSentence(p.summary, 240),
  };
}

/** A bug@1 record (bugs-board) → a request. */
export function fromBug(g) {
  if (!g?.id) return null;
  const st = String(g.status ?? '').toLowerCase();
  const status = /fixed|closed|done|resolved/.test(st) ? 'merged' : /wont|drop|invalid|dup/.test(st) ? 'dropped' : /fixing|progress|running/.test(st) ? 'running' : 'queued';
  return {
    id: `bug:${g.id}`, kind: 'bug', title: g.title, said: str(g.said || g.quote || g.description), verbatim: !!(g.said || g.quote), at: iso(g.createdAt || g.at),
    source: g.source, capturedBy: str(g.by || g.reporter, 120), app: str(g.app, 60), where: [{ kind: 'bug', id: g.id, label: g.title }, ...(g.build ? [{ kind: 'build', id: g.build }] : [])],
    status, pr: str(g.pr, 40), history: [{ at: iso(g.createdAt || g.at), text: 'Reported' }], updatedAt: iso(g.updatedAt) || iso(g.createdAt),
  };
}

/* ------------------------------------------------------------------ memory files (follow-ups, vision, naming) */

/** A section's title without its bookkeeping ("Update 2 (Brett, …) - SUPERSEDES …" → its first point). */
function sectionTitle(heading, body) {
  let t = heading.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*[-–:]?\s*(SUPERSEDES|OVERRIDES)\b.*$/i, '').replace(/^(?:update|decision)\s*\d*\s*[-–:]?\s*/i, '').replace(/[-:–]\s*$/, '').trim();
  if (t.length < 4) {
    const point = body.find((l) => /^-\s+\S/.test(l)) ?? body.find((l) => l.trim()) ?? '';
    t = firstSentence(point.replace(/^-\s+/, '').replace(/\*\*/g, ''), 90) || heading;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
/**
 * A memory file → requests. Each "## Section (Brett, date, source)" is one request (its "Brett said (verbatim): "…""
 * quotes, else every quote in it); in a section of bold bullets ("- **Title** (Brett, voice: "…"): …") each bullet is
 * its own request. A section marked SUPERSEDES / "supersedes … above" replaces the section(s) before it.
 */
export function parseMemory(text, file, kind = 'follow-up') {
  const out = [];
  const sections = [];
  let cur = null;
  for (const l of String(text ?? '').split('\n')) {
    if (/^#{2,3}\s/.test(l)) { cur = { heading: l.replace(/^#{2,3}\s*/, '').trim(), level: l.startsWith('###') ? 3 : 2, body: [] }; sections.push(cur); continue; }
    if (cur) cur.body.push(l);
  }
  const base = slug(file.replace(/\.md$/, ''));
  let lastDate = '';
  const prev = [];
  for (const s of sections) {
    const meta = metaOf(s.heading);
    if (meta.date) lastDate = meta.date;
    const at = dateIso(meta.date || lastDate);
    const body = s.body.join('\n');
    const queued = /queued|after the (feature )?freeze/i.test(s.heading);
    const bullets = s.body.filter((l) => /^-\s+\*\*[^*]+\*\*/.test(l));
    // a list of separate asks (each bullet carries "(Brett, …)") splits into one request per bullet
    const items = bullets.length >= 2 && bullets.filter((l) => /\(Brett\b/.test(l)).length >= 2
      ? bullets.map((l) => ({ title: l.match(/\*\*([^*]+)\*\*/)[1].trim(), said: quotesIn(l).join(' … '), text: l }))
      : [{ title: sectionTitle(s.heading, s.body), said: (body.match(/Brett said \(verbatim\):\s*(.+)/i)?.[1] ? quotesIn(body.match(/Brett said \(verbatim\):\s*(.+)/i)[1]) : quotesIn(body)).join(' … '), text: body }];
    const made = [];
    for (const it of items) {
      if (!it.said && !/Brett/i.test(s.heading)) continue; // a section that isn't an ask (lists of builds, notes)
      const id = `memory:${base}:${slug(it.title).slice(0, 60)}`;
      const r = {
        id, kind, title: it.title.slice(0, 200), said: it.said, verbatim: !!it.said, at, source: meta.source || sourceOf(it.text), capturedBy: 'memory',
        where: [{ kind: 'memory', id: `${file}#${slug(s.heading).slice(0, 60)}`, label: `${file} · ${s.heading.slice(0, 80)}`, file }],
        status: queued || /not built yet|pending brett|build after|after the freeze/i.test(body) ? 'planned' : kind === 'plan' ? 'idea' : /decision|agreed|update/i.test(s.heading) ? 'live' : 'planned',
        history: at ? [{ at, text: `Written to ${file}` }] : [],
      };
      made.push(r);
      out.push(r);
    }
    const sup = `${s.heading}\n${body}`.match(/supersedes the (\w+) (?:sections?|ideas?)? ?above|supersedes[^.\n]*above|SUPERSEDES|\(supersedes/i);
    if (sup && made.length) {
      const n = WORDS[String(sup[1] ?? '').toLowerCase()] ?? Number(sup[1]) ?? 1;
      const victims = prev.slice(-(Number.isFinite(n) && n > 0 ? n : 1)).flat();
      for (const v of victims) if (v.status !== 'superseded') { v.status = 'superseded'; v.supersededBy = made[0].id; }
    }
    if (made.length) prev.push(made);
  }
  return out;
}

/* ------------------------------------------------------------------ THREADS.md, build-asks@1 */

/**
 * THREADS.md table rows → {build, quote, title} for each row that names a build (`id` in backticks) and carries Brett's
 * words ("Brett Nov 3 voice: "…""). Used to fill in words a build record lacks, and as follow-ups when no build matches.
 */
export function parseThreads(text) {
  const out = [];
  for (const l of String(text ?? '').split('\n')) {
    if (!/^\|\s/.test(l) || /^\|\s*Thread\s*\|/.test(l) || /^\|\s*-/.test(l)) continue;
    const cell = l.split('|')[1] ?? '';
    const build = cell.match(/`([a-z0-9][a-z0-9-]{2,79})`/)?.[1] ?? '';
    const said = cell.match(/Brett[^:]{0,40}:\s*((?:"[^"]+"[\s.,+]*(?:addendum\s*)?)+)/i)?.[1];
    const state = (l.split('|')[2] ?? '').trim();
    if (!said) continue;
    out.push({ build, said: quotesIn(said).join(' … '), title: cell.replace(/\s*\(.*$/, '').trim().slice(0, 200), state, date: cell.match(/Brett\s+([A-Z][a-z]{2}\s+\d{1,2})/)?.[1] ?? '' });
  }
  return out;
}

const ASK_STATUS = { built: 'merged', 'in-progress': 'running', pending: 'queued', planned: 'planned', held: 'paused', removed: 'dropped', 'waiting-push': 'built', 'waiting-pull': 'built', 'waiting-approve': 'built', 'waiting-deploy': 'merged' };
/** An old build-asks@1 ask → its build id when its sources name one. */
export function askBuild(a) { for (const s of a?.sources ?? []) { const m = String(s).match(/^(?:orchestrator|pending|hub-pending):\s*([a-z0-9][a-z0-9-]*)/); if (m) return m[1]; } return ''; }
export function fromAsk(a) {
  if (!a?.id) return null;
  return {
    id: `ask:${a.id}`, kind: 'build', title: a.title, said: str(a.quote), verbatim: !!a.quote, at: iso(a.askedAt), source: (a.sources ?? []).some((s) => /^chat:/.test(s)) ? 'chat' : 'unknown',
    capturedBy: 'build-asks@1', app: str(a.app, 60), plugin: a.plugin || '', profile: str(a.profile, 40), status: ASK_STATUS[a.status] ?? normStatus(a.status), pr: a.pr ? `#${a.pr}` : '', branch: str(a.branch, 200),
    costUsd: a.costUsd ?? null, costEstimated: a.costEstimated ?? null, summary: str(a.plain, 600),
    where: [{ kind: 'ask', id: a.id, label: 'Build Breaker (asks list)' }], history: [{ at: iso(a.askedAt), text: 'Asked' }], updatedAt: iso(a.updatedAt) || iso(a.askedAt),
  };
}

/* ------------------------------------------------------------------ the ledger (request-ledger@1) */

export const emptyLedger = () => ({ $axf: LEDGER, updatedAt: '', records: {} });
export function normLedger(raw) {
  const l = raw && typeof raw === 'object' ? raw : {};
  return { ...l, $axf: LEDGER, updatedAt: str(l.updatedAt, 40), records: l.records && typeof l.records === 'object' && !Array.isArray(l.records) ? l.records : {} };
}

/**
 * Everything the sources give, deduped and joined, with the ledger applied. src = {builds, slots, costs, briefs:
 * [{folder, text}], plans, bugs, memory: [{file, text, kind}], threads, asks}. Returns sorted requests (newest first).
 */
export function assemble(src = {}, ledger = emptyLedger(), now = new Date().toISOString()) {
  const builds = (src.builds ?? []).filter((b) => b && !b.deleted);
  const ctx = { queue: queuePositions(builds), slots: slotsByBuild(src.slots), costs: costsByBuild(src.costs) };
  const byId = new Map();
  const put = (r) => { if (r?.id && !byId.has(r.id)) byId.set(r.id, r); };
  const buildIds = new Set(builds.map((b) => b.id));
  const byBranch = new Map(builds.filter((b) => b.branch).map((b) => [b.branch, b.id]));
  for (const b of builds) {
    const rs = fromBuild(b, ctx);
    rs[0]._addenda = (b.origin?.addenda ?? []).map((a) => a.said);
    rs.forEach(put);
  }
  // briefs: words a build record lacks + addenda only the brief has
  for (const { folder, text } of src.briefs ?? []) {
    const p = parseBrief(text, folder);
    let main = byId.get(`build:${p.build}`) ?? byId.get(`build:${slug(folder)}`) ?? byId.get(`build:${byBranch.get(`claude/${folder}`) ?? ''}`);
    if (main && p.build !== main.id.slice(6)) p.build = main.id.slice(6);
    if (main && !main.said && p.said) { main.said = p.said; main.verbatim = true; main.source = main.source || p.source; main.where.push({ kind: 'follow-up', id: `brief:${p.build}`, label: '.brief.md', file: `${folder}/.brief.md` }); }
    if (!main && p.said) { // a brief with no build record (launched outside the store)
      main = { id: `build:${p.build}`, kind: 'build', title: p.title || p.build, said: p.said, verbatim: true, at: p.at, source: p.source, capturedBy: 'brief', status: 'untracked', where: [{ kind: 'follow-up', id: `brief:${p.build}`, label: '.brief.md', file: `${folder}/.brief.md` }], history: [{ at: p.at, text: 'Brief written' }] };
      put(main);
    }
    for (const a of fromBrief(p, main)) {
      put(a);
      // "never mind" reverses what he first asked (the build carries on the new way); "overrides …" changes part of it
      if (a._overrides === 'reverses' && main) main.reversedBy = a.id;
      else if (a._overrides && main) main.amendedBy = [...(main.amendedBy ?? []), a.id];
    }
  }
  // THREADS: fill words, else a follow-up
  for (const t of src.threads ?? []) {
    const main = t.build && byId.get(`build:${t.build}`);
    if (main) { if (!main.said) { main.said = t.said; main.verbatim = true; main.where.push({ kind: 'thread', id: t.build, label: 'THREADS.md' }); } continue; }
    put({ id: `thread:${t.build || slug(t.title)}`, kind: 'follow-up', title: t.title, said: t.said, verbatim: true, at: dateIso(t.date), source: 'voice', capturedBy: 'THREADS.md', status: /done|merged/i.test(t.state) ? 'merged' : /queued/i.test(t.state) ? 'queued' : 'running', where: [{ kind: 'thread', id: t.build || slug(t.title), label: 'THREADS.md' }], history: [] });
  }
  for (const p of src.plans ?? []) put(fromPlan(p));
  for (const g of src.bugs ?? []) put(fromBug(g));
  for (const m of src.memory ?? []) for (const r of parseMemory(m.text, m.file, m.kind)) put(r);
  // old asks list: joins its build when it names one, else its own row
  for (const a of src.asks ?? []) {
    const bid = askBuild(a);
    const main = bid && buildIds.has(bid) ? byId.get(`build:${bid}`) : null;
    if (main) { if (!main.said && a.quote) { main.said = a.quote; main.verbatim = true; } main.where.push({ kind: 'ask', id: a.id, label: 'Build Breaker (asks list)' }); main.app = main.app || a.app; main.summary = main.summary || a.plain; continue; }
    put(fromAsk(a));
  }
  // dedupe: same words → the record with the richer home keeps them (build > addendum > plan > memory > ask)
  const RANK = { build: 0, addendum: 1, bug: 2, plan: 3, setting: 4, crew: 5, 'follow-up': 6 };
  const seen = new Map();
  for (const r of [...byId.values()].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) || (a.id.startsWith('ask:') ? 1 : 0) - (b.id.startsWith('ask:') ? 1 : 0))) {
    const k = sameText(r.said);
    if (k.length < 24) continue;
    const keep = seen.get(k);
    if (keep && keep !== r) { keep.where.push(...r.where.filter((w) => !keep.where.some((x) => x.kind === w.kind && x.id === w.id))); keep.alsoIn = [...(keep.alsoIn ?? []), r.id]; byId.delete(r.id); }
    else seen.set(k, r);
  }
  // the ledger: hand-captured records + patches
  const L = normLedger(ledger);
  for (const [id, rec] of Object.entries(L.records)) {
    const base = byId.get(id);
    if (base) byId.set(id, applyPatch(base, rec));
    else if (rec.kind && (rec.said || rec.title)) byId.set(id, applyPatch({ id, kind: rec.kind, said: rec.said ?? '', status: normStatus(rec.status), where: [], history: [], captured: true }, rec));
  }
  // superseded wins over a derived status; the replacement points back
  for (const r of byId.values()) if (r.supersededBy) { r.status = 'superseded'; const by = byId.get(r.supersededBy); if (by) by.supersedes = [...new Set([...(by.supersedes ?? []), r.id])]; }
  // agents by their crew name, with the id the Breakroom and the terminal know them by
  const roster = (src.roster ?? []).filter((a) => a?.id);
  const who = (v) => { const k = String(v ?? '').trim().toLowerCase(); return k ? roster.find((a) => a.id === k || String(a.name).toLowerCase() === k || String(a.name).toLowerCase().split(/\s+/).includes(k)) : null; };
  for (const r of byId.values()) if (r.agent) { const a = who(r.agent); if (a) { r.agentId = a.id; r.agent = a.name; } }
  const out = [...byId.values()].map((r) => { const { _addenda, _overrides, ...rest } = r; return normRequest(rest, now); }); // eslint-disable-line no-unused-vars
  return sortRequests(out, 'newest');
}

/** A ledger patch on a derived request: status overrides, links, notes and history are added, never lost. */
export function applyPatch(base, rec) {
  const { history = [], notes = [], links = [], ...fields } = rec ?? {};
  const out = { ...base };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '' && !['id', 'kind', 'said', 'firstSeen', 'lastStatus', 'lastQueue'].includes(k)) out[k] = v;
  // a hand-set status sticks only when no source can know it (dropped, superseded, live); otherwise live progress wins
  if (fields.status) out.status = ['dropped', 'superseded', 'live'].includes(normStatus(fields.status)) ? normStatus(fields.status) : base.status;
  out.where = [...(base.where ?? []), ...links.filter((w) => w?.kind && w?.id && !(base.where ?? []).some((x) => x.kind === w.kind && x.id === w.id))];
  out.history = [...(base.history ?? []), ...history].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (notes.length) out.notes = notes;
  if (rec.firstSeen) out.firstSeen = rec.firstSeen;
  return out;
}

/**
 * What changed since the ledger last looked: a history line per request whose status or place in line moved, and the
 * first time each request was seen. Returns {ledger, changed: [ids]} (the ledger is a new object).
 */
export function recordChanges(requests, ledger, now = new Date().toISOString()) {
  const L = normLedger(ledger);
  const records = { ...L.records };
  const changed = [];
  for (const r of requests) {
    const rec = { ...(records[r.id] ?? {}) };
    const q = r.queue ? `${r.queue.list}#${r.queue.position}` : '';
    let touched = false;
    if (!rec.firstSeen) { rec.firstSeen = now; touched = true; }
    if (rec.lastStatus && rec.lastStatus !== r.status) { rec.history = [...(rec.history ?? []), { at: now, text: `${statusInfo(rec.lastStatus).label} → ${statusInfo(r.status).label}`, status: r.status }]; changed.push(r.id); touched = true; }
    if (rec.lastStatus !== r.status) { rec.lastStatus = r.status; touched = true; }
    if ((rec.lastQueue ?? '') !== q) { if (rec.lastQueue && q) { rec.history = [...(rec.history ?? []), { at: now, text: `Moved in line: ${rec.lastQueue.split('#')[1]} → ${r.queue.position}` }]; if (!changed.includes(r.id)) changed.push(r.id); } rec.lastQueue = q; touched = true; }
    if (touched) records[r.id] = rec;
  }
  return { ledger: { ...L, records, updatedAt: changed.length || Object.keys(records).length !== Object.keys(L.records).length ? now : L.updatedAt }, changed };
}

/** Change a request through the ledger (status, title, agent, supersededBy, note). Unknown ids become captured records. */
export function patchLedger(ledger, id, patch, { by = '', now = new Date().toISOString() } = {}) {
  const L = normLedger(ledger);
  const rec = { ...(L.records[id] ?? {}) };
  const p = { ...patch };
  if (p.status) { p.status = normStatus(p.status); rec.history = [...(rec.history ?? []), { at: now, text: `Set to ${statusInfo(p.status).label}${by ? ` by ${by}` : ''}`, status: p.status }]; }
  if (p.supersededBy) rec.history = [...(rec.history ?? []), { at: now, text: `Superseded by ${p.supersededBy}` }];
  if (p.note) { rec.notes = [...(rec.notes ?? []), { at: now, text: str(p.note, 2000), by }]; delete p.note; }
  if (p.link) { rec.links = [...(rec.links ?? []).filter((w) => !(w.kind === p.link.kind && w.id === p.link.id)), { kind: str(p.link.kind, 20), id: str(p.link.id, 200), ...(p.link.label ? { label: str(p.link.label, 200) } : {}) }]; rec.history = [...(rec.history ?? []), { at: now, text: `Linked ${p.link.kind} ${p.link.id}` }]; delete p.link; }
  for (const [k, v] of Object.entries(p)) if (v !== undefined) rec[k] = v;
  rec.updatedAt = now;
  return { ...L, updatedAt: now, records: { ...L.records, [id]: rec } };
}

/** A new hand-captured request (bug, setting, crew change, follow-up…), ready for patchLedger. */
export function captureRecord(input, now = new Date().toISOString()) {
  const kind = KIND_IDS.includes(input.kind) ? input.kind : 'follow-up';
  const said = str(input.said, 20000);
  const title = str(input.title, 300).trim() || firstSentence(said);
  if (!said && !title) throw new Error('a request needs his words (said) or a title');
  const id = str(input.id, 200) || `${kind}:${slug(title).slice(0, 50)}-${now.replace(/\D/g, '').slice(2, 12)}`;
  return { id, record: { kind, title, said, verbatim: input.verbatim !== false && !!said, at: iso(input.at) || now, source: sourceOf(input.source) || 'unknown', capturedBy: str(input.by, 120), status: normStatus(input.status || 'queued'), ...(input.parent ? { parent: str(input.parent, 200) } : {}), links: input.link ? [input.link] : [], history: [{ at: iso(input.at) || now, text: 'Asked' }] } };
}

/* ------------------------------------------------------------------ view helpers */

const ts = (r) => { const t = Date.parse(r?.at || r?.updatedAt || ''); return Number.isNaN(t) ? 0 : t; };
export const requestTime = ts;
export const searchText = (r) => [r.title, r.said, r.summary, r.id, r.agent, r.branch, r.pr, r.profile, r.app, r.category, ...(r.where ?? []).map((w) => `${w.kind} ${w.id} ${w.label ?? ''}`)].filter(Boolean).join(' ').toLowerCase();

/** f = {q, statuses, kinds, profiles, apps, open: true|false|undefined, range: '7'|'30'|'all', from, to}. */
export function filterRequests(rs, f = {}, now = Date.now()) {
  const words = String(f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const st = new Set((f.statuses ?? []).map(normStatus)), kd = new Set(f.kinds ?? []), pf = new Set(f.profiles ?? []), ap = new Set(f.apps ?? []);
  const days = { 7: 7, 30: 30 }[String(f.range ?? 'all')] ?? 0;
  const since = days ? now - days * 86400000 : -Infinity;
  const from = f.from ? Date.parse(`${f.from}T00:00:00`) : -Infinity, to = f.to ? Date.parse(`${f.to}T23:59:59.999`) : Infinity;
  return rs.filter((r) => {
    if (st.size && !st.has(normStatus(r.status))) return false;
    if (kd.size && !kd.has(r.kind)) return false;
    if (pf.size && !pf.has(r.profile || 'none')) return false;
    if (ap.size && !ap.has(r.app || 'none')) return false;
    if (f.open === true && !isOpen(r)) return false;
    if (f.open === false && isOpen(r)) return false;
    const t = ts(r);
    if (t && (t < since || t < from || t > to)) return false;
    if (!t && (days || f.from || f.to)) return false;
    if (words.length) { const s = searchText(r); if (!words.every((w) => s.includes(w))) return false; }
    return true;
  });
}

export const SORTS = [
  { id: 'newest', label: 'Newest first' }, { id: 'oldest', label: 'Oldest first' }, { id: 'updated', label: 'Last update' },
  { id: 'queue', label: 'Place in line' }, { id: 'status', label: 'Status' }, { id: 'cost', label: 'Most spent' }, { id: 'title', label: 'Title A–Z' },
];
const STATUS_ORDER = new Map(STATUSES.map((s, i) => [s.id, i]));
export function sortRequests(rs, sort = 'newest') {
  const up = (r) => { const t = Date.parse(r.updatedAt || ''); return Number.isNaN(t) ? 0 : t; };
  const by = {
    newest: (a, b) => ts(b) - ts(a), oldest: (a, b) => ts(a) - ts(b), updated: (a, b) => up(b) - up(a),
    queue: (a, b) => (a.slot?.state === 'running' ? -1 : 0) - (b.slot?.state === 'running' ? -1 : 0) || (a.queue?.position ?? 1e9) - (b.queue?.position ?? 1e9),
    status: (a, b) => (STATUS_ORDER.get(a.status) ?? 99) - (STATUS_ORDER.get(b.status) ?? 99),
    cost: (a, b) => (Number(b.costUsd) || 0) - (Number(a.costUsd) || 0), title: (a, b) => String(a.title).localeCompare(String(b.title)),
  }[sort] ?? ((a, b) => ts(b) - ts(a));
  return rs.map((r, i) => [r, i]).sort(([a, i], [b, j]) => by(a, b) || ts(b) - ts(a) || i - j).map(([r]) => r);
}

export const GROUPS = [{ id: 'none', label: 'No grouping' }, { id: 'status', label: 'Status' }, { id: 'build', label: 'Build' }, { id: 'kind', label: 'Kind' }, { id: 'profile', label: 'Profile' }];
/** The build a request belongs to (its own, its parent's, or the build it links to). */
export const buildOf = (r) => (r.where ?? []).find((w) => w.kind === 'build')?.id ?? '';
export function groupRequests(rs, by = 'none') {
  if (by === 'none') return [{ id: 'all', label: '', items: rs }];
  const key = { status: (r) => r.status, build: (r) => buildOf(r) || '(no build)', kind: (r) => r.kind, profile: (r) => r.profile || 'none' }[by] ?? (() => 'all');
  const out = new Map();
  for (const r of rs) { const k = key(r); if (!out.has(k)) out.set(k, { id: k, label: by === 'status' ? statusInfo(k).label : by === 'kind' ? kindInfo(k).label : k, items: [] }); out.get(k).items.push(r); }
  const groups = [...out.values()];
  if (by === 'status') groups.sort((x, y) => (STATUS_ORDER.get(x.id) ?? 99) - (STATUS_ORDER.get(y.id) ?? 99));
  return groups;
}

/** Counts for the banner, the Home card and the totals strip. */
export function summarize(rs) {
  const s = { total: rs.length, open: 0, statuses: {}, kinds: {}, running: 0, queued: 0, awaitingMerge: 0, costUsd: 0 };
  for (const r of rs) {
    s.statuses[r.status] = (s.statuses[r.status] ?? 0) + 1;
    s.kinds[r.kind] = (s.kinds[r.kind] ?? 0) + 1;
    if (isOpen(r)) s.open++;
    if (r.status === 'running') s.running++;
    if (r.status === 'queued') s.queued++;
    if (r.status === 'built') s.awaitingMerge++;
    s.costUsd += Number(r.costUsd) || 0;
  }
  s.costUsd = Math.round(s.costUsd * 100) / 100;
  return s;
}

export const fmtUsd = (n) => (n == null || Number.isNaN(Number(n)) ? '' : Number(n) >= 100 ? `$${Math.round(Number(n)).toLocaleString('en-US')}` : `$${Number(n).toFixed(2)}`);

/** "3m", "5h", "2d", "6w": how long ago. */
export function age(at, now = Date.now()) {
  const t = Date.parse(at ?? ''); if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  return m < 60 ? `${m}m` : m < 60 * 48 ? `${Math.round(m / 60)}h` : m < 60 * 24 * 21 ? `${Math.round(m / 1440)}d` : `${Math.round(m / 10080)}w`;
}

/** Where-it-lives line: "build x · s3 · queue current #4 of 12 · slot waiting #2". */
export function whereLine(r) {
  const b = buildOf(r);
  return [b && `build ${b}`, r.steps?.next && `next ${r.steps.next}`, r.queue && `${r.queue.list} #${r.queue.position} of ${r.queue.of}`, r.slot && (r.slot.state === 'running' ? 'running now' : `slot queue #${r.slot.position}`)].filter(Boolean).join(' · ');
}

/** Rough fingerprint of a list: changes when any status, place in line or update time changes (for live polling). */
export function fingerprint(rs) {
  let h = 2166136261;
  for (const r of rs) for (const c of `${r.id}|${r.status}|${r.queue?.position ?? ''}|${r.slot?.state ?? ''}|${r.updatedAt}|${r.costUsd ?? ''};`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
