/**
 * pending-core — the pending build list's logic, pure and IO-free so the CLI, the console API, the MCP server and
 * the browser console all compute the same thing.  State lives in framework/plan/pending.json (pending@1):
 *
 *   { $axf: 'pending@1', updatedAt, artifact, items: [PendingItem…] }
 *
 * A pending item is a build parked until the right model (usually Fable) is available. It mirrors the claude.ai
 * "AXF Pending Builds" artifact (db collection `builds`) field for field, with ISO dates instead of epoch ms:
 *
 *   id, title, detail, model ('Fable' | 'Opus' | 'Sonnet'), status ('pending' | 'complete' | 'failed' | 'broken'),
 *   notes [{ text, at }], subPrompts [{ text, at }], createdAt, builtAt (set when status becomes complete),
 *   updatedAt, planId (optional link to a plan epic), source ('console' | 'artifact' | 'plan' | 'chat' | 'mcp')
 *
 * Rules
 *   dates      createdAt is set once. builtAt is stamped the first time an item is marked complete and cleared if it
 *              goes back to pending/failed/broken, so "date built" is always the latest completion.
 *   sort       by status (pending → broken → failed → complete), by date added, or by date built; ties fall back to
 *              date added (newest first) then title, so every client shows the same order.
 */

export const STATUSES = ['pending', 'broken', 'failed', 'complete'];
export const STATUS_LABEL = { pending: 'Pending', complete: 'Complete', failed: 'Failed', broken: 'Broken' };
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
const entries = (list) => (Array.isArray(list) ? list : []).map((e) => ({ text: str(e?.text), at: iso(e?.at) })).filter((e) => e.text);
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
 *   update  { id, title?, detail?, model?, status?, planId? }
 *   status  { id, status }
 *   note    { id, text }        sub { id, text }        remove { id }
 * Returns { state, item?, log } and throws on bad input (unknown id, empty title or text, unknown status).
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
      }
      if (a.status !== undefined) it = setStatus(it, a.status);
      it.updatedAt = now;
      const items = s.items.slice(); items[i] = it;
      return { state: touch(s, items, now), item: it, log: [`pending: ${it.id} ${a.status !== undefined ? `→ ${it.status}` : 'updated'}`] };
    }
    case 'note': case 'sub': {
      const text = str(a.text).trim(); if (!text) throw new Error('text is required');
      const i = find(); const key = a.action === 'note' ? 'notes' : 'subPrompts';
      const it = { ...s.items[i], [key]: [...s.items[i][key], { text, at: now }], updatedAt: now };
      const items = s.items.slice(); items[i] = it;
      return { state: touch(s, items, now), item: it, log: [`pending: ${a.action === 'note' ? 'note' : 'sub prompt'} added to ${it.id}`] };
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
    notes: it.notes.map((n) => ({ text: n.text, at: ms(n.at) })), subPrompts: it.subPrompts.map((n) => ({ text: n.text, at: ms(n.at) })),
    createdAt: ms(it.createdAt), ...(it.builtAt ? { builtAt: ms(it.builtAt) } : {}), updatedAt: ms(it.updatedAt), ...(it.planId ? { planId: it.planId } : {}),
  };
}
