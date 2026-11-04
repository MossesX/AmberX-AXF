/**
 * Held commands (veto@1, Brett Oct 28 2026): a command Claude sends through Vinnie is held by the hub for a countdown
 * (90 s since axHub decision 104) and then run by the hub itself. **Deny** stops it before time is up; **Approve now** runs it
 * right away (no more notices); **Shelve** pauses the countdown until he approves or denies it (decision 104). Shown on
 * the first screen of the approval page and on its grid row, in place of the usual buttons.
 *
 * The countdown runs on this browser's clock from the `veto.secondsLeft` the hub sent (read time kept), so a clock that is
 * off still counts right; the page re-reads the hub every few seconds. Each action is `POST /auth/api/approvals/<id>/<deny|
 * approve-now|shelve>` (Approve now falls back to `/approve`, decision 105) with this browser's admin session, the hub's Origin and the session's CSRF value (hubPost), never a
 * token.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, useRuntime } from '../axf/react';
import { checkHubNow } from '../axf/libs/hub/react';
import { formatCountdown, secondsLeftNow, VETO_WARNING_SECONDS, type VetoAction } from '../axf/libs/hub/veto';
import { HubApiError, hubPost } from '../hub/api';
import { approveNowPaths, heldActions } from '../hub/core';
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

/** One owner action on a held call. Approve now tries `/approve-now`, then `/approve` (a hub with only one of them). */
export async function actHeld(id: string, action: VetoAction): Promise<{ message?: string; item?: ApprovalItem }> {
  if (action !== 'approve-now') return hubPost<{ message?: string; item?: ApprovalItem }>(`/auth/api/approvals/${id}/${action}`, {});
  // Any 404 tries the next route. A hub with neither answers its catch-all "Not found." (an old hub); a request the hub
  // doesn't know answers its own message, which is shown.
  let last: unknown = new Error('Not an approval id.');
  for (const path of approveNowPaths(id)) {
    try { return await hubPost<{ message?: string; item?: ApprovalItem }>(path, {}); }
    catch (e) { if (!(e instanceof HubApiError && e.status === 404)) throw e; last = e; }
  }
  throw last instanceof HubApiError && last.message === 'Not found.' ? new Error(OLD_HUB_APPROVE) : last;
}
export const denyHeld = (id: string) => actHeld(id, 'deny');
/** What a hub without either route says (axHub from before decision 104). */
export const OLD_HUB_APPROVE = "This hub can't approve a held call yet: it needs updating. Deny still works.";

/** Labels on this app's buttons: "Approve now" says it skips the countdown (Brett, Oct 31 2026). */
export const HELD_LABELS: Record<VetoAction, string> = { deny: 'Deny', 'approve-now': 'Approve now', shelve: 'Shelve' };

/** Green Approve now, red Deny (Brett, Oct 30 2026). */
const ACTS: { a: VetoAction; icon: string; tone: 'danger' | 'success' | 'neutral'; done: string }[] = [
  { a: 'deny', icon: 'x-circle', tone: 'danger', done: 'Denied: it will not run.' },
  { a: 'approve-now', icon: 'play', tone: 'success', done: 'Approved: the hub runs it now.' },
  { a: 'shelve', icon: 'pause', tone: 'neutral', done: 'Shelved: the countdown is paused until you approve or deny it.' },
];

/**
 * Countdown (or shelved) + Deny / Approve now (same size, side by side) + Shelve: big targets on a row too; `big` on the
 * request's own page. `picked` is the button a notice picked (`?do=`): it is marked and focused, the tap decides.
 * A tap shows the answer at once (Running, Denied, Shelved) from the hub's reply, before the next read.
 */
export function HeldBar({ item, onDone, big, picked }: { item: ApprovalItem; onDone: (next?: ApprovalItem) => void; big?: boolean; picked?: VetoAction }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState<VetoAction | null>(null);
  const [after, setAfter] = useState<VetoAction | null>(null);
  useEffect(() => setAfter(null), [item.id, item.revision]);
  const left = useCountdown(item);
  const shelved = isShelved(item) && after !== 'approve-now';
  const approved = item.veto?.approvedNow === true || after === 'approve-now';
  const denied = after === 'deny';
  const urgent = !shelved && left <= VETO_WARNING_SECONDS;
  const actions = heldActions(item);
  const run = async (x: (typeof ACTS)[number]) => {
    setBusy(x.a);
    try {
      const r = await actHeld(item.id, x.a);
      if (!r.item) setAfter(x.a);
      rt.toast(r.message || x.done, x.a === 'deny' ? 'info' : 'success');
      onDone(r.item);
      checkHubNow();
    } catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); onDone(); }
    finally { setBusy(null); }
  };
  const live = !denied && !approved && (shelved || left > 0);
  const shown = live ? ACTS.filter((x) => actions.includes(x.a)) : [];
  const btn = (x: (typeof ACTS)[number]) => (
    <Button key={x.a} tone={x.tone} icon={x.icon} busy={busy === x.a} disabled={busy !== null}
      className={picked === x.a ? 'is-picked' : undefined} autoFocus={picked === x.a || undefined}
      aria-label={`${HELD_LABELS[x.a]}: ${item.title}`} onClick={() => void run(x)}>{HELD_LABELS[x.a]}</Button>
  );
  const pair = shown.filter((x) => x.a !== 'shelve');
  const shelve = shown.find((x) => x.a === 'shelve');
  return (
    <div className={`axp-axhub-held${big ? ' axp-axhub-held--big' : ''}`} data-axf-anchor="held-actions">
      <span className={`axp-axhub-held__count${urgent && live ? ' is-urgent' : ''}`} role="timer" aria-live="polite"
        aria-label={denied ? 'Denied' : approved ? 'Running' : shelved ? 'Shelved' : left > 0 ? `Runs in ${left} seconds` : 'Running'}>
        {denied ? 'Denied' : approved ? 'Running' : shelved ? 'Shelved' : left > 0 ? formatCountdown(left) : 'Running'}
      </span>
      {big && <span className="axp-axhub-held__what">{denied ? 'Denied: it will not run' : approved ? 'Approved: the hub is running it now' : shelved ? 'Paused: waits until you approve or deny it' : left > 0 ? 'Runs when the countdown ends' : 'Time is up: the hub is running it'}</span>}
      {/* Deny and Approve now: one pair, the same size (equal grid columns), big tap targets; never cut, the title gives way. */}
      {pair.length > 0 && <div className="axp-axhub-pair">{pair.map(btn)}</div>}
      {shelve && (big
        ? btn(shelve)
        // On a row Shelve is an icon, so Deny / Approve now keep their words and the title keeps some room.
        : <button key="shelve" type="button" className={`fx-iconbtn axp-axhub-held__shelve${picked === 'shelve' ? ' is-picked' : ''}`} aria-label={`${HELD_LABELS.shelve}: ${item.title}`} title="Shelve: pause the countdown until you decide" disabled={busy !== null} onClick={() => void run(shelve)}><Icon name={shelve.icon} size={18} /></button>)}
    </div>
  );
}

/** The status chip for a held row: the countdown itself. */
export function HeldChip({ item }: { item: ApprovalItem }) {
  const left = useCountdown(item);
  if (item.veto?.approvedNow) return <Chip tone="success">Running</Chip>;
  if (isShelved(item)) return <Chip tone="warning">Shelved</Chip>;
  return <Chip tone={left <= VETO_WARNING_SECONDS ? 'danger' : 'warning'}>{left > 0 ? `Runs in ${formatCountdown(left)}` : 'Running'}</Chip>;
}
