/**
 * chat-audio — hear the agents talk while they build (build group-chat-audio-hear-agents-talk-while, Nov 14 2026,
 * Brett: "an 'Enable audio' switch on the agents' group chat so you can actually hear the employees building your app").
 *
 * Three contracts every surface (console page, AmberX, CLI, MCP, voice) agrees on:
 *
 *   1. voice@1 — one speaking voice: which device voice to prefer (name hints, language, gender), speed, pitch and
 *      volume, plus an optional cloud voice. Voices live in a `voice` asset (asset@1, type `voice`, a voice cast):
 *      a default voice, named voices per agent and a pool the rest are dealt from (stable per agent id). The active
 *      voice asset is an appearance slot, so a skin swaps every agent's voice at once (`data.assets.voice`).
 *   2. chat-audio@1 — the room's audio settings: on/off, master volume, mode (everything, only Brett's mentions,
 *      summaries only), muted agents, per-agent voice overrides (swappable per agent), the queue cap and what to skip.
 *   3. The playback queue: messages are spoken in arrival order, one at a time (voices never overlap); a full queue
 *      drops its oldest lines and says how many were skipped; a muted agent's queued lines go when it is muted.
 *
 * Pure: no DOM, no clock, no I/O. The players (Web Speech on the console, native TTS on AmberX) only take `utterance()`
 * results off the queue. Fixture: framework/spec/fixtures/chat-audio.json (check-chat-audio.mjs). Kotlin twin deferred.
 */

export const VOICE = 'voice@1';
export const VOICE_TYPE = 'voice';
export const CHAT_AUDIO = 'chat-audio@1';
export const MODES = ['all', 'mentions', 'summaries'];
export const MODE_LABELS = { all: 'Everything', mentions: 'Only my mentions', summaries: 'Summaries only' };
export const GENDERS = ['any', 'female', 'male'];
export const CLOUD_PROVIDERS = ['openai', 'elevenlabs'];
/** Chat kinds that summarise work (spoken in `summaries` mode): reports, merges, handoffs, status and pay news. */
export const SUMMARY_KINDS = ['report', 'merge', 'handoff', 'status', 'discipline', 'pay'];
export const LIMITS = { rate: [0.5, 2], pitch: [0, 2], volume: [0, 1], masterVolume: [0, 100], queueMax: [1, 100], maxChars: [40, 1000] };
export const DEFAULT_VOICE = Object.freeze({ label: '', prefer: [], lang: 'en-US', gender: 'any', rate: 1, pitch: 1, volume: 1, cloud: null });
export const DEFAULT_SETTINGS = Object.freeze({
  $axf: CHAT_AUDIO, enabled: false, volume: 80, mode: 'all', muted: {}, voices: {}, cast: '',
  queueMax: 20, maxChars: 280, speakMine: false, sayName: true,
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const ID = /^[a-z0-9][a-z0-9._-]{0,47}$/;
export const clamp = (v, [lo, hi], d) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const round2 = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* 1. voice@1 and the voice asset                                       */
/* ------------------------------------------------------------------ */

/** One voice, normalised: unknown fields dropped, numbers clamped, missing parts from `base`. */
export function normVoice(v, base = DEFAULT_VOICE) {
  const x = isObj(v) ? v : {};
  const b = isObj(base) ? base : DEFAULT_VOICE;
  const prefer = Array.isArray(x.prefer) ? x.prefer.map((p) => str(p, 80).trim()).filter(Boolean).slice(0, 8) : [...(b.prefer ?? [])];
  const c = 'cloud' in x ? x.cloud : b.cloud;
  const cloud = isObj(c) && CLOUD_PROVIDERS.includes(c.provider) && str(c.voice, 80).trim() ? { provider: c.provider, voice: str(c.voice, 80).trim() } : null;
  return {
    label: str(x.label ?? b.label, 60),
    prefer,
    lang: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(str(x.lang, 20)) ? x.lang : (b.lang || 'en-US'),
    gender: GENDERS.includes(x.gender) ? x.gender : (GENDERS.includes(b.gender) ? b.gender : 'any'),
    rate: round2(clamp(x.rate, LIMITS.rate, b.rate ?? 1)),
    pitch: round2(clamp(x.pitch, LIMITS.pitch, b.pitch ?? 1)),
    volume: round2(clamp(x.volume, LIMITS.volume, b.volume ?? 1)),
    cloud,
  };
}

/** Problems with a voice asset (asset@1, type voice), each naming its field. */
export function castErrors(a) {
  const out = [];
  if (!isObj(a)) return [{ field: '', code: 'type', message: 'a voice asset is an object' }];
  if (a.$axf !== 'asset@1') out.push({ field: '$axf', code: 'frame', message: 'must be asset@1' });
  if (a.type !== VOICE_TYPE) out.push({ field: 'type', code: 'type', message: `must be "${VOICE_TYPE}"` });
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(str(a.id, 60))) out.push({ field: 'id', code: 'id', message: 'lower-case id, 2-48 characters' });
  const d = a.data;
  if (!isObj(d)) { out.push({ field: 'data', code: 'type', message: 'data is an object' }); return out; }
  if (!isObj(d.default)) out.push({ field: 'data.default', code: 'required', message: 'a default voice' });
  if (d.agents != null && !isObj(d.agents)) out.push({ field: 'data.agents', code: 'type', message: '{ agentId: voice }' });
  for (const k of Object.keys(isObj(d.agents) ? d.agents : {})) if (!ID.test(k)) out.push({ field: `data.agents.${k}`, code: 'id', message: 'not an agent id' });
  if (d.pool != null && !Array.isArray(d.pool)) out.push({ field: 'data.pool', code: 'type', message: 'a list of voices' });
  return out;
}

/** The asset validators' hook (core/validate.ts and the build engine): messages for a voice asset's data, [] for other types. */
export function voiceErrors(type, data) {
  if (type !== VOICE_TYPE) return [];
  return castErrors({ $axf: 'asset@1', type: VOICE_TYPE, id: 'x0', data }).map((e) => `${e.field}: ${e.message}`);
}

/** A voice asset's data, normalised: { default, agents, pool }. Agent and pool voices inherit from the default. */
export function normCast(a) {
  const d = isObj(a) && isObj(a.data) ? a.data : {};
  const def = normVoice(d.default);
  const agents = {};
  for (const [k, v] of Object.entries(isObj(d.agents) ? d.agents : {})) if (ID.test(k)) agents[k] = normVoice(v, def);
  const pool = (Array.isArray(d.pool) ? d.pool : []).slice(0, 32).map((v) => normVoice(v, def));
  return { id: str(a?.id, 48), name: str(a?.name, 80), default: def, agents, pool };
}

/** Stable small hash of an id (FNV-1a), so an agent keeps its pool voice across devices and ports. */
export function idHash(id) {
  let h = 0x811c9dc5;
  for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Which voice asset is in force: the room's pick, else the skin's (the active `voice` slot), else `breakroom`, else the first one there is. */
export function castId(settings, skinPick, ids) {
  const list = Array.isArray(ids) ? ids : [];
  const s = normSettings(settings);
  for (const id of [s.cast, str(skinPick, 48), 'breakroom']) if (id && list.includes(id)) return id;
  return list[0] ?? '';
}

/**
 * The voice an agent speaks with: the cast's named voice, else a pool voice dealt by id, else the default; then the
 * room's per-agent override (chat-audio@1 `voices[id]`) on top. `cast` is a normCast() result.
 */
export function voiceFor(agentId, cast, settings) {
  const c = cast ?? normCast(null);
  const base = c.agents[agentId] ?? (c.pool.length ? c.pool[idHash(agentId) % c.pool.length] : c.default);
  const o = isObj(settings?.voices) ? settings.voices[agentId] : null;
  return o ? normVoice(o, base) : base;
}

/**
 * Pick a device voice from what the platform offers ([{ name, lang, gender? }]): a `prefer` hint that matches a name
 * first, then the language (exact, then the base language) with the gender when the platform says one, else null
 * (the platform default). Same choice on the console (speechSynthesis.getVoices) and AmberX (TextToSpeech voices).
 */
export function pickDeviceVoice(voice, available) {
  const list = Array.isArray(available) ? available.filter((x) => isObj(x) && typeof x.name === 'string') : [];
  if (!list.length) return null;
  const v = normVoice(voice);
  for (const p of v.prefer) { const hit = list.find((x) => x.name.toLowerCase().includes(p.toLowerCase())); if (hit) return hit.name; }
  const base = v.lang.split('-')[0].toLowerCase();
  const exact = list.filter((x) => String(x.lang ?? '').toLowerCase().replace('_', '-') === v.lang.toLowerCase());
  const loose = exact.length ? exact : list.filter((x) => String(x.lang ?? '').toLowerCase().startsWith(base));
  if (!loose.length) return null;
  const g = v.gender !== 'any' ? loose.filter((x) => x.gender === v.gender) : [];
  return (g[0] ?? loose[0]).name;
}

/* ------------------------------------------------------------------ */
/* 2. chat-audio@1 settings                                             */
/* ------------------------------------------------------------------ */

/** The room's audio settings, normalised. `agents` (ids) drops mutes and overrides for agents that left. */
export function normSettings(s, agents) {
  const x = isObj(s) ? s : {};
  const known = Array.isArray(agents) ? new Set(agents) : null;
  const okId = (k) => ID.test(k) && (!known || known.has(k));
  const muted = {};
  for (const [k, v] of Object.entries(isObj(x.muted) ? x.muted : {})) if (v === true && okId(k)) muted[k] = true;
  const voices = {};
  for (const [k, v] of Object.entries(isObj(x.voices) ? x.voices : {})) if (isObj(v) && okId(k)) voices[k] = voiceOverride(v);
  return {
    $axf: CHAT_AUDIO,
    enabled: x.enabled === true,
    volume: Math.round(clamp(x.volume, LIMITS.masterVolume, DEFAULT_SETTINGS.volume)),
    mode: MODES.includes(x.mode) ? x.mode : 'all',
    muted, voices,
    cast: ID.test(str(x.cast, 48)) ? x.cast : '',
    queueMax: Math.round(clamp(x.queueMax, LIMITS.queueMax, DEFAULT_SETTINGS.queueMax)),
    maxChars: Math.round(clamp(x.maxChars, LIMITS.maxChars, DEFAULT_SETTINGS.maxChars)),
    speakMine: x.speakMine === true,
    sayName: x.sayName !== false,
  };
}

/** A per-agent override keeps only the fields it sets (the rest follow the cast). */
function voiceOverride(v) {
  const o = {};
  if (Array.isArray(v.prefer)) o.prefer = v.prefer.map((p) => str(p, 80).trim()).filter(Boolean).slice(0, 8);
  if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(str(v.lang, 20))) o.lang = v.lang;
  if (GENDERS.includes(v.gender)) o.gender = v.gender;
  for (const k of ['rate', 'pitch', 'volume']) if (v[k] != null && Number.isFinite(Number(v[k]))) o[k] = round2(clamp(v[k], LIMITS[k], 1));
  if (isObj(v.cloud) && CLOUD_PROVIDERS.includes(v.cloud.provider) && str(v.cloud.voice, 80).trim()) o.cloud = { provider: v.cloud.provider, voice: str(v.cloud.voice, 80).trim() };
  return o;
}

/**
 * One change to the settings (the `audio` action every surface sends). Fields:
 *   enabled, volume, mode, cast, queueMax, maxChars, speakMine, sayName  → set
 *   mute: agentId | 'all' · unmute: agentId | 'all'                       → per-agent mutes
 *   agent + voice: {…} | null                                             → per-agent voice override (null = the cast's)
 * Returns { settings, log }. Throws on an unknown agent, mode or an empty change.
 */
export function applyAudio(settings, change, agents = []) {
  const s = normSettings(settings, agents.length ? agents : undefined);
  const c = isObj(change) ? change : {};
  const log = [];
  const known = (id) => { if (agents.length && !agents.includes(id)) throw new Error(`no agent "${id}"`); return id; };
  if (typeof c.enabled === 'boolean') { s.enabled = c.enabled; log.push(`group chat audio ${c.enabled ? 'on' : 'off'}`); }
  if (c.volume != null) { s.volume = Math.round(clamp(c.volume, LIMITS.masterVolume, s.volume)); log.push(`volume ${s.volume}`); }
  if (c.mode != null) { if (!MODES.includes(c.mode)) throw new Error(`mode is one of ${MODES.join(', ')}`); s.mode = c.mode; log.push(`mode: ${MODE_LABELS[c.mode]}`); }
  if (c.cast != null) { const id = str(c.cast, 48); if (id && !ID.test(id)) throw new Error('bad voice asset id'); s.cast = id; log.push(id ? `voices from "${id}"` : 'voices from the skin'); }
  if (c.queueMax != null) { s.queueMax = Math.round(clamp(c.queueMax, LIMITS.queueMax, s.queueMax)); log.push(`queue holds ${s.queueMax}`); }
  if (c.maxChars != null) { s.maxChars = Math.round(clamp(c.maxChars, LIMITS.maxChars, s.maxChars)); log.push(`read up to ${s.maxChars} characters`); }
  if (typeof c.speakMine === 'boolean') { s.speakMine = c.speakMine; log.push(`read my own messages ${c.speakMine ? 'on' : 'off'}`); }
  if (typeof c.sayName === 'boolean') { s.sayName = c.sayName; log.push(`say who is talking ${c.sayName ? 'on' : 'off'}`); }
  if (c.mute) {
    if (c.mute === 'all') { for (const a of agents) s.muted[a] = true; log.push('every agent muted'); }
    else { s.muted[known(c.mute)] = true; log.push(`${c.mute} muted`); }
  }
  if (c.unmute) {
    if (c.unmute === 'all') { s.muted = {}; log.push('every agent unmuted'); }
    else { delete s.muted[known(c.unmute)]; log.push(`${c.unmute} unmuted`); }
  }
  if (c.agent && 'voice' in c) {
    known(c.agent);
    if (c.voice === null) { delete s.voices[c.agent]; log.push(`${c.agent}: voice back to the cast`); }
    else if (isObj(c.voice)) { s.voices[c.agent] = voiceOverride({ ...(s.voices[c.agent] ?? {}), ...c.voice }); log.push(`${c.agent}: voice saved`); }
    else throw new Error('voice is an object or null');
  }
  if (!log.length) throw new Error('nothing to change');
  return { settings: normSettings(s, agents.length ? agents : undefined), log };
}

/* ------------------------------------------------------------------ */
/* 3. What is spoken, and the queue                                     */
/* ------------------------------------------------------------------ */

const MENTION = /\bbrett(?:'s)?\b|\b(?:the|big|our) boss\b|\bboss ?man\b|\b(?:the|our) owner\b/i;
/** Does a message mention Brett (the console passes chat-watch's richer test as `isMention`). */
export const mentionsBrett = (text) => MENTION.test(String(text ?? ''));

/** Should this message be spoken under these settings? Returns '' (yes) or the reason it is skipped. */
export function skipReason(m, settings, { isMention = mentionsBrett } = {}) {
  const s = normSettings(settings);
  if (!s.enabled) return 'audio off';
  if (!isObj(m) || !str(m.text, 4000).trim()) return 'empty';
  if (m.from === 'brett' && !s.speakMine) return 'mine';
  if (s.muted[m.from]) return 'muted';
  if (s.mode === 'mentions' && !isMention(m.text)) return 'not a mention';
  if (s.mode === 'summaries' && !SUMMARY_KINDS.includes(m.kind)) return 'not a summary';
  return '';
}

/** Text as it is read out: markdown, code and links quietened, cut at `maxChars` on a word. */
export function spokenText(text, maxChars = DEFAULT_SETTINGS.maxChars) {
  let t = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/([^/\s]+)\S*/g, '$1')
    .replace(/[*_#>~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > maxChars) { const cut = t.slice(0, maxChars); const sp = cut.lastIndexOf(' '); t = `${(sp > maxChars * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, '')}, and so on.`; }
  return t;
}

/**
 * One utterance for a message: { id, from, name, text, voice, volume } with the master volume folded into the voice's
 * own (0..1). `names` maps an id to a display name; `cast` is a normCast() result.
 */
export function utterance(m, settings, cast, names = {}) {
  const s = normSettings(settings);
  const voice = voiceFor(m.from, cast, s);
  const name = names[m.from] ?? (m.from === 'boss' ? 'Boss' : m.from === 'brett' ? 'Brett' : m.from);
  const body = spokenText(m.text, s.maxChars);
  return { id: str(m.id, 80), from: m.from, name, text: s.sayName ? `${name}: ${body}` : body, voice, volume: round2((s.volume / 100) * voice.volume) };
}

/** An empty playback queue: lines waiting, the one being spoken, what was heard last and how many were skipped. */
export const emptyQueue = () => ({ items: [], speaking: null, lastId: '', dropped: 0, paused: false });

/**
 * New messages in: those after `queue.lastId` (all of `messages` when the queue has never heard one and `backlog`
 * is true, else only the newest is marked heard and nothing is queued: switching audio on doesn't read history).
 * Spoken ones are appended in order; a full queue drops its oldest waiting lines (counted in `dropped`).
 */
export function enqueue(queue, messages, settings, cast, names = {}, { isMention, backlog = false } = {}) {
  const q = { ...emptyQueue(), ...queue, items: [...(queue?.items ?? [])] };
  const s = normSettings(settings);
  const msgs = Array.isArray(messages) ? messages : [];
  if (!msgs.length) return q;
  let start = 0;
  if (q.lastId) { const i = msgs.findIndex((m) => m.id === q.lastId); start = i >= 0 ? i + 1 : msgs.length; }
  else if (!backlog) { q.lastId = msgs.at(-1).id; return q; }
  for (const m of msgs.slice(start)) {
    q.lastId = m.id;
    if (skipReason(m, s, { isMention })) continue;
    q.items.push(utterance(m, s, cast, names));
  }
  if (q.items.length > s.queueMax) { q.dropped += q.items.length - s.queueMax; q.items = q.items.slice(-s.queueMax); }
  return q;
}

/** Take the next line to speak (nothing while one is speaking or paused). Returns { queue, next }. */
export function nextUp(queue) {
  const q = { ...emptyQueue(), ...queue, items: [...(queue?.items ?? [])] };
  if (q.speaking || q.paused || !q.items.length) return { queue: q, next: null };
  const next = q.items.shift();
  q.speaking = next;
  return { queue: q, next };
}

/** The current line ended (or failed): the queue is free for the next one. */
export const finished = (queue) => ({ ...emptyQueue(), ...queue, items: [...(queue?.items ?? [])], speaking: null });

/** Settings changed: drop waiting lines that would no longer be spoken (audio off, a muted agent). */
export function prune(queue, settings) {
  const q = { ...emptyQueue(), ...queue, items: [...(queue?.items ?? [])] };
  const s = normSettings(settings);
  if (!s.enabled) return { ...q, items: [] };
  q.items = q.items.filter((u) => !s.muted[u.from]);
  return q;
}

/** Skip the line being spoken and everything waiting ("stop"); the next new message plays. */
export const clearQueue = (queue) => ({ ...emptyQueue(), lastId: queue?.lastId ?? '', dropped: 0 });

/** A short readable status of the room's audio (CLI, voice replies, the switch's hint). */
export function describe(settings, names = {}) {
  const s = normSettings(settings);
  if (!s.enabled) return 'Group chat audio is off.';
  const muted = Object.keys(s.muted).map((k) => names[k] ?? k);
  return `Group chat audio is on at volume ${s.volume}, ${MODE_LABELS[s.mode].toLowerCase()}${muted.length ? `; muted: ${muted.join(', ')}` : ''}.`;
}
