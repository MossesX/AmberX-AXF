/**
 * One listener per event, one voice per device (Nov 1 2026, Brett: the app said "Note saved" on a loop every time it
 * opened, and the web app in Chrome dinged over and over). Pure and clock-free (callers pass `now` and storage), so
 * test.mjs drives every rule here. See `_claude/builds/reports/amberx-listeners.md` for what was wrong.
 *
 * - **Handled ids** (`HandledIds`): every event that can make AmberX act or speak carries an id; one already handled is
 *   ignored, and the ids are kept on the device, so reopening the app or reconnecting never replays it. An event older
 *   than `FRESH_MS` is ignored too (Android hands a retained event to the page that loads next).
 * - **Keyed subscriptions** (`Subscriptions`): a listener is bound under a key; binding the same key again removes the
 *   one before it, so re-registering, resuming or re-rendering never stacks listeners.
 * - **One owner per device** (`electOwner`, `createOwner`): tabs and web views of AmberX on one device elect one
 *   owner (Web Locks when the browser has them, else a BroadcastChannel heartbeat). Only the owner listens, speaks and
 *   rings; the others stay silent and only show state.
 * - **Ding gate** (`DingGate`): a sound only for a NEW event that needs attention (a new approval), at most once per
 *   id, rate-limited, never for an empty list, a refresh, a heartbeat or a replay.
 * - **Quiet**: one switch that stops every sound and every spoken word at once (`soundAllowed`).
 *
 * The page exposes the result on `globalThis.__axfSoundOwner` (sound-owner@1), the same no-imports pattern as the
 * microphone lease, so console plugins loaded into AmberX (the veto banner's alarm) can ask before they ring.
 */

/** An event this old (ms) is a replay, not news. */
export const FRESH_MS = 20_000;
/** Ids kept per kind. */
export const HANDLED_MAX = 300;
/** At most one ding per this many ms, whatever arrives. */
export const DING_GAP_MS = 8_000;
/** An owner that hasn't sent a heartbeat for this long is gone. */
export const OWNER_TIMEOUT_MS = 5_000;
export const HEARTBEAT_MS = 1_500;

export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** localStorage when there is one, else memory (tests, private mode). */
export function deviceStore(): KeyValueStore {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    if (ls) { ls.getItem('amberx.probe'); return ls; }
  } catch { /* storage off */ }
  return memoryStore();
}
export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

/* ---------------------------------------------------------------- handled ids */

export class HandledIds {
  private ids: string[];
  constructor(private readonly store: KeyValueStore, private readonly key: string, private readonly max = HANDLED_MAX) {
    this.ids = HandledIds.read(store, key);
  }
  private static read(store: KeyValueStore, key: string): string[] {
    try { const v = JSON.parse(store.getItem(key) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
  }
  has(id: string): boolean {
    // Another tab may have handled it since: read the store again.
    this.ids = HandledIds.read(this.store, this.key);
    return this.ids.includes(id);
  }
  /** true the first time an id is seen (and records it); false for every replay. */
  firstTime(id: string): boolean {
    if (!id || this.has(id)) return false;
    this.ids = [...this.ids, id].slice(-this.max);
    try { this.store.setItem(this.key, JSON.stringify(this.ids)); } catch { /* full: kept in memory */ }
    return true;
  }
  get size(): number { return this.ids.length; }
}

/** An event from the native side or the hub: `id` (unique), `at` (ms since epoch, when it happened). */
export interface EventStamp { id?: string; at?: number }

export type EventVerdict = { run: true } | { run: false; why: 'replayed' | 'stale' };

/**
 * Should this event run? Already handled = replayed; older than `FRESH_MS` = stale (handed over from before the page
 * loaded). An event without an id (an older APK) only passes the age check when it has `at`; one with neither runs, as
 * before, and the echo filter is what guards it.
 */
export function eventVerdict(e: EventStamp, handled: HandledIds, now: number, maxAge = FRESH_MS): EventVerdict {
  if (typeof e.at === 'number' && Number.isFinite(e.at) && now - e.at > maxAge) {
    if (e.id) handled.firstTime(e.id);
    return { run: false, why: 'stale' };
  }
  if (e.id && !handled.firstTime(e.id)) return { run: false, why: 'replayed' };
  return { run: true };
}

/* ---------------------------------------------------------------- keyed subscriptions */

export interface Removable { remove(): unknown }

/** Listeners bound by key: binding a key again removes the previous listener first. */
export class Subscriptions {
  private readonly bound = new Map<string, Promise<Removable | null>>();
  bind(key: string, add: () => Promise<Removable> | Removable): void {
    this.unbind(key);
    let p: Promise<Removable | null>;
    try { p = Promise.resolve(add()).catch(() => null); } catch { p = Promise.resolve(null); }
    this.bound.set(key, p);
  }
  unbind(key: string): void {
    const p = this.bound.get(key);
    if (!p) return;
    this.bound.delete(key);
    void p.then((h) => h?.remove()).catch(() => undefined);
  }
  clear(): void { [...this.bound.keys()].forEach((k) => this.unbind(k)); }
  keys(): string[] { return [...this.bound.keys()]; }
}

/* ---------------------------------------------------------------- browser recognizer restarts */

/** Errors after which restarting can't help (no permission, no microphone, no service). */
export const FATAL_RECOGNITION = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'];
/** A recognizer session shorter than this counts as a quick end. */
export const QUICK_END_MS = 1_500;
/** How long to wait before restarting after `quick` quick ends in a row: none at first, then 1, 2, 4… up to 30 s; null =
 * give up (more than 12 quick ends in a row: something holds the microphone). */
export function restartDelay(quick: number): number | null {
  if (quick <= 0) return 250;
  if (quick > 12) return null;
  return Math.min(30_000, 1000 * 2 ** (quick - 1));
}

/* ---------------------------------------------------------------- one owner per device */

/**
 * The heartbeat election. `claims` = the instances heard from within `OWNER_TIMEOUT_MS` that said they own, with
 * when they were last heard. A live claimant keeps it (two claimants: the lowest id; the other yields). Nobody alive
 * claims: the lowest id among the live instances and this one takes it. Same answer in every tab, so one owner.
 */
export function electOwner(peers: ReadonlyMap<string, { at: number; owns: boolean }>, self: string, selfOwns: boolean, now: number): string {
  const alive = [...peers.entries()].filter(([id, p]) => id !== self && now - p.at < OWNER_TIMEOUT_MS);
  const claimants = [...alive.filter(([, p]) => p.owns).map(([id]) => id), ...(selfOwns ? [self] : [])].sort();
  if (claimants.length) return claimants[0]!;
  return [self, ...alive.map(([id]) => id)].sort()[0]!;
}

export interface OwnerChannel { post(msg: unknown): void; onMessage(fn: (msg: unknown) => void): () => void; close(): void }
export interface OwnerLocks { request(name: string, cb: () => Promise<void>): Promise<void> }

export interface SoundOwner {
  readonly id: string;
  isOwner(): boolean;
  on(fn: (owner: boolean) => void): () => void;
  /** heartbeat tick (the timer calls it; tests call it with their own clock) */
  tick(now: number): void;
  close(): void;
}

type Beat = { $axf: 'amberx-owner@1'; id: string; owner: string | null; at: number; bye?: boolean };

/**
 * One owner among this device's AmberX pages. `locks` (navigator.locks) is used when given: the page holding the lock
 * is the owner until it closes, and the next waiting page takes over. Otherwise `channel` (a BroadcastChannel) carries a
 * heartbeat and `electOwner` decides. With neither (one page, the Android web view) the page owns.
 */
export function createOwner(opts: { id: string; channel?: OwnerChannel | null; locks?: OwnerLocks | null; now?: () => number; name?: string }): SoundOwner {
  const now = opts.now ?? Date.now;
  const fns = new Set<(o: boolean) => void>();
  let owner = false;
  let closed = false;
  const set = (o: boolean) => { if (o !== owner) { owner = o; fns.forEach((f) => { try { f(o); } catch { /* a listener's problem */ } }); } };
  const base = { id: opts.id, isOwner: () => owner && !closed, on: (fn: (o: boolean) => void) => { fns.add(fn); return () => { fns.delete(fn); }; } };

  if (opts.locks) {
    let release: (() => void) | null = null;
    void opts.locks.request(opts.name ?? 'amberx.sound-owner', () => new Promise<void>((done) => {
      if (closed) { done(); return; }
      release = done;
      set(true);
    })).catch(() => set(true));
    return { ...base, tick: () => undefined, close() { closed = true; set(false); release?.(); } };
  }
  if (!opts.channel) { set(true); return { ...base, tick: () => undefined, close() { closed = true; set(false); } }; }

  const ch = opts.channel;
  const peers = new Map<string, { at: number; owns: boolean }>();
  const startedAt = now();
  const decide = (t: number) => {
    // A page that just opened listens for one heartbeat first, so it never grabs ownership from a running owner.
    if (!owner && t - startedAt < HEARTBEAT_MS * 2 && peers.size) { set(false); return; }
    set(electOwner(peers, opts.id, owner, t) === opts.id);
  };
  const off = ch.onMessage((m) => {
    const b = m as Beat;
    if (!b || b.$axf !== 'amberx-owner@1' || b.id === opts.id) return;
    if (b.bye) peers.delete(b.id);
    else peers.set(b.id, { at: now(), owns: b.owner === b.id });
    decide(now());
  });
  const tick = (t: number) => {
    if (closed) return;
    decide(t);
    ch.post({ $axf: 'amberx-owner@1', id: opts.id, owner: owner ? opts.id : null, at: t } satisfies Beat);
  };
  return {
    ...base,
    tick,
    close() {
      if (closed) return;
      closed = true;
      try { ch.post({ $axf: 'amberx-owner@1', id: opts.id, owner: null, at: now(), bye: true } satisfies Beat); } catch { /* closed */ }
      off(); ch.close(); set(false);
    },
  };
}

/* ---------------------------------------------------------------- quiet + who may make a sound */

export interface SoundState { quiet: boolean; owner: boolean; deviceSounds: boolean }

/** May this page make a sound or speak now? Never when Quiet, never when another page owns, never when this
 * device's browser sounds are off (a phone with the AmberX app: the app rings and speaks there). */
export const soundAllowed = (s: SoundState): boolean => !s.quiet && s.owner && s.deviceSounds;

/** Browser sounds on this device by default: off in a phone's browser (the AmberX app owns sound there), on elsewhere.
 * The Android app's own web view always makes sound (it is the app). */
export const deviceSoundsDefault = (opts: { native: boolean; userAgent: string }): boolean =>
  opts.native || !/Android/i.test(opts.userAgent);

/* ---------------------------------------------------------------- ding gate */

export type DingVerdict = { ding: boolean; why: 'new' | 'quiet' | 'empty' | 'seen' | 'first-read' | 'too-soon'; fresh: string[] };

/**
 * Dings for new things that need attention: one per new id, never twice for an id (kept on the device, so a reopen
 * or another tab doesn't ring it again), never for an empty list ("All clear"), never on the first read after opening
 * (what was already waiting isn't news), and at most once per `DING_GAP_MS`. `fresh` = the ids new in this read.
 */
export class DingGate {
  private readonly seen: HandledIds;
  private lastDing = -Infinity;
  private primed = false;
  constructor(store: KeyValueStore, key = 'amberx.ding.seen') { this.seen = new HandledIds(store, key); }
  /** A read of what is waiting now: records every id as seen and says whether to ding. */
  read(ids: readonly string[], now: number, allowed: boolean): DingVerdict {
    const fresh = ids.filter((id) => id && !this.seen.has(id));
    fresh.forEach((id) => this.seen.firstTime(id));
    const no = (why: DingVerdict['why']): DingVerdict => ({ ding: false, why, fresh });
    if (!this.primed) { this.primed = true; return no(ids.length ? 'first-read' : 'empty'); }
    if (!ids.length) return no('empty');
    if (!fresh.length) return no('seen');
    if (!allowed) return no('quiet');
    if (now - this.lastDing < DING_GAP_MS) return no('too-soon');
    this.lastDing = now;
    return { ding: true, why: 'new', fresh };
  }
}

/* ---------------------------------------------------------------- the page's sound owner (sound-owner@1) */

export const SOUND_OWNER_KEY = '__axfSoundOwner';
export interface SoundOwnerApi {
  readonly $axf: 'sound-owner@1';
  /** may this page make a sound / speak right now */
  allowed(): boolean;
  state(): SoundState;
  on(fn: (s: SoundState) => void): () => void;
}
