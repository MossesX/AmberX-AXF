/** What every calendar draws: the time grid (day, week, the schedule editor), month, agenda and the mini-month. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRuntime } from '@console/axf/react';
import { snapshot as notesSnapshot, subscribe as notesSubscribe } from '../notes/store';
import {
  DAY_NAMES, addDays, clock, layoutDay, localDay, localTime, minuteOf, monthCells, niceDate, occurrences, onDay, viewRange, type CalView, type DueItem, type Occurrence,
} from './core';
import { startDrag, useGhost, type Commit, type DragHooks } from './drag';
import { commitDrop, openOccurrence, openNew } from './actions';
import { useCalendar } from './store';

const WEEK_STARTS = 0;

export function useDueItems(): DueItem[] {
  const n = useSyncExternalStore(notesSubscribe, notesSnapshot);
  return useMemo(() => Object.values(n.own.items) as unknown as DueItem[], [n.own.items]);
}
export function useOccurrences(from: string, to: string, only?: readonly string[]): Occurrence[] {
  const { store } = useCalendar();
  const items = useDueItems();
  return useMemo(() => occurrences(store, items, from, to, only), [store, items, from, to, only]);
}

/** The minute, ticking; the grid's now-line reads it. */
function useNow() {
  const [now, setNow] = useState(() => localTime());
  useEffect(() => { const t = window.setInterval(() => setNow(localTime()), 30_000); return () => window.clearInterval(t); }, []);
  return now;
}

function useHooks(): DragHooks {
  const rt = useRuntime();
  return useMemo(() => ({
    onTap: (occ, at) => { if (occ) openOccurrence(rt, occ); else if (at.date) openNew(rt, at.date, at.minute); },
    onDrop: (c: Commit) => commitDrop(rt, c),
  }), [rt]);
}

function Chip({ o, hooks, compact }: { o: Occurrence; hooks: DragHooks; compact?: boolean }) {
  const ghost = useGhost(); // the source stays in the page while it's dragged: a touch whose target leaves the page stops scrolling being held back
  return (
    <div
      role="button" tabIndex={0} title={o.title}
      className={`axp-cal-chip axp-cal-tone--${o.tone}${o.kind === 'task' ? ' is-task' : ''}${o.done ? ' is-done' : ''}${ghost?.sourceKey === o.key ? ' is-source' : ''}`}
      data-cal-key={o.key}
      onPointerDown={(e) => startDrag(e, 'move', o, hooks)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Enter') hooks.onTap(o, { date: o.date, minute: null }); }}
    >
      {!o.allDay && !compact && <span className="axp-cal-chip__time">{clock(minuteOf(o.start))}</span>}
      <span className="axp-cal-chip__title">{o.kind === 'task' ? (o.done ? '✓ ' : '○ ') : ''}{o.title}</span>
    </div>
  );
}

/** Day columns with hours, the now-line, all-day band and drag. `labels` replaces dates in the header (schedule editor). */
export function TimeGrid({ dates, items, labels, hooks: own }: { dates: string[]; items: Occurrence[]; labels?: string[]; hooks?: DragHooks }) {
  const fallback = useHooks();
  const hooks = own ?? fallback;
  const ghost = useGhost();
  const now = useNow();
  const today = now.slice(0, 10);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scroll.current; if (el) el.scrollTop = el.scrollHeight * (7 / 24); }, []);
  const banded = items.filter((o) => o.allDay);
  return (
    <div className="axp-cal-grid" style={{ '--axp-cal-days': dates.length } as React.CSSProperties}>
      <div className="axp-cal-grid__head">
        <span className="axp-cal-gutter" />
        {dates.map((d, i) => (
          <div key={d} className={`axp-cal-dayhead${d === today && !labels ? ' is-today' : ''}`}>
            <span className="axp-cal-dayhead__name">{labels?.[i] ?? DAY_NAMES[new Date(`${d}T12:00`).getDay()]}</span>
            {!labels && <span className="axp-cal-dayhead__num">{Number(d.slice(8, 10))}</span>}
          </div>
        ))}
      </div>
      {!labels && (
        <div className="axp-cal-grid__band">
          <span className="axp-cal-gutter fx-small fx-muted">all day</span>
          {dates.map((d) => <div key={d} className="axp-cal-band" data-cal-day={d}>{banded.filter((o) => onDay(o, d)).map((o) => <Chip key={o.key} o={o} hooks={hooks} compact />)}{ghost?.allDay && ghost.start.slice(0, 10) === d && <div className={`axp-cal-chip is-ghost axp-cal-tone--${ghost.tone}`}>{ghost.title}</div>}</div>)}
        </div>
      )}
      <div className="axp-cal-scroll" ref={scroll}>
        <div className="axp-cal-hours">
          <div className="axp-cal-gutter axp-cal-hourlabels" aria-hidden>{Array.from({ length: 23 }, (_, h) => <span key={h} style={{ top: `${((h + 1) / 24) * 100}%` }}>{clock((h + 1) * 60)}</span>)}</div>
          {dates.map((d) => {
            const pieces = items.filter((o) => !o.allDay).flatMap((o) => { const p = onDay(o, d); return p ? [{ ...p, o }] : []; });
            const nowOn = d === today && !labels;
            const g = ghost && !ghost.allDay ? onDay({ start: ghost.start, end: ghost.end } as Occurrence, d) : null;
            return (
              <div key={d} className="axp-cal-col" data-cal-col={d} onPointerDown={(e) => startDrag(e, 'create', null, hooks)}>
                {layoutDay(pieces).map((p) => (
                  <div
                    key={p.o.key} role="button" tabIndex={0} title={p.o.title}
                    className={`axp-cal-event axp-cal-tone--${p.o.tone}${p.o.kind === 'schedule' ? ' is-block' : ''}${ghost?.sourceKey === p.o.key ? ' is-source' : ''}`}
                    data-cal-key={p.o.key}
                    style={{ top: `${(p.from / 1440) * 100}%`, height: `${((p.to - p.from) / 1440) * 100}%`, left: `${(p.col / p.cols) * 100}%`, width: `${100 / p.cols}%` }}
                    onPointerDown={(e) => startDrag(e, 'move', p.o, hooks)}
                    onContextMenu={(e) => e.preventDefault()}
                    onKeyDown={(e) => { if (e.key === 'Enter') hooks.onTap(p.o, { date: d, minute: null }); }}
                  >
                    <span className="axp-cal-event__title">{p.o.title}</span>
                    <span className="axp-cal-event__time">{clock(p.from)}{p.o.location ? ` · ${p.o.location}` : ''}</span>
                    <span className="axp-cal-event__grip" aria-hidden onPointerDown={(e) => startDrag(e, 'resize', p.o, hooks)} />
                  </div>
                ))}
                {g && <div className={`axp-cal-event is-ghost axp-cal-tone--${ghost!.tone}`} style={{ top: `${(g.from / 1440) * 100}%`, height: `${((g.to - g.from) / 1440) * 100}%`, left: 0, width: '100%' }}><span className="axp-cal-event__title">{ghost!.title}</span><span className="axp-cal-event__time">{clock(minuteOf(ghost!.start))} to {clock(minuteOf(ghost!.end))}</span></div>}
                {nowOn && <div className="axp-cal-now" style={{ top: `${(minuteOf(now) / 1440) * 100}%` }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MonthGrid({ date, items, onDay: openDay }: { date: string; items: Occurrence[]; onDay: (d: string) => void }) {
  const hooks = useHooks();
  const ghost = useGhost();
  const cells = monthCells(date, WEEK_STARTS);
  const today = localDay();
  return (
    <div className="axp-cal-month">
      <div className="axp-cal-month__head">{DAY_NAMES.map((d) => <span key={d} className="fx-small fx-muted">{d}</span>)}</div>
      <div className="axp-cal-month__cells">
        {cells.map((d) => {
          const day = items.filter((o) => o.kind !== 'schedule' && onDay(o, d));
          const shown = day.slice(0, 3);
          return (
            <div key={d} className={`axp-cal-cell${d.slice(0, 7) !== date.slice(0, 7) ? ' is-other' : ''}${d === today ? ' is-today' : ''}${ghost?.start.slice(0, 10) === d ? ' is-over' : ''}`} data-cal-day={d}>
              <span role="button" tabIndex={0} className="axp-cal-cell__num" onClick={() => openDay(d)} onKeyDown={(e) => { if (e.key === 'Enter') openDay(d); }}>{Number(d.slice(8, 10))}</span>
              {shown.map((o) => <Chip key={o.key} o={o} hooks={hooks} />)}
              {day.length > shown.length && <span role="button" tabIndex={0} className="axp-cal-cell__more fx-small fx-muted" onClick={() => openDay(d)} onKeyDown={(e) => { if (e.key === 'Enter') openDay(d); }}>+{day.length - shown.length} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Agenda({ date, items }: { date: string; items: Occurrence[] }) {
  const hooks = useHooks();
  const days = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (let i = 0; i <= 30; i++) { const d = addDays(date, i); const on = items.filter((o) => onDay(o, d)); if (on.length) m.set(d, on); }
    return [...m.entries()];
  }, [date, items]);
  if (!days.length) return <div className="axp-cal-empty"><p>Nothing in the next 30 days.</p><p className="fx-small fx-muted">Type above to add something, or drag on the week.</p></div>;
  return (
    <div className="axp-cal-agenda axp-cal-scroll">
      {days.map(([d, on]) => (
        <section key={d} className="axp-cal-agenda__day" data-cal-day={d}>
          <h3 className="axp-cal-agenda__date">{niceDate(d)}</h3>
          {on.map((o) => (
            <div key={o.key} role="button" tabIndex={0} className={`axp-cal-row axp-cal-tone--${o.tone}`} data-cal-key={o.key} onPointerDown={(e) => startDrag(e, 'move', o, hooks)} onKeyDown={(e) => { if (e.key === 'Enter') hooks.onTap(o, { date: d, minute: null }); }}>
              <span className="axp-cal-row__bar" />
              <span className="axp-cal-row__time fx-small">{o.allDay ? 'All day' : clock(minuteOf(o.start))}</span>
              <span className="axp-cal-row__title">{o.kind === 'task' ? `${o.done ? '✓' : '○'} ` : ''}{o.title}</span>
              {o.location && <span className="fx-small fx-muted">{o.location}</span>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function MiniMonth({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(date);
  useEffect(() => setMonth(date), [date]);
  const { from, to } = viewRange('month', month, WEEK_STARTS);
  const items = useOccurrences(from, to);
  const busy = useMemo(() => new Set(items.flatMap((o) => (o.kind === 'schedule' ? [] : [o.start.slice(0, 10)]))), [items]);
  const today = localDay();
  return (
    <div className="axp-cal-mini" role="grid" aria-label="Pick a date">
      {DAY_NAMES.map((d) => <span key={d} className="axp-cal-mini__dow">{d[0]}</span>)}
      {monthCells(month, WEEK_STARTS).map((d) => (
        <span
          key={d} role="gridcell" tabIndex={0}
          className={`axp-cal-mini__day${d.slice(0, 7) !== month.slice(0, 7) ? ' is-other' : ''}${d === today ? ' is-today' : ''}${d === date ? ' is-picked' : ''}${busy.has(d) ? ' is-busy' : ''}`}
          onClick={() => onPick(d)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(d); }}
        >{Number(d.slice(8, 10))}</span>
      ))}
    </div>
  );
}

/** The one view a pane is on, with its entrance and horizontal swipe. */
export function CalendarBody({ view, date, only, onStep, onDay: openDay }: { view: CalView; date: string; only?: readonly string[]; onStep: (dir: number) => void; onDay: (d: string) => void }) {
  const { from, to } = viewRange(view, date, WEEK_STARTS);
  const items = useOccurrences(from, to, only);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const dir = useRef(0);
  const dates = useMemo(() => (view === 'day' ? [date] : view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(from, i)) : []), [view, date, from]);
  let body: ReactNode;
  if (view === 'month') body = <MonthGrid date={date} items={items} onDay={openDay} />;
  else if (view === 'agenda') body = <Agenda date={date} items={items} />;
  else body = <TimeGrid dates={dates} items={items} />;
  return (
    <div
      className="axp-cal-body"
      onTouchStart={(e) => { const t = e.touches[0]; swipe.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null; }}
      onTouchEnd={(e) => {
        const s = swipe.current; const t = e.changedTouches[0]; swipe.current = null;
        if (!s || !t || document.querySelector('.is-ghost')) return;
        const dx = t.clientX - s.x; const dy = t.clientY - s.y;
        if (Math.abs(dx) > window.innerWidth * 0.18 && Math.abs(dx) > Math.abs(dy) * 2) { dir.current = dx < 0 ? 1 : -1; onStep(dir.current); }
      }}
    >
      <div key={`${view}:${from}`} className={`axp-cal-stage${dir.current > 0 ? ' from-right' : dir.current < 0 ? ' from-left' : ''}`}>{body}</div>
    </div>
  );
}
