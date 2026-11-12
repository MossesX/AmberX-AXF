/**
 * chrome-settings@1 end to end through a real runtime (Brett, Nov 10 2026: "When you right click an asset like a nav
 * menu, tab bar or toolbar, the settings need to apply to the app, not the settings panel").
 * For each chrome kind, writing the same settings the dialog's chrome.set writes (the instance override key) and
 * applying chromeResetPlan the way chrome.reset does (React-free, so it runs with the framework alone):
 *   a change    → the live piece draws it (rt.chromeData / compileStyles, or the tab row's own data); the settings
 *                 panel's keys (its interface pick and edits) stay untouched; the asset itself is unchanged
 *   reset       → the piece is back at default; the panel's keys survive
 *   npx -y tsx framework/spec/check-chrome-settings-live.mts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxfRuntime } from '../core/runtime';
import { CHROME_APP_INSTANCE, CHROME_INSTANCE_KEY, CHROME_FIELDS, CHROME_PANEL_KEYS, chromeFieldValue, chromeInstanceData, chromeResetPlan, normalizeInstanceOverride } from '../core/engines/chrome-settings-rules.mjs';
import { CONTROL_TOKEN_SLOTS, withoutTokenOverride } from '../core/engines/control-tokens.mjs';

let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

const root = new URL('..', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest = { app: { id: 'test', name: 'Test' }, defaults } as never;
const rt = new AxfRuntime({ manifest, assets, storageKey: `axf-test:${Math.random()}` });
type Kind = 'nav-menu' | 'toolbar' | 'app-menu' | 'context-menu' | 'banner' | 'tab-group';
const asType = (t: Kind) => t as never;
// what chrome.set:<type>:<instance>:<field>:<value> writes (ChromeContext setChromeField)
const set = (type: Kind, instance: string, key: string, value: string | number | boolean) => {
  const k = CHROME_INSTANCE_KEY(type, instance);
  const next = normalizeInstanceOverride(type, { ...normalizeInstanceOverride(type, rt.settings.get(k)), [key]: value });
  rt.settings.set(k, next as never);
};
// what chrome.reset:<type>:<instance> does (ChromeContext resetChrome)
const reset = (type: Kind, instance: string) => {
  const plan = chromeResetPlan(type, instance, { active: rt.getState().active[asType(type)] ?? null, defaultAsset: rt.manifest.defaults?.[asType(type)] ?? null });
  for (const k of plan.clear) rt.settings.clear(k);
  if (plan.layoutField) {
    const key = CONTROL_TOKEN_SLOTS['tokens.layout'].key;
    const next = withoutTokenOverride(rt.settings.get(key), plan.layoutField);
    if (next && typeof next === 'object' && Object.keys(next).length) rt.settings.set(key, next as never); else rt.settings.clear(key);
  }
  if (plan.swap) rt.swap(asType(type), plan.swap);
  return plan;
};
const tabRow = (id: string) => chromeInstanceData('tab-group', rt.assetOrNull('tab-group')?.data ?? null, rt.settings.get(CHROME_INSTANCE_KEY('tab-group', id))) as { style?: string };

// every field of every single-instance kind: the change reaches the live piece; reset puts it back
const SINGLE: Kind[] = ['nav-menu', 'toolbar', 'banner', 'app-menu', 'context-menu'];
const otherValue = (f: { kind: string; options?: string[]; min?: number; max?: number }, cur: unknown) =>
  f.kind === 'toggle' ? !(cur ?? false) : f.kind === 'number' ? (cur === f.max ? f.min! : f.max!) : f.options!.find((o) => o !== cur)!;
// fields the app's compiled styles carry (the rest are read by the component itself through rt.chromeData)
const STYLED: Partial<Record<Kind, string[]>> = { 'nav-menu': ['style', 'density'], toolbar: ['density'], 'app-menu': ['density'], banner: ['height'] };

for (const type of SINGLE) {
  if (!rt.assetOrNull(asType(type))) continue;
  const panel = CHROME_PANEL_KEYS(type);
  for (const f of CHROME_FIELDS[type] as { key: string; kind: string; options?: string[]; min?: number; max?: number }[]) {
    const assetBefore = JSON.stringify(rt.asset(asType(type)).data);
    const cur = chromeFieldValue(type, rt.asset(asType(type)).data, undefined, f.key);
    const next = otherValue(f, cur);
    // the panel's own interface is picked and edited: a piece's change and reset must never touch these
    rt.settings.set(panel[0]!, 'panel-pick' as never);
    rt.settings.set(panel[1]!, { header: 'none' } as never);
    const stylesBefore = JSON.stringify(rt.compileStyles());

    set(type, CHROME_APP_INSTANCE, f.key, next);
    eq((rt.chromeData(asType(type)) as Record<string, unknown>)[f.key], next, `${type}.${f.key}: the live piece draws the change`);
    if (STYLED[type]?.includes(f.key)) ok(JSON.stringify(rt.compileStyles()) !== stylesBefore, `${type}.${f.key}: the app's compiled styles change`);
    eq(JSON.stringify(rt.asset(asType(type)).data), assetBefore, `${type}.${f.key}: the asset itself is untouched`);
    eq(rt.settings.get(panel[0]!), 'panel-pick', `${type}.${f.key}: the panel's interface pick is untouched by a change`);
    eq(rt.settings.get(panel[1]!), { header: 'none' }, `${type}.${f.key}: the panel's edits are untouched by a change`);

    const plan = reset(type, CHROME_APP_INSTANCE);
    ok(!plan.clear.some((k) => panel.includes(k)), `${type}: the reset plan never names the panel's keys`);
    eq(chromeFieldValue(type, rt.chromeData(asType(type)), undefined, f.key), cur, `${type}.${f.key}: reset puts the piece back`);
    eq(rt.settings.get(CHROME_INSTANCE_KEY(type, CHROME_APP_INSTANCE)), undefined, `${type}.${f.key}: reset clears the piece's overrides`);
    eq(JSON.stringify(rt.compileStyles()), stylesBefore, `${type}.${f.key}: compiled styles back to before`);
    eq(rt.settings.get(panel[0]!), 'panel-pick', `${type}.${f.key}: reset leaves the panel's interface pick`);
    eq(rt.settings.get(panel[1]!), { header: 'none' }, `${type}.${f.key}: reset leaves the panel's edits`);
    rt.settings.clear(panel[0]!); rt.settings.clear(panel[1]!);
  }
}

// tab bar: the right-clicked row changes, another row and the panel's keys don't
{
  const row = 'spec-row', other = 'spec-other';
  const panel = CHROME_PANEL_KEYS('tab-group');
  rt.settings.set(panel[0]!, 'panel-pick' as never);
  const cur = tabRow(row).style;
  const next = cur === 'pills' ? 'boxed' : 'pills';
  set('tab-group', row, 'style', next);
  eq(tabRow(row).style, next, 'tab-group: the right-clicked row draws the change');
  eq(tabRow(other).style, cur, 'tab-group: another row is untouched');
  eq(rt.settings.get(panel[0]!), 'panel-pick', 'tab-group: the panel pick is untouched');
  reset('tab-group', row);
  eq(tabRow(row).style, cur, 'tab-group: reset puts the row back');
  eq(rt.settings.get(panel[0]!), 'panel-pick', 'tab-group: reset leaves the panel pick');
}

console.log(`✓ chrome-settings live (runtime): ${checks} checks`);
