/*
 * Watch live in the console: which headless sessions have a live preview right now (GET /api/previews, server/
 * previews.py; one shared poll for every row on screen), and which of them belong to a row — a running build in the
 * Build manager or the Build orchestrator, or an approval row. Rows render <WatchLiveFor …/>: the framework's
 * Watch live link when a preview matches, a greyed "No live preview" otherwise.
 */
import { useEffect, useState } from 'react';
import { WatchLiveLink, type WatchLivePreview } from './axf/react';
import { getToken } from './api';

export interface ConsolePreview extends WatchLivePreview {
  branch: string;
  change: string;
  worktree: string;
}

/** What a row knows about the session behind it; any one that matches is enough. */
export interface PreviewMatch {
  session?: string;
  branch?: string;
  change?: string;
  worktree?: string;
  /** free text (an approval's command, reason, arguments): matches when it names a preview's branch, session or change */
  text?: string;
}

const norm = (s: string | undefined) => (s ?? '').trim().replace(/^axf-/, '').toLowerCase();

/** Pure: the previews a row's session details point at. */
export function matchPreviews(items: ConsolePreview[], m: PreviewMatch): ConsolePreview[] {
  const text = (m.text ?? '').toLowerCase();
  return items.filter((p) => {
    if (m.change && p.change && m.change === p.change) return true;
    if (m.session && norm(m.session) === norm(p.session)) return true;
    if (m.branch && p.branch && m.branch === p.branch && p.branch !== 'main' && p.branch !== 'HEAD') return true;
    if (m.worktree && p.worktree && m.worktree.replace(/\/+$/, '') === p.worktree.replace(/\/+$/, '')) return true;
    if (text) {
      if (p.change && text.includes(p.change.toLowerCase())) return true;
      if (p.branch && p.branch !== 'main' && p.branch.length > 4 && text.includes(p.branch.toLowerCase())) return true;
      if (p.session && text.includes(p.session.toLowerCase())) return true;
    }
    return false;
  });
}

let items: ConsolePreview[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<(v: ConsolePreview[]) => void>();
const EVERY_MS = 5000;

async function poll(): Promise<void> {
  try {
    const t = getToken();
    const r = await fetch('/api/previews', { cache: 'no-store', headers: t ? { authorization: `Bearer ${t}` } : {} });
    if (!r.ok) return;
    const j = (await r.json()) as { items?: ConsolePreview[] };
    items = Array.isArray(j.items) ? j.items : [];
  } catch { items = []; }
  for (const s of subs) s(items);
}

/** Every live preview, refreshed every 5 s while anything on screen uses it. */
export function usePreviews(): ConsolePreview[] {
  const [v, setV] = useState(items);
  useEffect(() => {
    subs.add(setV);
    if (!timer) { void poll(); timer = setInterval(() => { void poll(); }, EVERY_MS); }
    return () => { subs.delete(setV); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
  }, []);
  return v;
}

/** The Watch live link for one row (always rendered: greyed "No live preview" when nothing matches). */
export function WatchLiveFor(props: PreviewMatch & { className?: string }) {
  const all = usePreviews();
  const { className, ...m } = props;
  return <WatchLiveLink previews={matchPreviews(all, m)} className={className} />;
}
