/** Pure part of the changes & features grid: rows from the change log + the plan, filter, sort, dates. No React. */

export interface ChangeSummary {
  id: string; createdAt?: string | null; updatedAt?: string | null; kind?: string | null; title?: string | null; asked?: string;
  state?: string | null; repos?: string[]; model?: string; where?: string; branch?: string;
  steps?: { total: number; done: number; failed: number; running: string };
  result?: { state?: string; summary?: string } | null; closed?: string | null;
}
export interface FeatureLike {
  id: string; title: string; area?: string; kind?: string; status?: string; summary?: string; model?: string; group?: string;
  history?: { at: string; text: string }[];
}
export type Source = 'change' | 'feature';
export type Show = 'all' | 'changes' | 'features';
export type Sort = 'newest' | 'oldest' | 'title';
export interface Row {
  key: string; source: Source; refId: string; title: string; at: string; kind: string; status: string; model: string; area: string; summary: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function changeRow(c: ChangeSummary): Row {
  return {
    key: `change:${c.id}`, source: 'change', refId: c.id, title: str(c.title).trim() || str(c.asked).trim() || c.id,
    at: str(c.createdAt), kind: str(c.kind) || 'change', status: str(c.result?.state) || str(c.state) || 'open',
    model: str(c.model), area: (c.repos ?? []).join(', ') || str(c.where), summary: str(c.result?.summary) || str(c.asked),
  };
}

/** A feature's date is its newest history entry (when it was last built or changed); none = no date. */
export function featureAt(f: FeatureLike): string {
  let best = '';
  for (const h of f.history ?? []) if (str(h?.at) > best) best = h.at;
  return best;
}

export function featureRow(f: FeatureLike): Row {
  return {
    key: `feature:${f.id}`, source: 'feature', refId: f.id, title: str(f.title).trim() || f.id, at: featureAt(f),
    kind: str(f.kind) || 'feature', status: str(f.status) || 'planned', model: str(f.model), area: str(f.group) || str(f.area), summary: str(f.summary),
  };
}

export function buildRows(changes: ChangeSummary[], features: FeatureLike[], opts: { show?: Show; q?: string; sort?: Sort } = {}): Row[] {
  const show = opts.show ?? 'all';
  const rows: Row[] = [
    ...(show !== 'features' ? changes.filter((c) => c && c.id).map(changeRow) : []),
    ...(show !== 'changes' ? features.filter((f) => f && f.id).map(featureRow) : []),
  ];
  const q = (opts.q ?? '').trim().toLowerCase();
  const kept = q ? rows.filter((r) => [r.title, r.refId, r.kind, r.status, r.model, r.area, r.summary].join(' ').toLowerCase().includes(q)) : rows;
  const sort = opts.sort ?? 'newest';
  return kept.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
    if (a.at === b.at) return a.key.localeCompare(b.key);
    if (!a.at) return 1; // undated rows always last
    if (!b.at) return -1;
    return sort === 'newest' ? (a.at < b.at ? 1 : -1) : (a.at < b.at ? -1 : 1);
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 25 2026, 16:31" (local time; `utc` for tests), "no date" when missing or unreadable. */
export function formatWhen(iso: string, utc = false): string {
  if (!iso) return 'no date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'no date';
  const [y, m, day, h, min] = utc
    ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()]
    : [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()];
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return `${MONTHS[m]} ${day} ${y}${dateOnly ? '' : `, ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`}`;
}

export type Tone = 'success' | 'accent' | 'warning' | 'danger' | undefined;
export function statusTone(s: string): Tone {
  if (['done', 'built', 'complete', 'verified'].includes(s)) return 'success';
  if (['failed', 'broken', 'blocked', 'cancelled'].includes(s)) return 'danger';
  if (['running', 'partial', 'in-progress', 'queued'].includes(s)) return 'accent';
  if (['placeholder', 'stalled'].includes(s)) return 'warning';
  return undefined;
}

export function counts(rows: Row[]): { changes: number; features: number } {
  let changes = 0;
  for (const r of rows) if (r.source === 'change') changes++;
  return { changes, features: rows.length - changes };
}
