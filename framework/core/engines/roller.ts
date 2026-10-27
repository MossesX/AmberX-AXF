/**
 * Interface roller (interface-roller s4–s5): one seeded, coherent roll of a whole interface — every slot, not a
 * random mix. Given the app's current assets (for structure: its actions, pages and menu items are never dropped)
 * and the asset-type registry (enums and the ranges known assets use), `rollInterface(seed, env, locks)` returns a
 * complete set of new assets plus a design package and an interface that ties them together:
 *
 *   look        colour theme (harmonised palette, contrast-checked for the scheme), style theme (type pairing,
 *               radii / density / elevation / motion families), behaviour theme, layout
 *   controls    button, container, dialog, popup, slider, tab-group, gauge, meter (enum picks + known ranges)
 *   chrome      banner, app menu, toolbar, nav menu, context menus — rebuilt from the app's own items (regrouped,
 *               restyled, every action kept), settings interface
 *   brand       a new logo mark, animated logo, icon pack (restyled from the app's pack) and branding package
 *
 * Locks (`locks.<part>` = true) keep the current asset of that part. Reproducible: same seed + same env = same
 * result. Pure: fixture `spec/fixtures/roller.json`, checker `spec/check-roller.mts`. Kotlin twin deferred.
 */
import { contrast, generateAnimated, generateIconPack, generateMark, hslToHex, seededRandom } from './brandgen.mjs';
import { BRAND_SLOTS, BRAND_SLOT_MODES } from './brand-rules.mjs';
import type { AssetEnvelope } from '../types';

export type RollerAsset = AssetEnvelope<Record<string, unknown>> & { type: string };

export interface RollerEnv {
  /** the app's id + name (brand name of the rolled branding) */
  app: { id: string; name: string };
  /** asset type → spec (asset-types.json entry: enums, required, nested) */
  specs: Record<string, { enums?: Record<string, string[]>; required?: string[]; nested?: Record<string, string[]>; hideable?: boolean; widget?: boolean; attachable?: boolean }>;
  /** every asset the app ships, by type (ranges, string values and the current structure come from here) */
  assets: Record<string, RollerAsset[]>;
  /** the active asset id per type (the structure source and the lock fallback) */
  active: Record<string, string>;
}

/** Parts of an interface a roll may lock (kept from the current interface). */
export const ROLL_PARTS = ['color', 'style', 'behavior', 'layout', 'controls', 'banner', 'app-menu', 'toolbar', 'nav-menu', 'context-menu', 'settings', 'brand'] as const;
export type RollPart = (typeof ROLL_PARTS)[number];
export type RollLocks = Partial<Record<RollPart, boolean>>;

export interface RollResult {
  id: string;
  name: string;
  /** every generated asset, in dependency order (themes, controls, chrome, brand, design package, interface) */
  assets: RollerAsset[];
  /** slot → asset id the interface sets (generated or kept) */
  slots: Record<string, string>;
  /** the parts that were rolled vs kept */
  rolled: RollPart[];
  kept: RollPart[];
  /** one line per decision, for the roller's "what changed" note */
  notes: string[];
}

const CONTROL_TYPES = ['button', 'container', 'dialog', 'popup', 'slider', 'tab-group', 'gauge', 'meter'];
const pick = <T,>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const between = (rnd: () => number, lo: number, hi: number, step = 1) => Math.round((lo + rnd() * (hi - lo)) / step) * step;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Type pairings: display + body + mono stacks that read well together (system fonts; apps add their own). */
export const TYPE_PAIRS: { name: string; display: string; body: string; mono: string }[] = [
  { name: 'Inter', display: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", mono: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" },
  { name: 'Humanist', display: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif", body: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif", mono: "'Source Code Pro', ui-monospace, monospace" },
  { name: 'Grotesk', display: "'Space Grotesk', 'Helvetica Neue', system-ui, sans-serif", body: "'IBM Plex Sans', system-ui, sans-serif", mono: "'IBM Plex Mono', ui-monospace, monospace" },
  { name: 'Editorial', display: "'Fraunces', Georgia, serif", body: "'Public Sans', system-ui, sans-serif", mono: "'DM Mono', ui-monospace, monospace" },
  { name: 'Rounded', display: "'Nunito', 'Varela Round', system-ui, sans-serif", body: "'Nunito', system-ui, sans-serif", mono: "'Fira Code', ui-monospace, monospace" },
  { name: 'Terminal', display: "'JetBrains Mono', ui-monospace, monospace", body: "'IBM Plex Sans', system-ui, sans-serif", mono: "'JetBrains Mono', ui-monospace, monospace" },
  { name: 'System', display: 'system-ui, -apple-system, sans-serif', body: 'system-ui, -apple-system, sans-serif', mono: 'ui-monospace, monospace' },
];

/** Shape families: radii + elevation + density move together so a roll is a look, not noise. */
const SHAPE_FAMILIES = [
  { name: 'sharp', radius: { sm: 2, md: 4, lg: 6 }, shadow: { sm: '0 1px 1px var(--fx-shadow)', md: '0 1px 3px var(--fx-shadow)', lg: '0 4px 14px var(--fx-shadow)' }, blur: 0 },
  { name: 'soft', radius: { sm: 6, md: 10, lg: 14 }, shadow: { sm: '0 1px 2px var(--fx-shadow)', md: '0 2px 4px var(--fx-shadow), 0 6px 16px var(--fx-shadow)', lg: '0 12px 40px var(--fx-shadow)' }, blur: 10 },
  { name: 'round', radius: { sm: 10, md: 16, lg: 22 }, shadow: { sm: '0 2px 4px var(--fx-shadow)', md: '0 6px 16px var(--fx-shadow)', lg: '0 18px 48px var(--fx-shadow)' }, blur: 16 },
  { name: 'flat', radius: { sm: 4, md: 6, lg: 10 }, shadow: { sm: 'none', md: '0 0 0 1px var(--fx-border)', lg: '0 0 0 1px var(--fx-border), 0 8px 24px var(--fx-shadow)' }, blur: 0 },
];

/* ---------------- colour ---------------- */

/** A harmonised, contrast-checked colour theme for a scheme (DESIGN-LANGUAGE §6). */
export function rollColorTokens(rnd: () => number, scheme: 'light' | 'dark', hue = between(rnd, 0, 359)): Record<string, string> {
  const sat = pick(rnd, [8, 12, 18, 28]);          // neutral tint strength
  const accentSat = between(rnd, 55, 92);
  const accentHue = (hue + pick(rnd, [0, 0, 30, -30, 150, 180])) % 360;
  const fix = (fg: string, bg: string, min: number, h: number, s: number, l: number, dir: 1 | -1) => { let c = fg; let L = l; for (let i = 0; i < 24 && contrast(c, bg) < min; i++) { L += dir * 3; c = hslToHex(h, s, Math.max(2, Math.min(98, L))); } return c; };
  if (scheme === 'light') {
    const bg = hslToHex(hue, sat, between(rnd, 95, 98));
    const surface = hslToHex(hue, Math.max(0, sat - 6), 100);
    const surface2 = hslToHex(hue, sat, 97);
    const surface3 = hslToHex(hue, sat + 4, 91);
    const text = hslToHex(hue, Math.min(40, sat + 10), between(rnd, 8, 14));
    const muted = fix(hslToHex(hue, sat, 45), surface, 3, hue, sat, 45, -1);
    const border = fix(hslToHex(hue, sat + 4, 90), surface, 1.25, hue, sat + 4, 90, -1);
    let accent = hslToHex(accentHue, accentSat, 48);
    accent = fix(accent, '#ffffff', 4.5, accentHue, accentSat, 48, -1);
    const status = (h: number) => fix(hslToHex(h, 70, 42), surface, 3, h, 70, 42, -1);
    return { bg, surface, surface2, surface3, text, muted, border, accent, accentText: '#ffffff', accentSoft: `color-mix(in srgb, ${accent} 10%, transparent)`, danger: status(4), success: status(152), warning: status(32), info: status(212), focus: hslToHex(accentHue, accentSat, 58), shadow: `color-mix(in srgb, ${hslToHex(hue, 40, 18)} 8%, transparent)` };
  }
  const bg = hslToHex(hue, sat + 6, between(rnd, 6, 10));
  const surface = hslToHex(hue, sat + 4, 11);
  const surface2 = hslToHex(hue, sat + 4, 14);
  const surface3 = hslToHex(hue, sat + 2, 20);
  const text = hslToHex(hue, 12, between(rnd, 90, 95));
  const muted = fix(hslToHex(hue, 10, 64), surface, 3, hue, 10, 64, 1);
  const border = fix(hslToHex(hue, sat + 2, 20), surface, 1.25, hue, sat + 2, 20, 1);
  let accent = hslToHex(accentHue, Math.min(90, accentSat), 62);
  const accentText = contrast(accent, '#0b0c10') >= 4.5 ? hslToHex(accentHue, 60, 8) : '#ffffff';
  accent = fix(accent, accentText, 4.5, accentHue, Math.min(90, accentSat), 62, accentText === '#ffffff' ? -1 : 1);
  const status = (h: number) => fix(hslToHex(h, 65, 60), surface, 3, h, 65, 60, 1);
  return { bg, surface, surface2, surface3, text, muted, border, accent, accentText, accentSoft: `color-mix(in srgb, ${accent} 16%, transparent)`, danger: status(4), success: status(152), warning: status(38), info: status(212), focus: hslToHex(accentHue, 70, 68), shadow: 'color-mix(in srgb, #000 45%, transparent)' };
}

/* ---------------- generic field rolling over the registry ---------------- */

/** Ranges a type's known assets use for each numeric field (top level + one nested level). */
function ranges(assets: RollerAsset[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  const note = (k: string, v: unknown) => { if (typeof v === 'number') { const r = out[k] ?? [v, v]; out[k] = [Math.min(r[0], v), Math.max(r[1], v)]; } };
  for (const a of assets) for (const [k, v] of Object.entries(a.data)) { note(k, v); if (isObj(v)) for (const [k2, v2] of Object.entries(v)) note(`${k}.${k2}`, v2); }
  return out;
}
function stringValues(assets: RollerAsset[], key: string): string[] { return [...new Set(assets.map((a) => a.data[key]).filter((v): v is string => typeof v === 'string'))]; }

/**
 * Roll the primitive, non-structural fields of `current` for a type: enums from the spec, booleans by coin, numbers
 * inside the range the type's known assets use (integers stay integers), strings from the other assets' values.
 * Arrays and nested objects of items (menus, groups, sections, targets, attach, glyphs, paths) are structure: kept.
 */
export function rollFields(rnd: () => number, type: string, current: Record<string, unknown>, env: RollerEnv, keep: readonly string[] = []): Record<string, unknown> {
  const spec = env.specs[type] ?? {};
  const known = env.assets[type] ?? [];
  const rg = ranges(known);
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(current)) {
    if (keep.includes(k) || Array.isArray(v) || (isObj(v) && !spec.nested?.[k])) continue;
    if (isObj(v)) { // one nested level (radius.sm …) — numbers only
      const o: Record<string, unknown> = { ...v };
      for (const [k2, v2] of Object.entries(v)) { const r = rg[`${k}.${k2}`]; if (typeof v2 === 'number' && r && r[0] !== r[1]) o[k2] = between(rnd, r[0], r[1], Number.isInteger(v2) ? 1 : 0.05); }
      out[k] = o; continue;
    }
    const e = spec.enums?.[k];
    if (e && e.length > 1) out[k] = pick(rnd, e);
    else if (typeof v === 'boolean') out[k] = rnd() < 0.5;
    else if (typeof v === 'number') { const r = rg[k]; if (r && r[0] !== r[1]) out[k] = between(rnd, r[0], r[1], Number.isInteger(v) ? 1 : 0.05); }
    else if (typeof v === 'string' && !/^#|^rgba?\(/.test(v)) { const vals = stringValues(known, k); if (vals.length > 1) out[k] = pick(rnd, vals); }
  }
  return out;
}

/* ---------------- structure: the app's own items regrouped ---------------- */

type Item = Record<string, unknown> & { id?: string; label?: string; action?: string; items?: Item[]; separator?: boolean; view?: string };

/** Every leaf item (with an action, a view or a submenu) from a tree of menus, in order. */
export function collectItems(items: Item[] | undefined, out: Item[] = []): Item[] {
  for (const it of items ?? []) { if (it.separator) continue; if (Array.isArray(it.items) && it.items.length) { out.push({ ...it, items: collectItems(it.items as Item[]) }); } else if (it.action || it.view) out.push(it); }
  return out;
}
const prefixOf = (it: Item): string => (typeof it.action === 'string' ? it.action.split(/[.:]/)[0]! : typeof it.view === 'string' ? 'view' : 'other');

/** Regroup flat items into `n` groups by action family, in a stable order; every item lands exactly once. */
export function regroup(items: Item[], n: number): Item[][] {
  const families = new Map<string, Item[]>();
  for (const it of items) { const f = prefixOf(it); if (!families.has(f)) families.set(f, []); families.get(f)!.push(it); }
  const fams = [...families.values()];
  const groups: Item[][] = Array.from({ length: Math.max(1, Math.min(n, fams.length)) }, () => []);
  fams.forEach((f, i) => groups[i % groups.length]!.push(...f));
  return groups.filter((g) => g.length);
}

/** The app menu rebuilt: the same items (plus any toolbar / nav item not in it) under 3–7 menus by family. */
export function rollAppMenu(rnd: () => number, current: Record<string, unknown>, extra: Item[], env: RollerEnv): Record<string, unknown> {
  const menus = Array.isArray(current.menus) ? (current.menus as { label: string; items: Item[] }[]) : [];
  const own = menus.flatMap((m) => collectItems(m.items));
  const seen = new Set(own.map((it) => it.action ?? `view:${it.view}`));
  const all = [...own, ...extra.filter((it) => !seen.has(it.action ?? `view:${it.view}`))];
  const groups = regroup(all, between(rnd, 3, Math.min(7, Math.max(3, menus.length + 1))));
  const label = (g: Item[], i: number) => { const f = prefixOf(g[0]!); return f === 'view' ? 'Go' : f === 'other' ? 'More' : f.charAt(0).toUpperCase() + f.slice(1) + (groups.filter((x) => prefixOf(x[0]!) === f).length > 1 ? ` ${i + 1}` : ''); };
  const seenIds = new Set<string>();
  const uid = (base: string) => { let id = base; let n = 2; while (seenIds.has(id)) id = `${base}-${n++}`; seenIds.add(id); return id; };
  const styled = rollFields(rnd, 'app-menu', current, env, ['menus']);
  return { ...styled, menus: groups.map((g, i) => ({ id: uid(slug(label(g, i))), label: label(g, i), items: g.map((it, j) => ({ ...it, id: uid(String(it.id ?? `i${j}`)) })) })) };
}

/** The toolbar rebuilt: the same items in 2–5 groups (every item kept; the visible-12 bar is for starters, the app's own items all stay). */
export function rollToolbar(rnd: () => number, current: Record<string, unknown>, env: RollerEnv): Record<string, unknown> {
  const groups = Array.isArray(current.groups) ? (current.groups as { items: Item[] }[]) : [];
  const items = groups.flatMap((g) => g.items ?? []);
  const re = regroup(items, between(rnd, 2, 5));
  const styled = rollFields(rnd, 'toolbar', current, env, ['groups', 'widgets', 'search']);
  return { ...styled, groups: re.map((g, i) => ({ id: `g${i + 1}`, items: g })) };
}

/** The nav menu rebuilt: the same entries (every page kept) in 1–4 sections, restyled; the header is the brand name. */
export function rollNavMenu(rnd: () => number, current: Record<string, unknown>, env: RollerEnv): Record<string, unknown> {
  const sections = Array.isArray(current.sections) ? (current.sections as { label?: string; items: Item[] }[]) : [];
  const items = sections.flatMap((s) => s.items ?? []);
  const n = between(rnd, 1, Math.min(4, Math.max(1, items.length)));
  const per = Math.ceil(items.length / n);
  const labels = ['Workspace', 'Build', 'Explore', 'System', 'Tools', 'More'];
  const out = Array.from({ length: n }, (_, i) => ({ label: sections[i]?.label ?? labels[i % labels.length]!, items: items.slice(i * per, (i + 1) * per) })).filter((s) => s.items.length);
  const styled = rollFields(rnd, 'nav-menu', current, env, ['sections']);
  return { ...styled, header: env.app.name, sections: out };
}

/** Context menus: every target's items kept in order (destructive ones stay last); only the style rolls. */
export function rollContextMenu(rnd: () => number, current: Record<string, unknown>, env: RollerEnv): Record<string, unknown> {
  return rollFields(rnd, 'context-menu', current, env, ['targets']);
}

/* ---------------- the roll ---------------- */

function asset(type: string, id: string, name: string, data: Record<string, unknown>, description: string): RollerAsset {
  return { $axf: 'asset@1', type, id, name, version: '1.0.0', description, author: 'AmberX AXF interface roller', tags: ['rolled'], data };
}
const currentData = (env: RollerEnv, type: string): Record<string, unknown> | null => {
  const id = env.active[type];
  const a = id ? env.assets[type]?.find((x) => x.id === id) : env.assets[type]?.[0];
  return a ? (structuredClone(a.data) as Record<string, unknown>) : null;
};

/** One complete rolled interface. `seed` any string; `locks` keep parts; the result's assets all validate. */
export function rollInterface(seed: string, env: RollerEnv, locks: RollLocks = {}): RollResult {
  const rnd = seededRandom(`roll:${seed}`);
  const sid = slug(seed).slice(0, 24) || 'roll';
  const id = (part: string) => `roll-${sid}-${part}`;
  const assets: RollerAsset[] = [];
  const slots: Record<string, string> = {};
  const rolled: RollPart[] = []; const kept: RollPart[] = []; const notes: string[] = [];
  const locked = (p: RollPart) => { if (locks[p]) { kept.push(p); return true; } rolled.push(p); return false; };

  // look
  const scheme: 'light' | 'dark' = rnd() < 0.5 ? 'light' : 'dark';
  const hue = between(rnd, 0, 359);
  const family = pick(rnd, SHAPE_FAMILIES);
  const pair = pick(rnd, TYPE_PAIRS);
  if (!locked('color')) {
    const tokens = rollColorTokens(rnd, scheme, hue);
    assets.push(asset('color-theme', id('color'), `Rolled ${scheme} ${hue}°`, { scheme, tokens }, `A ${scheme} palette on hue ${hue}°, contrast-checked (seed ${seed}).`));
    slots['color-theme'] = id('color'); notes.push(`colour: ${scheme} scheme, hue ${hue}°`);
  }
  if (!locked('style')) {
    const base = currentData(env, 'style-theme') ?? {};
    const density = pick(rnd, env.specs['style-theme']?.enums?.density ?? ['compact', 'comfortable', 'roomy']);
    const data = { ...base, fontFamily: pair.body, fontDisplay: pair.display, fontMono: pair.mono, fontSize: between(rnd, 13, 16), radius: family.radius, space: between(rnd, 6, 12), borderWidth: pick(rnd, [1, 1, 1, 2]), shadow: family.shadow, density, motion: pick(rnd, [100, 120, 160, 200, 240]), blur: family.blur, headingWeight: pick(rnd, [500, 600, 700, 800]), tracking: pick(rnd, [-0.02, -0.011, 0, 0.01]), opacityDisabled: 0.4, opacityMuted: pick(rnd, [0.6, 0.66, 0.72]), opacityHover: pick(rnd, [0.05, 0.06, 0.08]), opacityTint: pick(rnd, [0.08, 0.1, 0.14]), opacityScrim: pick(rnd, [0.4, 0.5]), opacityGlass: family.blur ? pick(rnd, [0.72, 0.86]) : 1 };
    assets.push(asset('style-theme', id('style'), `Rolled ${family.name} · ${pair.name}`, data, `${family.name} shapes, ${pair.name} type pairing, ${density} density (seed ${seed}).`));
    slots['style-theme'] = id('style'); notes.push(`style: ${family.name} shapes, ${pair.name} type, ${density}`);
  }
  if (!locked('behavior')) {
    const base = currentData(env, 'behavior-theme') ?? {};
    const motion = { ...(isObj(base.motion) ? base.motion : {}), speed: pick(rnd, ['theme', 'fast', 'normal', 'slow']), easing: pick(rnd, ['standard', 'emphasized', 'linear']), entrance: pick(rnd, ['theme', 'fade', 'none']) };
    const windows = { ...(isObj(base.windows) ? base.windows : {}), stack: pick(rnd, ['cascade', 'center', 'remember']), snap: rnd() < 0.4, snapGrid: pick(rnd, [8, 12, 16]) };
    assets.push(asset('behavior-theme', id('behavior'), 'Rolled behaviour', { ...base, motion, windows }, `Motion ${motion.speed} / ${motion.easing}, windows ${windows.stack}${windows.snap ? ' snapping' : ''} (seed ${seed}).`));
    slots['behavior-theme'] = id('behavior'); notes.push(`behaviour: ${motion.speed} motion, ${windows.stack} windows`);
  }
  if (!locked('layout')) {
    const base = currentData(env, 'layout') ?? {};
    const data = rollFields(rnd, 'layout', base, env, ['slots']);
    assets.push(asset('layout', id('layout'), 'Rolled layout', data, `Nav ${String(data.nav)}, toolbar ${String(data.toolbarPosition)}, inspector ${String(data.inspector)} (seed ${seed}).`));
    slots.layout = id('layout'); notes.push(`layout: nav ${String(data.nav)}, toolbar ${String(data.toolbarPosition)}`);
  }
  // controls
  if (!locked('controls')) {
    for (const t of CONTROL_TYPES) {
      const base = currentData(env, t); if (!base) continue;
      const data = rollFields(rnd, t, base, env);
      assets.push(asset(t, id(t), `Rolled ${t}`, data, `${t} restyled (seed ${seed}).`));
      slots[t] = id(t);
    }
    notes.push('controls: every control restyled within known ranges');
  }
  // chrome
  const navItems = collectItems((currentData(env, 'nav-menu')?.sections as { items: Item[] }[] | undefined)?.flatMap((s) => s.items) ?? []).map((it) => ({ id: it.id, label: it.label, icon: it.icon, action: it.view ? `nav:${it.view}` : it.action }));
  const toolbarItems = collectItems((currentData(env, 'toolbar')?.groups as { items: Item[] }[] | undefined)?.flatMap((g) => g.items) ?? []);
  if (!locked('banner')) {
    const base = currentData(env, 'banner');
    if (base) { const data = rollFields(rnd, 'banner', base, env, ['attach', 'logo']); assets.push(asset('banner', id('banner'), 'Rolled banner', { ...data, logo: { show: true, text: env.app.name } }, `Banner ${String(data.surface)} ${String(data.height)}px (seed ${seed}).`)); slots.banner = id('banner'); }
  }
  if (!locked('app-menu')) {
    const base = currentData(env, 'app-menu');
    if (base) { const data = rollAppMenu(rnd, base, [...toolbarItems, ...navItems] as Item[], env); assets.push(asset('app-menu', id('app-menu'), 'Rolled application menu', data, `${(data.menus as unknown[]).length} menus from the app's own items (seed ${seed}).`)); slots['app-menu'] = id('app-menu'); notes.push(`app menu: ${(data.menus as unknown[]).length} menus, every item kept`); }
  }
  if (!locked('toolbar')) {
    const base = currentData(env, 'toolbar');
    if (base) { const data = rollToolbar(rnd, base, env); assets.push(asset('toolbar', id('toolbar'), 'Rolled toolbar', data, `${(data.groups as unknown[]).length} groups, every item kept (seed ${seed}).`)); slots.toolbar = id('toolbar'); }
  }
  if (!locked('nav-menu')) {
    const base = currentData(env, 'nav-menu');
    if (base) { const data = rollNavMenu(rnd, base, env); assets.push(asset('nav-menu', id('nav'), 'Rolled navigation', data, `${(data.sections as unknown[]).length} sections, every page kept (seed ${seed}).`)); slots['nav-menu'] = id('nav'); }
  }
  if (!locked('context-menu')) {
    const base = currentData(env, 'context-menu');
    if (base) { const data = rollContextMenu(rnd, base, env); assets.push(asset('context-menu', id('context'), 'Rolled context menus', data, `Context menus restyled, every item kept (seed ${seed}).`)); slots['context-menu'] = id('context'); }
  }
  if (!locked('settings')) {
    const base = currentData(env, 'settings');
    if (base) { const data = rollFields(rnd, 'settings', base, env, ['tabs', 'hide', 'groups', 'levels', 'toolbar']); assets.push(asset('settings', id('settings'), 'Rolled settings interface', data, `Settings ${String(data.layout)} (seed ${seed}).`)); slots.settings = id('settings'); }
  }
  // brand
  if (!locked('brand')) {
    const mark = generateMark(`${seed}:mark`, { brand: env.app.name, form: 'mark', id: id('mark') });
    const lockup = generateMark(`${seed}:lockup`, { brand: env.app.name, form: 'lockup', id: id('lockup'), palette: mark.data.palette });
    const anim = generateAnimated(`${seed}:anim`, id('mark'), { id: id('anim') });
    assets.push(mark as RollerAsset, lockup as RollerAsset, anim as RollerAsset);
    const basePack = currentData(env, 'icon-pack');
    let iconPack = '';
    if (basePack) { const pack = generateIconPack(`${seed}:pack`, { id: env.active['icon-pack'], data: basePack }, { id: id('pack') }); assets.push(pack as RollerAsset); iconPack = id('pack'); }
    const decorations: Record<string, string> = {};
    for (const s of BRAND_SLOTS) decorations[s] = s === 'banner' ? 'lockup' : s === 'splash' ? 'animated' : s === 'favicon' ? 'mark' : pick(rnd, BRAND_SLOT_MODES.filter((m) => m !== 'watermark' || s === 'empty-state' || s === 'container'));
    const branding = { brand: { name: env.app.name, tagline: '' }, marks: { mark: id('mark'), lockup: id('lockup'), animated: id('anim') }, iconPack, palette: mark.data.palette, accentFromBrand: rnd() < 0.5, decorations };
    assets.push(asset('branding', id('brand'), `Rolled ${env.app.name} brand`, branding, `A new mark, lockup, animated mark${iconPack ? ', icon pack' : ''} and decorations (seed ${seed}).`));
    slots.branding = id('brand'); notes.push(`brand: new mark + lockup + animation${iconPack ? ' + icon pack' : ''}`);
  }
  // package + interface
  const themeOf = (t: string) => slots[t] ?? env.active[t] ?? '';
  const pkg = { 'style-theme': themeOf('style-theme'), 'color-theme': themeOf('color-theme'), layout: themeOf('layout'), 'behavior-theme': themeOf('behavior-theme') };
  assets.push(asset('design-package', id('design'), `Rolled design ${sid}`, pkg, `The rolled themes as a design package (seed ${seed}).`));
  const ifaceSlots: Record<string, string> = {};
  for (const [t, v] of Object.entries(slots)) if (!['style-theme', 'color-theme', 'layout', 'behavior-theme', 'branding'].includes(t)) ifaceSlots[t] = v;
  const iface = { design: id('design'), branding: slots.branding ?? env.active.branding ?? '', slots: ifaceSlots, spacing: pick(rnd, ['tight', 'compact', 'regular']), tab: { label: `Roll ${sid}`, icon: 'sparkles' }, tagline: notes.slice(0, 2).join(' · ') };
  if (!iface.branding) delete (iface as { branding?: string }).branding;
  assets.push(asset('interface', id('iface'), `Rolled interface ${sid}`, iface, `A whole interface rolled from seed ${seed}: ${rolled.join(', ')}${kept.length ? ` (kept: ${kept.join(', ')})` : ''}.`));
  return { id: id('iface'), name: `Rolled interface ${sid}`, assets, slots: { ...slots, 'design-package': id('design'), interface: id('iface') }, rolled, kept, notes };
}
