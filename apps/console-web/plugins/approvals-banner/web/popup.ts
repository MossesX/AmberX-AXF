/**
 * When the approvals banner pops a call up by itself (pure, so it is testable without a page).
 *
 * The pop-up used to be dropped in AmberX: a held call decided somewhere else (the Android notification's Deny / Approve /
 * Shelve, the hub, the console) left its veto screen open on "No longer held" for good, and while that screen counted as
 * "one is already on screen", no later held call popped up; only the phone's notification fired. Two rules fix it:
 *  - a call on screen that is no longer waiting or held does not block the next one (`nextPopup`);
 *  - the veto screen closes itself once a read made after it opened no longer lists its call (`vetoGone`), the same as
 *    the review dialog does for calls waiting for an approval.
 */

/** Ms a "No longer held" screen stays before it closes itself. */
export const POPUP_GONE_CLOSE_MS = 2_500;

/**
 * The next call to pop up, or null. `live` lists every call still waiting or held, in pop-up order (held calls on their
 * countdown first); shelved and approved calls are left out by the caller. `onScreen` is the call shown now (null =
 * none); it blocks only while it is still live.
 */
export function nextPopup(opened: ReadonlySet<string>, onScreen: string | null, live: readonly string[], allLive: readonly string[] = live): string | null {
  if (onScreen && allLive.includes(onScreen)) return null;
  return live.find((id) => !opened.has(id)) ?? null;
}

/**
 * Is the call on a veto screen gone (decided, ran, or let go)? Only on a good read made after the screen opened, so a
 * notification tap that opens the screen before the page has read the new call never closes it early.
 */
export function vetoGone(opts: { held: boolean; status: string; checkedAt: string | null; openedAt: number }): boolean {
  if (opts.held || opts.status !== 'ok' || !opts.checkedAt) return false;
  const at = Date.parse(opts.checkedAt);
  return Number.isFinite(at) && at >= opts.openedAt;
}
