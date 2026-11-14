/**
 * Wake listener core (wake-listener@1; build console-app-wake-word-voice-listener, Nov 13 2026, Fable). Pure: the
 * settings (wake phrases Brett sets, the off switch, the engine), the wake-phrase matcher and the listener's state
 * machine, shared by the console page (web/engine.ts), the plugin server (through listener.mjs), the CLI and the tests.
 *
 * Brett: "set a listener in the console Android app; say a trigger and approve, it lists everything needing approval
 * one at a time and I say approve or deny, or approve all pending".
 *
 * Phases: off (switch off) → idle (the engine runs, waiting for a wake phrase) → awake (heard the wake phrase, the next
 * utterance is a command; closes after `awakeSec`) → wizard (a spoken wizard or the approvals review has the floor:
 * every utterance goes to it, no wake phrase needed, until it ends). A phrase that carries the command after the wake
 * word ("hey console, approve") runs it at once.
 */

export const FRAME = 'wake-listener@1';
export const FOLDER = 'wake-listener';
export const ENGINES = ['auto', 'native', 'webspeech', 'off'];
export const PHASES = ['off', 'idle', 'awake', 'wizard'];
export const MAX_PHRASES = 12;
export const DEFAULT_PHRASES = ['hey console', 'amber'];

export const DEFAULTS = Object.freeze({
  on: true,
  phrases: DEFAULT_PHRASES,
  engine: 'auto',
  /** seconds the listener stays awake for a command after the wake phrase alone */
  awakeSec: 8,
  /** seconds a wizard waits for an answer before it gives up */
  answerSec: 20,
  /** the console speaks its replies (through the agent voice when it is there, else the device voice) */
  speak: true,
  /** a short tone when the wake phrase is heard */
  chime: true,
  /** the mic-on indicator on the banner: always (grey when off) or only while listening */
  indicator: 'always',
  /** pause while the page is hidden (another app in front on the phone) */
  pauseHidden: false,
  /** Claude mode: understand commands with Claude while Claude is connected (off = scripted only, nothing is sent to Claude) */
  useClaude: true,
  /** seconds Claude mode waits for Claude before the scripted matcher takes the command */
  claudeTimeoutSec: 8,
});

/** The console-wide setting keys (Settings → Plugins → Wake listener, console-control addresses) → the store's keys. */
export const SETTING_KEYS = Object.freeze({ 'axf.voice.useClaude': 'useClaude', 'axf.voice.claudeTimeoutSec': 'claudeTimeoutSec' });
export const CLAUDE_TIMEOUT_MIN = 2;
export const CLAUDE_TIMEOUT_MAX = 30;

export class ListenerError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const bool = (v, d) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : d);
const int = (v, d, min, max) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : d; };

/** Lower case, letters, digits and single spaces only ("Hey, Console!" → "hey console"). */
export function normalizePhrase(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
}

/** The wake phrases, cleaned: a list or a comma / newline separated string; empty and repeated ones dropped. */
export function normalizePhrases(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n;]+/) : [];
  const out = [];
  for (const p of list) {
    const n = normalizePhrase(p);
    if (n && n.length <= 40 && !out.includes(n)) out.push(n);
    if (out.length >= MAX_PHRASES) break;
  }
  return out;
}

/** Settings as stored and sent (unknown fields dropped, every value clamped). */
export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const phrases = normalizePhrases(r.phrases ?? r.wakePhrases);
  return {
    on: bool(r.on, DEFAULTS.on),
    phrases: phrases.length ? phrases : [...DEFAULT_PHRASES],
    engine: ENGINES.includes(r.engine) ? r.engine : DEFAULTS.engine,
    awakeSec: int(r.awakeSec, DEFAULTS.awakeSec, 3, 60),
    answerSec: int(r.answerSec, DEFAULTS.answerSec, 5, 120),
    speak: bool(r.speak, DEFAULTS.speak),
    chime: bool(r.chime, DEFAULTS.chime),
    indicator: r.indicator === 'listening' || r.indicator === 'never' ? r.indicator : DEFAULTS.indicator,
    pauseHidden: bool(r.pauseHidden, DEFAULTS.pauseHidden),
    useClaude: bool(r.useClaude, DEFAULTS.useClaude),
    claudeTimeoutSec: int(r.claudeTimeoutSec, DEFAULTS.claudeTimeoutSec, CLAUDE_TIMEOUT_MIN, CLAUDE_TIMEOUT_MAX),
  };
}

/** A settings patch from the API / CLI (`key=value` pairs or an object): only known keys, phrases may be add:/remove:. */
export function applyPatch(settings, patch) {
  const s = normalizeSettings(settings);
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = { ...s };
  for (const [key, v] of Object.entries(p)) {
    const k = SETTING_KEYS[key] ?? key;
    if (k === 'addPhrase') next.phrases = normalizePhrases([...s.phrases, ...normalizePhrases(v)]);
    else if (k === 'removePhrase') { const drop = normalizePhrases(v); next.phrases = s.phrases.filter((x) => !drop.includes(x)); }
    else if (k in DEFAULTS) next[k] = v;
    else throw new ListenerError('invalid', `unknown setting ${key} (${Object.keys(DEFAULTS).join(', ')}, addPhrase, removePhrase)`);
  }
  return normalizeSettings(next);
}

/* ------------------------------------------------------------------ Claude mode */

/** Approve / deny / veto words: never sent to Claude (server/claude_tools.py APPROVAL_WORDS is the same list). */
export const APPROVAL_WORDS = /\b(approve|approval|approvals|deny|denied|decline|reject|veto)\b/i;

/**
 * Does this command go to Claude first? → { claude: true } or { claude: false, reason }. Off = never (nothing is sent
 * to Claude, Brett: "OFF = always scripted/offline even while Claude is connected"); approve / deny words = never.
 */
export function claudeGate(settings, text) {
  const s = normalizeSettings(settings);
  if (!s.useClaude) return { claude: false, reason: 'off' };
  if (APPROVAL_WORDS.test(String(text ?? ''))) return { claude: false, reason: 'approvals' };
  return { claude: true, reason: '' };
}

/* ------------------------------------------------------------------ the wake phrase */

const LEAD = /^(?:(?:hey|hi|ok|okay|yo|hello)\s+)?/;

/**
 * Does `text` start with one of the wake phrases? → { wake: the phrase heard, rest: what came after it (a command, or
 * '') } or null. "hey" / "ok" before the phrase is fine; the longest phrase wins; a phrase must end at a word boundary.
 */
export function matchWake(text, phrases) {
  const t = normalizePhrase(text);
  if (!t) return null;
  // the phrase as said, or after a lead-in word ("hey amber" for the phrase "amber"; "hey console" stays whole)
  const bodies = [t, t.replace(LEAD, '')];
  let best = null;
  for (const body of bodies) {
    for (const p of normalizePhrases(phrases)) {
      if (body === p || body.startsWith(`${p} `)) { if (!best || p.length > best.wake.length) best = { wake: p, rest: body.slice(p.length).trim() }; }
    }
  }
  return best;
}

/** Is `text` only a wake phrase (no command after it)? */
export const isBareWake = (text, phrases) => { const m = matchWake(text, phrases); return !!m && !m.rest; };

/* ------------------------------------------------------------------ engines */

/**
 * Which engine runs: native (the console Android app's on-device recognizer through the native bridge, listener.* tools),
 * webspeech (the browser's recognizer), or none (nothing available here, or the setting says off).
 */
export function pickEngine(setting, have) {
  const h = have ?? {};
  if (setting === 'off') return 'none';
  if (setting === 'native') return h.native ? 'native' : 'none';
  if (setting === 'webspeech') return h.webspeech ? 'webspeech' : 'none';
  return h.native ? 'native' : h.webspeech ? 'webspeech' : 'none';
}

export const ENGINE_LABEL = { native: 'on-device (console app)', webspeech: 'browser recognizer', none: 'no recognizer here' };

/* ------------------------------------------------------------------ the state machine */

/** A fresh listener state (listener-state shape, what GET /state and the banner light show). */
export function initialState(settings, now = Date.now()) {
  const s = normalizeSettings(settings);
  return { $axf: FRAME, on: s.on, phase: s.on ? 'idle' : 'off', engine: 'none', listening: false, micOpen: false, awakeUntil: 0, lastHeard: '', lastHeardAt: 0, lastWake: '', lastWakeAt: 0, lastCommand: '', lastReply: '', error: '', updatedAt: now };
}

/**
 * One utterance against the state → { state, event }. Events: 'ignored' (asleep, no wake phrase), 'wake' (the wake
 * phrase alone: now awake), 'command' (text to run, `command`), 'wizard' (text for the wizard, `command`).
 * The caller runs the command; `awake(…)`, `wizardOn/Off(…)` move the phase.
 */
export function hear(state, settings, text, now = Date.now()) {
  const s = normalizeSettings(settings);
  const heard = normalizePhrase(text);
  const base = { ...state, lastHeard: heard, lastHeardAt: now, updatedAt: now };
  if (!heard || state.phase === 'off') return { state: base, event: 'ignored' };
  const m = matchWake(heard, s.phrases);
  if (state.phase === 'wizard') {
    // the wizard has the floor; a wake phrase in front is fine ("amber, yes")
    const cmd = m ? m.rest : heard;
    return cmd ? { state: { ...base, lastCommand: cmd }, event: 'wizard', command: cmd } : { state: base, event: 'ignored' };
  }
  if (m) {
    const woke = { ...base, lastWake: m.wake, lastWakeAt: now };
    if (m.rest) return { state: { ...woke, phase: 'idle', awakeUntil: 0, lastCommand: m.rest }, event: 'command', command: m.rest };
    return { state: { ...woke, phase: 'awake', awakeUntil: now + s.awakeSec * 1000 }, event: 'wake' };
  }
  if (state.phase === 'awake' && now <= state.awakeUntil) return { state: { ...base, phase: 'idle', awakeUntil: 0, lastCommand: heard }, event: 'command', command: heard };
  return { state: { ...base, ...(state.phase === 'awake' ? { phase: 'idle', awakeUntil: 0 } : {}) }, event: 'ignored' };
}

/** The awake window ran out with no command. */
export function sleep(state, now = Date.now()) {
  return state.phase === 'awake' && now > state.awakeUntil ? { ...state, phase: 'idle', awakeUntil: 0, updatedAt: now } : state;
}
export const wizardOn = (state, now = Date.now()) => (state.phase === 'off' ? state : { ...state, phase: 'wizard', awakeUntil: 0, updatedAt: now });
export const wizardOff = (state, now = Date.now()) => (state.phase === 'wizard' ? { ...state, phase: 'idle', updatedAt: now } : state);
export const switched = (state, on, now = Date.now()) => ({ ...state, on, phase: on ? (state.phase === 'off' ? 'idle' : state.phase) : 'off', awakeUntil: 0, listening: on && state.listening, micOpen: on && state.micOpen, updatedAt: now });

/** The banner light: label and tone for a state. */
export function light(state) {
  if (!state || !state.on || state.phase === 'off') return { label: 'Mic off', tone: 'neutral', lit: false };
  if (state.error) return { label: `Listener: ${state.error}`, tone: 'danger', lit: true };
  if (!state.listening) return { label: 'Listener starting', tone: 'neutral', lit: false };
  if (state.phase === 'wizard') return { label: 'Listening: your answer', tone: 'accent', lit: true };
  if (state.phase === 'awake') return { label: 'Listening: say a command', tone: 'warning', lit: true };
  return { label: `Mic on: say "${state.lastWake || ''}"`.replace(': say ""', ''), tone: 'success', lit: true };
}

/** One line for the CLI and the settings page. */
export function stateLine(state, settings) {
  const s = normalizeSettings(settings);
  if (!state.on) return 'Wake listener off (switch).';
  const l = light(state);
  return `${l.label} · engine ${ENGINE_LABEL[state.engine] ?? state.engine} · wake phrases: ${s.phrases.map((p) => `"${p}"`).join(', ')}${state.lastHeard ? ` · last heard "${state.lastHeard}"` : ''}`;
}
