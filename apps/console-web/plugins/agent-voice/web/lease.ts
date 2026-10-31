/**
 * The shared microphone lease (mic-lease@1): one holder at a time, on `globalThis.__axfMicLease`.
 *
 * Everything in a page that listens (AmberX dictation, Speak a command, voice notes, the Assistant microphone) takes
 * the lease before it opens the microphone and releases it after, so two of them never fight over the recognizer.
 * Nobody imports anybody: whoever loads first puts the object on globalThis and everyone else uses that one, so either
 * side can be removed. A holder that forgets to release loses the lease after its time-to-live (default 2 minutes).
 * AmberX's own copy lives in `apps/amberx-droid/src/miclease.ts` (same contract, same key).
 */
export interface MicLease {
  readonly $axf: 'mic-lease@1';
  holder(): string | null;
  /** true when `owner` now holds it (or already did). `ttlMs` refreshes the expiry. */
  take(owner: string, ttlMs?: number, now?: () => number): boolean;
  release(owner: string): void;
  on(fn: (holder: string | null) => void): () => void;
}

export const LEASE_KEY = '__axfMicLease';
export const DEFAULT_TTL = 120_000;

export function createLease(): MicLease {
  let who: string | null = null;
  let until = 0;
  const fns = new Set<(h: string | null) => void>();
  const tell = () => fns.forEach((f) => { try { f(who); } catch { /* a listener's problem */ } });
  return {
    $axf: 'mic-lease@1',
    holder: () => who,
    take(owner, ttlMs = DEFAULT_TTL, now = Date.now) {
      const t = now();
      if (who && who !== owner && t < until) return false;
      const changed = who !== owner;
      who = owner;
      until = t + Math.max(1, ttlMs);
      if (changed) tell();
      return true;
    },
    release(owner) { if (who === owner) { who = null; until = 0; tell(); } },
    on(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
  };
}

/** The page's lease (made on first use). */
export function micLease(): MicLease {
  const g = globalThis as unknown as Record<string, MicLease | undefined>;
  const have = g[LEASE_KEY];
  if (have && have.$axf === 'mic-lease@1') return have;
  const made = createLease();
  g[LEASE_KEY] = made;
  return made;
}
