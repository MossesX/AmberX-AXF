/*
 * listeners — the pure rules behind AmberX's background listeners (listener@1), one copy for every side that
 * shows or runs them: the AmberX page (its Listeners control panel, the companion's talk mode, the browser hands-free
 * fallback), AmberX's native Android code (`ListenerRules.java`, the same answers on `cases.json`) and the Dev
 * Console's AmberX listeners plugin. No React, no network, no clock: callers pass `now`.
 *
 * Built Nov 6 2026 (Fable, build gizmo-rebuild-fable). Brett: "I need more powerful controls over the background
 * listeners for AmberX. I've had problems with the microphone... it's crashing with other apps, and sometimes it'll
 * just do that sound over and over."
 *
 * - **One registry** ({@link LISTENERS}): every listener AmberX runs (the hands-free wake listener, the command after
 *   the wake word, the Speak button, Gizmo's talk mode, the recorder's mic track, the axHub watch, the veto alarm, the
 *   page-side listeners), with a plain label, its kind and where it runs. Open: an id not listed still gets a policy,
 *   a label (its id) and a row.
 * - **One policy per listener** ({@link ListenerPolicy}): on / off, pause for calls, pause for other apps, the start
 *   sound, how many restarts before it gives up, and the backoff between them. Kept as app settings
 *   (`amberx.listeners.<id>.<field>`, {@link policyKeys}) so they ride axHub to every device and the console.
 * - **Restarts back off and give up** ({@link afterEnd}, {@link restartDelay}): a listener that ends at once (another
 *   app has the microphone, the recognizer is busy, no audio) waits longer every time (1 s, 2 s, 4 s … up to the cap)
 *   and after `retries` quick ends in a row stops in state `error` with the reason, instead of restarting forever
 *   and replaying its start tone ("that sound over and over"). A run that lasted counts as healthy and resets it. After
 *   giving up it tries once more, cold, after {@link ListenerPolicy.cooldownMs}.
 * - **Silent restarts** ({@link startSound}): the start sound (when a listener has one at all) plays only for a start
 *   the person asked for, never for a restart, a resume after a call, or an automatic start.
 * - **Yield** ({@link yieldReason}, {@link resumeAfterMs}): the microphone is let go for a call, when Android silences
 *   AmberX's recording, when another app records or takes audio focus; it comes back once the microphone has stayed
 *   free for a moment. Mic off wins over everything.
 * - **One owner of the mic at a time** ({@link MIC_PRIORITY}, {@link micWinner}): when two listeners want the
 *   microphone the higher one gets it and the other waits; talk mode beats the Speak button beats the hands-free loop.
 * - **Device document** ({@link deviceDoc}, listener-state@1): what a device publishes to the hub so the console shows
 *   every listener of every phone: state, since when, last error, who holds the mic.
 */

/* ---------------------------------------------------------------- the registry */

export type ListenerKind = 'mic' | 'poll' | 'sound';
export type ListenerSide = 'native' | 'page';
export type ListenerState = 'off' | 'starting' | 'on' | 'paused' | 'yielded' | 'error' | 'unavailable';

export interface ListenerDef {
  id: string;
  label: string;
  kind: ListenerKind;
  side: ListenerSide;
  /** one plain line: what it does */
  about: string;
  /** policy fields this listener doesn't have (a poll has no sound or mic) */
  without?: (keyof ListenerPolicy)[];
  /** policy defaults that differ from {@link POLICY_DEFAULTS} */
  defaults?: Partial<ListenerPolicy>;
}

/** Every listener AmberX runs. Open: add a row here (or publish an unknown id) and the panel shows it. */
export const LISTENERS: readonly ListenerDef[] = [
  { id: 'handsfree', label: 'Hands-free (wake word)', kind: 'mic', side: 'native', about: 'Listens for the wake phrases (or everything, when always armed) on screen and with the screen off.' },
  { id: 'oneshot', label: 'Command after the wake word', kind: 'mic', side: 'native', about: "One Google utterance after a wake phrase, then back to the silent wake listener.", without: ['on'] },
  { id: 'speak', label: 'Speak button', kind: 'mic', side: 'native', about: 'One utterance when you tap Speak or push to talk.' },
  { id: 'talk', label: 'Gizmo talk mode', kind: 'mic', side: 'native', about: 'Hands-free conversation with Gizmo that keeps going with the screen off or AmberX in the background (a notification with Stop).' },
  { id: 'recorder-mic', label: 'Recorder microphone', kind: 'mic', side: 'native', about: "The Audio Output Recorder's opt-in mic track.", without: ['retries', 'sound'] },
  { id: 'monitor', label: 'axHub watch (approvals)', kind: 'poll', side: 'native', about: 'Reads the approvals feed with the screen off and raises alerts.', without: ['pauseOnCall', 'pauseForOtherApps', 'sound'] },
  { id: 'veto-alarm', label: 'Veto alarm', kind: 'sound', side: 'native', about: 'Rings for a held command until you decide it.', without: ['pauseOnCall', 'pauseForOtherApps', 'retries'], defaults: { sound: true } },
  { id: 'browser-handsfree', label: 'Hands-free in this browser', kind: 'mic', side: 'page', about: 'Web Speech recognition while an AmberX tab is open (the phone app listens natively instead).' },
  { id: 'dictation', label: 'Dictation', kind: 'mic', side: 'page', about: 'The dictation plugin while it records.', without: ['retries'] },
  { id: 'voice-command', label: 'Speak a command (page)', kind: 'mic', side: 'page', about: 'The voice plugin waiting for the next command in a browser.', without: ['retries'] },
  { id: 'agent-voice', label: 'Assistant microphone', kind: 'mic', side: 'page', about: 'The agent voice console plugin loaded into AmberX.', without: ['retries'] },
  { id: 'notes', label: 'Voice notes', kind: 'mic', side: 'page', about: 'Voice notes while one records.', without: ['retries'] },
];

const DEFS = new Map(LISTENERS.map((d) => [d.id, d]));
export const listenerDef = (id: string): ListenerDef => DEFS.get(id) ?? { id, label: id, kind: 'mic', side: 'page', about: '' };
export const listenerLabel = (id: string): string => listenerDef(id).label;
/** Ids that may hold the microphone, highest priority first: the one the person is talking to wins. */
export const MIC_PRIORITY: readonly string[] = ['talk', 'speak', 'voice-command', 'dictation', 'notes', 'agent-voice', 'oneshot', 'handsfree', 'browser-handsfree', 'recorder-mic'];

/** Of the listeners asking for the microphone, the one that gets it (null for none). Unknown ids rank last. */
export function micWinner(asking: readonly string[]): string | null {
  const rank = (id: string) => { const i = MIC_PRIORITY.indexOf(id); return i < 0 ? MIC_PRIORITY.length : i; };
  const ids = asking.filter((x, i, a) => x && a.indexOf(x) === i);
  if (!ids.length) return null;
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0]!;
}

/* ---------------------------------------------------------------- policy */

export interface ListenerPolicy {
  /** may this listener run at all */
  on: boolean;
  /** let go of the microphone while the phone is ringing or in a call (phone or VoIP) */
  pauseOnCall: boolean;
  /** let go while another app records or takes audio focus */
  pauseForOtherApps: boolean;
  /** play the start sound (the recognizer's tone) for a start the person asked for */
  sound: boolean;
  /** quick ends in a row before it gives up; -1 = never give up (keeps backing off to the cap) */
  retries: number;
  /** first wait after a quick end (ms); doubles each time */
  backoffMs: number;
  /** the longest wait between restarts (ms) */
  maxBackoffMs: number;
  /** after giving up: wait this long, then try once more from the start */
  cooldownMs: number;
}

export const POLICY_DEFAULTS: ListenerPolicy = { on: true, pauseOnCall: true, pauseForOtherApps: true, sound: false, retries: 6, backoffMs: 1000, maxBackoffMs: 30_000, cooldownMs: 60_000 };
export const POLICY_FIELDS = Object.keys(POLICY_DEFAULTS) as (keyof ListenerPolicy)[];
/** The restart limits the panel offers. */
export const RETRY_CHOICES: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Never restart' }, { value: 3, label: '3 tries' }, { value: 6, label: '6 tries' }, { value: 10, label: '10 tries' }, { value: -1, label: 'Keep trying (backs off)' },
];
/** A listener session shorter than this (ms) ended at once: something refused it. */
export const QUICK_END_MS = 1500;
/** The pause before an ordinary restart (a turn that ran its course). */
export const RESTART_MS = 250;
/** How long the microphone must stay free before a yielded listener comes back (per reason). */
export const RESUME_AFTER_MS: Record<string, number> = { call: 3000, 'other-app': 3000, 'mic-off': 0 };
/** A device document older than this is a phone that stopped reporting. */
export const DEVICE_STALE_MS = 10 * 60_000;

export const SETTINGS_PREFIX = 'amberx.listeners';
/** The app setting keys that hold a listener's policy (synced to every device through axHub). */
export function policyKeys(id: string): Record<keyof ListenerPolicy, string> {
  const out = {} as Record<keyof ListenerPolicy, string>;
  for (const f of POLICY_FIELDS) out[f] = `${SETTINGS_PREFIX}.${id}.${f}`;
  return out;
}
/** `amberx.listeners.<id>.<field>` → { id, field }, or null for any other key. */
export function parsePolicyKey(key: string): { id: string; field: keyof ListenerPolicy } | null {
  const m = new RegExp(`^${SETTINGS_PREFIX.replace(/\./g, '\\.')}\\.([a-z0-9-]+)\\.([a-zA-Z]+)$`).exec(key);
  if (!m || !POLICY_FIELDS.includes(m[2] as keyof ListenerPolicy)) return null;
  return { id: m[1]!, field: m[2] as keyof ListenerPolicy };
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : typeof v === 'string' && (v === 'true' || v === 'false') ? v === 'true' : d);
const int = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : d;
};

/** A policy with every field valid; missing or bad fields take the listener's defaults. */
export function normalizePolicy(raw: Partial<Record<keyof ListenerPolicy, unknown>> | null | undefined, id = ''): ListenerPolicy {
  const d = { ...POLICY_DEFAULTS, ...(listenerDef(id).defaults ?? {}) };
  const r = raw ?? {};
  return {
    on: bool(r.on, d.on),
    pauseOnCall: bool(r.pauseOnCall, d.pauseOnCall),
    pauseForOtherApps: bool(r.pauseForOtherApps, d.pauseForOtherApps),
    sound: bool(r.sound, d.sound),
    retries: int(r.retries, d.retries, -1, 100),
    backoffMs: int(r.backoffMs, d.backoffMs, 100, 600_000),
    maxBackoffMs: Math.max(int(r.maxBackoffMs, d.maxBackoffMs, 100, 3_600_000), int(r.backoffMs, d.backoffMs, 100, 600_000)),
    cooldownMs: int(r.cooldownMs, d.cooldownMs, 0, 86_400_000),
  };
}

/** The policy of a listener from a settings getter (`rt.settings.get`). */
export function policyFrom(get: (key: string) => unknown, id: string): ListenerPolicy {
  const keys = policyKeys(id);
  const raw: Partial<Record<keyof ListenerPolicy, unknown>> = {};
  for (const f of POLICY_FIELDS) { const v = get(keys[f]); if (v !== undefined && v !== null && v !== '') raw[f] = v; }
  return normalizePolicy(raw, id);
}

/** Every known listener's policy from a settings getter. */
export function policiesFrom(get: (key: string) => unknown): Record<string, ListenerPolicy> {
  const out: Record<string, ListenerPolicy> = {};
  for (const d of LISTENERS) out[d.id] = policyFrom(get, d.id);
  return out;
}

/** The fields a listener's panel shows (a poll has no mic fields; the one-shot has no switch of its own). */
export function policyFieldsFor(id: string): (keyof ListenerPolicy)[] {
  const w = new Set(listenerDef(id).without ?? []);
  return (['on', 'pauseOnCall', 'pauseForOtherApps', 'sound', 'retries'] as (keyof ListenerPolicy)[]).filter((f) => !w.has(f));
}

/** Settings-group entries (the app's settings registry) for a listener, so its policy is declared and synced. */
export function policySettings(id: string): { key: string; label: string; kind: 'toggle' | 'choice'; default: boolean | number; options?: { value: number; label: string }[]; description?: string }[] {
  const keys = policyKeys(id);
  const d = normalizePolicy(null, id);
  const out: ReturnType<typeof policySettings> = [];
  for (const f of policyFieldsFor(id)) {
    if (f === 'on') out.push({ key: keys.on, label: `${listenerLabel(id)}: allowed`, kind: 'toggle', default: d.on });
    else if (f === 'pauseOnCall') out.push({ key: keys.pauseOnCall, label: `${listenerLabel(id)}: pause for calls`, kind: 'toggle', default: d.pauseOnCall });
    else if (f === 'pauseForOtherApps') out.push({ key: keys.pauseForOtherApps, label: `${listenerLabel(id)}: pause for other apps`, kind: 'toggle', default: d.pauseForOtherApps });
    else if (f === 'sound') out.push({ key: keys.sound, label: `${listenerLabel(id)}: start sound`, kind: 'toggle', default: d.sound, description: 'Only for a start you asked for; restarts and resumes are always silent.' });
    else if (f === 'retries') out.push({ key: keys.retries, label: `${listenerLabel(id)}: restarts before it gives up`, kind: 'choice', default: d.retries, options: RETRY_CHOICES.map((c) => ({ value: c.value, label: c.label })) });
  }
  return out;
}

/* ---------------------------------------------------------------- restarts */

/**
 * The wait before restart number `attempt` (1 = the first restart after a quick end), or null = give up. `attempt` 0 is
 * the first start: no wait. The wait doubles from `backoffMs` up to `maxBackoffMs`; past `retries` it is null unless
 * retries is -1 (keep trying at the cap).
 */
export function restartDelay(attempt: number, policy: Partial<ListenerPolicy> = {}): number | null {
  const p = normalizePolicy(policy);
  if (attempt <= 0) return 0;
  if (p.retries >= 0 && attempt > p.retries) return null;
  return Math.min(p.maxBackoffMs, p.backoffMs * 2 ** Math.min(attempt - 1, 30));
}

export const isQuickEnd = (ranMs: number, quickMs = QUICK_END_MS): boolean => ranMs < quickMs;

export interface EndPlan {
  /** quick ends in a row after this one */
  attempts: number;
  /** wait before the next start (ms), or null = stop in state error */
  delay: number | null;
  /** true when this end made it give up */
  gaveUp: boolean;
  /** when it gave up: try again cold after this long (0 = never) */
  cooldownMs: number;
}

/**
 * What to do when a listener session ends: a session that ran for a while is healthy (restart after {@link RESTART_MS},
 * counter reset); a quick end counts and backs off; a `fatal` end (no permission, no microphone, no recognizer) never
 * restarts. The caller keeps `attempts` between calls.
 */
export function afterEnd(attempts: number, ranMs: number, policy: Partial<ListenerPolicy> = {}, opts: { fatal?: boolean; quickMs?: number } = {}): EndPlan {
  const p = normalizePolicy(policy);
  if (opts.fatal) return { attempts: attempts + 1, delay: null, gaveUp: true, cooldownMs: 0 };
  if (!isQuickEnd(ranMs, opts.quickMs)) return { attempts: 0, delay: RESTART_MS, gaveUp: false, cooldownMs: 0 };
  const next = attempts + 1;
  const delay = restartDelay(next, p);
  return { attempts: next, delay, gaveUp: delay === null, cooldownMs: delay === null ? p.cooldownMs : 0 };
}

/* ---------------------------------------------------------------- sound */

export type StartReason = 'user' | 'restart' | 'resume' | 'auto';
/** Play the start sound? Only when the listener has one switched on AND the person started it; never for a restart,
 * a resume after a call, or an automatic start (reopening the app, a reboot, a settings change). */
export function startSound(policy: Partial<ListenerPolicy> | null | undefined, reason: StartReason): boolean {
  return normalizePolicy(policy ?? {}).sound && reason === 'user';
}

/* ---------------------------------------------------------------- yield (letting go of the microphone) */

export type YieldReason = 'mic-off' | 'call' | 'other-app';
export interface MicScene {
  /** the Mic off switch */
  micOff?: boolean;
  /** the phone is ringing, in a call or in a VoIP session */
  call?: boolean;
  /** Android is handing AmberX's own recording silence (someone with priority has the mic) */
  silenced?: boolean;
  /** another app records */
  otherApp?: boolean;
  /** another app took audio focus */
  focusLost?: boolean;
}

/** Why a listener must let go of the microphone now, or null = it may listen. Mic off always wins; the rest follow the
 * listener's policy. Silence from Android is treated as another app whatever the policy (there is nothing to hear). */
export function yieldReason(scene: MicScene, policy: Partial<ListenerPolicy> = {}): YieldReason | null {
  const p = normalizePolicy(policy);
  if (scene.micOff) return 'mic-off';
  if (scene.call && p.pauseOnCall) return 'call';
  if (scene.silenced) return 'other-app';
  if ((scene.otherApp || scene.focusLost) && p.pauseForOtherApps) return 'other-app';
  return null;
}

/** How long the microphone must stay free before a listener yielded for `reason` comes back. */
export const resumeAfterMs = (reason: YieldReason | string | null): number => (reason ? RESUME_AFTER_MS[reason] ?? 3000 : 0);

/** May a yielded listener come back? `freeSince` = when the mic became free (-1 = not free). */
export const mayResume = (reason: YieldReason | string | null, freeSince: number, now: number): boolean => freeSince >= 0 && now - freeSince >= resumeAfterMs(reason);

/** The words people see for a yield reason. */
export function yieldLabel(reason: YieldReason | string | null): string {
  switch (reason) {
    case null: case '': return 'Listening';
    case 'mic-off': return 'Mic off';
    case 'call': return 'Paused: a call is using the microphone';
    case 'other-app': case 'silenced': return 'Paused: another app is using the microphone';
    default: return 'Paused';
  }
}

/* ---------------------------------------------------------------- state (what a row shows) */

export interface ListenerInfo {
  id: string;
  label: string;
  kind: ListenerKind;
  side: ListenerSide;
  state: ListenerState;
  /** one line of detail: the yield reason, the phase, the error */
  detail: string;
  /** since when (ms) it has been in this state; 0 = unknown */
  since: number;
  lastError: string | null;
  lastErrorAt: number;
  /** quick restarts in a row right now */
  attempts: number;
  holdsMic: boolean;
  policy: ListenerPolicy;
}

export const STATES: readonly ListenerState[] = ['off', 'starting', 'on', 'paused', 'yielded', 'error', 'unavailable'];

/** A listener row with every field present (an unknown or partial report still shows). */
export function normalizeInfo(raw: Partial<ListenerInfo> & { id: string }, get?: (key: string) => unknown): ListenerInfo {
  const def = listenerDef(raw.id);
  const state = STATES.includes(raw.state as ListenerState) ? (raw.state as ListenerState) : 'off';
  return {
    id: raw.id,
    label: typeof raw.label === 'string' && raw.label ? raw.label : def.label,
    kind: raw.kind === 'mic' || raw.kind === 'poll' || raw.kind === 'sound' ? raw.kind : def.kind,
    side: raw.side === 'native' || raw.side === 'page' ? raw.side : def.side,
    state,
    detail: typeof raw.detail === 'string' ? raw.detail.slice(0, 200) : '',
    since: typeof raw.since === 'number' && Number.isFinite(raw.since) ? raw.since : 0,
    lastError: typeof raw.lastError === 'string' && raw.lastError ? raw.lastError.slice(0, 300) : null,
    lastErrorAt: typeof raw.lastErrorAt === 'number' && Number.isFinite(raw.lastErrorAt) ? raw.lastErrorAt : 0,
    attempts: typeof raw.attempts === 'number' && raw.attempts >= 0 ? Math.round(raw.attempts) : 0,
    holdsMic: raw.holdsMic === true,
    policy: raw.policy ? normalizePolicy(raw.policy, raw.id) : get ? policyFrom(get, raw.id) : normalizePolicy(null, raw.id),
  };
}

/** The chip words for a state. */
export function stateLabel(l: Pick<ListenerInfo, 'state' | 'detail' | 'policy'>): string {
  switch (l.state) {
    case 'off': return l.policy.on ? 'Off' : 'Not allowed';
    case 'starting': return 'Starting…';
    case 'on': return l.detail || 'Listening';
    case 'paused': return l.detail ? `Paused: ${l.detail}` : 'Paused';
    case 'yielded': return yieldLabel(l.detail || 'other-app');
    case 'error': return l.detail ? `Stopped: ${l.detail}` : 'Stopped after errors';
    case 'unavailable': return l.detail || 'Not available here';
  }
}

export function stateTone(state: ListenerState): 'accent' | 'success' | 'warning' | 'danger' {
  switch (state) {
    case 'on': return 'success';
    case 'paused': case 'yielded': case 'starting': return 'warning';
    case 'error': return 'danger';
    default: return 'accent';
  }
}

/* ---------------------------------------------------------------- the device document (listener-state@1) */

export const STATE_FORMAT = 'listener-state@1';
export const HUB = { project: 'amberx-axf', folder: 'listeners', table: 'devices' } as const;

export interface DeviceListeners {
  $axf: typeof STATE_FORMAT;
  /** a stable id per installed app (the phone's AXPP device id when it has one) */
  device: string;
  /** "Samsung SM-S938B", "Chrome on Windows" */
  name: string;
  app: string;
  /** when this was written (ms) */
  at: number;
  /** native app (Android shell) or a browser tab */
  side: ListenerSide;
  micOff: boolean;
  /** who holds the microphone right now (a listener id), or null */
  micHolder: string | null;
  listeners: ListenerInfo[];
}

/** The document a device publishes: rows sorted by the registry's order, unknown ones after. */
export function deviceDoc(d: Omit<DeviceListeners, '$axf' | 'listeners'> & { listeners: (Partial<ListenerInfo> & { id: string })[] }, get?: (key: string) => unknown): DeviceListeners {
  const order = new Map(LISTENERS.map((x, i) => [x.id, i]));
  const rows = d.listeners.map((l) => normalizeInfo(l, get)).sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || a.id.localeCompare(b.id));
  return { $axf: STATE_FORMAT, device: d.device, name: d.name, app: d.app, at: d.at, side: d.side, micOff: d.micOff, micHolder: d.micHolder, listeners: rows };
}

/** A device whose last report is older than {@link DEVICE_STALE_MS}. */
export const staleDevice = (doc: Pick<DeviceListeners, 'at'>, now: number, staleMs = DEVICE_STALE_MS): boolean => now - doc.at > staleMs;

/** Devices newest first, each marked stale or live; anything that isn't a listener-state@1 document is dropped. */
export function mergeDevices(docs: unknown[], now: number): (DeviceListeners & { stale: boolean })[] {
  const out: (DeviceListeners & { stale: boolean })[] = [];
  for (const raw of docs) {
    const d = raw as Partial<DeviceListeners>;
    if (!d || d.$axf !== STATE_FORMAT || typeof d.device !== 'string' || !Array.isArray(d.listeners) || typeof d.at !== 'number') continue;
    out.push({ ...deviceDoc({ device: d.device, name: typeof d.name === 'string' ? d.name : d.device, app: typeof d.app === 'string' ? d.app : 'amberx-droid', at: d.at, side: d.side === 'native' ? 'native' : 'page', micOff: d.micOff === true, micHolder: typeof d.micHolder === 'string' ? d.micHolder : null, listeners: d.listeners.filter((l): l is ListenerInfo => !!l && typeof (l as ListenerInfo).id === 'string') }), stale: staleDevice(d as DeviceListeners, now) });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** One line for a device: "3 listening · 1 paused · mic: Gizmo talk mode". */
export function deviceSummary(d: Pick<DeviceListeners, 'listeners' | 'micHolder' | 'micOff'>): string {
  const n = (s: ListenerState) => d.listeners.filter((l) => l.state === s).length;
  const parts: string[] = [];
  if (d.micOff) parts.push('Mic off');
  if (n('on')) parts.push(`${n('on')} listening`);
  if (n('yielded') + n('paused')) parts.push(`${n('yielded') + n('paused')} paused`);
  if (n('error')) parts.push(`${n('error')} stopped on errors`);
  if (!n('on') && !n('yielded') && !n('paused') && !n('error')) parts.push('nothing listening');
  if (d.micHolder) parts.push(`mic: ${listenerLabel(d.micHolder)}`);
  return parts.join(' · ');
}
