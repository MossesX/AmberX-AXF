/**
 * Agent voice — the pure core (agent-voice@1, Oct 29 2026, Brett: "give agents the ability to speak with a full
 * powerful per agent configuration console … all the bells and whistles a narrator should have").
 *
 * No React, no DOM, no runtime: the console view, the speech engines and the server all hold to these shapes, and the
 * self-test (`test.mts`) replays them. Everything is normalised on the way in, so a hand-edited or older profile never
 * crashes anything: unknown fields are dropped, out-of-range numbers are clamped, missing parts get defaults.
 *
 *  - VoiceProfile: one per agent (engine, device + cloud voice, rate/pitch/volume, narrator rules, permissions).
 *  - MicSettings: one for the whole app (how the Assistant microphone listens and how it shares the microphone).
 *  - narrate(): text → spoken chunks (markdown, code, links, numbers, emoji, pronunciations, pauses, read modes).
 *  - micGate(): may the Assistant microphone start right now, and if not, exactly why (the tooltip text).
 */

export const SCHEMA = 'agent-voice@1';

/* ---------------------------------------------------------------- small helpers */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200, d = ''): string => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
export const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const pick = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);

/* ---------------------------------------------------------------- the voice profile */

export const ENGINES = ['device', 'cloud'] as const;
export type Engine = (typeof ENGINES)[number];
export const CLOUD_PROVIDERS = ['openai', 'elevenlabs'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export const READ_MODES = ['full', 'summary', 'first'] as const;
export type ReadMode = (typeof READ_MODES)[number];
export const CODE_MODES = ['skip', 'mention', 'read'] as const;
export const URL_MODES = ['domain', 'mention', 'skip', 'read'] as const;
export const NUMBER_MODES = ['natural', 'digits'] as const;
export const EMOJI_MODES = ['skip', 'keep'] as const;
export const AUTO_SPEAK = ['off', 'replies', 'voice-only'] as const;
export type AutoSpeak = (typeof AUTO_SPEAK)[number];
export const INTERRUPT = ['barge-in', 'queue', 'replace'] as const;
export type Interrupt = (typeof INTERRUPT)[number];

export interface Pronunciation { from: string; to: string; whole: boolean; caseSensitive: boolean }

export interface Narrator {
  readMode: ReadMode;
  /** summary/first: how many sentences are read */
  sentences: number;
  /** hard cap on characters spoken per reply (the rest is announced, not read) */
  maxChars: number;
  code: (typeof CODE_MODES)[number];
  urls: (typeof URL_MODES)[number];
  numbers: (typeof NUMBER_MODES)[number];
  emoji: (typeof EMOJI_MODES)[number];
  /** spoken before the reply; {name} = the agent's name. Empty = nothing */
  intro: string;
  outro: string;
  /** pause after a sentence / a paragraph / a list item, ms */
  sentencePause: number;
  paragraphPause: number;
  listPause: number;
  /** **bold** and headings are read a touch slower */
  emphasis: boolean;
  /** headings are announced ("Section: …") */
  headings: boolean;
  /** list items are numbered out loud ("one, …") */
  numberLists: boolean;
  /** a short tone before speaking (device engines play it locally) */
  chime: boolean;
}

export interface Permissions {
  /** the agent may speak out loud */
  speak: boolean;
  /** the agent may be talked to through the microphone */
  listen: boolean;
  /** what was heard is sent at once (otherwise it waits in the composer) */
  autoSend: boolean;
  /** "Talk to <name>" becomes a voice command / action */
  wakeName: boolean;
  /** cloud voices may be used (sends the reply text to the voice provider) */
  cloud: boolean;
}

export interface VoiceProfile {
  $axf: typeof SCHEMA;
  agentId: string;
  /** the agent is a voice agent (lights the live status light when selected) */
  enabled: boolean;
  engine: Engine;
  /** fall back to the device voice when the cloud voice fails */
  fallback: boolean;
  device: { voice: string; lang: string };
  cloud: { provider: CloudProvider; voice: string; model: string; style: string; stability: number; similarity: number };
  rate: number;
  pitch: number;
  volume: number;
  autoSpeak: AutoSpeak;
  interrupt: Interrupt;
  /** after the agent finishes speaking, open the microphone again (hands-free conversation) */
  conversation: boolean;
  narrator: Narrator;
  pronunciations: Pronunciation[];
  permissions: Permissions;
  updatedAt: string;
}

export const DEFAULT_NARRATOR: Narrator = {
  readMode: 'full', sentences: 3, maxChars: 2400, code: 'mention', urls: 'domain', numbers: 'natural', emoji: 'skip',
  intro: '', outro: '', sentencePause: 250, paragraphPause: 600, listPause: 350, emphasis: true, headings: true, numberLists: false, chime: false,
};
export const DEFAULT_PERMISSIONS: Permissions = { speak: true, listen: false, autoSend: true, wakeName: true, cloud: false };

export function defaultProfile(agentId: string): VoiceProfile {
  return {
    $axf: SCHEMA, agentId, enabled: false, engine: 'device', fallback: true,
    device: { voice: '', lang: 'en-US' },
    cloud: { provider: 'openai', voice: 'alloy', model: 'gpt-4o-mini-tts', style: '', stability: 0.5, similarity: 0.75 },
    rate: 1, pitch: 1, volume: 1, autoSpeak: 'replies', interrupt: 'barge-in', conversation: false,
    narrator: { ...DEFAULT_NARRATOR }, pronunciations: [], permissions: { ...DEFAULT_PERMISSIONS }, updatedAt: '',
  };
}

export const MAX_PRONUNCIATIONS = 200;
export const MAX_AGENT_ID = 80;

export function normPronunciation(v: unknown): Pronunciation | null {
  if (!isObj(v)) return null;
  const from = str(v.from, 80).trim();
  if (!from) return null;
  return { from, to: str(v.to, 160), whole: bool(v.whole, true), caseSensitive: bool(v.caseSensitive, false) };
}

export function normProfile(v: unknown, agentId?: string): VoiceProfile {
  const o = isObj(v) ? v : {};
  const id = str(agentId ?? o.agentId, MAX_AGENT_ID).trim();
  const d = defaultProfile(id);
  const dev = isObj(o.device) ? o.device : {};
  const cl = isObj(o.cloud) ? o.cloud : {};
  const n = isObj(o.narrator) ? o.narrator : {};
  const p = isObj(o.permissions) ? o.permissions : {};
  return {
    $axf: SCHEMA, agentId: id,
    enabled: bool(o.enabled, d.enabled),
    engine: pick(o.engine, ENGINES, d.engine),
    fallback: bool(o.fallback, d.fallback),
    device: { voice: str(dev.voice, 200), lang: str(dev.lang, 20) || d.device.lang },
    cloud: {
      provider: pick(cl.provider, CLOUD_PROVIDERS, d.cloud.provider),
      voice: str(cl.voice, 120) || d.cloud.voice,
      model: str(cl.model, 80) || d.cloud.model,
      style: str(cl.style, 600),
      stability: clamp(cl.stability, 0, 1, d.cloud.stability),
      similarity: clamp(cl.similarity, 0, 1, d.cloud.similarity),
    },
    rate: clamp(o.rate, 0.5, 2, 1),
    pitch: clamp(o.pitch, 0.5, 2, 1),
    volume: clamp(o.volume, 0, 1, 1),
    autoSpeak: pick(o.autoSpeak, AUTO_SPEAK, d.autoSpeak),
    interrupt: pick(o.interrupt, INTERRUPT, d.interrupt),
    conversation: bool(o.conversation, false),
    narrator: {
      readMode: pick(n.readMode, READ_MODES, DEFAULT_NARRATOR.readMode),
      sentences: Math.round(clamp(n.sentences, 1, 20, DEFAULT_NARRATOR.sentences)),
      maxChars: Math.round(clamp(n.maxChars, 100, 20000, DEFAULT_NARRATOR.maxChars)),
      code: pick(n.code, CODE_MODES, DEFAULT_NARRATOR.code),
      urls: pick(n.urls, URL_MODES, DEFAULT_NARRATOR.urls),
      numbers: pick(n.numbers, NUMBER_MODES, DEFAULT_NARRATOR.numbers),
      emoji: pick(n.emoji, EMOJI_MODES, DEFAULT_NARRATOR.emoji),
      intro: str(n.intro, 200), outro: str(n.outro, 200),
      sentencePause: Math.round(clamp(n.sentencePause, 0, 3000, DEFAULT_NARRATOR.sentencePause)),
      paragraphPause: Math.round(clamp(n.paragraphPause, 0, 5000, DEFAULT_NARRATOR.paragraphPause)),
      listPause: Math.round(clamp(n.listPause, 0, 3000, DEFAULT_NARRATOR.listPause)),
      emphasis: bool(n.emphasis, DEFAULT_NARRATOR.emphasis),
      headings: bool(n.headings, DEFAULT_NARRATOR.headings),
      numberLists: bool(n.numberLists, DEFAULT_NARRATOR.numberLists),
      chime: bool(n.chime, DEFAULT_NARRATOR.chime),
    },
    pronunciations: (Array.isArray(o.pronunciations) ? o.pronunciations : []).map(normPronunciation).filter((x): x is Pronunciation => !!x).slice(0, MAX_PRONUNCIATIONS),
    permissions: {
      speak: bool(p.speak, DEFAULT_PERMISSIONS.speak), listen: bool(p.listen, DEFAULT_PERMISSIONS.listen),
      autoSend: bool(p.autoSend, DEFAULT_PERMISSIONS.autoSend), wakeName: bool(p.wakeName, DEFAULT_PERMISSIONS.wakeName),
      cloud: bool(p.cloud, DEFAULT_PERMISSIONS.cloud),
    },
    updatedAt: str(o.updatedAt, 40),
  };
}

/** The whole store: per-agent profiles + the shared mic settings + global pronunciations. */
export interface VoiceStore { $axf: typeof SCHEMA; profiles: Record<string, VoiceProfile>; mic: MicSettings; pronunciations: Pronunciation[] }

export function normStore(v: unknown): VoiceStore {
  const o = isObj(v) ? v : {};
  const profiles: Record<string, VoiceProfile> = {};
  if (isObj(o.profiles)) for (const [k, p] of Object.entries(o.profiles).slice(0, 500)) { const n = normProfile(p, k); if (n.agentId) profiles[n.agentId] = n; }
  return {
    $axf: SCHEMA, profiles, mic: normMic(o.mic),
    pronunciations: (Array.isArray(o.pronunciations) ? o.pronunciations : []).map(normPronunciation).filter((x): x is Pronunciation => !!x).slice(0, MAX_PRONUNCIATIONS),
  };
}

/* ---------------------------------------------------------------- presets */

export interface Preset { id: string; label: string; hint: string; patch: Partial<Pick<VoiceProfile, 'rate' | 'pitch' | 'volume' | 'interrupt' | 'autoSpeak'>> & { narrator?: Partial<Narrator> } }

export const PRESETS: Preset[] = [
  { id: 'narrator', label: 'Narrator', hint: 'Everything, calm and even, clear pauses', patch: { rate: 0.95, pitch: 1, narrator: { readMode: 'full', sentencePause: 350, paragraphPause: 800, headings: true, emphasis: true, code: 'mention', urls: 'domain' } } },
  { id: 'briefing', label: 'Briefing', hint: 'First three sentences, brisk', patch: { rate: 1.15, narrator: { readMode: 'summary', sentences: 3, sentencePause: 180, paragraphPause: 400, headings: false } } },
  { id: 'headline', label: 'Headline', hint: 'Only the first sentence', patch: { rate: 1.05, narrator: { readMode: 'first', sentences: 1, intro: '' } } },
  { id: 'walkthrough', label: 'Walkthrough', hint: 'Slow, numbered steps, long pauses', patch: { rate: 0.9, narrator: { readMode: 'full', numberLists: true, listPause: 700, paragraphPause: 900 } } },
  { id: 'developer', label: 'Developer', hint: 'Reads code and links out', patch: { rate: 1.1, narrator: { code: 'read', urls: 'read', numbers: 'digits' } } },
  { id: 'quiet', label: 'Quiet room', hint: 'Low volume, no chime', patch: { volume: 0.45, narrator: { chime: false } } },
];

export function applyPreset(p: VoiceProfile, presetId: string): VoiceProfile {
  const pr = PRESETS.find((x) => x.id === presetId);
  if (!pr) return p;
  const { narrator, ...rest } = pr.patch;
  return normProfile({ ...p, ...rest, narrator: { ...p.narrator, ...(narrator ?? {}) } }, p.agentId);
}

/* ---------------------------------------------------------------- the microphone */

export const MIC_MODES = ['tap', 'hold', 'toggle'] as const;
export type MicMode = (typeof MIC_MODES)[number];

export interface MicSettings {
  /** tap = one utterance; hold = listens while pressed; toggle = listens until tapped again (several utterances) */
  mode: MicMode;
  lang: string;
  /** show what's heard in the composer as it's said */
  liveText: boolean;
  /** words that send what was said / throw it away / stop listening */
  sendPhrase: string;
  cancelPhrase: string;
  /** "comma", "period", "new line" … become punctuation */
  spokenPunctuation: boolean;
  /** stop listening after this long without speech, ms (toggle mode) */
  silenceMs: number;
  /** never listen longer than this, seconds */
  maxSeconds: number;
  /** pressing the mic while the agent talks stops the talking first */
  bargeIn: boolean;
  /** hands-free wake listening (AmberX) lets go of the mic while this listens, and comes back afterwards */
  pauseHandsFree: boolean;
  /** never start while AmberX dictation or Speak-a-command has the mic (waits instead, up to waitMs) */
  respectOthers: boolean;
  waitMs: number;
  /** hands-free can't hear the agent's own voice and run it as a command */
  muteWakeWhileSpeaking: boolean;
  /** a small tone when the mic opens / closes */
  tones: boolean;
  /** haptic tick on Android when the mic opens */
  haptics: boolean;
  /** the composer keeps the words of the last utterance when sending fails */
  keepOnError: boolean;
}

export const DEFAULT_MIC: MicSettings = {
  mode: 'tap', lang: 'en-US', liveText: true, sendPhrase: 'send it', cancelPhrase: 'never mind', spokenPunctuation: true,
  silenceMs: 2500, maxSeconds: 60, bargeIn: true, pauseHandsFree: true, respectOthers: true, waitMs: 3000,
  muteWakeWhileSpeaking: true, tones: false, haptics: true, keepOnError: true,
};

export function normMic(v: unknown): MicSettings {
  const o = isObj(v) ? v : {};
  const d = DEFAULT_MIC;
  return {
    mode: pick(o.mode, MIC_MODES, d.mode), lang: str(o.lang, 20) || d.lang, liveText: bool(o.liveText, d.liveText),
    sendPhrase: (typeof o.sendPhrase === 'string' ? o.sendPhrase.slice(0, 40) : d.sendPhrase).trim().toLowerCase(),
    cancelPhrase: (typeof o.cancelPhrase === 'string' ? o.cancelPhrase.slice(0, 40) : d.cancelPhrase).trim().toLowerCase(),
    spokenPunctuation: bool(o.spokenPunctuation, d.spokenPunctuation),
    silenceMs: Math.round(clamp(o.silenceMs, 800, 15000, d.silenceMs)), maxSeconds: Math.round(clamp(o.maxSeconds, 5, 600, d.maxSeconds)),
    bargeIn: bool(o.bargeIn, d.bargeIn), pauseHandsFree: bool(o.pauseHandsFree, d.pauseHandsFree), respectOthers: bool(o.respectOthers, d.respectOthers),
    waitMs: Math.round(clamp(o.waitMs, 0, 15000, d.waitMs)), muteWakeWhileSpeaking: bool(o.muteWakeWhileSpeaking, d.muteWakeWhileSpeaking),
    tones: bool(o.tones, d.tones), haptics: bool(o.haptics, d.haptics), keepOnError: bool(o.keepOnError, d.keepOnError),
  };
}

/** Who holds the microphone right now (the shared lease, see mic.ts). */
export type MicHolder = 'agent-voice' | 'dictation' | 'voice-command' | 'notes' | string;

export interface MicGateInput {
  installed: boolean;
  agent: { id: string; name: string } | null;
  profile: VoiceProfile | null;
  /** the device refused the microphone (OS permission) */
  deviceDenied: boolean;
  holder: MicHolder | null;
  speaking: boolean;
  mic: MicSettings;
}

export type MicGate =
  | { ok: true; stopSpeakingFirst: boolean }
  | { ok: false; reason: 'not-installed' | 'no-agent' | 'not-voice' | 'missing-permission' | 'device-denied' | 'busy'; message: string; fix?: 'install' | 'enable' | 'allow-listen' | 'device-settings' | 'wait' };

/** May the Assistant microphone start, and if not, the exact tooltip. */
export function micGate(i: MicGateInput): MicGate {
  if (!i.installed) return { ok: false, reason: 'not-installed', message: 'Agent voice isn\'t installed, so agents can\'t listen or speak.', fix: 'install' };
  if (!i.agent) return { ok: false, reason: 'no-agent', message: 'Pick an agent first: the microphone talks to the selected agent.' };
  const name = i.agent.name || i.agent.id;
  if (!i.profile || !i.profile.enabled) return { ok: false, reason: 'not-voice', message: `${name} is missing permission: ${name} isn't a voice agent yet.`, fix: 'enable' };
  if (!i.profile.permissions.listen) return { ok: false, reason: 'missing-permission', message: `${name} is missing permission: Listen (talk to ${name} with the microphone).`, fix: 'allow-listen' };
  if (i.deviceDenied) return { ok: false, reason: 'device-denied', message: 'This device refused the microphone. Allow it for this app in the device settings.', fix: 'device-settings' };
  if (i.holder && i.holder !== 'agent-voice') {
    const who = i.holder === 'dictation' ? 'Dictation' : i.holder === 'voice-command' ? 'Speak a command' : i.holder === 'notes' ? 'Voice notes' : i.holder;
    return { ok: false, reason: 'busy', message: `${who} is using the microphone. ${i.mic.respectOthers ? 'Try again when it finishes.' : ''}`.trim(), fix: 'wait' };
  }
  return { ok: true, stopSpeakingFirst: i.speaking && i.mic.bargeIn };
}

/* ---------------------------------------------------------------- what was heard */

const PUNCT: [RegExp, string][] = [
  [/\s*\b(new paragraph)\b\s*/gi, '\n\n'], [/\s*\b(new line|newline)\b\s*/gi, '\n'],
  [/\s*\b(comma)\b/gi, ','], [/\s*\b(period|full stop)\b/gi, '.'], [/\s*\b(question mark)\b/gi, '?'],
  [/\s*\b(exclamation (mark|point))\b/gi, '!'], [/\s*\b(colon)\b/gi, ':'], [/\s*\b(semicolon)\b/gi, ';'],
];

export type Heard = { kind: 'send'; text: string } | { kind: 'cancel' } | { kind: 'text'; text: string };

/** One utterance → send it / throw it away / keep it as text, with spoken punctuation applied. */
export function interpretHeard(raw: string, mic: MicSettings): Heard {
  let text = (raw || '').trim();
  const low = text.toLowerCase().replace(/[.!?,]+$/g, '').trim();
  if (mic.cancelPhrase && (low === mic.cancelPhrase || low.endsWith(` ${mic.cancelPhrase}`))) return { kind: 'cancel' };
  let send = false;
  if (mic.sendPhrase && (low === mic.sendPhrase || low.endsWith(` ${mic.sendPhrase}`))) {
    send = true;
    text = text.slice(0, Math.max(0, low.lastIndexOf(mic.sendPhrase))).trim();
  }
  if (mic.spokenPunctuation) {
    for (const [re, to] of PUNCT) text = text.replace(re, to);
    text = text.replace(/([,.?!:;])(?=\S)/g, '$1 ').replace(/ +\n/g, '\n').replace(/\n +/g, '\n').trim();
    text = text.replace(/(^|[.?!]\s+|\n)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  }
  return send ? { kind: 'send', text } : { kind: 'text', text };
}

/* ---------------------------------------------------------------- narration */

export interface Chunk {
  text: string;
  /** silence after this chunk, ms */
  pause: number;
  /** speed multiplier on top of the profile's rate (emphasis, headings) */
  rateMul: number;
  kind: 'intro' | 'heading' | 'sentence' | 'item' | 'outro' | 'note';
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** 0…999 999 in words (list numbering, ordinals of steps). Bigger numbers come back as digits. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999999) return String(n);
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
  return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ''}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function applyPronunciations(text: string, list: readonly Pronunciation[]): string {
  let out = text;
  // longest first, so "AmberX AXF" wins over "AXF"
  for (const p of [...list].sort((a, b) => b.from.length - a.from.length)) {
    const body = escapeRe(p.from);
    const re = new RegExp(p.whole ? `(?<![\\w])${body}(?![\\w])` : body, p.caseSensitive ? 'g' : 'gi');
    out = out.replace(re, p.to);
  }
  return out;
}

/** Built-in pronunciations for this framework's words (the person's own come first and can override them). */
export const BUILTIN_PRONUNCIATIONS: Pronunciation[] = [
  { from: 'AmberX', to: 'Amber X', whole: true, caseSensitive: false },
  { from: 'AXF', to: 'A X F', whole: true, caseSensitive: true },
  { from: 'axHub', to: 'A X hub', whole: true, caseSensitive: false },
  { from: 'VPS', to: 'V P S', whole: true, caseSensitive: true },
  { from: 'APK', to: 'A P K', whole: true, caseSensitive: true },
  { from: 'PR', to: 'P R', whole: true, caseSensitive: true },
  { from: 'CI', to: 'C I', whole: true, caseSensitive: true },
  { from: 'UI', to: 'U I', whole: true, caseSensitive: true },
  { from: 'e.g.', to: 'for example', whole: false, caseSensitive: false },
  { from: 'i.e.', to: 'that is', whole: false, caseSensitive: false },
];

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu;

function domainOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return (m?.[1] ?? url).replace(/^www\./i, '');
}

/** Inline text → what is said: links, inline code, emphasis markers, emoji, numbers, symbols. */
export function speakableInline(s: string, n: Narrator): { text: string; emphasised: boolean } {
  let t = s;
  let emphasised = false;
  // [label](url) → label (+ domain)
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? `image: ${alt}` : 'an image'));
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, label: string, url: string) => (n.urls === 'domain' ? `${label} (${domainOf(url)})` : n.urls === 'read' ? `${label}, ${url}` : label));
  // bare URLs
  t = t.replace(/\bhttps?:\/\/[^\s)>\]]+/gi, (url) => (n.urls === 'skip' ? '' : n.urls === 'mention' ? 'a link' : n.urls === 'domain' ? `a link to ${domainOf(url)}` : url));
  // inline code
  t = t.replace(/`([^`]+)`/g, (_m, c: string) => (n.code === 'skip' ? '' : n.code === 'mention' && c.length > 40 ? 'some code' : c));
  // emphasis markers
  if (/\*\*[^*]+\*\*|__[^_]+__/.test(t)) emphasised = true;
  t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a?: string, b?: string) => a ?? b ?? '').replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, '$1$2').replace(/~~([^~]+)~~/g, '$1');
  if (n.emoji === 'skip') t = t.replace(EMOJI_RE, '');
  // symbols that read badly
  t = t.replace(/\s*->\s*|\s*→\s*/g, ' to ').replace(/\s*&\s*/g, ' and ').replace(/(\d)\s*%/g, '$1 percent').replace(/\s*\|\s*/g, ', ');
  if (n.numbers === 'digits') t = t.replace(/\b\d{2,}\b/g, (d) => d.split('').join(' '));
  return { text: t.replace(/\s{2,}/g, ' ').trim(), emphasised };
}

/** Sentences of a paragraph (keeps "e.g.", decimals and versions together). */
export function sentencesOf(p: string): string[] {
  const protectedText = p.replace(/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Dr|St)\./gi, (m) => m.replace(/\./g, '\u0000')).replace(/(\d)\.(\d)/g, '$1\u0000$2');
  return protectedText.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map((s) => s.replace(/\u0000/g, '.').trim()).filter(Boolean);
}

/** Splits a long piece at commas/spaces so no chunk is longer than `max` (engines choke on very long utterances). */
export function splitLong(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    let at = rest.lastIndexOf(', ', max);
    if (at < max * 0.5) at = rest.lastIndexOf(' ', max);
    if (at <= 0) at = max;
    out.push(rest.slice(0, at + (rest[at] === ',' ? 1 : 0)).trim());
    rest = rest.slice(at + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export interface NarrateOptions { agentName?: string; global?: readonly Pronunciation[]; builtins?: boolean; maxChunk?: number }

/**
 * A reply → what the agent says, chunk by chunk. Code blocks, tables, headings, lists and paragraphs are each handled
 * by the narrator rules; the read mode cuts it to the first sentences; pronunciations (agent's, then global, then
 * built-in) are applied last so they see the final words.
 */
export function narrate(text: string, profile: VoiceProfile, opts: NarrateOptions = {}): Chunk[] {
  const n = profile.narrator;
  const name = opts.agentName || profile.agentId || 'The agent';
  const maxChunk = opts.maxChunk ?? 380;
  const prons = [...profile.pronunciations, ...(opts.global ?? []), ...(opts.builtins === false ? [] : BUILTIN_PRONUNCIATIONS)];
  // de-duplicate by `from` (earlier wins: agent > global > built-in)
  const seen = new Set<string>();
  const pron = prons.filter((p) => { const k = p.caseSensitive ? p.from : p.from.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const say = (s: string) => applyPronunciations(s, pron).replace(/\s{2,}/g, ' ').trim();

  const out: Chunk[] = [];
  const push = (c: Chunk) => { for (const piece of splitLong(c.text, maxChunk)) if (piece) out.push({ ...c, text: piece }); };

  if (n.intro.trim()) push({ text: say(n.intro.replace(/\{name\}/g, name)), pause: n.sentencePause, rateMul: 1, kind: 'intro' });

  // Blocks: fenced code, then paragraphs separated by blank lines.
  const src = (text || '').replace(/\r\n?/g, '\n');
  const parts = src.split(/(```[\s\S]*?(?:```|$))/g);
  let sentencesLeft = n.readMode === 'full' ? Infinity : n.readMode === 'first' ? 1 : n.sentences;
  let charsLeft = n.maxChars;
  let cut = false;
  let item = 0;

  const emit = (c: Chunk) => {
    if (cut) return;
    if (c.text.length > charsLeft) { cut = true; return; }
    charsLeft -= c.text.length;
    push(c);
  };

  for (const part of parts) {
    if (cut || sentencesLeft <= 0) break;
    if (part.startsWith('```')) {
      const lang = /^```([\w+-]*)/.exec(part)?.[1] ?? '';
      const body = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
      if (n.code === 'mention') emit({ text: say(`There's ${lang ? `some ${lang}` : 'a block of'} code here${body ? `, ${body.split('\n').length} lines` : ''}.`), pause: n.paragraphPause, rateMul: 1, kind: 'note' });
      else if (n.code === 'read' && body) for (const line of body.split('\n').filter((l) => l.trim())) emit({ text: say(line.trim()), pause: n.listPause, rateMul: 0.95, kind: 'sentence' });
      continue;
    }
    for (const para of part.split(/\n{2,}/)) {
      if (cut || sentencesLeft <= 0) break;
      const lines = para.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
      if (!lines.length) continue;
      // tables: read the header row once, then say how many rows
      if (lines.length >= 2 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l))) {
        const head = lines[0]!.split('|').map((c) => c.trim()).filter(Boolean);
        const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).length - 1;
        emit({ text: say(`A table of ${head.join(', ')}, with ${rows} ${rows === 1 ? 'row' : 'rows'}.`), pause: n.paragraphPause, rateMul: 1, kind: 'note' });
        continue;
      }
      for (const raw of lines) {
        if (cut || sentencesLeft <= 0) break;
        const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(raw);
        if (h) {
          if (!n.headings) continue;
          const t = speakableInline(h[2]!, n).text;
          if (t) emit({ text: say(t), pause: n.paragraphPause, rateMul: n.emphasis ? 0.92 : 1, kind: 'heading' });
          continue;
        }
        const li = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(raw);
        if (li) {
          item += 1;
          const { text: t, emphasised } = speakableInline(li[2]!.replace(/^\[[ xX]\]\s*/, ''), n);
          if (!t) continue;
          const lead = n.numberLists ? `${numberWords(li[1] ? Number(li[1]) : item)}: ` : '';
          emit({ text: say(lead + t), pause: n.listPause, rateMul: emphasised && n.emphasis ? 0.94 : 1, kind: 'item' });
          sentencesLeft -= 1;
          continue;
        }
        item = 0;
        const clean = raw.replace(/^\s*>\s?/, '');
        for (const sentence of sentencesOf(clean)) {
          if (cut || sentencesLeft <= 0) break;
          const { text: t, emphasised } = speakableInline(sentence, n);
          if (!t || !/[\p{L}\p{N}]/u.test(t)) continue;
          emit({ text: say(t), pause: n.sentencePause, rateMul: emphasised && n.emphasis ? 0.94 : 1, kind: 'sentence' });
          sentencesLeft -= 1;
        }
      }
      if (out.length) out[out.length - 1]!.pause = Math.max(out[out.length - 1]!.pause, n.paragraphPause);
    }
  }
  if (cut) push({ text: 'That\'s as much as I\'ll read out; the rest is on screen.', pause: n.sentencePause, rateMul: 1, kind: 'note' });
  if (n.outro.trim()) push({ text: say(n.outro.replace(/\{name\}/g, name)), pause: 0, rateMul: 1, kind: 'outro' });
  if (out.length) out[out.length - 1]!.pause = 0;
  return out;
}

/** Roughly how long the chunks take to say, ms (150 words a minute at rate 1 + the pauses). */
export function estimateMs(chunks: readonly Chunk[], rate: number): number {
  let ms = 0;
  for (const c of chunks) ms += (c.text.split(/\s+/).filter(Boolean).length / 150) * 60000 / Math.max(0.1, rate * c.rateMul) + c.pause;
  return Math.round(ms);
}

/* ---------------------------------------------------------------- the live status light */

export type LightState = 'off' | 'ready' | 'speaking' | 'listening' | 'paused' | 'error';

export interface LightInput { profile: VoiceProfile | null; speaking: boolean; paused: boolean; listening: boolean; error: boolean }

/** The live status light: off unless the selected agent is a voice agent; then ready / speaking / listening / paused. */
export function lightState(i: LightInput): LightState {
  if (!i.profile?.enabled) return 'off';
  if (i.error) return 'error';
  if (i.listening) return 'listening';
  if (i.paused) return 'paused';
  if (i.speaking) return 'speaking';
  return 'ready';
}

export const LIGHT_LABEL: Record<LightState, string> = { off: 'Voice off', ready: 'Voice ready', speaking: 'Speaking', listening: 'Listening', paused: 'Paused', error: 'Voice error' };

/* ---------------------------------------------------------------- import / export */

export function exportProfiles(store: VoiceStore, ids?: readonly string[]): string {
  const profiles = ids ? Object.fromEntries(Object.entries(store.profiles).filter(([k]) => ids.includes(k))) : store.profiles;
  return JSON.stringify({ $axf: SCHEMA, profiles, pronunciations: store.pronunciations }, null, 2);
}

/** Merges an exported file into the store; returns the new store and how many profiles came in. */
export function importProfiles(store: VoiceStore, raw: string): { store: VoiceStore; count: number; error?: string } {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { store, count: 0, error: 'That file isn\'t JSON.' }; }
  if (!isObj(data) || data.$axf !== SCHEMA) return { store, count: 0, error: `That isn't an ${SCHEMA} export.` };
  const inc = normStore(data);
  const prons = [...store.pronunciations];
  for (const p of inc.pronunciations) if (!prons.some((x) => x.from.toLowerCase() === p.from.toLowerCase())) prons.push(p);
  return { store: { ...store, profiles: { ...store.profiles, ...inc.profiles }, pronunciations: prons.slice(0, MAX_PRONUNCIATIONS) }, count: Object.keys(inc.profiles).length };
}
