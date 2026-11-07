/**
 * Calendar core (amberx-calendar@1): pure rules, shared by the console and AmberX. No React, no hub. The server's
 * `server/calendar_core.py` is this file's recurrence and RSVP rules in Python (reminders run with no browser open);
 * `fixture.json` is what both must produce.
 *
 * Times are wall-clock: `2026-11-09T18:00` in the event's `tz`. "6pm" stays 6pm across a clock change, and a screen shows
 * what the event says. The server turns them into instants only to fire reminders and to talk to Google.
 *
 * Rows: calendars, events, schedules (weekly templates of blocks), layouts (saved window boards) are written by the
 * apps; replies (the RSVP log) and mail (what was emailed) are written only by the console server, so a guest's answer
 * can't be lost to an app saving an event at the same moment.
 */

export const CAL_FOLDER = 'amberx-calendar';
export const TABLES = ['calendars', 'events', 'schedules', 'layouts', 'replies', 'mail'] as const;
export type TableName = (typeof TABLES)[number];
export const SERVER_TABLES: readonly TableName[] = ['replies', 'mail'];
export const TONES = ['accent', 'info', 'success', 'warning', 'danger', 'muted'] as const;
export type Tone = (typeof TONES)[number];
export const VIEWS = ['day', 'week', 'month', 'agenda'] as const;
export type CalView = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<CalView, string> = { day: 'Day', week: 'Week', month: 'Month', agenda: 'Agenda' };
export const isView = (v: unknown): v is CalView => (VIEWS as readonly unknown[]).includes(v);

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface Repeat { freq: Freq; interval: number; days: number[]; until: string; count: number }
export type GuestStatus = 'invited' | 'yes' | 'no' | 'maybe' | 'seen';
export const GUEST_LABEL: Record<GuestStatus, string> = { invited: 'Invited', yes: 'Yes', no: 'No', maybe: 'Maybe', seen: 'Seen' };
export interface Guest { id: string; name: string; email: string }
export interface Rsvp { on: boolean; remindHours: number[]; askSeen: boolean }
export interface Calendar { id: string; name: string; tone: Tone; hidden: boolean; google: string; order: number; updatedAt: string }
export interface CalEvent {
  id: string; calendar: string; title: string; location: string; notes: string;
  start: string; end: string; allDay: boolean; tz: string;
  repeat: Repeat | null;
  /** dates of occurrences taken out */
  except: string[];
  /** one occurrence moved or renamed, by its own date */
  overrides: Record<string, { start: string; end: string; title?: string }>;
  /** minutes before */
  reminders: number[];
  guests: Guest[];
  rsvp: Rsvp;
  gcalId: string; gcalHash: string; gcalPending: string; syncedAt: string;
  /** a Google-linked event deleted here stays as a tombstone until Google has it too */
  deletedAt: string;
  createdAt: string; updatedAt: string; by: string;
}
export interface Block { id: string; day: number; start: string; end: string; title: string; tone: Tone | '' }
export interface Schedule { id: string; name: string; calendar: string; active: boolean; from: string; until: string; tz: string; reminders: number[]; blocks: Block[]; updatedAt: string; by: string }
export interface Reply { id: string; event: string; guest: string; name: string; at: string; answer: GuestStatus | ''; message: string; source: 'page' | 'email' }
export type MailKind = 'invite' | 'reminder' | 'seen';
export interface Mail { id: string; event: string; guest: string; to: string; kind: MailKind; subject: string; status: 'queued' | 'held' | 'sent' | 'failed'; at: string; job: string; error: string }
export interface SavedLayout { id: string; name: string; snapshot: unknown; panes: Record<string, PaneState>; updatedAt: string }
export interface PaneState { view: CalView; date: string; calendars: string[] }

export interface CalStore {
  calendars: Record<string, Calendar>; events: Record<string, CalEvent>; schedules: Record<string, Schedule>;
  layouts: Record<string, SavedLayout>; replies: Record<string, Reply>; mail: Record<string, Mail>;
}
export const emptyCal = (): CalStore => ({ calendars: {}, events: {}, schedules: {}, layouts: {}, replies: {}, mail: {} });

/* ---------------------------------------------------------------- dates: strings in, strings out */

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const dayNum = (d: string): number => { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y!, m! - 1, dd!) / DAY_MS); };
export const dayStr = (n: number): string => { const d = new Date(n * DAY_MS); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const addDays = (d: string, n: number) => dayStr(dayNum(d) + n);
export const weekday = (d: string) => ((dayNum(d) + 4) % 7 + 7) % 7;
export const startOfWeek = (d: string, first = 0) => addDays(d, -((weekday(d) - first + 7) % 7));
export const localDay = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const localTime = (now = new Date()) => `${localDay(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayStr(dayNum(s)) === s;
export const isTime = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && isDate(s.slice(0, 10)) && Number(s.slice(11, 13)) < 24 && Number(s.slice(14, 16)) < 60;
export const minuteOf = (t: string) => (t.length > 10 ? Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)) : 0);
export const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const stamp = (date: string, min: number) => {
  const whole = ((min % 1440) + 1440) % 1440;
  return `${addDays(date, Math.floor(min / 1440))}T${hhmm(whole)}`;
};
/** Whole minutes from one wall-clock time to another. */
export const span = (a: string, b: string) => (dayNum(b) - dayNum(a)) * 1440 + minuteOf(b) - minuteOf(a);
export const shiftTime = (t: string, minutes: number) => stamp(t.slice(0, 10), minuteOf(t) + minutes);
export const addMonths = (d: string, n: number) => {
  const [y, m] = d.split('-').map(Number);
  const i = y! * 12 + (m! - 1) + n;
  const yy = Math.floor(i / 12); const mm = i - yy * 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(Number(d.slice(8, 10)), last))}`;
};
export const clock = (min: number) => {
  const h = Math.floor(min / 60) % 24; const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${pad(m)}` : ''}${h < 12 ? 'am' : 'pm'}`;
};
export const niceDate = (d: string) => `${DAY_NAMES[weekday(d)]} ${MONTH_NAMES[Number(d.slice(5, 7)) - 1]!.slice(0, 3)} ${Number(d.slice(8, 10))}`;
export const niceMonth = (d: string) => `${MONTH_NAMES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
export const niceWhen = (e: Pick<CalEvent, 'start' | 'end' | 'allDay'>) => (e.allDay
  ? niceDate(e.start)
  : `${niceDate(e.start)}, ${clock(minuteOf(e.start))} to ${clock(minuteOf(e.end))}`);

/* ---------------------------------------------------------------- rows from the hub, checked */

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const nums = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0) : []);
const tone = (v: unknown): Tone => ((TONES as readonly unknown[]).includes(v) ? (v as Tone) : 'accent');
export const defaultTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

export function normalizeRepeat(raw: unknown): Repeat | null {
  const r = raw as Partial<Repeat> | null;
  if (!r || !['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq as string)) return null;
  return {
    freq: r.freq as Freq, interval: Math.max(1, Math.min(99, Math.floor(Number(r.interval) || 1))),
    days: [...new Set(nums(r.days).filter((d) => d < 7).map(Math.floor))].sort((a, b) => a - b),
    until: isDate(r.until) ? r.until : '', count: Math.max(0, Math.floor(Number(r.count) || 0)),
  };
}
export function normalizeCalendar(raw: unknown, id: string): Calendar | null {
  const c = raw as Partial<Calendar> | null;
  if (!c || typeof c !== 'object') return null;
  return { id, name: str(c.name, 80) || 'Calendar', tone: tone(c.tone), hidden: c.hidden === true, google: str(c.google, 200), order: Number(c.order) || 0, updatedAt: str(c.updatedAt, 40) };
}
export function normalizeEvent(raw: unknown, id: string): CalEvent | null {
  const e = raw as Partial<CalEvent> | null;
  if (!e || typeof e !== 'object') return null;
  const allDay = e.allDay === true;
  const start = allDay && isDate(e.start) ? `${e.start}T00:00` : e.start;
  if (!isTime(start)) return null;
  const rawEnd = allDay && isDate(e.end) ? `${e.end}T00:00` : e.end;
  const end = isTime(rawEnd) && span(start, rawEnd) >= 0 ? rawEnd : shiftTime(start, allDay ? 0 : 60);
  const overrides: CalEvent['overrides'] = {};
  for (const [d, o] of Object.entries(e.overrides ?? {})) if (isDate(d) && isTime(o?.start) && isTime(o?.end)) overrides[d] = { start: o.start, end: o.end, ...(o.title ? { title: str(o.title, 160) } : {}) };
  return {
    id, calendar: str(e.calendar, 80) || 'personal', title: str(e.title, 160) || 'Untitled', location: str(e.location, 200), notes: str(e.notes, 8000),
    start, end, allDay, tz: str(e.tz, 60) || defaultTz(), repeat: normalizeRepeat(e.repeat),
    except: Array.isArray(e.except) ? e.except.filter(isDate) : [], overrides,
    reminders: [...new Set(nums(e.reminders))], guests: normalizeGuests(e.guests),
    rsvp: { on: e.rsvp?.on === true, remindHours: nums(e.rsvp?.remindHours), askSeen: e.rsvp?.askSeen === true },
    gcalId: str(e.gcalId, 200), gcalHash: str(e.gcalHash, 80), gcalPending: str(e.gcalPending, 80), syncedAt: str(e.syncedAt, 40),
    deletedAt: str(e.deletedAt, 40), createdAt: str(e.createdAt, 40), updatedAt: str(e.updatedAt, 40), by: str(e.by, 80),
  };
}
export const validEmail = (s: string) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s);
function normalizeGuests(raw: unknown): Guest[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Guest[] = [];
  for (const g of raw as Partial<Guest>[]) {
    const email = str(g?.email, 200).trim().toLowerCase();
    const id = str(g?.id, 40);
    if (!id || !validEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ id, email, name: str(g?.name, 120).trim() });
  }
  return out;
}
export function normalizeSchedule(raw: unknown, id: string): Schedule | null {
  const s = raw as Partial<Schedule> | null;
  if (!s || typeof s !== 'object') return null;
  const blocks = (Array.isArray(s.blocks) ? s.blocks : []).flatMap((b): Block[] => {
    const start = str(b?.start, 5); const end = str(b?.end, 5);
    if (!/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end) || end <= start) return [];
    return [{ id: str(b?.id, 40) || `b-${start}-${b?.day}`, day: Math.max(0, Math.min(6, Math.floor(Number(b?.day) || 0))), start, end, title: str(b?.title, 120) || 'Block', tone: (TONES as readonly unknown[]).includes(b?.tone) ? (b.tone as Tone) : '' }];
  });
  return { id, name: str(s.name, 80) || 'Weekly schedule', calendar: str(s.calendar, 80) || 'personal', active: s.active !== false, from: isDate(s.from) ? s.from : '', until: isDate(s.until) ? s.until : '', tz: str(s.tz, 60) || defaultTz(), reminders: [...new Set(nums(s.reminders))], blocks, updatedAt: str(s.updatedAt, 40), by: str(s.by, 80) };
}
export function normalizeReply(raw: unknown, id: string): Reply | null {
  const r = raw as Partial<Reply> | null;
  if (!r || typeof r !== 'object' || !str(r.event)) return null;
  const answer = (['yes', 'no', 'maybe', 'seen'] as unknown[]).includes(r.answer) ? (r.answer as GuestStatus) : '';
  return { id, event: str(r.event, 80), guest: str(r.guest, 40), name: str(r.name, 120), at: str(r.at, 40), answer, message: str(r.message, 2000), source: r.source === 'email' ? 'email' : 'page' };
}
export function normalizeMail(raw: unknown, id: string): Mail | null {
  const m = raw as Partial<Mail> | null;
  if (!m || typeof m !== 'object' || !str(m.event)) return null;
  const kind = (['invite', 'reminder', 'seen'] as unknown[]).includes(m.kind) ? (m.kind as MailKind) : 'invite';
  const status = (['queued', 'held', 'sent', 'failed'] as unknown[]).includes(m.status) ? (m.status as Mail['status']) : 'queued';
  return { id, event: str(m.event, 80), guest: str(m.guest, 40), to: str(m.to, 200), kind, subject: str(m.subject, 200), status, at: str(m.at, 40), job: str(m.job, 80), error: str(m.error, 300) };
}
export function normalizeLayout(raw: unknown, id: string): SavedLayout | null {
  const l = raw as Partial<SavedLayout> | null;
  if (!l || typeof l !== 'object' || !l.snapshot) return null;
  return { id, name: str(l.name, 80) || 'Layout', snapshot: l.snapshot, panes: (l.panes ?? {}) as SavedLayout['panes'], updatedAt: str(l.updatedAt, 40) };
}
export const NORMALIZE = { calendars: normalizeCalendar, events: normalizeEvent, schedules: normalizeSchedule, layouts: normalizeLayout, replies: normalizeReply, mail: normalizeMail } as const;

export const blankEvent = (id: string, p: Partial<CalEvent>): CalEvent => normalizeEvent({ id, calendar: 'personal', tz: defaultTz(), ...p }, id)!;

/** New stores get one calendar to put things in; nothing else is ever seeded. */
export function ensureDefaults(s: CalStore): boolean {
  if (Object.keys(s.calendars).length) return false;
  s.calendars.personal = { id: 'personal', name: 'Personal', tone: 'accent', hidden: false, google: '', order: 0, updatedAt: '' };
  return true;
}

/* ---------------------------------------------------------------- occurrences */

export interface Occurrence {
  /** unique on screen: `<source id>|<date>` */
  key: string;
  kind: 'event' | 'schedule' | 'task';
  /** the event, schedule or item id */
  source: string;
  /** the date this occurrence belongs to in its series */
  date: string;
  title: string; start: string; end: string; allDay: boolean;
  calendar: string; tone: Tone; location: string;
  repeating: boolean;
  block?: string;
  done?: boolean;
}

/** The series dates of an event, in order, from its first date up to `to` (inclusive), before exceptions. */
export function seriesDates(start: string, repeat: Repeat | null, to: string): string[] {
  const first = start.slice(0, 10);
  if (!repeat) return first <= to ? [first] : [];
  const last = repeat.until && repeat.until < to ? repeat.until : to;
  const out: string[] = [];
  const cap = repeat.count || 100_000;
  if (repeat.freq === 'weekly') {
    const days = repeat.days.length ? repeat.days : [weekday(first)];
    const anchor = startOfWeek(first);
    for (let w = 0; out.length < cap; w += repeat.interval) {
      const base = addDays(anchor, w * 7);
      if (base > last) break;
      for (const d of days) {
        const date = addDays(base, d);
        if (date < first || date > last) continue;
        if (out.length < cap) out.push(date);
      }
    }
    return out;
  }
  for (let i = 0; out.length < cap && i < 100_000; i += repeat.interval) {
    const date = repeat.freq === 'daily' ? addDays(first, i) : addMonths(first, repeat.freq === 'monthly' ? i : i * 12);
    if (date > last) break;
    // the 31st repeats on months that have one; Feb 29 on leap years
    if (repeat.freq !== 'daily' && date.slice(8, 10) !== first.slice(8, 10)) continue;
    out.push(date);
  }
  return out;
}

export function eventOccurrences(e: CalEvent, cal: Calendar | undefined, from: string, to: string): Occurrence[] {
  if (e.deletedAt) return [];
  const length = span(e.start, e.end);
  const days = Math.ceil(length / 1440) + 1;
  const out: Occurrence[] = [];
  const base = { kind: 'event' as const, source: e.id, allDay: e.allDay, calendar: e.calendar, tone: cal?.tone ?? 'accent', location: e.location, repeating: !!e.repeat };
  const moved = Object.entries(e.overrides);
  for (const date of seriesDates(e.start, e.repeat, to)) {
    if (e.except.includes(date) || e.overrides[date]) continue;
    if (dayNum(date) + days <= dayNum(from)) continue;
    const start = `${date}T${e.start.slice(11)}`;
    out.push({ ...base, key: `${e.id}|${date}`, date, title: e.title, start, end: shiftTime(start, length) });
  }
  for (const [date, o] of moved) {
    if (e.except.includes(date) || o.start.slice(0, 10) > to || o.end.slice(0, 10) < from) continue;
    out.push({ ...base, key: `${e.id}|${date}`, date, title: o.title ?? e.title, start: o.start, end: o.end });
  }
  return out;
}

export function scheduleOccurrences(s: Schedule, cal: Calendar | undefined, from: string, to: string): Occurrence[] {
  if (!s.active) return [];
  const out: Occurrence[] = [];
  const a = s.from && s.from > from ? s.from : from;
  const b = s.until && s.until < to ? s.until : to;
  for (let n = dayNum(a); n <= dayNum(b); n++) {
    const date = dayStr(n); const day = weekday(date);
    for (const bl of s.blocks) {
      if (bl.day !== day) continue;
      out.push({ key: `sch:${s.id}:${bl.id}|${date}`, kind: 'schedule', source: s.id, block: bl.id, date, title: bl.title, start: `${date}T${bl.start}`, end: `${date}T${bl.end}`, allDay: false, calendar: s.calendar, tone: bl.tone || cal?.tone || 'accent', location: '', repeating: true });
    }
  }
  return out;
}

/** The part of the notes store this reads: any item with a due date and a kind of task or to-do. */
export interface DueItem { id: string; kind: string; title: string; due: string; status: string; parent?: string }
export function taskOccurrences(items: readonly DueItem[], from: string, to: string): Occurrence[] {
  return items.flatMap((i): Occurrence[] => {
    const date = i.due?.slice(0, 10);
    if ((i.kind !== 'task' && i.kind !== 'todo') || !isDate(date) || date < from || date > to) return [];
    return [{ key: `task:${i.id}|${date}`, kind: 'task', source: i.id, date, title: i.title, start: `${date}T00:00`, end: `${date}T00:00`, allDay: true, calendar: 'tasks', tone: 'info', location: '', repeating: false, done: i.status === 'done' }];
  });
}

export function occurrences(s: CalStore, items: readonly DueItem[], from: string, to: string, only?: readonly string[]): Occurrence[] {
  const shown = (id: string) => (only?.length ? only.includes(id) : !s.calendars[id]?.hidden);
  const out = [
    ...Object.values(s.events).filter((e) => shown(e.calendar)).flatMap((e) => eventOccurrences(e, s.calendars[e.calendar], from, to)),
    ...Object.values(s.schedules).filter((x) => shown(x.calendar)).flatMap((x) => scheduleOccurrences(x, s.calendars[x.calendar], from, to)),
    ...(shown('tasks') ? taskOccurrences(items, from, to) : []),
  ];
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** An occurrence's piece on one day: the minutes it covers there, 0..1440. Null when it isn't on that day. */
export function onDay(o: Occurrence, date: string): { from: number; to: number } | null {
  const a = o.start.slice(0, 10); const b = o.end.slice(0, 10);
  if (date < a || date > b) return null;
  if (date === b && a !== b && minuteOf(o.end) === 0) return null; // ends at midnight: nothing on the last day
  return { from: date === a ? minuteOf(o.start) : 0, to: date === b ? minuteOf(o.end) : 1440 };
}

/** Side-by-side columns for what overlaps. Each piece gets its column and how many columns its cluster has. */
export function layoutDay<T extends { from: number; to: number }>(pieces: readonly T[]): (T & { col: number; cols: number })[] {
  const sorted = [...pieces].sort((a, b) => a.from - b.from || b.to - a.to);
  const out: (T & { col: number; cols: number })[] = [];
  let cluster: (T & { col: number; cols: number })[] = [];
  let reach = -1;
  const close = () => { const n = cluster.reduce((m, p) => Math.max(m, p.col + 1), 0); cluster.forEach((p) => { p.cols = n; }); cluster = []; };
  for (const p of sorted) {
    if (p.from >= reach) { close(); reach = -1; }
    const used = new Set(cluster.filter((c) => c.to > p.from).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    const placed = { ...p, col, cols: 1 };
    cluster.push(placed); out.push(placed);
    reach = Math.max(reach, Math.max(p.to, p.from + 15));
  }
  close();
  return out;
}

export const monthCells = (d: string, first = 0): string[] => {
  const start = startOfWeek(`${d.slice(0, 7)}-01`, first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
};
/** The dates a view shows around `d`. */
export function viewRange(view: CalView, d: string, first = 0): { from: string; to: string } {
  if (view === 'day') return { from: d, to: d };
  if (view === 'week') { const from = startOfWeek(d, first); return { from, to: addDays(from, 6) }; }
  if (view === 'month') { const c = monthCells(d, first); return { from: c[0]!, to: c[41]! }; }
  return { from: d, to: addDays(d, 30) };
}
export const stepDate = (view: CalView, d: string, dir: number) => (view === 'day' ? addDays(d, dir) : view === 'week' ? addDays(d, dir * 7) : view === 'month' ? addMonths(d, dir) : addDays(d, dir * 30));
export const viewTitle = (view: CalView, d: string, first = 0) => {
  if (view === 'day') return niceDate(d);
  if (view === 'month') return niceMonth(d);
  const { from, to } = viewRange(view, d, first);
  return from.slice(0, 7) === to.slice(0, 7) ? `${niceDate(from).slice(4)} to ${Number(to.slice(8, 10))}` : `${niceDate(from).slice(4)} to ${niceDate(to).slice(4)}`;
};
/** Snap to a grid of `step` minutes. */
export const snap = (min: number, step = 15) => Math.round(min / step) * step;

/* ---------------------------------------------------------------- changes (on a copy) */

/** Moves an event, or just this occurrence of a repeating one. The other occurrences stay. */
export function moveOccurrence(e: CalEvent, date: string, start: string, end: string): CalEvent {
  if (!e.repeat) return { ...e, start, end };
  return { ...e, overrides: { ...e.overrides, [date]: { ...e.overrides[date], start, end } } };
}
export function removeOccurrence(e: CalEvent, date: string): CalEvent {
  const { [date]: _gone, ...overrides } = e.overrides;
  return { ...e, except: [...new Set([...e.except, date])], overrides };
}

/* ---------------------------------------------------------------- RSVP */

export interface GuestRow extends Guest { status: GuestStatus; seenAt: string; repliedAt: string; message: string; log: Reply[]; mailed: Mail[] }
/** A guest's status comes from what they answered: the latest yes / no / maybe wins, "seen" never takes one back. */
export function guestRows(e: CalEvent, replies: Record<string, Reply>, mail: Record<string, Mail> = {}): GuestRow[] {
  const all = Object.values(replies).filter((r) => r.event === e.id).sort((a, b) => a.at.localeCompare(b.at));
  const sent = Object.values(mail).filter((m) => m.event === e.id).sort((a, b) => a.at.localeCompare(b.at));
  return e.guests.map((g) => {
    const log = all.filter((r) => r.guest === g.id);
    const answers = log.filter((r) => r.answer && r.answer !== 'seen');
    const last = answers[answers.length - 1];
    const seen = log.filter((r) => r.answer === 'seen')[0];
    const said = [...log].reverse().find((r) => r.message);
    return { ...g, status: last?.answer || (seen ? 'seen' : 'invited'), seenAt: seen?.at ?? '', repliedAt: last?.at ?? '', message: said?.message ?? '', log, mailed: sent.filter((m) => m.guest === g.id) };
  });
}
export function rsvpCounts(rows: readonly { status: GuestStatus }[]): Record<GuestStatus, number> & { total: number; replied: number } {
  const c = { invited: 0, yes: 0, no: 0, maybe: 0, seen: 0 };
  for (const r of rows) c[r.status]++;
  return { ...c, total: rows.length, replied: c.yes + c.no + c.maybe };
}

/* ---------------------------------------------------------------- quick add: plain English */

const DAY_WORDS: Record<string, number> = { sun: 0, sunday: 0, sundays: 0, mon: 1, monday: 1, mondays: 1, tue: 2, tues: 2, tuesday: 2, tuesdays: 2, wed: 3, weds: 3, wednesday: 3, wednesdays: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4, fri: 5, friday: 5, fridays: 5, sat: 6, saturday: 6, saturdays: 6 };
const MONTH_WORDS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_RE = Object.keys(DAY_WORDS).sort((a, b) => b.length - a.length).join('|');
const TIME_RE = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?`;

export interface Quick { title: string; start: string; end: string; allDay: boolean; location: string; repeat: Repeat | null; calendar: string }

const to24 = (h: number, ap: string | undefined, hint?: string) => {
  const p = ap?.[0] ?? hint;
  if (p === 'p') return h === 12 ? 12 : h + 12;
  if (p === 'a') return h === 12 ? 0 : h;
  return h;
};
const nextOn = (today: string, day: number, skip: boolean) => {
  const d = (day - weekday(today) + 7) % 7;
  return addDays(today, d === 0 && skip ? 7 : d);
};

/**
 * 'gym every Mon Wed 6pm', 'dentist tomorrow 3pm for 45m at Main St', 'standup every weekday 9:30am', 'lunch Friday
 * noon #work', 'review Dec 12 2-3pm', 'trip 12/24'. Null when nothing is left to call it. No time = all day.
 */
export function parseQuick(input: string, today: string): Quick | null {
  let t = ` ${input.trim().replace(/\s+/g, ' ')} `;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => { const m = t.match(re); if (m) { t = t.replace(m[0], ' '); fn(m); } return !!m; };
  let calendar = ''; let location = ''; let date = ''; let repeat: Repeat | null = null;
  let from = -1; let to = -1; let dur = 0;

  take(/\s#([\w-]+)/i, (m) => { calendar = m[1]!.toLowerCase(); });
  take(/\sfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i, (m) => { dur = Number(m[1]) * (m[2]![0]!.toLowerCase() === 'h' ? 60 : 1); });

  // every ...
  take(new RegExp(String.raw`\s(?:every|each)\s+((?:other\s+)?(?:day|weekday|weekdays|weekend|week|month|year|(?:(?:${DAY_RE})(?:\s*(?:,|and|&)?\s*)?)+))(?=\s)`, 'i'), (m) => {
    const w = m[1]!.toLowerCase();
    const interval = w.startsWith('other') ? 2 : 1;
    const rest = w.replace(/^other\s+/, '');
    if (rest === 'day') repeat = { freq: 'daily', interval, days: [], until: '', count: 0 };
    else if (rest === 'week') repeat = { freq: 'weekly', interval, days: [], until: '', count: 0 };
    else if (rest === 'month') repeat = { freq: 'monthly', interval, days: [], until: '', count: 0 };
    else if (rest === 'year') repeat = { freq: 'yearly', interval, days: [], until: '', count: 0 };
    else if (rest.startsWith('weekday')) repeat = { freq: 'weekly', interval, days: [1, 2, 3, 4, 5], until: '', count: 0 };
    else if (rest === 'weekend') repeat = { freq: 'weekly', interval, days: [0, 6], until: '', count: 0 };
    else {
      const days = [...new Set((rest.match(new RegExp(DAY_RE, 'g')) ?? []).map((d) => DAY_WORDS[d]!))].sort((a, b) => a - b);
      repeat = { freq: 'weekly', interval, days, until: '', count: 0 };
    }
  });
  take(/\suntil\s+(\d{4}-\d{2}-\d{2})\b/i, (m) => { if (repeat) (repeat as Repeat).until = m[1]!; });

  // time: 2-3pm, 6pm, 18:00, noon, midnight
  take(new RegExp(String.raw`\s(?:from\s+|at\s+|@\s*)?${TIME_RE}\s*(?:-|–|to)\s*${TIME_RE}(?=\s)`, 'i'), (m) => {
    if (!m[3] && !m[6] && !m[2] && !m[5]) { t = ` ${m[0]} ${t}`; return; }
    const end = to24(Number(m[4]), m[6], undefined);
    const hint = (m[6]?.[0] ?? '').toLowerCase();
    let start = to24(Number(m[1]), m[3], hint);
    if (!m[3] && hint === 'p' && start > end) start -= 12;
    from = start * 60 + Number(m[2] ?? 0); to = end * 60 + Number(m[5] ?? 0);
  });
  if (from < 0) take(/\s(?:at\s+|@\s*)?(noon|midnight)(?=\s)/i, (m) => { from = m[1]!.toLowerCase() === 'noon' ? 720 : 0; });
  if (from < 0) take(new RegExp(String.raw`\s(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)(?=\s)`, 'i'), (m) => { from = to24(Number(m[1]), m[3]!.toLowerCase()) * 60 + Number(m[2] ?? 0); });
  if (from < 0) take(/\s(?:at\s+|@\s*)?(\d{1,2}):(\d{2})(?=\s)/i, (m) => { from = Number(m[1]) * 60 + Number(m[2]); });
  if (from < 0) take(/\s(?:at|@)\s*(\d{1,2})(?=\s)/i, (m) => { const h = Number(m[1]); from = (h < 8 ? h + 12 : h) * 60; });
  if (from >= 1440) return null;

  // the place: "at X" up to the end of what's left
  take(/\s(?:at|@)\s+([^#]+?)\s*$/i, (m) => { location = m[1]!.trim(); });

  // date
  take(/\s(today)(?=\s)/i, () => { date = today; });
  if (!date) take(/\s(tomorrow|tmrw|tmr)(?=\s)/i, () => { date = addDays(today, 1); });
  if (!date) take(/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m) => { if (isDate(m[1])) date = m[1]!; });
  if (!date) take(new RegExp(String.raw`\s(?:on\s+)?((?:next)\s+)?(${DAY_RE})(?=\s)`, 'i'), (m) => { date = nextOn(today, DAY_WORDS[m[2]!.toLowerCase()]!, !!m[1]); if (m[1] && (dayNum(date) - dayNum(today)) < 7) date = addDays(date, 7); });
  if (!date) take(new RegExp(String.raw`\s(?:on\s+)?(${MONTH_WORDS.join('|')})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?=\s)`, 'i'), (m) => { date = yearly(today, MONTH_WORDS.indexOf(m[1]!.toLowerCase().slice(0, 3)) + 1, Number(m[2])); });
  if (!date) take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?=\s)/, (m) => { date = yearly(today, Number(m[1]), Number(m[2])); });

  const title = t.trim().replace(/\s+/g, ' ').replace(/\s+(on|at|from|every)$/i, '');
  if (!title) return null;
  const rep = repeat as Repeat | null;
  if (!date) date = rep?.days.length ? firstOf(today, rep.days) : today;
  else if (rep?.days.length && !rep.days.includes(weekday(date))) date = firstOf(date, rep.days);
  const allDay = from < 0;
  const minutes = allDay ? 0 : from;
  const length = !allDay && to >= 0 ? (to > from ? to - from : to + 1440 - from) : dur || 60;
  const start = stamp(date, minutes);
  return { title: title[0]!.toUpperCase() + title.slice(1), start, end: allDay ? start : shiftTime(start, length), allDay, location, repeat: rep, calendar };
}
const firstOf = (d: string, days: number[]) => { for (let i = 0; i < 7; i++) if (days.includes(weekday(addDays(d, i)))) return addDays(d, i); return d; };
function yearly(today: string, month: number, day: number): string {
  const y = Number(today.slice(0, 4));
  const d = `${y}-${pad(month)}-${pad(day)}`;
  if (!isDate(d)) return today;
  return d < today ? `${y + 1}-${pad(month)}-${pad(day)}` : d;
}
export const repeatLabel = (r: Repeat | null): string => {
  if (!r) return '';
  const each = r.interval > 1 ? `Every ${r.interval} ` : 'Every ';
  if (r.freq === 'weekly') {
    const days = r.days.map((d) => DAY_NAMES[d]).join(' ');
    return `${each}${r.interval > 1 ? 'weeks' : 'week'}${days ? ` on ${days}` : ''}`;
  }
  const unit = { daily: 'day', monthly: 'month', yearly: 'year' }[r.freq];
  return `${each}${unit}${r.interval > 1 ? 's' : ''}`;
};
export const reminderLabel = (m: number) => (m === 0 ? 'At the start' : m < 60 ? `${m} min before` : m < 1440 ? `${m / 60} h before` : `${m / 1440} d before`);
