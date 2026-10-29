/**
 * Held commands (veto@1, Brett Oct 28 2026): a command Claude sends through Vinnie is held by the hub for a countdown
 * (3 minutes) and then run by the hub itself. There is no Approve: the only decision is **Deny**, which stops it before
 * time is up. Shown on the first screen of the approval page and on its grid row, in place of the usual buttons.
 *
 * The countdown runs on this browser's clock from the `veto.secondsLeft` the hub sent (read time kept), so a clock that is
 * off still counts right; the page re-reads the hub every few seconds. Deny is `POST /auth/api/approvals/<id>/deny` with
 * this browser's admin session, the hub's Origin and the session's CSRF value (hubPost), never a token.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, useRuntime } from '../axf/react';
import { checkHubNow } from '../axf/libs/hub/react';
import { formatCountdown, secondsLeftNow, VETO_WARNING_SECONDS } from '../axf/libs/hub/veto';
import { hubPost } from '../hub/api';
import type { ApprovalItem } from '../hub/types';

export const isHeld = (item: Pick<ApprovalItem, 'status' | 'veto'>): boolean => item.status === 'held' && !!item.veto;

/** Seconds left now, ticking every second while held. */
export function useCountdown(item: Pick<ApprovalItem, 'status' | 'veto'>): number {
  const left0 = item.veto?.secondsLeft ?? 0;
  const [readAt, setReadAt] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => setReadAt(Date.now()), [left0]);
  const on = isHeld(item);
  useEffect(() => { if (!on) return; const t = setInterval(() => tick((n) => n + 1), 1_000); return () => clearInterval(t); }, [on]);
  return on ? secondsLeftNow({ secondsLeft: left0, readAt }) : 0;
}

export async function denyHeld(id: string): Promise<{ message?: string; item?: ApprovalItem }> {
  return hubPost<{ message?: string; item?: ApprovalItem }>(`/auth/api/approvals/${id}/deny`, {});
}

/** Countdown + Deny. `big` on the request's own page. */
export function HeldBar({ item, onDone, big }: { item: ApprovalItem; onDone: (next?: ApprovalItem) => void; big?: boolean }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const left = useCountdown(item);
  const urgent = left <= VETO_WARNING_SECONDS;
  const deny = async () => {
    setBusy(true);
    try { const r = await denyHeld(item.id); rt.toast(r.message || 'Denied: it will not run.', 'success'); onDone(r.item); checkHubNow(); }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); onDone(); }
    finally { setBusy(false); }
  };
  return (
    <div className={`axp-axhub-held${big ? ' axp-axhub-held--big' : ''}`} data-axf-anchor="held-actions">
      <span className={`axp-axhub-held__count${urgent ? ' is-urgent' : ''}`} role="timer" aria-label={left > 0 ? `Runs in ${left} seconds` : 'Running'}>
        {left > 0 ? formatCountdown(left) : '0:00'}
      </span>
      {big && <span className="axp-axhub-held__what">{left > 0 ? 'Runs when the countdown ends' : 'Time is up: the hub is running it'}</span>}
      {left > 0 && <Button tone="danger" icon="x-circle" size={big ? 'md' : 'sm'} busy={busy} disabled={busy} onClick={() => void deny()}>Deny</Button>}
    </div>
  );
}

/** The status chip for a held row: the countdown itself. */
export function HeldChip({ item }: { item: ApprovalItem }) {
  const left = useCountdown(item);
  return <Chip tone={left <= VETO_WARNING_SECONDS ? 'danger' : 'warning'}>{left > 0 ? `Runs in ${formatCountdown(left)}` : 'Running'}</Chip>;
}
