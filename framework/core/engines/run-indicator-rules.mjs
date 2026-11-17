/**
 * run-indicator@1 rules — how a running job shows in every grid (Brett, Nov 17 2026: "Every running job in any grid has
 * a spinning or animated icon, and building rows flash slowly; configure the animation, flash, pulse, colors. When it
 * stops it goes red, a pink background with a pop-up alert that says broke"). Plain JS so the build engine, the
 * TypeScript validator (core/validate.ts) and the runtime share ONE validator and ONE compiler. Pure, no DOM.
 *
 *   normalizeRunIndicator(raw)            every field present, clamped, defaults filled (junk → default)
 *   runIndicatorErrors(type, data)        validation messages for the asset validator ('' for other types)
 *   runIndicatorVars(raw, reduced)        the --fx-run-* tokens: opacity and colour-mix over the theme, never a colour
 *   runIndicatorAttrs(raw, reduced)       the data-fx-run-* attributes the stylesheet keys its keyframes on
 *   runIndicatorSchemaProperties()        JSON Schema properties for schemas/json/run-indicator.schema.json
 *
 * Tokens (every grid row reads only these; axf.css section "run indicator"):
 *   --fx-run-running / -broke / -stale / -done        the tone per live state: var(--fx-<token>) of the colour theme
 *   --fx-run-running-bg / -broke-bg / -stale-bg / -done-bg   the row background: color-mix of the tone at --fx-opacity-tint
 *                                                     over the surface (broke-bg is the "pink background")
 *   --fx-run-intensity                                how deep the flash goes (0.05–1)
 *   --fx-run-flash-min                                the opacity at the low point of a flash (1 - intensity)
 *   --fx-run-glow                                     the glow colour: the running tone at intensity, over transparent
 *   --fx-run-duration                                 one cycle: durationMs scaled by speed (0ms under reduced motion)
 *   --fx-run-icon-duration                            the icon's cycle (half the row's)
 *   --fx-run-ease                                     the theme easing
 * Attributes: data-fx-run-anim (flash | pulse | glow | spin | none), data-fx-run-icon (icon name),
 * data-fx-run-icon-anim (spin | pulse | bounce | blink | none), data-fx-run-broke-anim (flash | pulse | none),
 * data-fx-run-reduced (still | tint | off | '' when motion is on). Under reduced motion every animation attribute reads
 * `none`; `tint` keeps the row tints, `off` drops them too (data-fx-run-reduced tells the stylesheet).
 */

export const RUN_INDICATOR_FRAME = 'run-indicator@1';
export const RUN_INDICATOR_TYPE = 'run-indicator';
export const RUN_PREFIX = '--fx-run-';

export const RUN_ANIMATIONS = Object.freeze(['flash', 'pulse', 'glow', 'spin', 'none']);
export const RUN_ICON_ANIMATIONS = Object.freeze(['spin', 'pulse', 'bounce', 'blink', 'none']);
export const RUN_BROKE_ANIMATIONS = Object.freeze(['flash', 'pulse', 'none']);
export const RUN_REDUCED = Object.freeze(['still', 'tint', 'off']);
/** Colour-theme token ids a tone may name (never a colour). */
export const RUN_TONES = Object.freeze(['accent', 'info', 'success', 'warning', 'danger', 'text', 'muted']);
/** The live states a row can be in (build-live@1 STATES minus idle, which draws nothing). */
export const RUN_STATES = Object.freeze(['running', 'broke', 'stale', 'done']);
export const RUN_RANGES = Object.freeze({ speed: [25, 400], durationMs: [400, 8000], intensity: [0.05, 1] });
export const RUN_DEFAULTS = Object.freeze({
  animation: 'pulse', icon: 'refresh', tones: Object.freeze({ running: 'accent', broke: 'danger', stale: 'warning', done: 'success' }),
  iconAnimation: 'spin', brokeAnimation: 'none', speed: 100, durationMs: 2400, intensity: 0.35, reducedMotion: 'still',
});

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ICON_RE = /^[a-z][a-z0-9-]{0,39}$/;
const pick = (list, v, dflt) => (list.includes(v) ? v : dflt);
const clamp = (k, v) => { const n = Number(v); const [lo, hi] = RUN_RANGES[k]; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : RUN_DEFAULTS[k]; };
const round = (n, d) => Number(n.toFixed(d));

/** Every field present, clamped and defaulted. */
export function normalizeRunIndicator(raw) {
  const o = isObj(raw) ? raw : {};
  const t = isObj(o.tones) ? o.tones : {};
  return {
    animation: pick(RUN_ANIMATIONS, o.animation, RUN_DEFAULTS.animation),
    icon: typeof o.icon === 'string' && ICON_RE.test(o.icon) ? o.icon : RUN_DEFAULTS.icon,
    tones: { running: pick(RUN_TONES, t.running, RUN_DEFAULTS.tones.running), broke: pick(RUN_TONES, t.broke, RUN_DEFAULTS.tones.broke), stale: pick(RUN_TONES, t.stale, RUN_DEFAULTS.tones.stale), done: pick(RUN_TONES, t.done, RUN_DEFAULTS.tones.done) },
    iconAnimation: pick(RUN_ICON_ANIMATIONS, o.iconAnimation, RUN_DEFAULTS.iconAnimation),
    brokeAnimation: pick(RUN_BROKE_ANIMATIONS, o.brokeAnimation, RUN_DEFAULTS.brokeAnimation),
    speed: Math.round(clamp('speed', o.speed ?? RUN_DEFAULTS.speed)),
    durationMs: Math.round(clamp('durationMs', o.durationMs ?? RUN_DEFAULTS.durationMs)),
    intensity: round(clamp('intensity', o.intensity ?? RUN_DEFAULTS.intensity), 3),
    reducedMotion: pick(RUN_REDUCED, o.reducedMotion, RUN_DEFAULTS.reducedMotion),
  };
}

/** Validation messages (the asset validator's entry; empty for other types). Names the field, says what it takes. */
export function runIndicatorErrors(type, data) {
  if (type !== RUN_INDICATOR_TYPE) return [];
  if (!isObj(data)) return ['data must be an object'];
  const out = [];
  const enumOf = (k, list) => { if (k in data && !list.includes(data[k])) out.push(`data.${k} must be one of: ${list.join(', ')}`); };
  enumOf('animation', RUN_ANIMATIONS); enumOf('iconAnimation', RUN_ICON_ANIMATIONS); enumOf('brokeAnimation', RUN_BROKE_ANIMATIONS); enumOf('reducedMotion', RUN_REDUCED);
  if ('icon' in data && !(typeof data.icon === 'string' && ICON_RE.test(data.icon))) out.push('data.icon must be a framework icon name (lowercase, dashes)');
  if ('tones' in data) {
    if (!isObj(data.tones)) out.push('data.tones must be an object { running, broke, stale?, done? }');
    else for (const [k, v] of Object.entries(data.tones)) {
      if (!RUN_STATES.includes(k)) out.push(`data.tones.${k}: not a live state (${RUN_STATES.join(', ')})`);
      else if (!RUN_TONES.includes(v)) out.push(`data.tones.${k} must be a colour-theme token: ${RUN_TONES.join(', ')} (never a colour)`);
    }
  }
  for (const k of Object.keys(RUN_RANGES)) {
    if (!(k in data)) continue;
    const n = Number(data[k]); const [lo, hi] = RUN_RANGES[k];
    if (typeof data[k] !== 'number' || !Number.isFinite(n) || n < lo || n > hi) out.push(`data.${k} must be a number ${lo}–${hi}`);
  }
  return out;
}

const tone = (id) => `var(--fx-${id})`;
const bg = (v) => `color-mix(in srgb, ${v} calc(var(--fx-opacity-tint) * 100%), var(--fx-surface))`;

/** The --fx-run-* tokens: opacity and colour-mix over the theme only, never a colour literal. */
export function runIndicatorVars(raw, reduced = false) {
  const r = normalizeRunIndicator(raw);
  const vars = {};
  for (const s of RUN_STATES) { vars[`${RUN_PREFIX}${s}`] = tone(r.tones[s]); vars[`${RUN_PREFIX}${s}-bg`] = bg(`var(${RUN_PREFIX}${s})`); }
  vars[`${RUN_PREFIX}intensity`] = r.intensity.toFixed(3);
  vars[`${RUN_PREFIX}flash-min`] = round(1 - r.intensity, 3).toFixed(3);
  vars[`${RUN_PREFIX}glow`] = `color-mix(in srgb, var(${RUN_PREFIX}running) calc(var(${RUN_PREFIX}intensity) * 100%), transparent)`;
  vars[`${RUN_PREFIX}duration`] = reduced ? '0ms' : r.speed === 100 ? `${r.durationMs}ms` : `calc(${r.durationMs}ms * ${(100 / r.speed).toFixed(3)})`;
  vars[`${RUN_PREFIX}icon-duration`] = `calc(var(${RUN_PREFIX}duration) * 0.5)`;
  vars[`${RUN_PREFIX}ease`] = 'var(--fx-ease)';
  return vars;
}

/** The data-fx-run-* attributes; under reduced motion every animation reads `none` and data-fx-run-reduced says the fallback. */
export function runIndicatorAttrs(raw, reduced = false) {
  const r = normalizeRunIndicator(raw);
  return {
    'data-fx-run-anim': reduced ? 'none' : r.animation,
    'data-fx-run-icon': r.icon,
    'data-fx-run-icon-anim': reduced ? 'none' : r.iconAnimation,
    'data-fx-run-broke-anim': reduced ? 'none' : r.brokeAnimation,
    'data-fx-run-reduced': reduced ? r.reducedMotion : '',
  };
}

/** Both at once, the shape the runtime's root compile merges. */
export const runIndicatorStyle = (raw, reduced = false) => ({ vars: runIndicatorVars(raw, reduced), attrs: runIndicatorAttrs(raw, reduced) });

/** JSON Schema properties for the generated schema (every field typed and ranged). */
export function runIndicatorSchemaProperties() {
  const toneRef = { enum: [...RUN_TONES], description: 'a colour-theme token id, never a colour' };
  const num = (k, d) => { const [lo, hi] = RUN_RANGES[k]; return { type: 'number', minimum: lo, maximum: hi, default: RUN_DEFAULTS[k], description: d }; };
  return {
    animation: { enum: [...RUN_ANIMATIONS], description: 'the row while running' },
    icon: { type: 'string', pattern: ICON_RE.source, description: 'framework icon name shown on a running row' },
    tones: { type: 'object', required: ['running', 'broke'], additionalProperties: false, properties: { running: toneRef, broke: toneRef, stale: toneRef, done: toneRef }, description: 'per live state (defaults: running accent, broke danger, stale warning, done success)' },
    iconAnimation: { enum: [...RUN_ICON_ANIMATIONS], default: RUN_DEFAULTS.iconAnimation, description: 'how the icon moves while running' },
    brokeAnimation: { enum: [...RUN_BROKE_ANIMATIONS], default: RUN_DEFAULTS.brokeAnimation, description: 'a broke row is steady red unless it says otherwise' },
    speed: num('speed', 'percent of the theme motion'),
    durationMs: num('durationMs', 'one cycle of the row animation'),
    intensity: num('intensity', 'how deep the flash goes: the opacity swing and the glow strength'),
    reducedMotion: { enum: [...RUN_REDUCED], default: RUN_DEFAULTS.reducedMotion, description: 'what shows under reduced motion: still = the icon stops, the tints stay; tint = tints only; off = nothing beyond the text tone' },
  };
}
