/**
 * swarm-vibe — the group chat's vibe engine (Brett, Oct 31 2026: a vibe ceiling 1–500 with chattiness, cussing and
 * drama sliders, presets, per-agent overrides, a daily banter budget; Fable rebuild Nov 3 2026 as a pure engine).
 *
 * One rule every port gives the same answer for: a message is scored from its words (no model), then run through
 * the speaker's settings (the room's sliders with the agent's own overrides on top). The vibe setting is a hard
 * ceiling: a line above it is cleaned (cussing slider), then calmed (no shouting, no exclamation piles, no sarcastic
 * sentences); banter still above it is dropped, work lines are only ever toned down, Brett's own lines are scored
 * and never changed. Identity jokes are dropped whatever the settings; fights and jealousy need the drama slider.
 *
 * The word lists are the registry (VIBE_WORDS): regexes and weights, so a port replays them. Pure, no I/O, no clock
 * (times come in as ISO strings). Fixture: framework/spec/fixtures/swarm-vibe.json (check-swarm.mts).
 */

import { DEFAULT_PRESET, PRESETS, SLIDERS, VIBE, WORK_KINDS } from './swarm-rules.mjs';

export { DEFAULT_PRESET, PRESETS, SLIDERS, VIBE };

const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

/* ------------------------------------------------------------------ */
/* Registry: what the words weigh                                       */
/* ------------------------------------------------------------------ */

/** Acronyms that are not shouting. */
export const ACRONYMS = /^(API|CSS|TSX|MCP|JSON|UTC|CLI|USD|PR|CI|URL|SDK)$/;

export const VIBE_WORDS = {
  /** Cuss words: `level` 2 = strong (cleaned under 67 on the slider), 1 = mild (cleaned under 34); `clean` = the replacement. */
  cuss: [
    { re: /\bfuck(ing|in'|ed|er)?\b/gi, level: 2, clean: (m) => (/ing|in'/i.test(m) ? 'freaking' : 'freak') },
    { re: /\bshit(ty)?\b/gi, level: 2, clean: (m) => (/ty$/i.test(m) ? 'crappy' : 'stuff') },
    { re: /\bbitch\w*\b/gi, level: 2, clean: () => 'complain' },
    { re: /\bass\b/gi, level: 1, clean: () => 'butt' },
    { re: /\bdamn(ed)?\b/gi, level: 1, clean: () => 'darn' },
    { re: /\bhell\b/gi, level: 1, clean: () => 'heck' },
    { re: /\bcrap\b/gi, level: 1, clean: () => 'junk' },
  ],
  sarcasm: [/\boh sure\b/i, /\bwho knew\b/i, /\btook (?:you )?long enough\b/i, /\bteacher'?s pet\b/i, /\btypical\b/i, /\bnot jealous\b/i, /\bdon'?t let it go to your head\b/i, /\bactually (?:work|shipping)\b/i, /\bkinda deserved\b/i],
  drama: [/\bjealous\b/i, /\bback (?:the \w+ )?off\b|\bback the \w+ up\b/i, /\bget your hands off\b/i, /\bfor what\b/i, /\bdeserved\b/i, /\brich\b/i, /\bi quit\b/i, /\bregret\b/i, /\bclashed\b/i, /\bblew up\b/i, /\btake a number\b/i, /\bF in the chat\b/i],
  slang: [/\byo\b/i, /\bbro\b/i, /\bain'?t\b/i, /\by'all\b/i, /\bbuddy\b/i, /\bgonna\b/i],
  /** Topics a joke may never be about, whatever the settings. */
  identity: /\b(race|racial|ethnic\w*|religio\w*|muslim\w*|christian\w*|jew(ish)?|hindu\w*|gay|lesbian|trans\w*gender|transgender|queer|gender|sexuality|black people|white people|asian\w*|latin[oa]s?|immigrant\w*)\b/i,
};
/** Weights: the base for a work line / a banter line, and what each find adds. */
export const VIBE_WEIGHTS = { work: 1, banter: 40, cussStrong: 70, cussMild: 30, shout: 25, bang: 12, bangMax: 5, sarcasm: 45, drama: 40, slang: 8 };
/** Slider thresholds: cussing kept at or above these; chattiness bands for reactions; drama needed for fights. */
export const VIBE_LEVELS = { cussStrong: 67, cussMild: 34, chatty: [20, 60], drama: 30, paidBanter: 40 };
/** Colour-by-vibe: the faintest tint, so a quiet line still shows. */
export const VIBE_SHADE_MIN = 0.08;

/* ------------------------------------------------------------------ */
/* The engine                                                           */
/* ------------------------------------------------------------------ */

/** The sliders that apply to one speaker: the room's, then its own overrides. */
export const settingsFor = (cs, from) => ({ ...cs, ...(cs.overrides?.[from] ?? {}) });

/** A message's vibe score, 1–500, from its words (no model). Work messages built by Boss score low. */
export function scoreVibe(text, kind = 'banter') {
  const t = str(text); const W = VIBE_WEIGHTS;
  let s = WORK_KINDS.includes(kind) && kind !== 'brett' ? W.work : W.banter;
  for (const c of VIBE_WORDS.cuss) s += (t.match(c.re)?.length ?? 0) * (c.level === 2 ? W.cussStrong : W.cussMild);
  s += (t.match(/\b[A-Z]{3,}\b/g) ?? []).filter((w) => !ACRONYMS.test(w)).length * W.shout;
  s += Math.min(W.bangMax, (t.match(/!/g) ?? []).length) * W.bang;
  s += VIBE_WORDS.sarcasm.filter((r) => r.test(t)).length * W.sarcasm;
  s += VIBE_WORDS.drama.filter((r) => r.test(t)).length * W.drama;
  s += VIBE_WORDS.slang.filter((r) => r.test(t)).length * W.slang;
  return Math.max(VIBE.min, Math.min(VIBE.max, Math.round(s)));
}
/** Cussing slider 0–100: under 34 every cuss word is cleaned, under 67 the strong ones. Keeps the first letter's case. */
export function cleanCussing(text, cussing) {
  const keep = cussing >= VIBE_LEVELS.cussStrong ? 2 : cussing >= VIBE_LEVELS.cussMild ? 1 : 0;
  let t = str(text);
  for (const c of VIBE_WORDS.cuss) if (c.level > keep) t = t.replace(c.re, (m) => { const r = c.clean(m); return m[0] === m[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r; });
  return t;
}
/** Tone a line down: no shouting, no pile of exclamation marks, no sarcastic sentences (a sentence goes whole). */
export function calmDown(text) {
  const t = str(text).replace(/\b([A-Z]{3,})\b/g, (w) => (ACRONYMS.test(w) ? w : w.toLowerCase())).replace(/!+/g, '.').replace(/\.\.+/g, '.');
  return t.split(/(?<=[.?])\s+/).filter((x) => !VIBE_WORDS.sarcasm.some((r) => r.test(x))).join(' ').trim();
}

/**
 * Run one message through the speaker's settings. Returns the message to show (with `vibe` and `toned`) or null
 * when it is dropped. The vibe setting is a hard ceiling: a line above it is cleaned, then calmed; banter still
 * above is dropped. Work lines are never dropped (only toned down). Brett's own lines are scored, never changed.
 */
export function vibeFilter(msg, cs) {
  const k = msg.kind; const set = settingsFor(cs, msg.from);
  if (k === 'brett') return { ...msg, vibe: scoreVibe(msg.text, k), toned: false };
  const work = WORK_KINDS.includes(k);
  if (!work && VIBE_WORDS.identity.test(msg.text)) return null;
  if (!work && set.drama < VIBE_LEVELS.drama && VIBE_WORDS.drama.some((r) => r.test(msg.text))) return null;
  let text = cleanCussing(msg.text, set.cussing); let score = scoreVibe(text, k);
  if (score > set.vibe) { text = calmDown(cleanCussing(text, 0)); score = scoreVibe(text, k); }
  if ((score > set.vibe || !text) && !work) return null;
  return { ...msg, text, vibe: Math.min(score, set.vibe), toned: text !== msg.text };
}

/** How many coworkers react to an event at this chattiness (0 = assignments only). */
export const reactionsFor = (cs) => (cs.chattiness < VIBE_LEVELS.chatty[0] ? 0 : cs.chattiness < VIBE_LEVELS.chatty[1] ? 1 : 2);

const dayStart = (at) => { const d = new Date(at); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString(); };
/** Dollars of paid banter so far today (UTC day). */
export const banterToday = (state, at) => { const d = dayStart(at); return (state.banterSpend ?? []).filter((b) => b.at >= d).reduce((t, b) => t + b.usd, 0); };

/** Paid banter is allowed now: room on, chattiness high enough, today's spend under the daily budget. { ok, why, today }. */
export function banterAllowed(state, at) {
  const cs = state.chatSettings; const today = banterToday(state, at);
  if (!state.chat.enabled) return { ok: false, why: 'the group chat is off', today };
  if (cs.chattiness < VIBE_LEVELS.paidBanter) return { ok: false, why: 'chattiness is too low for paid banter', today };
  if (today >= cs.banterBudget) return { ok: false, why: `today's banter budget ($${cs.banterBudget < 10 ? cs.banterBudget.toFixed(2) : Math.round(cs.banterBudget)}) is spent; quiet till tomorrow`, today };
  return { ok: true, why: '', today };
}
/** Coworker reactions per event: by chattiness, none once today's banter budget is spent (quiet when hit). */
export function reactCount(state, at) {
  const cs = state.chatSettings; if (!cs) return 1;
  return cs.banterBudget > 0 && banterToday(state, at) >= cs.banterBudget ? 0 : reactionsFor(cs);
}

/** Sample lines for the live preview, by how wild the vibe setting is. */
export const PREVIEW_LINES = {
  wild: 'Oh sure, TEX gets a raise. For WHAT? I fixed three damn conflicts this week, rich ass!!',
  mid: 'Boss gave me ui.tsx. Back the hell up, Tex, that shit\'s leased to me.',
  chill: 'Gradle\'s running. Cracking a beer, wake me up in twenty.',
};
/** The live preview line: one sample per band, run through the settings as they are now. */
export function previewLine(cs, from = 'rio', seed = 'preview') {
  const raw = cs.vibe > 300 ? PREVIEW_LINES.wild : cs.vibe > 150 ? PREVIEW_LINES.mid : PREVIEW_LINES.chill;
  const m = vibeFilter({ from, kind: 'banter', text: raw }, cs);
  return m ?? { from, kind: 'banter', text: '(dropped: above the vibe ceiling)', vibe: null, toned: true, dropped: true, seed };
}
/** Colour by vibe: how strong the tint is, 0–1 (faint near 1, darkest at the ceiling). */
export const vibeShade = (score, ceiling) => (score == null ? 0 : Math.max(VIBE_SHADE_MIN, Math.min(1, score / Math.max(1, ceiling))));
