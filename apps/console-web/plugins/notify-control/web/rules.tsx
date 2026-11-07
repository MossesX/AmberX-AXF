/**
 * The Notifications panel's Groups and Triggers sections. The server checks everything (server/rules.py); a bad value
 * comes back as a plain sentence, shown on the row. Guarded types (approvals, veto) are never held by a group or a rule.
 */
import { useState } from 'react';
import { Button, Chip, Container, Icon, Note, SelectField, Switch, TextField } from '@console/axf/react';
import { pluginApi } from '@console/plugins';

const P = 'axp-notify';
const api = pluginApi('notify-control', 'The Notifications panel');

export interface Command { label: string; kind: string; target: string; icon?: string }
export interface Group { name: string; on: boolean; types: string[]; commands: Command[] }
export interface Condition { field: string; op: string; value: string | number }
export interface Trigger {
  name: string; on: boolean; effect: string; hits?: number; title?: string; body?: string; severity?: string;
  event: { types: string[]; groups: string[]; source: string; keyPrefix: string; severity: string };
  conditions: Condition[]; threshold: { count: number; minutes: number }; schedule: { days: string[]; start: string; end: string };
}
export interface RuleOptions { effects: string[]; ops: string[]; fields: string[]; severities: string[]; days: string[]; commandKinds: string[] }
interface Shared { types: { id: string; label: string; guarded: boolean }[]; userGroups: Record<string, Group>; triggers: Record<string, Trigger>; ruleOptions: RuleOptions }
type Act = (path: string, body: unknown) => Promise<boolean>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const COMMAND_TEXT: Record<string, string> = { approve: 'Approve (opens the call’s screen)', open: 'Open a screen', console: 'Run a console command' };
const EFFECT_TEXT: Record<string, string> = { only: 'Only send when this passes', mute: 'Mute when this passes', raise: 'Send a new notification when this passes' };
const OP_TEXT: Record<string, string> = { eq: 'is', ne: 'is not', contains: 'contains', 'not-contains': 'does not contain', gte: 'at least', lte: 'at most' };
const NONE = { value: '', label: 'Any' };

const NEW_GROUP: Group = { name: '', on: true, types: [], commands: [] };
const NEW_TRIGGER: Trigger = {
  name: '', on: true, effect: 'only', event: { types: [], groups: [], source: '', keyPrefix: '', severity: '' }, conditions: [],
  threshold: { count: 1, minutes: 60 }, schedule: { days: [], start: '', end: '' }, title: '', body: '', severity: 'warning',
};

/* ---------------- groups ---------------- */

function GroupEditor({ s, id, start, act, done }: { s: Shared; id: string; start: Group; act: Act; done: () => void }) {
  const [g, setG] = useState<Group>(start);
  const set = (p: Partial<Group>) => setG({ ...g, ...p });
  const labelOf = (t: string) => s.types.find((x) => x.id === t)?.label ?? t;
  const left = s.types.filter((t) => !g.types.includes(t.id));
  const cmd = (i: number, p: Partial<Command>) => set({ commands: g.commands.map((c, n) => (n === i ? { ...c, ...p } : c)) });
  return (
    <div className={`${P}__edit`} data-group-editor={id || 'new'}>
      <TextField label="Group name" value={g.name} onChange={(v) => set({ name: v })} placeholder="Builds I care about" />
      <div className={`${P}__line`} role="group" aria-label="Types in this group">
        {g.types.map((t) => <Button key={t} size="sm" tone="ghost" icon="x" title="Take it out of the group" onClick={() => set({ types: g.types.filter((x) => x !== t) })}>{labelOf(t)}</Button>)}
      </div>
      <SelectField label="Add a type" value="" options={[{ value: '', label: 'Pick one…' }, ...left.map((t) => ({ value: t.id, label: t.label }))]} onChange={(v) => { if (v) set({ types: [...g.types, v] }); }} />
      {g.commands.map((c, i) => (
        <div key={i} className={`${P}__head`} data-command={i}>
          <TextField label="Button" value={c.label} onChange={(v) => cmd(i, { label: v })} />
          <SelectField label="Does" value={c.kind} options={s.ruleOptions.commandKinds.map((k) => ({ value: k, label: COMMAND_TEXT[k] ?? k }))} onChange={(v) => cmd(i, { kind: v })} />
          <TextField label="Target" value={c.target} onChange={(v) => cmd(i, { target: v })} placeholder={c.kind === 'console' ? 'terminal.claude' : 'view:alerts'} />
          <Button size="sm" tone="ghost" icon="trash" onClick={() => set({ commands: g.commands.filter((_, n) => n !== i) })}>Remove</Button>
        </div>
      ))}
      <div className={`${P}__line`}>
        <Button size="sm" icon="plus" onClick={() => set({ commands: [...g.commands, { label: '', kind: 'open', target: '' }] })}>Add a command</Button>
        <Button size="sm" tone="primary" icon="save" onClick={() => void act('group', { ...(id ? { id } : {}), ...g }).then((ok) => { if (ok) done(); })}>Save group</Button>
        <Button size="sm" tone="ghost" onClick={done}>Cancel</Button>
      </div>
    </div>
  );
}

function Groups({ s, act }: { s: Shared; act: Act }) {
  const [edit, setEdit] = useState<string | null>(null);
  const rows = Object.entries(s.userGroups);
  return (
    <Container title={`My groups (${rows.length})`} icon="folder">
      <div className="fx-stack">
        <p className={`${P}__muted`}>Any types in a group, on or off together, with their own command buttons on each notification. Approvals and veto stay on whatever a group says.</p>
        {rows.map(([id, g]) => (
          edit === id ? <GroupEditor key={id} s={s} id={id} start={g} act={act} done={() => setEdit(null)} /> : (
            <div key={id} className={`${P}__row`} data-group={id}>
              <div className={`${P}__top`}>
                <div className={`${P}__name`}><Switch label={g.name} checked={g.on} hint={`${g.types.length} type${g.types.length === 1 ? '' : 's'}${g.commands.length ? ` · commands: ${g.commands.map((c) => c.label).join(', ')}` : ''}`} onChange={(v) => void act('group', { id, on: v })} /></div>
                <Button size="sm" tone="ghost" icon="edit" onClick={() => setEdit(id)}>Edit</Button>
                <Button size="sm" tone="ghost" icon="trash" confirm={`Remove the group ${g.name}?`} onClick={() => void act('group-remove', { id })}>Remove</Button>
              </div>
            </div>
          )
        ))}
        {edit === '' ? <GroupEditor s={s} id="" start={NEW_GROUP} act={act} done={() => setEdit(null)} /> : <div><Button size="sm" icon="plus" onClick={() => setEdit('')}>New group</Button></div>}
      </div>
    </Container>
  );
}

/* ---------------- triggers ---------------- */

function TriggerEditor({ s, id, start, act, done }: { s: Shared; id: string; start: Trigger; act: Act; done: () => void }) {
  const [t, setT] = useState<Trigger>(start);
  const set = (p: Partial<Trigger>) => setT({ ...t, ...p });
  const ev = (p: Partial<Trigger['event']>) => set({ event: { ...t.event, ...p } });
  const cond = (i: number, p: Partial<Condition>) => set({ conditions: t.conditions.map((c, n) => (n === i ? { ...c, ...p } : c)) });
  const toggleDay = (d: string) => set({ schedule: { ...t.schedule, days: t.schedule.days.includes(d) ? t.schedule.days.filter((x) => x !== d) : [...t.schedule.days, d] } });
  const { hits: _hits, ...body } = t;
  return (
    <div className={`${P}__edit`} data-trigger-editor={id || 'new'}>
      <TextField label="Trigger name" value={t.name} onChange={(v) => set({ name: v })} placeholder="CI failed twice" />
      <SelectField label="What it does" value={t.effect} options={s.ruleOptions.effects.map((e) => ({ value: e, label: EFFECT_TEXT[e] ?? e }))} onChange={(v) => set({ effect: v })} />
      <p className={`${P}__muted`}>Event: what it watches</p>
      <div className={`${P}__head`}>
        <SelectField label="Type" value={t.event.types[0] ?? ''} options={[NONE, ...s.types.filter((x) => !x.guarded).map((x) => ({ value: x.id, label: x.label }))]} onChange={(v) => ev({ types: v ? [v] : [] })} />
        <SelectField label="Group" value={t.event.groups[0] ?? ''} options={[NONE, ...Object.entries(s.userGroups).map(([k, g]) => ({ value: k, label: g.name }))]} onChange={(v) => ev({ groups: v ? [v] : [] })} />
        <SelectField label="At least" value={t.event.severity} options={[NONE, ...s.ruleOptions.severities.map((x) => ({ value: x, label: cap(x) }))]} onChange={(v) => ev({ severity: v })} />
        <TextField label="Source" value={t.event.source} onChange={(v) => ev({ source: v })} />
        <TextField label="Key starts with" value={t.event.keyPrefix} onChange={(v) => ev({ keyPrefix: v })} />
      </div>
      {t.conditions.map((c, i) => (
        <div key={i} className={`${P}__head`} data-condition={i}>
          <TextField label="Field" value={c.field} onChange={(v) => cond(i, { field: v })} placeholder="title or meta.percent" />
          <SelectField label="Test" value={c.op} options={s.ruleOptions.ops.map((o) => ({ value: o, label: OP_TEXT[o] ?? o }))} onChange={(v) => cond(i, { op: v })} />
          <TextField label="Value" value={String(c.value)} onChange={(v) => cond(i, { value: v })} />
          <Button size="sm" tone="ghost" icon="trash" onClick={() => set({ conditions: t.conditions.filter((_, n) => n !== i) })}>Remove</Button>
        </div>
      ))}
      <div className={`${P}__line`}><Button size="sm" icon="plus" onClick={() => set({ conditions: [...t.conditions, { field: 'title', op: 'contains', value: '' }] })}>Add a condition</Button></div>
      <div className={`${P}__head`}>
        <TextField label="Fires from the Nth time" type="number" value={String(t.threshold.count)} onChange={(v) => set({ threshold: { ...t.threshold, count: Number(v) || 1 } })} />
        <TextField label="Within minutes" type="number" value={String(t.threshold.minutes)} onChange={(v) => set({ threshold: { ...t.threshold, minutes: Number(v) || 60 } })} />
        <TextField label="From" type="time" value={t.schedule.start} onChange={(v) => set({ schedule: { ...t.schedule, start: v } })} />
        <TextField label="Until" type="time" value={t.schedule.end} onChange={(v) => set({ schedule: { ...t.schedule, end: v } })} />
      </div>
      <div className={`${P}__line`} role="group" aria-label="Days">
        {s.ruleOptions.days.map((d) => <Button key={d} size="sm" tone={t.schedule.days.includes(d) ? 'primary' : 'neutral'} aria-pressed={t.schedule.days.includes(d)} onClick={() => toggleDay(d)}>{cap(d)}</Button>)}
        <span className={`${P}__why`}>No days picked = every day</span>
      </div>
      {t.effect === 'raise' && (
        <div className={`${P}__head`}>
          <TextField label="Notification title" value={t.title ?? ''} onChange={(v) => set({ title: v })} />
          <TextField label="Notification text" value={t.body ?? ''} onChange={(v) => set({ body: v })} />
          <SelectField label="Severity" value={t.severity ?? 'warning'} options={s.ruleOptions.severities.map((x) => ({ value: x, label: cap(x) }))} onChange={(v) => set({ severity: v })} />
        </div>
      )}
      <div className={`${P}__line`}>
        <Button size="sm" tone="primary" icon="save" onClick={() => void act('trigger', { ...(id ? { id } : {}), ...body }).then((ok) => { if (ok) done(); })}>Save trigger</Button>
        <Button size="sm" tone="ghost" onClick={done}>Cancel</Button>
      </div>
    </div>
  );
}

function TriggerRow({ s, id, t, act, edit }: { s: Shared; id: string; t: Trigger; act: Act; edit: () => void }) {
  const [said, setSaid] = useState('');
  const test = () => {
    const alert = { source: t.event.source, key: t.event.keyPrefix, severity: t.event.severity || 'warning', type: t.event.types[0] ?? '', title: 'Test' };
    api.post<{ passes: boolean; steps: Record<string, boolean> }>('trigger-test', { id, alert }).then(
      (r) => setSaid(`${r.passes ? 'Passes' : 'Does not pass'}: ${Object.entries(r.steps).map(([k, v]) => `${k} ${v ? 'yes' : 'no'}`).join(', ')}`),
      (e: Error) => setSaid(e.message),
    );
  };
  const watched = [...t.event.groups.map((g) => s.userGroups[g]?.name ?? g), ...t.event.types.map((x) => s.types.find((y) => y.id === x)?.label ?? x), t.event.source, t.event.keyPrefix && `key ${t.event.keyPrefix}…`, t.event.severity && `${t.event.severity} or worse`].filter(Boolean).join(', ');
  return (
    <div className={`${P}__row`} data-trigger={id}>
      <div className={`${P}__top`}>
        <div className={`${P}__name`}><Switch label={t.name} checked={t.on} hint={`${EFFECT_TEXT[t.effect]}. Watches ${watched}.`} onChange={(v) => void act('trigger', { id, on: v })} /></div>
        {t.threshold.count > 1 && <Chip><Icon name="clock" size={12} /> {t.hits ?? 0} of {t.threshold.count} in {t.threshold.minutes} min</Chip>}
        <Button size="sm" tone="ghost" icon="play" onClick={test}>Test</Button>
        <Button size="sm" tone="ghost" icon="edit" onClick={edit}>Edit</Button>
        <Button size="sm" tone="ghost" icon="trash" confirm={`Remove the trigger ${t.name}?`} onClick={() => void act('trigger-remove', { id })}>Remove</Button>
      </div>
      {said && <span className={`${P}__why`} role="status">{said}</span>}
    </div>
  );
}

function Triggers({ s, act }: { s: Shared; act: Act }) {
  const [edit, setEdit] = useState<string | null>(null);
  const rows = Object.entries(s.triggers);
  return (
    <Container title={`Triggers (${rows.length})`} icon="zap">
      <div className="fx-stack">
        <p className={`${P}__muted`}>Rules for when a notification fires: the event it watches, conditions, how many times, and when. Approvals and veto always get through.</p>
        {rows.map(([id, t]) => (edit === id ? <TriggerEditor key={id} s={s} id={id} start={t} act={act} done={() => setEdit(null)} /> : <TriggerRow key={id} s={s} id={id} t={t} act={act} edit={() => setEdit(id)} />))}
        {edit === '' ? <TriggerEditor s={s} id="" start={NEW_TRIGGER} act={act} done={() => setEdit(null)} /> : <div><Button size="sm" icon="plus" onClick={() => setEdit('')}>New trigger</Button></div>}
      </div>
    </Container>
  );
}

export function RuleSections({ s, act }: { s: Shared; act: (path: string, body: unknown) => Promise<void> }) {
  const [error, setError] = useState('');
  const wrapped: Act = (path, body) => api.post<never>(path, body).then(() => act('touch', null)).then(() => { setError(''); return true; }, (e: Error) => { setError(e.message); return false; });
  return (
    <>
      {error && <Note tone="danger">{error}</Note>}
      <Groups s={s} act={wrapped} />
      <Triggers s={s} act={wrapped} />
    </>
  );
}
