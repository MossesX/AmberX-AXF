/**
 * Gizmo deep links: `?gizmo=new|talk|<conversation id>&brain=<id>&q=<first message>` on the AmberX app / web app URL,
 * or the `companion.link` action with the same fields (console_action, voice, other plugins). The link is parked here
 * until the chat view picks it up (it may not be mounted yet), then the `axf:companion.link` event tells a mounted view.
 */
import { parseGizmoLink, type GizmoLink } from './core';

let pending: GizmoLink | null = null;
export const LINK_EVENT = 'axf:companion.link';

export function requestLink(l: GizmoLink) {
  pending = l;
  window.dispatchEvent(new Event(LINK_EVENT));
}
export function takeLink(): GizmoLink | null {
  const l = pending;
  pending = null;
  return l;
}
/** The page URL's link, if any (read once at start; the query is left alone so a reload opens the same chat). */
export function linkFromLocation(): GizmoLink | null {
  const search = location.search || (location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '');
  const l = parseGizmoLink(search);
  return l.open ? l : null;
}
/** The URL that opens a chat (for "Copy link"). */
export function linkFor(id: string, brain = ''): string {
  const u = new URL(location.href);
  u.hash = '';
  u.search = '';
  u.searchParams.set('gizmo', id || 'new');
  if (brain) u.searchParams.set('brain', brain);
  return u.toString();
}
