// @ts-nocheck: run by tsx, the console has no Node types
/** Calendar core: `npx -y tsx apps/console-web/plugins/notes-tasks/web/calendar/core.test.mts`. */
import { readFileSync } from 'node:fs';
import {
  addDays, addMonths, blankEvent, emptyCal, eventOccurrences, guestRows, layoutDay, monthCells, moveOccurrence, normalizeEvent, normalizeSchedule, occurrences, onDay, parseQuick,
  removeOccurrence, rsvpCounts, seriesDates, stamp, startOfWeek, viewRange, weekday, type Repeat, type Reply,
} from './core';

let fails = 0;
const ok = (c: boolean, what: string) => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${what}`); };
const eq = (a: unknown, b: unknown, what: string) => ok(JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b) ? what : `${what}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const fx = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));
for (const s of fx.series) eq(seriesDates(s.start, s.repeat, s.to), s.dates, `series: ${s.name}`);
for (const s of fx.status) {
  const e = blankEvent('e1', { title: 'x', start: '2026-11-09T18:00', guests: [{ id: 'g1', name: 'A', email: 'a@b.co' }] });
  const replies: Record<string, Reply> = Object.fromEntries(s.replies.map((r: Reply, i: number) => [`r${i}`, { ...r, id: `r${i}`, event: 'e1', guest: 'g1', name: 'A', message: '', source: 'page' }]));
  eq(guestRows(e, replies)[0]!.status, s.status, `status: ${s.name}`);
}

eq(weekday('2026-11-08'), 0, 'Nov 8 2026 is a Sunday');
eq(startOfWeek('2026-11-11'), '2026-11-08', 'week starts on Sunday');
eq(startOfWeek('2026-11-08', 1), '2026-11-02', 'week can start on Monday');
eq(addMonths('2026-01-31', 1), '2026-02-28', 'months clamp');
eq(stamp('2026-11-09', 1500), '2026-11-10T01:00', 'minutes roll into the next day');
eq(stamp('2026-11-09', -30), '2026-11-08T23:30', 'and back');
eq(monthCells('2026-11-11').length, 42, 'six weeks in a month grid');
eq(viewRange('week', '2026-11-11'), { from: '2026-11-08', to: '2026-11-14' }, 'week range');

const T = '2026-11-07'; // a Saturday
const q = (s: string) => parseQuick(s, T);
const weekly = (days: number[]): Repeat => ({ freq: 'weekly', interval: 1, days, until: '', count: 0 });
let g = q('gym every Mon Wed 6pm')!;
eq([g.title, g.start, g.end, g.repeat], ['Gym', '2026-11-09T18:00', '2026-11-09T19:00', weekly([1, 3])], 'the brief: gym every Mon Wed 6pm');
g = q('dentist tomorrow 3pm for 45m at Main St')!;
eq([g.title, g.start, g.end, g.location], ['Dentist', '2026-11-08T15:00', '2026-11-08T15:45', 'Main St'], 'time, length, place');
g = q('standup every weekday 9:30am')!;
eq([g.title, g.start, g.repeat?.days], ['Standup', '2026-11-09T09:30', [1, 2, 3, 4, 5]], 'every weekday');
g = q('lunch Friday noon #work')!;
eq([g.title, g.start, g.calendar], ['Lunch', '2026-11-13T12:00', 'work'], 'a day name, noon, a calendar');
g = q('review Dec 12 2-3pm')!;
eq([g.title, g.start, g.end], ['Review', '2026-12-12T14:00', '2026-12-12T15:00'], 'a month day and a range');
g = q('trip 12/24')!;
eq([g.title, g.allDay, g.start], ['Trip', true, '2026-12-24T00:00'], 'no time = all day');
g = q('pay rent every month')!;
eq([g.title, g.repeat?.freq], ['Pay rent', 'monthly'], 'every month');
g = q('call Sam at 3')!;
eq([g.title, g.start], ['Call Sam', '2026-11-07T15:00'], 'a bare hour reads as the afternoon');
g = q('next monday 10am sync')!;
eq([g.title, g.start], ['Sync', '2026-11-16T10:00'], 'next monday skips this one');
eq(q('6pm'), null, 'nothing to call it');

const e = blankEvent('e', { title: 'Gym', calendar: 'personal', start: '2026-11-09T18:00', end: '2026-11-09T19:00', repeat: weekly([1, 3]) });
const week = eventOccurrences(e, undefined, '2026-11-08', '2026-11-14');
eq(week.map((o) => o.date), ['2026-11-09', '2026-11-11'], 'two gym days');
const moved = moveOccurrence(e, '2026-11-11', '2026-11-12T07:00', '2026-11-12T08:00');
eq(eventOccurrences(moved, undefined, '2026-11-08', '2026-11-14').map((o) => o.start).sort(), ['2026-11-09T18:00', '2026-11-12T07:00'], 'moving one occurrence leaves the rest');
eq(eventOccurrences(moved, undefined, '2026-11-15', '2026-11-21').length, 2, 'the next week is untouched');
eq(eventOccurrences(removeOccurrence(e, '2026-11-09'), undefined, '2026-11-08', '2026-11-14').map((o) => o.date), ['2026-11-11'], 'removing one occurrence');
eq(moveOccurrence(blankEvent('o', { start: '2026-11-09T18:00' }), '2026-11-09', '2026-11-10T01:00', '2026-11-10T02:00').start, '2026-11-10T01:00', 'a single event just moves');
eq(eventOccurrences({ ...e, deletedAt: 'x' }, undefined, '2026-11-08', '2026-11-14').length, 0, 'a tombstone never shows');
const late = blankEvent('l', { start: '2026-11-08T23:00', end: '2026-11-09T01:00' });
const lo = eventOccurrences(late, undefined, '2026-11-09', '2026-11-09');
eq(lo.length, 1, 'an event over midnight shows on its second day');
eq(onDay(lo[0]!, '2026-11-09'), { from: 0, to: 60 }, 'with the right piece');

const cols = layoutDay([{ from: 60, to: 120 }, { from: 90, to: 150 }, { from: 200, to: 230 }]);
eq(cols.map((c) => [c.col, c.cols]), [[0, 2], [1, 2], [0, 1]], 'overlaps sit side by side, the rest full width');

const st = emptyCal();
st.calendars.personal = { id: 'personal', name: 'P', tone: 'success', hidden: false, google: '', order: 0, updatedAt: '' };
st.calendars.off = { id: 'off', name: 'O', tone: 'danger', hidden: true, google: '', order: 1, updatedAt: '' };
st.events.e = e;
st.events.h = blankEvent('h', { calendar: 'off', title: 'hidden', start: '2026-11-09T01:00' });
st.schedules.s = normalizeSchedule({ name: 'Work', calendar: 'personal', blocks: [{ id: 'b', day: 2, start: '09:00', end: '17:00', title: 'Office' }] }, 's')!;
const all = occurrences(st, [{ id: 't', kind: 'task', title: 'Ship', due: '2026-11-10', status: 'open' }, { id: 'n', kind: 'note', title: 'no', due: '2026-11-10', status: 'open' }], '2026-11-08', '2026-11-14');
eq(all.map((o) => o.kind), ['event', 'task', 'schedule', 'event'], 'events, schedule blocks and due tasks, in time order; notes and hidden calendars out');
eq(all[0]!.tone, 'success', 'an event takes its calendar\'s colour');

ok(normalizeEvent({ title: 'x', start: 'nope' }, 'bad') === null, 'a bad start is refused');
eq(normalizeEvent({ start: '2026-11-09T18:00', end: '2026-11-08T18:00' }, 'x')!.end, '2026-11-09T19:00', 'an end before the start is put right');
const guests = normalizeEvent({ start: '2026-11-09T18:00', guests: [{ id: 'a', email: 'A@B.co' }, { id: 'b', email: 'a@b.co' }, { id: 'c', email: 'nope' }] }, 'x')!.guests;
eq(guests.map((x) => x.email), ['a@b.co'], 'guests: lower case, no repeats, no bad addresses');
eq(rsvpCounts([{ status: 'yes' }, { status: 'no' }, { status: 'seen' }, { status: 'invited' }]).replied, 2, 'counts: seen isn\'t a reply');
eq(addDays('2026-12-31', 1), '2027-01-01', 'year turnover');
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('all good');
