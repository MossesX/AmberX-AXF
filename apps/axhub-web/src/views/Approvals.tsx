/**
 * Approvals — what axHub is waiting on, with a one-tap way to each request.
 *
 * Deciding happens on the hub's own page: this app only shows what's waiting and opens the request.
 * That keeps axHub's rule intact — an approval is granted on the hub, under its Origin and CSRF
 * checks, and never by something holding an API token.
 */
import { Button, Chip, Container, Icon, Note } from '../axf/react';
import { accountUrl, loginUrl } from '../axf/libs/hub';
import { HUB, useApprovals } from '../hub/useHub';
import { expiry, formatWhen, statusNote } from '../hub/feed';

export function Approvals() {
  const { state, refresh } = useApprovals();
  const waiting = state.pending;
  const checked = state.phase === 'checked';

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub · {HUB.replace(/^https:\/\//, '')}</p>
          <h1>{checked && state.status === 'ok' ? (state.count === 0 ? 'Nothing waiting' : `${state.count} waiting`) : 'Approvals'}</h1>
          <p className="fx-muted">
            Every call that changes something waits here for you. Review opens the request on the hub, where you approve
            or reject it.
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={refresh}>Check now</Button>
          <Button icon="external" onClick={() => window.open(state.approvalsUrl, '_blank', 'noopener,noreferrer')}>
            Hub page
          </Button>
        </div>
      </header>

      {state.status === 'signed-out' && (
        <Note tone="warning" icon="shield">
          {statusNote('signed-out', '')}{' '}
          <a href={loginUrl(HUB)} target="_blank" rel="noopener noreferrer">Sign in to axHub</a>
        </Note>
      )}
      {state.status === 'not-admin' && (
        <Note tone="warning" icon="shield">
          {statusNote('not-admin', '')}{' '}
          <a href={accountUrl(HUB)} target="_blank" rel="noopener noreferrer">Your hub account</a>
        </Note>
      )}
      {state.status === 'unreachable' && checked && <Note tone="danger" icon="alert">{statusNote('unreachable', state.error)}</Note>}

      {state.status === 'ok' && waiting.length === 0 && (
        <Container title="All clear" icon="check">
          <p className="fx-muted">
            No call is waiting. Reads run on their own; anything that writes, deletes or runs a command shows up here
            within a few seconds.
          </p>
        </Container>
      )}

      {waiting.map((a) => {
        const left = expiry(a);
        return (
          <Container key={a.id} title={a.tool} icon="shield">
            <div className="fx-stack">
              {a.summary && <p className="fx-mono">{a.summary}</p>}
              <div className="fx-row fx-row--wrap fx-muted">
                <span><Icon name="clock" /> asked {formatWhen(a.createdAt)}</span>
                <Chip tone={left.expired ? 'danger' : left.soon ? 'warning' : undefined}>{left.text}</Chip>
              </div>
              <div className="fx-row">
                <Button tone="primary" icon="external" disabled={left.expired} onClick={() => window.open(a.url, '_blank', 'noopener,noreferrer')}>
                  Review on the hub
                </Button>
              </div>
            </div>
          </Container>
        );
      })}

      {checked && state.status === 'ok' && state.count > waiting.length && (
        <Note tone="info" icon="list">
          {state.count - waiting.length} more are waiting than this list shows.{' '}
          <a href={state.approvalsUrl} target="_blank" rel="noopener noreferrer">See them all on the hub</a>
        </Note>
      )}
    </div>
  );
}
