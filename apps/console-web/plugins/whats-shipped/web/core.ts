/*
 * What's new: the pure part (no React, no console imports), shared by the web part and the plugin's self-test
 * (`test.mts`). Groups the whats-new@1 feed by date, build or app, filters it, keeps track of what was read and what is
 * new since the last visit, and paints the banner widget (a framework `status` widget, theme-free: tones are widget
 * tone names).
 */

export const ID = 'ai.amberx.axf.console.whats-shipped';
export const ASSET_ID = 'shipped';
export const COUNTER = 'shipped.unread';
export const KEYS = { show: 'whats-shipped.show', group: 'whats-shipped.group', read: 'whats-shipped.read', lastVisit: 'whats-shipped.lastVisit', ticker: 'whats-shipped.ticker' } as const;
export const MAX_READ = 500;

export interface FeedApp { id: string; label: string; kind: 'app' | 'plugin' | 'framework' }
export interface FeedItem {
  id: string; title: string; summary: string; details: string[];
  build: { id: string; title: string; profile: string } | null;
  apps: FeedApp[]; where: string; mergedAt: string; deployed: boolean | null; deployedAt: string;
  pr: { number: number; url: string } | null; branch: string; sha: string; report: string; filesKnown: boolean;
}
export interface Feed { $axf: 'whats-new@1'; builtAt: string; source: string; deploysKnown: boolean; items: FeedItem[]; total?: number; error?: string }

export type GroupBy = 'date' | 'build' | 'app';
export const GROUPS: GroupBy[] = ['date', 'build', 'app'];
export interface Group { key: string; label: string; items: FeedItem[] }

const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Today / Yesterday / This week / Older (local time; a week = the last 7 days). */
export function dateBucket(iso: string, now = Date.now()): { key: string; label: string } {
  const t = Date.parse(iso);
  const today = startOfDay(now);
  if (!Number.isFinite(t)) return { key: '4-older', label: 'Older' };
  if (t >= today) return { key: '1-today', label: 'Today' };
  if (t >= today - DAY) return { key: '2-yesterday', label: 'Yesterday' };
  if (t >= today - 6 * DAY) return { key: '3-week', label: 'This week' };
  return { key: '4-older', label: 'Older' };
}

/** Groups in a stable order: dates newest first; builds and apps by their newest item, then name. Items keep feed order (newest first). */
export function groupItems(items: FeedItem[], by: GroupBy, now = Date.now()): Group[] {
  const map = new Map<string, Group>();
  const put = (key: string, label: string, it: FeedItem) => {
    let g = map.get(key);
    if (!g) { g = { key, label, items: [] }; map.set(key, g); }
    if (!g.items.includes(it)) g.items.push(it);
  };
  const sorted = [...items].sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  for (const it of sorted) {
    if (by === 'date') { const b = dateBucket(it.mergedAt, now); put(b.key, b.label, it); }
    else if (by === 'build') put(it.build ? `b:${it.build.id}` : 'b:', it.build ? it.build.title || it.build.id : 'No build on record', it);
    else if (!it.apps.length) put('a:', 'Other', it);
    else for (const a of it.apps) put(`a:${a.id}`, a.label, it);
  }
  const groups = [...map.values()];
  if (by === 'date') return groups.sort((a, b) => a.key.localeCompare(b.key));
  const last = (k: string) => k === 'b:' || k === 'a:';
  return groups.sort((a, b) => Number(last(a.key)) - Number(last(b.key)) || (b.items[0]?.mergedAt ?? '').localeCompare(a.items[0]?.mergedAt ?? '') || a.label.localeCompare(b.label));
}

/** Plain search over title, summary, details, build, apps, branch and PR number; every word must match. */
export function search(items: FeedItem[], q: string): FeedItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const hay = [it.title, it.summary, ...it.details, it.build?.title, it.build?.id, it.build?.profile, ...it.apps.map((a) => a.label), it.branch, it.pr ? `#${it.pr.number}` : '', it.where]
      .join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/* ---------------- read marks + new since last visit ---------------- */

export const readSet = (v: unknown): Set<string> => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
export const unread = (items: FeedItem[], read: Set<string>) => items.filter((it) => !read.has(it.id));

/** Read ids after marking some, newest kept when over the cap, ids no longer in the feed dropped first. */
export function markRead(read: Set<string>, ids: string[], feedIds: string[]): string[] {
  const live = new Set(feedIds);
  const all = [...new Set([...read, ...ids])];
  const kept = [...all.filter((id) => live.has(id)), ...all.filter((id) => !live.has(id))];
  return kept.slice(0, MAX_READ);
}

/** Merged after the last visit (no last visit = nothing is "new since", only unread). */
export const isNewSince = (it: FeedItem, lastVisit: string) => !!lastVisit && it.mergedAt > lastVisit;

/* ---------------- banner widget ---------------- */

/** The ticker's text: the n-th newest unread title (or the newest when all read), short enough for the banner. */
export function tickerText(items: FeedItem[], read: Set<string>, n: number, max = 48): string {
  const pool = unread(items, read);
  const list = pool.length ? pool : items.slice(0, 1);
  if (!list.length) return "What's new";
  const t = list[((n % list.length) + list.length) % list.length]?.title ?? "What's new";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The plugin's `status` widget asset (framework type, no new asset type). On (accent dot) while anything is unread. */
export function statusAsset(items: FeedItem[], read: Set<string>, n: number, loading = false) {
  const count = unread(items, read).length;
  const text = loading && !items.length ? "What's new …" : tickerText(items, read, n);
  const label = count ? `${count} new · ${text}` : `What's new · ${text}`;
  return {
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: "What's new", version: '0.1.0', author: "What's new plugin",
    description: 'The newest features merged to main, with the unread count; attached to the banner by the What\'s new plugin.', tags: ['status', 'banner-pack', 'whats-shipped'],
    data: { counter: COUNTER, onLabel: label, offLabel: items.length ? label : "What's new", onTone: 'accent', offTone: 'muted', dot: true, link: 'whats-shipped.open' },
  };
}

/** What the runtime needs to offer (structural, so this file imports nothing). */
export interface BannerHost {
  registry: { register(raw: unknown, source: 'app', origin: string): unknown };
  setBadge(name: string, n: number): void;
  attachToBanner(a: { type: string; id: string; at: 'left' | 'center' | 'right'; order?: number; origin: string }): unknown;
  detachFromBanner(keyOrOrigin: string): void;
}

/** Repaint the widget and the unread counter; attach it on the right before the clock group, or take it off when hidden. */
export function paintWhatsNew(rt: BannerHost, items: FeedItem[], read: Set<string>, n: number, show: boolean, loading = false): void {
  rt.registry.register(statusAsset(items, read, n, loading), 'app', ID);
  rt.setBadge(COUNTER, unread(items, read).length);
  if (show) rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'right', order: 22, origin: ID });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}

/** "3h ago", "2d ago" or a date. */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(t).toLocaleDateString();
}
