/**
 * UI Review core (review-item@1): pure functions shared by the web page, the review.mjs CLI and the tests.
 * No DOM, no fetch, no Node APIs. The server (server/__init__.py) mirrors normalise / decide / state.
 *
 * An item (working shape): { id, kind, title, app, screen, build, branch, pr, shots: [{ src, device, name }], notes, status,
 *            comment, history: [{ at, by, action, status, comment }], source, submittedBy, group, submittedAt, updatedAt, … }
 * What is stored and served is ui-review-item@1 (framework/core/ui-review-schema.mjs); conform.mjs converts both ways.
 * Kinds are an open registry (kinds.json + the data folder's kinds.json + any kind an item names).
 */

export const SCHEMA = 'review-item@1';
export const MAX_PICKS = 3;
export const DESIGN_KIND = 'design-pack';

/** Statuses in waiting-first order. `holds` = holds a PR while the gate switch is on (gateOn(), default off). */
export const STATUSES = [
  { id: 'waiting', label: 'Waiting', icon: 'clock', tone: 'accent', holds: true },
  { id: 'changes', label: 'Changes asked', icon: 'edit', tone: 'warning', holds: true },
  { id: 'rejected', label: 'Rejected', icon: 'x-circle', tone: 'danger', holds: true },
  { id: 'approved', label: 'Approved', icon: 'check-circle', tone: 'success', holds: false },
];
const STATUS_IDS = STATUSES.map((s) => s.id);
export const statusInfo = (id) => STATUSES.find((s) => s.id === id) ?? STATUSES[0];
/** Decision verbs the UI and CLI use → the status they set. */
export const DECISIONS = { approve: 'approved', changes: 'changes', reject: 'rejected', reopen: 'waiting' };

export const SORTS = [
  { id: 'waiting', label: 'Waiting first' },
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'title', label: 'Title' },
  { id: 'app', label: 'App' },
  { id: 'waiting-desc', label: 'Waiting last' },
  { id: 'title-desc', label: 'Title, Z first' },
  { id: 'app-desc', label: 'App, Z first' },
];

const KIND_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ID_RE = /^[a-z0-9][a-z0-9:._-]{0,80}$/;
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export const isKind = (k) => typeof k === 'string' && KIND_RE.test(k);
export const isItemId = (k) => typeof k === 'string' && ID_RE.test(k);
/** "home-cards" → "Home cards" (a kind nobody listed still gets a readable section). */
export const labelFromId = (id) => { const s = String(id).replace(/[-_]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : 'Other'; };

/** Registry kinds (base, then data-folder extras overriding by id) + any kind the items name. Sorted by order. */
export function mergeKinds(base = [], extra = [], items = []) {
  const by = new Map();
  for (const k of [...(base ?? []), ...(extra ?? [])]) {
    if (!k || !isKind(k.id)) continue;
    by.set(k.id, { icon: 'more', order: 80, desc: '', ...(by.get(k.id) ?? {}), ...k, label: str(k.label, 60) || by.get(k.id)?.label || labelFromId(k.id) });
  }
  for (const it of items ?? []) if (it && isKind(it.kind) && !by.has(it.kind)) by.set(it.kind, { id: it.kind, label: labelFromId(it.kind), icon: 'more', order: 85, desc: '', unlisted: true });
  return [...by.values()].sort((a, b) => (a.order ?? 80) - (b.order ?? 80) || a.label.localeCompare(b.label));
}

const DEVICES = ['phone', 'desktop'];
/** Device from a file name ("…-phone.png" / "…-desktop.png"), else desktop. */
export const deviceOf = (name) => (/(^|[-_.])phone([-_.]|$)/i.test(String(name)) ? 'phone' : 'desktop');
/** "settings-home-phone.png" → "Settings home". */
export const shotName = (file) => labelFromId(String(file).split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/(^|[-_.])(phone|desktop)$/i, ''));

/** A submitted item, cleaned. Returns { item, problems }; unknown fields are kept. */
export function normItem(raw, { now = new Date().toISOString(), id } = {}) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const problems = [];
  const kind = str(o.kind, 41) || 'other';
  if (!isKind(kind)) problems.push(`kind "${kind}" must be lowercase letters, digits and dashes`);
  const title = str(o.title, 200) || str(o.name, 200); // a missing name is refused by ui-review-item@1 (conform.mjs), naming the field
  const pr = o.pr === undefined || o.pr === null || o.pr === '' ? null : Number(String(o.pr).replace(/^#/, ''));
  if (pr !== null && !(Number.isInteger(pr) && pr > 0)) problems.push('pr must be a PR number');
  const shots = (Array.isArray(o.shots) ? o.shots : []).slice(0, 60).map((s) => (typeof s === 'string' ? { src: s } : s)).filter((s) => s && typeof s.src === 'string' && s.src)
    .map((s) => ({ ...s, src: str(s.src, 300), device: DEVICES.includes(s.device) ? s.device : deviceOf(s.src), name: str(s.name, 120) || shotName(s.src) }));
  const status = STATUS_IDS.includes(o.status) ? o.status : 'waiting';
  const item = {
    ...o, $axf: SCHEMA, id: isItemId(o.id) ? o.id : (id ?? newId(now)), kind, title, app: str(o.app, 80), build: str(o.build, 120), branch: str(o.branch, 200),
    pr, shots, notes: str(o.notes, 4000), status, comment: str(o.comment, 2000),
    history: Array.isArray(o.history) ? o.history.slice(-200) : [], source: str(o.source, 40), screen: str(o.screen, 200),
    submittedAt: str(o.submittedAt, 40) || str(o.createdAt, 40) || now, updatedAt: str(o.updatedAt, 40) || now,
  };
  if (!item.history.length) item.history = [{ at: item.submittedAt, by: str(o.by, 60) || str(o.submittedBy?.id ?? o.submittedBy, 60), action: 'submitted', status }];
  delete item.by; delete item.name;
  return { item, problems };
}

let seq = 0;
export function newId(now = new Date().toISOString()) {
  const d = String(now).slice(0, 10).replace(/-/g, '');
  seq = (seq + 1) % 1296;
  return `r-${d}-${Math.random().toString(36).slice(2, 7)}${seq.toString(36).padStart(2, '0')}`;
}

/** One decision on one item: new status (+ comment), a history line. Returns a new object. */
export function decide(item, decision, { comment = '', by = 'brett', at = new Date().toISOString() } = {}) {
  const status = DECISIONS[decision] ?? (STATUS_IDS.includes(decision) ? decision : null);
  if (!status) throw new Error(`unknown decision "${decision}"`);
  const c = str(comment, 2000);
  return { ...item, status, comment: c || (status === item.status ? item.comment : ''), updatedAt: at,
    history: [...(item.history ?? []), { at, by, action: decision in DECISIONS ? decision : status, status, ...(c ? { comment: c } : {}) }].slice(-200) };
}

/** The same decision on every selected item; ids not in the list are reported back. */
export function bulkDecide(items, ids, decision, opts = {}) {
  const want = new Set(ids); const changed = []; const out = items.map((it) => { if (!want.has(it.id)) return it; const n = decide(it, decision, opts); changed.push(n.id); return n; });
  return { items: out, changed, missing: [...want].filter((x) => !changed.includes(x)) };
}

/** The groups design packs sit in (one per round): ui-review-group@1. */
export const packGroups = (index) => [...new Map((index?.packs ?? []).map((p) => [p.round, { $axf: 'ui-review-group@1', id: `g-design-packs-r${p.round}`, name: `Design packs - Round ${p.round}`, createdAt: p.added, source: 'plugin' }])).values()];

/** Design packs (packs/index.json) as review items (each conforms to ui-review-item@1 through conform.mjs); saved decisions (overlay by item id) win for status/comment/history. */
export function packItems(index, overlay = {}) {
  return (index?.packs ?? []).map((p) => {
    const id = `pack:${p.id}`; const o = overlay[id] ?? {};
    return {
      $axf: SCHEMA, id, kind: DESIGN_KIND, title: p.name, app: 'Look refactor', build: `Round ${p.round}`, branch: '', pr: null,
      shots: (p.files ?? []).map((f) => ({ src: f.src, device: f.device === 'phone' ? 'phone' : 'desktop', name: f.name })),
      notes: p.desc ?? '', status: STATUS_IDS.includes(o.status) ? o.status : 'waiting', comment: o.comment ?? '', history: o.history ?? [],
      source: 'plugin', screen: 'Design pack', submittedBy: { type: 'build', id: 'ui-review design packs' }, group: `g-design-packs-r${p.round}`, groupName: `Design packs - Round ${p.round}`,
      submittedAt: p.added ?? '', updatedAt: o.updatedAt ?? p.added ?? '',
      pack: { id: p.id, num: p.num, round: p.round, scheme: p.scheme, swatches: p.swatches ?? [], font: p.font, radius: p.radius },
    };
  });
}

/** Free-text search: every word must appear somewhere in the item. */
export function matches(it, q) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${it.title} ${it.app} ${it.build} ${it.branch} ${it.pr ? `#${it.pr} pr${it.pr}` : ''} ${it.notes} ${it.comment} ${it.kind} ${statusInfo(it.status).label}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Filters: kind ('' = all), status ('' | id | 'open' = not approved), app, branch, pr, q. */
export function filterItems(items, f = {}) {
  return items.filter((it) => (!f.kind || it.kind === f.kind) && (!f.group || it.group === f.group)
    && (!f.status || (f.status === 'open' ? it.status !== 'approved' : it.status === f.status))
    && (!f.app || it.app === f.app) && (!f.branch || it.branch === f.branch)
    && (!f.pr || Number(it.pr) === Number(f.pr)) && matches(it, f.q));
}

const rank = (s) => { const i = STATUS_IDS.indexOf(s); return i < 0 ? 99 : i; };
const when = (it) => String(it.updatedAt || it.submittedAt || '');
export function sortItems(items, sort = 'waiting') {
  if (sort.endsWith('-desc')) return sortItems(items, sort.slice(0, -5)).reverse();
  const a = [...items];
  const byNew = (x, y) => when(y).localeCompare(when(x));
  if (sort === 'newest') return a.sort(byNew);
  if (sort === 'oldest') return a.sort((x, y) => -byNew(x, y));
  if (sort === 'title') return a.sort((x, y) => x.title.localeCompare(y.title));
  if (sort === 'app') return a.sort((x, y) => (x.app ? 0 : 1) - (y.app ? 0 : 1) || x.app.localeCompare(y.app) || x.title.localeCompare(y.title));
  return a.sort((x, y) => rank(x.status) - rank(y.status) || byNew(x, y)); // waiting first, newest within
}

/** Counts per kind: { [kind]: { total, waiting, changes, rejected, approved } } plus an "" (all) entry. */
export function counts(items) {
  const z = () => ({ total: 0, waiting: 0, changes: 0, rejected: 0, approved: 0 });
  const out = { '': z() };
  for (const it of items) { for (const k of ['', it.kind]) { const c = (out[k] ??= z()); c.total++; if (it.status in c) c[it.status]++; } }
  return out;
}

/** Group for the sub-grid view: by 'kind' | 'app' | 'status' | 'build'. Groups keep the item order given. */
export function groupItems(items, by = 'kind', kinds = []) {
  const groups = new Map();
  const key = (it) => (by === 'app' ? it.app || '' : by === 'status' ? it.status : by === 'build' ? it.branch || it.build || '' : it.kind);
  for (const it of items) { const k = key(it); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const label = (k) => (by === 'kind' ? kinds.find((x) => x.id === k)?.label ?? labelFromId(k) : by === 'status' ? statusInfo(k).label : k || (by === 'app' ? 'No app' : 'No build'));
  const order = (k) => (by === 'kind' ? kinds.findIndex((x) => x.id === k) : by === 'status' ? rank(k) : 0);
  return [...groups.entries()].map(([id, list]) => ({ id, label: label(id), items: list }))
    .sort((a, b) => (order(a.id) < 0 ? 999 : order(a.id)) - (order(b.id) < 0 ? 999 : order(b.id)) || (by === 'app' || by === 'build' ? (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.label.localeCompare(b.label) : 0));
}

/** Tree view: kind > app > items, only kinds that have items. */
export function tree(items, kinds = []) {
  return groupItems(items, 'kind', kinds).map((g) => ({ ...g, apps: groupItems(g.items, 'app', kinds) }));
}

/** Selection helpers (multi-select in every view). */
export const toggleId = (sel, id) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
/** Tri-state for a group checkbox: 'all' | 'some' | 'none'. */
export function groupChecked(sel, ids) { const n = ids.filter((x) => sel.includes(x)).length; return n === 0 ? 'none' : n === ids.length ? 'all' : 'some'; }
/** Tick or untick a whole group. */
export function setGroup(sel, ids, on) { const s = new Set(sel); for (const id of ids) on ? s.add(id) : s.delete(id); return [...s]; }

/** Design-pack picks: toggle with the 3-pick limit. */
export function togglePick(picked, id, max = MAX_PICKS) {
  if (picked.includes(id)) return { picked: picked.filter((x) => x !== id), error: '' };
  if (picked.length >= max) return { picked, error: `You can pick ${max}. Untick one first.` };
  return { picked: [...picked, id], error: '' };
}

/**
 * The gate switch (Brett, Nov 13 2026: "UI Review must not be a gate. Add an on/off switch in UI Review settings,
 * 'UI Review is a merge gate', default OFF"). uiReview.gate is the Claude setting builds.uiReviewGate; a missing value
 * is off. Off: items are still filed for Brett to look at and no PR waits. On: a PR whose review is waiting, has
 * changes asked or is rejected is held, unless its items were released (nonBlocking). server/gate.py is the twin.
 */
export const GATE_KEY = 'uiReview.gate';
export const GATE_LABEL = 'UI Review is a merge gate';
export const GATE_DEFAULT = false;
export const NOT_A_GATE = 'filed (not a gate)';
export const GATE_OFF_LINE = 'Off: items are filed for you to look at, PRs never wait.';
export const GATE_ON_LINE = 'On: a PR whose UI Review is waiting, has changes asked or is rejected waits in the merge queue.';
export const gateLine = (on) => (on ? GATE_ON_LINE : GATE_OFF_LINE);
const HOLDING = new Set(['waiting', 'pending', 'changes', 'rejected']);

/**
 * ui-review@1 state for a branch and/or PR: the strictest status of its items (`review`), rejected > changes > waiting >
 * approved, 'none' when nothing was submitted. `state` is that status while the gate is on and 'filed (not a gate)'
 * while it is off; `holds` only while it is on and an item that wasn't released still waits, has changes or is rejected.
 */
export function reviewState(items, { branch = '', pr = null, gate = GATE_DEFAULT } = {}) {
  const on = gate === true;
  // a predicted look (ui-prediction@1) is approved for the look, not for merging: only real screens count
  const mine = items.filter((it) => ((branch && it.branch === branch) || (pr && Number(it.pr) === Number(pr))) && it.prediction?.state !== 'predicted');
  const c = { waiting: 0, changes: 0, rejected: 0, approved: 0 };
  for (const it of mine) if (it.status in c) c[it.status]++;
  const review = !mine.length ? 'none' : c.rejected ? 'rejected' : c.changes ? 'changes' : c.waiting ? 'waiting' : 'approved';
  const holds = on && mine.some((it) => HOLDING.has(it.status) && !it.nonBlocking);
  const state = on || review === 'none' ? review : NOT_A_GATE;
  const reason = holds ? `UI Review is a merge gate and this is ${review}` : on ? 'UI Review is a merge gate; nothing here holds' : GATE_OFF_LINE;
  return { $axf: 'ui-review@1', branch, pr: pr ? Number(pr) : null, state, review, gate: on, holds, reason, counts: c, items: mine.map((it) => ({ id: it.id, title: it.title, kind: it.kind, status: it.status, ...(it.nonBlocking ? { nonBlocking: true } : {}) })) };
}

/** PRs with an open review ([{pr, branch, review, held}]); `held` only while the gate is on. */
export function heldPrs(items, { gate = GATE_DEFAULT } = {}) {
  const out = new Map();
  for (const it of items) {
    const n = Number(it.pr);
    if (!Number.isInteger(n) || n <= 0 || out.has(n)) continue;
    const st = reviewState(items, { pr: n, gate });
    if (['waiting', 'changes', 'rejected'].includes(st.review)) out.set(n, { pr: n, branch: it.branch || '', review: st.review, held: st.holds });
  }
  return [...out.values()].sort((a, b) => a.pr - b.pr);
}

/** ui-review-gate@1: the same object on REST (GET gate), MCP (ui_review_gate_get), the CLI (review.mjs gate) and voice. */
export function gateView(on, items = [], source = 'ui-review') {
  const prs = heldPrs(items, { gate: on === true });
  return { $axf: 'ui-review-gate@1', key: GATE_KEY, label: GATE_LABEL, on: on === true, gate: on === true, source, heldPrs: prs.filter((p) => p.held).map((p) => p.pr), openReviews: prs, line: gateLine(on === true), who: 'Anyone may turn it off; only Brett turns it on, with his own click in the console.' };
}

/** Default-off gate object, for a client that hasn't read the switch yet. */
export const GATE = Object.freeze(gateView(false));

/** Distinct apps in a list (filter menu). */
export const apps = (items) => [...new Set(items.map((it) => it.app).filter(Boolean))].sort((a, b) => a.localeCompare(b));
