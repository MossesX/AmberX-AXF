/**
 * Postponed-approval reminders and the mandatory review (axHub decision #90), pure so `test.mjs` can pin them.
 *
 * Every 30 minutes a request stays postponed on axHub, the console raises one alert (alert@1, source `approvals`) so
 * the bell, ntfy and web push deliver it; the alert of the previous half hour is resolved, so the bell holds one open
 * alert per postponed request. Once a request has been postponed for 2 hours the reminder is an error and the console
 * blocks on a review until each such request has been decided on the hub (approved, declined, postponed again, revoked).
 *
 * The slot (which half hour) and the review rule come from lib-hub (`postponedSlot`, `postponedNeedsReview`); this
 * file only plans what to raise and resolve.
 */

export const SOURCE = 'approvals';
/** Remembered reminder slots kept per browser (oldest dropped first). */
export const REMEMBER_CAP = 100;
/** The choices offered in the mandatory review; each opens the hub's own page for that request. */
export const REVIEW_CHOICES = [
  { id: 'approve', label: 'Approve', page: 'approval', hint: 'Tap Approve on the hub\'s page below.' },
  { id: 'decline', label: 'Decline', page: 'approval', hint: 'Tap Decline on the hub\'s page below.' },
  { id: 'postpone', label: 'Postpone again', page: 'postpone', hint: 'Pick a time or a condition on the hub\'s page below.' },
  { id: 'revoke', label: 'Revoke', page: 'approval', hint: 'Tap Revoke on the hub\'s page below.' },
];

export const reminderKey = (id, slot) => `${SOURCE}:postponed:${id}:${slot}`;

/** "45 min" / "2 h 5 min". */
export function age(minutes) {
  const m = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

/**
 * What to raise and resolve now.
 * @param {{ id: string, tool: string, waitingFor: string, url: string, slot: number, minutes: number, review: boolean }[]} items postponed requests
 * @param {Record<string, number>} remembered id → last slot alerted (this browser)
 */
export function reminderPlan(items, remembered) {
  const raise = [];
  const resolve = [];
  const next = {};
  const seen = new Set();
  for (const it of items) {
    if (!it || typeof it.id !== 'string' || seen.has(it.id)) continue;
    seen.add(it.id);
    const last = Number.isInteger(remembered[it.id]) ? remembered[it.id] : 0;
    const slot = Number.isInteger(it.slot) ? it.slot : -1;
    if (slot >= 1 && slot > last) {
      raise.push({
        source: SOURCE,
        severity: it.review ? 'error' : 'warn',
        key: reminderKey(it.id, slot),
        title: `${it.review ? 'Review postponed approval' : 'Approval still postponed'}: ${it.tool}`,
        body: `Postponed ${age(it.minutes)}${it.waitingFor ? `, waiting for ${it.waitingFor}` : ''}.${it.review ? ' It needs your decision now: the console asks before you go on.' : ' Approve, decline, postpone again or revoke it on axHub.'}`,
        link: it.url,
        meta: { approval: it.id, slot },
      });
      if (last >= 1) resolve.push(reminderKey(it.id, last));
      next[it.id] = slot;
    } else if (last >= 1 || slot >= 0) {
      next[it.id] = last;
    }
  }
  // requests no longer postponed (decided, back to pending, expired): their open reminder is resolved
  for (const [id, last] of Object.entries(remembered)) {
    if (seen.has(id)) continue;
    if (Number.isInteger(last) && last >= 1) resolve.push(reminderKey(id, last));
  }
  const keep = Object.entries(next).slice(-REMEMBER_CAP);
  return { raise, resolve, next: Object.fromEntries(keep) };
}

/**
 * The mandatory review list: requests that need a review now, with the choice made in this browser (if any). The
 * review is over only when the hub no longer lists any of them as needing review.
 * @param {{ id: string, review: boolean }[]} items
 * @param {Record<string, string>} choices id → choice id
 */
export function reviewState(items, choices) {
  const due = items.filter((x) => x && x.review);
  const rows = due.map((x) => ({ ...x, choice: REVIEW_CHOICES.some((c) => c.id === choices[x.id]) ? choices[x.id] : '' }));
  const keep = Object.fromEntries(rows.filter((r) => r.choice).map((r) => [r.id, r.choice]));
  return { blocking: rows.length > 0, rows, chosen: rows.filter((r) => r.choice).length, choices: keep };
}
