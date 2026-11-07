/** What taps and drops do, wherever they came from. */
import type { AxfRuntime } from '@console/axf/core';
import { mutate as mutateNotes, snapshot as notesSnapshot } from '../notes/store';
import { updateItem } from '../notes/core';
import { blankEvent, defaultTz, hhmm, localDay, minuteOf, moveOccurrence, parseQuick, shiftTime, stamp, weekday, type CalEvent, type Occurrence, type Quick } from './core';
import type { Commit } from './drag';
import { byWhom, calSnapshot, mutateCal } from './store';

export const DIALOG = { event: 'calendar.event', block: 'calendar.block', calendar: 'calendar.calendar', layouts: 'calendar.layouts' } as const;
export const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function openOccurrence(rt: AxfRuntime, o: Occurrence) {
  if (o.kind === 'event') rt.openDialog(DIALOG.event, { id: o.source, date: o.date });
  else if (o.kind === 'schedule') rt.openDialog(DIALOG.block, { schedule: o.source, block: o.block });
  else rt.openDialog('tasks.edit', { id: o.source });
}
export function openNew(rt: AxfRuntime, date: string, minute: number | null) {
  const start = minute == null ? `${date}T00:00` : stamp(date, Math.floor(minute / 30) * 30);
  rt.openDialog(DIALOG.event, { start, end: minute == null ? start : shiftTime(start, 60), allDay: minute == null });
}

/** A finished drag: a new event, or the thing that was dragged takes its new time. Repeats move one occurrence. */
export function commitDrop(rt: AxfRuntime, c: Commit) {
  const { occ } = c;
  if (!occ) { rt.openDialog(DIALOG.event, { start: c.start, end: c.end, allDay: c.allDay }); return; }
  if (occ.kind === 'task') {
    const id = occ.source;
    if (notesSnapshot().own.items[id]) mutateNotes((s) => updateItem(s, id, { due: c.start.slice(0, 10) }, new Date().toISOString()));
    return;
  }
  if (occ.kind === 'schedule') {
    mutateCal((s) => {
      const b = s.schedules[occ.source]?.blocks.find((x) => x.id === occ.block);
      if (b && !c.allDay) { b.day = weekday(c.start); b.start = hhmm(minuteOf(c.start)); b.end = hhmm(Math.min(1439, minuteOf(c.end) || 1439)); }
    });
    return;
  }
  mutateCal((s) => {
    const e = s.events[occ.source];
    if (e) s.events[occ.source] = { ...moveOccurrence(e, occ.date, c.start, c.end), allDay: e.repeat ? e.allDay : c.allDay, by: byWhom() };
  });
}

/** Files what quick add understood. Returns the event, or null when there's nothing to call it. */
export function addQuick(q: Quick): CalEvent {
  const id = newId('e');
  const { store } = calSnapshot();
  const cal = Object.values(store.calendars).find((c) => c.id === q.calendar || c.name.toLowerCase() === q.calendar)?.id ?? (Object.keys(store.calendars)[0] ?? 'personal');
  const at = new Date().toISOString();
  const e = blankEvent(id, { title: q.title, start: q.start, end: q.end, allDay: q.allDay, location: q.location, repeat: q.repeat, calendar: cal, tz: defaultTz(), createdAt: at, by: byWhom() });
  mutateCal((s) => { s.events[id] = e; });
  return e;
}
export function quickFromText(text: string, today = localDay()): CalEvent | null {
  const q = parseQuick(text, today);
  return q ? addQuick(q) : null;
}
