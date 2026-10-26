/**
 * Approvals — every request axHub has asked about (decision #95 grid, moved here from the hub's own page by #96):
 * pending first, then postponed, newest first; a filter per status, pages of 20, the auto-approve window
 * (decision #94) and the log.
 *
 * Deciding happens here now, through the hub's `/auth/api/approvals/<id>` with this browser's admin session, the
 * hub's Origin and the session's CSRF value, the revision this page showed (a request that changed meanwhile is
 * refused) — never with a token, so an AI client can't approve its own call. Approve sits on a row only when the row
 * shows the complete call; a longer one opens its page first.
 */
import { useState } from 'react';
import { Button, Chip, Container, Note, useRuntime } from '../axf/react';
import { checkHubNow } from '../axf/libs/hub/react';
import { hubPost } from '../hub/api';
import { relTime } from '../hub/core';
import { go, useRouteParams } from '../hub/route';
import { ACTION_LABELS, STATUS_TONE, type ActionReply, type ApprovalAction, type ApprovalGrid, type ApprovalItem, type AutoState } from '../hub/types';
import { HUB } from '../hub/useHub';
import { HubGate, TapTwice, useHubJson } from './hubPage';

export function Approvals() {
  return (
    <HubGate admin what="approvals">
      {() => <ApprovalsGrid />}
    </HubGate>
  );
}

function ApprovalsGrid() {
  const rt = useRuntime();
  const params = useRouteParams('home');
  const status = params.status ?? 'all';
  const [page, setPage] = useState(1);
  const path = `/auth/api/approvals?status=${encodeURIComponent(status)}&page=${page}`;
  const grid = useHubJson<ApprovalGrid>(path, 10_000);
  const g = grid.data;

  const after = async () => { await grid.reload(); checkHubNow(); };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub · {HUB.replace(/^https:\/\//, '')}</p>
          <h1>{g ? (g.waiting === 0 ? 'Nothing waiting' : `${g.waiting} waiting`) : 'Approvals'}</h1>
          <p className="fx-muted">
            Every call that changes something waits here for you. Approve or decline it here; a long call opens its own
            page so you see all of it first.
            {g && g.postponed > 0 ? ` ${g.postponed} postponed.` : ''}
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void after()}>Check now</Button>
          {g?.log && <Button icon="list" onClick={() => go(rt, 'approvals-log')}>Log</Button>}
        </div>
      </header>

      {grid.error && <Note tone="danger" icon="alert">{grid.error}</Note>}
      {g && g.auto.available && <AutoApprove auto={g.auto} onChange={() => void after()} />}

      {g && (
        <div className="fx-row fx-row--wrap" role="group" aria-label="Show">
          {g.filters.map((f) => (
            <button key={f.id} type="button" className={`fx-chip${f.id === g.filter ? ' is-on' : ''}`} aria-pressed={f.id === g.filter}
              onClick={() => { setPage(1); go(rt, 'home', f.id === 'all' ? {} : { status: f.id }); }}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {!g && !grid.error && <p className="fx-muted">Reading the hub…</p>}
      {g && g.items.length === 0 && <Note tone="success" icon="check">{g.filter === 'all' ? 'No requests yet.' : 'None with this status.'}</Note>}
      {g && g.items.map((item) => <ApprovalRow key={item.id} item={item} onDone={() => void after()} />)}

      {g && g.pages > 1 && (
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="chevron-left" disabled={g.page <= 1} onClick={() => setPage(g.page - 1)}>Newer</Button>
          <span className="fx-muted">Page {g.page} of {g.pages} · {g.total} requests</span>
          <Button size="sm" icon="chevron-right" disabled={g.page >= g.pages} onClick={() => setPage(g.page + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
}

/** The 5 / 10 / 30 minute window that approves everything (decision #94). Deny policies still deny; Stop any time. */
function AutoApprove({ auto, onChange }: { auto: AutoState; onChange: () => void }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const send = async (path: string, body: unknown) => {
    setBusy(true);
    try { const r = await hubPost<{ message: string }>(path, body); rt.toast(r.message || 'Done.', 'success'); onChange(); }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); }
    finally { setBusy(false); }
  };
  const w = auto.window;
  return (
    <Container title="Approve everything automatically" icon="clock">
      {w ? (
        <div className="fx-stack">
          <Note tone="warning" icon="alert">
            Approving every request until {new Date(w.until).toLocaleTimeString()} ({relTime(w.until)}), started by {w.by}.
            {' '}{w.approvedCount} approved so far.
          </Note>
          <div className="fx-row"><Button tone="danger" icon="x" disabled={busy} onClick={() => void send('/auth/api/approvals/auto/stop', {})}>Stop now</Button></div>
        </div>
      ) : (
        <div className="fx-stack">
          <p className="fx-muted">For a few minutes, every call that asks is approved by itself, what's waiting now too. Services set to deny stay denied. Tap twice.</p>
          <div className="fx-row fx-row--wrap">
            {auto.minutes.map((m) => (
              <TapTwice key={m} label={`${m} min`} again={`Approve all for ${m} min`} icon="clock" disabled={busy} onConfirm={() => void send('/auth/api/approvals/auto', { minutes: m })} />
            ))}
          </div>
        </div>
      )}
    </Container>
  );
}

/** Sends one action with the revision the page showed. */
export async function act(item: ApprovalItem, action: ApprovalAction, extra: Record<string, unknown> = {}): Promise<ActionReply> {
  return hubPost<ActionReply>(`/auth/api/approvals/${item.id}`, { action, rev: item.revision, ...extra });
}

/** One request, collapsed: tool, status, the call (whole or cut), times, and its buttons. */
export function ApprovalRow({ item, onDone }: { item: ApprovalItem; onDone: () => void }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const run = async (a: ApprovalAction) => {
    if (a === 'postpone') { go(rt, 'approval', { id: item.id, postpone: '1' }); return; }
    setBusy(true);
    try { const r = await act(item, a); rt.toast(r.message || 'Done.', a === 'approve' ? 'success' : 'info'); onDone(); }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); onDone(); }
    finally { setBusy(false); }
  };
  const quick = item.actions.filter((a) => (a === 'approve' ? item.whole : true));
  return (
    <Container
      title={item.tool}
      icon={item.status === 'pending' ? 'shield' : item.status === 'postponed' ? 'clock' : 'check'}
      actions={<Chip tone={STATUS_TONE[item.status]}>{item.statusLabel}</Chip>}
    >
      <div className="fx-stack">
        <p className="fx-mono">{item.whole ? item.summary : `${item.summary.slice(0, 160)}…`}</p>
        <p className="fx-muted">
          Asked {relTime(item.createdAt)} by {item.callerId}
          {item.showExpires ? ` · expires ${relTime(item.expiresAt)}` : ''}
          {item.decidedBy ? ` · by ${item.decidedBy}` : ''}
        </p>
        {item.postponed && (
          <p className="fx-muted">Waiting for {item.postponed.waitingFor}{item.postponed.lastNote ? ` · ${item.postponed.lastNote}` : ''}</p>
        )}
        {item.reviewRequired && <Note tone="warning" icon="alert">Postponed for over 2 hours: look at it again.</Note>}
        <div className="fx-row fx-row--wrap">
          {quick.map((a) => (
            <Button key={a} size="sm" disabled={busy} tone={a === 'approve' ? 'success' : a === 'decline' || a === 'revoke' ? 'danger' : 'neutral'} onClick={() => void run(a)}>
              {ACTION_LABELS[a]}
            </Button>
          ))}
          <Button size="sm" tone="ghost" icon="chevron-right" onClick={() => go(rt, 'approval', { id: item.id })}>
            {item.actions.includes('approve') && !item.whole ? 'Review the whole call' : 'Details'}
          </Button>
        </div>
      </div>
    </Container>
  );
}

