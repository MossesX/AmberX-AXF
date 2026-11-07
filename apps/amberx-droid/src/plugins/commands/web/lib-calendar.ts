/** Calendar tab: the calendar by voice. Trigger words: "calendar", "schedule", "event", "whats on". */
import { act, category } from './build';

const c = category('calendar', 'calendar');
const { action: A } = c;

A('Open', 'open', 'Open the calendar', 'Shows the calendar.', ['open calendar', 'show calendar', 'my calendar', 'open my calendar'], [act('calendar.open')]);
A('Open', 'today', 'Today', 'Shows today.', ['whats on today', 'what is on today', 'my day', 'show my day'], [act('calendar.open:today')]);
A('Open', 'tomorrow', 'Tomorrow', 'Shows tomorrow.', ['whats on tomorrow', 'what is on tomorrow'], [act('calendar.open:tomorrow')]);
A('Open', 'week', 'This week', 'Shows the week.', ['show my week', 'my week', 'calendar week', 'week view'], [act('calendar.open:week')]);
A('Open', 'month', 'This month', 'Shows the month.', ['show my month', 'month view', 'calendar month'], [act('calendar.open:month')]);
A('Open', 'agenda', 'Agenda', 'Lists what\'s coming.', ['show agenda', 'my agenda', 'agenda view'], [act('calendar.open:agenda')]);
A('Open', 'schedules', 'Weekly schedules', 'Opens the weekly schedules.', ['open schedules', 'weekly schedule', 'my schedule', 'show schedules'], [act('calendar.schedules')]);
A('Open', 'window', 'Calendar window', 'Opens the calendar in its own window.', ['open calendar window', 'calendar in a window', 'calendar board'], [act('calendar.window')]);
A('Add', 'add', 'Add to the calendar', 'Adds what you say, in plain English: gym every Monday and Wednesday at 6pm.', ['add event {text}', 'new event {text}', 'schedule {text}', 'put {text} on my calendar', 'add {text} to my calendar'], [act('calendar.add:{text}')], { slots: { text: 'text' } });
A('Add', 'new', 'New event', 'Opens a new event.', ['new event', 'add an event'], [act('calendar.new')]);

export const CALENDAR_COMMANDS = c.list;
