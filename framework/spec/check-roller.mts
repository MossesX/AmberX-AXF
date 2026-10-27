/**
 * Interface roller: every rolled asset validates, the result is reproducible, locks keep parts, structure is kept
 * (every action / page / item of the app survives a roll), palettes read, and the rolled interface resolves in the
 * runtime with nothing missing. Fixture `spec/fixtures/roller.json` pins one roll's slot map + notes.
 *   npx -y tsx framework/spec/check-roller.mts [--write]
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { AxfRuntime } from '../core/runtime';
import { ROLL_PARTS, collectItems, regroup, rollColorTokens, rollFields, rollInterface, type RollerEnv } from '../core/engines/roller';
import { contrast, seededRandom } from '../core/engines/brandgen.mjs';
import { assetTypeSpecs } from '../core/validate';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const assetsDir = new URL('framework/assets/', root).pathname;
const all = readdirSync(assetsDir).flatMap((t) => readdirSync(assetsDir + t).filter((x) => x.endsWith('.json')).map((x) => read(`framework/assets/${t}/${x}`)));
const byType: RollerEnv['assets'] = {};
for (const a of all) (byType[a.type] ??= []).push(a);
const defaults = read('framework/defaults.json');
const env: RollerEnv = { app: { id: 'demo', name: 'Demo App' }, specs: assetTypeSpecs as unknown as RollerEnv['specs'], assets: byType, active: { ...defaults, 'design-package': 'fresh', 'icon-pack': 'amberx-outline', branding: 'amberx' } };

/* colour */
for (const scheme of ['light', 'dark'] as const) for (const seed of [1, 2, 3, 4, 5]) {
  const t = rollColorTokens(seededRandom(seed), scheme);
  ok(contrast(t.text!, t.surface!) >= 4.5 && contrast(t.text!, t.bg!) >= 4.5, `${scheme} ${seed}: text reads`);
  ok(contrast(t.accentText!, t.accent!) >= 4.5, `${scheme} ${seed}: accent text reads`);
  ok(contrast(t.muted!, t.surface!) >= 3 && contrast(t.border!, t.surface!) >= 1.25, `${scheme} ${seed}: muted + border`);
  for (const s of ['danger', 'success', 'warning', 'info']) ok(contrast(t[s]!, t.surface!) >= 3, `${scheme} ${seed}: ${s} ≥ 3:1`);
}

/* fields */
const btn = rollFields(seededRandom(9), 'button', byType.button![0]!.data as Record<string, unknown>, env);
ok(env.specs.button!.enums!.shape!.includes(btn.shape as string) && typeof btn.uppercase === 'boolean', 'rollFields: enums + booleans from the registry');
const st = rollFields(seededRandom(3), 'style-theme', byType['style-theme']![0]!.data as Record<string, unknown>, env, ['shadow']);
ok(typeof (st.radius as { sm: number }).sm === 'number' && st.shadow === byType['style-theme']![0]!.data.shadow, 'nested numbers rolled, kept keys kept');

/* structure */
const items = collectItems([{ id: 'a', action: 'file.new' }, { id: 's', separator: true }, { id: 'b', action: 'edit.cut' }, { id: 'c', items: [{ id: 'd', action: 'view.x' }] }, { id: 'e', view: 'home' }] as never);
eq(items.map((i) => i.id), ['a', 'b', 'c', 'e'], 'collectItems keeps every actionable item, drops separators');
eq(regroup(items, 2).flat().length, 4, 'regroup lands every item once');
eq(regroup(items, 99).length <= 4, true, 'regroup never makes empty groups');

/* a whole roll */
const r = rollInterface('demo-seed', env);
ok(r.assets.length >= 15, `${r.assets.length} assets rolled`);
for (const a of r.assets) eq(validateAsset(a as never).errors, [], `rolled ${a.type}/${a.id} valid`);
eq(rollInterface('demo-seed', env).slots, r.slots, 'reproducible');
ok(rollInterface('other-seed', env).assets.find((a) => a.type === 'color-theme')!.data.tokens !== r.assets.find((a) => a.type === 'color-theme')!.data.tokens, 'a new seed is a new roll');
eq([...r.rolled].sort(), [...ROLL_PARTS].sort(), 'every part rolled when nothing is locked');
const kept = rollInterface('demo-seed', env, { color: true, 'app-menu': true, brand: true });
ok(!kept.assets.some((a) => a.type === 'color-theme' || a.type === 'app-menu' || a.type === 'branding') && kept.kept.length === 3, 'locks keep parts');
eq((kept.assets.find((a) => a.type === 'design-package')!.data as { 'color-theme': string })['color-theme'], defaults['color-theme'], 'a locked theme stays the app\'s own');
// structure survives: every action of the app's menus / toolbar / nav is still reachable in the rolled chrome
const actionsOf = (data: Record<string, unknown>) => JSON.stringify(data).match(/"action":"[^"]+"/g)?.sort() ?? [];
const baseMenu = byType['app-menu']!.find((a) => a.id === defaults['app-menu'])!.data as Record<string, unknown>;
const rolledMenu = r.assets.find((a) => a.type === 'app-menu')!.data;
for (const act of actionsOf(baseMenu)) ok(actionsOf(rolledMenu).includes(act), `app menu keeps ${act}`);
const baseTb = byType.toolbar!.find((a) => a.id === defaults.toolbar)!.data as Record<string, unknown>;
eq(actionsOf(r.assets.find((a) => a.type === 'toolbar')!.data), actionsOf(baseTb), 'toolbar keeps every action');
const baseNav = byType['nav-menu']!.find((a) => a.id === defaults['nav-menu'])!.data as Record<string, unknown>;
const views = (d: Record<string, unknown>) => JSON.stringify(d).match(/"view":"[^"]+"/g)?.sort() ?? [];
eq(views(r.assets.find((a) => a.type === 'nav-menu')!.data), views(baseNav), 'nav keeps every page');
const baseCtx = byType['context-menu']!.find((a) => a.id === defaults['context-menu'])!.data as Record<string, unknown>;
eq((r.assets.find((a) => a.type === 'context-menu')!.data as { targets: unknown }).targets, (baseCtx as { targets: unknown }).targets, 'context menus keep every item in order');
ok(r.notes.length >= 5, 'notes explain the roll');

/* resolves in the runtime with nothing missing */
{
  const rt = new AxfRuntime({ manifest: { app: { id: 'demo', name: 'Demo App' }, defaults } as never, assets: [...all, ...r.assets], storageKey: 'test:roller' });
  const res = rt.resolveInterface(r.id)!;
  eq(res.missing, [], 'the rolled interface resolves with nothing missing');
  ok(res.active['style-theme'] === r.slots['style-theme'] && res.active.branding === r.slots.branding, 'themes + branding come through');
  const v = rt.scoped('roll', r.id)!;
  ok(v.branding()?.name === 'Demo App' && v.brandPlace('banner')?.svg.includes('<svg'), 'the rolled brand draws in a scope');
  const accent = v.compileStyles().vars['--fx-accent'];
  const themeAccent = (r.assets.find((a) => a.type === 'color-theme')!.data as { tokens: { accent: string } }).tokens.accent;
  const brandAccent = (r.assets.find((a) => a.type === 'branding')!.data as { palette: { brand1: string }; accentFromBrand: boolean });
  ok(accent === (brandAccent.accentFromBrand ? brandAccent.palette.brand1 : themeAccent), 'the rolled palette (or the brand accent, when it asks) compiles in the scope');
  ok(v.compileStyles().vars['--fx-bg'] === (r.assets.find((a) => a.type === 'color-theme')!.data as { tokens: { bg: string } }).tokens.bg, 'the rolled background compiles in the scope');
}

/* fixture */
const fixture = { slots: r.slots, rolled: r.rolled, notes: r.notes, types: r.assets.map((a) => a.type) };
const fx = new URL('fixtures/roller.json', import.meta.url);
if (process.argv.includes('--write') || !existsSync(fx)) writeFileSync(fx, JSON.stringify(fixture, null, 2) + '\n');
eq(JSON.parse(readFileSync(fx, 'utf8')), fixture, 'fixture roller.json matches');
console.log(`check-roller: ${n} checks passed`);
