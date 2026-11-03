/**
 * Git status board — pure helpers for the page (no React, no fetch): the row shape the server sends, filtering,
 * sorting, how ages / money / CI read, and which rows match a "Show in Git status" focus. Checked by core-check.mts.
 */

export type SectionId = 'push' | 'pull' | 'ci' | 'ready' | 'held' | 'merged' | 'deployed' | 'stale';
export interface Section { id: SectionId; label: string; icon: string }
export interface Blocker { kind: string; why: string; clears: string }
export interface BuildRef { id: string; title: string; status: string; done: number; total: number; steps: { id: string; text: string; model: string; done: boolean }[]; profiles: string[] }
export interface Row {
  key: string; kind: 'pr' | 'branch' | 'worktree' | 'merged' | 'deploy' | 'gone'; repo: string; number: number | null; branch: string;
  title: string; lead: string; agent: string; status: string; tone: string; ci: string; ahead: number | null; behind: number | null;
  at: string; cost: number | null; url: string; sha: string; blockers: Blocker[]; sections: SectionId[];
  build: BuildRef | null; ui: { state: string; holds: boolean; items: { id: string; title?: string; status?: string }[] } | null;
  hold: { reason?: string; by?: string; at?: string } | null; batch: string; dependsOn: number[];
  unpushed?: number; dirty?: number; path?: string; detailLine?: string; image?: string; draft?: boolean;
}
export interface BatchView { id: string; title: string; createdAt?: string; by?: string; items: Row[]; badges: Record<'ready' | 'ci' | 'held' | 'failed' | 'gone', number>; next: string; state: string }
export interface Board {
  stamp: string; checkedAt: number; sections: Section[]; counts: Record<SectionId, number>; rows: Row[]; batches: BatchView[];
  errors: Record<string, string>; sources: Record<string, boolean | number>; githubCheckedAt?: number; localCheckedAt?: number;
}
export type Sort = 'newest' | 'oldest' | 'behind' | 'cost' | 'name';

export function ageText(at: string | number | undefined | null, now = Date.now()): string {
  const t = typeof at === 'number' ? at : at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const money = (c: number | null | undefined) => (typeof c === 'number' ? (c >= 100 ? `$${Math.round(c)}` : `$${c.toFixed(2)}`) : '');

/** ↑ahead ↓behind, the way a phone line can carry it. */
export function aheadBehind(r: Pick<Row, 'ahead' | 'behind' | 'unpushed'>): string {
  const bits: string[] = [];
  if (r.unpushed) bits.push(`⇡${r.unpushed}`);
  if (typeof r.ahead === 'number' && r.ahead > 0) bits.push(`↑${r.ahead}`);
  if (typeof r.behind === 'number' && r.behind > 0) bits.push(`↓${r.behind}`);
  return bits.join(' ');
}

/** CI dot tone and words. */
export function ciLook(ci: string): { tone: 'success' | 'danger' | 'info' | 'muted'; label: string } {
  if (ci === 'success') return { tone: 'success', label: 'CI passed' };
  if (ci === 'failure') return { tone: 'danger', label: 'CI failed' };
  if (ci === 'running') return { tone: 'info', label: 'CI running' };
  return { tone: 'muted', label: ci ? 'No CI result' : 'No CI here' };
}

export const chipTone = (tone: string): 'accent' | 'success' | 'warning' | 'danger' | undefined =>
  tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : tone === 'info' ? 'accent' : undefined;

export function searchText(r: Row): string {
  return [r.lead, r.title, r.branch, r.agent, r.status, r.repo, r.number ? `#${r.number}` : '', r.build?.id ?? '', r.build?.title ?? '', ...r.blockers.map((b) => b.why), r.path ?? ''].join(' ').toLowerCase();
}

export function filterRows(rows: Row[], o: { section: SectionId | 'all'; q: string; repo: string; sort: Sort }): Row[] {
  const q = o.q.trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  const out = rows.filter((r) => (o.section === 'all' || r.sections.includes(o.section)) && (!o.repo || r.repo === o.repo) && words.every((w) => searchText(r).includes(w)));
  const t = (r: Row) => Date.parse(r.at) || 0;
  const cmp: Record<Sort, (a: Row, b: Row) => number> = {
    newest: (a, b) => t(b) - t(a), oldest: (a, b) => t(a) - t(b), behind: (a, b) => (b.behind ?? -1) - (a.behind ?? -1),
    cost: (a, b) => (b.cost ?? -1) - (a.cost ?? -1), name: (a, b) => a.lead.localeCompare(b.lead),
  };
  return out.sort(cmp[o.sort]);
}

/** Rows a "Show in Git status" focus points at: a row key, a PR number (#N or N), a branch or a build id. */
export function matchesFocus(r: Row, focus: string): boolean {
  const f = focus.trim();
  if (!f) return false;
  if (r.key === f) return true;
  const n = /^#?(\d{1,7})$/.exec(f);
  if (n) return r.number === Number(n[1]);
  return r.branch === f || r.build?.id === f || r.path === f;
}

/** The repos on the board, for the repo filter. */
export const reposOf = (rows: Row[]) => [...new Set(rows.map((r) => r.repo).filter(Boolean))].sort();

/** What a row can do (the buttons in its expanded view and its right-click menu). */
export function actionsFor(r: Row): string[] {
  const a: string[] = [];
  if (r.kind === 'pr') {
    if (r.sections.includes('ready')) a.push('merge');
    a.push('hold', 'batch');
    if ((r.behind ?? 0) > 0 || r.blockers.some((b) => b.kind === 'conflict')) a.push('update');
    if (r.ci === 'failure' || r.ci === 'none' || r.ci === 'unknown') a.push('rerun');
    if (r.ci === 'failure' || r.blockers.some((b) => b.kind === 'conflict')) a.push('fix');
    if (r.sections.includes('stale')) a.push('land');
    a.push('close');
  } else if (r.kind === 'branch') {
    if ((r.behind ?? 0) > 0) a.push('update');
    if (r.ci === 'failure') a.push('rerun', 'fix');
    if (r.sections.includes('stale')) a.push('land', 'kill');
  } else if (r.kind === 'worktree' && r.sections.includes('stale') && r.branch && r.branch !== 'main') {
    a.push('land');
  }
  if (r.url) a.push('github');
  return a;
}
