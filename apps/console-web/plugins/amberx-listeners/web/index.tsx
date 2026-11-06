/**
 * AmberX listeners console plugin (ai.amberx.axf.console.amberx-listeners; Nov 6 2026, Fable, build gizmo-rebuild-fable).
 *
 * Apps → AmberX → Listeners: every AmberX device that publishes its background listeners to the hub (listener-state@1,
 * written by the phone's Listeners plugin), with each listener's live state (listening · paused for a call / another
 * app · stopped on errors with the reason), who holds the microphone and the last error; and the same controls the
 * phone has (allowed, pause for calls, pause for other apps, start sound, restarts before it gives up, Restart), written
 * to the AmberX settings document on the hub through this plugin's server, so every phone follows on its next refresh.
 * The rules and words come from the framework's listeners library (the same copy the phone runs).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Icon, Note, SelectField, Switch, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { RETRY_CHOICES, listenerLabel, policyFieldsFor, stateLabel, stateTone, type ListenerInfo, type ListenerPolicy, type ListenerState } from '@console/axf/libs/listeners';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './amberx-listeners.css';

const ID = 'ai.amberx.axf.console.amberx-listeners';
const FOLDER = 'amberx-listeners';
const VIEW = 'amberx-listeners';
const REFRESH_KEY = 'amberx-listeners.refreshSec';

interface Row extends ListenerInfo { fields: (keyof ListenerPolicy)[]; stateLabel: string }
interface Device { device: string; name: string; app: string; at: number; side: 'native' | 'page'; micOff: boolean; micHolder: string | null; listeners: Row[]; stale: boolean; summary: string }
interface PolicyView extends ListenerPolicy { label: string; fields: (keyof ListenerPolicy)[]; restartAskedAt: string }
interface State { ok: boolean; live: boolean; devices: Device[]; policies: Record<string, PolicyView>; registry: { id: string; label: string; kind: string; side: string; about: string }[]; updatedAt?: string; updatedBy?: string; message?: string }

async function load(): Promise<State> {
  const r = await pluginFetch(FOLDER, 'state');
  const j = (await r.json()) as State;
  if (!r.ok || !j.ok) throw new Error(j.message || `The console answered ${r.status}.`);
  return j;
}
const post = (path: string, body: unknown) => pluginFetch(FOLDER, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function when(ms: number) { return ms ? new Date(ms).toLocaleTimeString() : ''; }

function Controls({ id, policy, fields, onSet, onRestart, restartable }: { id: string; policy: ListenerPolicy; fields: (keyof ListenerPolicy)[]; onSet: (id: string, patch: Partial<ListenerPolicy>) => void; onRestart: (id: string) => void; restartable: boolean }) {
  return (
    <div className="axp-amberx-listeners__controls">
      {fields.includes('on') && <Switch label="Allowed" checked={policy.on} onChange={(v) => onSet(id, { on: v })} />}
      {fields.includes('pauseOnCall') && <Switch label="Pause for calls" checked={policy.pauseOnCall} onChange={(v) => onSet(id, { pauseOnCall: v })} />}
      {fields.includes('pauseForOtherApps') && <Switch label="Pause for other apps" checked={policy.pauseForOtherApps} onChange={(v) => onSet(id, { pauseForOtherApps: v })} />}
      {fields.includes('sound') && <Switch label="Start sound" checked={policy.sound} onChange={(v) => onSet(id, { sound: v })} hint="Only for a start Brett asked for; restarts are silent." />}
      {fields.includes('retries') && <SelectField label="Restarts before it gives up" value={String(policy.retries)} onChange={(v) => onSet(id, { retries: Number(v) })} options={RETRY_CHOICES.map((c) => ({ value: String(c.value), label: c.label }))} />}
      {restartable && <div className="axp-amberx-listeners__actions"><Button size="sm" icon="refresh" onClick={() => onRestart(id)} disabled={!policy.on}>Restart on every phone</Button></div>}
    </div>
  );
}

function DeviceCard({ d, onSet, onRestart }: { d: Device; onSet: (id: string, patch: Partial<ListenerPolicy>) => void; onRestart: (id: string) => void }) {
  return (
    <Container title={d.name} icon={d.side === 'native' ? 'smartphone' : 'monitor'} className="axp-amberx-listeners__device" data-device={d.device}>
      <div className="axp-amberx-listeners__state">
        <span className="fx-muted axp-amberx-listeners__grow">{d.summary} · last report {when(d.at)}</span>
        {d.stale && <Chip tone="warning">Stale: no report for 10 min</Chip>}
        {d.micOff && <Chip tone="danger">Mic off</Chip>}
        {d.micHolder && <Chip tone="accent">Mic: {listenerLabel(d.micHolder)}</Chip>}
      </div>
      <div className="axp-amberx-listeners__grid">
        {d.listeners.map((l) => (
          <div key={l.id} className="axp-amberx-listeners__row" data-listener={l.id} data-state={l.state}>
            <div className="axp-amberx-listeners__state">
              <strong className="axp-amberx-listeners__name">{l.label}</strong>
              <Chip tone={stateTone(l.state as ListenerState)}>{l.stateLabel || stateLabel(l)}</Chip>
              {l.holdsMic && <Chip tone="accent">Has the mic</Chip>}
              {l.attempts > 0 && <Chip tone="warning">Retry {l.attempts}{l.policy.retries >= 0 ? ` of ${l.policy.retries}` : ''}</Chip>}
            </div>
            {l.lastError && <p className="axp-amberx-listeners__error">Last error: {l.lastError}{l.lastErrorAt ? ` (${when(l.lastErrorAt)})` : ''}</p>}
            <Controls id={l.id} policy={l.policy} fields={l.fields ?? policyFieldsFor(l.id)} onSet={onSet} onRestart={onRestart} restartable={l.side === 'native' && (l.fields ?? policyFieldsFor(l.id)).includes('on')} />
          </div>
        ))}
      </div>
    </Container>
  );
}

export function ListenersPage() {
  const rt = useRuntime();
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState('');
  const refresh = useCallback(() => { load().then((s) => { setSt(s); setErr(''); }, (e: Error) => setErr(e.message)); }, []);
  useEffect(() => {
    refresh();
    const sec = Math.max(5, Math.min(300, Number(rt.settings.get(REFRESH_KEY) ?? 15)));
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, sec * 1000);
    return () => clearInterval(t);
  }, [refresh, rt]);
  const onSet = async (id: string, patch: Partial<ListenerPolicy>) => {
    const r = await post('policy', { id, policy: patch });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; live?: boolean };
    if (!r.ok || !j.ok) { rt.toast(j.message || `The console answered ${r.status}.`, 'danger', 'AmberX listeners'); return; }
    rt.toast(`${listenerLabel(id)}: saved on axHub${j.live ? '' : ' (not live: the hub is not mounted on this console)'}. Every phone follows on its next refresh.`, 'success', 'AmberX listeners');
    refresh();
  };
  const onRestart = async (id: string) => {
    const r = await post('restart', { id });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!r.ok || !j.ok) { rt.toast(j.message || `The console answered ${r.status}.`, 'danger', 'AmberX listeners'); return; }
    rt.toast(`${listenerLabel(id)}: restart asked; every phone restarts it on its next refresh.`, 'success', 'AmberX listeners');
    refresh();
  };
  const policies = st ? Object.entries(st.policies) : [];
  return (
    <div className="axp-amberx-listeners" data-help="view:amberx-listeners">
      <div className="axp-amberx-listeners__head">
        <Icon name="mic" size={18} />
        <strong>AmberX listeners</strong>
        <span className="fx-muted axp-amberx-listeners__grow">{st ? `${st.devices.length} device${st.devices.length === 1 ? '' : 's'} reporting${st.live ? '' : ' · the hub is not mounted here'}` : 'Reading…'}</span>
        <Button size="sm" icon="refresh" onClick={refresh}>Refresh</Button>
      </div>
      {err && <Note tone="warning">{err}</Note>}
      {st && !st.devices.length && <Note tone="info">No AmberX device has published its listeners yet. Open AmberX on the phone (Listeners page, or just leave it running): it reports every few minutes and on every change.</Note>}
      {st?.devices.map((d) => <DeviceCard key={d.device} d={d} onSet={onSet} onRestart={onRestart} />)}
      {st && (
        <Container title="Policies on axHub (every device)" icon="sliders">
          <p className="fx-muted">The same switches the phone shows under Listeners, as the hub holds them{st.updatedAt ? ` (last change ${new Date(st.updatedAt).toLocaleString()} by ${st.updatedBy || 'unknown'})` : ''}. One owner of the microphone at a time; a listener that keeps getting refused backs off and stops with the reason; restarts never replay the start tone.</p>
          <div className="axp-amberx-listeners__grid">
            {policies.map(([id, p]) => (
              <div key={id} className="axp-amberx-listeners__row" data-policy={id}>
                <strong className="axp-amberx-listeners__name">{p.label}</strong>
                <Controls id={id} policy={p} fields={p.fields} onSet={onSet} onRestart={onRestart} restartable={st.registry.find((r) => r.id === id)?.side === 'native' && p.fields.includes('on')} />
                {p.restartAskedAt && <span className="fx-muted">Restart asked {new Date(p.restartAskedAt).toLocaleString()}</span>}
              </div>
            ))}
          </div>
        </Container>
      )}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'AmberX listeners',
  version: '0.1.0',
  builtWith: { model: 'fable', builtAt: '2026-11-06' },
  views: { [VIEW]: { title: 'AmberX listeners', icon: 'mic', keywords: ['amberx', 'listeners', 'microphone', 'mic', 'hands-free', 'talk mode', 'gizmo', 'restart', 'pause', 'calls'], render: () => <ListenersPage /> } },
  nav: { label: 'Apps', items: [{ id: VIEW, label: 'AmberX listeners', icon: 'mic', view: VIEW }] },
  appMenu,
  settingsTabs: [{ id: FOLDER, label: 'AmberX listeners', icon: 'mic', order: 93, parent: 'plugins', description: 'How often the page re-reads the hub; install and uninstall' }],
  settings: [{ id: 'amberx-listeners.page', label: 'AmberX listeners', icon: 'mic', tab: FOLDER, settings: [
    { key: REFRESH_KEY, label: 'Re-read the hub every (seconds)', kind: 'number', default: 15, min: 5, max: 300, step: 5, description: 'While the page is open and visible.' },
    { key: 'amberx-listeners.open', label: 'Open the page', kind: 'link', target: VIEW },
  ] }],
  settingsPanels: [
    { id: 'amberx-listeners.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
  register(rt) {
    rt.actions.register('amberx-listeners.open', () => rt.navigate(VIEW), { label: 'AmberX listeners' });
  },
};
