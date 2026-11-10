/**
 * Rule 4, WCAG contrast over every foreground / background token pair the skin uses.
 *
 * The pairs are the framework's own uses of the colour tokens (what the controls draw) plus the pairs the skin's
 * style parts add (`parts.<type>.textColor` / `iconColor` over the part's `background`, or the surface):
 *
 *   contrast.text        (contrast.text, AA 4.5:1)        text and muted over bg, surface, surface2, surface3;
 *                                                          accentText over accent; a part's text colour over its background
 *   contrast.large-text  (contrast.largeText, AA 3:1)     accent headings and large figures over bg and surface
 *   contrast.ui          (contrast.ui, non-text 3:1)       focus ring over bg and surface; status colours (danger,
 *                                                          success, warning, info) as icons over surface; a part's icon colour
 *
 * Hairline `border` is not held to 3:1 (WCAG 1.4.11 asks it of a control's only boundary, and AXF controls have a
 * fill). Translucent backgrounds are laid over the theme's bg first. The fix moves the foreground token to the nearest
 * shade (same OKLab hue and chroma) that passes over every background the rule checks it against, so one click on
 * `text` fixes it over all four surfaces.
 */
import type { SkinCheckRule, SkinCheckRuleContext, SkinCheckRuleId } from '../contract.ts';
import { defineRule, tokenRef } from '../engine.ts';
import { colorVar } from '../vars.ts';
import { contrastRatio, parseColor, passingShade, type Rgba } from '../color.ts';
import { isObj, round } from './util.ts';

export interface ContrastPair { fg: string; bg: string; why: string }
type Kind = 'text' | 'largeText' | 'ui';

export const BASE_PAIRS: Record<Kind, readonly ContrastPair[]> = {
  text: [
    ...['bg', 'surface', 'surface2', 'surface3'].map((bg) => ({ fg: 'text', bg, why: 'body text' })),
    ...['bg', 'surface', 'surface2'].map((bg) => ({ fg: 'muted', bg, why: 'secondary text' })),
    { fg: 'accentText', bg: 'accent', why: 'text on accent buttons' },
  ],
  largeText: ['bg', 'surface'].map((bg) => ({ fg: 'accent', bg, why: 'accent headings and figures' })),
  ui: [
    ...['bg', 'surface'].map((bg) => ({ fg: 'focus', bg, why: 'focus ring' })),
    ...['danger', 'success', 'warning', 'info'].map((fg) => ({ fg, bg: 'surface', why: 'status icons' })),
  ],
};

const PART_BG_DEFAULT = 'surface';

/** The pairs of one kind the skin uses: the base table plus its parts. Pairs whose tokens the theme lacks drop out. */
export function contrastPairs(kind: Kind, tokens: Record<string, unknown>, parts: unknown): ContrastPair[] {
  const out: ContrastPair[] = [...BASE_PAIRS[kind]];
  if (isObj(parts) && kind !== 'largeText') {
    for (const [type, p] of Object.entries(parts).sort(([a], [b]) => a.localeCompare(b))) {
      if (!isObj(p)) continue;
      const bg = typeof p.background === 'string' && p.background !== 'theme' && p.background !== 'transparent' ? p.background : PART_BG_DEFAULT;
      const fgKey = kind === 'text' ? p.textColor : p.iconColor;
      const fg = typeof fgKey === 'string' && fgKey !== 'theme' ? fgKey : kind === 'text' && bg !== PART_BG_DEFAULT ? 'text' : null;
      if (fg && fg !== bg) out.push({ fg, bg, why: `${type} ${kind === 'text' ? 'text' : 'icons'}` });
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${p.fg}~${p.bg}`;
    if (seen.has(k) || !(p.fg in tokens) || !(p.bg in tokens)) return false;
    seen.add(k);
    return true;
  });
}

function runContrast(ctx: SkinCheckRuleContext, kind: Kind): void {
  const { subject, settings } = ctx;
  const tokens = subject.colorTheme!.data.tokens as unknown as Record<string, unknown>;
  const target = settings.contrast[kind];
  const base = parseColor(tokens.bg) ?? { r: 255, g: 255, b: 255, a: 1 };
  const solid = (key: string): Rgba | null => parseColor(tokens[key]);
  const pairs = contrastPairs(kind, tokens, subject.skin.data.parts);
  const ratio = (fg: Rgba, bg: Rgba) => contrastRatio(fg, bg, base);
  // the backgrounds each foreground is checked against, so its fix passes over all of them
  const bgsOf = new Map<string, Rgba[]>();
  for (const p of pairs) {
    const bg = solid(p.bg);
    if (bg) bgsOf.set(p.fg, [...(bgsOf.get(p.fg) ?? []), bg]);
  }
  const fixFor = new Map<string, string>();
  const shadeFor = (key: string, fg: Rgba): string => {
    if (!fixFor.has(key)) {
      let cand = fg;
      let hex = '';
      for (let round = 0; round < 3; round++) {
        const worst = [...(bgsOf.get(key) ?? [])].sort((a, b) => ratio(cand, a) - ratio(cand, b))[0];
        if (!worst || ratio(cand, worst) >= target) break;
        hex = passingShade(cand, worst.a < 1 ? { ...worst } : worst, target);
        cand = { ...parseColor(hex)!, a: fg.a };
      }
      fixFor.set(key, hex);
    }
    return fixFor.get(key)!;
  };
  const words = { text: 'text', largeText: 'large text', ui: 'icons and controls' }[kind];
  for (const p of pairs) {
    const fg = solid(p.fg), bg = solid(p.bg);
    if (!fg || !bg) continue;
    const r = ratio(fg, bg);
    if (r >= target - 1e-9) continue;
    const shade = shadeFor(p.fg, fg);
    const fgRef = tokenRef(subject, 'color-theme', `tokens.${p.fg}`, colorVar(p.fg));
    ctx.report({
      token: fgRef,
      against: tokenRef(subject, 'color-theme', `tokens.${p.bg}`, colorVar(p.bg)),
      value: String(tokens[p.fg]),
      expected: `at least ${target}:1 for ${words}`,
      message: `${p.fg} over ${p.bg} is ${round(r, 2)}:1 (${p.why}); ${words} needs ${target}:1.`,
      measured: round(r, 2),
      ...(shade ? { fix: { kind: 'set' as const, label: `Shade ${p.fg} to ${shade} (passes ${target}:1)`, writes: [{ token: { type: fgRef.type, id: fgRef.id, path: fgRef.path }, value: shade }] } } : {}),
    });
  }
}

const rule = (id: SkinCheckRuleId, kind: Kind): SkinCheckRule => defineRule(id, ['colorTheme'], (ctx) => runContrast(ctx, kind));
export const contrastText = rule('contrast.text', 'text');
export const contrastLargeText = rule('contrast.large-text', 'largeText');
export const contrastUi = rule('contrast.ui', 'ui');

export const CONTRAST_RULES: readonly SkinCheckRule[] = [contrastText, contrastLargeText, contrastUi];
