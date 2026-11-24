/**
 * Skin animation rules (build skin-animations-swatches-skin-switch, Nov 13 2026): the animation fields of a behaviour
 * theme's `motion` group and this app's own picks over them (Settings → Appearance → Animations). Plain JavaScript so
 * the runtime (core/engines/behavior.ts), the CLI (framework/cli/animations.mjs) and the server read the same rules.
 *
 *  - swatches    colour swatch rows (skin cards): wave | ripple | pop | off
 *  - skinSwitch  switching skins: the new colours ripple from the tap point | sweep across | fade | off
 *  - picker      colour pickers: the picked swatch fans out into its shades | pops | off
 *  - animSpeed   percent of normal (25 to 400) · animIntensity  how far things move (0 to 100, 0 = still)
 *
 * A pick that is missing or `skin` keeps the skin's choice.
 */

export const ANIMATION_ENUMS = {
  swatches: ['wave', 'ripple', 'pop', 'off'],
  skinSwitch: ['ripple', 'sweep', 'fade', 'off'],
  picker: ['fan', 'pop', 'off'],
};
export const ANIMATION_RANGES = { animSpeed: [25, 400], animIntensity: [0, 100] };
export const ANIMATION_DEFAULTS = { swatches: 'wave', skinSwitch: 'ripple', picker: 'fan', animSpeed: 100, animIntensity: 60 };

export const SKIN_ANIMATIONS = [
  { key: 'swatches', label: 'Colour swatches', attr: 'data-fx-anim-swatches', help: 'Skin cards: the swatch row waves or ripples on hover or tap.' },
  { key: 'skinSwitch', label: 'Skin switch', attr: 'data-fx-anim-skin-switch', help: 'Switching skins: the new colours ripple or sweep across the screen from where you tapped.' },
  { key: 'picker', label: 'Colour picker', attr: 'data-fx-anim-picker', help: 'Colour pickers: the picked swatch pops and fans out into its shades, the colour morphs.' },
];

/** The settings value (one object) that holds this app's picks; it travels with the app's look document. */
export const ANIMATION_PREFS_KEY = 'axf.appearance.animations';
export const ANIMATION_PREF_KEYS = ['swatches', 'skinSwitch', 'picker', 'speed', 'intensity'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const clampInt = (v, [min, max]) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : undefined);

/** The animation fields of a behaviour theme's motion group, every one filled (bad values take the default). */
export function normalizeAnimationMotion(motion) {
  const m = isObj(motion) ? motion : {};
  const out = { ...ANIMATION_DEFAULTS };
  for (const [k, allowed] of Object.entries(ANIMATION_ENUMS)) if (typeof m[k] === 'string' && allowed.includes(m[k])) out[k] = m[k];
  for (const [k, range] of Object.entries(ANIMATION_RANGES)) { const v = clampInt(m[k], range); if (v !== undefined) out[k] = v; }
  return out;
}

/** Only valid picks survive; anything else is dropped (= the skin's). */
export function normalizeAnimationPrefs(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const a of SKIN_ANIMATIONS) if (typeof raw[a.key] === 'string' && ANIMATION_ENUMS[a.key].includes(raw[a.key])) out[a.key] = raw[a.key];
  const speed = clampInt(raw.speed, ANIMATION_RANGES.animSpeed);
  const intensity = clampInt(raw.intensity, ANIMATION_RANGES.animIntensity);
  if (speed !== undefined) out.speed = speed;
  if (intensity !== undefined) out.intensity = intensity;
  return out;
}

/** One pick changed: `skin` (or null) drops it back to the skin's. Null when the key or value isn't allowed. */
export function setAnimationPref(prefs, key, value) {
  if (!ANIMATION_PREF_KEYS.includes(key)) return null;
  const cur = normalizeAnimationPrefs(prefs);
  if (value === null || value === undefined || value === 'skin') { delete cur[key]; return cur; }
  const v = key === 'speed' || key === 'intensity' ? (typeof value === 'string' && value.trim() !== '' ? Number(value) : value) : value;
  const next = normalizeAnimationPrefs({ ...cur, [key]: v });
  return key in next ? next : null;
}

/** The animation fields with this app's picks laid over the skin's. */
export function applyAnimationPrefs(motion, prefs) {
  const m = normalizeAnimationMotion(motion);
  const p = normalizeAnimationPrefs(prefs);
  for (const a of SKIN_ANIMATIONS) if (p[a.key]) m[a.key] = p[a.key];
  if (p.speed !== undefined) m.animSpeed = p.speed;
  if (p.intensity !== undefined) m.animIntensity = p.intensity;
  return m;
}

/**
 * What the Animations section, the API, the CLI and voice read: each animation's value, the skin's, whether this app
 * picked it and whether it plays (`reduced` = reduced motion is in force).
 */
export function animationStateOf(motion, prefs, reduced = false) {
  const skin = normalizeAnimationMotion(motion);
  const p = normalizeAnimationPrefs(prefs);
  const eff = applyAnimationPrefs(motion, p);
  return {
    reduced: !!reduced,
    speed: eff.animSpeed,
    intensity: eff.animIntensity,
    prefs: p,
    animations: SKIN_ANIMATIONS.map((a) => ({
      key: a.key, label: a.label, help: a.help, value: eff[a.key], skin: skin[a.key], own: !!p[a.key],
      on: !reduced && eff.animIntensity > 0 && eff[a.key] !== 'off', options: [...ANIMATION_ENUMS[a.key]],
    })),
  };
}
