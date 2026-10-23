/**
 * Approvals — what axHub is waiting on, with a one-tap way to each request.
 *
 * Deciding happens on the hub's own page: this app only shows what's waiting and opens the request.
 * That keeps axHub's rule intact — an approval is granted on the hub, under its Origin and CSRF
 * checks, and never by something holding an API token. The cards and notes are lib-hub's.
 */
import { Button } from '../axf/react';
import { HubApprovalList, HubStatusNote } from '../axf/libs/hub/react';
import { HUB, useApprovals } from '../hub/useHub';

export function Approvals() {
  const { state, refresh } = useApprovals();
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
      <HubStatusNote hub={HUB} state={state} />
      <HubApprovalList state={state} />
    </div>
  );
}
