/**
 * Tap-to-confirm on toolbars, tab groups, navigation menus, application menus, context menus and banners: the pure state machine (core/engines/tapconfirm.ts) and the web host
 * (react/tapConfirm.ts) on a small fake DOM. Run: npx -y tsx framework/spec/check-tapconfirm.mts
 */
import { TAP_ARM_DEFAULT_MS, TAP_HINT, TAP_IDLE, TAP_KEYS, TAP_KINDS, chromeLabelsHidden, tapArmMs, tapConfig, tapConfigFor, tapDecide, tapKindKey, tapExpired, tapMode, tapPointer, toolbarIdOf, type TapState } from '../core/engines/tapconfirm';
import { installTapConfirm, tapSurfaceOf } from '../react/tapConfirm';
import { CHROME_FIELDS, CHROME_QUICK_KEY, CHROME_TYPES, chromeQuickFields } from '../core/engines/chrome-settings-rules.mjs';

let pass = 0;
let fail = 0;
const ok = (cond: unknown, name: string) => { if (cond) pass++; else { fail++; console.error(`✗ ${name}`); } };

/* ---------- core ---------- */
const on = { enabled: true, armMs: 3000 };
let s: TapState = TAP_IDLE;
let d = tapDecide(s, { pointer: 'mouse', target: 'a', now: 0 }, on);
ok(d.outcome === 'run', 'mouse click runs at once');
d = tapDecide(s, { pointer: 'pen', target: 'a', now: 0 }, on);
ok(d.outcome === 'run', 'pen click runs at once');
d = tapDecide(s, { pointer: 'keyboard', target: 'a', now: 0 }, on);
ok(d.outcome === 'run', 'keyboard click runs at once');
d = tapDecide(s, { pointer: 'touch', target: 'a', now: 1000 }, on);
ok(d.outcome === 'arm' && d.state.target === 'a' && d.state.armedAt === 1000, 'first touch tap arms');
s = d.state;
d = tapDecide(s, { pointer: 'touch', target: 'a', now: 3500 }, on);
ok(d.outcome === 'run' && d.state.target === null, 'second tap inside the window runs');
d = tapDecide(s, { pointer: 'touch', target: 'a', now: 4001 }, on);
ok(d.outcome === 'arm' && d.state.armedAt === 4001, 'second tap after the window re-arms instead of running');
d = tapDecide(s, { pointer: 'touch', target: 'b', now: 1500 }, on);
ok(d.outcome === 'arm' && d.state.target === 'b', 'a tap on another button re-arms that one');
d = tapDecide(s, { pointer: 'mouse', target: 'a', now: 1500 }, on);
ok(d.outcome === 'run' && d.state.target === null, 'a mouse click on a touch-armed button runs and clears');
d = tapDecide(TAP_IDLE, { pointer: 'touch', target: 'a', now: 0 }, { enabled: false, armMs: 3000 });
ok(d.outcome === 'run', 'switched off: touch runs at once');
ok(tapExpired({ target: 'a', armedAt: 0 }, 3001, 3000) && !tapExpired({ target: 'a', armedAt: 0 }, 3000, 3000), 'expiry at the window edge');
ok(tapArmMs(undefined) === TAP_ARM_DEFAULT_MS && tapArmMs('x') === TAP_ARM_DEFAULT_MS && tapArmMs(50) === 1000 && tapArmMs(99999) === 10000 && tapArmMs('2500') === 2500, 'arm window clamps');
ok(tapPointer('touch') === 'touch' && tapPointer('mouse') === 'mouse' && tapPointer('pen') === 'pen' && tapPointer('') === 'keyboard' && tapPointer(undefined) === 'keyboard', 'pointer mapping');
const settings = (v: Record<string, unknown>) => (k: string) => v[k] ?? null;
const icons = { labelsHidden: true }, words = { labelsHidden: false };
ok(tapConfig(settings({}), 'x', icons).enabled === true && tapConfig(settings({}), 'x', icons).source === 'labels', 'default: labels hidden → on');
ok(tapConfig(settings({}), 'x', words).enabled === false && tapConfig(settings({}), 'x').enabled === false, 'default: labels shown (or unknown) → off');
ok(tapConfig(settings({ [TAP_KEYS.enabled]: 'labels' }), 'x', icons).enabled === true, 'mode "labels" = the default');
ok(tapConfig(settings({ [TAP_KEYS.enabled]: false }), 'x', icons).enabled === false && tapConfig(settings({ [TAP_KEYS.enabled]: 'off' }), 'x', icons).source === 'global', 'global off beats hidden labels');
ok(tapConfig(settings({ [TAP_KEYS.enabled]: true }), 'x', words).enabled === true && tapConfig(settings({ [TAP_KEYS.enabled]: 'on' }), 'x', words).enabled === true, 'global on beats shown labels');
ok(tapMode(undefined) === 'labels' && tapMode('bogus') === 'labels' && tapMode(true) === 'on' && tapMode('off') === 'off', 'global mode parsing (older booleans kept)');
ok(tapConfig(settings({ [TAP_KEYS.enabled]: false, 'axf.toolbar.x.tapConfirm': 'on' }), 'x').enabled === true, 'toolbar override on beats global off');
ok(tapConfig(settings({ 'axf.toolbar.x.tapConfirm': 'off' }), 'x', icons).enabled === false && tapConfig(settings({ 'axf.toolbar.x.tapConfirm': 'off' }), 'x', icons).source === 'toolbar', 'toolbar override off beats hidden labels');
ok(tapConfig(settings({ 'axf.toolbar.x.tapConfirm': 'off' }), 'y', icons).enabled === true, 'override is per toolbar');
ok(tapConfig(settings({ 'axf.toolbar.x.tapConfirm': 'bogus' }), 'x', icons).enabled === true, 'bad override = inherit');
const tg = { type: 'tab-group' as const, instance: 'main' };
ok(tapConfig(settings({ 'axf.chrome.tab-group.main': { tapConfirm: 'on' } }), '', { ...tg, labelsHidden: false }).enabled === true, 'instance field on beats shown labels');
ok(tapConfig(settings({ 'axf.chrome.tab-group.main': { tapConfirm: 'off' } }), '', { ...tg, labelsHidden: true }).source === 'instance', 'instance field off beats hidden labels');
ok(tapConfig(settings({ 'axf.chrome.tab-group.main': { tapConfirm: 'auto' }, [tapKindKey('tab-group')]: 'off' }), '', { ...tg, labelsHidden: true }).enabled === false, 'instance "auto" falls through to its kind switch');
ok(tapConfig(settings({ 'axf.chrome.tab-group.main': { tapConfirm: 'on' }, [TAP_KEYS.enabled]: 'off' }), '', { ...tg, labelsHidden: true }).enabled === true, 'instance field beats the global mode');
ok(tapConfig(settings({ 'axf.chrome.toolbar.x': { tapConfirm: 'on' }, 'axf.toolbar.x.tapConfirm': 'off' }), 'x', { type: 'toolbar', instance: 'x' }).source === 'instance', 'the settings dialog choice beats the older per-toolbar key');
ok(tapConfig(settings({ 'axf.toolbar.x.tapConfirm': 'off' }), 'x', { type: 'tab-group', instance: 'x', labelsHidden: true }).enabled === true, 'the per-toolbar key is for toolbars only');
ok(chromeLabelsHidden('toolbar', { variant: 'icons' }) && !chromeLabelsHidden('toolbar', { variant: 'icons-labels' }) && chromeLabelsHidden('toolbar', {}), 'toolbar: icons-only variant hides labels (default icons)');
ok(chromeLabelsHidden('tab-group', { display: 'icons' }) && !chromeLabelsHidden('tab-group', { display: 'both' }) && !chromeLabelsHidden('tab-group', {}), 'tab group: display "icons" hides labels');
ok(chromeLabelsHidden('nav-menu', { showLabels: false }) && !chromeLabelsHidden('nav-menu', {}) && !chromeLabelsHidden('app-menu', {}), 'nav: showLabels off hides; menu bar always shows');
for (const t of ['toolbar', 'tab-group', 'nav-menu', 'app-menu'] as const) {
  const f = CHROME_FIELDS[t].find((x) => x.key === 'tapConfirm');
  ok(!!f && f.default === 'inherit' && f.quick === true && f.options!.join() === 'inherit,on,off', `${t}: tapConfirm field (inherit / on / off, quick)`);
}
const quickKeys = (t: Parameters<typeof chromeQuickFields>[0]) => chromeQuickFields(t).map((f) => f.key).join();
ok(quickKeys('toolbar') === 'variant,tapConfirm', 'quick switches: toolbar = buttons (labels) + tap to confirm');
ok(quickKeys('tab-group') === 'display,tapConfirm', 'quick switches: tab group = show (labels) + tap to confirm');
ok(quickKeys('nav-menu') === 'showLabels,tapConfirm', 'quick switches: nav = labels + tap to confirm');
ok(quickKeys('app-menu') === 'tapConfirm', 'quick switches: menu bar = tap to confirm');
ok(quickKeys('banner') === '' && quickKeys('context-menu') === '', 'no quick pane where nothing is quick');
ok(CHROME_QUICK_KEY('toolbar') === 'axf.chrome.quick.toolbar', 'quick pane fold key');
ok(tapConfig(settings({ [TAP_KEYS.armMs]: 5000 }), 'x').armMs === 5000, 'arm window from settings');
ok(toolbarIdOf({ id: 'Main Bar' }) === 'main-bar' && toolbarIdOf({ asset: 'console-search' }) === 'console-search' && toolbarIdOf({ label: 'Terminal tools' }) === 'terminal-tools' && toolbarIdOf({}) === 'toolbar', 'toolbar ids');

/* ---------- every kind, its own choice (chrome-settings@1 field) ---------- */
ok(CHROME_TYPES.every((t) => CHROME_FIELDS[t as keyof typeof CHROME_FIELDS].some((f) => f.key === 'tapConfirm' && f.group === 'behaviour' && f.level === 'simple')), 'every chrome settings interface offers Tap to confirm');
ok(TAP_KINDS.every((k) => (CHROME_TYPES as readonly string[]).includes(k)), 'tap kinds are chrome types');
ok(tapKindKey('toolbar') === TAP_KEYS.enabled && tapKindKey('tab-group') === 'axf.tapConfirm.tab-group', 'kind switch keys');
ok(TAP_KINDS.every((k) => tapConfigFor(settings({}), k, 'x', true).enabled && !tapConfigFor(settings({}), k, 'x', false).enabled), 'every kind follows its labels by default');
ok(TAP_KINDS.every((k) => tapConfigFor(settings({ [tapKindKey(k)]: 'on' }), k, 'x', false).enabled), 'a kind switched on is on with labels shown');
ok(!tapConfigFor(settings({ 'axf.tapConfirm.nav-menu': false }), 'nav-menu', 'app', true).enabled && tapConfigFor(settings({ 'axf.tapConfirm.nav-menu': false }), 'tab-group', 'app', true).enabled, 'a kind switch is that kind only');
ok(tapConfigFor(settings({ 'axf.tapConfirm.tab-group': false, 'axf.chrome.tab-group.ui.tabs': { tapConfirm: 'on' } }), 'tab-group', 'ui.tabs').enabled, 'item on beats kind off');
ok(!tapConfigFor(settings({ 'axf.chrome.app-menu.app': { tapConfirm: 'off' } }), 'app-menu', 'app').enabled, 'item off');
ok(tapConfigFor(settings({ 'axf.chrome.app-menu.app': { tapConfirm: 'bogus' } }), 'app-menu', 'app', true).enabled, 'bad item value = inherit');
ok(!tapConfigFor(settings({ 'axf.toolbar.main-tools.tapConfirm': 'off' }), 'toolbar', 'main-tools').enabled, 'toolbar honours its older per-toolbar key');
ok(tapConfigFor(settings({ 'axf.toolbar.main-tools.tapConfirm': 'off', 'axf.chrome.toolbar.main-tools': { tapConfirm: 'on' } }), 'toolbar', 'main-tools').enabled, 'the settings dialog choice beats the older key');
ok(tapConfigFor(settings({}), 'tab-group', 'x', false, 'on').source === 'skin' && !tapConfigFor(settings({}), 'tab-group', 'x', true, 'off').enabled, 'skin@2 pick beats the labels');
ok(!tapConfigFor(settings({ 'axf.tapConfirm.tab-group': 'on' }), 'tab-group', 'x', false, 'off').enabled, 'skin@2 pick beats the kind switch');
ok(tapConfigFor(settings({ 'axf.chrome.tab-group.x': { tapConfirm: 'on' } }), 'tab-group', 'x', false, 'off').enabled, 'the item choice beats the skin');
ok(tapConfigFor(settings({}), 'tab-group', 'x', true, 'default').source === 'labels', 'skin "default" is not the skin\'s business');
ok(TAP_HINT === 'Tap again to confirm', 'tip says tap again to confirm');

/* ---------- web host on a fake DOM ---------- */
type L = (e: any) => void;
class El {
  tag: string; parent: El | null = null; children: El[] = []; attrs: Record<string, string> = {}; dataset: Record<string, string> = {};
  style = { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; }, removeProperty(k: string) { delete this.props[k]; }, left: '', top: '' };
  get tagName() { return this.tag.toUpperCase(); }
  get parentElement() { return this.parent; }
  disabled = false; className = ''; textContent = ''; offsetWidth = 100; offsetHeight = 40; clicks = 0;
  constructor(tag: string, attrs: Record<string, string> = {}) { this.tag = tag; for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v); }
  add(c: El) { c.parent = this; this.children.push(c); return c; }
  appendChild(c: El) { return this.add(c); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; }
  removeAttribute(k: string) { delete this.attrs[k]; if (k.startsWith('data-')) delete this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  hasAttribute(k: string) { return k in this.attrs; }
  matches(sel: string): boolean {
    return sel.split(',').map((x) => x.trim()).some((one) => {
      if (one === 'button') return this.tag === 'button';
      if (one === 'a[href]') return this.tag === 'a' && 'href' in this.attrs;
      if (one === 'nav') return this.tag === 'nav';
      if (one.startsWith('.')) return this.className.split(' ').includes(one.slice(1));
      const has = /^\[([a-z-]+)\]$/.exec(one);
      if (has) return has[1]! in this.attrs;
      const t = /^([a-z]+)\[([a-z-]+)\]$/.exec(one);
      if (t) return this.tag === t[1] && t[2]! in this.attrs;
      const m = /^\[([a-z-]+)="([^"]+)"\]$/.exec(one);
      return !!m && this.attrs[m[1]!] === m[2];
    });
  }
  querySelectorAll(sel: string): El[] { const out: El[] = []; const walk = (e: El) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  closest(sel: string): El | null { let e: El | null = this; while (e) { if (e.matches(sel)) return e; e = e.parent; } return null; }
  contains(o: El) { let e: El | null = o; while (e) { if (e === this) return true; e = e.parent; } return false; }
  getBoundingClientRect() { return { left: 10, top: 10, bottom: 40, width: 30 }; }
}
(globalThis as any).Node = El;
const listeners: Record<string, L[]> = {};
const body = new El('body');
const doc: any = {
  body,
  defaultView: { innerWidth: 400, innerHeight: 800 },
  createElement: (t: string) => new El(t),
  addEventListener: (t: string, f: L) => { (listeners[t] ??= []).push(f); },
  removeEventListener: (t: string, f: L) => { listeners[t] = (listeners[t] ?? []).filter((x) => x !== f); },
};
let clock = 10_000;
const store: Record<string, unknown> = {};
const host = installTapConfirm(doc, (k) => store[k] ?? null, () => clock);
const bar = body.add(new El('div', { role: 'toolbar', 'aria-label': 'Main tools' }));
const runBtn = bar.add(new El('button', { title: 'Run the build' }));
const icon = runBtn.add(new El('svg'));
const stopBtn = bar.add(new El('button', { 'aria-label': 'Stop' }));
const loose = body.add(new El('button', { title: 'Not in a toolbar' }));
const keybar = body.add(new El('div', { role: 'toolbar', 'data-axf-tap-confirm': 'off', 'data-axf-tap-confirm-reason': 'soft keys' }));
const keyBtn = keybar.add(new El('button', { 'aria-label': 'Esc' }));
const tabs = body.add(new El('div', { role: 'tablist', 'data-axf-tab-group': 'main', 'data-axf-labels': 'shown' }));
const tabBtn = tabs.add(new El('button', { 'aria-label': 'Overview' }));
const iconTabs = body.add(new El('div', { role: 'tablist', 'data-axf-tab-group': 'side', 'data-axf-labels': 'hidden' }));
const iconTab = iconTabs.add(new El('button', { 'aria-label': 'Files' }));
const nav = body.add(new El('nav', { 'data-axf-nav': 'app', 'data-axf-labels': 'hidden' }));
const navBtn = nav.add(new El('button', { title: 'Home' }));
const menubar = body.add(new El('div', { role: 'menubar', 'data-fx-ctx-payload': 'app', 'data-axf-labels': 'shown' }));
const fileBtn = menubar.add(new El('button', {}));
fileBtn.textContent = 'File';
const dropdown = menubar.add(new El('div', { role: 'menu' }));
const openItem = dropdown.add(new El('button', { title: 'Open' }));

/** A press + click on `el` with `pointer` ('' = keyboard); returns true when the click reached the button. */
const tap = (el: El, pointer: string) => {
  if (pointer) for (const f of listeners.pointerdown ?? []) f({ pointerType: pointer, target: el });
  let stopped = false;
  const ev = { target: el, detail: pointer ? 1 : 0, preventDefault() {}, stopImmediatePropagation() { stopped = true; } };
  for (const f of listeners.click ?? []) f(ev);
  return !stopped;
};
const tips = () => body.children.filter((c) => c.className === 'fx-taptip');

ok(tap(runBtn, 'mouse'), 'host: mouse click goes through');
ok(tap(tabBtn, 'touch'), 'host: a tab group showing labels runs on the first tap');
ok(!tap(iconTab, 'touch') && tap(iconTab, 'touch'), 'host: an icons-only tab group arms, then runs');
ok(!tap(navBtn, 'touch') && tap(navBtn, 'touch'), 'host: an icons-only nav arms, then runs');
ok(tap(fileBtn, 'touch'), 'host: the menu bar (labels shown) runs on the first tap');
store['axf.chrome.app-menu.app'] = { tapConfirm: 'on' };
ok(!tap(fileBtn, 'touch') && tap(fileBtn, 'touch'), 'host: the menu bar switched on in its settings arms');
ok(!tap(openItem, 'touch') && tap(openItem, 'touch'), 'host: an open drop-down of a menu bar switched on is the app menu too: arms, then runs');
delete store['axf.chrome.app-menu.app'];
store['axf.chrome.tab-group.side'] = { tapConfirm: 'off' };
ok(tap(iconTab, 'touch'), 'host: an icons-only tab group switched off in its settings runs');
delete store['axf.chrome.tab-group.side'];
ok(!tips().length, 'host: no tip on mouse');
ok(!tap(icon, 'touch'), 'host: first finger tap (on the icon inside) is swallowed');
ok('data-axf-armed' in runBtn.attrs && runBtn.style.props['--fx-tap-arm-ms'] === '3000ms', 'host: button lit with the arm window');
ok(tips().length === 1 && tips()[0]!.children[0]!.textContent === 'Run the build', 'host: tip shows what the button does');
clock += 1000;
ok(!tap(stopBtn, 'touch'), 'host: a tap on another button is swallowed (re-arm)');
ok(!('data-axf-armed' in runBtn.attrs) && 'data-axf-armed' in stopBtn.attrs, 'host: the other button is lit now');
ok(tips().length === 1 && tips()[0]!.children[0]!.textContent === 'Stop', 'host: one tip, for the new button');
clock += 1000;
ok(tap(stopBtn, 'touch'), 'host: second tap on the armed button runs');
ok(!('data-axf-armed' in stopBtn.attrs) && !tips().length, 'host: running clears the light and the tip');
ok(!tap(runBtn, 'touch'), 'host: arm again');
clock += 3500;
ok(!tap(runBtn, 'touch'), 'host: a second tap after the window re-arms');
ok(tap(runBtn, ''), 'host: keyboard (Enter) runs at once');
ok(tap(loose, 'touch'), 'host: buttons outside toolbars are untouched');
ok(tap(keyBtn, 'touch'), 'host: a toolbar opted out in code is untouched');
store[TAP_KEYS.enabled] = false;
ok(tap(runBtn, 'touch'), 'host: global switch off → touch runs at once');
delete store[TAP_KEYS.enabled];
store['axf.toolbar.main-tools.tapConfirm'] = 'off';
ok(tap(runBtn, 'touch'), 'host: this toolbar switched off in its settings');
delete store['axf.toolbar.main-tools.tapConfirm'];
runBtn.disabled = true;
ok(tap(runBtn, 'touch'), 'host: disabled buttons are left to the browser');
runBtn.disabled = false;
ok(tips().length === 0, 'host: nothing armed between cases');
ok(!tap(runBtn, 'touch') && tips()[0]!.children[1]!.textContent === TAP_HINT, 'host: tip says what it is, then Tap again to confirm');
tap(runBtn, 'touch');

// every other kind
const tabs2 = body.add(new El('div', { role: 'tablist', 'aria-label': 'Sections', 'data-axf-tab-group': 'ui-review.sections', 'data-fx-ctx-target': 'tab-group', 'data-fx-ctx-payload': 'ui-review.sections' }));
const tab = tabs2.add(new El('button', { role: 'tab', title: 'Queue' }));
const more = tabs2.add(new El('ul', { role: 'menu' })).add(new El('button', { role: 'menuitemradio', title: 'Archive' }));
const nav2 = body.add(new El('nav', { 'aria-label': 'Main', 'data-axf-nav': 'app', 'data-fx-ctx-target': 'nav', 'data-fx-ctx-payload': 'app' }));
const navItem = nav2.add(new El('a', { href: '#/plan', title: 'Plan' }));
const preview = body.add(new El('nav', { 'data-axf-not-nav': 'preview' })).add(new El('button', { title: 'Preview' }));
const menubar2 = body.add(new El('div', { role: 'menubar', 'data-fx-ctx-target': 'app-menu', 'data-fx-ctx-payload': 'app' }));
const fileMenu = menubar2.add(new El('ul', { role: 'menu' })).add(new El('button', { role: 'menuitem', title: 'Open' }));
const ctx = body.add(new El('div')); ctx.className = 'fx-ctx';
const ctxItem = ctx.add(new El('ul', { role: 'menu' })).add(new El('button', { role: 'menuitem', title: 'Copy' }));
const banner = body.add(new El('div', { 'data-fx-ctx-target': 'banner', 'data-fx-ctx-payload': 'app' })).add(new El('button', { title: 'Dismiss' }));
const kindOf = (el: El) => { const x = tapSurfaceOf(el as any); return x ? `${x.kind}:${x.instance}` : null; };
ok(kindOf(tab) === 'tab-group:ui-review.sections', 'surface: tab → its tab group');
ok(kindOf(more) === 'tab-group:ui-review.sections', 'surface: the More list belongs to its tab group');
ok(kindOf(navItem) === 'nav-menu:app', 'surface: nav item → navigation menu');
ok(kindOf(preview) === null, 'surface: nav previews are left alone');
ok(kindOf(fileMenu) === 'app-menu:app' && kindOf(ctxItem) === 'context-menu:app' && kindOf(banner) === 'banner:app', 'surface: app menu, context menu, banner');
ok(kindOf(runBtn) === 'toolbar:main-tools', 'surface: toolbar id = its context-menu instance');
for (const [el, name] of [[tab, 'tab'], [more, 'tab More item'], [navItem, 'nav item'], [fileMenu, 'app menu item'], [ctxItem, 'context menu item'], [banner, 'banner button']] as const) {
  ok(!tap(el, 'touch') && tips().length === 1, `host: first tap on a ${name} arms and shows its tip`);
  clock += 100;
  ok(tap(el, 'touch') && !tips().length, `host: second tap on a ${name} confirms`);
  ok(tap(el, 'mouse'), `host: a mouse click on a ${name} runs at once`);
}
store['axf.chrome.tab-group.ui-review.sections'] = { tapConfirm: 'off' };
ok(tap(tab, 'touch'), 'host: a tab group switched off in its own settings');
delete store['axf.chrome.tab-group.ui-review.sections'];
store['axf.tapConfirm.nav-menu'] = false;
ok(tap(navItem, 'touch') && !tap(tab, 'touch'), 'host: the kind switch turns off navigation menus only');
tap(tab, 'touch');
delete store['axf.tapConfirm.nav-menu'];
ok(tap(preview, 'touch'), 'host: preview nav untouched');
ok(!tap(runBtn, 'touch') && tips().length === 1, 'host: armed before dispose');
host.dispose();
ok(!tips().length && !('data-axf-armed' in runBtn.attrs) && !(listeners.click ?? []).length, 'host: dispose removes listeners, light and tip');

console.log(`tap-confirm: ${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
