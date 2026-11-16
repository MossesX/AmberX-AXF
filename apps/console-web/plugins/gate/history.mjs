/**
 * Gate history (gate-history@1, framework/spec/GATE.md → gate.history): one append-only JSONL file in the plugin's data
 * folder, through the store adapter. Every rule change (who, when, before / after) and every lander action (mode, pause,
 * resume, land now) is one line:
 *   { $axf: 'gate-history@1', at, by, kind: 'rule' | 'lander' | 'build-rule', action, id?, pr?, before?, after?, reason }
 * Lines are only ever added; once the file holds more than the plugin's history size (setting historySize, default
 * 2000) by a fifth, the oldest are dropped in one rewrite.
 */
export const FRAME = 'gate-history@1';
export const KINDS = Object.freeze(['rule', 'lander', 'build-rule']);
export const HISTORY_DEFAULT = 2000;
export const HISTORY_MAX = 20000;
export const READ_MAX = 500;

const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : '');
/** A reason is text or axHub's { title, description }. */
const reasonOf = (r) => (r && typeof r === 'object' ? { title: str(r.title, 200), description: str(r.description, 600) } : str(r, 600));

/** One entry, normalised. */
export function normEntry(e = {}, at = new Date().toISOString()) {
  const pr = Number(e.pr);
  return {
    $axf: FRAME, at: str(e.at, 40) || at, by: str(e.by, 80) || 'console', kind: KINDS.includes(e.kind) ? e.kind : 'rule', action: str(e.action, 40) || 'change',
    ...(e.id ? { id: str(e.id, 41) } : {}), ...(Number.isInteger(pr) && pr > 0 ? { pr } : {}),
    ...(e.before !== undefined ? { before: e.before } : {}), ...(e.after !== undefined ? { after: e.after } : {}), reason: reasonOf(e.reason),
  };
}

/** Append one entry (normalised) and keep the file within the history size. Returns the entry. */
export function record(store, entry) {
  const e = normEntry(entry, store.iso());
  store.appendHistory(e);
  const size = Math.min(HISTORY_MAX, Math.max(50, Number(store.settings().historySize) || HISTORY_DEFAULT));
  const all = store.readHistory();
  if (all.length > size * 1.2) store.writeHistory(all.slice(-size));
  return e;
}

/**
 * Entries newest first, filtered: kind (rule | lander), since (ISO date-time or a day), pr, rule (a rule id), action,
 * limit (default 100, at most 500).
 */
export function read(store, { kind = '', since = '', pr = '', rule = '', action = '', limit = 100 } = {}) {
  const n = Math.min(READ_MAX, Math.max(1, Number(limit) || 100));
  const sinceMs = since ? Date.parse(String(since)) : NaN;
  const prN = Number(String(pr || '').replace(/^#/, '')) || 0;
  const out = [];
  const all = store.readHistory();
  for (let i = all.length - 1; i >= 0 && out.length < n; i--) {
    const e = normEntry(all[i]);
    if (kind && e.kind !== kind) continue;
    if (!Number.isNaN(sinceMs) && Date.parse(e.at) < sinceMs) continue;
    if (prN && e.pr !== prN) continue;
    if (rule && e.id !== rule) continue;
    if (action && e.action !== action) continue;
    out.push(e);
  }
  return { items: out };
}
