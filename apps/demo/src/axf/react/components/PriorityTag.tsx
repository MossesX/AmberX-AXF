/*
 * The priority tag on a build (framework/core/build-priority.mjs). Brett, Nov 5 2026: "Put a priority tag on everything
 * in your building. And when you click on it, it shows everything waiting for it."
 *
 * <PriorityTag build="<id>" />  a small chip: `High · 3 waiting`. Tap or right-click opens the priority dialog: change the
 *                               level, and the list of everything waiting on this build (each row opens and flashes it).
 *
 * Every tag on a page reads one shared list. The app supplies it with setPriorityHost(); without a host a tag draws
 * nothing, so an app with no builds never shows one. It is a span, not a <button>: build rows are often buttons already.
 * Theme tokens and framework classes only.
 */
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Button } from './Controls';
import { flashWhenReady } from './Search';
import type { DialogMap } from './Overlays';
import { useRuntime } from '../AxfProvider';
import { PRIORITIES, PRIORITY_LABEL, type Priority, type PriorityInfo, type WaitingRow } from '../../core/build-priority.mjs';

export interface PriorityHost {
  load(): Promise<Record<string, PriorityInfo>>;
  waiting(build: string): Promise<{ id: string; title: string; priority: Priority; waiting: WaitingRow[] }>;
  set(builds: string[], priority: Priority): Promise<void>;
}

export const PRIORITY_DIALOG = 'axf.build.priority';
const POLL_MS = 20000;
let host: PriorityHost | null = null;
let map: Record<string, PriorityInfo> = {};
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

async function refresh() {
  if (!host) return;
  try { map = await host.load(); emit(); } catch { /* the tags stay as they were until the next round */ }
}
export function setPriorityHost(h: PriorityHost | null) { host = h; emit(); void refresh(); }

function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) { void refresh(); timer = setInterval(() => void refresh(), POLL_MS); }
  return () => {
    subs.delete(f);
    if (!subs.size && timer) { clearInterval(timer); timer = null; }
  };
}
const useMap = () => useSyncExternalStore(subscribe, () => map);
const useHost = () => useSyncExternalStore(subscribe, () => host);

/** One priority on many builds (the tag's dialog and multi-select toolbars). */
export async function setBuildPriority(builds: string[], priority: Priority) {
  if (!host) throw new Error('Priorities are not available here');
  await host.set(builds, priority);
  await refresh();
}

export function PriorityTag({ build, fallback = null }: { build?: string | null; fallback?: ReactNode }) {
  const rt = useRuntime();
  const m = useMap();
  const h = useHost();
  const info = build ? m[build] : undefined;
  if (!h || !info) return <>{fallback}</>; // not a build (or the list hasn't loaded yet)
  const p = info.priority;
  const waiting = info.waiting;
  const label = PRIORITY_LABEL[p];
  const open = (e: MouseEvent | KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); rt.openDialog(PRIORITY_DIALOG, { build: info.id }); };
  return (
    <span role="button" tabIndex={0} className="fx-chip axf-priority" data-axf-priority={p}
      title={`Priority: ${label}${waiting ? `, ${waiting} waiting on this` : ''}. Tap to change or see what's waiting.`}
      aria-label={`Priority ${label}${waiting ? `, ${waiting} waiting` : ''}. Open`}
      onClick={open} onContextMenu={open} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }}>
      {label}{waiting ? ` · ${waiting} waiting` : ''}
    </span>
  );
}

const KIND_ICON: Record<WaitingRow['kind'], string> = { slot: 'layers', build: 'package', pr: 'branch', ui: 'eye', plan: 'file' };

function findText(text: string): Element | null {
  const want = text.trim().toLowerCase();
  const root = document.querySelector('.fx-main') ?? document.body;
  for (const el of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, b, strong, a, td, li, span, p')) {
    if ((el.innerText || el.textContent || '').trim().toLowerCase() === want) return el;
  }
  return null;
}

function PriorityPanel({ build, close }: { build: string; close: () => void }) {
  const rt = useRuntime();
  const [data, setData] = useState<Awaited<ReturnType<PriorityHost['waiting']>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    host?.waiting(build).then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [build]);
  const pick = async (p: Priority) => {
    if (!data || p === data.priority) return;
    setBusy(true);
    try { await setBuildPriority([data.id], p); setData({ ...data, priority: p }); rt.toast(`${data.title}: ${PRIORITY_LABEL[p]}`, 'success'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); }
  };
  const go = (r: WaitingRow) => {
    if (r.url) { window.open(r.url, '_blank', 'noopener'); return; }
    close();
    if (r.route) rt.navigate(r.route);
    if (r.highlight) flashWhenReady(() => findText(r.highlight), 4000);
  };
  if (error) return <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {error}</p>;
  if (!data) return <p className="fx-muted fx-small">Loading…</p>;
  return (
    <div className="fx-stack axf-priority-panel">
      <p className="fx-small fx-muted axf-priority-panel__build">{data.title}</p>
      <div className="fx-row fx-row--wrap" role="group" aria-label="Priority">
        {PRIORITIES.map((p) => <Button key={p} size="sm" tone={p === data.priority ? 'primary' : 'neutral'} aria-pressed={p === data.priority} disabled={busy} onClick={() => void pick(p)}>{PRIORITY_LABEL[p]}</Button>)}
      </div>
      <h3 className="fx-small axf-priority-panel__head">Waiting on this ({data.waiting.length})</h3>
      {data.waiting.length ? (
        <ul className="axf-priority-panel__list" aria-label="Waiting on this build">
          {data.waiting.map((r) => (
            <li key={`${r.kind}:${r.id}`}>
              <Button size="sm" tone="quiet" icon={KIND_ICON[r.kind]} className="axf-priority-panel__row" onClick={() => go(r)}>
                <span className="axf-priority-panel__title">{r.title}</span><span className="fx-small fx-muted">{r.why}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : <p className="fx-small fx-muted">Nothing is waiting on this build.</p>}
    </div>
  );
}

export const priorityDialogs: DialogMap = {
  [PRIORITY_DIALOG]: { title: 'Priority', icon: 'star', searchable: false, render: (p, close) => <PriorityPanel build={String(p.build ?? '')} close={close} /> },
};
