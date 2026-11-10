/**
 * Rule 5, radius, border width and shadow use.
 *
 * The token set is the style theme's: radius sm / md / lg (plus none and pill), one border width (plus 0), shadows
 * sm / md / lg (plus none) drawn in the theme's shadow colour. What the skin uses is that set as the controls draw it,
 * plus whatever its style parts pick (`parts.<type>.radius | borderWidth | shadow`).
 *
 *   shape.radius   too many distinct radii in use (`shape.maxRadii`): each part that brings in one past the limit is an
 *                  issue, fixed by going back to the theme radius; and radii out of order (sm > md or md > lg).
 *   shape.border   a part border width that is neither the theme's width nor 0 (outside the token set), fixed by
 *                  going back to the theme; and too many distinct widths (`shape.maxBorderWidths`).
 *   shape.shadow   a theme shadow drawn in a literal colour instead of the shadow / border token (outside the token
 *                  set), and too many distinct shadows (`shape.maxShadows`). No fix: a shadow is a design call.
 */
import type { SkinCheckRule, SkinCheckRuleContext } from '../contract.ts';
import { defineRule, tokenRef } from '../engine.ts';
import { styleVar } from '../vars.ts';
import { isObj } from './util.ts';

const PILL = 999;
const SIZES = ['sm', 'md', 'lg'] as const;

function partsOf(ctx: SkinCheckRuleContext): [string, Record<string, unknown>][] {
  const parts: unknown = ctx.subject.skin.data.parts;
  if (!isObj(parts)) return [];
  return Object.entries(parts).filter((e): e is [string, Record<string, unknown>] => isObj(e[1])).sort(([a], [b]) => a.localeCompare(b));
}
const style = (ctx: SkinCheckRuleContext): Record<string, unknown> => ctx.subject.styleTheme!.data as unknown as Record<string, unknown>;

export const shapeRadius: SkinCheckRule = defineRule('shape.radius', ['styleTheme'], (ctx) => {
  const st = style(ctx);
  const radius = isObj(st.radius) ? st.radius : {};
  const px = (name: string): number | null => name === 'none' ? 0 : name === 'pill' ? PILL : typeof radius[name] === 'number' ? radius[name] as number : null;
  // out of order: a small radius larger than a bigger one
  for (let i = 1; i < SIZES.length; i++) {
    const lo = px(SIZES[i - 1]!), hi = px(SIZES[i]!);
    if (lo === null || hi === null || lo <= hi) continue;
    ctx.report({
      token: tokenRef(ctx.subject, 'style-theme', `radius.${SIZES[i]}`, styleVar(`radius.${SIZES[i]}`)),
      against: tokenRef(ctx.subject, 'style-theme', `radius.${SIZES[i - 1]}`, styleVar(`radius.${SIZES[i - 1]}`)),
      value: hi,
      expected: `radius.${SIZES[i]} at least radius.${SIZES[i - 1]} (${lo})`,
      message: `radius.${SIZES[i]} (${hi}px) is smaller than radius.${SIZES[i - 1]} (${lo}px); the scale runs backwards.`,
      measured: lo - hi,
      fix: { kind: 'set', label: `Raise radius.${SIZES[i]} to ${lo}px`, writes: [{ token: tokenRef(ctx.subject, 'style-theme', `radius.${SIZES[i]}`), value: lo }] },
    });
  }
  const used: number[] = [];
  for (const s of SIZES) { const v = px(s); if (v !== null && !used.includes(v)) used.push(v); }
  const max = ctx.settings.shape.maxRadii;
  for (const [type, p] of partsOf(ctx)) {
    if (typeof p.radius !== 'string' || p.radius === 'theme') continue;
    const v = px(p.radius);
    if (v === null || used.includes(v)) continue;
    used.push(v);
    if (used.length <= max) continue;
    ctx.report({
      token: tokenRef(ctx.subject, 'skin', `parts.${type}.radius`),
      value: p.radius,
      expected: `at most ${max} distinct radii`,
      message: `${type} uses radius ${p.radius} (${v === PILL ? 'pill' : `${v}px`}), radius ${used.length} of max ${max}.`,
      measured: used.length,
      fix: { kind: 'set', label: 'Use the theme radius', writes: [{ token: tokenRef(ctx.subject, 'skin', `parts.${type}.radius`), value: 'theme' }] },
    });
  }
});

export const shapeBorder: SkinCheckRule = defineRule('shape.border', ['styleTheme'], (ctx) => {
  const st = style(ctx);
  const base = typeof st.borderWidth === 'number' ? st.borderWidth : 1;
  const used = new Set<number>([base]);
  for (const [type, p] of partsOf(ctx)) {
    if (p.borderWidth === undefined || p.borderWidth === 'theme') continue;
    const v = Number(p.borderWidth);
    if (!Number.isFinite(v) || v === 0) continue;
    used.add(v);
    if (v === base) continue;
    ctx.report({
      token: tokenRef(ctx.subject, 'skin', `parts.${type}.borderWidth`),
      against: tokenRef(ctx.subject, 'style-theme', 'borderWidth', styleVar('borderWidth')),
      value: String(p.borderWidth),
      expected: `the theme border width (${base}px) or 0`,
      message: `${type} draws a ${v}px border; the theme width is ${base}px.`,
      measured: v,
      fix: { kind: 'set', label: `Use the theme width (${base}px)`, writes: [{ token: tokenRef(ctx.subject, 'skin', `parts.${type}.borderWidth`), value: 'theme' }] },
    });
  }
  const max = ctx.settings.shape.maxBorderWidths;
  if (used.size > max) {
    ctx.report({
      token: tokenRef(ctx.subject, 'style-theme', 'borderWidth', styleVar('borderWidth')),
      value: base,
      expected: `at most ${max} distinct border widths`,
      message: `${used.size} distinct border widths in use (${[...used].sort((a, b) => a - b).join(', ')}px); max ${max}.`,
      measured: used.size,
    });
  }
});

const TOKEN_COLOR = /var\(--fx-(shadow|border)\)/;
const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

export const shapeShadow: SkinCheckRule = defineRule('shape.shadow', ['styleTheme'], (ctx) => {
  const st = style(ctx);
  const shadow = isObj(st.shadow) ? st.shadow : {};
  const distinct = new Set<string>();
  for (const s of SIZES) {
    const v = shadow[s];
    if (typeof v !== 'string' || v.trim() === 'none') continue;
    distinct.add(v.replace(/\s+/g, ' ').trim());
    if (LITERAL_COLOR.test(v) && !TOKEN_COLOR.test(v)) {
      ctx.report({
        token: tokenRef(ctx.subject, 'style-theme', `shadow.${s}`, styleVar(`shadow.${s}`)),
        value: v,
        expected: 'a shadow drawn in var(--fx-shadow)',
        message: `shadow.${s} uses a literal colour; it will not follow the colour theme (light and dark).`,
      });
    }
  }
  const max = ctx.settings.shape.maxShadows;
  if (distinct.size > max) {
    ctx.report({
      token: tokenRef(ctx.subject, 'style-theme', 'shadow'),
      value: distinct.size,
      expected: `at most ${max} distinct shadows`,
      message: `${distinct.size} distinct shadows; max ${max}.`,
      measured: distinct.size,
    });
  }
});

export const SHAPE_RULES: readonly SkinCheckRule[] = [shapeRadius, shapeBorder, shapeShadow];
