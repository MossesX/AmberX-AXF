/**
 * Hub — where this app is pointed, whether the browser is signed in, and one tap to each of the hub's pages (they
 * are this app's pages since axHub decision #96). Also says plainly where the look comes from, since this is a developer app: the shared
 * appearance document on the hub's data server, the same one the Dev Console, Build Pilot and
 * Patches follow.
 */
import { Button, Chip, Container, Note, useRuntime } from '../axf/react';
import { formatWhen } from '../axf/libs/hub';
import { signInUrl } from '../hub/core';
import { go } from '../hub/route';
import { HUB, useApprovals } from '../hub/useHub';

const LINKS: { label: string; view: string; icon: string; note: string }[] = [
  { label: 'Approvals', view: 'home', icon: 'shield', note: 'Decide what is waiting' },
  { label: 'Approvals log', view: 'approvals-log', icon: 'list', note: 'Every request and how it ended' },
  { label: 'Apps', view: 'apps', icon: 'download', note: 'The app catalog' },
  { label: 'Users', view: 'users', icon: 'user', note: 'Accounts and permissions (admins)' },
  { label: 'Handoff', view: 'handoff', icon: 'package', note: 'Claude handoff results (admins)' },
  { label: 'Your account', view: 'account', icon: 'key', note: 'Password and signed-in browsers' },
];

export function HubView() {
  const rt = useRuntime();
  const { state, refresh } = useApprovals();
  const signedIn = state.status === 'ok' || state.status === 'not-admin';

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Connector hub</p>
          <h1>{HUB.replace(/^https:\/\//, '')}</h1>
          <p className="fx-muted">
            These are the hub's own pages, on the hub's address, with your browser's hub session. They hold no token:
            approving needs your signed-in admin session, so nothing an AI client holds can approve its own call.
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={refresh}>Check</Button>
          {signedIn ? (
            <Button icon="logout" onClick={() => rt.dispatch('axhub.signout')}>Sign out</Button>
          ) : (
            <Button tone="primary" icon="shield" onClick={() => { location.href = signInUrl(HUB, location.href); }}>Sign in</Button>
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

        <Container title="The hub's pages" icon="shield">
          <div className="fx-stack">
            {LINKS.map((l) => (
              <div key={l.view} className="fx-row fx-row--wrap">
                <Button icon={l.icon} onClick={() => go(rt, l.view)}>{l.label}</Button>
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

      </div>
    </div>
  );
}
