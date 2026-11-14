import { parsePr } from './review-core.mjs';
import { PR_PARAM } from './keys';

/*
 * Which PR UI Review shows. A deep link (?ui-review-pr=647), the `ui-review.pr` console action (MCP / CLI / voice run it)
 * and the page's own picker all land here, so an open page follows a request made anywhere else.
 */
const EVENT = 'axf:ui-review-pr';
let pending: number | null = parsePr(new URLSearchParams(globalThis.location?.search ?? '').get(PR_PARAM));

/** Ask UI Review (`notify` false: the page itself changed it, only remember it) to show one PR's items (null = every PR). The page picks it up now or when it next opens. */
export function requestPr(v: unknown, notify = true): number | null {
  pending = v === null || v === '' || v === undefined ? null : parsePr(v);
  if (notify) globalThis.dispatchEvent?.(new CustomEvent(EVENT, { detail: pending }));
  return pending;
}
/** The PR the page should open on (a deep link or an action made before it rendered). */
export const pendingPr = () => pending;
/** Follow requests while the page is open. */
export function onPrRequest(f: (pr: number | null) => void): () => void {
  const h = (e: Event) => f((e as CustomEvent<number | null>).detail);
  globalThis.addEventListener?.(EVENT, h);
  return () => globalThis.removeEventListener?.(EVENT, h);
}
