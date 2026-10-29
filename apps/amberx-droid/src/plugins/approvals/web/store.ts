/**
 * Veto approvals store: what the hub holds right now, one track per held call (countdown, state, output), shared by the
 * notifications, the Approvals page and the Terminal view.
 *
 * Reads the hub's approvals feed every 5 s while AmberX is on screen (and on focus) with lib-hub's `fetchVetoFeed`, and
 * follows each held call's job stream (`followVeto`: countdown, state, output, done) from the moment its timer is seen
 * until it ends. The countdown ticks on the local clock between reads. With the app closed, the Android watch service
 * (`VetoAlerts.java`) raises the same notifications from the same feed.
 */
import { followVeto, fetchVetoFeed, isVetoFinal, secondsLeftNow, type VetoCall, type VetoEvent, type VetoState } from '../../../axf/libs/hub/veto';
import type { HubFeedStatus } from '../../../axf/libs/hub';
import { HUB } from '../../../hub/useHub';

export const POLL_MS = 5_000;
export const LINES_MAX = 500;
/** Finished tracks kept (as terminal tabs) until closed. */
export const KEEP_MAX = 20;

export type TrackState = VetoState | 'gone';
export interface TermLine { at: number; stream: 'stdout' | 'stderr' | 'note'; text: string }
export interface Track {
  call: VetoCall;
  state: TrackState;
  /** seconds left now (ticks locally; stream countdown events correct it) */
  left: number;
  exitCode: number | null;
  lines: TermLine[];
  streaming: boolean;
  startedAt: number;
}

interface State { status: 'idle' | HubFeedStatus; held: VetoCall[]; tracks: Track[]; checkedAt: number | null }
let st: State = { status: 'idle', held: [], tracks: [], checkedAt: null };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const vetoState = () => st;
export const subscribeVeto = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

type Hooks = { started?: (t: Track) => void; changed?: (t: Track, from: TrackState) => void };
let hooks: Hooks = {};
export const setVetoHooks = (h: Hooks) => { hooks = h; };

const streams = new Map<string, AbortController>();

function patch(id: string, f: (t: Track) => Track) {
  const i = st.tracks.findIndex((t) => t.call.id === id);
  if (i < 0) return;
  const before = st.tracks[i]!;
  const after = f(before);
  const tracks = [...st.tracks];
  tracks[i] = after;
  st = { ...st, tracks };
  if (after.state !== before.state) hooks.changed?.(after, before.state);
  emit();
}

const line = (stream: TermLine['stream'], text: string): TermLine => ({ at: Date.now(), stream, text });
const addLines = (t: Track, more: TermLine[]): Track => ({ ...t, lines: [...t.lines, ...more].slice(-LINES_MAX) });

function onEvent(id: string, e: VetoEvent) {
  patch(id, (t) => {
    switch (e.type) {
      case 'countdown': return { ...t, left: e.secondsLeft, call: { ...t.call, secondsLeft: e.secondsLeft, readAt: Date.now() } };
      case 'state': return addLines({ ...t, state: e.state, left: e.state === 'held' ? t.left : 0 }, [line('note', stateNote(e.state))]);
      case 'output': return addLines(t, e.text.split('\n').filter((x, i, a) => x || i < a.length - 1).map((x) => line(e.stream, x)));
      case 'done': return addLines({ ...t, state: e.state, exitCode: e.exitCode, left: 0 }, [line('note', `${stateNote(e.state)}${e.exitCode === null ? '' : ` (exit ${e.exitCode})`}`)]);
    }
  });
}

export const stateNote = (s: TrackState): string => ({
  held: 'Held: runs when the countdown ends unless you deny it.',
  running: 'Running now.',
  ran: 'Ran.',
  failed: 'Failed.',
  denied: 'Denied: it did not run.',
  expired: 'Expired: it did not run.',
  gone: 'No longer held on the hub (decided there, or the hub restarted). See the hub for how it ended.',
} as Record<TrackState, string>)[s];

/** Follow a held call's job stream until it ends; retried a few times when cut off. */
async function follow(id: string) {
  const t = st.tracks.find((x) => x.call.id === id);
  if (!t?.call.streamUrl || streams.has(id)) return;
  const ctl = new AbortController();
  streams.set(id, ctl);
  patch(id, (x) => ({ ...x, streaming: true }));
  let tries = 0;
  try {
    while (!ctl.signal.aborted && tries < 5) {
      try {
        const end = await followVeto(t.call.streamUrl, HUB, (e) => onEvent(id, e), { signal: ctl.signal });
        if (end) break;
      } catch (e) {
        if (ctl.signal.aborted) break;
        if (tries === 0) patch(id, (x) => addLines(x, [line('note', `Live output unavailable (${String((e as Error)?.message ?? e)}); retrying.`)]));
      }
      const now = st.tracks.find((x) => x.call.id === id);
      if (!now || isFinal(now.state)) break;
      tries += 1;
      await new Promise((r) => setTimeout(r, 2_000 * tries));
    }
  } finally {
    streams.delete(id);
    patch(id, (x) => ({ ...x, streaming: false }));
  }
}

export const isFinal = (s: TrackState) => s === 'gone' || isVetoFinal(s as VetoState);

/** Merge a fresh list of held calls: new ones start a track (and their stream), missing ones end theirs. */
export function mergeHeld(held: VetoCall[], now: number = Date.now()) {
  const ids = new Set(held.map((c) => c.id));
  let tracks = [...st.tracks];
  const started: Track[] = [];
  for (const c of held) {
    const i = tracks.findIndex((t) => t.call.id === c.id);
    if (i < 0) {
      const t: Track = { call: c, state: 'held', left: secondsLeftNow(c, now), exitCode: null, lines: [line('note', `Held: ${c.title}`), line('note', `$ ${c.command || c.tool}`)], streaming: false, startedAt: now };
      tracks.push(t);
      started.push(t);
    } else if (tracks[i]!.state === 'held') {
      tracks[i] = { ...tracks[i]!, call: c, left: secondsLeftNow(c, now) };
    }
  }
  // A held track the hub no longer lists: if its stream isn't telling us how it ended, say so.
  const gone: string[] = [];
  tracks = tracks.map((t) => {
    if (t.state !== 'held' || ids.has(t.call.id) || streams.has(t.call.id)) return t;
    gone.push(t.call.id);
    const note = t.left > 0 ? stateNote('gone') : 'Time was up: the hub ran it. Live output is not available here; see the hub for the result.';
    return addLines({ ...t, state: 'gone' as TrackState, left: 0 }, [line('note', note)]);
  });
  const done = tracks.filter((t) => isFinal(t.state));
  if (done.length > KEEP_MAX) { const drop = new Set(done.slice(0, done.length - KEEP_MAX).map((t) => t.call.id)); tracks = tracks.filter((t) => !drop.has(t.call.id)); }
  st = { ...st, held, tracks };
  for (const t of started) { hooks.started?.(t); void follow(t.call.id); }
  for (const id of gone) { const t = tracks.find((x) => x.call.id === id); if (t) hooks.changed?.(t, 'held'); }
  emit();
}

/** Every second: count down held tracks; at zero a held track shows "running" until the stream (or the feed) says more. */
function tick() {
  const now = Date.now();
  let changed = false;
  const tracks = st.tracks.map((t) => {
    if (t.state !== 'held') return t;
    const left = secondsLeftNow(t.call, now);
    if (left === t.left) return t;
    changed = true;
    return { ...t, left };
  });
  if (changed) { st = { ...st, tracks }; emit(); }
}

let inflight = false;
export async function checkVeto(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const r = await fetchVetoFeed(HUB);
    st = { ...st, status: r.feed.status, checkedAt: Date.now() };
    if (r.feed.status === 'ok') mergeHeld(r.held); else emit();
  } finally { inflight = false; }
}

let started = false;
export function startVeto() {
  if (started || typeof document === 'undefined') return;
  started = true;
  void checkVeto();
  setInterval(() => { if (document.visibilityState === 'visible') void checkVeto(); }, POLL_MS);
  setInterval(tick, 1_000);
  globalThis.addEventListener?.('focus', () => void checkVeto());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkVeto(); });
}

/** Mark a track denied locally (the stream or the next read confirms). */
export function markDenied(id: string) {
  patch(id, (t) => (t.state === 'held' ? addLines({ ...t, state: 'denied', left: 0 }, [line('note', stateNote('denied'))]) : t));
  streams.get(id)?.abort();
}

export function closeTrack(id: string) {
  streams.get(id)?.abort();
  st = { ...st, tracks: st.tracks.filter((t) => t.call.id !== id || !isFinal(t.state)) };
  emit();
}

/** Tests only. */
export function resetVeto() { streams.forEach((c) => c.abort()); streams.clear(); st = { status: 'idle', held: [], tracks: [], checkedAt: null }; emit(); }
