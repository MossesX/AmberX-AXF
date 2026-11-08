/**
 * Failover & alerts (build account-failover-notify, Nov 8 2026): which Claude accounts are out, why and until when, what
 * moved where, each login's last token refresh, where each login is kept, and the settings for what happens when an
 * account stops a build (move it, wait for one, phone alerts). Layout = one of three settings assets (the UI Review
 * options); sections are framework Containers, every control a framework control.
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import sections from '../assets/settings/claude-accounts-failover-sections.json';
import statusFirst from '../assets/settings/claude-accounts-failover-status-first.json';
import compact from '../assets/settings/claude-accounts-failover-compact.json';

const FOLDER = 'claude-accounts';
export const FAILOVER_VIEW_KEY = 'axf.claude-accounts.failover.view';
export const FAILOVER_ASSETS = [sections, statusFirst, compact] as const;

interface Settings { enabled: boolean; maxMoves: number; waitMinutes: number; alerts: boolean; alertOnLimit: boolean }
interface Out { name: string; label: string; email: string; kind: string; reason: string; until: string; at: string; untilSignin: boolean }
interface Event { at: string; action: string; account: string; kind?: string; reason?: string; build?: string; to?: string; movedTo?: string; until?: string; stopped?: boolean; waiting?: boolean }
interface LoginRow { name: string; email: string; lastRefreshAt: string; lastRefreshBy: string; expiresAt: string }
interface Failover { ok: boolean; failover: Settings; out: Out[]; events: Event[]; logins: LoginRow[] }
interface Place { kind: string; session: string; owner: string; token: string; expiresAt: string; state: string }

const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const KIND: Record<string, string> = { auth: 'Login dead', usage: 'Limit', credits: 'No credits' };

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await pluginFetch(FOLDER, path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string; message?: string; ok?: boolean };
  if (!r.ok || j.ok === false) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
  return j;
}

function useFailover() {
  const [data, setData] = useState<Failover | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => call<Failover>('failover').then((d) => { setData(d); setError(''); }, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
    return () => clearInterval(t);
  }, [refresh]);
  return { data, error, refresh };
}

function useSaid(after: () => unknown) {
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (p: Promise<{ message?: string } | unknown>, ok = 'Saved.') => {
    setBusy(true); setSaid(null);
    return p.then((r) => { setSaid({ text: (r as { message?: string })?.message || ok, bad: false }); return after(); }, (e: Error) => setSaid({ text: e.message, bad: true })).finally(() => setBusy(false));
  };
  return { busy, run, note: said ? <Note tone={said.bad ? 'danger' : 'info'}>{said.text}</Note> : null };
}

/* ---------------- accounts out now ---------------- */

function OutNow({ data, refresh }: { data: Failover; refresh: () => unknown }) {
  const s = useSaid(refresh);
  if (!data.out.length) return <p className="axp-ca-help">Every Claude account can take jobs.</p>;
  return (
    <div className="fx-stack">
      {data.out.map((o) => (
        <div key={o.name} className="axp-ca-row" data-account={o.name}>
          <div className="axp-ca-row__who">
            <b>{o.label || o.name}</b>{o.label && <span className="axp-ca-row__sub"> · {o.name}</span>}
            {o.email && <p className="axp-ca-row__sub">{o.email}</p>}
            <p className="axp-ca-row__sub">{o.reason}{o.at ? ` · since ${when(o.at)}` : ''} · {o.untilSignin ? 'out until it is signed in again' : `back ${when(o.until)}`}</p>
          </div>
          <div className="axp-ca-row__actions">
            <Chip tone={o.kind === 'auth' ? 'danger' : 'warning'}>{KIND[o.kind] ?? o.kind}</Chip>
            {o.kind === 'auth' && <Button tone="primary" icon="key" busy={s.busy} disabled={s.busy} onClick={() => void s.run(call('signin', { name: o.name }))}>Sign in</Button>}
            <Button icon="refresh" busy={s.busy} disabled={s.busy} confirm={o.kind === 'auth' ? `Bring ${o.name} back without a new sign-in? Builds that land on it die again and move on.` : undefined}
              onClick={() => void s.run(call('clear', { name: o.name }))}>Bring back</Button>
          </div>
        </div>
      ))}
      {s.note}
    </div>
  );
}

/* ---------------- settings ---------------- */

function FailoverSettings({ data, refresh }: { data: Failover; refresh: () => unknown }) {
  const f = data.failover;
  const s = useSaid(refresh);
  const [moves, setMoves] = useState(String(f.maxMoves));
  const [wait, setWait] = useState(String(f.waitMinutes));
  useEffect(() => { setMoves(String(f.maxMoves)); setWait(String(f.waitMinutes)); }, [f.maxMoves, f.waitMinutes]);
  return (
    <div className="fx-stack">
      <Switch label="Move a build when its account stops it" hint="Dead login, usage limit or no credits: the account is taken out and the build starts again on the next account the routing rules allow (workers, then the console's account; API accounts only where a rule sends it)."
        checked={f.enabled} disabled={s.busy} onChange={(v) => void s.run(call('failover', { enabled: v }))} />
      <div className="axp-ca-save">
        <TextField label="Most moves per build" value={moves} hint="0 to 20" disabled={s.busy || !f.enabled} onChange={(v) => setMoves(v.trim())} />
        <TextField label="Wait for an account (minutes)" value={wait} hint="Every account out: the build waits this long for one to come back. 0 = stop." disabled={s.busy || !f.enabled} onChange={(v) => setWait(v.trim())} />
        <Button tone="primary" icon="save" busy={s.busy} disabled={s.busy || (String(f.maxMoves) === moves && String(f.waitMinutes) === wait)}
          onClick={() => void s.run(call('failover', { maxMoves: Number(moves), waitMinutes: Number(wait) }))}>Save</Button>
      </div>
      {s.note}
    </div>
  );
}

function AlertSettings({ data, refresh }: { data: Failover; refresh: () => unknown }) {
  const f = data.failover;
  const s = useSaid(refresh);
  return (
    <div className="fx-stack">
      <Switch label="Phone alert on every account problem" hint="AmberX: which account, what failed, where the build moved and what to do (e.g. sign it in). It closes by itself when the account works again. Quiet hours and the Notifications panel still apply."
        checked={f.alerts} disabled={s.busy} onChange={(v) => void s.run(call('failover', { alerts: v }))} />
      <Switch label="Also for limits that end by themselves" hint="Off = only a dead login, no credits, or a build with nowhere left to go buzzes the phone."
        checked={f.alertOnLimit} disabled={s.busy || !f.alerts} onChange={(v) => void s.run(call('failover', { alertOnLimit: v }))} />
      {s.note}
    </div>
  );
}

/* ---------------- events and logins ---------------- */

function eventLine(e: Event): string {
  if (e.action === 'back') return `${e.account} is back`;
  if (e.action === 'move') return `${e.build ? `${e.build}: ` : ''}moved from ${e.account} to ${e.to}`;
  const where = e.movedTo ? ` · ${e.build} moved to ${e.movedTo}` : e.waiting ? ` · ${e.build} waits for an account` : e.stopped ? ` · ${e.build} stopped` : e.build ? ` · ${e.build}` : '';
  return `${e.account}: ${e.reason || KIND[e.kind ?? ''] || e.kind}${where}`;
}

function Events({ data }: { data: Failover }) {
  if (!data.events.length) return <p className="axp-ca-help">No account problems recorded yet.</p>;
  return (
    <div>
      {data.events.map((e, i) => (
        <div key={`${e.at}-${i}`} className="axp-ca-row">
          <div className="axp-ca-row__who"><span>{eventLine(e)}</span><p className="axp-ca-row__sub">{when(e.at)}</p></div>
          <Chip tone={e.action === 'back' ? 'success' : e.kind === 'auth' || e.stopped ? 'danger' : e.action === 'move' ? 'accent' : 'warning'}>{e.action === 'out' ? KIND[e.kind ?? ''] ?? 'Out' : e.action === 'move' ? 'Moved' : 'Back'}</Chip>
        </div>
      ))}
    </div>
  );
}

function Logins({ data }: { data: Failover }) {
  const [places, setPlaces] = useState<{ rows: Place[]; behind: number; foreign: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const check = () => { setBusy(true); call<{ logins: Place[]; behind: number; foreign: number }>('logins').then((d) => { setPlaces({ rows: d.logins, behind: d.behind, foreign: d.foreign }); setError(''); }, (e: Error) => setError(e.message)).finally(() => setBusy(false)); };
  return (
    <div className="fx-stack">
      <p className="axp-ca-help">Each login has one home on the VPS. Every build's copy and the console's own login are kept in step with it, so a refresh in one place never leaves another holding a spent token.</p>
      <div>
        {data.logins.map((l) => (
          <div key={l.name} className="axp-ca-row" data-login={l.name}>
            <div className="axp-ca-row__who">
              <b>{l.name}</b>{l.email && <span className="axp-ca-row__sub"> · {l.email}</span>}
              <p className="axp-ca-row__sub">Last refresh {l.lastRefreshAt ? `${when(l.lastRefreshAt)}${l.lastRefreshBy ? ` (${l.lastRefreshBy})` : ''}` : 'not seen yet'}{l.expiresAt ? ` · token good until ${when(l.expiresAt)}` : ''}</p>
            </div>
          </div>
        ))}
      </div>
      <div><Button icon="search" busy={busy} disabled={busy} onClick={check}>Check where each login is kept</Button></div>
      {error && <Note tone="danger">{error}</Note>}
      {places && (
        <div className="fx-stack">
          <Note tone={places.behind || places.foreign ? 'warning' : 'info'}>
            {places.behind || places.foreign ? `${places.behind} copy${places.behind === 1 ? '' : 'ies'} behind its home, ${places.foreign} holding a login no saved account knows.` : 'Every copy is in step with its home.'}
          </Note>
          <div>
            {places.rows.map((p, i) => (
              <div key={`${p.kind}-${p.session}-${i}`} className="axp-ca-row">
                <div className="axp-ca-row__who"><span>{p.kind}{p.session ? ` · ${p.session}` : ''}</span><p className="axp-ca-row__sub">{p.owner || 'unknown login'} · token {p.token}…</p></div>
                <Chip tone={p.state === 'in step' ? 'success' : 'warning'}>{p.state}</Chip>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- the panel ---------------- */

const TITLE: Record<string, string> = { out: 'Accounts out now', failover: 'When an account stops a build', alerts: 'Phone alerts', events: 'Account events', logins: 'Logins and last refresh' };
const ICON: Record<string, string> = { out: 'alert', failover: 'shuffle', alerts: 'bell', events: 'clock', logins: 'key' };

export function Failover() {
  const { data, error, refresh } = useFailover();
  const rt = useRuntime();
  const id = useSyncExternalStore((fn) => rt.settings.subscribe(fn), () => String(rt.settings.get(FAILOVER_VIEW_KEY) ?? ''), () => '');
  const asset = FAILOVER_ASSETS.find((a) => a.id === id) ?? sections;
  if (error) return <Note tone="danger">Failover unavailable: {error}</Note>;
  if (!data) return <p className="axp-ca-help">Reading the Claude accounts…</p>;
  const body: Record<string, ReactNode> = {
    out: <OutNow data={data} refresh={refresh} />, failover: <FailoverSettings data={data} refresh={refresh} />, alerts: <AlertSettings data={data} refresh={refresh} />,
    events: <Events data={data} />, logins: <Logins data={data} />,
  };
  const open = new Set<string>(asset.data.open);
  const dead = data.out.filter((o) => o.untilSignin);
  return (
    <div className="fx-stack" data-axf-failover-view={asset.data.view}>
      {dead.length > 0 && <Note tone="danger">{dead.map((o) => o.name).join(', ')}: login dead. Builds skip {dead.length > 1 ? 'them' : 'it'} until {dead.length > 1 ? 'they are' : 'it is'} signed in again.</Note>}
      <div className="axp-ca-save">
        <SelectField label="Layout" value={asset.id} options={FAILOVER_ASSETS.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => rt.settings.set(FAILOVER_VIEW_KEY, v)} hint={asset.description} />
        <Button size="sm" tone="ghost" icon="refresh" onClick={() => void refresh()}>Refresh</Button>
      </div>
      {asset.data.order.map((k) => (
        <Container key={`${asset.data.view}-${k}`} title={TITLE[k]} icon={ICON[k]} collapsible defaultOpen={open.has(k)} className={`axp-ca-section axp-ca-section--${k}`}>{body[k]}</Container>
      ))}
    </div>
  );
}
