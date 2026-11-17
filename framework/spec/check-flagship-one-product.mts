/**
 * One product (build flagship-professional-skin-covering-2, Nov 17 2026; Brett: "One app: axHub, console, AmberX all as
 * one app."): every app that ships the shared set (schemas/shared-assets.json) carries the whole flagship skin chain,
 * and an app that follows the hub (`skin.inherit` on) draws exactly the same look when the hub-wide skin is a flagship
 * skin, whatever that app's own snapshot says: the same slots, the same appearance settings (motion, behaviour,
 * hooks, grid, dialog, settings chrome) and the same compiled colour and style tokens, read from that app's own baked
 * assets (src/axf/assets, then src/assets, then src/assets-overrides, as the apps load them).
 *
 *   npx -y tsx framework/spec/check-flagship-one-product.mts [--skin <id>[,<id>…]]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeLookAt, newAppLook, setInheritSkin, normalizeSkin } from '../core/engines/skin';
import { colorThemeVars, styleThemeVars } from '../core/engines/theme';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readJson = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const argAt = process.argv.indexOf('--skin');
const skins = (argAt > 0 ? process.argv[argAt + 1] : 'flagship').split(',').map((s) => s.trim()).filter(Boolean);
const apps: string[] = readJson(join(ROOT, 'framework/schemas/shared-assets.json')).apps ?? [];
/** Types an app keeps as its own content (asset-types.json `shared: false`): the skin's pick applies where the app has one. */
const TYPES: Record<string, { shared?: boolean }> = readJson(join(ROOT, 'framework/schemas/asset-types.json')).types;
const appOwn = (type: string) => TYPES[type]?.shared === false;

type Asset = { type: string; id: string; data: Record<string, unknown> };
/** An app's asset table the way it loads it: baked shared set, then its own, then its overrides (later wins). */
function appAssets(app: string): Map<string, Asset> {
  const out = new Map<string, Asset>();
  for (const dir of ['src/axf/assets', 'src/assets', 'src/assets-overrides']) {
    const base = join(ROOT, app, dir);
    if (!existsSync(base)) continue;
    for (const type of readdirSync(base)) {
      const td = join(base, type);
      if (!statSync(td).isDirectory()) continue;
      for (const f of readdirSync(td)) if (f.endsWith('.json')) { const a = readJson(join(td, f)); if (a?.type && a?.id) out.set(`${a.type}/${a.id}`, a); }
    }
  }
  return out;
}

/** Each app's own look before the skin: deliberately different, so only the skin can make them equal. */
const SNAPSHOTS: Record<string, Record<string, string>> = {
  'apps/console-web': { layout: 'console-pro', 'color-theme': 'porcelain', 'style-theme': 'soft-studio' },
  'apps/axhub-web': { layout: 'axhub-console', 'color-theme': 'hub-night', 'style-theme': 'hub' },
  'apps/amberx-droid': { layout: 'signature-dock', 'color-theme': 'amber-ember', 'style-theme': 'soft-touch' },
};

const problems: string[] = [];
let checks = 0;
const ok = (cond: unknown, msg: string) => { checks++; if (!cond) problems.push(msg); };
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

for (const id of skins) {
  const results: { app: string; look: string; tokens: string }[] = [];
  for (const app of apps) {
    const assets = appAssets(app);
    const get = (type: string, aid: string) => assets.get(`${type}/${aid}`);
    const skinAsset = get('skin', id);
    ok(skinAsset, `${app}: skin "${id}" is not baked (node framework/cli/shared-assets.mjs bake --all)`);
    if (!skinAsset) continue;
    const skinOf = (sid: string) => { const a = get('skin', sid); return a ? normalizeSkin(a.data) : null; };
    const skin = skinOf(id)!;
    // every asset the skin names is present in this app
    const named: [string, string][] = [['layout', skin.layoutTheme], ['color-theme', skin.colorTheme], ['style-theme', skin.styleTheme], ['behavior-theme', skin.behaviorTheme ?? ''],
      ...Object.values(skin.colorThemes ?? {}).map((c) => ['color-theme', c] as [string, string]), ...Object.entries(skin.assets ?? {})];
    if (skin.iconPack) named.push(['icon-pack', skin.iconPack]);
    for (const [type, aid] of named) if (aid && !appOwn(type)) ok(get(type, aid), `${app}: skin "${id}" names ${type}/${aid}, which the app does not ship`);
    // the app follows the hub; the hub-wide skin is this skin
    const own = SNAPSHOTS[app] ?? { layout: 'classic-ide' };
    const look = setInheritSkin(newAppLook(app.split('/').pop()!, { slots: own, spacing: 'regular', hidden: {}, settings: {} } as never), true);
    const shared = { skin: { id } } as never;
    const composed = composeLookAt(shared, look, skinOf).doc as { slots?: Record<string, string>; settings?: Record<string, unknown>; spacing?: string; hidden?: Record<string, boolean> };
    ok(composed.slots?.layout === skin.layoutTheme, `${app}: following the hub, the layout is ${composed.slots?.layout}, not the skin's ${skin.layoutTheme}`);
    const color = get('color-theme', composed.slots?.['color-theme'] ?? '');
    const style = get('style-theme', composed.slots?.['style-theme'] ?? '');
    ok(color && style, `${app}: the composed colour or style theme is missing`);
    const tokens = color && style ? stable({ ...colorThemeVars(color.data as never), ...styleThemeVars(style.data as never, (composed.spacing ?? 'regular') as never) }) : '';
    results.push({ app, look: stable({ slots: composed.slots, settings: composed.settings, spacing: composed.spacing, hidden: composed.hidden }), tokens });
  }
  const [first, ...rest] = results;
  for (const r of rest) {
    ok(r.look === first.look, `skin "${id}": ${r.app} composes a different look than ${first.app} while both follow the hub`);
    ok(r.tokens === first.tokens, `skin "${id}": ${r.app} resolves different colour / style tokens than ${first.app}`);
  }
  if (first) console.log(`  ${id}: ${results.length} apps, one look (${Object.keys(JSON.parse(first.tokens || '{}')).length} colour + style tokens)`);
}

if (problems.length) { for (const p of problems) console.error(`  ✗ ${p}`); console.error(`check-flagship-one-product: ${problems.length} problem(s)`); process.exit(1); }
console.log(`✓ check-flagship-one-product: ${checks} checks, ${skins.join(', ')} across ${apps.length} apps`);
