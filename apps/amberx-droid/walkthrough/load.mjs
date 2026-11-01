// Which walkthrough a run works on, and the edits made to it in AmberX (Walkthrough → Edit the voice).
//   WALKTHROUGH=<id>   one of WALKTHROUGHS (default amberx-app, the AmberX tour)
//   $OUT/voice.json    the voice edits (walkthrough-voice@1: voice, speed, per-scene narration), or VOICE_OVERRIDES_B64
// Every recorder step (tts, record, assemble, check) loads the script through here, so an edited line is voiced,
// timed and captioned the same way. The edits are data only: a voice name, a number and plain text per scene.
import { existsSync, readFileSync } from 'node:fs';

export const WALKTHROUGHS = {
  'amberx-app': './script.mjs',
  stack: './stack.mjs',
};
/** The Piper voices a walkthrough may use (all on the rhasspy/piper-voices v1.0.0 release). */
export const VOICES = [
  'en_US-kristin-medium', 'en_US-amy-medium', 'en_US-lessac-medium', 'en_US-hfc_female-medium', 'en_US-ljspeech-medium',
  'en_US-ryan-medium', 'en_US-joe-medium', 'en_US-hfc_male-medium', 'en_GB-alba-medium', 'en_GB-jenny_dioco-medium',
];
export const SPEED = { min: 0.75, max: 1.3 };
export const VOICE_FORMAT = 'walkthrough-voice@1';
export const MAX_LINE = 400; // the scripts' own limit per scene

/** Where Piper's files for a voice live: en_US-kristin-medium → en/en_US/kristin/medium. */
export function voicePath(voice) {
  const m = /^((en)_[A-Z]{2})-([a-z_]+)-(low|medium|high)$/.exec(voice ?? '');
  if (!m) throw new Error(`not a voice name: ${voice}`);
  return `${m[2]}/${m[1]}/${m[3]}/${m[4]}`;
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Voice edits made safe: a known voice, a speed in range, lines only for scenes that exist. */
export function normalizeOverrides(raw, chapters) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const keys = new Set(chapters.flatMap((c) => c.scenes.map((_, i) => `${c.id}-${i}`)));
  const lines = {};
  for (const [k, v] of Object.entries(o.lines && typeof o.lines === 'object' ? o.lines : {})) {
    const t = clean(v, MAX_LINE);
    if (keys.has(k) && t) lines[k] = t;
  }
  const speed = Number(o.speed);
  return {
    voice: VOICES.includes(o.voice) ? o.voice : null,
    speed: Number.isFinite(speed) && speed >= SPEED.min && speed <= SPEED.max ? Math.round(speed * 100) / 100 : null,
    lines,
  };
}

function readOverrides(out) {
  try {
    if (process.env.VOICE_OVERRIDES_B64) return JSON.parse(Buffer.from(process.env.VOICE_OVERRIDES_B64, 'base64').toString('utf8'));
    const f = `${out}/voice.json`;
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  } catch { return {}; }
}

/** The walkthrough with its edits applied: { WALKTHROUGH, CHAPTERS, walkthroughErrors, overrides }. */
export async function loadWalkthrough(id = process.env.WALKTHROUGH || 'amberx-app', out = process.env.OUT || '/out') {
  const path = WALKTHROUGHS[id];
  if (!path) throw new Error(`no walkthrough "${id}" (known: ${Object.keys(WALKTHROUGHS).join(', ')})`);
  const mod = await import(path);
  const overrides = normalizeOverrides(readOverrides(out), mod.CHAPTERS);
  const WALKTHROUGH = { ...mod.WALKTHROUGH, voice: overrides.voice ?? mod.WALKTHROUGH.voice, speed: overrides.speed ?? mod.WALKTHROUGH.speed ?? 1 };
  const CHAPTERS = mod.CHAPTERS.map((c) => ({ ...c, scenes: c.scenes.map((s, i) => ({ ...s, say: overrides.lines[`${c.id}-${i}`] ?? s.say })) }));
  return { WALKTHROUGH, CHAPTERS, walkthroughErrors: mod.walkthroughErrors, overrides };
}
