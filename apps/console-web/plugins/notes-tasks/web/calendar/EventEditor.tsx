/** The event dialog: details, and the guest list with RSVP status, emails and everything they've said. */
import { useMemo, useState } from 'react';
import { Button, Checkbox, Chip, Container, IconButton, Note, SelectField, Switch, TabGroup, TextField } from '@console/axf/react';
import {
  DAY_NAMES, GUEST_LABEL, TONES, blankEvent, defaultTz, guestRows, reminderLabel, removeOccurrence, rsvpCounts, shiftTime, validEmail, type CalEvent, type Freq, type GuestRow, type MailKind, type Tone,
} from './core';
import { newId } from './actions';
import { byWhom, calendarApi, loadCal, mutateCal, useCalendar } from './store';

const REMINDERS = [0, 10, 30, 60, 1440];
const CHASERS = [24, 72];
const FREQ = [{ value: '', label: 'Does not repeat' }, { value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }, { value: 'yearly', label: 'Every year' }];
const STATUS_TONE = { yes: 'success', no: 'danger', maybe: 'warning', seen: 'accent' } as const;
const MARK = { yes: '✓', no: '✕', maybe: '?', seen: '👁', invited: '·' } as const;
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

function Guests({ e, set, saved }: { e: CalEvent; set: (p: Partial<CalEvent>) => void; saved: boolean }) {
  const { store } = useCalendar();
  const rows = useMemo(() => guestRows(e, store.replies, store.mail), [e, store.replies, store.mail]);
  const c = rsvpCounts(rows);
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const good = validEmail(email.trim().toLowerCase()) && !e.guests.some((g) => g.email === email.trim().toLowerCase());
  const add = () => { if (!good) return; set({ guests: [...e.guests, { id: newId('g'), name: name.trim(), email: email.trim().toLowerCase() }], rsvp: { ...e.rsvp, on: true } }); setName(''); setEmail(''); };
  const send = async (kind: MailKind, guests?: string[]) => {
    setBusy(true); setNote('');
    try {
      const r = await calendarApi.post<{ queued: number; gmail?: boolean }>('calendar/mail', { id: e.id, kind, guests });
      setNote(r.queued === 0 ? 'Nobody to send that to.' : r.gmail === false
        ? `${r.queued} waiting: they go out once Gmail is connected on axHub.`
        : `${r.queued} sent to axHub: each email waits for your confirm there.`);
      void loadCal();
    } catch (err) { setNote(err instanceof Error ? err.message : String(err)); }
    setBusy(false);
  };
  const row = (g: GuestRow) => {
    const last = g.mailed[g.mailed.length - 1];
    return (
      <div key={g.id} className="axp-cal-guest">
        <span className={`axp-cal-mark is-${g.status}`} aria-label={GUEST_LABEL[g.status]}>{MARK[g.status]}</span>
        <div className="axp-cal-guest__who">
          <span>{g.name || g.email}</span>
          <span className="fx-small fx-muted">{g.name ? g.email : ''}{last ? ` · ${last.kind} ${last.status}` : ''}{last?.error ? `: ${last.error}` : ''}</span>
          {g.message && <span className="axp-cal-guest__said">“{g.message}”</span>}
        </div>
        {g.status === 'invited' ? <Chip>{GUEST_LABEL.invited}</Chip> : <Chip tone={STATUS_TONE[g.status]}>{GUEST_LABEL[g.status]}</Chip>}
        <IconButton icon="trash" label={`Remove ${g.name || g.email}`} onClick={() => set({ guests: e.guests.filter((x) => x.id !== g.id) })} />
      </div>
    );
  };
  const log = rows.flatMap((g) => g.log).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="axp-cal-form">
      {rows.length > 0 && <div className="axp-cal-counts"><Chip tone="success">{c.yes} yes</Chip><Chip tone="warning">{c.maybe} maybe</Chip><Chip tone="danger">{c.no} no</Chip><Chip tone="accent">{c.seen} seen</Chip><Chip>{c.invited} waiting</Chip></div>}
      {rows.map(row)}
      <form className="axp-cal-addguest" onSubmit={(ev) => { ev.preventDefault(); add(); }}>
        <TextField label="Name" value={name} onChange={setName} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} />
        <Button type="submit" icon="plus" disabled={!good}>Add guest</Button>
      </form>
      {rows.length > 0 && (
        <>
          {!saved && <Note tone="info">Save the event first, then send the emails.</Note>}
          <div className="axp-cal-presets">
            <Button size="sm" tone="primary" disabled={!saved || busy} onClick={() => void send('invite')}>Send invites</Button>
            <Button size="sm" disabled={!saved || busy} onClick={() => void send('reminder')}>Remind who hasn't answered</Button>
            <Button size="sm" disabled={!saved || busy} onClick={() => void send('seen')}>Ask them to confirm they saw it</Button>
          </div>
          {note && <p className="fx-small fx-muted">{note}</p>}
          <div className="axp-cal-presets">
            <span className="fx-small fx-muted">Chase automatically:</span>
            {CHASERS.map((h) => <Checkbox key={h} label={`${h === 24 ? '1 day' : '3 days'} before`} checked={e.rsvp.remindHours.includes(h)} onChange={(v) => set({ rsvp: { ...e.rsvp, on: true, remindHours: v ? [...e.rsvp.remindHours, h] : e.rsvp.remindHours.filter((x) => x !== h) } })} />)}
          </div>
        </>
      )}
      {log.length > 0 && (
        <Container title={`Replies (${log.length})`} icon="list" collapsible>
          {log.map((r) => <div key={r.id} className="axp-cal-log"><span className="fx-small fx-muted">{when(r.at)} · {r.source === 'email' ? 'by email' : 'reply page'}</span><span>{r.name}{r.answer ? `: ${GUEST_LABEL[r.answer]}` : ''}</span>{r.message && <span className="axp-cal-guest__said">“{r.message}”</span>}</div>)}
        </Container>
      )}
    </div>
  );
}

export function EventEditor({ id, date, seed, close }: { id?: string; date?: string; seed?: Partial<CalEvent>; close: () => void }) {
  const { store } = useCalendar();
  const existing = id ? store.events[id] : undefined;
  const cals = Object.values(store.calendars).filter((c) => c.id !== 'tasks');
  const [draft, setDraft] = useState<CalEvent>(() => existing ?? blankEvent(newId('e'), { calendar: cals[0]?.id ?? 'personal', tz: defaultTz(), reminders: [10], createdAt: new Date().toISOString(), by: byWhom(), ...seed }));
  const [tab, setTab] = useState<'details' | 'guests'>('details');
  const set = (p: Partial<CalEvent>) => setDraft((d) => ({ ...d, ...p }));
  const saved = !!existing;
  const save = () => {
    const end = draft.end < draft.start ? shiftTime(draft.start, draft.allDay ? 0 : 60) : draft.end;
    mutateCal((s) => { s.events[draft.id] = { ...draft, end, title: draft.title.trim() || 'Untitled', by: byWhom() }; });
  };
  const remove = () => {
    mutateCal((s) => {
      if (draft.gcalId) s.events[draft.id] = { ...draft, deletedAt: new Date().toISOString() };
      else delete s.events[draft.id];
    });
    close();
  };
  const repeat = draft.repeat;
  return (
    <div className="axp-cal-form axp-cal-editor">
      <TabGroup id="calendar.event-tabs" label="Event" value={tab} onChange={setTab} tabs={[{ value: 'details', label: 'Details' }, { value: 'guests', label: `Guests${draft.guests.length ? ` (${draft.guests.length})` : ''}` }]} />
      {tab === 'guests' ? <Guests e={draft} set={set} saved={saved} /> : (
        <>
          <TextField label="Title" value={draft.title === 'Untitled' ? '' : draft.title} onChange={(v) => set({ title: v })} autoFocus={!saved} required />
          <Switch label="All day" checked={draft.allDay} onChange={(v) => set({ allDay: v, end: v ? draft.start : shiftTime(draft.start, 60) })} />
          <div className="axp-cal-when">
            <TextField label="Starts" type="date" value={draft.start.slice(0, 10)} onChange={(v) => { if (v) set({ start: `${v}${draft.start.slice(10)}`, end: `${v}${draft.end.slice(10)}` }); }} />
            {!draft.allDay && <TextField label="At" type="time" value={draft.start.slice(11)} onChange={(v) => { if (v) set({ start: `${draft.start.slice(0, 10)}T${v}` }); }} />}
            <TextField label="Ends" type="date" value={draft.end.slice(0, 10)} onChange={(v) => { if (v) set({ end: `${v}${draft.end.slice(10)}` }); }} />
            {!draft.allDay && <TextField label="At" type="time" value={draft.end.slice(11)} onChange={(v) => { if (v) set({ end: `${draft.end.slice(0, 10)}T${v}` }); }} />}
          </div>
          <TextField label="Location" value={draft.location} onChange={(v) => set({ location: v })} />
          <TextField label="Notes" rows={3} value={draft.notes} onChange={(v) => set({ notes: v })} />
          <SelectField label="Calendar" value={draft.calendar} options={cals.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => set({ calendar: v })} />
          <SelectField label="Repeats" value={repeat?.freq ?? ''} options={FREQ} onChange={(v) => set({ repeat: v ? { freq: v as Freq, interval: 1, days: [], until: '', count: 0, ...(repeat?.freq === v ? repeat : {}) } : null })} />
          {repeat?.freq === 'weekly' && <div className="axp-cal-presets">{DAY_NAMES.map((d, i) => <Checkbox key={d} label={d} checked={repeat.days.includes(i)} onChange={(v) => set({ repeat: { ...repeat, days: v ? [...repeat.days, i].sort() : repeat.days.filter((x) => x !== i) } })} />)}</div>}
          {repeat && <TextField label="Until (optional)" type="date" value={repeat.until} onChange={(v) => set({ repeat: { ...repeat, until: v } })} />}
          <div className="axp-cal-presets"><span className="fx-small fx-muted">Remind me:</span>{REMINDERS.map((m) => <Checkbox key={m} label={reminderLabel(m)} checked={draft.reminders.includes(m)} onChange={(v) => set({ reminders: v ? [...draft.reminders, m] : draft.reminders.filter((x) => x !== m) })} />)}</div>
        </>
      )}
      <div className="axp-cal-actions">
        {saved && <Button tone="danger" icon="trash" confirm={`Delete ${draft.title}${repeat ? ' and every repeat' : ''}?`} onClick={remove}>Delete</Button>}
        {saved && repeat && date && <Button confirm="Take out just this one?" onClick={() => { mutateCal((s) => { s.events[draft.id] = removeOccurrence(s.events[draft.id]!, date); }); close(); }}>Delete this one</Button>}
        <span className="axp-cal-grow" />
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" onClick={() => { save(); if (tab === 'guests' && !saved) return; close(); }}>Save</Button>
      </div>
    </div>
  );
}

export function BlockEditor({ schedule, block, close }: { schedule: string; block: string; close: () => void }) {
  const { store } = useCalendar();
  const b = store.schedules[schedule]?.blocks.find((x) => x.id === block);
  const set = (p: Partial<NonNullable<typeof b>>) => mutateCal((s) => { const x = s.schedules[schedule]?.blocks.find((y) => y.id === block); if (x) Object.assign(x, p); });
  if (!b) return <p className="fx-muted">That block is gone.</p>;
  return (
    <div className="axp-cal-form">
      <TextField label="Title" value={b.title} onChange={(v) => set({ title: v })} autoFocus />
      <SelectField label="Day" value={String(b.day)} options={DAY_NAMES.map((d, i) => ({ value: String(i), label: d }))} onChange={(v) => set({ day: Number(v) })} />
      <div className="axp-cal-when">
        <TextField label="From" type="time" value={b.start} onChange={(v) => { if (v) set({ start: v }); }} />
        <TextField label="To" type="time" value={b.end} onChange={(v) => { if (v) set({ end: v }); }} />
      </div>
      <SelectField label="Colour" value={b.tone} options={[{ value: '', label: 'The calendar\'s' }, ...TONES.map((t) => ({ value: t, label: TONE_LABEL[t] }))]} onChange={(v) => set({ tone: v as Tone | '' })} />
      <div className="axp-cal-actions">
        <Button tone="danger" icon="trash" onClick={() => { mutateCal((s) => { const x = s.schedules[schedule]; if (x) x.blocks = x.blocks.filter((y) => y.id !== block); }); close(); }}>Delete</Button>
        <span className="axp-cal-grow" />
        <Button tone="primary" onClick={close}>Done</Button>
      </div>
    </div>
  );
}

const TONE_LABEL: Record<Tone, string> = { accent: 'Accent', info: 'Blue', success: 'Green', warning: 'Amber', danger: 'Red', muted: 'Grey' };

export function CalendarEditor({ id, close }: { id?: string; close: () => void }) {
  const { store } = useCalendar();
  const cur = id ? store.calendars[id] : undefined;
  const [name, setName] = useState(cur?.name ?? '');
  const [tone, setTone] = useState<Tone>(cur?.tone ?? 'info');
  const [google, setGoogle] = useState(cur?.google ?? '');
  const others = Object.values(store.calendars).filter((c) => c.id !== id && c.id !== 'tasks');
  const used = Object.values(store.events).some((e) => e.calendar === id) || Object.values(store.schedules).some((s) => s.calendar === id);
  return (
    <form className="axp-cal-form" onSubmit={(e) => {
      e.preventDefault();
      if (!name.trim()) return;
      const cid = id ?? newId('c');
      mutateCal((s) => { s.calendars[cid] = { id: cid, name: name.trim(), tone, hidden: cur?.hidden ?? false, google: google.trim(), order: cur?.order ?? Object.keys(s.calendars).length, updatedAt: '' }; });
      close();
    }}>
      <TextField label="Name" value={name} onChange={setName} autoFocus required />
      <SelectField label="Colour" value={tone} options={TONES.map((t) => ({ value: t, label: TONE_LABEL[t] }))} onChange={(v) => setTone(v as Tone)} />
      <TextField label="Google calendar" value={google} onChange={setGoogle} placeholder="primary" hint="Two-way sync with this Google calendar through axHub. Empty = this calendar stays here. It starts once Google is connected on axHub." />
      <div className="axp-cal-actions">
        {id && others.length > 0 && !used && <Button tone="danger" icon="trash" confirm={`Delete ${cur?.name}?`} onClick={() => { mutateCal((s) => { delete s.calendars[id]; }); close(); }}>Delete</Button>}
        <span className="axp-cal-grow" />
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" tone="primary">Save</Button>
      </div>
    </form>
  );
}
