/**
 * Skin shots (skin-coverage@1, the screenshot gate): every skin and design package rendered against the framework
 * stylesheet, element by element, compared with the default look. An element that looks the same under a skin as
 * under the default is "unchanged": the skin didn't reach it.
 *
 *   npx -y tsx framework/cli/skin-shots.mts check [--skin a,b] [--out <dir>] [--json]   the gate (CI): fails on an
 *        unchanged element that isn't in spec/skin-shots-baseline.json; --out saves <skin>-desktop.png / -phone.png
 *   npx -y tsx framework/cli/skin-shots.mts baseline                                    rewrite the baseline (ratchet)
 *   npx -y tsx framework/cli/skin-shots.mts html <skin|default>                         the gallery page, to stdout
 *
 * The gallery is every screen region a skin styles: one element for each style-target root, item and text child in
 * schemas/customize.json (banner, toolbar, menus, nav, tabs, dialog, popups, buttons, cards, search, sliders, gauges,
 * meters, badges and every banner widget). Each skin is drawn the way the runtime draws it: its colour and style
 * themes (engines/theme.ts), its typography, density and sizing assets (engines/scale.ts), its spacing, and its style
 * parts through the customize engine. Slot assets that a React component reads as props (a button asset's shape, a
 * container's header) are checked by spec/check-skin.mts, not here.
 *
 * Playwright + Chromium: resolved from apps/console-web (CI installs it there), the working folder, or
 * AXF_PLAYWRIGHT (a folder holding node_modules/playwright).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { colorThemeVars, scrollbarVars, styleThemeVars } from '../core/engines/theme';
import { scaleThemeVars } from '../core/engines/scale';
import { CUSTOM_TARGETS, customizeSheet } from '../core/engines/customize';
import { normalizeSkin, skinFromDesignPackage, type SkinData } from '../core/engines/skin';
import { SPACING_DEFAULT, type Spacing } from '../core/engines/spacing';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FW = join(ROOT, 'framework');
const BASELINE = join(FW, 'spec/skin-shots-baseline.json');
const readJson = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const asset = (type: string, id: string | undefined) => {
  const f = id ? join(FW, 'assets', type, `${id}.json`) : '';
  return f && existsSync(f) ? readJson(f).data : null;
};

/** Computed properties that make up an element's look. */
export const LOOK_PROPS = ['color', 'background-color', 'background-image', 'border-top-color', 'border-top-width', 'border-top-style',
  'border-top-left-radius', 'box-shadow', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height',
  'text-transform', 'text-decoration-line', 'padding-top', 'padding-left', 'min-height', 'opacity', 'outline-width'];

/** The colour properties: an element where only these change kept its shape, weight and type (SKIN-AUDIT.md). */
export const COLOUR_PROPS = ['color', 'background-color', 'background-image', 'border-top-color', 'box-shadow'];

export interface Look { id: string; name: string; kind: 'default' | 'skin' | 'design-package'; skin: SkinData | null }

/** Every look to check: the default first, then the skins, then the design packages. */
export function looks(): Look[] {
  const list = (type: string) => readdirSync(join(FW, 'assets', type)).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(FW, 'assets', type, f)));
  return [
    { id: 'default', name: 'Default', kind: 'default', skin: null },
    ...list('skin').map((a) => ({ id: a.id, name: a.name, kind: 'skin' as const, skin: normalizeSkin(a.data) })),
    ...list('design-package').map((a) => ({ id: a.id, name: a.name, kind: 'design-package' as const, skin: skinFromDesignPackage(a.data) })),
  ];
}

/** The root variables and the parts sheet a look puts on the page. */
export function lookCss(skin: SkinData | null): string {
  const d = readJson(join(FW, 'defaults.json'));
  const slot = (t: string) => skin?.assets?.[t] || d[t];
  const color = asset('color-theme', skin?.colorTheme || d['color-theme']);
  const style = asset('style-theme', skin?.styleTheme || d['style-theme']);
  const spacing = (skin?.extras?.spacing as Spacing | undefined) ?? SPACING_DEFAULT;
  const vars = {
    ...(color ? colorThemeVars(color) : {}),
    ...(style ? { ...styleThemeVars(style, spacing), ...scrollbarVars(style) } : {}),
    ...scaleThemeVars({ typography: asset('typography', slot('typography')), density: asset('density', slot('density')), sizing: asset('sizing', slot('sizing')) }),
  };
  const root = `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`;
  return `${root}\n${customizeSheet((skin?.parts ?? {}) as Record<string, Record<string, string | number | boolean>>)}`;
}

const split = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
const cls = (sel: string) => sel.replace(/^\./, '');
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** One gallery element per style-target root, item and text child: `data-sk="<type> <selector>"`. */
export function galleryElements(): { key: string; html: string }[] {
  const out: { key: string; html: string }[] = [];
  for (const [type, t] of Object.entries(CUSTOM_TARGETS)) {
    const [first, ...rest] = split(t.root);
    const inner = [
      ...split(t.item).map((s) => `<span class="${cls(s)}" data-sk="${type} ${s}">Item</span>`),
      ...split(t.text).map((s) => `<span class="${cls(s)}" data-sk="${type} ${s}">Text 42</span>`),
    ].join('');
    const parts = [`<div class="${cls(first)}" data-sk="${type} ${first}">${esc(type)} ${inner}</div>`,
      ...rest.map((s) => `<div class="${cls(s)}" data-sk="${type} ${s}">${esc(type)}</div>`)];
    out.push({ key: type, html: `<section class="sk-cell"><h3 class="sk-name">${esc(type)}</h3>${parts.join('')}</section>` });
  }
  return out;
}

export function galleryHtml(look: Look): string {
  const axf = readFileSync(join(FW, 'ui/axf.css'), 'utf8');
  // page layout only: the cells hold every element in flow, so a hidden or popup element still has a computed look
  const page = 'body{margin:0;padding:var(--fx-dens-gap-md);background:var(--fx-bg);color:var(--fx-text);font-family:var(--fx-font)}'
    + '.sk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(var(--fx-font-size) * 16),1fr));gap:var(--fx-dens-gap-md)}'
    + '.sk-cell{position:relative;display:flex;flex-direction:column;gap:var(--fx-dens-gap-sm);padding:var(--fx-dens-gap-sm);border:var(--fx-border-w) solid var(--fx-border);border-radius:var(--fx-radius-md)}'
    + '.sk-cell > *{position:relative !important;inset:auto !important;transform:none !important;visibility:visible !important;max-width:100%}'
    + '.sk-name{margin:0;font-size:var(--fx-type-root-xs);color:var(--fx-muted)}';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(look.name)}</title><style>${axf}</style><style>${page}</style><style>${lookCss(look.skin)}</style></head>`
    + `<body><h2>${esc(look.name)}</h2><main class="sk-grid">${galleryElements().map((e) => e.html).join('')}</main></body></html>`;
}

async function playwright(): Promise<{ chromium: { launch(): Promise<any> } }> {
  const bases = [process.env.AXF_PLAYWRIGHT, join(ROOT, 'apps/console-web'), process.cwd(), ROOT].filter(Boolean) as string[];
  for (const b of bases) { try { return createRequire(join(b, 'x.js'))('playwright'); } catch { /* next */ } }
  try { return (await import('playwright' as string)) as never; } catch {
    console.error('skin-shots: playwright not found (npm i --no-save playwright in apps/console-web, or AXF_PLAYWRIGHT=<folder>)');
    process.exit(2);
  }
}

type Sig = Record<string, string>;
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

/** Each look's computed look per gallery element, plus screenshots when `out` is set. */
export async function capture(list: Look[], out?: string): Promise<Map<string, Map<string, Sig>>> {
  const { chromium } = await playwright();
  const browser = await chromium.launch();
  const res = new Map<string, Map<string, Sig>>();
  try {
    const page = await browser.newPage({ viewport: VIEWPORTS.desktop });
    for (const look of list) {
      await page.setContent(galleryHtml(look), { waitUntil: 'load' });
      const sigs: [string, Sig][] = await page.evaluate((props: string[]) => [...document.querySelectorAll('[data-sk]')].map((el) => {
        const cs = getComputedStyle(el);
        return [el.getAttribute('data-sk')!, Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]))] as [string, Record<string, string>];
      }), LOOK_PROPS);
      res.set(look.id, new Map(sigs));
      if (out) {
        mkdirSync(out, { recursive: true });
        for (const [name, vp] of Object.entries(VIEWPORTS)) {
          await page.setViewportSize(vp);
          await page.screenshot({ path: join(out, `${look.id}-${name}.png`), fullPage: true });
        }
        await page.setViewportSize(VIEWPORTS.desktop);
      }
    }
  } finally { await browser.close(); }
  return res;
}

/** Elements a look leaves as the default draws them: `props` = every look property, or the shape and type ones only. */
export function unchanged(base: Map<string, Sig>, mine: Map<string, Sig>, props: string[] = LOOK_PROPS): string[] {
  const same: string[] = [];
  for (const [k, sig] of mine) {
    const b = base.get(k);
    if (b && props.every((p) => b[p] === sig[p])) same.push(k);
  }
  return same.sort();
}
const SHAPE_PROPS = LOOK_PROPS.filter((p) => !COLOUR_PROPS.includes(p));

/** `unchanged`: nothing differs from the default; `colourOnly`: only the colours differ (shape, weight and type kept). */
export interface Report { id: string; kind: Look['kind']; elements: number; unchanged: string[]; colourOnly: string[]; fresh: string[]; fixed: string[]; sameAsDefault: boolean }

async function run(cmd: string, args: string[]) {
  const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const all = looks();
  if (cmd === 'html') {
    const look = all.find((l) => l.id === args[0]);
    if (!look) throw new Error(`no skin "${args[0]}": one of ${all.map((l) => l.id).join(', ')}`);
    process.stdout.write(galleryHtml(look));
    return 0;
  }
  if (cmd !== 'check' && cmd !== 'baseline') { console.error('usage: skin-shots.mts check [--skin a,b] [--out dir] [--json] | baseline | html <skin>'); return 2; }
  const want = opt('skin')?.split(',').map((s) => s.trim());
  const list = all.filter((l) => l.kind === 'default' || !want || want.includes(l.id));
  if (want) for (const w of want) if (!all.some((l) => l.id === w)) throw new Error(`no skin "${w}"`);
  const defCss = lookCss(null);
  const sigs = await capture(list, opt('out'));
  const base = sigs.get('default')!;
  const doc = existsSync(BASELINE) ? readJson(BASELINE) : {};
  const reports: Report[] = list.filter((l) => l.kind !== 'default').map((l) => {
    const mine = sigs.get(l.id)!;
    const same = unchanged(base, mine);
    const colourOnly = unchanged(base, mine, SHAPE_PROPS).filter((k) => !same.includes(k));
    // baseline keys: "<element>" = unchanged, "<element> (colour only)" = only its colours follow the skin
    const now = [...same, ...colourOnly.map((k) => `${k} (colour only)`)];
    const known = new Set<string>([...(doc.unchanged?.[l.id] ?? [])]);
    const sameAsDefault = lookCss(l.skin) === defCss;
    return { id: l.id, kind: l.kind, elements: mine.size, unchanged: same, colourOnly, fresh: sameAsDefault ? [] : now.filter((k) => !known.has(k)), fixed: [...known].filter((k) => !now.includes(k)), sameAsDefault };
  });
  if (cmd === 'baseline') {
    const keys = (r: Report) => [...r.unchanged, ...r.colourOnly.map((k) => `${k} (colour only)`)];
    const next = { $comment: 'Elements a skin leaves as the default draws them, or changes only the colours of (framework/cli/skin-shots.mts). The gate fails on any new one; shrink this with `skin-shots.mts baseline` after a fix, never grow it to pass.', unchanged: Object.fromEntries(reports.filter((r) => !r.sameAsDefault && keys(r).length).map((r) => [r.id, keys(r)])) };
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
    console.log(`skin-shots: baseline written, ${reports.reduce((n, r) => n + (r.sameAsDefault ? 0 : keys(r).length), 0)} entries across ${reports.length} skins`);
    return 0;
  }
  if (args.includes('--json')) console.log(JSON.stringify(reports, null, 2));
  else for (const r of reports) {
    const tag = r.sameAsDefault ? 'same as default (skipped)' : `${r.elements - r.unchanged.length - r.colourOnly.length}/${r.elements} restyled, ${r.colourOnly.length} colour only, ${r.unchanged.length} unchanged`;
    console.log(`${r.fresh.length ? '✗' : '✓'} ${r.id} (${r.kind}): ${tag}${r.fresh.length ? `; NEW unchanged: ${r.fresh.join(', ')}` : ''}${r.fixed.length ? `; now restyled (shrink the baseline): ${r.fixed.length}` : ''}`);
  }
  const bad = reports.filter((r) => r.fresh.length);
  if (bad.length) { console.error(`skin-shots: ${bad.length} skin(s) leave elements unchanged that the baseline doesn't allow. Fix the CSS so the skin reaches them (SKIN-AUDIT.md).`); return 1; }
  if (opt('out')) console.log(`skin-shots: screenshots in ${opt('out')}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv[2] ?? 'check', process.argv.slice(3)).then((c) => process.exit(c), (e) => { console.error(`skin-shots: ${e.message}`); process.exit(2); });
}
