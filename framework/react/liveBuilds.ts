/**
 * Live builds store (build-live@1, spec/BUILD-LIVE.md): one in-memory Map<build, build-live-state@1> that every grid row,
 * the broke toast and the broke dialog read. Events go through the reference engine's fold (core/engines/build-live.mjs),
 * so a quiet liveness pass that changes nothing the row draws does not re-render it and its animation does not restart.
 *
 * The store has no transport of its own: an app feeds it (console: src/live/buildLive.ts subscribes to the live channel
 * and calls applyLiveEvent / applyLiveSnapshot). Tests and other apps feed it the same way.
 *
 *   applyLiveEvent(raw)              fold one build-live-event@1; true when a row changed
 *   applyLiveSnapshot(doc)           replace everything from a build-live-snapshot@1 (connect, reconnect, focus resync)
 *   liveState(build)                 the folded state or null
 *   useRowRunState(build)            { state, live } for a grid row: the run state to draw ('' = draw nothing)
 *   useLiveBuilds()                  every state (re-renders on any change)
 *   onLiveTransition(fn)             (prev, next) on every changed fold: what the broke alert listens to
 *   setLiveChannel(status, info)     the transport's state: connecting | live | resync | stale | off
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_EVERY_SEC, SNAPSHOT, channelStale, emptyState, fold, normEvent } from '../core/engines/build-live.mjs';
import type { LiveBuildState, LiveSnapshot, LiveState } from '../core/engines/build-live.d.mts';

export type { LiveBuildState, LiveSnapshot, LiveState } from '../core/engines/build-live.d.mts';
export type LiveChannelStatus = 'off' | 'connecting' | 'live' | 'resync' | 'stale';
export interface LiveChannel { status: LiveChannelStatus; everySec: number; lastLivenessAt: string; lastEventAt: string; seq: number; error: string }
/** The run state a row draws: '' for idle and unknown builds (nothing drawn). */
export type RowRunState = '' | Exclude<LiveState, 'idle'>;

const states = new Map<string, LiveBuildState>();
const listeners = new Set<() => void>();
const transitions = new Set<(prev: LiveBuildState | null, next: LiveBuildState) => void>();
let version = 0;
let channel: LiveChannel = { status: 'off', everySec: DEFAULT_EVERY_SEC, lastLivenessAt: '', lastEventAt: '', seq: 0, error: '' };
let list: LiveBuildState[] = [];

function emit() {
  version += 1;
  list = [...states.values()];
  for (const fn of [...listeners]) { try { fn(); } catch { /* a listener never breaks the store */ } }
}
const tell = (prev: LiveBuildState | null, next: LiveBuildState) => { for (const fn of [...transitions]) { try { fn(prev, next); } catch { /* ignore */ } } };

/** Fold one event. Returns true when what a row draws changed. */
export function applyLiveEvent(raw: unknown): boolean {
  const ev = normEvent(raw);
  if (!ev) return false;
  if (ev.kind === 'liveness') channel = { ...channel, lastLivenessAt: ev.at, everySec: ev.everySec || channel.everySec };
  channel = { ...channel, lastEventAt: ev.at, seq: Math.max(channel.seq, ev.seq) };
  const prev = states.get(ev.build) ?? null;
  const r = fold(prev ?? emptyState(ev.build), ev);
  if (r.dropped) return false;
  states.set(ev.build, r.state);
  if (r.changed) { tell(prev, r.state); emit(); }
  else if (channel.status === 'stale') setLiveChannel('live');
  return r.changed;
}

/** Replace every state from a snapshot (the server's fold is the truth after a reconnect). */
export function applyLiveSnapshot(doc: unknown): number {
  const d = doc as Partial<LiveSnapshot> | null;
  if (!d || d.$axf !== SNAPSHOT || !Array.isArray(d.builds)) return 0;
  const seen = new Set<string>();
  for (const s of d.builds) {
    if (!s?.build) continue;
    seen.add(s.build);
    const prev = states.get(s.build) ?? null;
    states.set(s.build, s);
    if (!prev || prev.state !== s.state || prev.seq !== s.seq) tell(prev, s);
  }
  for (const b of [...states.keys()]) if (!seen.has(b)) states.delete(b);
  channel = { ...channel, everySec: d.everySec || channel.everySec, seq: Math.max(0, d.seq ?? 0), lastLivenessAt: d.builds.reduce((m, s) => (s.checkedAt > m ? s.checkedAt : m), channel.lastLivenessAt) };
  emit();
  return seen.size;
}

export const liveState = (build: string): LiveBuildState | null => states.get(build) ?? null;
export const liveStates = (): LiveBuildState[] => list;
export const liveChannel = (): LiveChannel => channel;
export const liveVersion = () => version;

/** The transport says where it is; `stale` is also derived from the liveness clock by checkLiveChannel(). */
export function setLiveChannel(status: LiveChannelStatus, info: Partial<Omit<LiveChannel, 'status'>> = {}) {
  const next = { ...channel, ...info, status };
  if (next.status === channel.status && next.error === channel.error && next.everySec === channel.everySec) { channel = next; return; }
  channel = next;
  emit();
}

/** Marks the channel stale when no liveness pass arrived for STALE_PASSES × everySec (call on a timer). */
export function checkLiveChannel(now = new Date().toISOString()): boolean {
  if (channel.status !== 'live') return false;
  const running = list.some((s) => s.state === 'running' || s.state === 'stale');
  if (running && channel.lastLivenessAt && channelStale(channel.lastLivenessAt, now, channel.everySec)) { setLiveChannel('stale'); return true; }
  return false;
}

export function subscribeLive(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function onLiveTransition(fn: (prev: LiveBuildState | null, next: LiveBuildState) => void): () => void { transitions.add(fn); return () => { transitions.delete(fn); }; }

/** Clears everything (tests, sign-out). */
export function resetLiveBuilds() {
  states.clear();
  channel = { status: 'off', everySec: DEFAULT_EVERY_SEC, lastLivenessAt: '', lastEventAt: '', seq: 0, error: '' };
  emit();
}

export const rowRunState = (s: LiveBuildState | null | undefined): RowRunState => (!s || s.state === 'idle' ? '' : s.state);

/** A grid row's live state: re-renders only when this build's state object changes. */
export function useRowRunState(build: string | null | undefined): { state: RowRunState; live: LiveBuildState | null } {
  const live = useSyncExternalStore(subscribeLive, () => (build ? states.get(build) ?? null : null), () => null);
  return { state: rowRunState(live), live };
}

/** Every live state (the Live status panel, the REST mirror in tests). */
export const useLiveBuilds = (): LiveBuildState[] => useSyncExternalStore(subscribeLive, () => list, () => list);
/** The channel's state for a "live / resyncing / stale" chip. */
export const useLiveChannel = (): LiveChannel => useSyncExternalStore(subscribeLive, () => channel, () => channel);
