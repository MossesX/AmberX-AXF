/**
 * Approvals — what axHub is waiting on, with a one-tap way to each request.
 *
 * Deciding happens on the hub's own page: this app only shows what's waiting and opens the request.
 * That keeps axHub's rule intact — an approval is granted on the hub, under its Origin and CSRF
 * checks, and never by something holding an API token. The cards and notes are lib-hub's.
 *
 * Design language (enterprise-branding s33): page head = eyebrow · title · one sentence, actions right; skeleton
 * cards while the first read runs (never a spinner for a list); the page can pop out into a floating window.
 */
import { Button, Chip, useRuntime } from '../axf/react';
import { HubApprovalList, HubStatusNote } from '../axf/libs/hub/react';
import { HUB, useApprovals } from '../hub/useHub';

export function Approvals() {
  const rt = useRuntime();
  const { state, refresh } = useApprovals();
  const checked = state.phase === 'checked';
  const ok = checked && state.status === 'ok';

  return (
    <div className="fx-stack fx-stack--lg amberx-approvals">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Work · axHub {HUB.replace(/^https:\/\//, '')}</p>
          <h1>{ok ? (state.count === 0 ? 'Nothing waiting' : `${state.count} waiting`) : 'Approvals'}</h1>
          <p className="fx-muted">Every call that changes something waits here; Review opens it on the hub, where you approve or reject it.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          {ok && state.count > 0 && <Chip tone="warning">{state.count} to review</Chip>}
          <Button icon="refresh" onClick={refresh}>Check now</Button>
          <Button icon="external" onClick={() => window.open(state.approvalsUrl, '_blank', 'noopener,noreferrer')}>Hub page</Button>
          <Button tone="quiet" icon="maximize" title="Open this page in a floating window" onClick={() => rt.dispatch('amberx.window:home')}>Window</Button>
        </div>
      </header>
      <HubStatusNote hub={HUB} state={state} />
      {!checked ? (
        <div className="amberx-approvals__skeleton" aria-busy="true" aria-label="Reading the hub">
          {[0, 1, 2].map((i) => <span key={i} className="amberx-approvals__skel" />)}
        </div>
      ) : (
        <HubApprovalList state={state} />
      )}
    </div>
  );
}
