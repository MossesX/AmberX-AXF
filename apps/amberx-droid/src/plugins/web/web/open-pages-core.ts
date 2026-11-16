/**
 * Open pages, the pure part (open-url-route@1 on the phone): plain words for routes and reasons, the line a result
 * reads as, and what is missing. Shared by the settings panel, the actions and the self-test (test.mjs).
 */
import type { OpenPagesGrant, OpenPagesResult, OpenPagesState } from '../../../native';

export const OPEN_PAGES_TAB = 'open-pages';

/** The plain words for a route and a reason (the engine's REASONS, the ones the phone gives). */
export const ROUTE_WORDS: Record<string, string> = {
  'console-tab': 'the console tab on screen', overlay: 'AmberX\'s full-screen overlay', direct: 'a direct browser start',
  'full-screen-intent': 'a full-screen notice', notification: 'a tap-to-open notification', none: 'nothing',
};
export const REASON_WORDS: Record<string, string> = {
  'console-visible': 'the console tab on screen opened it', 'overlay-open': 'the overlay opened it', 'direct-start': 'AmberX started the browser',
  'screen-locked-open': 'the full-screen notice opened it', 'tap-to-open': 'only a notification went out', 'no-console': 'no console tab was on screen',
  'console-behind': 'the console tab was not on screen', 'console-stale': 'the console tab did not answer', 'overlay-off': 'Display over other apps is off',
  'overlay-not-ready': 'the toolbar was not up', 'background-start-blocked': 'Android blocked the start from the background',
  'phone-unlocked': 'Android showed the full-screen notice as a banner', 'no-full-screen-intent': 'full-screen notices are not allowed',
  'notifications-off': 'notifications are off', 'attempt-failed': 'it was tried and failed', 'nothing-left': 'every route was skipped or failed',
};

/** One line for a result: "Opened through the console tab on screen" / "Didn't open: …". */
export function resultLine(r: OpenPagesResult | null): string {
  if (!r) return 'No page opened yet.';
  const how = ROUTE_WORDS[r.route] ?? r.route;
  if (r.opened) return `Opened through ${how}.`;
  if (r.notified) return `Didn't open by itself: ${how} went out (${REASON_WORDS[(r.attempts ?? []).find((a) => !a.opened)?.reason ?? ''] ?? 'Android held the start back'}).`;
  return `Didn't open: ${REASON_WORDS[r.reason] ?? r.reason}.`;
}

export const GRANTS: { which: OpenPagesGrant; key: 'overlay' | 'fullScreenIntent' | 'notifications'; label: string; why: string }[] = [
  { which: 'overlay', key: 'overlay', label: 'Display over other apps', why: 'Lets AmberX open a page over whatever is on screen, Chrome included.' },
  { which: 'full-screen', key: 'fullScreenIntent', label: 'Full-screen notices', why: 'Opens the page over the lock screen when the phone is locked.' },
  { which: 'notifications', key: 'notifications', label: 'Notifications', why: 'The last resort: a tap-to-open notification.' },
];


/** The grants still off, in the order the Auto fix asks for them. */
export function missingGrants(st: Pick<OpenPagesState, 'overlay' | 'fullScreenIntent' | 'notifications'>): OpenPagesGrant[] {
  return GRANTS.filter((g) => !st[g.key]).map((g) => g.which);
}

/** True when AmberX can put a page on screen by itself on this phone (anything before the notification). */
export function opensByItself(st: Pick<OpenPagesState, 'order'>): boolean {
  return st.order.some((r) => r !== 'notification');
}
