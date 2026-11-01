/**
 * Approvals — what axHub is waiting on, with a one-tap way to each request.
 *
 * Rows are lib-approvals' expandable rows (Nov 1 2026). Deciding goes through the phone's own path (the approvals plugin's
 * `setApprovalsHost` decide: the signed-in hub web view, native Deny), else the hub's page, so an approval is still
 * granted under the hub's Origin and CSRF checks, never by something holding an API token. The notes are lib-hub's.
 *
 * Design language (enterprise-branding s33): page head = eyebrow · title · one sentence, actions right; skeleton
 * cards while the first read runs (never a spinner for a list); the page can pop out into a floating window.
 *
 * Walkthrough (Nov 1 2026): the last card on Home opens the narrated walkthrough when the Walkthrough plugin is installed
 * (its `walkthrough.open` action); without it the card isn't shown.
 */
import { Button, Chip, Container, useRuntime } from '../axf/react';
import { HubStatusNote } from '../axf/libs/hub/react';
import { ApprovalsList } from '../axf/libs/approvals/react';
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
          <p className="fx-muted">Every call that changes something waits here. Tap one for who asked, the exact command and its timeline; Deny or Approve right on it.</p>
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
        // The shared expandable rows (lib-approvals, Nov 1 2026): who asked, the reason, Deny / Approve; tap or the caret for the details.
        <ApprovalsList hub={HUB} scope="amberx" empty={<p className="fx-muted">No call is waiting. Anything that writes, deletes or runs a command shows up here within a few seconds.</p>} />
      )}
      {rt.actions.get('walkthrough.open') && (
        <Container title="Walkthrough" icon="play" className="amberx-approvals__walkthrough">
          <p className="fx-muted">New here, or forgot where something lives? Amber walks you through every part of AmberX, in chapters you can skip.</p>
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="play" onClick={() => rt.dispatch('walkthrough.open')}>Watch the walkthrough</Button>
          </div>
        </Container>
      )}
    </div>
  );
}
