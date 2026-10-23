/*
 * Live sessions — live-session@1 (kernel contract, web reference). Same design as the Kotlin kernel's
 * `ai.amberx.axf.kernel.live` (LiveSession.kt); conformance fixtures: spec/fixtures/live-session.json.
 *
 * A live session is a long-running conversation or job (an AI assistant chat, an agent run, a terminal) that
 * is OWNED BY A HOST, not by the screen showing it. Closing the browser, the app or the phone only DETACHES a
 * viewer; the session keeps running on its host and any device can ATTACH again and REPLAY what it missed.
 * A session ends only when someone closes it explicitly — never on disconnect or idle.
 *
 * The kernel ships only the contract: the event log, the state reducer and the SessionHost interface, plus a
 * typed placeholder for capability `axf.live-sessions`. Hosts are modules/plugins: a local host (the AI
 * assistant plugin runs one in the console today) and the axHub host (session workers on the VPS, planned).
 * Spec: framework/spec/LIVE-SESSIONS.md.
 */

export const LIVE_SESSION_CONTRACT = 'live-session@1';
/** Capability id a host registers under; the kernel declares it as a placeholder until one does. */
export const LIVE_SESSIONS_CAPABILITY = 'axf.live-sessions';

/** idle: open, nothing running · running: a turn/job is producing events · waiting: paused for the user (an approval) · closed: ended on purpose. */
export type LiveState = 'idle' | 'running' | 'waiting' | 'closed';
export const LIVE_STATES: LiveState[] = ['idle', 'running', 'waiting', 'closed'];

/**
 * Reserved lifecycle event kinds; every other kind is the session owner's own (text, tool, status…) and is
 * replayed as-is. The set of kinds is open: hosts never reject a kind they don't know.
 */
export const LIVE_KINDS = {
  open: 'session.open',
  close: 'session.close',
  turnStart: 'turn.start',
  turnEnd: 'turn.end',
  wait: 'wait',
  resume: 'resume',
  /** the host restarted while a turn was running; the turn is over, the session stays open */
  interrupted: 'interrupted',
} as const;

export interface LiveEvent {
  /** 1, 2, 3… per session, never reused, never reset while the session exists */
  seq: number;
  at: number;
  kind: string;
  data?: unknown;
}

export interface LiveSessionInfo {
  id: string;
  /** what owns it: `assistant.chat`, `agent.run`, `terminal`… (open set) */
  kind: string;
  title?: string;
  state: LiveState;
  /** host id: `local`, `axhub`, … */
  host: string;
  createdAt: number;
  updatedAt: number;
  /** seq of the newest event (0 = none) */
  lastSeq: number;
  /** viewers attached right now */
  viewers: number;
  meta?: Record<string, unknown>;
}

/** Result of reading a log after a seq the viewer already has. */
export interface LiveReplay {
  events: LiveEvent[];
  /** the seq to ask from next time (= last returned, or the `after` asked for when nothing is new) */
  next: number;
  /** true when events after `after` were already trimmed from the log: the viewer must reload the owner's full state */
  gap: boolean;
  /** true when `after` is beyond the newest seq (the viewer saw a log the host no longer has): replay restarted from the oldest kept event */
  reset: boolean;
  /** more events are waiting beyond `max` */
  more: boolean;
}

/** State after an event, from the reserved kinds only (anything else leaves the state alone). */
export function reduceLiveState(state: LiveState, kind: string): LiveState {
  if (state === 'closed') return 'closed';
  switch (kind) {
    case LIVE_KINDS.close: return 'closed';
    case LIVE_KINDS.turnStart: return 'running';
    case LIVE_KINDS.resume: return state === 'waiting' ? 'running' : state;
    case LIVE_KINDS.wait: return state === 'running' ? 'waiting' : state;
    case LIVE_KINDS.turnEnd:
    case LIVE_KINDS.interrupted: return 'idle';
    default: return state;
  }
}

/**
 * Bounded, append-only event log with seq numbers. Pure: the same calls give the same results on every port
 * (Kotlin `LiveEventLog`, Python `EventLog` in the assistant plugin). `limit` keeps the newest events.
 */
export class LiveEventLog {
  private items: LiveEvent[] = [];
  private last = 0;
  constructor(public readonly limit = 4000, events: LiveEvent[] = []) {
    for (const e of events) { this.items.push(e); this.last = Math.max(this.last, e.seq); }
    this.trim();
  }
  get lastSeq() { return this.last; }
  get firstSeq() { return this.items[0]?.seq ?? this.last + 1; }
  get size() { return this.items.length; }
  all(): LiveEvent[] { return [...this.items]; }
  append(kind: string, data: unknown, at: number): LiveEvent {
    const e: LiveEvent = { seq: ++this.last, at, kind, ...(data === undefined ? {} : { data }) };
    this.items.push(e);
    this.trim();
    return e;
  }
  since(after: number, max = 500): LiveReplay {
    let from = Math.max(0, Math.floor(after));
    let reset = false;
    if (from > this.last) { reset = true; from = 0; }
    const first = this.firstSeq;
    const gap = !reset && this.items.length > 0 && from < first - 1;
    const fresh = this.items.filter((e) => e.seq > from);
    const events = fresh.slice(0, Math.max(0, max));
    return { events, next: events.length ? events[events.length - 1]!.seq : from, gap, reset, more: fresh.length > events.length };
  }
  private trim() { if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit); }
}

export interface LiveOpen { kind: string; title?: string; meta?: Record<string, unknown> }
export type LiveDetach = () => void;

/**
 * What a host provides (capability `axf.live-sessions`). Every method is async because hosts are usually
 * remote. `attach` replays everything after `after`, then streams new events until the returned detach is
 * called; detaching never stops the session.
 */
export interface SessionHost {
  readonly id: string;
  readonly label: string;
  /** false for the placeholder and for hosts that can't be reached right now */
  available(): Promise<boolean>;
  list(filter?: { kind?: string; includeClosed?: boolean }): Promise<LiveSessionInfo[]>;
  open(spec: LiveOpen): Promise<LiveSessionInfo>;
  info(id: string): Promise<LiveSessionInfo>;
  events(id: string, after: number, max?: number): Promise<LiveReplay>;
  attach(id: string, after: number, onEvent: (e: LiveEvent) => void, onReplay?: (r: LiveReplay) => void): Promise<LiveDetach>;
  /** input to the session's owner (a chat message, keystrokes…); owner-defined shape */
  send(id: string, input: unknown): Promise<void>;
  /** stop the running turn; the session stays open */
  stop(id: string): Promise<void>;
  /** end it on purpose (the only way a session ends) */
  close(id: string): Promise<void>;
}

export class LiveSessionsNotImplemented extends Error {
  readonly capability = LIVE_SESSIONS_CAPABILITY;
  constructor() { super(`"${LIVE_SESSIONS_CAPABILITY}" is declared but not built yet.`); this.name = 'NotImplemented'; }
}

/** The kernel default until a module registers a real host. Never pretends to work. */
export class PlaceholderSessionHost implements SessionHost {
  readonly id = 'placeholder';
  readonly label = 'No session host';
  async available() { return false; }
  async list(): Promise<LiveSessionInfo[]> { return []; }
  open(): Promise<LiveSessionInfo> { return Promise.reject(new LiveSessionsNotImplemented()); }
  info(): Promise<LiveSessionInfo> { return Promise.reject(new LiveSessionsNotImplemented()); }
  events(): Promise<LiveReplay> { return Promise.reject(new LiveSessionsNotImplemented()); }
  attach(): Promise<LiveDetach> { return Promise.reject(new LiveSessionsNotImplemented()); }
  send(): Promise<void> { return Promise.reject(new LiveSessionsNotImplemented()); }
  stop(): Promise<void> { return Promise.reject(new LiveSessionsNotImplemented()); }
  close(): Promise<void> { return Promise.reject(new LiveSessionsNotImplemented()); }
}

/** Hosts by id; the first registered available host is the default unless one is chosen. Open: any module may add one. */
export class SessionHosts {
  private hosts = new Map<string, SessionHost>();
  private chosen = '';
  readonly placeholder = new PlaceholderSessionHost();
  register(h: SessionHost) { this.hosts.set(h.id, h); return () => { if (this.hosts.get(h.id) === h) this.hosts.delete(h.id); }; }
  list(): SessionHost[] { return [...this.hosts.values()]; }
  get(id: string): SessionHost | undefined { return this.hosts.get(id); }
  choose(id: string) { this.chosen = id; }
  /** the chosen host, else the first registered, else the placeholder */
  current(): SessionHost { return (this.chosen && this.hosts.get(this.chosen)) || this.hosts.values().next().value || this.placeholder; }
}
