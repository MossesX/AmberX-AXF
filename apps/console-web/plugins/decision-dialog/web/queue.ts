/**
 * The decision queue's pure rules (testable without a page): which decision pops up next, its place in the stack, and
 * how a spoken / typed answer ('pick option 2', 'approve it', 'request changes: bigger buttons') becomes an answer.
 */

export interface DecisionShot { src: string; device: '' | 'desktop' | 'phone'; name: string }
export interface DecisionOption { id: string; label: string; notes: string; shots: DecisionShot[] }
export interface DecisionButton { id: string; label: string; kind: 'primary' | 'danger' | 'neutral'; note: boolean; action: string; icon: string }
export interface Decision {
  $axf: 'decision@1';
  id: string;
  type: string;
  source: string;
  ref: string;
  handler: string;
  title: string;
  body: string;
  build: string;
  app: string;
  link: string;
  openAction: string;
  openLabel: string;
  shots: DecisionShot[];
  options: DecisionOption[];
  buttons: DecisionButton[];
  status: 'waiting' | 'answered' | 'withdrawn';
  createdAt: string;
  laterUntil: string;
  popup: boolean;
  answer: null | { button: string; option: string; note: string; by: string; via: string; at: string };
}

/**
 * The next decision to pop up, or null. `items` newest first (the server's order); `opened` = ids already popped up in
 * this page; `onScreen` = the decision shown now (it blocks while still waiting); `busy` = another dialog is open.
 * Oldest first among the new ones, so a burst of submits comes up in the order they arrived.
 */
export function nextPopup(items: readonly Decision[], opened: ReadonlySet<string>, onScreen: string | null, busy = false): string | null {
  if (busy) return null;
  if (onScreen && items.some((d) => d.id === onScreen && d.status === 'waiting')) return null;
  const fresh = items.filter((d) => d.status === 'waiting' && d.popup && !opened.has(d.id));
  return fresh.at(-1)?.id ?? null;
}

/** "2 of 5 waiting" for the counter; place is 1-based in the waiting stack (newest first). */
export function place(items: readonly Decision[], id: string): { at: number; of: number; prev: string | null; next: string | null } {
  const w = items.filter((d) => d.status === 'waiting');
  const i = w.findIndex((d) => d.id === id);
  return { at: i + 1, of: w.length, prev: i > 0 ? w[i - 1]?.id ?? null : null, next: i >= 0 ? w[i + 1]?.id ?? null : null };
}

const WORDS: Record<string, string> = { one: '1', first: '1', two: '2', second: '2', three: '3', third: '3', four: '4', fourth: '4', five: '5', fifth: '5', six: '6', seven: '7', eight: '8', nine: '9' };

/**
 * A sentence to an answer: 'pick option 2' → {button: pick, option: 2}; 'approve it' → {button: approve};
 * 'request changes: make it bigger' → {button: changes, note}; 'reject', 'deny', 'shelve', 'approve now', 'later'.
 * Null when it isn't an answer.
 */
export function parseAnswer(text: string): { button: string; option?: string; note?: string } | null {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  const [head = '', ...rest] = t.split(/[:,—-]\s*/);
  const note = rest.join(', ').trim();
  const pick = /\b(?:pick|choose|take|go with)\s+(?:option\s+|number\s+|the\s+)?(\w+)/.exec(head) ?? /\boption\s+(\w+)/.exec(head);
  if (pick) {
    const w = pick[1] ?? '';
    const n = WORDS[w] ?? w;
    return /^\d+$/.test(n) ? { button: 'pick', option: n } : null;
  }
  if (/\b(request|ask for|needs?)\s+changes?\b|\bchanges\b/.test(head)) return { button: 'changes', ...(note ? { note } : {}) };
  if (/\bapprove (it )?now\b|\brun it now\b/.test(head)) return { button: 'approve-now' };
  if (/\b(approve|yes|accept|confirm|ok|okay|pass)\b/.test(head)) return { button: 'approve' };
  if (/\breject\b/.test(head)) return { button: 'reject', ...(note ? { note } : {}) };
  if (/\b(deny|decline|no|cancel|stop)\b/.test(head)) return { button: 'deny' };
  if (/\bshelve\b/.test(head)) return { button: 'shelve' };
  if (/\b(later|snooze|not now)\b/.test(head)) return { button: 'later' };
  return null;
}

/** The button a parsed answer means on this decision: 'deny' and 'reject' stand in for each other. */
export function matchButton(d: Pick<Decision, 'buttons'>, button: string): string | null {
  const ids = d.buttons.map((b) => b.id);
  if (ids.includes(button)) return button;
  const alias: Record<string, string[]> = { deny: ['reject', 'decline'], reject: ['deny', 'decline'], approve: ['approve-now'], 'approve-now': ['approve'] };
  return (alias[button] ?? []).find((a) => ids.includes(a)) ?? null;
}
