import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon, Note, TextField, useRuntime } from '../axf/react';
import type { AxfWebLibrary } from '../axf/react/library';
import {
  authSettingKeys, backendOf, CONNECTION_STATUS_LABEL, connectionOffers, connectionStatus, connectionSummary,
  type AppConnection, type ConnectionStatus,
} from './credentials';
import { signInApp } from '../actions';
import { mollyCredentials } from './host';

/**
 * App connections (molly-sign-in-once, s2): Molly's one sign-in screen and its Settings section. Each app Molly holds is
 * a row in the systems check's style (a status dot and chip, the app, how it signs in, one summary line; a row opens to
 * its details and what to do). Every button runs the same `molly.auth.*` action the menus, command search and remote
 * callers run, so the screen never does anything an action can't.
 *
 * Reached by: the `connections` view (deep link `#/connections[/<app>]`), `molly.auth.open[:app]`, Molly's navigation and
 * application menu, and Settings → App connections (`settings.open:molly-connections`).
 */

export const CONNECTIONS_VIEW = 'connections';
export const CONNECTIONS_TAB = 'molly-connections';

/* ---------- the row that is open (an action or a deep link may name it) ---------- */

const focus = { app: '' as string, rev: 0 };
const focusSubs = new Set<() => void>();
/** Open `app`'s row on the connections screen ('' closes nothing, just shows the screen). */
export function focusConnection(app: string): void { focus.app = app; focus.rev++; focusSubs.forEach((f) => f()); }
const useFocus = () => useSyncExternalStore((f) => { focusSubs.add(f); return () => { focusSubs.delete(f); }; }, () => focus.rev, () => focus.rev);

/** Every connection, re-rendered when any of them changes. */
function useConnections(): AppConnection[] {
  const seam = mollyCredentials();
  useSyncExternalStore((f) => seam.subscribe(f), () => seam.revision(), () => seam.revision());
  return seam.connections();
}

function useSetting(key: string): string {
  const rt = useRuntime();
  const v = useSyncExternalStore((f) => rt.settings.onChange(key, f), () => rt.settings.get(key), () => rt.settings.get(key));
  return typeof v === 'string' ? v : '';
}

/* ---------- bits in the systems check's look ---------- */

export function ConnectionDot({ s }: { s: ConnectionStatus }) {
  return <span className={`molly-conn-dot is-${s}`} title={CONNECTION_STATUS_LABEL[s]} aria-label={CONNECTION_STATUS_LABEL[s]} role="img" />;
}
function StatusChip({ s }: { s: ConnectionStatus }) {
  return <Chip tone={s === 'ok' ? 'success' : s === 'error' ? 'danger' : s === 'warn' ? 'warning' : undefined}>{CONNECTION_STATUS_LABEL[s]}</Chip>;
}
const COUNT_WORD: Record<ConnectionStatus, string> = { error: "can't reach", warn: 'to sign in', ok: 'ok', unknown: 'not checked' };
const HOW: Record<AppConnection['scheme'], string> = { bearer: 'Token', session: 'Session', none: 'No sign-in' };
const howOf = (c: AppConnection) => (c.scheme === 'none' ? HOW.none : c.hasToken ? `${HOW[c.scheme]} · token saved` : HOW[c.scheme]);
const summaryOf = (c: AppConnection): string => {
  if (c.state === 'signed-in') return c.who ? `Signed in as ${c.who}.` : 'Signed in.';
  if (c.state === 'unknown') return 'Not checked yet.';
  return c.detail || (c.state === 'signed-out' ? 'Signed out.' : '');
};
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'never');

/* ---------- one connection, opened ---------- */

function ConnectionBody({ c }: { c: AppConnection }) {
  const rt = useRuntime();
  const offers = connectionOffers(c);
  const b = backendOf(c.app);
  const [token, setToken] = useState('');
  const run = (spec: string) => rt.dispatch(spec);
  return (
    <div className="molly-conn-body" data-axf-help-id="molly-connections-row">
      <ul className="molly-conn-details">
        <li className="fx-small"><strong>API</strong> <span className="fx-mono">{c.apiBase}</span>{c.baseOverridden && <> <Chip tone="accent">changed</Chip></>}</li>
        <li className="fx-small"><strong>Signs in by</strong> {c.scheme === 'bearer' ? 'a token kept in this browser for Molly' : c.scheme === 'session' ? `the browser's ${c.label} session${b?.tokenKey ? ', or a token kept in this browser' : ''}` : 'nothing: it has no backend of its own'}</li>
        {c.state !== 'none' && <li className="fx-small"><strong>Checked</strong> {timeOf(c.checkedAt)}</li>}
      </ul>
      {c.state === 'unreachable' && (
        <Note tone="warning">A browser can't tell offline from a server that doesn't allow calls from Molly's address. Until {c.label}'s server allows Molly's address, open {c.label} in Molly (it signs in inside its own frame).</Note>
      )}
      {offers.token && (
        <form className="molly-conn-form" onSubmit={(e) => { e.preventDefault(); if (token.trim()) { void signInApp(rt, c.app, token.trim()); setToken(''); } }}>
          <TextField label={c.scheme === 'bearer' ? `${c.label} token` : `${c.label} API token (optional)`} type="password" mono value={token} onChange={setToken}
            placeholder={c.hasToken ? 'Saved; type to replace' : 'Paste the token'}
            hint="Kept in this browser for Molly only, never sent anywhere but this app's API." />
          {b?.userHeader && <UserField app={c.app} />}
          <div className="fx-row fx-row--wrap">
            <Button type="submit" tone="primary" icon="key" disabled={!token.trim()}>Save &amp; check</Button>
            {c.hasToken && <Button icon="trash" onClick={() => run(`molly.auth.sign-out:${c.app}`)}>Forget the token</Button>}
          </div>
        </form>
      )}
      <div className="fx-row fx-row--wrap">
        {offers.signInPage && <Button tone={offers.token ? 'neutral' : 'primary'} icon="external" onClick={() => run(`molly.auth.sign-in:${c.app}`)}>Sign in on {c.label}</Button>}
        {offers.signOut && !c.hasToken && <Button icon="logout" onClick={() => run(`molly.auth.sign-out:${c.app}`)}>Sign out</Button>}
        {offers.check && <Button icon="refresh" onClick={() => run(`molly.auth.check:${c.app}`)}>Check again</Button>}
        <Button icon="settings" onClick={() => run(`settings.open:${CONNECTIONS_TAB}`)}>API address</Button>
      </div>
    </div>
  );
}

function UserField({ app }: { app: string }) {
  const rt = useRuntime();
  const saved = useSetting(authSettingKeys(app).user);
  const [v, setV] = useState<string | null>(null);
  const value = v ?? saved;
  return (
    <div className="molly-conn-inline">
      <TextField label="Acts as user" mono value={value} onChange={setV} placeholder="username" hint="Sent with a token call (the app's API needs to know whose data it is)." />
      <Button icon="save" disabled={v === null || v.trim() === saved} onClick={() => { rt.dispatch(`molly.auth.user:${app}:${(v ?? '').trim() || 'default'}`); setV(null); }}>Save</Button>
    </div>
  );
}

/* ---------- the screen ---------- */

export function ConnectionsView() {
  const rt = useRuntime();
  const cs = useConnections();
  useFocus();
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus.app ? [focus.app] : []));
  const [seen, setSeen] = useState(focus.rev);
  if (seen !== focus.rev) { setSeen(focus.rev); if (focus.app) setOpen((o) => new Set([...o, focus.app])); }
  const { counts, issues, ordered } = connectionSummary(cs);
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // first look: ask every app once, quietly (Check all says it out loud)
  useEffect(() => { const seam = mollyCredentials(); if (seam.connections().some((c) => c.state === 'unknown')) void seam.checkAll(); }, []);
  const last = cs.map((c) => c.checkedAt).filter((x): x is string => !!x).sort().pop() ?? null;
  return (
    <div className="fx-stack fx-stack--lg molly-conn" data-axf-help-id="molly-connections">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">One sign-in</p>
          <h1>App connections</h1>
          <p className="fx-muted">How Molly reaches each app's backend for the screens it draws itself. Each app keeps its own sign-in; this is where you give Molly each one, once.</p>
        </div>
      </header>
      <div className="molly-conn-top">
        <div className="molly-conn-counts" role="status">
          {(['error', 'warn', 'ok', 'unknown'] as ConnectionStatus[]).map((k) => <span key={k} className="molly-conn-count"><ConnectionDot s={k} /> {counts[k]} {COUNT_WORD[k]}</span>)}
          <span className="fx-muted fx-small">checked {timeOf(last)}</span>
        </div>
        <div className="fx-row fx-row--wrap" role="toolbar" aria-label="App connections">
          <Button tone="primary" icon="refresh" onClick={() => rt.dispatch('molly.auth.check')}>Check all</Button>
          <Button icon="settings" onClick={() => rt.dispatch(`settings.open:${CONNECTIONS_TAB}`)}>Settings</Button>
        </div>
      </div>
      {issues === 0 && counts.unknown > 0 && <p className="fx-muted">Not checked yet: Check all asks each app who you are.</p>}
      <div className="fx-tablewrap">
        <table className="fx-table molly-conn-table">
          <thead><tr><th aria-label="Expand" /><th>Status</th><th>App</th><th className="molly-conn-hide-sm">Signs in by</th><th className="molly-conn-hide-sm">Summary</th></tr></thead>
          <tbody>
            {ordered.map((c) => {
              const s = connectionStatus(c);
              const isOpen = open.has(c.app);
              return (
                <Fragment key={c.app}>
                  <tr className={`molly-conn-row ${isOpen ? 'is-open' : ''}`} data-app={c.app} onClick={() => toggle(c.app)}>
                    <td><button type="button" className="fx-iconbtn" aria-expanded={isOpen} aria-label={`Details for ${c.label}`} onClick={(e) => { e.stopPropagation(); toggle(c.app); }}><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} /></button></td>
                    <td><StatusChip s={s} /></td>
                    <td><strong>{c.label}</strong><span className="molly-conn-show-sm fx-small fx-muted">{summaryOf(c)}</span></td>
                    <td className="molly-conn-hide-sm">{howOf(c)}</td>
                    <td className="molly-conn-hide-sm fx-small">{summaryOf(c)}</td>
                  </tr>
                  {isOpen && <tr className="molly-conn-exp"><td colSpan={5}><ConnectionBody c={c} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Settings → App connections ---------- */

function StatusPanel() {
  const rt = useRuntime();
  const cs = useConnections();
  return (
    <div className="fx-stack" data-axf-help-id="molly-connections-status">
      <ul className="molly-conn-list">
        {connectionSummary(cs).ordered.map((c) => (
          <li key={c.app}>
            <button type="button" data-fx-row className="molly-conn-item" onClick={() => rt.dispatch(`molly.auth.open:${c.app}`)}>
              <ConnectionDot s={connectionStatus(c)} /><span className="molly-conn-item__title">{c.label}</span><span className="molly-conn-item__sum">{summaryOf(c)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="refresh" onClick={() => rt.dispatch('molly.auth.check')}>Check all</Button>
        <Button icon="key" onClick={() => rt.dispatch('molly.auth.open')}>Sign in…</Button>
      </div>
    </div>
  );
}

function BaseRow({ c }: { c: AppConnection }) {
  const rt = useRuntime();
  const [v, setV] = useState<string | null>(null);
  const value = v ?? (c.baseOverridden ? c.apiBase : '');
  return (
    <div className="molly-conn-inline">
      <TextField label={`${c.label} API`} type="url" mono value={value} onChange={setV} placeholder={backendOf(c.app)?.apiBase ?? ''}
        hint={c.baseOverridden ? `In force: ${c.apiBase}` : 'Empty = the app\'s own address.'} />
      <Button icon="save" disabled={v === null || !v.trim()} onClick={() => { rt.dispatch(`molly.auth.base:${c.app}:${(v ?? '').trim()}`); setV(null); }}>Save</Button>
      <Button icon="undo" disabled={!c.baseOverridden} onClick={() => { rt.dispatch(`molly.auth.base:${c.app}:default`); setV(null); }}>Default</Button>
    </div>
  );
}

function BasesPanel() {
  const cs = useConnections().filter((c) => c.scheme !== 'none');
  return <div className="fx-stack" data-axf-help-id="molly-connections-bases">{cs.map((c) => <BaseRow key={c.app} c={c} />)}</div>;
}

/* ---------- Molly's own library for it (not a plugin: the seam is part of Molly) ---------- */

export const connectionsLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.molly.connections',
  label: 'App connections',
  version: '0.1.0',
  provides: [`view:${CONNECTIONS_VIEW}`, `settings-tab:${CONNECTIONS_TAB}`],
  builtWith: { model: 'opus', builtAt: '2026-11-10' },
  views: { [CONNECTIONS_VIEW]: { title: 'App connections', icon: 'key', render: () => <ConnectionsView /> } },
  settingsTabs: [{ id: CONNECTIONS_TAB, label: 'App connections', icon: 'key', order: 22, description: 'How Molly signs in to each app\'s backend: status, sign-in and API addresses.' }],
  settingsPanels: [
    { id: 'molly-connections.status', tab: CONNECTIONS_TAB, title: 'Status', icon: 'check-circle', order: 10, render: () => <StatusPanel /> },
    { id: 'molly-connections.bases', tab: CONNECTIONS_TAB, title: 'API addresses', icon: 'cloud', order: 20, render: () => <BasesPanel /> },
  ],
};
