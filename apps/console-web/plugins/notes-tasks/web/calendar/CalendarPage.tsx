/** The Calendar page: quick add, views, mini-month, calendars, weekly schedules. Panes in the window reuse its body. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Checkbox, Container, IconButton, Note, TextField, useIsPhone, useRuntime } from '@console/axf/react';
import { TabGroup } from '@console/axf/react';
import { hubAddress, openHubSignIn } from '@console/notesHost';
import { DAY_NAMES, VIEW_LABEL, VIEWS, addDays, hhmm, isView, localDay, minuteOf, niceWhen, parseQuick, repeatLabel, scheduleOccurrences, stepDate, viewTitle, defaultTz, type CalView, type Occurrence } from './core';
import { CalendarBody, MiniMonth, TimeGrid } from './views';
import { DIALOG, addQuick, commitDrop, newId, openOccurrence } from './actions';
import type { DragHooks } from './drag';
import { openBoard } from './Board';
import { byWhom, mutateCal, startCalSync, useCalendar } from './store';
import { useDueItems } from './views';

export const KEY_VIEW = 'amberx.calendar.view';
type Tab = CalView | 'schedules';
const TABS = [...VIEWS.map((v) => ({ value: v as Tab, label: VIEW_LABEL[v] })), { value: 'schedules' as Tab, label: 'Schedules' }];

let ui: { tab: Tab | null; date: string; focus: number } = { tab: null, date: localDay(), focus: 0 };
const subs = new Set<() => void>();
export const setCalUi = (p: Partial<typeof ui>) => { ui = { ...ui, ...p }; subs.forEach((f) => f()); };
const useUi = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => ui);

/** The plain-English bar: shows what it understood as you type. */
export function QuickAdd() {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const q = useMemo(() => (text.trim() ? parseQuick(text, localDay()) : null), [text]);
  const submit = () => {
    if (!q) return;
    const e = addQuick(q);
    setText(''); setNote(`Added ${e.title}.`);
    setCalUi({ date: e.start.slice(0, 10) });
  };
  return (
    <form className="axp-cal-quick" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <TextField label="Quick add" value={text} onChange={(v) => { setText(v); setNote(''); }} placeholder="gym every Mon Wed 6pm" />
      <Button type="submit" tone="primary" icon="plus" disabled={!q}>Add</Button>
      {(q || note) && <p className="axp-cal-quick__hint fx-small fx-muted">{q ? `${q.title} · ${niceWhen(q)}${q.repeat ? ` · ${repeatLabel(q.repeat)}` : ''}${q.location ? ` · ${q.location}` : ''}` : note}</p>}
    </form>
  );
}

export function CalendarsList() {
  const rt = useRuntime();
  const { store } = useCalendar();
  const cals = Object.values(store.calendars).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const tasks = rt.settings.get('amberx.calendar.tasks') !== false;
  return (
    <div className="axp-cal-list">
      {cals.map((c) => (
        <div key={c.id} className={`axp-cal-listrow axp-cal-tone--${c.tone}`}>
          <span className="axp-cal-dot" />
          <Checkbox label={c.name} checked={!c.hidden} onChange={(v) => mutateCal((s) => { s.calendars[c.id]!.hidden = !v; })} />
          <IconButton icon="edit" label={`Edit ${c.name}`} onClick={() => rt.openDialog(DIALOG.calendar, { id: c.id })} />
        </div>
      ))}
      <div className="axp-cal-listrow axp-cal-tone--info">
        <span className="axp-cal-dot" />
        <Checkbox label="Tasks with a due date" checked={tasks} onChange={(v) => mutateCal((s) => {
          if (v) delete s.calendars.tasks; else s.calendars.tasks = { id: 'tasks', name: 'Tasks', tone: 'info', hidden: true, google: '', order: 99, updatedAt: '' };
        })} />
      </div>
      <Button size="sm" icon="plus" onClick={() => rt.openDialog(DIALOG.calendar, {})}>New calendar</Button>
    </div>
  );
}

function Status() {
  const { status, error, queued } = useCalendar();
  if (status === 'signed-out') return <Note tone="warning">Signed out of axHub: your calendar lives there. <Button size="sm" icon="external" onClick={() => openHubSignIn(`${hubAddress()}/auth/login`)}>Sign in to axHub</Button></Note>;
  if (status === 'offline') return <Note tone="warning">axHub can't be reached{queued ? `: ${queued} change${queued === 1 ? '' : 's'} waiting to be saved` : ''}.{error ? ` ${error}` : ''}</Note>;
  return null;
}

/** Weekly schedules: named weeks of blocks, drawn on a plain Sunday-to-Saturday grid. */
const REF_WEEK = Array.from({ length: 7 }, (_, i) => addDays('2023-01-01', i));
function Schedules() {
  const rt = useRuntime();
  const { store } = useCalendar();
  const list = Object.values(store.schedules).sort((a, b) => a.name.localeCompare(b.name));
  const [pick, setPick] = useState('');
  const s = store.schedules[pick] ?? list[0];
  const firstCal = Object.keys(store.calendars)[0] ?? 'personal';
  const add = () => {
    const id = newId('s');
    mutateCal((st) => { st.schedules[id] = { id, name: `Schedule ${list.length + 1}`, calendar: firstCal, active: true, from: '', until: '', tz: defaultTz(), reminders: [], blocks: [], updatedAt: '', by: byWhom() }; });
    setPick(id);
  };
  const items = useMemo(() => (s ? scheduleOccurrences({ ...s, active: true, from: '', until: '' }, store.calendars[s.calendar], REF_WEEK[0]!, REF_WEEK[6]!) : []), [s, store.calendars]);
  const hooks: DragHooks = {
    onTap: (occ: Occurrence | null, at) => {
      if (occ) { openOccurrence(rt, occ); return; }
      if (s && at.date && at.minute != null) { const m = Math.floor(at.minute / 30) * 30; block(at.date, m, m + 60); }
    },
    onDrop: (c) => {
      if (c.occ) { commitDrop(rt, c); return; }
      if (!c.allDay) block(c.start.slice(0, 10), minuteOf(c.start), minuteOf(c.end) || 1439);
    },
  };
  const block = (date: string, from: number, to: number) => {
    const id = newId('b');
    if (!s) return;
    mutateCal((st) => { st.schedules[s.id]!.blocks.push({ id, day: REF_WEEK.indexOf(date), start: hhmm(from), end: hhmm(to), title: 'Block', tone: '' }); });
    rt.openDialog(DIALOG.block, { schedule: s.id, block: id });
  };
  return (
    <div className="axp-cal-sched">
      <div className="axp-cal-sched__bar">
        {list.map((x) => <Button key={x.id} size="sm" tone={x.id === s?.id ? 'primary' : 'neutral'} onClick={() => setPick(x.id)}>{x.name}</Button>)}
        <Button size="sm" icon="plus" onClick={add}>New schedule</Button>
      </div>
      {!s ? <div className="axp-cal-empty"><p>A weekly schedule is a week of blocks that shows on every week.</p><Button tone="primary" icon="plus" onClick={add}>Make your first one</Button></div> : (
        <>
          <div className="axp-cal-sched__form">
            <TextField label="Name" value={s.name} onChange={(v) => mutateCal((st) => { st.schedules[s.id]!.name = v; })} />
            <TextField label="From" type="date" value={s.from} onChange={(v) => mutateCal((st) => { st.schedules[s.id]!.from = v; })} />
            <TextField label="Until" type="date" value={s.until} onChange={(v) => mutateCal((st) => { st.schedules[s.id]!.until = v; })} />
            <Checkbox label="Show on the calendar" checked={s.active} onChange={(v) => mutateCal((st) => { st.schedules[s.id]!.active = v; })} />
            <Button size="sm" tone="danger" icon="trash" confirm={`Delete ${s.name}?`} onClick={() => mutateCal((st) => { delete st.schedules[s.id]; })}>Delete</Button>
          </div>
          <p className="fx-small fx-muted">Drag on the grid to add a block. Drag a block to move it, its bottom edge to resize it.</p>
          <TimeGrid dates={REF_WEEK} labels={DAY_NAMES} items={items} hooks={hooks} />
        </>
      )}
    </div>
  );
}

export function CalendarView() {
  const rt = useRuntime();
  const phone = useIsPhone();
  const u = useUi();
  const dueCount = useDueItems().length;
  const saved = rt.settings.get(KEY_VIEW);
  const tab: Tab = u.tab ?? (saved === 'schedules' || isView(saved) ? (saved as Tab) : phone ? 'day' : 'week');
  useEffect(() => startCalSync(), []);
  const { loaded } = useCalendar();
  const view: CalView = tab === 'schedules' ? 'week' : tab;
  const step = (dir: number) => setCalUi({ date: stepDate(view, u.date, dir) });
  const pick = (t: Tab) => { setCalUi({ tab: t }); rt.settings.set(KEY_VIEW, t); };
  return (
    <div className="axp-cal" data-cal-items={dueCount}>
      <Status />
      <div className="axp-cal-top">
        <div className="axp-cal-nav" role="toolbar" aria-label="Calendar" data-axf-tap-confirm="off" data-axf-tap-confirm-reason="Paging through dates has to take one tap, it changes nothing">
          <IconButton icon="chevron-left" label="Back" onClick={() => step(-1)} />
          <Button size="sm" onClick={() => setCalUi({ date: localDay() })}>Today</Button>
          <IconButton icon="chevron-right" label="Forward" onClick={() => step(1)} />
          <h2 className="axp-cal-title">{tab === 'schedules' ? 'Weekly schedules' : viewTitle(view, u.date)}</h2>
          <span className="axp-cal-grow" />
          {!phone && <Button size="sm" icon="layout" onClick={() => openBoard(rt)}>Open in a window</Button>}
          {phone && <IconButton icon="layout" label="Open in a window" onClick={() => openBoard(rt)} />}
        </div>
        <TabGroup id="calendar.views" label="Calendar view" value={tab} onChange={pick} tabs={TABS} />
        <QuickAdd />
      </div>
      <div className="axp-cal-main">
        <aside className="axp-cal-side">
          <Container title="Pick a date" icon="clock" collapsible defaultOpen={!phone}><MiniMonth date={u.date} onPick={(d) => { setCalUi({ date: d }); if (phone && tab === 'month') pick('day'); }} /></Container>
          <Container title="Calendars" icon="list" collapsible defaultOpen={!phone}><CalendarsList /></Container>
        </aside>
        <div className="axp-cal-page">
          {!loaded ? <p className="fx-muted">Loading your calendar…</p> : tab === 'schedules' ? <Schedules /> : <CalendarBody view={view} date={u.date} onStep={step} onDay={(d) => { setCalUi({ date: d }); pick('day'); }} />}
        </div>
      </div>
    </div>
  );
}
