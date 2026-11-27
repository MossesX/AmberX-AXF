/**
 * The builds live channel (GET /api/builds/events, Server-Sent Events): the VPS pipeline and the lander send one
 * `builds.updated` { build, state, rev, at } after every change they write to the builds store, and every open screen
 * re-reads the store at that moment. The event carries no step data: the store stays the one source.
 *
 * One stream serves every subscriber on the page; it closes when the last one leaves. EventSource reconnects by
 * itself. A server without the channel (or a browser without EventSource) leaves `liveOpen()` false and the table's
 * own poll carries on as before.
 */
export const BUILDS_EVENTS_URL = '/api/builds/events';
export const BUILDS_UPDATED = 'builds.updated';
export type BuildsUpdated = { build?: string; state?: string; rev?: number; at?: string };

const subs = new Set<(e: BuildsUpdated) => void>();
let stream: EventSource | null = null;
let open = false;
let refused = 0;
/** After this many errors in a row with no event in between, the channel is taken as absent and left closed. */
const GIVE_UP_AFTER = 5;

function emit(ev: MessageEvent) {
  refused = 0; open = true;
  let data: BuildsUpdated = {};
  try { const j = JSON.parse(String(ev.data ?? '')) as unknown; if (j && typeof j === 'object') data = j as BuildsUpdated; } catch { /* an event without JSON still means "re-read" */ }
  for (const f of [...subs]) f(data);
}

function connect() {
  if (stream || typeof EventSource === 'undefined') return;
  const es = new EventSource(BUILDS_EVENTS_URL);
  stream = es;
  es.onopen = () => { open = true; refused = 0; };
  es.onerror = () => { open = false; refused += 1; if (refused >= GIVE_UP_AFTER) close(); };
  es.addEventListener(BUILDS_UPDATED, (ev) => emit(ev as MessageEvent));
}

function close() {
  stream?.close(); stream = null; open = false;
}

/** Is the channel connected right now (the table polls slowly while it is). */
export const liveOpen = (): boolean => open;

/** Call `fn` on every `builds.updated`; returns the unsubscribe (the stream closes with the last subscriber). */
export function onBuildsUpdated(fn: (e: BuildsUpdated) => void): () => void {
  subs.add(fn);
  refused = 0;
  connect();
  return () => { subs.delete(fn); if (!subs.size) close(); };
}
