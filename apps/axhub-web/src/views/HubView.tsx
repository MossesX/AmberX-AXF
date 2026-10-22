/**
 * Hub — where this app is pointed, whether the browser is signed in, and one-tap links to the hub's
 * own pages. Also says plainly where the look comes from, since this is a developer app: the shared
 * appearance document on the hub's data server, the same one the Dev Console, Build Pilot and
 * Patches follow.
 */
import { Button, Chip, Container, Note } from '../axf/react';
import { accountUrl, appsUrl, approvalsUrl, loginUrl, logoutUrl } from '../axf/libs/hub';
import { HUB, useApprovals } from '../hub/useHub';
import { formatWhen } from '../hub/feed';

const LINKS: { label: string; path: string; icon: string; note: string }[] = [
  { label: 'Approvals', path: '/auth/admin/approvals', icon: 'shield', note: 'Decide what is waiting' },
  { label: 'Apps', path: '/apps', icon: 'download', note: 'The catalog, on the hub' },
  { label: 'Users', path: '/auth/admin/users', icon: 'user', note: 'Accounts and permissions (admins)' },
  { label: 'Your account', path: '/auth/account', icon: 'key', note: 'Password and signed-in browsers' },
];

export function HubView() {
  const { state, refresh } = useApprovals();
  const signedIn = state.status === 'ok' || state.status === 'not-admin';

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Connector hub</p>
          <h1>{HUB.replace(/^https:\/\//, '')}</h1>
          <p className="fx-muted">
            This app reads the hub with your browser's own hub session. It holds no token, and nothing here can approve a
            call — that happens on the hub's own pages.
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={refresh}>Check</Button>
          {signedIn ? (
            <Button icon="logout" onClick={() => window.open(logoutUrl(HUB), '_blank', 'noopener,noreferrer')}>Sign out</Button>
          ) : (
            <Button tone="primary" icon="shield" onClick={() => window.open(loginUrl(HUB), '_blank', 'noopener,noreferrer')}>Sign in</Button>
          )}
        </div>
      </header>

      <div className="fx-grid">
        <Container title="Session" icon="shield">
          <table className="fx-table">
            <tbody>
              <tr>
                <th>Signed in</th>
                <td>
                  {state.phase === 'idle' ? (
                    <Chip>checking…</Chip>
                  ) : state.status === 'ok' ? (
                    <Chip tone="success">yes, as an admin</Chip>
                  ) : state.status === 'not-admin' ? (
                    <Chip tone="warning">yes, without admin</Chip>
                  ) : state.status === 'signed-out' ? (
                    <Chip tone="warning">no</Chip>
                  ) : (
                    <Chip tone="danger">hub unreachable</Chip>
                  )}
                </td>
              </tr>
              <tr><th>Waiting</th><td>{state.status === 'ok' ? state.count : '—'}</td></tr>
              <tr><th>Last check</th><td>{formatWhen(state.checkedAt)}</td></tr>
            </tbody>
          </table>
          {state.status === 'unreachable' && state.error && <Note tone="danger" icon="alert">{state.error}</Note>}
        </Container>

        <Container title="On the hub" icon="external">
          <div className="fx-stack">
            {LINKS.map((l) => (
              <div key={l.path} className="fx-row fx-row--wrap">
                <Button icon={l.icon} onClick={() => window.open(`${HUB}${l.path}`, '_blank', 'noopener,noreferrer')}>{l.label}</Button>
                <span className="fx-muted">{l.note}</span>
              </div>
            ))}
          </div>
        </Container>

        <Container title="Where the look comes from" icon="palette">
          <p className="fx-muted">
            Themes, spacing and hidden chrome are read from <span className="fx-mono">shared/settings/appearance.json</span>{' '}
            on the hub's data server and followed live. Change them in Settings → Appearance and every developer app — this
            one, the Dev Console, Build Pilot, Patches — follows.
          </p>
          <div className="fx-row fx-row--wrap">
            <Button icon="settings" onClick={() => window.location.hash = ''}>Settings → Appearance</Button>
            <span className="fx-muted">The hub keeps every version, so a look can be rolled back.</span>
          </div>
        </Container>

        <Container title="Quick links" icon="list">
          <div className="fx-row fx-row--wrap">
            <a href={approvalsUrl(HUB)} target="_blank" rel="noopener noreferrer">Approvals</a>
            <a href={appsUrl(HUB)} target="_blank" rel="noopener noreferrer">Apps</a>
            <a href={accountUrl(HUB)} target="_blank" rel="noopener noreferrer">Account</a>
            <a href={HUB} target="_blank" rel="noopener noreferrer">Hub home</a>
          </div>
        </Container>
      </div>
    </div>
  );
}
