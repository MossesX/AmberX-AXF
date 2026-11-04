/**
 * Seeded brand generators (enterprise-branding s12; the CLI is framework/cli/brand-gen.mjs): logo marks, animated
 * logos and icon packs as asset@1 objects that pass the brand validators (brand-rules.mjs). Deterministic: the same
 * seed always gives the same asset, so a generated library can be regenerated or extended without churn, and the
 * interface roller (roller.ts) gets a new brand per roll.
 *
 * Marks are built from a small grammar: a container shape (rounded square, circle, hexagon, shield, diamond,
 * pill, none) × a motif (ring, chevron, bolt, bars, dots, cross, notch, orbit, spark, wave, stack, slash) × a seeded
 * palette (hue, two tones, light/dark contrast checked) × form (mark / wordmark / lockup). Every path is a
 * hand-written template over the 24-unit grid, so the sanitiser never sees anything but commands and numbers.
 * Animated logos pick a preset, duration, loop and intensity per seed. Icon packs restyle the base glyph set
 * (outline / filled / duotone / sharp / rounded × stroke × cap × duotone backdrop) and never invent glyphs.
 *
 * `generateMark(seed, opts)`, `generateAnimated(seed, markIds)`, `generateIconPack(seed, base)`, `seededRandom(seed)`,
 * `seededPalette(rnd)`, `hslToHex` / `luminance` / `contrast`, `assetErrors(asset)`.
 */
import { ANIMATION_PRESETS, ICON_STYLES, animatedLogoErrors, iconPackErrors, markErrors } from './brand-rules.mjs';

/* ---------------- deterministic randomness ---------------- */

/** mulberry32: a tiny seeded PRNG; `seed` may be a number or any string (hashed). */
export function seededRandom(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashString(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const between = (rnd, lo, hi, step = 1) => lo + Math.round((rnd() * (hi - lo)) / step) * step;

/* ---------------- colour ---------------- */

export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }

/** A three-tone palette: brand1 (main), brand2 (deep), brand3 (pale); brand1 reads ≥ 3:1 on white or near-black. */
export function seededPalette(rnd) {
  const h = between(rnd, 0, 359);
  const scheme = pick(rnd, ['vivid', 'deep', 'soft']);
  let s = scheme === 'vivid' ? between(rnd, 70, 95) : scheme === 'deep' ? between(rnd, 45, 70) : between(rnd, 30, 55);
  let l = scheme === 'deep' ? between(rnd, 28, 40) : between(rnd, 40, 55);
  let brand1 = hslToHex(h, s, l);
  // keep the main tone usable on both a white surface and a dark one (DESIGN-LANGUAGE §6: icons ≥ 3:1)
  for (let i = 0; i < 12 && (contrast(brand1, '#ffffff') < 3 || contrast(brand1, '#14202b') < 2.2); i++) { l = contrast(brand1, '#ffffff') < 3 ? l - 4 : l + 4; brand1 = hslToHex(h, s, l); }
  return { brand1, brand2: hslToHex((h + between(rnd, -20, 20) + 360) % 360, Math.min(100, s + 5), Math.max(12, l - 22)), brand3: hslToHex((h + between(rnd, -10, 10) + 360) % 360, Math.max(20, s - 25), Math.min(94, l + 40)) };
}

/* ---------------- mark grammar (24-unit grid, path data only) ---------------- */

export const CONTAINERS = {
  'rounded-square': 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  'soft-square': 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z',
  circle: 'M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20Z',
  hexagon: 'M12 2l8.7 5v10L12 22l-8.7-5V7Z',
  shield: 'M12 2l8 3v6c0 5-3.4 8.6-8 11-4.6-2.4-8-6-8-11V5Z',
  diamond: 'M12 2l10 10-10 10L2 12Z',
  pill: 'M8 5h8a7 7 0 0 1 0 14H8A7 7 0 0 1 8 5Z',
  squircle: 'M12 2c7.5 0 10 2.5 10 10s-2.5 10-10 10S2 19.5 2 12 4.5 2 12 2Z',
  none: '',
};

/** Motifs drawn over the container in the surface colour (`bg`) so they cut out of the container's fill. */
export const MOTIFS = {
  ring: [{ d: 'M16.5 12a4.5 4.5 0 1 1-1.3-3.2', stroke: 2.2 }, { d: 'M12 12h4.5', stroke: 2.2 }],
  chevron: [{ d: 'M8 7l5 5-5 5', stroke: 2.4 }, { d: 'M13 7l4 5-4 5', stroke: 2.4, opacity: 0.6 }],
  bolt: [{ d: 'M13 4L7 13h5l-1 7 6-9h-5z', fill: true }],
  bars: [{ d: 'M7 16V12M12 16V8M17 16V5', stroke: 2.4 }],
  dots: [{ d: 'M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01', stroke: 2.6 }],
  cross: [{ d: 'M12 6v12M6 12h12', stroke: 2.4 }],
  notch: [{ d: 'M11 2h2v3h-2zM11 19h2v3h-2zM2 11h3v2H2zM19 11h3v2h-3z', fill: true, color: 'brand2', over: true }],
  orbit: [{ d: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0', stroke: 2 }, { d: 'M4.5 14.5c2-4 13-9 15-5', stroke: 1.6, opacity: 0.8 }],
  spark: [{ d: 'M12 5l1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8z', fill: true }],
  wave: [{ d: 'M5 14c2-4 4-4 6 0s4 4 6 0', stroke: 2.2 }, { d: 'M5 10c2-4 4-4 6 0s4 4 6 0', stroke: 2.2, opacity: 0.5 }],
  stack: [{ d: 'M12 6l6 3-6 3-6-3z', fill: true }, { d: 'M6 13l6 3 6-3M6 16.5l6 3 6-3', stroke: 2 }],
  slash: [{ d: 'M15 6l-6 12', stroke: 2.6 }, { d: 'M9 6h2M13 18h2', stroke: 2.6, opacity: 0.6 }],
  arrow: [{ d: 'M7 12h10M13 8l4 4-4 4', stroke: 2.4 }],
  leaf: [{ d: 'M17 7c-6 0-10 4-10 10 6 0 10-4 10-10zM7 17l6-6', stroke: 1.8 }],
  pulse: [{ d: 'M5 12h3l2-4 3 8 2-4h4', stroke: 2.2 }],
  hex: [{ d: 'M12 7l4.3 2.5v5L12 17l-4.3-2.5v-5z', stroke: 2 }],
};
const MOTIF_NAMES = Object.keys(MOTIFS);
const CONTAINER_NAMES = Object.keys(CONTAINERS);

/**
 * One logo-mark asset. `opts.form` mark | wordmark | lockup (default seeded), `opts.brand` the brand name (used by
 * wordmarks and lockups; a mark only records it), `opts.id` the asset id (default `gen-mark-<seed>`).
 */
export function generateMark(seed, opts = {}) {
  const rnd = seededRandom(`mark:${seed}`);
  const brand = opts.brand ?? 'AmberX';
  const form = opts.form ?? pick(rnd, ['mark', 'mark', 'mark', 'lockup', 'wordmark']);
  const palette = opts.palette ?? seededPalette(rnd);
  const container = pick(rnd, CONTAINER_NAMES);
  const motifName = pick(rnd, MOTIF_NAMES);
  const motif = MOTIFS[motifName];
  const paths = [];
  const open = container === 'none';
  if (!open) paths.push({ d: CONTAINERS[container], fill: 'brand1' });
  for (const m of motif) {
    // on an open mark the motif is the brand colour itself; over a container it cuts out in the surface colour
    const color = m.color ?? (open ? 'brand1' : 'bg');
    if (m.fill) paths.push({ d: m.d, fill: color, ...(m.opacity ? { opacity: m.opacity } : {}) });
    else paths.push({ d: m.d, fill: 'none', stroke: color, strokeWidth: open ? m.stroke + 0.4 : m.stroke, round: container !== 'diamond' && container !== 'hexagon', ...(m.opacity ? { opacity: m.opacity } : {}) });
  }
  if (form === 'wordmark') paths.length = 0; // a wordmark is the text alone (the engine draws it); keep one dot as the mark anchor
  if (form === 'wordmark') paths.push({ d: 'M3 12a2 2 0 1 1 4 0a2 2 0 1 1-4 0Z', fill: 'brand1' });
  const text = form === 'mark' ? undefined : { value: brand, weight: pick(rnd, [600, 700, 800]), tracking: pick(rnd, [-0.02, 0, 0.04, 0.08]), font: pick(rnd, ['display', 'display', 'ui', 'mono']), fill: pick(rnd, ['text', 'text', 'brand1']) };
  const style = open ? 'open' : container;
  const id = opts.id ?? `gen-${form}-${String(seed).replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;
  return {
    $axf: 'asset@1', type: 'logo-mark', id, name: `${brand} ${form} · ${style} ${motifName}`, version: '1.0.0',
    description: `Generated ${form}: ${open ? 'an open' : `a ${container}`} ${motifName} motif in a seeded ${paletteWord(palette)} palette (seed ${seed}).`,
    author: 'AmberX AXF brand-gen', tags: ['generated', form, style, motifName],
    data: { form, brand, viewBox: [0, 0, 24, 24], palette, paths, ...(text ? { text } : {}), safeArea: 0.25, minSize: form === 'mark' ? 16 : 80 },
  };
}
function paletteWord(p) { const l = luminance(p.brand1); return l < 0.08 ? 'deep' : l < 0.2 ? 'rich' : 'bright'; }

/** One animated-logo asset over one of `markIds` (seeded pick when several). */
export function generateAnimated(seed, markIds, opts = {}) {
  const rnd = seededRandom(`anim:${seed}`);
  const presets = ANIMATION_PRESETS.filter((p) => p !== 'none');
  const preset = opts.preset ?? pick(rnd, presets);
  const mark = Array.isArray(markIds) ? pick(rnd, markIds) : markIds;
  const loop = pick(rnd, [true, 'hover', 'hover', false]);
  const durationMs = preset === 'spin' ? between(rnd, 1200, 4000, 100) : preset === 'draw' ? between(rnd, 600, 1600, 100) : between(rnd, 1400, 3200, 100);
  const id = opts.id ?? `gen-anim-${String(seed).replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;
  return {
    $axf: 'asset@1', type: 'animated-logo', id, name: `${mark} · ${preset}`, version: '1.0.0',
    description: `Generated animation: ${preset} over ${durationMs} ms, ${loop === true ? 'looping' : loop === 'hover' ? 'on hover' : 'once'} (seed ${seed}).`,
    author: 'AmberX AXF brand-gen', tags: ['generated', preset],
    data: { mark, preset, durationMs, delayMs: pick(rnd, [0, 0, 200, 400]), loop, intensity: Number(between(rnd, 0.4, 1, 0.1).toFixed(1)) },
  };
}

/** One icon-pack asset: the base pack's glyphs restyled (never new glyphs). */
export function generateIconPack(seed, base, opts = {}) {
  const rnd = seededRandom(`pack:${seed}`);
  const b = base.data ?? base;
  const style = opts.style ?? pick(rnd, ICON_STYLES);
  const stroke = style === 'filled' ? 0 : Number(pick(rnd, [1.5, 1.5, 1.75, 2, 2.25]).toFixed(2));
  const linecap = style === 'sharp' ? 'butt' : style === 'rounded' ? 'round' : pick(rnd, ['round', 'butt', 'square']);
  const backdrop = pick(rnd, ['M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z', 'M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20Z', 'M6 2h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z']);
  const glyphs = {};
  for (const [name, g] of Object.entries(b.glyphs ?? {})) {
    const d = typeof g === 'string' ? g : g.d;
    if (style === 'filled') glyphs[name] = { d, fill: true };
    else if (style === 'duotone') glyphs[name] = { d, secondary: backdrop };
    else glyphs[name] = d;
  }
  const id = opts.id ?? `gen-pack-${String(seed).replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;
  return {
    $axf: 'asset@1', type: 'icon-pack', id, name: `${style} ${stroke ? stroke + ' ' + linecap : 'solid'} (${Object.keys(glyphs).length})`, version: '1.0.0',
    description: `Generated pack: the ${base.id ?? 'base'} glyph set in ${style} style${stroke ? `, stroke ${stroke} ${linecap}` : ''} (seed ${seed}).`,
    author: 'AmberX AXF brand-gen', tags: ['generated', style],
    data: { style, grid: b.grid ?? 24, stroke: stroke || 1.75, linecap, fallback: 'framework', glyphs },
  };
}

/* ---------------- validation ---------------- */

export function assetErrors(a) {
  if (a.type === 'logo-mark') return markErrors(a.data);
  if (a.type === 'animated-logo') return animatedLogoErrors(a.data);
  if (a.type === 'icon-pack') return iconPackErrors(a.data);
  return [`unknown brand type ${a.type}`];
}

