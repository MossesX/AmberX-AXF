/**
 * The compiled `--fx-*` map of a skin-check subject: what the page reads for this look. Pure.
 *
 * Mirrors the framework's theme engine (framework/core/engines/theme.ts colorThemeVars / styleThemeVars at the
 * regular spacing) and the scale engine (scale-rules.mjs scaleVars), so a rule can name the variable a token compiles
 * to on an issue (`cssVar`) and read what the page reads. The engine recomputes it after every fix write.
 */
import { scaleVars } from '../../../framework/core/engines/scale-rules.mjs';
import type { SkinCheckSubject } from './contract.ts';

const kebab = (s: string): string => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const DENSITY: Record<string, number> = { compact: 0.78, comfortable: 1, spacious: 1.22 };

/** `--fx-<token>` for a colour-theme token key (`accentText` → `--fx-accent-text`). */
export const colorVar = (token: string): string => `--fx-${kebab(token)}`;

/** The `--fx-*` variable a style-theme path compiles to, or undefined when it has none. */
export function styleVar(path: string): string | undefined {
  const map: Record<string, string> = {
    fontFamily: '--fx-font', fontDisplay: '--fx-font-display', fontMono: '--fx-font-mono', fontSize: '--fx-font-size',
    'radius.sm': '--fx-radius-sm', 'radius.md': '--fx-radius-md', 'radius.lg': '--fx-radius-lg', space: '--fx-space',
    borderWidth: '--fx-border-w', 'shadow.sm': '--fx-shadow-sm', 'shadow.md': '--fx-shadow-md', 'shadow.lg': '--fx-shadow-lg',
  };
  return map[path];
}

/** The `--fx-type-* / --fx-dens-* / --fx-size-*` variable of a scale path (`gap.md` → `--fx-dens-gap-md`). */
export function scaleVar(type: 'typography' | 'density' | 'sizing', path: string): string {
  const prefix = { typography: 'type', density: 'dens', sizing: 'size' }[type];
  return `--fx-${prefix}-${path.split('.').map(kebab).join('-')}`;
}

export function subjectVars(subject: Omit<SkinCheckSubject, 'vars'>): Record<string, string> {
  const vars: Record<string, string> = {};
  const c = subject.colorTheme?.data;
  if (c?.tokens) for (const [k, v] of Object.entries(c.tokens)) if (typeof v === 'string') vars[colorVar(k)] = v;
  const s = subject.styleTheme?.data;
  if (s) {
    const d = DENSITY[s.density] ?? 1;
    const put = (k: string, v: unknown, unit = '') => { if (v !== undefined && v !== null) vars[k] = `${v}${unit}`; };
    put('--fx-font', s.fontFamily);
    put('--fx-font-display', s.fontDisplay);
    put('--fx-font-mono', s.fontMono);
    put('--fx-font-size', s.fontSize, 'px');
    for (const k of ['sm', 'md', 'lg'] as const) {
      put(`--fx-radius-${k}`, s.radius?.[k], 'px');
      put(`--fx-shadow-${k}`, s.shadow?.[k]);
    }
    if (typeof s.space === 'number') vars['--fx-space'] = `${Math.round(s.space * d * 10) / 10}px`;
    put('--fx-border-w', s.borderWidth, 'px');
  }
  for (const t of ['typography', 'density', 'sizing'] as const) {
    const a = subject[t];
    if (a) Object.assign(vars, scaleVars(t, a.data));
  }
  return vars;
}
