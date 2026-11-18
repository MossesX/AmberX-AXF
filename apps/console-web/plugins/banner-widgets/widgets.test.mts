// @ts-nocheck: a Node test, not part of the console's build
/**
 * Banner widgets: every widget another plugin supplies data for lands where it sat before the move, keeps its key
 * (`type:id`, what saved positions, sizes and hides are keyed by) and obeys the settings it had in its old plugin.
 *
 *   npx -y tsx --tsconfig apps/console-web/tsconfig.json apps/console-web/plugins/banner-widgets/widgets.test.mts
 *
 * Builds the console's own runtime (its framework copy, manifest and every asset it ships), supplies data for each widget
 * the way its plugin does (@console/bannerData) and asks the banner what it draws.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxfRuntime } from '../../src/axf/core/runtime';
import { dropBannerData, supplyBannerData } from '../../src/bannerData';
import { SUPPLIED, WIDGETS, findWidget, iconKeyOf, widgetKey, wanted, switchedOn } from './web/registry';
import { startSupplied } from './web/supplied';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '../..');
const ID = 'ai.amberx.axf.console.banner-widgets';
let checks = 0;
const ok = (v: unknown, what: string) => { assert.ok(v, what); checks += 1; console.log(`  ✓ ${what}`); };

const jsonUnder = (dir: string): unknown[] => {
  let out: unknown[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = out.concat(jsonUnder(p));
    else if (n.endsWith('.json')) out.push(JSON.parse(readFileSync(p, 'utf8')));
  }
  return out;
};
const assets = [...jsonUnder(join(app, 'src/axf/assets')), ...jsonUnder(join(app, 'src/assets')), ...jsonUnder(join(app, 'src/assets-overrides'))]
  .filter((a) => !!a && typeof a === 'object' && a.$axf === 'asset@1');
const manifest = JSON.parse(readFileSync(join(app, 'axf.manifest.json'), 'utf8'));
const rt = new AxfRuntime({ manifest, assets, storageKey: 'test:banner-widgets' });

const DATA = {
  status: { counter: 'test.on', onLabel: 'on', offLabel: 'off', onTone: 'accent', offTone: 'muted', dot: true },
  counter: { counter: 'test.n', tone: 'neutral', hideAtZero: false, icon: 'bell' },
  'action-button': { icon: 'plus', label: 'Go', action: 'noop', show: 'both', tone: 'neutral' },
};
const origin = (w) => w.formerly ?? 'test';
const placedAt = (w) => {
  const { placed } = rt.banner({ all: true });
  for (const side of Object.keys(placed)) { const p = placed[side].find((x) => x.key === widgetKey(w)); if (p) return { side, origin: p.origin, order: p.order }; }
  return null;
};

startSupplied(rt, ID);
ok(SUPPLIED.every((w) => !placedAt(w)), 'nothing is drawn before its data arrives');

for (const w of SUPPLIED) supplyBannerData(w.id, { type: w.type, data: { ...DATA[w.type], ...(w.when ? { counter: 'test.lit' } : {}) } }, origin(w));
const lit = SUPPLIED.filter((w) => w.when);
for (const w of SUPPLIED.filter((x) => !x.when)) {
  const p = placedAt(w);
  ok(p && p.side === w.at && p.order === w.order && p.origin === ID, `${w.id}: on the ${w.at} side at ${w.order}, placed by Banner widgets`);
}
ok(lit.every((w) => !placedAt(w)), 'a widget shown "only while lit" stays off while its counter is zero');
rt.setBadge('test.lit', 1);
ok(lit.every((w) => placedAt(w)?.side === w.at), 'and comes on when its counter goes above zero');
void rt.settings.set('agent-voice.banner', 'off');
ok(!placedAt(SUPPLIED.find((w) => w.id === 'agent-voice')), 'agent voice: its old "Never" choice (agent-voice.banner = off) still hides it');
void rt.settings.set('agent-voice.banner', 'always');
rt.setBadge('test.lit', 0);
ok(!!placedAt(SUPPLIED.find((w) => w.id === 'agent-voice')), 'agent voice: "Always" shows it while unlit');

const ms = SUPPLIED.find((w) => w.id === 'main-build');
void rt.settings.set('main-build-status.show', false);
ok(!placedAt(ms), 'an old show switch (main-build-status.show = false) still takes the widget off');
void rt.settings.set('main-build-status.show', true);
ok(placedAt(ms)?.side === 'right', 'and back on');

void rt.settings.set('alerts-bell.side', 'left');
ok(['alerts-bell', 'alerts-count'].every((id) => placedAt(SUPPLIED.find((w) => w.id === id))?.side === 'left'), 'alerts-bell.side moves the bell and its count together');
void rt.settings.set('alerts-bell.side', 'right');

const bell = SUPPLIED.find((w) => w.id === 'alerts-bell');
void rt.settings.set(iconKeyOf(bell), 'star');
ok(rt.registry.get('action-button', bell.asset)?.data.icon === 'star', 'an icon picked here replaces the supplier\'s icon');
void rt.settings.set(iconKeyOf(bell), 'not-an-icon');
ok(rt.registry.get('action-button', bell.asset)?.data.icon === 'plus', 'an unknown icon falls back to the supplier\'s');

const proj = SUPPLIED.find((w) => w.id === 'project');
rt.setBannerWidget(widgetKey(proj), { size: 'wide' });
supplyBannerData('project', { type: 'status', data: { ...DATA.status, onLabel: 'again' } }, origin(proj));
ok(rt.bannerWidgetView(widgetKey(proj)).size === 'wide', 'a size saved against the old key (status:project) still applies');

dropBannerData(origin(proj));
ok(!placedAt(proj), 'switching the supplying plugin off (its data dropped) takes the widget off');
supplyBannerData('project', { type: 'counter', data: DATA.counter }, origin(proj));
ok(!placedAt(proj), 'data of the wrong type is ignored');

ok(findWidget('ai.amberx.axf.console.main-build-status')?.id === 'main-build', 'an old owner\'s plugin id finds its widget');
ok(findWidget('claude-badge')?.source === 'own', 'the old Badges folder name finds the badges');
ok(findWidget('the ticker')?.id === 'shipped' && findWidget('bell')?.id === 'alerts-bell', 'voice words find widgets');
ok(new Set(WIDGETS.map((w) => w.id)).size === WIDGETS.length && new Set(WIDGETS.map(widgetKey)).size === WIDGETS.length, 'ids and keys are unique');
ok(!switchedOn((k) => (k === 'builds.banner' ? false : undefined), SUPPLIED.find((w) => w.id === 'builds-progress')), 'builds.banner = false keeps the progress off');
ok(!wanted(() => undefined, proj, null, () => 0), 'no data, no widget');
const warns = rt.terminal.lines.filter((l) => l.level === 'warn' && l.channel === 'widgets').map((l) => l.text);
ok(warns.length === 0, `no widget warnings from the runtime${warns.length ? `: ${warns.join(' | ')}` : ''}`);
console.log(`banner-widgets supplied widgets: ${checks} checks passed`);
