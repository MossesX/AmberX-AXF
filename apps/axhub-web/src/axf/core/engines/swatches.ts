/**
 * Colour maths for the skin animations (components/Swatches.tsx, runtime skinSwitchFx). Pure, no DOM.
 *
 *  - shadesOf      n shades of a #rrggbb colour, darkest to lightest, the picked colour in the middle (the picker fan)
 *  - skinSwatches  the swatch row a skin card shows: its colour theme's background, surfaces, accents and text
 *  - sweepOrigin   where the skin-switch ripple starts (the tap point as a percent of the viewport) and its direction
 */

const HEX6 = /^#[0-9a-f]{6}$/i;

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number) => clamp(n).toString(16).padStart(2, '0');

/** Mix a #rrggbb colour toward black (t < 0) or white (t > 0); t in -1..1. Anything not #rrggbb comes back as is. */
export function mixHex(hex: string, t: number): string {
  if (!HEX6.test(hex)) return hex;
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const to = t < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(t));
  return `#${v.map((c) => hex2(c + (to - c) * k)).join('')}`;
}

/** `n` shades of a colour, darkest to lightest, with the colour itself in the middle (n is odd; even counts round up). */
export function shadesOf(hex: string, n = 5): string[] {
  const count = Math.max(1, Math.floor(n / 2) * 2 + 1);
  const half = (count - 1) / 2;
  if (!HEX6.test(hex)) return Array.from({ length: count }, () => hex);
  return Array.from({ length: count }, (_, i) => (i === half ? hex.toLowerCase() : mixHex(hex, ((i - half) / (half + 1)) * 0.8)));
}

/** The tokens a skin card's swatch row shows, in order; missing ones are skipped. */
export const SKIN_SWATCH_TOKENS = ['bg', 'surface', 'surface2', 'accent', 'accent2', 'success', 'warning', 'text'] as const;

/** A skin card's swatch row from its colour theme's tokens (at most `max`). */
export function skinSwatches(tokens: Record<string, string> | undefined, max = 6): string[] {
  if (!tokens) return [];
  const out: string[] = [];
  for (const k of SKIN_SWATCH_TOKENS) {
    const v = tokens[k];
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export interface SweepOrigin { x: string; y: string; dir: 'right' | 'left' }

/** Where the skin-switch ripple starts: the tap point in percent of the viewport (centre when unknown). */
export function sweepOrigin(point: { x: number; y: number } | null | undefined, viewport: { w: number; h: number }): SweepOrigin {
  if (!point || !(viewport.w > 0) || !(viewport.h > 0)) return { x: '50%', y: '50%', dir: 'right' };
  const px = Math.max(0, Math.min(100, (point.x / viewport.w) * 100));
  const py = Math.max(0, Math.min(100, (point.y / viewport.h) * 100));
  return { x: `${px.toFixed(1)}%`, y: `${py.toFixed(1)}%`, dir: px > 50 ? 'left' : 'right' };
}
