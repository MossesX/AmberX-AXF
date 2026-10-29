/**
 * pending-core — the pending build list's logic, pure and IO-free so the CLI, the console API, the MCP server and
 * the browser console all compute the same thing.  State lives in framework/plan/pending.json (pending@1):
 *
 *   { $axf: 'pending@1', updatedAt, artifact, items: [PendingItem…] }
 *
 * A pending item is a build parked until the right model (usually Fable) is available. It mirrors the claude.ai
 * "AXF Pending Builds" artifact (db collection `builds`) field for field, with ISO dates instead of epoch ms:
 *
 *   id, title, detail, model ('Fable' | 'Opus' | 'Sonnet'), status ('pending' | 'unsafe' | 'complete' | 'failed' | 'broken'),
 *   (unsafe = parked and not safe to build as written yet: it needs design or review before anyone starts it),
 *   notes [{ text, at }], subPrompts [{ text, at, estimate?, done?, doneAt? }], createdAt, builtAt (set when status becomes
 *   complete), updatedAt, planId (optional link to a plan epic), estimate?, source ('console' | 'artifact' | 'plan' | 'chat' | 'mcp')
 *
 * Rules
 *   dates      createdAt is set once. builtAt is stamped the first time an item is marked complete and cleared if it
 *              goes back to pending/failed/broken, so "date built" is always the latest completion.
 *   sort       by status (pending → unsafe → broken → failed → complete), by date added, or by date built; ties fall back to
 *              date added (newest first) then title, so every client shows the same order.
 *   steps      (Oct 21 2026, rule "Small steps for big builds") the sub prompts ARE the item's steps: a build over
 *              SPLIT_LIMIT_MINUTES is split into sub prompts of SPLIT_LIMIT_MINUTES or less, each with its own estimate,
 *              ticked off one by one (`done`, `doneAt`). `splitCheck` / `needsSplit` flag a big build without such steps.
 */

export const STATUSES = ['pending', 'unsafe', 'broken', 'failed', 'complete'];
export const STATUS_LABEL = { pending: 'Pending', unsafe: 'Unsafe', complete: 'Complete', failed: 'Failed', broken: 'Broken' };
export const MODELS = ['Fable', 'Opus', 'Sonnet'];
export const SORTS = ['status', 'added', 'built'];
export const ARTIFACT_URL = 'https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye';

export function emptyPending() { return { $axf: 'pending@1', updatedAt: '', artifact: ARTIFACT_URL, items: [] }; }

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
/** Epoch ms (the artifact) or ISO string → ISO string; '' when missing or invalid. */
export function iso(v) {
  if (v == null || v === '') return '';
  const d = typeof v === 'number' ? new Date(v) : new Date(str(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
const entry = (e) => ({
  text: str(e?.text), at: iso(e?.at),
  ...(str(e?.estimate).trim() ? { estimate: str(e.estimate).trim() } : {}),
  ...(e?.done === true ? { done: true, doneAt: iso(e?.doneAt) || iso(e?.at) } : {}),
  ...(e?.skip === true ? { skip: true } : {}), // feature-matrix@1: skipped when the build runs, never removed
  ...(str(e?.fm).trim() ? { fm: str(e.fm, 80).trim() } : {}), // its feature-matrix item id
});
const entries = (list) => (Array.isArray(list) ? list : []).map(entry).filter((e) => e.text);

/**
 * Build-time estimates (Oct 20 2026): every item and every sub prompt may carry `estimate`, a short human string
 * ("45 min", "2 h", "1.5 d"). `estimateMinutes` reads one; `itemEstimate` is the item's own, else the sum of its sub prompts'.
 */
export function estimateMinutes(text) {
  const m = /^\s*~?\s*(\d+(?:[.,]\d+)?)\s*(min|mins|minute|minutes|m|h|hr|hrs|hour|hours|d|day|days)\b/i.exec(str(text));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const u = m[2].toLowerCase();
  return Math.round(n * (u.startsWith('d') ? 480 : u.startsWith('h') ? 60 : 1));
}
/** Minutes → "45 min", "2.5 h", "19.5 h". Always hours past an hour (Oct 23 2026: "2.5 d" read as 60 hours, it meant 8-hour days). */
export function formatMinutes(min) {
  if (min == null || !Number.isFinite(min) || min <= 0) return '';
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.round(min / 30) / 2} h`;
}
/**
 * An entry's build time in minutes (Oct 23 2026): when every step carries an estimate, the steps added up (so the item
 * and its steps never disagree); otherwise its own estimate, else whatever steps have one; null when nothing gives a time.
 */
/** The steps that count: skipped ones (feature matrix) stay in the list but leave every sum. */
const stepsOfEntry = (entry) => (Array.isArray(entry?.subPrompts) ? entry.subPrompts : Array.isArray(entry?.steps) ? entry.steps : []).filter((s) => s?.skip !== true);
export function entryMinutes(entry) {
  const steps = stepsOfEntry(entry);
  const mins = steps.map((s) => estimateMinutes(s?.estimate));
  if (steps.length && mins.every((n) => n != null)) return mins.reduce((a, b) => a + b, 0);
  const own = estimateMinutes(entry?.estimate);
  if (own != null) return own;
  const known = mins.filter((n) => n != null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
export function itemEstimate(it) {
  const steps = stepsOfEntry(it);
  if (steps.length && steps.every((s) => estimateMinutes(s?.estimate) != null)) return formatMinutes(entryMinutes(it));
  if (str(it?.estimate).trim()) return str(it.estimate).trim();
  const m = entryMinutes(it);
  return m != null ? formatMinutes(m) : '';
}

/**
 * Cost in dollars (Oct 23 2026, Brett: "cost estimates in dollars, not tokens"). A working minute of a build session is
 * priced with the model's token prices and the per-minute heuristic in framework/schemas/model-pricing.json (the same
 * rule as estimateCost() in framework/cli/model-pricing.mjs). Pure: callers pass the pricing file's JSON.
 */
const DEFAULT_PER_MINUTE = { input: 5000, output: 3000, cacheRead: 300000, cacheWrite: 0 };
const modelKeyOf = (m) => { const s = str(m).toLowerCase(); return ['fable', 'opus', 'sonnet', 'haiku'].find((k) => s.includes(k)) ?? ''; };
export function minuteCostUsd(model, pricing) {
  const p = pricing?.models?.[modelKeyOf(model)];
  if (!p || p.input == null || p.output == null) return null;
  const t = pricing?.heuristic?.tokensPerMinute ?? DEFAULT_PER_MINUTE;
  return ((t.input ?? 0) * p.input + (t.output ?? 0) * p.output + (t.cacheRead ?? 0) * (p.cacheRead ?? p.input) + (t.cacheWrite ?? 0) * (p.cacheWrite ?? p.input)) / 1e6;
}
/** USD for `minutes` on `model`; null without a price or a time. */
export function costForMinutes(model, minutes, pricing) {
  const m = minuteCostUsd(model, pricing);
  return m == null || minutes == null || !Number.isFinite(minutes) || minutes < 0 ? null : Math.round(m * minutes * 100) / 100;
}
/** 0.84 → "$0.84", 23.1 → "$23", 1234 → "$1,234"; '' for null. */
export function formatUsd(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString('en-US')}`;
}

/**
 * Small steps for big builds (Oct 21 2026): a build over SPLIT_LIMIT_MINUTES must be split into steps of at most
 * SPLIT_LIMIT_MINUTES, each with its own estimate. `splitCheck(entry)` works for a pending item (steps = subPrompts) and
 * for a build-queue step record (steps = steps); `needsSplit` is its boolean. `stepsProgress` adds the steps up.
 */
export const SPLIT_LIMIT_MINUTES = 30;
const stepsOf = stepsOfEntry;
export function splitCheck(entry, limit = SPLIT_LIMIT_MINUTES) {
  const steps = stepsOf(entry);
  const stepMins = steps.map((s) => estimateMinutes(s?.estimate));
  const total = entryMinutes(entry);
  const reasons = [];
  if (total != null && total > limit && !steps.length) reasons.push(`estimated at ${formatMinutes(total)} with no steps`);
  steps.forEach((s, i) => {
    const n = stepMins[i];
    if (total != null && total > limit && n == null) reasons.push(`step ${i + 1} has no estimate`);
    else if (n != null && n > limit) reasons.push(`step ${i + 1} is ${formatMinutes(n)} (over ${limit} min)`);
  });
  return { needsSplit: reasons.length > 0, totalMinutes: total, steps: steps.length, reasons };
}
export const needsSplit = (entry, limit = SPLIT_LIMIT_MINUTES) => splitCheck(entry, limit).needsSplit;
/** Steps done / total and minutes left (steps without an estimate count 0; no steps → the whole estimate is left). */
export function stepsProgress(entry) {
  const steps = stepsOf(entry);
  const mins = (s) => estimateMinutes(s?.estimate) ?? 0;
  const done = steps.filter((s) => s?.done === true);
  const total = entryMinutes(entry) ?? 0;
  // steps without an estimate share what the own estimate leaves over the estimated ones
  const unest = steps.filter((s) => estimateMinutes(s?.estimate) == null);
  const share = unest.length ? Math.max(0, total - steps.reduce((a, s) => a + mins(s), 0)) / unest.length : 0;
  const cost = (s) => estimateMinutes(s?.estimate) ?? share;
  const left = steps.length ? Math.round(steps.filter((s) => s?.done !== true).reduce((a, s) => a + cost(s), 0)) : total;
  return { done: done.length, total: steps.length, minutesTotal: total, minutesLeft: left, minutesDone: total - left };
}

export const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'build';

/** Tolerant decode of one item (old files, the artifact's shape, hand edits). */
export function normalize(raw, now = new Date().toISOString()) {
  const status = STATUSES.includes(raw?.status) ? raw.status : 'pending';
  const model = MODELS.find((m) => m.toLowerCase() === str(raw?.model).toLowerCase()) ?? 'Fable';
  const createdAt = iso(raw?.createdAt) || now;
  const builtAt = status === 'complete' ? iso(raw?.builtAt) || iso(raw?.updatedAt) || now : '';
  return {
    id: str(raw?.id) || slug(raw?.title),
    title: str(raw?.title).trim() || 'Untitled build',
    detail: str(raw?.detail),
    model, status,
    notes: entries(raw?.notes),
    subPrompts: entries(raw?.subPrompts),
    createdAt, builtAt,
    updatedAt: iso(raw?.updatedAt) || createdAt,
    ...(raw?.planId ? { planId: str(raw.planId) } : {}),
    ...(str(raw?.estimate).trim() ? { estimate: str(raw.estimate).trim() } : {}),
    source: str(raw?.source) || 'console',
  };
}

export function normalizeState(raw, now) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const items = [];
  for (const r of Array.isArray(s.items) ? s.items : []) { const it = normalize(r, now); if (!seen.has(it.id)) { seen.add(it.id); items.push(it); } }
  return { $axf: 'pending@1', updatedAt: iso(s.updatedAt), artifact: str(s.artifact) || ARTIFACT_URL, items };
}

const uniqueId = (items, base) => { let id = slug(base), n = 2; while (items.some((i) => i.id === id)) id = `${slug(base)}-${n++}`; return id; };
const touch = (state, items, now) => ({ ...state, items, updatedAt: now });

/**
 * Apply one change. Actions:
 *   add     { title, detail?, model?, status?, planId?, source?, id? }
 *   update  { id, title?, detail?, model?, status?, planId?, estimate?, subEstimates?, subPrompts? (replaces the step list) }
 *   status  { id, status }
 *   note    { id, text, estimate? }   sub { id, text, estimate? }   remove { id }
 *   step    { id, index, done?, text?, estimate? }   tick / untick, reword or re-estimate one sub prompt (0-based index)
 * Returns { state, item?, log } and throws on bad input (unknown id, empty title or text, unknown status, bad index).
 */
export function apply(state, a, now = new Date().toISOString()) {
  const s = normalizeState(state, now);
  const find = () => { const i = s.items.findIndex((x) => x.id === a?.id); if (i < 0) throw new Error(`no pending build "${a?.id}"`); return i; };
  const setStatus = (it, status) => {
    if (!STATUSES.includes(status)) throw new Error(`status must be one of: ${STATUSES.join(', ')}`);
    if (status === it.status) return it;
    return { ...it, status, builtAt: status === 'complete' ? now : '' };
  };
  switch (a?.action) {
    case 'add': {
      const title = str(a.title).trim();
      if (!title) throw new Error('title is required');
      const it0 = normalize({ ...a, id: a.id && !s.items.some((x) => x.id === a.id) ? a.id : uniqueId(s.items, title), title, createdAt: now, updatedAt: now, status: 'pending', source: a.source || 'console' }, now);
      const it = { ...setStatus(it0, a.status ?? 'pending'), updatedAt: now };
      return { state: touch(s, [...s.items, it], now), item: it, log: [`pending: added "${it.title}" (${it.id}, waits on ${it.model})`] };
    }
    case 'update': case 'status': {
      const i = find(); let it = { ...s.items[i] };
      if (a.action === 'update') {
        if (a.title !== undefined) { if (!str(a.title).trim()) throw new Error('title is required'); it.title = str(a.title).trim(); }
        if (a.detail !== undefined) it.detail = str(a.detail);
        if (a.model !== undefined) { const m = MODELS.find((x) => x.toLowerCase() === str(a.model).toLowerCase()); if (!m) throw new Error(`model must be one of: ${MODELS.join(', ')}`); it.model = m; }
        if (a.planId !== undefined) { if (a.planId) it.planId = str(a.planId); else delete it.planId; }
        if (a.estimate !== undefined) { if (str(a.estimate).trim()) it.estimate = str(a.estimate).trim(); else delete it.estimate; }
        if (a.subEstimates !== undefined && Array.isArray(a.subEstimates)) it.subPrompts = it.subPrompts.map((sp, k) => { const e = str(a.subEstimates[k]).trim(); const { estimate: _e, ...rest } = sp; return e ? { ...rest, estimate: e } : rest; });
        if (a.subPrompts !== undefined) { // replace the whole step list (re-splitting a build); entries keep their `at` when given
          if (!Array.isArray(a.subPrompts)) throw new Error('subPrompts must be an array');
          it.subPrompts = a.subPrompts.map((sp, k) => { const e = entry({ ...sp, at: sp?.at || now }); if (!e.text) throw new Error(`sub prompt ${k + 1} needs text`); return e; });
        }
      }
      if (a.status !== undefined) it = setStatus(it, a.status);
      it.updatedAt = now;
      const items = s.items.slice(); items[i] = it;
      return { state: touch(s, items, now), item: it, log: [`pending: ${it.id} ${a.status !== undefined ? `→ ${it.status}` : 'updated'}`] };
    }
    case 'note': case 'sub': {
      const text = str(a.text).trim(); if (!text) throw new Error('text is required');
      const i = find(); const key = a.action === 'note' ? 'notes' : 'subPrompts';
      const est = str(a.estimate).trim();
      const it = { ...s.items[i], [key]: [...s.items[i][key], { text, at: now, ...(est ? { estimate: est } : {}) }], updatedAt: now };
      const items = s.items.slice(); items[i] = it;
      return { state: touch(s, items, now), item: it, log: [`pending: ${a.action === 'note' ? 'note' : 'sub prompt'} added to ${it.id}`] };
    }
    case 'step': {
      const i = find(); const it = { ...s.items[i], subPrompts: s.items[i].subPrompts.slice() };
      const k = Number(a.index);
      if (!Number.isInteger(k) || k < 0 || k >= it.subPrompts.length) throw new Error(`no step ${a.index} on "${it.id}" (it has ${it.subPrompts.length})`);
      let sp = { ...it.subPrompts[k] };
      const what = [];
      if (a.text !== undefined) { const text = str(a.text).trim(); if (!text) throw new Error('text is required'); sp.text = text; what.push('reworded'); }
      if (a.estimate !== undefined) { const e = str(a.estimate).trim(); if (e) sp.estimate = e; else delete sp.estimate; what.push(e ? `~${e}` : 'estimate cleared'); }
      if (a.done !== undefined) {
        if (a.done) { if (!sp.done) { sp.done = true; sp.doneAt = now; } what.push('done'); }
        else { delete sp.done; delete sp.doneAt; what.push('not done'); }
      }
      it.subPrompts[k] = sp; it.updatedAt = now;
      const items = s.items.slice(); items[i] = it;
      return { state: touch(s, items, now), item: it, log: [`pending: ${it.id} step ${k + 1} ${what.join(', ') || 'unchanged'}`] };
    }
    case 'remove': {
      const i = find(); const it = s.items[i];
      return { state: touch(s, s.items.filter((_, j) => j !== i), now), item: it, log: [`pending: removed ${it.id}`] };
    }
    default: throw new Error(`unknown action "${a?.action}"`);
  }
}

const t = (v) => (v ? Date.parse(v) : NaN);
/** Sorted copy. key: status | added | built; dir: asc | desc (default desc for dates, status order for status). */
export function sortItems(items, key = 'status', dir) {
  const d = dir ?? (key === 'status' ? 'asc' : 'desc');
  const sign = d === 'asc' ? 1 : -1;
  const byAdded = (a, b) => (t(b.createdAt) || 0) - (t(a.createdAt) || 0) || a.title.localeCompare(b.title);
  const cmp = (a, b) => {
    if (key === 'status') return sign * (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)) || byAdded(a, b);
    if (key === 'built') {
      const ab = t(a.builtAt), bb = t(b.builtAt);
      if (Number.isNaN(ab) !== Number.isNaN(bb)) return Number.isNaN(ab) ? 1 : -1; // not built yet always last
      return (Number.isNaN(ab) ? 0 : sign * (ab - bb)) || byAdded(a, b);
    }
    return sign * ((t(a.createdAt) || 0) - (t(b.createdAt) || 0)) || a.title.localeCompare(b.title);
  };
  return [...items].sort(cmp);
}

export function counts(items) {
  const c = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
  return c;
}

/** The date a row shows: built date for complete items, date added for everything else. */
export function shownDate(it) { return it.status === 'complete' && it.builtAt ? { label: 'Built', at: it.builtAt } : { label: 'Added', at: it.createdAt }; }

/** Artifact document (db collection `builds`) → pending item, and back. Used when a session syncs the two. */
export function fromArtifact(doc) { return normalize({ ...doc, source: 'artifact' }); }
export function toArtifact(it) {
  const ms = (v) => (v ? Date.parse(v) : null);
  return {
    title: it.title, detail: it.detail, model: it.model, status: it.status,
    notes: it.notes.map((n) => ({ text: n.text, at: ms(n.at) })),
    subPrompts: it.subPrompts.map((n) => ({ text: n.text, at: ms(n.at), ...(n.estimate ? { estimate: n.estimate } : {}), ...(n.done ? { done: true, doneAt: ms(n.doneAt) } : {}) })),
    createdAt: ms(it.createdAt), ...(it.builtAt ? { builtAt: ms(it.builtAt) } : {}), updatedAt: ms(it.updatedAt), ...(it.planId ? { planId: it.planId } : {}),
    ...(itemEstimate(it) ? { estimate: itemEstimate(it) } : {}),
  };
}
