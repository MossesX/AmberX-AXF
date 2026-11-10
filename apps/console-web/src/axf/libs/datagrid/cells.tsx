/*
 * lib-datagrid cells: the parts a professional, two-line grid row is made of (Brett, Nov 9 2026: "It doesn't have to
 * be a single clean line... it can be a double wide row... make it look good, like a professional website. Pending
 * isn't gonna have a timer. They should have dates, when they were started, how many steps, how many completed. The
 * active ones need an animated thing in the row.").
 *
 *   CellTitle     title on line 1, a muted meta line (id, chips, short facts) on line 2
 *   CellDates     labelled dates stacked (Created / Started / Finished …), absolute date with the time on hover
 *   CellSteps     "3 / 11 steps" over a small meter; active = moving meter, all done = success colour
 *   LivePulse     the animated "this is running now" mark (a ripple dot); still under prefers-reduced-motion
 *   Elapsed       a live h:mm:ss timer from a start time, one shared 1 s tick for every timer on screen
 *   DetailSections  an expanded row's collapsible sections laid out as a responsive sub-grid
 *   DetailFacts / DetailChecklist / DetailTimeline  what goes in a section: label-value pairs, a checklist, timestamped lines
 *   fmtDate / fmtDateTime / fmtDuration  the formats every cell uses
 *
 * Generic: nothing here knows what a build is. Theme tokens only (datagrid.css); framework controls (Meter, Chip, Icon).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Chip, Icon, Meter } from '@console/axf/react';

const asDate = (v?: string | number | null) => { if (v == null || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
/** `Nov 9` (adds the year when it is not this year). */
export function fmtDate(v?: string | number | null): string {
  const d = asDate(v); if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
/** `Nov 9, 5:50 PM` */
export function fmtDateTime(v?: string | number | null): string {
  const d = asDate(v); if (!d) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
/** milliseconds → `42s`, `12m`, `1h 05m`, `2d 3h` (compact) or `0:12:04` (clock). */
export function fmtDuration(ms: number, clock = false): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (clock) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  if (d) return `${d}d ${h % 24}h`;
  if (h) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return m ? `${m}m` : `${s}s`;
}
/** duration between two times (`fmtDuration`), '' when either is missing */
export const spanBetween = (from?: string | null, to?: string | null) => { const a = asDate(from), b = asDate(to); return a && b ? fmtDuration(b.getTime() - a.getTime()) : ''; };

/* one shared second tick for every live timer on screen */
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function useSecondTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const f = () => set((n) => n + 1);
    subs.add(f);
    if (!timer) timer = setInterval(() => subs.forEach((s) => s()), 1000);
    return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
  }, [on]);
}

/** Title on line 1, a muted meta line on line 2 (ids, chips, short facts separated by dots). */
export function CellTitle({ title, sub, lead, badges, onOpen }: { title: ReactNode; sub?: ReactNode[]; lead?: ReactNode; badges?: ReactNode; onOpen?: () => void }) {
  const meta = (sub ?? []).filter((x) => x !== null && x !== undefined && x !== false && x !== '');
  return (
    <span className="axf-cell-title">
      {lead && <span className="axf-cell-title__lead">{lead}</span>}
      <span className="axf-cell-title__body">
        <span className="axf-cell-title__main">
          {onOpen ? <span className="axf-cell-title__text is-link" data-fx-row role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); onOpen(); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpen(); } }}>{title}</span> : <span className="axf-cell-title__text">{title}</span>}
          {badges}
        </span>
        {meta.length > 0 && <span className="axf-cell-title__sub">{meta.map((m, i) => <span key={i} className="axf-cell-title__bit">{m}</span>)}</span>}
      </span>
    </span>
  );
}

export interface CellDate { label: string; at?: string | null; /** shown instead of the date (e.g. a live timer) */ value?: ReactNode; title?: string }
/** Labelled dates stacked: only the ones with a value are drawn; the full date and time on hover. */
export function CellDates({ dates, empty = '—' }: { dates: CellDate[]; empty?: string }) {
  const shown = dates.filter((d) => d.value != null || asDate(d.at));
  if (!shown.length) return <span className="axf-cell-muted">{empty}</span>;
  return (
    <span className="axf-cell-dates">
      {shown.map((d) => (
        <span key={d.label} className="axf-cell-dates__row" title={d.title ?? (d.at ? `${d.label} ${fmtDateTime(d.at)}` : d.label)}>
          <span className="axf-cell-dates__label">{d.label}</span>
          <span className="axf-cell-dates__value">{d.value ?? fmtDate(d.at)}</span>
        </span>
      ))}
    </span>
  );
}

/** "3 / 11 steps" over a small meter. `active` animates the meter; every step done draws it in the success colour. */
export function CellSteps({ done, total, active, current, unit = 'steps' }: { done: number; total: number; active?: boolean; current?: string; unit?: string }) {
  if (!total) return <span className="axf-cell-muted">No {unit}</span>;
  const pct = Math.round((Math.min(done, total) / total) * 100);
  return (
    <span className="axf-cell-steps" title={current ? `Now: ${current}` : `${done} of ${total} ${unit} done`}>
      <span className="axf-cell-steps__count"><b>{done}</b><span className="axf-cell-muted"> / {total} {unit}</span><span className="axf-cell-steps__pct">{pct}%</span></span>
      <Meter value={pct} active={active} done={done >= total} small label={`${done} of ${total} ${unit} done`} />
      {current && <span className="axf-cell-steps__now">{current}</span>}
    </span>
  );
}

/** The animated "running now" mark: a dot with a ripple ring. `tone` picks the colour token. */
export function LivePulse({ label = 'Running', tone = 'accent', still }: { label?: string; tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info'; still?: boolean }) {
  return <span className={`axf-pulse axf-pulse--${tone}${still ? ' is-still' : ''}`} role="status" aria-label={label} title={label}><span className="axf-pulse__dot" /></span>;
}

/** A live h:mm:ss timer since `since` (stops at `until` when given). */
export function Elapsed({ since, until, compact }: { since?: string | null; until?: string | null; compact?: boolean }) {
  const from = asDate(since), to = asDate(until);
  useSecondTick(!!from && !to);
  if (!from) return <span className="axf-cell-muted">—</span>;
  const ms = (to ?? new Date()).getTime() - from.getTime();
  return <span className="axf-elapsed" title={`Since ${fmtDateTime(since)}`}>{fmtDuration(ms, !compact)}</span>;
}

export interface DetailSection { id: string; title: string; icon?: string; count?: ReactNode; open?: boolean; wide?: boolean; content: ReactNode }
/** An expanded row's collapsible sections, laid out as a responsive sub-grid (wide sections span the row). */
export function DetailSections({ sections, label }: { sections: DetailSection[]; label?: string }) {
  const shown = sections.filter((s) => s.content !== null && s.content !== undefined && s.content !== false);
  return (
    <div className="axf-detail-sections" aria-label={label}>
      {shown.map((s) => (
        <details key={s.id} className={`axf-detail-section${s.wide ? ' is-wide' : ''}`} open={s.open ?? true}>
          <summary className="axf-detail-section__head">
            {s.icon && <Icon name={s.icon} size={14} />}
            <span className="axf-detail-section__title">{s.title}</span>
            {s.count != null && s.count !== '' && <Chip>{s.count}</Chip>}
            <Icon name="chevron-down" size={12} className="axf-detail-section__caret" />
          </summary>
          <div className="axf-detail-section__body">{s.content}</div>
        </details>
      ))}
    </div>
  );
}

/** Label / value pairs (a definition list) for a detail section. */
export function DetailFacts({ facts }: { facts: [label: string, value: ReactNode][] }) {
  const shown = facts.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '');
  if (!shown.length) return <span className="axf-cell-muted">Nothing yet.</span>;
  return <dl className="axf-detail-facts">{shown.map(([k, v]) => <div key={k} className="axf-detail-facts__row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export interface ChecklistItem { id: string; text: string; done?: boolean; skip?: boolean; tag?: ReactNode; at?: string }
/** A checklist (a build's steps, a task's parts): done ticks in the success colour, skipped struck through. */
export function DetailChecklist({ items, empty = 'Nothing here yet.' }: { items?: ChecklistItem[]; empty?: string }) {
  if (!items?.length) return <span className="axf-cell-muted">{empty}</span>;
  return (
    <ol className="axf-checklist">
      {items.map((it) => (
        <li key={it.id} className={it.done ? 'is-done' : it.skip ? 'is-skip' : ''}>
          <Icon name={it.done ? 'check-circle' : it.skip ? 'minus' : 'clock'} size={13} />
          <span className="axf-checklist__id">{it.id}</span>
          <span className="axf-checklist__text">{it.text}</span>
          {it.tag}
          {it.at && <span className="axf-cell-muted" title={fmtDateTime(it.at)}>{fmtDate(it.at)}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Timestamped lines, oldest first (a log tail, a build's latest notes). */
export function DetailTimeline({ items }: { items: { at: string; text: string }[] }) {
  return <ul className="axf-timeline">{items.map((n, i) => <li key={i}><span className="axf-timeline__at">{fmtDateTime(n.at)}</span><span>{n.text}</span></li>)}</ul>;
}
