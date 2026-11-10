/**
 * Rule 3, palette.
 *
 * The palette is the colour theme's opaque colours (translucent tokens such as accentSoft and shadow are tints of
 * another colour and are not counted). Two tokens with exactly the same value are one colour on purpose (focus =
 * accent) and are neither counted twice nor reported.
 *
 * palette.near-duplicate: two tokens closer than `palette.nearDuplicateDeltaE` (OKLab ΔE ×100) but not equal are the
 * same colour written twice. The canonical token is the one listed first in the theme (bg, surface, text, accent …
 * order); the fix merges the other into it.
 *
 * palette.sprawl: distinct colours after folding near-duplicates together, against `palette.maxColors`. No fix: which
 * colours go is a design decision.
 */
import type { SkinCheckRule } from '../contract.ts';
import { defineRule, tokenRef } from '../engine.ts';
import { colorVar } from '../vars.ts';
import { deltaE, parseColor, toHex, type Rgba } from '../color.ts';
import { round } from './util.ts';

export interface PaletteEntry { key: string; value: string; rgba: Rgba }

/** The opaque, parseable colours of a colour theme, in theme order. */
export function paletteOf(tokens: unknown): PaletteEntry[] {
  if (typeof tokens !== 'object' || tokens === null) return [];
  const out: PaletteEntry[] = [];
  for (const [key, value] of Object.entries(tokens as Record<string, unknown>)) {
    const rgba = parseColor(value);
    if (rgba && rgba.a >= 1) out.push({ key, value: value as string, rgba });
  }
  return out;
}

/** Groups of colours closer than `threshold` to the group's first member (theme order), exact equals included. */
export function clusterPalette(entries: readonly PaletteEntry[], threshold: number): PaletteEntry[][] {
  const groups: PaletteEntry[][] = [];
  for (const e of entries) {
    const g = groups.find((grp) => deltaE(grp[0]!.rgba, e.rgba) < threshold);
    if (g) g.push(e); else groups.push([e]);
  }
  return groups;
}

export const paletteNearDuplicate: SkinCheckRule = defineRule('palette.near-duplicate', ['colorTheme'], (ctx) => {
  const { subject, settings } = ctx;
  const threshold = settings.palette.nearDuplicateDeltaE;
  for (const group of clusterPalette(paletteOf(subject.colorTheme!.data.tokens), threshold)) {
    const canon = group[0]!;
    for (const e of group.slice(1)) {
      const d = deltaE(canon.rgba, e.rgba);
      if (toHex(e.rgba) === toHex(canon.rgba)) continue;
      const into = tokenRef(subject, 'color-theme', `tokens.${canon.key}`, colorVar(canon.key));
      ctx.report({
        token: tokenRef(subject, 'color-theme', `tokens.${e.key}`, colorVar(e.key)),
        against: into,
        value: e.value,
        expected: `a colour at least ΔE ${threshold} from ${canon.key}, or ${canon.key} itself`,
        message: `${e.key} (${e.value}) is ${round(d, 2)} ΔE from ${canon.key} (${canon.value}): the same colour written twice.`,
        measured: round(d, 2),
        fix: { kind: 'merge', label: `Merge into ${canon.key}`, writes: [{ token: tokenRef(subject, 'color-theme', `tokens.${e.key}`), value: canon.value }], into: { type: into.type, id: into.id, path: into.path } },
      });
    }
  }
});

export const paletteSprawl: SkinCheckRule = defineRule('palette.sprawl', ['colorTheme'], (ctx) => {
  const { subject, settings } = ctx;
  const groups = clusterPalette(paletteOf(subject.colorTheme!.data.tokens), settings.palette.nearDuplicateDeltaE);
  const max = settings.palette.maxColors;
  if (groups.length <= max) return;
  ctx.report({
    token: tokenRef(subject, 'color-theme', 'tokens'),
    value: groups.length,
    expected: `at most ${max} distinct colours`,
    message: `${groups.length} distinct colours (${groups.map((g) => g[0]!.key).join(', ')}); a professional palette keeps to ${max}.`,
    measured: groups.length,
  });
});

export const PALETTE_RULES: readonly SkinCheckRule[] = [paletteSprawl, paletteNearDuplicate];
