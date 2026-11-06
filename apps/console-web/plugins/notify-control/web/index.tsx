/**
 * Notifications control panel (notify-control): the page, Settings → Plugins → Notifications, and the console side of
 * two channels. The server decides everything (server/core.py); this file shows it, changes it, and plays what it says:
 * a new alert the server marked for sound or pop-up. `AXF_NOTIFY.allowed(type, channel)` answers the senders that run
 * in the browser (veto notices, Terminal bell, Activity chime); it stays yes for anything it doesn't know.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Icon, Note, SelectField, Switch, TextField } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { alertsOf } from '@console/axf/libs/alerts';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './notify.css';

const FOLDER = 'notify-control';
const VIEW = 'notify-control';
const POLL_MS = 30000;
const DELIVER_MS = 4000;
const P = 'axp-notify';
const api = pluginApi(FOLDER, 'The Notifications panel');

interface Verdict { allow: boolean; channels: Record<string, boolean>; held: boolean; why: string; priority: string }
interface TypeRow {
  id: string; label: string; group: string; app: string; source: string; description: string; enforced: string; enforcedText: string;
  guarded: boolean; fixed: boolean; setting?: string; allowed: string[]; customized: boolean; linkedOff: boolean;
  settings: { enabled: boolean; channels: Record<string, boolean>; priority: string }; now: Verdict;
}
interface Channel { id: string; label: string; icon: string; description: string }
interface Recent { at: number; key: string; label: string; title: string; allow: boolean; channels: string[]; why: string; count: number }
interface State {
  master: boolean; apps: { id: string; label: string; description: string; on: boolean }[]; channels: Channel[];
  groups: { id: string; label: string; icon: string }[]; priorities: string[]; types: TypeRow[]; recent: Recent[];
  quiet: { enabled: boolean; start: string; end: string; now: boolean; timeZone: string; home: string };
  counts: { types: number; off: number; blocked: number };
}
interface NotifyAlert { key: string; lastAt: number; title: string; body?: string; resolved?: boolean; notify?: { channels: Record<string, boolean>; priority: string } }

const PRIORITY_TEXT: Record<string, string> = {
  low: 'Low is banner only',
  normal: 'Normal uses every channel that is on and waits out quiet hours',
  high: 'High adds a stronger tone and pop-up',
  urgent: 'Urgent also goes through quiet hours',
};
const label = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

/* ---------------- shared state ---------------- */

let shared: State | null = null;
const listeners = new Set<(s: State) => void>();
function publish(s: State): State {
  shared = s;
  (globalThis as { AXF_NOTIFY?: unknown }).AXF_NOTIFY = {
    allowed(type: string, channel: string) {
      const t = shared?.types.find((x) => x.id === type);
      return t ? t.now.channels[channel] === true : true;
    },
  };
  for (const l of listeners) l(s);
  return s;
}
const load = () => api.call<State>('state').then(publish);
const post = (path: string, body: unknown) => api.post<State>(path, body).then(publish);

function useNotify() {
  const [state, setState] = useState<State | null>(shared);
  const [error, setError] = useState('');
  useEffect(() => {
    listeners.add(setState);
    const refresh = () => void load().then(() => setError(''), (e: Error) => setError(e.message));
    refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    window.addEventListener('focus', refresh);
    return () => { listeners.delete(setState); clearInterval(t); window.removeEventListener('focus', refresh); };
  }, []);
  const act = useCallback((path: string, body: unknown) => post(path, body).then(() => setError(''), (e: Error) => setError(e.message)), []);
  return { state, error, act };
}

/* ---------------- one type ---------------- */

function TypeRowView({ t, s, act }: { t: TypeRow; s: State; act: (path: string, body: unknown) => Promise<void> }) {
  const [sent, setSent] = useState('');
  const test = () => {
    setSent('Sending…');
    api.post<{ sent: string[]; why: string }>('test', { type: t.id }).then(
      (r) => setSent(r.sent.length ? `Sent to: ${r.sent.map((c) => s.channels.find((x) => x.id === c)?.label ?? c).join(', ')}` : `Nothing sent: ${r.why}`),
      (e: Error) => setSent(e.message),
    );
  };
  return (
    <div className={`${P}__row`} data-type={t.id}>
      <div className={`${P}__top`}>
        <div className={`${P}__name`}>
          {t.fixed ? <b>{t.label}</b> : <Switch label={t.label} checked={t.settings.enabled} onChange={(v) => void act('set', { type: t.id, enabled: v })} hint={t.description} />}
          {t.fixed && <p className={`${P}__muted`}>{t.description}</p>}
        </div>
        {t.guarded && <Chip><Icon name="lock" size={12} /> Yours only</Chip>}
        {t.linkedOff && <Chip>Off in Claude settings</Chip>}
        <span className={`${P}__why`}>{t.fixed ? t.enforcedText : t.now.why}</span>
      </div>
      {!t.fixed && (
        <div className={`${P}__line`} role="group" aria-label={`${t.label} channels`}>
          {t.allowed.map((id) => {
            const c = s.channels.find((x) => x.id === id);
            const on = t.settings.channels[id] === true;
            return (
              <Button key={id} size="sm" tone={on ? 'primary' : 'neutral'} icon={c?.icon} aria-pressed={on} title={c?.description} disabled={!t.settings.enabled}
                onClick={() => void act('set', { type: t.id, channel: id, on: !on })}>{c?.label ?? id}</Button>
            );
          })}
          <div className={`${P}__pri`}>
            <SelectField label="Priority" value={t.settings.priority} options={s.priorities.map((p) => ({ value: p, label: label(p) }))}
              onChange={(v) => void act('set', { type: t.id, priority: v })} />
          </div>
          <Button size="sm" tone="ghost" icon="play" onClick={test}>Test</Button>
          {t.customized && <Button size="sm" tone="ghost" icon="undo" onClick={() => void act('reset', { type: t.id, confirm: 'reset' })}>Reset</Button>}
          {sent && <span className={`${P}__why`} role="status">{sent}</span>}
        </div>
      )}
    </div>
  );
}

/* ---------------- the page ---------------- */

function Panel() {
  const { state: s, error, act } = useNotify();
  const [q, setQ] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  useEffect(() => { if (s) { setStart(s.quiet.start); setEnd(s.quiet.end); } }, [s?.quiet.start, s?.quiet.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    if (!s) return [];
    const needle = q.trim().toLowerCase();
    const hit = (t: TypeRow) => !needle || `${t.label} ${t.id} ${t.source} ${t.description}`.toLowerCase().includes(needle);
    return s.groups.map((g) => ({ ...g, rows: s.types.filter((t) => t.group === g.id && hit(t)) })).filter((g) => g.rows.length);
  }, [s, q]);
  if (error && !s) return <Note tone="danger">Notifications panel unavailable: {error}</Note>;
  if (!s) return <p className={`${P}__muted`}>Loading notifications…</p>;
  return (
    <div className="fx-stack">
      {error && <Note tone="danger">{error}</Note>}
      {!s.master && <Note tone="warning" icon="bell">Everything is off except approvals and veto.</Note>}
      {s.quiet.now && <Note tone="info" icon="moon">Quiet hours now: only the banner and urgent ones get through; held alerts reach the phone when they end.</Note>}
      <Container title="Everything" icon="bell">
        <div className="fx-stack">
          <Switch label="All notifications" checked={s.master} hint="Master switch. Approvals and veto notices stay on, so you can always stop a held call." onChange={(v) => void act('master', { on: v })} />
          {s.apps.map((a) => <Switch key={a.id} label={a.label} checked={a.on} hint={a.description} onChange={(v) => void act('app', { app: a.id, on: v })} />)}
        </div>
      </Container>
      <Container title="Quiet hours" icon="moon">
        <div className="fx-stack">
          <Switch label="Quiet hours" checked={s.quiet.enabled} hint={`Holds phone pushes, sound and pop-ups, except urgent ones and approvals. Times are in ${s.quiet.timeZone}. The same setting as Claude → Notifications.`} onChange={(v) => void act('quiet', { enabled: v })} />
          <div className={`${P}__head`}>
            <TextField label="Quiet from" type="time" value={start} onChange={setStart} />
            <TextField label="Quiet until" type="time" value={end} onChange={setEnd} />
            {(start !== s.quiet.start || end !== s.quiet.end) && <Button size="sm" tone="primary" icon="save" onClick={() => void act('quiet', { start, end })}>Save</Button>}
          </div>
        </div>
      </Container>
      <Note tone="info" icon="info">{s.priorities.map((p) => PRIORITY_TEXT[p]).join('. ')}.</Note>
      <TextField label="Find a notification" value={q} onChange={setQ} placeholder="CI, veto, review…" />
      {groups.map((g) => (
        <Container key={g.id} title={`${g.label} (${g.rows.length})`} icon={g.icon}>
          <div>{g.rows.map((t) => <TypeRowView key={t.id} t={t} s={s} act={act} />)}</div>
        </Container>
      ))}
      <Container title="Sent and blocked lately" icon="list">
        {s.recent.length ? s.recent.map((r) => (
          <div key={`${r.key}${r.at}`} className={`${P}__recent`}>
            <b>{r.title}</b>
            <span className={`${P}__why`}>{r.label} · {r.allow ? `sent to ${r.channels.map((c) => s.channels.find((x) => x.id === c)?.label ?? c).join(', ') || 'nowhere'}` : r.why}{r.count > 1 ? ` · ${r.count}×` : ''} · {new Date(r.at).toLocaleTimeString()}</span>
          </div>
        )) : <p className={`${P}__muted`}>Nothing since the console started.</p>}
      </Container>
      <Button tone="ghost" icon="undo" confirm="Put every notification back to its defaults?" onClick={() => void act('reset', { confirm: 'reset' })}>Reset everything</Button>
    </div>
  );
}

function Page() {
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugins · Notifications</p>
          <h1>Notifications</h1>
          <p className="fx-muted">Every notification the console, AmberX and axHub can send. Each sender checks this list first.</p>
        </div>
      </header>
      <Panel />
    </div>
  );
}

/* ---------------- sound and pop-up in an open console ---------------- */

function tone(strong: boolean) {
  try {
    const A = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext; if (!A) return;
    const ctx = new A();
    for (const at of strong ? [0, 0.16] : [0]) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = strong ? 880 : 660; g.gain.value = 0.06; o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.12);
    }
    setTimeout(() => void ctx.close(), 800);
  } catch { /* no audio here */ }
}

/** Plays new alerts the server marked for sound or pop-up. The first pass only learns what is already there. */
function startDelivery(rt: AxfRuntime): () => void {
  const seen = new Set<string>();
  let primed = false;
  const beat = () => {
    const list = (alertsOf(rt)?.list() ?? []) as unknown as NotifyAlert[];
    if (!list.length) return;
    for (const a of list) {
      const id = `${a.key}@${a.lastAt}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!primed || a.resolved || !a.notify || document.visibilityState !== 'visible') continue;
      const strong = a.notify.priority === 'high' || a.notify.priority === 'urgent';
      if (a.notify.channels.sound) tone(strong);
      if (a.notify.channels.popup) rt.toast(a.body || a.title, strong ? 'warning' : 'info', a.title);
    }
    primed = true;
  };
  const t = setInterval(beat, DELIVER_MS);
  return () => clearInterval(t);
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.notify-control',
  label: 'Notifications',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('notify-control.open', () => rt.dispatch(`nav:${VIEW}`), { label: 'Notifications' });
    void load().catch(() => undefined); // the browser senders ask AXF_NOTIFY from the start
    setInterval(() => { if (document.visibilityState === 'visible') void load().catch(() => undefined); }, POLL_MS * 2);
    startDelivery(rt);
  },
  views: { [VIEW]: { title: 'Notifications', icon: 'bell', render: () => <Page /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Notifications', icon: 'bell', view: VIEW }] },
  settingsTabs: [{ id: VIEW, label: 'Notifications', icon: 'bell', order: 13, parent: 'plugins', description: 'Every notification: on or off, channels, priority, quiet hours, test send.' }],
  settingsPanels: [
    { id: 'notify-control.panel', tab: VIEW, title: 'Notifications', icon: 'bell', order: 1, render: () => <Panel /> },
    { id: 'notify-control.lifecycle', tab: VIEW, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
