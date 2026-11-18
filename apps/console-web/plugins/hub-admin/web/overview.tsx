/**
 * Hub → Hub (hub-console@1 screen `overview`, replaces axHub web's `#/hub`): whether the console holds a hub session and
 * as whom, how many calls wait, the relay state (how decisions reach the hub), one tap to each screen, and Apps (screen
 * `apps`): every app the framework's CI built, with a download each on the hub's own path.
 */
import { Button, Chip, Container, Note, useRuntime } from '@console/axf/react';
import { screensOf, type HubConsoleTable, type HubScreen } from '@console/axf/core/hub-console.mjs';
import { relTime, useHubRead, UNAVAILABLE_WORDS, when } from './data';
import { UnavailableNote } from './approvals';
import { useHubAction } from './controls';

export interface OverviewPage {
  signedIn: boolean; admin: boolean; user: { username?: string; name?: string; role?: string } | null; can: Record<string, boolean>;
  waiting: number | null; heldCount: number | null; hub: string; checkedAt: string; relay: { relay: boolean; via: string; reason: string }; note?: string;
}

export function OverviewScreen({ screen, table }: { screen: HubScreen; table: HubConsoleTable }) {
  const rt = useRuntime();
  const { data, stale, reload } = useHubRead<OverviewPage>('overview', {}, 30000);
  const g = data && data.ok ? data : null;
  const signIn = useHubAction('overview', 'sign-in');
  const signOut = useHubAction('overview', 'sign-out', undefined, () => void reload());
  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen={screen.id}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Connector hub</p>
          <h1>{g ? g.hub.replace(/^https:\/\//, '') : 'axHub'}</h1>
          <p className="fx-muted">The hub's pages, in the console. Reads go through the console's own hub session; every decision is your own tap, so nothing an AI client holds can approve its own call.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void reload()}>Check</Button>
          {g && (g.signedIn ? <Button icon="logout" disabled={signOut.busy} onClick={() => void signOut.run()}>Sign out</Button> : <Button tone="primary" icon="shield" disabled={signIn.busy} onClick={() => { if (g.hub) window.open(`${g.hub}/auth/login`, '_blank', 'noopener,noreferrer'); }}>Sign in</Button>)}
        </div>
      </header>
      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}
      <div className="fx-grid">
        <Container title="Session" icon="shield">
          <table className="fx-table"><tbody>
            <tr><th>Signed in</th><td>{!data ? <Chip>checking…</Chip> : !g ? <Chip tone="danger">hub unreachable</Chip> : g.signedIn && g.admin ? <Chip tone="success">yes, as an admin{g.user?.username ? ` (${g.user.username})` : ''}</Chip> : g.signedIn ? <Chip tone="warning">yes, without admin</Chip> : <Chip tone="warning">no</Chip>}</td></tr>
            <tr><th>Waiting</th><td>{g && g.waiting !== null ? `${g.waiting}${g.heldCount ? ` + ${g.heldCount} held` : ''}` : '—'}</td></tr>
            <tr><th>Deciding</th><td>{g ? (g.relay.relay ? <Chip tone="success">through {g.relay.via === 'owner' ? "the console's own hub sign-in" : 'this browser’s hub session'}</Chip> : <span className="fx-muted">{g.relay.reason}</span>) : '—'}</td></tr>
            <tr><th>Last check</th><td>{g ? `${when(g.checkedAt)} (${relTime(g.checkedAt)})` : '—'}</td></tr>
          </tbody></table>
          {g?.note && <Note tone="info">{g.note}</Note>}
        </Container>
        <Container title="The hub's screens" icon="layers">
          <div className="fx-stack">
            {screensOf(table).filter((s) => s.id !== 'overview').map((s) => (
              <div key={s.id} className="fx-row fx-row--wrap">
                <Button icon={s.icon} onClick={() => rt.dispatch(`hub.open:${s.id}`)}>{s.title}</Button>
                <span className="fx-muted">{s.gate === 'admin' ? 'admins' : s.gate === 'user' ? 'signed-in accounts' : 'everyone'}{s.replaces.length ? ` · was ${s.replaces[0]}` : ''}</span>
              </div>
            ))}
          </div>
        </Container>
      </div>
    </div>
  );
}

export interface AppsPage { status: string; apps: { project: string; name: string; platform?: string; latest?: AppBuild; earlier?: AppBuild[] }[]; updatedAt: string | null; error: string | null }
export interface AppBuild { url: string; version?: string; build?: number | null; size?: number; builtAt?: string; sha256?: string; file?: string }
const size = (n?: number) => (typeof n !== 'number' ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);

export function AppsScreen(_props: { screen: HubScreen }) {
  const { data, stale, reload } = useHubRead<AppsPage>('apps', {}, 300000);
  const g = data && data.ok ? data : null;
  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen="apps">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">From the hub's catalog</p>
          <h1>Apps</h1>
          <p className="fx-muted">Every app the framework's CI has built. Download one and open the file to install it.{g?.updatedAt ? ` Catalog updated ${relTime(g.updatedAt)}.` : ''}</p>
        </div>
        <div className="fx-row"><Button icon="refresh" onClick={() => void reload()}>Refresh</Button></div>
      </header>
      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}
      {g?.status === 'not-admin' && <Note tone="warning">{g.error ?? 'This hub account needs apps.download.'}</Note>}
      {!data && <p className="fx-muted">Reading the catalog…</p>}
      {g && g.status === 'ok' && g.apps.length === 0 && <Note>No apps yet. They appear here after the next successful build.</Note>}
      {g?.apps.map((a) => (
        <Container key={a.project} title={a.name} icon="package" actions={a.platform ? <Chip>{a.platform}</Chip> : undefined}>
          <div className="fx-stack">
            {a.latest && <BuildRow b={a.latest} latest />}
            {a.earlier && a.earlier.length > 0 && (
              <Container title={`${a.earlier.length} earlier build${a.earlier.length === 1 ? '' : 's'}`} icon="history" collapsible defaultOpen={false}>
                <div className="fx-stack">{a.earlier.map((b) => <BuildRow key={b.file ?? b.url} b={b} />)}</div>
              </Container>
            )}
          </div>
        </Container>
      ))}
    </div>
  );
}

function BuildRow({ b, latest }: { b: AppBuild; latest?: boolean }) {
  return (
    <div className="fx-row fx-row--wrap">
      <Button tone={latest ? 'primary' : 'ghost'} icon="download" onClick={() => window.open(b.url, '_blank', 'noopener,noreferrer')}>{latest ? 'Download' : `Build ${b.build ?? '—'}`}</Button>
      <span className="fx-muted">{b.version ?? ''}{b.build != null ? ` · build ${b.build}` : ''}{b.size ? ` · ${size(b.size)}` : ''}{b.builtAt ? ` · ${relTime(b.builtAt)}` : ''}</span>
      {b.sha256 && <span className="fx-mono fx-muted">{b.sha256.slice(0, 12)}</span>}
    </div>
  );
}
