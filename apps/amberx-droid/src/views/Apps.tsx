/**
 * Apps — every app built with the framework, straight from the hub's catalog, with a download link
 * each. The links are plain navigations to the hub's own download path, so the browser sends the hub
 * session and the hub decides (admins, or an account granted `apps.download`).
 */
import { useState } from 'react';
import { Button, Chip, Container, Note } from '../axf/react';
import { appsUrl, loginUrl } from '../axf/libs/hub';
import { HUB, useApps } from '../hub/useHub';
import { formatSize, formatWhen, shortSha, statusNote, type AppBuild } from '../axf/libs/hub';

function BuildRow({ b, latest }: { b: AppBuild; latest?: boolean }) {
  return (
    <div className="fx-row fx-row--wrap">
      <Button tone={latest ? 'primary' : 'ghost'} icon="download" onClick={() => window.open(b.url, '_blank', 'noopener,noreferrer')}>
        {latest ? 'Download' : `Build ${b.build ?? '—'}`}
      </Button>
      <span className="fx-muted">
        {b.version}
        {b.build !== null ? ` · build ${b.build}` : ''} · {formatSize(b.size)} · {formatWhen(b.builtAt)}
      </span>
      {shortSha(b.sha256) && <span className="fx-mono fx-muted">{shortSha(b.sha256)}</span>}
    </div>
  );
}

export function Apps() {
  const { feed, loading, refresh } = useApps();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">From the hub's catalog</p>
          <h1>Apps</h1>
          <p className="fx-muted">
            Every app the framework's CI has built. Download one and open the file to install it.
            {feed?.updatedAt ? ` Catalog updated ${formatWhen(feed.updatedAt)}.` : ''}
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={refresh}>Refresh</Button>
          <Button icon="external" onClick={() => window.open(appsUrl(HUB), '_blank', 'noopener,noreferrer')}>Hub page</Button>
        </div>
      </header>

      {loading && !feed && <Container title="Reading the catalog" icon="clock"><p className="fx-muted">One moment.</p></Container>}

      {feed && feed.status === 'signed-out' && (
        <Note tone="warning" icon="shield">
          {statusNote('signed-out', '')} <a href={loginUrl(HUB)} target="_blank" rel="noopener noreferrer">Sign in to axHub</a>
        </Note>
      )}
      {feed && feed.status === 'not-admin' && <Note tone="warning" icon="shield">This hub account needs <span className="fx-mono">apps.download</span>.</Note>}
      {feed && feed.status === 'unreachable' && (
        <Note tone="danger" icon="alert">
          {statusNote('unreachable', feed.error)} The hub only shares its catalog with sites on its own domain; its own{' '}
          <a href={appsUrl(HUB)} target="_blank" rel="noopener noreferrer">Apps page</a> always works.
        </Note>
      )}

      {feed?.status === 'ok' && feed.apps.length === 0 && (
        <Container title="No apps yet" icon="package">
          <p className="fx-muted">They appear here after the next successful build.</p>
        </Container>
      )}

      {feed?.apps.map((a) => (
        <Container
          key={a.project}
          title={a.name}
          icon="package"
          actions={<Chip>{a.platform}</Chip>}
        >
          <div className="fx-stack">
            <BuildRow b={a.latest} latest />
            {a.earlier.length > 0 && (
              <>
                <Button icon={open === a.project ? 'minus' : 'plus'} onClick={() => setOpen(open === a.project ? null : a.project)}>
                  {a.earlier.length} earlier {a.earlier.length === 1 ? 'build' : 'builds'}
                </Button>
                {open === a.project && a.earlier.map((b) => <BuildRow key={b.file} b={b} />)}
              </>
            )}
          </div>
        </Container>
      ))}
    </div>
  );
}
