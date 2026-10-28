/*
 * Connections (Oct 28 2026). Brett: "1 toolbar to add tab running Claude code and prompt to select from available
 * connections … Any tab can be right clicked to show interface to individual manage each tab's connection from
 * available ones like vps root, specific containers, axhub, etc."
 *   - dialog `terminal.connect`    the connection picker: Claude Code or Shell, then where (console, VPS root, axHub,
 *                                  any container); opens a new tab, or switches one tab when `sessionId` is given
 *   - dialog `terminal.connection` one tab's Connection manager: where it's connected now, its state, reconnect,
 *                                  switch to another connection, duplicate onto another connection
 * Both read GET connections (server: every place a tab can go, with ready / why).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { call, tabSessions, type Connection, type Open } from './api';
import { addSession, ctl, host, hostIds, hostOf, patchSession, sessionId, snapshot, subscribe, titleFor, type HostSession } from './hosts';
import { applyProfile, profilesFor, useProfiles } from './profiles';
import { newTab } from './open';

export type Mode = 'claude' | 'shell';
const LAST = 'axf.terminal.lastConnection';

/** Which connection an Open is on (matches Connection.id). */
export function connectionOf(o: Open): string {
  if (o.kind === 'claude') return o.via === 'container' ? `container:${o.container}` : o.via ?? 'console';
  if (o.kind === 'container') return `container:${o.container}`;
  return o.kind; // console | vps
}
/** The Open for a connection in a mode (null when that connection has no such mode, e.g. a shell on axHub). */
export function openFor(c: Connection, mode: Mode, base: Partial<Open> = {}): Open | null {
  if (mode === 'claude') return c.claude ? { ...base, kind: 'claude', via: c.via, container: c.container, attach: undefined } : null;
  if (c.shell === false) return null;
  if (c.via === 'container') return { kind: 'container', container: c.container, cwd: base.cwd };
  return { kind: c.via === 'vps' ? 'vps' : 'console', cwd: base.cwd };
}
const remember = (id: string) => { try { localStorage.setItem(LAST, id); } catch { /* blocked */ } };
const last = () => { try { return localStorage.getItem(LAST) ?? ''; } catch { return ''; } };

export function useConnections() {
  const [items, setItems] = useState<Connection[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void call<{ items: Connection[] }>('connections').then((r) => setItems(r.items), (e: Error) => { setErr(e.message); setItems([]); }); }, []);
  return { items, err };
}

/** Point a tab at another connection: its server session closes, the tab starts again there. */
export function switchSession(sid: string, o: Open) {
  const srv = tabSessions.get(sid); tabSessions.delete(sid);
  if (srv) void call(`sessions/${srv}`, { method: 'DELETE' }).catch(() => undefined);
  patchSession(sid, { open: o, title: titleFor(o) });
  setTimeout(() => ctl(sid)?.restart(), 60);
}

function ConnectionList({ items, mode, current, onPick }: { items: Connection[]; mode: Mode; current?: string; onPick(c: Connection): void }) {
  let group = '';
  return (
    <div className="axp-wt-conn__list" role="listbox" aria-label="Connections">
      {items.map((c) => {
        const can = mode === 'claude' ? c.claude : c.shell !== false;
        const head = c.group && c.group !== group ? (group = c.group) : null;
        return (
          <div key={c.id}>
            {head && <div className="axp-wt__mh">{head}</div>}
            <button type="button" role="option" aria-selected={current === c.id} className={`fx-menu__item axp-wt-conn__item ${current === c.id ? 'is-current' : ''}`} disabled={!c.ready || !can}
              title={!c.ready ? c.why : !can ? (mode === 'claude' ? 'Claude Code can’t run here' : 'No shell here: pick Claude Code') : ''} onClick={() => onPick(c)}>
              <Icon name={c.icon} size={16} />
              <span className="axp-wt-conn__text"><strong>{c.label}</strong><span className="fx-muted fx-small">{!c.ready ? c.why : c.detail}</span></span>
              {c.badge && <span className="axp-wt__flag">{c.badge}</span>}
              {current === c.id && <Icon name="check" size={14} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** dialog `terminal.connect` — props: { hostId, mode?, sessionId? } */
export function ConnectDialog({ props, close }: { props: Record<string, unknown>; close(): void }) {
  const rt = useRuntime();
  const hostId = String(props.hostId ?? ''); const switching = props.sessionId ? String(props.sessionId) : null;
  const [mode, setMode] = useState<Mode>((props.mode as Mode) ?? 'claude');
  const profiles = useProfiles();
  const [profile, setProfile] = useState<string>(String(props.profile ?? profiles.defaultId ?? ''));
  const { items, err } = useConnections();
  const pick = (c: Connection) => {
    const base = mode === 'claude' ? applyProfile(profilesFor(profiles, profile)) : {};
    const o = openFor(c, mode, base); if (!o) return;
    remember(c.id); close();
    const color = mode === 'claude' ? profilesFor(profiles, profile)?.color || undefined : undefined;
    if (switching) switchSession(switching, o);
    else if (hostId && rt.windows.groupOf(hostId)) addSession(hostId, { id: sessionId(), title: titleFor(o), open: o, color } as HostSession);
    else newTab(rt, o);
  };
  return (
    <div className="axp-wt-conn">
      <div className="fx-tabs" role="tablist" aria-label="What runs in the tab">
        <button type="button" role="tab" aria-selected={mode === 'claude'} className={`fx-tab ${mode === 'claude' ? 'is-active' : ''}`} onClick={() => setMode('claude')}><Icon name="sparkles" size={14} /> Claude Code</button>
        <button type="button" role="tab" aria-selected={mode === 'shell'} className={`fx-tab ${mode === 'shell' ? 'is-active' : ''}`} onClick={() => setMode('shell')}><Icon name="terminal" size={14} /> Shell</button>
      </div>
      {mode === 'claude' && profiles.items.length > 0 && (
        <label className="axp-terminal__field"><span>Profile</span>
          <select className="fx-input" value={profile} onChange={(e) => setProfile(e.target.value)}>
            {profiles.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <p className="fx-small fx-muted">{switching ? 'Move this tab to:' : mode === 'claude' ? 'Run Claude Code on:' : 'Open a shell on:'}</p>
      {items === null ? <p className="fx-muted">Loading connections…</p> : <ConnectionList items={items} mode={mode} current={last()} onPick={pick} />}
      {err && <p className="fx-small" role="alert">{err}</p>}
    </div>
  );
}

/** dialog `terminal.connection` — props: { sessionId } */
export function ConnectionDialog({ props, close }: { props: Record<string, unknown>; close(): void }) {
  const rt = useRuntime();
  useSyncExternalStore(subscribe, snapshot);
  const sid = String(props.sessionId ?? '');
  const hid = hostOf(sid);
  const s = hid ? findSession(sid) : null;
  const c = ctl(sid);
  const { items } = useConnections();
  const [switching, setSwitching] = useState(false);
  if (!s || !hid) return <p className="fx-muted">That tab is closed.</p>;
  const mode: Mode = s.open.kind === 'claude' ? 'claude' : 'shell';
  const cur = connectionOf(s.open);
  const conn = items?.find((x) => x.id === cur);
  const info = c?.info;
  const rows: [string, string][] = [
    ['Runs', mode === 'claude' ? 'Claude Code' : 'Shell'], ['Connection', conn?.label ?? cur], ['Where', info?.target ?? conn?.detail ?? ''],
    ['Folder', info?.cwd || s.open.cwd || '–'], ['State', c?.conn ?? 'not started'], ['Mosh mode', c?.mosh ? 'on' : 'off'],
    ...(s.open.model ? [['Model', s.open.model] as [string, string]] : []), ...(s.open.permissionMode ? [['Permissions', s.open.permissionMode] as [string, string]] : []),
    ['Opened', info ? new Date(info.createdAt * 1000).toLocaleString() : '–'],
  ];
  return (
    <div className="axp-wt-conn">
      <div className="axp-wt-conn__now">
        <Icon name={conn?.icon ?? 'terminal'} size={22} />
        <div className="fx-grow"><strong>{s.title}</strong><div className="fx-small fx-muted">{conn?.label ?? cur}{info?.badge ? ` · ${info.badge}` : ''}</div></div>
        <span className={`axp-wt__dot is-${c?.conn ?? 'closed'}`} data-live={c?.conn === 'live' ? '' : undefined} />
      </div>
      <dl className="axp-wt-conn__facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" onClick={() => { c?.restart(); close(); }}>Reconnect</Button>
        <Button icon="shuffle" tone={switching ? 'primary' : 'ghost'} onClick={() => setSwitching(!switching)}>Switch connection</Button>
        <Button icon="copy" tone="ghost" onClick={() => { close(); rt.openDialog('terminal.connect', { hostId: hid, mode }); }}>New tab elsewhere</Button>
      </div>
      {switching && (items ? <ConnectionList items={items} mode={mode} current={cur} onPick={(x) => { const o = openFor(x, mode, s.open); if (o) { remember(x.id); switchSession(sid, o); close(); } }} /> : <p className="fx-muted">Loading connections…</p>)}
    </div>
  );
}

function findSession(sid: string): HostSession | null {
  for (const h of hostIds()) { const s = host(h).sessions.find((x) => x.id === sid); if (s) return s; }
  return null;
}
