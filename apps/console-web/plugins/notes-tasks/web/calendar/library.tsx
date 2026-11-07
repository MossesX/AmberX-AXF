/**
 * The Calendar part of the plugin: view, dialogs, the window's pane, actions and voice phrases. `calendar.add:<text>`
 * takes plain English (Amber's console_action and AmberX voice commands both land there).
 */
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react';
import { CalendarView, KEY_VIEW, setCalUi } from './CalendarPage';
import { BoardPane, LayoutsDialog, PANE_KIND, openBoard } from './Board';
import { BlockEditor, CalendarEditor, EventEditor } from './EventEditor';
import { DIALOG, quickFromText } from './actions';
import { addDays, isDate, isView, localDay, type CalEvent, type Tone } from './core';
import './calendar.css';

const voice = () => (globalThis as { amberxVoice?: { register(module: string, commands: unknown[]): unknown } }).amberxVoice;

function show(rt: AxfRuntime, arg?: string) {
  const a = (arg ?? '').toLowerCase();
  const date = a === 'tomorrow' ? addDays(localDay(), 1) : a === 'today' ? localDay() : isDate(arg) ? arg : '';
  if (isView(a)) { setCalUi({ tab: a }); rt.settings.set(KEY_VIEW, a); } else if (a === 'schedules') setCalUi({ tab: 'schedules' });
  else if (date) setCalUi({ tab: 'day', date });
  rt.navigate('calendar');
}

export const calendarLibrary: Pick<AxfWebLibrary, 'views' | 'dialogs' | 'tabs' | 'register' | 'contextMenu' | 'settings'> = {
  views: { calendar: { title: 'Calendar', icon: 'clock', keywords: ['calendar', 'schedule', 'schedules', 'events', 'week', 'month', 'agenda', 'rsvp', 'invite'], render: () => <CalendarView /> } },
  dialogs: {
    [DIALOG.event]: { title: 'Event', icon: 'clock', searchable: false, render: (p, close) => <EventEditor key={String(p.id ?? p.start ?? '')} id={p.id as string | undefined} date={p.date as string | undefined} seed={p.id ? undefined : (p as Partial<CalEvent>)} close={close} /> },
    [DIALOG.block]: { title: 'Schedule block', icon: 'clock', searchable: false, render: (p, close) => <BlockEditor schedule={String(p.schedule)} block={String(p.block)} close={close} /> },
    [DIALOG.calendar]: { title: 'Calendar', icon: 'list', searchable: false, render: (p, close) => <CalendarEditor id={p.id as string | undefined} close={close} /> },
    [DIALOG.layouts]: { title: 'Layouts', icon: 'layout', searchable: false, render: (_p, close) => <LayoutsDialog close={close} /> },
  },
  tabs: { [PANE_KIND]: (tab) => <BoardPane id={tab.id} /> },
  contextMenu: [{ id: 'amberx.calendar', items: [{ id: 'calendar.new', label: 'New event', icon: 'plus', action: 'calendar.new' }] }],
  settings: [{ id: 'amberx.calendar', label: 'Calendar', icon: 'clock', tab: 'notes-tasks', settings: [{ key: KEY_VIEW, label: 'Open on', kind: 'choice', default: 'week', options: [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }] }] }],
  register(rt: AxfRuntime) {
    rt.actions.register('calendar.open', ([arg]) => show(rt, arg), { label: 'Open the calendar' });
    rt.actions.register('calendar.new', () => { const d = localDay(); rt.openDialog(DIALOG.event, { start: `${d}T09:00`, end: `${d}T10:00`, allDay: false }); }, { label: 'New event' });
    rt.actions.register('calendar.add', (args) => {
      const e = quickFromText(args.join(':'));
      if (e) { setCalUi({ date: e.start.slice(0, 10) }); rt.navigate('calendar'); }
      return e ? `Added ${e.title}.` : 'What should I call it?';
    }, { label: 'Add to the calendar', params: true });
    rt.actions.register('calendar.window', () => openBoard(rt), { label: 'Open the calendar in a window' });
    rt.actions.register('calendar.schedules', () => show(rt, 'schedules'), { label: 'Open weekly schedules' });
    voice()?.register('calendar', [
      { id: 'calendar.open', phrases: ['open calendar', 'show calendar', 'my calendar', 'open my calendar'], action: 'calendar.open' },
      { id: 'calendar.today', phrases: ['whats on today', 'what is on today', 'my day', 'show my day'], action: 'calendar.open:today' },
      { id: 'calendar.tomorrow', phrases: ['whats on tomorrow', 'what is on tomorrow'], action: 'calendar.open:tomorrow' },
      { id: 'calendar.week', phrases: ['show my week', 'my week', 'calendar week', 'week view'], action: 'calendar.open:week' },
      { id: 'calendar.month', phrases: ['show my month', 'month view', 'calendar month'], action: 'calendar.open:month' },
      { id: 'calendar.agenda', phrases: ['show agenda', 'my agenda', 'agenda view'], action: 'calendar.open:agenda' },
      { id: 'calendar.schedules', phrases: ['open schedules', 'weekly schedule', 'my schedule', 'show schedules'], action: 'calendar.schedules' },
      { id: 'calendar.window', phrases: ['open calendar window', 'calendar in a window', 'calendar board'], action: 'calendar.window' },
      { id: 'calendar.new', phrases: ['new event', 'add an event'], action: 'calendar.new' },
    ]);
  },
};
export type { Tone };
