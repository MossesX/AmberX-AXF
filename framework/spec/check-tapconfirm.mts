/**
 * Tap-to-confirm on toolbars: the pure state machine (core/engines/tapconfirm.ts) and the web host
 * (react/tapConfirm.ts) on a small fake DOM. Run: npx -y tsx framework/spec/check-tapconfirm.mts
 */
import { TAP_ARM_DEFAULT_MS, TAP_IDLE, TAP_KEYS, tapArmMs, tapConfig, tapDecide, tapExpired, tapPointer, toolbarIdOf, type TapState } from '../core/engines/tapconfirm';
import { installTapConfirm } from '../react/tapConfirm';

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
ok(tapConfig(settings({}), 'x').enabled === true, 'on by default');
ok(tapConfig(settings({ [TAP_KEYS.enabled]: false }), 'x').enabled === false, 'global off');
ok(tapConfig(settings({ [TAP_KEYS.enabled]: false, 'axf.toolbar.x.tapConfirm': 'on' }), 'x').enabled === true, 'toolbar override on beats global off');
ok(tapConfig(settings({ 'axf.toolbar.x.tapConfirm': 'off' }), 'x').enabled === false, 'toolbar override off');
ok(tapConfig(settings({ 'axf.toolbar.x.tapConfirm': 'off' }), 'y').enabled === true, 'override is per toolbar');
ok(tapConfig(settings({ 'axf.toolbar.x.tapConfirm': 'bogus' }), 'x').enabled === true, 'bad override = inherit');
ok(tapConfig(settings({ [TAP_KEYS.armMs]: 5000 }), 'x').armMs === 5000, 'arm window from settings');
ok(toolbarIdOf({ id: 'Main Bar' }) === 'main-bar' && toolbarIdOf({ asset: 'console-search' }) === 'console-search' && toolbarIdOf({ label: 'Terminal tools' }) === 'terminal-tools' && toolbarIdOf({}) === 'toolbar', 'toolbar ids');

/* ---------- web host on a fake DOM ---------- */
type L = (e: any) => void;
class El {
  tag: string; parent: El | null = null; children: El[] = []; attrs: Record<string, string> = {}; dataset: Record<string, string> = {};
  style = { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; }, removeProperty(k: string) { delete this.props[k]; }, left: '', top: '' };
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
      const m = /^\[([a-z-]+)="([^"]+)"\]$/.exec(one);
      return !!m && this.attrs[m[1]!] === m[2];
    });
  }
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
store[TAP_KEYS.enabled] = true;
store['axf.toolbar.main-tools.tapConfirm'] = 'off';
ok(tap(runBtn, 'touch'), 'host: this toolbar switched off in its settings');
delete store['axf.toolbar.main-tools.tapConfirm'];
runBtn.disabled = true;
ok(tap(runBtn, 'touch'), 'host: disabled buttons are left to the browser');
runBtn.disabled = false;
ok(!tap(runBtn, 'touch') && tips().length === 1, 'host: armed before dispose');
host.dispose();
ok(!tips().length && !('data-axf-armed' in runBtn.attrs) && !(listeners.click ?? []).length, 'host: dispose removes listeners, light and tip');

console.log(`tap-confirm: ${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
