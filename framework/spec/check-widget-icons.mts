/**
 * widget-icons@1 (core/engines/widget-icons.ts, spec/WIDGET-ICONS.md): replays spec/fixtures/widget-icons.json through the
 * reference engine (ids, keys, refs, the long-text threshold and detector, kind defaults, every resolution case) and checks
 * the pieces around it: the sizing token exists with the fixture's default and is registered, the settings prefix is an
 * appearance setting, the registries open, the banner `show` fold, the contract and the porting note.
 *   npx -y tsx framework/spec/check-widget-icons.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WIDGET_ICON_FALLBACK, WIDGET_ICON_HOSTS, WIDGET_ICON_MODES, WIDGET_ICON_OWN, WIDGET_ICON_SETTING_PREFIX, WIDGET_ICON_VIAS, WIDGET_ICONS_FRAME, WIDGET_KIND_ICONS, WIDGET_TEXT_MAX, WIDGET_TEXT_MAX_TOKEN,
  bannerWidgetIconId, formatIconRef, isLongText, longTextThreshold, modeFromBannerShow, parseIconRef, parseWidgetIconId, registerWidgetIconHost, registerWidgetKindIcon, resolveWidgetIcon, settingsWidgetIconId, widgetIconKey, widgetIconSettings, widgetModeKey, widgetText,
  type WidgetIconInput, type WidgetIconMap, type WidgetIconSettings,
} from '../core/engines/widget-icons';
import { APPEARANCE_SETTING_PREFIXES } from '../core/engines/designpackage';
import { sizingVars } from '../core/engines/scale';

const root = new URL('../', import.meta.url).pathname;
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const fx = JSON.parse(read('spec/fixtures/widget-icons.json'));
let n = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); n++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); n++; };

// ---- the frame, the registries, the token ----
eq(fx.$axf, WIDGET_ICONS_FRAME, 'fixture frame');
eq([...WIDGET_ICON_HOSTS], fx.hosts, 'hosts');
eq([...WIDGET_ICON_MODES], fx.modes, 'modes');
eq(WIDGET_ICON_OWN, fx.own, 'own');
eq(WIDGET_ICON_SETTING_PREFIX, fx.prefix, 'setting prefix');
eq(WIDGET_TEXT_MAX_TOKEN, fx.token, 'threshold token');
eq({ ...WIDGET_TEXT_MAX }, fx.textMax, 'threshold range');
eq(sizingVars(null)[WIDGET_TEXT_MAX_TOKEN], String(fx.textMax.default), 'sizing@1 compiles the token to the default');
ok(APPEARANCE_SETTING_PREFIXES.includes(WIDGET_ICON_SETTING_PREFIX), 'axf.widget. is an appearance setting prefix');
ok(JSON.parse(read('schemas/token-registry.json')).tokens.some((t: { id: string }) => t.id === WIDGET_TEXT_MAX_TOKEN), 'token registered');
eq(WIDGET_ICON_FALLBACK, fx.map.fallback, 'fallback glyph');
eq([...WIDGET_ICON_VIAS], ['pick', 'override', 'slot', 'own', 'kind', 'fallback'], 'the chain, in order');
// (read as text: tsx drops star re-exports from a namespace import when the importer is a .mts file)
ok(read('core/index.ts').includes("export * from './engines/widget-icons';"), 'core index exports the engine');

// ---- ids and keys ----
for (const c of fx.ids as { id: string; parts: unknown }[]) eq(parseWidgetIconId(c.id), c.parts, `id ${JSON.stringify(c.id)}`);
eq(parseWidgetIconId(7), null, 'a number is not an id');
for (const [id, keys] of Object.entries(fx.keys as Record<string, { icon: string; mode: string }>)) {
  eq(widgetIconKey(id), keys.icon, `icon key of ${id}`);
  eq(widgetModeKey(id), keys.mode, `mode key of ${id}`);
  ok(widgetIconKey(id).startsWith(WIDGET_ICON_SETTING_PREFIX), 'key carries the prefix');
}
eq(bannerWidgetIconId('status:usage'), 'banner:status:usage', 'banner widget key → widget id');
eq(settingsWidgetIconId('setting', 'axf.display.fontScale'), 'settings:setting:axf.display.fontScale', 'settings row → widget id');
eq(parseWidgetIconId('nav:status:x'), null, 'an unregistered host');
registerWidgetIconHost('nav');
eq(parseWidgetIconId('nav:status:x'), { host: 'nav', kind: 'status', id: 'x' }, 'a registered host');
registerWidgetIconHost('Bad Host');
ok(!WIDGET_ICON_HOSTS.includes('Bad Host'), 'a bad host name is not registered');
eq(widgetIconSettings((k) => ({ 'axf.widget.banner:status:usage.icon': 'zap', 'axf.widget.banner:status:usage.mode': 'text' })[k], 'banner:status:usage', '24'), { icon: 'zap', mode: 'text', textMax: '24' }, 'settings read from a getter');

// ---- refs ----
for (const c of fx.refs as { ref: unknown; parsed: unknown }[]) eq(parseIconRef(c.ref), c.parsed, `ref ${JSON.stringify(c.ref)}`);
eq(formatIconRef({ pack: 'phosphor', glyph: 'zap' }), 'phosphor/zap', 'format a pack ref');
eq(formatIconRef({ pack: null, glyph: 'zap' }), 'zap', 'format a bare ref');

// ---- long text ----
for (const c of fx.threshold as { value: unknown; max: number }[]) eq(longTextThreshold(c.value), c.max, `threshold ${JSON.stringify(c.value)}`);
for (const c of fx.long as { text: unknown; max: number; long: boolean }[]) eq(isLongText(c.text, c.max), c.long, `long ${JSON.stringify(c.text)} @ ${c.max}`);
eq(widgetText('  Hi   there  '), 'Hi there', 'collapsed text');
eq(widgetText(42), '', 'not a string');

// ---- kind defaults ----
eq({ ...WIDGET_KIND_ICONS }, fx.kindIcons, 'kind icons');
registerWidgetKindIcon('gauge', 'chart');
eq(WIDGET_KIND_ICONS.gauge, 'chart', 'a kind can be added');
registerWidgetKindIcon('gauge', 'Not A Glyph');
eq(WIDGET_KIND_ICONS.gauge, 'chart', 'a bad glyph is refused');
eq(modeFromBannerShow('both'), 'icon+text', 'show both');
eq(modeFromBannerShow('icon'), 'icon', 'show icon');
eq(modeFromBannerShow('number'), 'text', 'show number');
eq(modeFromBannerShow('auto'), 'auto', 'show auto');
eq(modeFromBannerShow('x'), 'auto', 'show unknown');

// ---- resolution ----
const map = fx.map as WidgetIconMap;
for (const c of fx.cases as { name: string; widget: WidgetIconInput; settings: WidgetIconSettings; want: unknown }[]) {
  eq(resolveWidgetIcon(c.widget, c.settings, map), c.want, `case: ${c.name}`);
}
// every case lands on one of the chain's sources and one of the modes, and always has an icon
for (const c of fx.cases as { name: string; want: { icon: string; via: string; mode: string } }[]) {
  ok(c.want.icon.length > 0, `${c.name}: an icon`);
  ok((WIDGET_ICON_VIAS as readonly string[]).includes(c.want.via), `${c.name}: a known via`);
  ok((WIDGET_ICON_MODES as readonly string[]).includes(c.want.mode), `${c.name}: a known mode`);
}
// no settings, no map: still an icon
eq(resolveWidgetIcon({ id: 'banner:status:x', kind: 'status', text: 'x' }, null, null).icon, 'info', 'no map: the kind default');
eq(resolveWidgetIcon({ id: 'banner:zzz:x', text: 'x' }, undefined, undefined).icon, WIDGET_ICON_FALLBACK, 'no map, no kind: the fallback');
eq(resolveWidgetIcon({ id: 'banner:zzz:x', text: 'x' }, {}, { fallback: 'Bad Glyph' }).icon, WIDGET_ICON_FALLBACK, 'a bad fallback is ignored');
// the threshold token's compiled value is what the host passes
eq(resolveWidgetIcon({ id: 'banner:status:x', kind: 'status', text: 'abcdefghijklmnopqrstuvwxy' }, { textMax: sizingVars(null)[WIDGET_TEXT_MAX_TOKEN] }, map).mode, 'icon', '25 characters at the default 24 is long');
eq(resolveWidgetIcon({ id: 'banner:status:x', kind: 'status', text: 'abcdefghijklmnopqrstuvwxy' }, { textMax: sizingVars({ widget: { textMax: 30 } })[WIDGET_TEXT_MAX_TOKEN] }, map).mode, 'icon+text', 'a sizing asset raising it to 30 keeps the text');

// ---- the contract and the porting note ----
const doc = read('spec/WIDGET-ICONS.md');
for (const word of [WIDGET_ICONS_FRAME, WIDGET_TEXT_MAX_TOKEN, 'axf.widget.<widgetId>.icon', 'axf.widget.<widgetId>.mode', 'resolveWidgetIcon', 'pack:<pack>/<glyph>', 'check-widget-icons.mts']) ok(doc.includes(word), `WIDGET-ICONS.md names ${word}`);
ok(read('spec/PORTING.md').includes('widget-icons@1'), 'PORTING.md records the deferred twin');

console.log(`✓ widget-icons@1 — ${n} checks (ids, keys, refs, threshold, long text, kind defaults, ${(fx.cases as unknown[]).length} resolution cases, token, contract)`);
