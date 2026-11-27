/*
 * Paged status reads (Brett, Nov 25 2026: no pipeline status file, no whole-set reads). Every list this plugin shows
 * (the builds table, the old tabs, fill status, the builds behind the approvals) is asked for one page at a time:
 * ?status= (one or a comma list), ?project=, ?limit=, ?offset=. The answer says limit, offset and total beside the
 * rows; an answer from a server without paging carries none of them and every row, and is cut down to the page asked
 * for here, so a screen never holds more than the pages it has shown.
 */
import { useEffect, useRef } from 'react';
import { Button } from '@console/axf/react';

/** Rows per page a screen asks for. */
export const PAGE_SIZE = 50;
/** The most rows one request may ask for (the server's cap). */
export const PAGE_MAX = 200;

export type PageQuery = { status?: string | readonly string[]; project?: string; limit?: number; offset?: number };
export type Page<T> = { rows: T[]; limit: number; offset: number; total: number };
export type Paged = { limit?: number; offset?: number; total?: number };

const statusList = (s: PageQuery['status']): string[] => (typeof s === 'string' ? s.split(',') : [...(s ?? [])]).map((x) => x.trim()).filter(Boolean);
const whole = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback);

/** `path` with the page asked for (and anything in `extra`) as its query string. */
export function pageQuery(path: string, q: PageQuery = {}, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v));
  const status = statusList(q.status);
  if (status.length) p.set('status', status.join(','));
  if (q.project) p.set('project', q.project);
  p.set('limit', String(Math.min(whole(q.limit, PAGE_SIZE), PAGE_MAX)));
  p.set('offset', String(whole(q.offset, 0)));
  return `${path}${path.includes('?') ? '&' : '?'}${p.toString()}`;
}

/**
 * One page out of an answer's list. A paged answer (it says its total) is taken as it is; an answer without paging is
 * filtered by the statuses asked for and cut to the window asked for, and its total is what matched.
 */
export function pageOf<T>(res: Paged | null | undefined, list: readonly T[] | null | undefined, q: PageQuery = {}, statusOf: (row: T) => string = (r) => String((r as { status?: unknown }).status ?? '')): Page<T> {
  const rows = Array.isArray(list) ? list : [];
  const limit = Math.min(whole(q.limit, PAGE_SIZE), PAGE_MAX); const offset = whole(q.offset, 0);
  if (res && typeof res.total === 'number') return { rows: rows.slice(0, whole(res.limit, limit)), limit: whole(res.limit, limit), offset: whole(res.offset, offset), total: whole(res.total, rows.length) };
  const want = statusList(q.status);
  const kept = want.length ? rows.filter((r) => want.includes(statusOf(r))) : rows;
  return { rows: kept.slice(offset, offset + limit), limit, offset, total: kept.length };
}

/** `have` with a later page added: a row already there is replaced in place, a new one goes on the end. */
export function addPage<T extends { id: string }>(have: readonly T[], page: readonly T[]): T[] {
  const out = [...have]; const at = new Map(out.map((r, i) => [r.id, i]));
  for (const r of page) { const i = at.get(r.id); if (i === undefined) { at.set(r.id, out.length); out.push(r); } else out[i] = r; }
  return out;
}

/**
 * The first `count` rows of a list, read in as few requests as the cap allows (a refresh of what a screen has already
 * shown). `read` asks for one window; the total is the last one the server gave.
 */
export async function readWindow<T extends { id: string }>(count: number, read: (limit: number, offset: number) => Promise<Page<T>>): Promise<{ rows: T[]; total: number }> {
  const want = Math.max(count, 1);
  let rows: T[] = []; let total = 0; let offset = 0;
  while (offset < want) {
    const p = await read(Math.min(PAGE_MAX, want - offset), offset);
    rows = addPage(rows, p.rows); total = p.total;
    offset += Math.max(p.limit, 1);
    if (!p.rows.length || offset >= total) break;
  }
  return { rows, total };
}

/**
 * The foot of a paged list: how much of it is on screen and a "Load more" button. The next page is also asked for by
 * itself when the foot scrolls into view.
 */
export function LoadMore({ shown, total, busy = false, what = 'builds', onMore }: { shown: number; total: number; busy?: boolean; what?: string; onMore: () => void }) {
  const foot = useRef<HTMLParagraphElement | null>(null);
  const more = useRef(onMore); more.current = onMore;
  const left = Math.max(0, total - shown);
  const asked = useRef(-1);
  useEffect(() => {
    const el = foot.current;
    if (!el || !left || busy || typeof IntersectionObserver === 'undefined') return undefined;
    // observed again after every page: a foot still in view asks for the next one. Once per length: a page that
    // failed to load is not asked for again by scrolling, only by the button
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && asked.current !== shown) { asked.current = shown; more.current(); } });
    io.observe(el);
    return () => io.disconnect();
  }, [left, busy, shown]);
  if (!left) return null;
  return (
    <p ref={foot} className="fx-row fx-row--wrap fx-small fx-muted" data-load-more={what} aria-live="polite">
      <span>{shown} of {total} {what} loaded</span>
      <Button size="sm" tone="neutral" icon="chevron-down" disabled={busy} onClick={onMore}>{busy ? 'Loading…' : `Load ${Math.min(left, PAGE_SIZE)} more`}</Button>
    </p>
  );
}
