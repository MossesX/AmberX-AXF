/** Pure part of the session browser: run rows, search / filter / sort, formats. No React (checked by core-check.mts). */

export type Kind = 'session' | 'headless' | 'agent';
export type Status = 'running' | 'done' | 'failed' | 'killed-budget' | 'killed' | 'stopped' | 'ended';
export interface Tokens { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cacheWrite1h?: number }
export interface ModelUse { model?: string | null; turns: number; tokens: Tokens; usd: number | null }
export interface Run {
  id: string; kind: Kind; title: string; agent: string; build: string; job: string; model: string; status: Status | string;
  tokens: Tokens; tokensTotal: number; usd: number | null; costFrom: 'result' | 'report' | 'usage' | null; usageUsd?: number | null;
  models: Record<string, ModelUse>; durationMs: number | null; startedAt: string | null; lastAt: string | null;
  turns: number; tools: number; prompts: number; cwd: string; branch: string; edits: string[];
  budget?: { usd?: number; tokens?: number; turns?: number } | null; pid?: number | null; tmux?: string | null; pr?: string | null; commits?: string[];
  report?: { summary?: string; changes?: unknown[] } | null; killed?: { at: string; by: string; how: string } | null; resultText?: string;
  files: { transcript?: string | null; stream?: string | null; report?: string | null };
}

export type SortKey = 'started' | 'title' | 'agent' | 'build' | 'job' | 'model' | 'status' | 'tokens' | 'usd' | 'duration';
export interface Sort { key: SortKey; dir: 1 | -1 }
export interface Filter { q?: string; kind?: Kind | 'all'; status?: string; model?: string }

export const STATUS_LABEL: Record<string, string> = {
  running: 'running', done: 'done', failed: 'failed', 'killed-budget': 'killed for budget', killed: 'killed', stopped: 'stopped', ended: 'ended',
};
export const KIND_LABEL: Record<Kind, string> = { session: 'session', headless: 'headless', agent: 'agent run' };

/** opus / fable / sonnet / haiku from a model id; '' when unknown. */
export function family(model: string | null | undefined): string {
  const s = String(model ?? '').toLowerCase();
  for (const k of ['fable', 'opus', 'sonnet', 'haiku']) if (s.includes(k)) return k;
  return '';
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const sortVal = (r: Run, k: SortKey): string | number => {
  switch (k) {
    case 'started': return r.startedAt ?? '';
    case 'title': return r.title.toLowerCase();
    case 'agent': return r.agent.toLowerCase();
    case 'build': return r.build.toLowerCase();
    case 'job': return r.job.toLowerCase();
    case 'model': return family(r.model) || r.model;
    case 'status': return r.status;
    case 'tokens': return num(r.tokensTotal);
    case 'usd': return num(r.usd);
    case 'duration': return num(r.durationMs);
  }
};

export function matches(r: Run, f: Filter): boolean {
  if (f.kind && f.kind !== 'all' && r.kind !== f.kind) return false;
  if (f.status && f.status !== 'all' && r.status !== f.status) return false;
  if (f.model && f.model !== 'all' && family(r.model) !== f.model) return false;
  const q = (f.q ?? '').trim().toLowerCase();
  if (!q) return true;
  const hay = [r.id, r.title, r.agent, r.build, r.job, r.model, r.status, STATUS_LABEL[r.status] ?? '', r.kind, r.branch, r.cwd].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** Filtered and sorted rows; ties keep newest first, undated rows always last when sorting by start. */
export function view(runs: Run[], f: Filter = {}, sort: Sort = { key: 'started', dir: -1 }): Run[] {
  const kept = runs.filter((r) => r && r.id && matches(r, f));
  return kept.sort((a, b) => {
    const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
    if (typeof x === 'string' && (!x || !y) && x !== y) return !x ? 1 : -1; // empty / undated always last
    if (x !== y) return (x < y ? -1 : 1) * sort.dir;
    return (a.startedAt ?? '') < (b.startedAt ?? '') ? 1 : (a.startedAt ?? '') > (b.startedAt ?? '') ? -1 : a.id.localeCompare(b.id);
  });
}

/** Next sort after a header tap: same column flips, a new one starts at its natural direction (text A→Z, numbers big→small). */
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key === key) return { key, dir: cur.dir === 1 ? -1 : 1 };
  return { key, dir: ['title', 'agent', 'build', 'job', 'model', 'status'].includes(key) ? 1 : -1 };
}

export function statusTone(s: string): 'success' | 'accent' | 'warning' | 'danger' | undefined {
  if (s === 'done') return 'success';
  if (s === 'running') return 'accent';
  if (s === 'failed' || s === 'killed') return 'danger';
  if (s === 'killed-budget' || s === 'stopped') return 'warning';
  return undefined;
}

/** 1234 → "1.2k", 2_100_000 → "2.1M". */
export function fmtTokens(n: number | null | undefined): string {
  const v = num(n);
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
  return `${(v / 1_000_000).toFixed(v < 10_000_000 ? 1 : 0)}M`;
}

/** "$1.23", "$0.004", "—" when unknown; `est` adds " est.". */
export function fmtUsd(v: number | null | undefined, est = false): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const s = v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`;
  return est ? `${s} est.` : s;
}

/** 95_000 → "1m 35s", 7_500_000 → "2h 5m". */
export function fmtDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 31, 04:50" (local; `utc` for tests); the year is added when it isn't `thisYear`. */
export function fmtWhen(iso: string | null | undefined, utc = false, thisYear = new Date().getFullYear()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const [y, mo, day, h, mi] = utc ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()] : [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()];
  return `${MONTHS[mo]} ${day}${y !== thisYear ? ` ${y}` : ''}, ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** Distinct values for the filter menus. */
export function facets(runs: Run[]): { statuses: string[]; models: string[] } {
  const st = new Set<string>(), mo = new Set<string>();
  for (const r of runs) { st.add(r.status); const f = family(r.model); if (f) mo.add(f); }
  return { statuses: [...st].sort(), models: [...mo].sort() };
}
