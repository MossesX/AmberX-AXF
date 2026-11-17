/**
 * Settings → Plugins → Phone Connect: pair a phone (one-time code), the paired phones (presence, watch, url policy,
 * revoke / forget: the owner's taps), per-feature switches, and the recent commands. Every value comes from the server
 * (GET status / devices / settings / commands); every button calls the same route as MCP phone_connect_* and `axf phone`.
 * Addresses (console-control@1): the tab row `tab-group:phone-connect.tabs`, rows `row:device/<id>` and `row:command/<id>`,
 * switches `setting:phone-connect.feature.<name>`; buttons register themselves through the framework Button.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Note, Section, SelectField, Switch, TabGroup, TextField } from '@console/axf/react';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, phone, type Device, type Feature, type Status } from './client';
import './phone-connect.css';

const P = 'axp-phone';
const POLL_MS = 5000;
type Tab = 'pair' | 'phones' | 'features' | 'activity';
interface Cmd { id: string; command: string; status: string; at: string; from: { kind: string; who: string; via?: string }; result: { ok: boolean; error?: { code: string; message: string } } | null }

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : 'never');
const tone = (d: Device): 'success' | 'warning' | 'danger' | undefined => (d.state === 'revoked' ? 'danger' : d.online ? 'success' : d.state === 'paired' ? 'warning' : undefined);

export function useStatus(): { st: Status | null; err: string; reload: () => Promise<void> } {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(async () => {
    const r = await phone<Status>('status');
    if (r.error) setErr(r.error.message); else { setSt(r); setErr(''); }
  }, []);
  useEffect(() => {
    void reload();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);
  return { st, err, reload };
}

function PairPane({ st, reload }: { st: Status | null; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const p = st?.pairing ?? null;
  const run = async (path: string) => {
    setBusy(true);
    const r = await phone(path, {});
    setMsg(r.error ? r.error.message : '');
    setBusy(false);
    await reload();
  };
  return (
    <div className={P}>
      <p className={`${P}__muted`}>Pair the Phone Connect app: tap New code, then type the code in the app. The app claims it with your own axHub sign-in, so no session can pair a phone for you.</p>
      {p ? (
        <div className={P} data-axf-target="row:pairing/current">
          <div className={`${P}__code`} aria-label="Pairing code">{p.code}</div>
          <p className={`${P}__muted`}>Valid for {Math.max(0, Math.ceil(p.secondsLeft / 60))} more min, once.</p>
          <div className={`${P}__line`}>
            <Button icon="refresh" busy={busy} onClick={() => void run('pair/start')}>New code</Button>
            <Button tone="ghost" icon="x" busy={busy} onClick={() => void run('pair/cancel')}>Cancel code</Button>
            <Button tone="ghost" icon="copy" onClick={() => void navigator.clipboard?.writeText(p.code)}>Copy code</Button>
          </div>
        </div>
      ) : (
        <div className={`${P}__line`}>
          <Button tone="primary" icon="smartphone" busy={busy} onClick={() => void run('pair/start')}>New code</Button>
        </div>
      )}
      {msg && <Note tone="warning">{msg}</Note>}
    </div>
  );
}

function DeviceRow({ d, reload }: { d: Device; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState('');
  const [allow, setAllow] = useState(d.urlPolicy.allowlist.join(', '));
  const act = async (path: string, body: unknown = {}) => {
    const r = await phone(`devices/${encodeURIComponent(d.deviceId)}/${path}`, body);
    setMsg(r.error ? r.error.message : '');
    await reload();
  };
  const rec = d.capabilityState['recorder@1'] as { running?: boolean; session?: string } | undefined;
  return (
    <div className={`${P}__row`} data-axf-target={`row:device/${d.deviceId}`}>
      <div className={`${P}__line`}>
        <b className={`${P}__name`}>{d.name}</b>
        <Chip tone={tone(d)}>{d.presence}</Chip>
        {rec?.running && <Chip tone="accent">recording</Chip>}
      </div>
      <div className={`${P}__meta`}>{d.deviceId} · app {d.appVersion || '?'} · paired {when(d.pairedAt)} · last seen {when(d.lastSeenAt)}{d.token ? ` · token ${d.token.prefix}…` : ''}</div>
      {d.state === 'paired' && (
        <>
          <div className={`${P}__line`}>
            <Switch label="Watch (keep the link open)" checked={d.watch.on} onChange={(on) => void act('settings', { watch: { on } })} />
            <Switch label="Ring on new approvals" checked={d.watch.ring} onChange={(ring) => void act('settings', { watch: { ring } })} />
          </div>
          <div className={`${P}__line`}>
            <SelectField className={`${P}__field`} label="Pages it may open" value={d.urlPolicy.mode}
              options={[{ value: 'own', label: 'Only the console' }, { value: 'allowlist', label: 'The console + these sites' }, { value: 'any', label: 'Any https site' }]}
              onChange={(mode) => void act('settings', { urlPolicy: { mode } })} />
            {d.urlPolicy.mode === 'allowlist' && (
              <TextField className={`${P}__field`} label="Sites (comma separated)" value={allow} onChange={setAllow}
                hint="Host names, e.g. github.com" />
            )}
            {d.urlPolicy.mode === 'allowlist' && (
              <Button size="sm" onClick={() => void act('settings', { urlPolicy: { allowlist: allow.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) } })}>Save sites</Button>
            )}
          </div>
        </>
      )}
      <div className={`${P}__line`}>
        {d.state === 'paired' && <Button size="sm" tone="danger" icon="x" confirm={`Revoke ${d.name}? Its token stops working at once; pair it again with a new code.`} onClick={() => void act('revoke')}>Revoke</Button>}
        <Button size="sm" tone="ghost" icon="trash" confirm={`Forget ${d.name}? Its record goes; the app has to pair again.`} onClick={() => void act('forget')}>Forget</Button>
      </div>
      {msg && <Note tone="warning">{msg}</Note>}
    </div>
  );
}

function PhonesPane({ reload }: { reload: () => Promise<void> }) {
  const [list, setList] = useState<Device[] | null>(null);
  const load = useCallback(async () => { const r = await phone<{ devices: Device[] }>('devices'); setList(r.devices ?? []); await reload(); }, [reload]);
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS); return () => clearInterval(t); }, [load]);
  if (!list) return <p className={`${P}__muted`}>Loading…</p>;
  if (!list.length) return <p className={`${P}__muted`}>No phone is paired yet. Open Pair for a code.</p>;
  return <div>{list.map((d) => <DeviceRow key={d.deviceId} d={d} reload={load} />)}</div>;
}

type FeatureSettings = { features: Record<string, boolean>; catalog: Record<string, Feature>; layout?: string };
const layoutOf = (s: FeatureSettings) => s.layout ?? 'tabs';

function FeaturesPane() {
  const [s, setS] = useState<FeatureSettings | null>(null);
  const load = useCallback(async () => { const r = await phone<FeatureSettings>('settings'); if (!r.error) setS(r); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!s) return <p className={`${P}__muted`}>Loading…</p>;
  return (
    <div className={P}>
      {Object.entries(s.catalog).map(([k, f]) => (
        <div key={k} data-axf-target={`setting:phone-connect.feature.${k}`}>
          <Switch label={f.label} hint={f.description} checked={s.features[k] !== false}
            onChange={async (on) => { await phone('settings', { features: { [k]: on } }); await load(); }} />
        </div>
      ))}
      <div data-axf-target="setting:phone-connect.layout">
        <SelectField label="Layout of this tab" value={layoutOf(s)} options={[{ value: 'tabs', label: 'Tabs' }, { value: 'stacked', label: 'One page' }, { value: 'split', label: 'Phone on top, the rest in tabs' }]}
          onChange={async (layout) => { await phone('settings', { layout }); await load(); }} />
      </div>
      <p className={`${P}__muted`}>Approve and Deny are never commands: an approval on the phone is decided only by your tap there.</p>
    </div>
  );
}

function ActivityPane() {
  const [list, setList] = useState<Cmd[] | null>(null);
  const load = useCallback(async () => { const r = await phone<{ commands: Cmd[] }>('commands?limit=30'); setList(r.commands ?? []); }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS); return () => clearInterval(t); }, [load]);
  if (!list) return <p className={`${P}__muted`}>Loading…</p>;
  if (!list.length) return <p className={`${P}__muted`}>Nothing sent to the phone yet.</p>;
  return (
    <div>
      {list.map((c) => (
        <div key={c.id} className={`${P}__row`} data-axf-target={`row:command/${c.id}`}>
          <div className={`${P}__line`}>
            <b className={`${P}__name`}>{c.command}</b>
            <Chip tone={c.status === 'done' ? 'success' : c.status === 'failed' ? 'danger' : undefined}>{c.status}</Chip>
          </div>
          <div className={`${P}__meta`}>{when(c.at)} · from {c.from.who} ({c.from.via ?? c.from.kind}){c.result?.error ? ` · ${c.result.error.message}` : ''}</div>
        </div>
      ))}
    </div>
  );
}

/** Deep links (console actions phone.tab / phone.device, console_show row:device/<id>): which tab, which row to show. */
const SHOW_EVENT = 'axp-phone:show';
let pending: { tab: Tab; device?: string } | null = null;
export const TABS: Tab[] = ['pair', 'phones', 'features', 'activity'];
export function showInPanel(tab: Tab, device?: string): void {
  pending = { tab, device };
  globalThis.dispatchEvent(new CustomEvent(SHOW_EVENT));
}

type Layout = 'tabs' | 'stacked' | 'split';
const PANES: Record<Tab, string> = { pair: 'Pair a phone', phones: 'Phones', features: 'Features', activity: 'Activity' };

export function PhoneConnectPanel() {
  const { st, err, reload } = useStatus();
  const [layout, setLayout] = useState<Layout>('tabs');
  useEffect(() => { void phone<{ layout?: Layout }>('settings').then((r) => { if (r.layout) setLayout(r.layout); }); }, []);
  const [tab, setTab] = useState<Tab>(pending?.tab ?? 'pair');
  const [focus, setFocus] = useState(pending?.device ?? '');
  useEffect(() => {
    const take = () => { if (pending) { setTab(pending.tab); setFocus(pending.device ?? ''); pending = null; } };
    take();
    globalThis.addEventListener(SHOW_EVENT, take);
    return () => globalThis.removeEventListener(SHOW_EVENT, take);
  }, []);
  const pane = (t: Tab) => (t === 'pair' ? <PairPane st={st} reload={reload} /> : t === 'phones' ? <PhonesPane reload={reload} /> : t === 'features' ? <FeaturesPane /> : <ActivityPane />);
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => document.querySelector(`[data-axf-target="row:device/${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'center' }), 300);
    return () => clearTimeout(t);
  }, [focus, tab]);
  return (
    <div className={P}>
      <div className={`${P}__line`}>
        <b className={`${P}__name`}>{st?.device ? st.device.name : 'No phone paired'}</b>
        <Chip tone={st?.online ? 'success' : st?.paired ? 'warning' : undefined}>{st?.presence ?? '…'}</Chip>
      </div>
      {err && <Note tone="warning">{err}</Note>}
      {layout === 'stacked' ? (
        TABS.map((t) => <Section key={t} title={PANES[t]}>{pane(t)}</Section>)
      ) : layout === 'split' ? (
        <>
          <Section title={st?.paired ? PANES.phones : PANES.pair}>{pane(st?.paired ? 'phones' : 'pair')}</Section>
          <TabGroup<Tab> id="phone-connect.tabs" label="Phone Connect" value={tab === 'activity' ? 'activity' : 'features'} onChange={setTab}
            tabs={[{ value: 'features', label: 'Features', icon: 'sliders' }, { value: 'activity', label: 'Activity', icon: 'activity' }]}>
            {pane(tab === 'activity' ? 'activity' : 'features')}
          </TabGroup>
        </>
      ) : (
        <TabGroup<Tab> id="phone-connect.tabs" label="Phone Connect" value={tab} onChange={setTab}
          tabs={[{ value: 'pair', label: 'Pair', icon: 'smartphone' }, { value: 'phones', label: 'Phones', icon: 'list', badge: st?.devices ?? 0 },
            { value: 'features', label: 'Features', icon: 'sliders' }, { value: 'activity', label: 'Activity', icon: 'activity' }]}>
          {pane(tab)}
        </TabGroup>
      )}
    </div>
  );
}

export const panels = [
  { id: 'phone-connect.panel', tab: FOLDER, title: 'Phone Connect', icon: 'smartphone', order: 1, render: () => <Container title="Phone Connect" icon="smartphone"><PhoneConnectPanel /></Container> },
  { id: 'phone-connect.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
];
