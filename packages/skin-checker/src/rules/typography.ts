/**
 * Rule 2, typography.
 *
 * typography.font-families: the typefaces the skin draws with, counted across the style theme's body, mono and display
 * stacks and every skin part that picks a font (`parts.<type>.fontFamily`: serif, rounded and system add a face; theme,
 * display and mono reuse a stack). A stack's typeface is its first named family; optical and width variants of one
 * superfamily count once (`Segoe UI Variable Text` and `… Display`, `IBM Plex Sans` and `IBM Plex Mono`). Faces are
 * counted in priority order (body, mono, display, parts); every token that brings in a face past
 * `typography.maxFamilies` is an issue, and the fix points it back at the body face.
 *
 * typography.off-scale: every text size must be a step of the typography asset's type scale (`scale.*`), within
 * `typography.sizeTolerance` (1em, the body size, always counts as a step): the headings (`headings.h1…h4`), the eyebrow, and the sizing asset's text sizes
 * (`button.font`, `card.headFont`, `listRow.metaFont`, …, every em-unit field but icons). The fix snaps to the
 * nearest step.
 */
import { SCALE_FIELDS } from '../../../../framework/core/engines/scale-rules.mjs';
import type { SkinCheckRule, SkinCheckTokenRef } from '../contract.ts';
import { defineRule, tokenRef } from '../engine.ts';
import { scaleVar, styleVar } from '../vars.ts';
import { fmt, isObj, nearestStep, numericLeaves, onStep, round, stepList } from './util.ts';

const GENERIC = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'ui-sans-serif', 'ui-serif', 'ui-rounded', '-apple-system', 'blinkmacsystemfont', 'cursive', 'fantasy', 'math', 'emoji']);
const VARIANT = new Set(['text', 'display', 'variable', 'pro', 'mono', 'code', 'sans', 'serif', 'semi', 'condensed', 'expanded', 'narrow', 'ui', 'vf']);
/** What a part's fontFamily choice draws with: a stack key of the style theme, or a face of its own. */
const PART_FACE: Record<string, string | null> = { theme: null, display: 'fontDisplay', mono: 'fontMono', serif: 'serif', rounded: 'rounded', system: 'system' };

/** The typeface a CSS font stack draws with: its first named family, variants folded (`'Segoe UI Variable Text'` → `segoe`). */
export function typefaceOf(stack: string): string {
  const fams = stack.split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase()).filter(Boolean);
  const named = fams.find((f) => !GENERIC.has(f));
  if (!named) return 'system';
  const words = named.split(/\s+/);
  while (words.length > 1 && (VARIANT.has(words[words.length - 1]!) || /^\d+$/.test(words[words.length - 1]!))) words.pop();
  return words.join(' ');
}
const display = (stack: string): string => stack.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');

export const typographyFontFamilies: SkinCheckRule = defineRule('typography.font-families', ['styleTheme'], (ctx) => {
  const { subject, settings } = ctx;
  const st = subject.styleTheme!.data as unknown as Record<string, unknown>;
  const body = typeof st.fontFamily === 'string' ? st.fontFamily : '';
  const uses: { token: SkinCheckTokenRef; face: string; label: string; fixValue: string }[] = [];
  for (const key of ['fontFamily', 'fontMono', 'fontDisplay']) {
    const v = st[key];
    if (typeof v === 'string' && v.trim()) uses.push({ token: tokenRef(subject, 'style-theme', key, styleVar(key)), face: typefaceOf(v), label: display(v), fixValue: key === 'fontFamily' ? v : body });
  }
  const parts = isObj(subject.skin.data.parts) ? subject.skin.data.parts as Record<string, Record<string, unknown>> : {};
  for (const [type, p] of Object.entries(parts).sort(([a], [b]) => a.localeCompare(b))) {
    const choice = isObj(p) ? p.fontFamily : undefined;
    if (typeof choice !== 'string' || !(choice in PART_FACE) || PART_FACE[choice] === null) continue;
    const ref = PART_FACE[choice]!;
    const face = ref.startsWith('font') ? typefaceOf(String(st[ref] ?? '')) : ref;
    uses.push({ token: tokenRef(subject, 'skin', `parts.${type}.fontFamily`), face, label: choice, fixValue: 'theme' });
  }
  const faces: string[] = [];
  for (const u of uses) if (!faces.includes(u.face)) faces.push(u.face);
  const max = settings.typography.maxFamilies;
  if (faces.length <= max) return;
  const allowed = faces.slice(0, max);
  const reported = new Set<string>();
  for (const u of uses) {
    if (allowed.includes(u.face) || reported.has(`${u.token.path}`)) continue;
    reported.add(u.token.path);
    const toBody = u.token.type === 'skin' ? 'the theme font' : `the body face (${display(body)})`;
    ctx.report({
      token: u.token,
      value: u.label,
      expected: `at most ${max} typefaces: ${allowed.join(', ')}`,
      message: `${u.token.path} brings in ${u.label}, typeface ${faces.indexOf(u.face) + 1} of ${faces.length} (max ${max}).`,
      measured: faces.length,
      fix: { kind: 'set', label: `Use ${toBody}`, writes: [{ token: { type: u.token.type, id: u.token.id, path: u.token.path }, value: u.fixValue }] },
    });
  }
});

/** Sizing text-size paths: em-unit fields that are not icons. */
export const SIZING_TEXT_PATHS: readonly string[] = Object.entries(SCALE_FIELDS.sizing).filter(([k, f]) => f[3] === 'em' && !/icon/i.test(k)).map(([k]) => k);

function num(data: unknown, path: string): number | null {
  let cur: unknown = data;
  for (const p of path.split('.')) {
    if (!isObj(cur)) return null;
    cur = cur[p];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : null;
}

export const typographyOffScale: SkinCheckRule = defineRule('typography.off-scale', ['typography'], (ctx) => {
  const { subject, settings } = ctx;
  const typo = subject.typography!.data;
  const steps = numericLeaves(typo, 'scale');
  if (!steps.length) return;
  // 1em is the body size itself, always a step.
  if (!steps.some((s) => s.value === 1)) steps.push({ name: 'body (1em)', value: 1 });
  const tol = settings.typography.sizeTolerance;
  const check = (type: 'typography' | 'sizing', path: string, v: number | null) => {
    if (v === null || v <= 0) return;
    const near = nearestStep(v, steps)!;
    if (onStep(v, near, tol)) return;
    ctx.report({
      token: tokenRef(subject, type, path, scaleVar(type, path)),
      value: v,
      expected: `a type-scale step: ${stepList(steps)}`,
      message: `${path} is ${fmt(v)}em, off the type scale; nearest step ${near.name} is ${fmt(near.value)}.`,
      measured: round(Math.abs(v - near.value)),
      fix: { kind: 'set', label: `Snap to ${near.name} (${fmt(near.value)})`, writes: [{ token: tokenRef(subject, type, path), value: near.value }] },
    });
  };
  for (const h of numericLeaves(typo, 'headings')) if (h.name !== 'headings.tracking') check('typography', h.name, h.value);
  check('typography', 'eyebrow.size', num(typo, 'eyebrow.size'));
  if (subject.sizing) for (const path of SIZING_TEXT_PATHS) check('sizing', path, num(subject.sizing.data, path));
});

export const TYPOGRAPHY_RULES: readonly SkinCheckRule[] = [typographyFontFamilies, typographyOffScale];
