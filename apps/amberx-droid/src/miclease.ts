/**
 * The shared microphone lease (mic-lease@1): one holder at a time, on `globalThis.__axfMicLease`.
 *
 * Everything in a page that listens (AmberX dictation, Speak a command, voice notes, the Assistant microphone) takes
 * the lease before it opens the microphone and releases it after, so two of them never fight over the recognizer.
 * Nobody imports anybody: whoever loads first puts the object on globalThis and everyone else uses that one, so either
 * side can be removed. A holder that forgets to release loses the lease after its time-to-live (default 2 minutes).
 * This is AmberX's copy; the Agent voice console plugin carries the same one in its own folder.
 * Same contract, same key: keep the two identical.
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

/** Who holds the mic, for people: "Dictation is using the microphone". */
export const HOLDER_LABEL: Record<string, string> = { dictation: 'Dictation', 'voice-command': 'Speak a command', 'agent-voice': 'The Assistant microphone', notes: 'Voice notes' };

/** Runs `fn` while `owner` holds the microphone lease; throws a plain message when someone else has it. */
export async function withMic<T>(owner: string, fn: () => Promise<T>, ttlMs = DEFAULT_TTL): Promise<T> {
  // Mic off (micguard.ts): nobody gets the microphone until it is switched back on.
  if ((globalThis as { __axfMicOff?: { off(): boolean } }).__axfMicOff?.off()) throw new Error('Mic off is on. Turn the mic back on first.');
  const lease = micLease();
  if (!lease.take(owner, ttlMs)) {
    const who = lease.holder() ?? '';
    throw new Error(`${HOLDER_LABEL[who] ?? who} is using the microphone.`);
  }
  try { return await fn(); } finally { lease.release(owner); }
}
