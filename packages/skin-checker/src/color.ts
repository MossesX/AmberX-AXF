/**
 * Colour maths for the skin checker. Pure.
 *
 *   parseColor     #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla() (comma or space syntax), transparent,
 *                  white, black; anything else (var(), gradients, named colours) is null and the rules skip it
 *   contrastRatio  WCAG 2.x relative-luminance ratio, the foreground composited over the (opaque) background
 *   oklab / deltaE perceptual distance in OKLab, scaled ×100 (ΔE 1 ≈ the smallest difference most people see)
 *   passingShade   the nearest shade of a colour (same OKLab hue and chroma, lightness moved) that reaches a ratio
 */

export interface Rgba { r: number; g: number; b: number; a: number }
export interface Oklab { L: number; a: number; b: number }

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parse a CSS colour, or null when it is not a literal colour this module understands. */
export function parseColor(input: unknown): Rgba | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1]!;
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? round3(parseInt(h.slice(6, 8), 16) / 255) : 1 };
  }
  m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const num = (p: string, scale: number) => (p.endsWith('%') ? parseFloat(p) / 100 * scale : parseFloat(p));
  const alpha = parts[3] === undefined ? 1 : clamp(parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]), 0, 1);
  if (m[1]!.startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255)) as [number, number, number];
    if ([r, g, b, alpha].some((n) => !Number.isFinite(n))) return null;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: alpha };
  }
  const h = parseFloat(parts[0]!);
  const sat = parseFloat(parts[1]!) / 100;
  const l = parseFloat(parts[2]!) / 100;
  if ([h, sat, l, alpha].some((n) => !Number.isFinite(n))) return null;
  const [r, g, b] = hslToRgb(((h % 360) + 360) % 360, clamp(sat, 0, 1), clamp(l, 0, 1));
  return { r, g, b, a: alpha };
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function toHex(c: Rgba): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a < 1 ? h(c.a * 255) : ''}`;
}

/** `fg` drawn over `bg` (alpha blend); the result is opaque when `bg` is. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (f: number, b: number) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}

const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const gam = (c: number): number => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG relative luminance of an opaque colour. */
export function luminance(c: Rgba): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio of `fg` over `bg`; a translucent background is first laid over `base` (default white). */
export function contrastRatio(fg: Rgba, bg: Rgba, base: Rgba = { r: 255, g: 255, b: 255, a: 1 }): number {
  const solidBg = bg.a < 1 ? composite(bg, base) : bg;
  const solidFg = fg.a < 1 ? composite(fg, solidBg) : fg;
  const l1 = luminance(solidFg);
  const l2 = luminance(solidBg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function oklab(c: Rgba): Oklab {
  const r = lin(c.r), g = lin(c.g), b = lin(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function fromOklab(c: Oklab, alpha = 1): Rgba {
  const l = (c.L + 0.3963377774 * c.a + 0.2158037573 * c.b) ** 3;
  const m = (c.L - 0.1055613458 * c.a - 0.0638541728 * c.b) ** 3;
  const s = (c.L - 0.0894841775 * c.a - 1.291485548 * c.b) ** 3;
  return {
    r: clamp(gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), 0, 255),
    g: clamp(gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), 0, 255),
    b: clamp(gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), 0, 255),
    a: alpha,
  };
}

/** Perceptual distance in OKLab, ×100. */
export function deltaE(x: Rgba, y: Rgba): number {
  const p = oklab(x), q = oklab(y);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b) * 100;
}

/**
 * The shade of `fg` closest to it (same OKLab hue and chroma, only the lightness moves) whose contrast over `bg`
 * reaches `target`, as #rrggbb; it tries darker and lighter and keeps the one that moves least. Falls back to black or
 * white when no shade of that hue gets there. `fg` keeps its alpha.
 */
export function passingShade(fg: Rgba, bg: Rgba, target: number): string {
  const lab = oklab({ ...fg, a: 1 });
  const ok = (L: number) => contrastRatio(fromOklab({ ...lab, L }, fg.a), bg) >= target;
  const search = (lo: number, hi: number, towardHi: boolean): number | null => {
    // monotone in the direction we move: find the L nearest the original that passes
    const end = towardHi ? hi : lo;
    if (!ok(end)) return null;
    let a = towardHi ? lab.L : lo, b = towardHi ? hi : lab.L;
    for (let i = 0; i < 40; i++) {
      const mid = (a + b) / 2;
      if (ok(mid) === towardHi) b = mid; else a = mid;
    }
    return towardHi ? b : a;
  };
  const cands = [search(0, lab.L, false), search(lab.L, 1, true)].filter((v): v is number => v !== null);
  if (!cands.length) return toHex(luminance(bg.a < 1 ? composite(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg) > 0.18 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 });
  const L = cands.sort((x, y) => Math.abs(x - lab.L) - Math.abs(y - lab.L))[0]!;
  // the hex rounding can land a hair under the target: nudge until it passes
  const hexAt = (l: number) => toHex(fromOklab({ ...lab, L: clamp(l, 0, 1) }, 1));
  let hex = hexAt(L);
  for (let i = 1; i <= 40 && contrastRatio({ ...parseColor(hex)!, a: fg.a }, bg) < target; i++) hex = hexAt(L < lab.L ? L - 0.002 * i : L + 0.002 * i);
  return hex;
}
