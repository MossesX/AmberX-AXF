/**
 * When a banner is empty (Brett, Nov 2026: "All banners hide when empty"). An empty banner is never drawn and takes no
 * space; it comes back the moment an entry arrives and goes again when the last one is cleared.
 *
 * Every banner sits in the framework's banner frame (BannerSettings.tsx → BannerFrame), which watches what its banner
 * drew and hides itself while that is empty, so a banner plugin that leaves an empty shell (a title with no rows, an
 * empty list) is hidden as well as one that draws nothing. A banner built on BannerBase (components/BannerBase.tsx) never
 * draws its shell without entries in the first place.
 *
 * Empty = nothing a person could read or press: no text other than white space and no control or media. Decorative
 * pieces (icons, aria-hidden parts) don't count. A banner can say it is empty itself with `data-fx-banner-empty="on"` on
 * any element (that element and everything in it counts as empty). Pure: works on anything shaped like a DOM node, so it
 * runs in tests without a browser.
 */

/** The smallest piece of a DOM node this needs. */
export interface BannerNodeLike {
  nodeType: number;
  nodeValue?: string | null;
  tagName?: string;
  hidden?: boolean;
  childNodes?: ArrayLike<BannerNodeLike>;
  getAttribute?: (name: string) => string | null;
}

/** Marks an element (and what is in it) as empty on purpose. */
export const BANNER_EMPTY_ATTR = 'data-fx-banner-empty';

/** Elements that are content by themselves, even with no text (a button with only an icon, a picture, a field). */
const CONTENT_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'PROGRESS', 'METER', 'OBJECT', 'EMBED']);
/** Elements that never show anything. */
const SILENT_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

const TEXT = 3;
const ELEMENT = 1;

/** Is there nothing in this node a person could read or press? */
export function bannerNodeEmpty(node: BannerNodeLike | null | undefined): boolean {
  if (!node) return true;
  if (node.nodeType === TEXT) return !(node.nodeValue ?? '').trim();
  if (node.nodeType !== ELEMENT) return true; // comments and the like
  if (node.hidden) return true;
  const attr = (n: string) => node.getAttribute?.(n) ?? null;
  if (attr(BANNER_EMPTY_ATTR) === 'on' || attr('aria-hidden') === 'true') return true;
  const tag = (node.tagName ?? '').toUpperCase();
  if (SILENT_TAGS.has(tag)) return true;
  if (CONTENT_TAGS.has(tag)) return attr('type') === 'hidden';
  const kids = node.childNodes;
  if (!kids) return true;
  for (let i = 0; i < kids.length; i++) if (!bannerNodeEmpty(kids[i])) return false;
  return true;
}

/** Is this banner frame's content empty (what it holds, the frame's own hidden state not counted)? */
export function bannerFrameEmpty(frame: BannerNodeLike | null | undefined): boolean {
  if (!frame?.childNodes) return true;
  for (let i = 0; i < frame.childNodes.length; i++) if (!bannerNodeEmpty(frame.childNodes[i])) return false;
  return true;
}

/** How many entries a banner holds, from whatever it was given (a count, a list, nothing). */
export function bannerEntryCount(entries: number | readonly unknown[] | null | undefined | false): number {
  if (Array.isArray(entries)) return entries.length;
  return typeof entries === 'number' && Number.isFinite(entries) && entries > 0 ? Math.floor(entries) : 0;
}
