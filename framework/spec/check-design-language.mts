/**
 * The enterprise quality bar (framework/spec/DESIGN-LANGUAGE.md) checked against every starter asset:
 *   §2/§5  style themes: base size 13–16, space 6–12, radii sm ≤ md ≤ lg within 0–24, motion 80–320 ms
 *   §6     colour themes: text on surface ≥ 4.5:1, accent text on accent ≥ 4.5:1, muted on surface ≥ 3:1,
 *          hairline border on surface ≥ 1.25:1 (hex tokens only; a token that isn't hex is skipped, not failed)
 *   §7     behaviour themes: a fixed speed lies in the 80–320 ms base range
 *   §9/§10 icon packs 16–48 grid with stroke 1.5–2.25 on outline packs; marks ≤ 24 KB of path data, minimum
 *          size ≥ 16 (mark) / ≥ 80 (wordmark), every id lowercase; animated logos ≥ 4× the base motion
 *   §11    banners 16–48 high; toolbars ≤ 12 visible items per toolbar; context menus ≤ 12 first-level items;
 *          app menus ≤ 9 top menus
 * Also runs the brand generators once (deterministic sample) and holds their output to the same bar.
 *   npx -y tsx framework/spec/check-design-language.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { contrast, generateAnimated, generateIconPack, generateMark, assetErrors } from '../cli/brand-gen.mjs';
import { normalizeMark } from '../core/engines/brand-rules.mjs';

let n = 0;
const failures: string[] = [];
const ok = (c: unknown, m: string) => { if (c) n++; else failures.push(m); };
const root = new URL('../assets/', import.meta.url);
const list = (type: string) => existsSync(new URL(type, root)) ? readdirSync(new URL(`${type}/`, root)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(`${type}/${f}`, root), 'utf8'))) : [];
const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/* §2 §5 style themes */
for (const a of list('style-theme')) {
  const d = a.data;
  ok(d.fontSize >= 13 && d.fontSize <= 16, `${a.id}: base size 13–16 (${d.fontSize})`);
  ok(d.space >= 6 && d.space <= 12, `${a.id}: space 6–12 (${d.space})`);
  ok(d.radius.sm <= d.radius.md && d.radius.md <= d.radius.lg && d.radius.sm >= 0 && d.radius.lg <= 24, `${a.id}: radii ordered within 0–24`);
  ok(d.motion >= 80 && d.motion <= 320, `${a.id}: motion 80–320 ms (${d.motion})`);
}

/* §6 colour themes */
for (const a of list('color-theme')) {
  const t = a.data.tokens;
  const pair = (fg: string, bg: string, min: number, what: string) => { if (hex(t[fg]) && hex(t[bg])) ok(contrast(t[fg], t[bg]) >= min, `${a.id}: ${what} ≥ ${min}:1 (${contrast(t[fg], t[bg]).toFixed(2)})`); };
  pair('text', 'surface', 4.5, 'text on surface');
  pair('text', 'bg', 4.5, 'text on bg');
  pair('accentText', 'accent', 4.5, 'accent text on accent');
  pair('muted', 'surface', 3, 'muted on surface');
  pair('border', 'surface', 1.25, 'hairline border on surface');
}

/* §7 behaviour themes */
const MOTION_MS: Record<string, number> = { instant: 0, fast: 100, normal: 160, slow: 240, relaxed: 320 };
for (const a of list('behavior-theme')) {
  const s = a.data?.motion?.speed ?? 'theme';
  ok(s === 'theme' || s === 'instant' || (MOTION_MS[s] >= 80 && MOTION_MS[s] <= 320), `${a.id}: speed ${s} within the base range`);
}

/* §9 §10 brand assets */
const base = 160;
for (const a of list('icon-pack')) {
  const d = a.data;
  ok(d.grid >= 16 && d.grid <= 48, `${a.id}: grid 16–48`);
  if (d.style !== 'filled') ok(d.stroke >= 1.5 && d.stroke <= 2.25, `${a.id}: outline stroke 1.5–2.25 (${d.stroke})`);
  ok(Object.keys(d.glyphs).every((g) => /^[a-z][a-z0-9-]*$/.test(g)), `${a.id}: glyph names lowercase`);
}
for (const a of list('logo-mark')) {
  const m = normalizeMark(a.data);
  const chars = m.paths.reduce((s: number, p: { d: string }) => s + p.d.length, 0);
  ok(chars <= 24000, `${a.id}: path data ≤ 24 KB`);
  ok(m.form === 'mark' ? m.minSize >= 16 : m.minSize >= 80 || m.form === 'lockup', `${a.id}: minimum size (${m.form} ${m.minSize})`);
  ok(/^[a-z][a-z0-9-]*$/.test(a.id), `${a.id}: lowercase id`);
  ok(m.safeArea >= 0.2, `${a.id}: clear space ≥ 0.2 of the height`);
}
for (const a of list('animated-logo')) ok(a.data.durationMs >= base * 4 || a.data.preset === 'draw', `${a.id}: attention motion ≥ 4× base (${a.data.durationMs})`);
for (const a of list('branding')) ok(a.data.brand?.name && a.data.marks?.mark, `${a.id}: a name and a mark`);

/* §11 chrome */
for (const a of list('banner')) ok((a.data.height ?? 24) >= 16 && (a.data.height ?? 24) <= 48, `${a.id}: banner 16–48 high`);
for (const a of list('toolbar')) { const items = (a.data.groups ?? []).reduce((s: number, g: { items?: unknown[] }) => s + (g.items?.length ?? 0), 0); ok(items <= 12, `${a.id}: ≤ 12 toolbar items (${items})`); }
for (const a of list('context-menu')) for (const [target, items] of Object.entries(a.data.targets ?? {})) ok((items as unknown[]).length <= 12, `${a.id}/${target}: ≤ 12 first-level items`);
for (const a of list('app-menu')) ok((a.data.menus ?? []).length <= 9, `${a.id}: ≤ 9 top menus (${a.data.menus?.length})`);

/* generators held to the same bar (deterministic sample) */
{
  const marks = Array.from({ length: 40 }, (_, i) => generateMark(i + 1, { brand: 'Sample' }));
  for (const m of marks) ok(assetErrors(m).length === 0, `generated ${m.id} validates`);
  ok(marks.every((m) => contrast(m.data.palette.brand1, '#ffffff') >= 3), 'generated brand1 reads ≥ 3:1 on white');
  assert.deepEqual(generateMark(7, { brand: 'Sample' }), generateMark(7, { brand: 'Sample' })); n++;
  const anims = Array.from({ length: 20 }, (_, i) => generateAnimated(i + 1, marks.map((m) => m.id)));
  for (const a of anims) ok(assetErrors(a).length === 0 && a.data.durationMs >= 600, `generated ${a.id} validates`);
  const basePack = list('icon-pack')[0];
  if (basePack) for (let i = 1; i <= 10; i++) { const p = generateIconPack(i, basePack); ok(assetErrors(p).length === 0 && Object.keys(p.data.glyphs).length === Object.keys(basePack.data.glyphs).length, `generated pack ${i} keeps every glyph`); }
}

if (failures.length) { for (const f of failures) console.error(`✗ ${f}`); console.error(`check-design-language: ${failures.length} of ${n + failures.length} checks failed (framework/spec/DESIGN-LANGUAGE.md)`); process.exit(1); }
console.log(`check-design-language: ${n} checks passed`);
