/*
 * Sessions nav — the pure parts (no React, no network), shared by the rail (nav.tsx) and its self-test
 * (framework/spec/check-terminal-nav.mts): the terminal-nav@1 answer's types, search / filter / sort, the groups, the
 * running timer and what tapping an item opens.
 */

export type NavKind = 'tmux' | 'headless' | 'chat' | 'connection';
export interface NavItem {
  id: string; kind: NavKind; name: string; title: string; where?: 'vps' | 'console'; session?: string; source?: string;
  agent?: string; model?: string; costUsd?: number | null; costEstimated?: boolean; status?: string; url?: string; detail?: string; icon?: string;
  via?: string; container?: string | null; ready?: boolean; why?: string; badge?: string | null;
  startedAt?: number; lastAt?: number; endedAt?: number | null; attached?: number; cwd?: string; tab?: boolean; lines?: number; lastLine?: string;
}
export interface NavModel { $axf: 'terminal-nav@1'; now: number; vps: { ready: boolean; why: string }; mine: NavItem[]; agents: NavItem[]; connections: NavItem[]; recent: NavItem[] }
export type SectionId = 'mine' | 'agents' | 'connections' | 'recent';
export const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'mine', label: 'My sessions', icon: 'user' }, { id: 'agents', label: 'Agents', icon: 'sparkles' },
  { id: 'connections', label: 'Connections', icon: 'shuffle' }, { id: 'recent', label: 'Recent', icon: 'clock' },
];
export type Sort = 'started' | 'name' | 'activity';
export type Filter = 'all' | 'live' | 'working' | 'waiting';

/** 3s, 4m 05s, 1h 02m, 2d 3h. Pure. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Does the item match the search words (all of them, anywhere in its name, title, agent, model, where)? Pure. */
export function matches(it: NavItem, q: string): boolean {
  const hay = [it.title, it.name, it.agent, it.model, it.where, it.session, it.detail, it.lastLine].filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const LIVE = new Set(['working', 'waiting', 'starting', 'attached', 'detached']);
export function passes(it: NavItem, f: Filter): boolean {
  if (f === 'all' || it.kind === 'connection') return true;
  if (f === 'live') return !it.endedAt && LIVE.has(it.status ?? '');
  return it.status === f;
}

export function sortItems(items: NavItem[], by: Sort): NavItem[] {
  const out = [...items];
  if (by === 'name') out.sort((a, b) => a.title.localeCompare(b.title));
  else if (by === 'activity') out.sort((a, b) => (b.lastAt ?? b.startedAt ?? 0) - (a.lastAt ?? a.startedAt ?? 0));
  else out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return out;
}

/** The rail's sections after search, filter and sort; connections keep their order and ignore the filter. Pure. */
export function view(m: NavModel | null, q: string, f: Filter, by: Sort): Record<SectionId, NavItem[]> {
  const pick = (list: NavItem[] | undefined, sort = true) => {
    const l = (list ?? []).filter((it) => (!q || matches(it, q)) && passes(it, f));
    return sort ? sortItems(l, by) : l;
  };
  return { mine: pick(m?.mine), agents: pick(m?.agents), connections: pick(m?.connections, false), recent: pick(m?.recent, false) };
}

/** Where a tmux item is and its Open for a tab: a mirror (read-only) unless `write`. Pure. */
export function openFor(it: NavItem, write = false): { kind: 'vps' | 'console' | 'feed'; attach?: string; readOnly?: boolean; title: string; feed?: string; url?: string } | null {
  if (it.kind === 'chat') return { kind: 'feed', feed: it.id, title: it.title, url: it.url || undefined };
  if (it.kind !== 'tmux' && it.kind !== 'headless') return null;
  return { kind: it.where === 'console' ? 'console' : 'vps', attach: it.name, readOnly: write ? undefined : true, title: it.agent || it.title };
}

/** A claude.ai link a chat reported (only claude.ai, https). Pure. */
export const chatLink = (it: NavItem) => (it.url && /^https:\/\/claude\.ai\//.test(it.url) ? it.url : '');

/** Status dot class for an item. Pure. */
export function dotOf(it: NavItem): string {
  if (it.endedAt) return 'ended';
  if (it.kind === 'connection') return it.ready ? 'done' : 'failed';
  const s = it.status ?? '';
  return s === 'attached' ? 'working' : s === 'detached' ? 'waiting' : s || 'waiting';
}
