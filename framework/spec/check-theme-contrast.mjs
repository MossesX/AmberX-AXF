#!/usr/bin/env node
/**
 * Colour theme contrast (skin pass, build fable-full-audit-ui-overhaul-conso s12, Nov 2026, Brett: "go through the
 * skin and make it really good, light and dark, every token used consistently").
 *
 * Every shipped colour theme (framework/assets/color-theme, so every future theme too), light and dark, must keep the
 * tokens the UI draws text with readable on the surfaces it draws them on: WCAG AA (4.5:1) for `text`, `muted`,
 * `accent`, `danger`, `success`, `warning` and `info` on `bg` and `surface`, and `accentText` on `accent` (filled
 * buttons). It also checks the token set is complete and consistent: the same keys in every theme, a `scheme`, and
 * `focus` equal to `accent` or itself readable on `bg` (3:1, a focus ring is a non-text element).
 *
 *   node framework/spec/check-theme-contrast.mjs [--json]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/color-theme');
const AA = 4.5;
const NON_TEXT = 3;
const KEYS = ['accent', 'accentSoft', 'accentText', 'bg', 'border', 'danger', 'focus', 'info', 'muted', 'shadow', 'success', 'surface', 'surface2', 'surface3', 'text', 'warning'];
const TEXT = ['text', 'muted', 'accent', 'danger', 'success', 'warning', 'info'];
const ON = ['bg', 'surface'];

const rgb = (v) => {
  const h = String(v ?? '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
  if (m) { const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]; return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(h);
  return m ? [m[1], m[2], m[3]].map(Number) : null;
};
const lum = (c) => { const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const problems = [];
const rows = [];
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
for (const f of files) {
  const a = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const id = a.id ?? f;
  const t = a.data?.tokens ?? {};
  if (!['light', 'dark'].includes(a.data?.scheme)) problems.push(`${id}: no light / dark scheme`);
  const keys = Object.keys(t).sort();
  const missing = KEYS.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !KEYS.includes(k));
  if (missing.length) problems.push(`${id}: missing token(s) ${missing.join(', ')}`);
  if (extra.length) problems.push(`${id}: unknown token(s) ${extra.join(', ')}`);
  const c = Object.fromEntries(KEYS.map((k) => [k, rgb(t[k])]));
  for (const k of [...TEXT, 'bg', 'surface', 'accentText']) if (t[k] !== undefined && !c[k]) problems.push(`${id}: ${k} "${t[k]}" is not a solid colour`);
  let worst = Infinity;
  const pair = (fg, bg, min) => {
    if (!c[fg] || !c[bg]) return;
    const r = contrast(c[fg], c[bg]);
    worst = Math.min(worst, r);
    if (r < min) problems.push(`${id}: ${fg} on ${bg} is ${r.toFixed(2)}:1 (needs ${min}:1)`);
  };
  for (const fg of TEXT) for (const bg of ON) pair(fg, bg, AA);
  pair('accentText', 'accent', AA);
  if (t.focus !== t.accent) pair('focus', 'bg', NON_TEXT);
  rows.push({ id, scheme: a.data?.scheme ?? '', worst: Number.isFinite(worst) ? Number(worst.toFixed(2)) : null });
}

// engine sanity
const near = (x, y) => Math.abs(x - y) < 0.01;
if (!near(contrast([0, 0, 0], [255, 255, 255]), 21)) problems.push('contrast maths: black on white is not 21:1');
if (!near(contrast([119, 119, 119], [255, 255, 255]), 4.48)) problems.push('contrast maths: #777 on white is not 4.48:1');

if (process.argv.includes('--json')) console.log(JSON.stringify({ themes: rows, problems }, null, 2));
if (problems.length) {
  console.error(`check-theme-contrast: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-theme-contrast: ok (${files.length} colour themes, light and dark, every text token at WCAG AA on bg and surface)`);
