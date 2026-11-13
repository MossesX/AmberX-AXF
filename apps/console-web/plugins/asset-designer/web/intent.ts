/**
 * Deep-link intents: what the designer should open next (set by the plugin's actions before it navigates, read by the
 * Designer when it mounts or while it is open). Pure data, so the console actions, MCP tools, CLI and voice all land on
 * the same screen state as a tap in the UI.
 */
export interface Intent {
  /** open a blank asset of this type (or the saved one when `id` is given) */
  type?: string;
  id?: string;
  /** open the settings interface asset of this chrome type (tab-group, toolbar, banner, nav-menu, app-menu, context-menu) */
  chrome?: string;
}

let pending: Intent | null = null;
const subs = new Set<(i: Intent) => void>();

export function setIntent(i: Intent): void {
  pending = i;
  for (const f of subs) f(i);
}
/** The intent waiting for the designer, taken once. */
export function takeIntent(): Intent | null {
  const i = pending;
  pending = null;
  return i;
}
export function onIntent(f: (i: Intent) => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
