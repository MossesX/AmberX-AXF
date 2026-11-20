/**
 * axHub — which hub the console belongs to, which session the hub's pages use here (this browser's own, or the
 * console's owner sign-in), and one tap to each of the hub's pages the console has (each comes with its own plugin;
 * one that isn't installed says so). Moved from apps/axhub-web/src/views/HubView.tsx (Nov 20 2026).
 */
import { Button, Chip, Container, Note, useRuntime } from '@console/axf/react';
import { hub, useHubSession } from '@console/hubPages/api';
import { openHubSignIn } from '@console/hubPages/page';
import { go } from '@console/hubPages/route';

const LINKS: { label: string; page: string; icon: string; note: string }[] = [
  { label: 'Approvals', page: 'home', icon: 'shield', note: 'Decide what is waiting' },
  { label: 'Approvals log', page: 'approvals-log', icon: 'list', note: 'Every request and how it ended' },
  { label: 'Go pass', page: 'go-pass', icon: 'check', note: 'One pass for a whole session' },
  { label: 'Passes', page: 'passes', icon: 'clock', note: 'Timed veto passes' },
  { label: 'Apps', page: 'apps', icon: 'download', note: 'The app catalog' },
  { label: 'Users', page: 'users', icon: 'user', note: 'Accounts and permissions (admins)' },
  { label: 'Handoff', page: 'handoff', icon: 'package', note: 'Claude handoff results (admins)' },
  { label: 'Your account', page: 'account', icon: 'key', note: 'Password and signed-in browsers' },
];

export function HubView() {
  const rt = useRuntime();
  const s = useHubSession();
  const session = s.phase === 'ready' ? s.session : null;

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Connector hub</p>
          <h1>{hub().replace(/^https:\/\//, '')}</h1>
          <p className="fx-muted">
            The hub's own pages, inside the console. They go through the console's relay with a hub session, never with
            the console token, so nothing an AI client holds can approve its own call.
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={s.refresh}>Check</Button>
          {!session?.signedIn && <Button tone="primary" icon="shield" onClick={openHubSignIn}>Sign in on axHub</Button>}
        </div>
      </header>

      <div className="fx-grid">
        <Container title="Session" icon="shield">
          <table className="fx-table">
            <tbody>
              <tr>
                <th>Signed in</th>
                <td>
                  {s.phase === 'loading' ? <Chip>checking…</Chip>
                    : s.phase === 'error' ? <Chip tone="danger">hub unreachable</Chip>
                    : !session?.signedIn ? <Chip tone="warning">no</Chip>
                    : session.admin ? <Chip tone="success">yes, as an admin</Chip>
                    : <Chip tone="warning">yes, without admin</Chip>}
                </td>
              </tr>
              <tr><th>As</th><td>{session?.user ? `@${session.user.username}` : '—'}</td></tr>
              <tr>
                <th>Through</th>
                <td>{session?.via === 'browser' ? "this browser's own hub session" : session?.via === 'owner' ? "the console's owner sign-in" : '—'}</td>
              </tr>
            </tbody>
          </table>
          {s.phase === 'error' && <Note tone="danger" icon="alert">{s.error}</Note>}
          {session && !session.signedIn && session.reason && <Note tone="warning" icon="alert">{session.reason}</Note>}
          {session?.via === 'owner' && <Note tone="info" icon="info">The hub records what you do here as @{session.user?.username ?? 'the owner account'}.</Note>}
        </Container>

        <Container title="The hub's pages" icon="shield">
          <div className="fx-stack">
            {LINKS.map((l) => (
              <div key={l.page} className="fx-row fx-row--wrap">
                <Button icon={l.icon} onClick={() => go(rt, l.page)}>{l.label}</Button>
                <span className="fx-muted">{l.note}</span>
              </div>
            ))}
          </div>
        </Container>
      </div>
    </div>
  );
}
