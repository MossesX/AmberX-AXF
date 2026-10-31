/**
 * Held commands (veto@1, Brett Oct 28 2026): a command Claude sends through Vinnie is held by the hub for a countdown
 * (90 s since axHub decision 104) and then run by the hub itself. **Deny** stops it before time is up; **Approve** runs it
 * right away (no more notices); **Shelve** pauses the countdown until he approves or denies it (decision 104). Shown on
 * the first screen of the approval page and on its grid row, in place of the usual buttons.
 *
 * The countdown runs on this browser's clock from the `veto.secondsLeft` the hub sent (read time kept), so a clock that is
 * off still counts right; the page re-reads the hub every few seconds. Each action is `POST /auth/api/approvals/<id>/<deny|
 * approve-now|shelve>` with this browser's admin session, the hub's Origin and the session's CSRF value (hubPost), never a
 * token.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, useRuntime } from '../axf/react';
import { checkHubNow } from '../axf/libs/hub/react';
import { actionsOf, formatCountdown, secondsLeftNow, VETO_ACTION_LABELS, VETO_WARNING_SECONDS, type VetoAction } from '../axf/libs/hub/veto';
import { hubPost } from '../hub/api';
import type { ApprovalItem } from '../hub/types';

export const isHeld = (item: Pick<ApprovalItem, 'status' | 'veto'>): boolean => item.status === 'held' && !!item.veto;
export const isShelved = (item: Pick<ApprovalItem, 'status' | 'veto'>): boolean => isHeld(item) && item.veto?.state === 'shelved';

/** Seconds left now, ticking every second while held. */
export function useCountdown(item: Pick<ApprovalItem, 'status' | 'veto'>): number {
  const left0 = item.veto?.secondsLeft ?? 0;
  const [readAt, setReadAt] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => setReadAt(Date.now()), [left0]);
  const on = isHeld(item);
  const shelved = isShelved(item);
  useEffect(() => { if (!on || shelved) return; const t = setInterval(() => tick((n) => n + 1), 1_000); return () => clearInterval(t); }, [on, shelved]);
  return on ? secondsLeftNow({ secondsLeft: left0, readAt, shelved }) : 0;
}

export async function actHeld(id: string, action: VetoAction): Promise<{ message?: string; item?: ApprovalItem }> {
  return hubPost<{ message?: string; item?: ApprovalItem }>(`/auth/api/approvals/${id}/${action}`, {});
}
export const denyHeld = (id: string) => actHeld(id, 'deny');

/** Green Approve, red Deny (Brett, Oct 30 2026). */
const ACTS: { a: VetoAction; icon: string; tone: 'danger' | 'success' | 'neutral'; done: string }[] = [
  { a: 'deny', icon: 'x-circle', tone: 'danger', done: 'Denied: it will not run.' },
  { a: 'approve-now', icon: 'play', tone: 'success', done: 'Approved: the hub runs it now.' },
  { a: 'shelve', icon: 'pause', tone: 'neutral', done: 'Shelved: the countdown is paused until you approve or deny it.' },
];

/** Countdown (or shelved) + Deny / Approve / Shelve as the hub allows: big targets on a row too; `big` on the request's own page. */
export function HeldBar({ item, onDone, big }: { item: ApprovalItem; onDone: (next?: ApprovalItem) => void; big?: boolean }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState<VetoAction | null>(null);
  const left = useCountdown(item);
  const shelved = isShelved(item);
  const approved = item.veto?.approvedNow === true;
  const urgent = !shelved && left <= VETO_WARNING_SECONDS;
  const actions = actionsOf(item.veto?.actions);
  const run = async (x: (typeof ACTS)[number]) => {
    setBusy(x.a);
    try { const r = await actHeld(item.id, x.a); rt.toast(r.message || x.done, x.a === 'deny' ? 'success' : 'info'); onDone(r.item); checkHubNow(); }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); onDone(); }
    finally { setBusy(null); }
  };
  const live = shelved || (left > 0 && !approved);
  return (
    <div className={`axp-axhub-held${big ? ' axp-axhub-held--big' : ''}`} data-axf-anchor="held-actions">
      <span className={`axp-axhub-held__count${urgent ? ' is-urgent' : ''}`} role="timer" aria-label={shelved ? 'Shelved' : left > 0 ? `Runs in ${left} seconds` : 'Running'}>
        {shelved ? 'Shelved' : approved ? 'Approved' : left > 0 ? formatCountdown(left) : '0:00'}
      </span>
      {big && <span className="axp-axhub-held__what">{shelved ? 'Paused: waits until you approve or deny it' : approved ? 'Approved: the hub is running it' : left > 0 ? 'Runs when the countdown ends' : 'Time is up: the hub is running it'}</span>}
      {live && ACTS.filter((x) => actions.includes(x.a)).map((x) => (
        <Button key={x.a} tone={x.tone} icon={x.icon} busy={busy === x.a} disabled={busy !== null} aria-label={`${VETO_ACTION_LABELS[x.a]}: ${item.title}`} onClick={() => void run(x)}>{VETO_ACTION_LABELS[x.a]}</Button>
      ))}
    </div>
  );
}

/** The status chip for a held row: the countdown itself. */
export function HeldChip({ item }: { item: ApprovalItem }) {
  const left = useCountdown(item);
  if (isShelved(item)) return <Chip tone="warning">Shelved</Chip>;
  return <Chip tone={left <= VETO_WARNING_SECONDS ? 'danger' : 'warning'}>{left > 0 ? `Runs in ${formatCountdown(left)}` : 'Running'}</Chip>;
}
