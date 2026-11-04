/*
 * Terminal text size per pane (terminal-drag-chain-tree, Nov 3 2026, Brett: "I need to be able to change the size of
 * the text in the main window here on the left side. It's too big."). Two panes: `term` (the terminal text, the split's
 * left pane) in px, and `chain` (the context chain pane) as a scale of the theme's text. Each tab remembers its own
 * size on this device (A− / A+, Ctrl/Cmd + − / = / 0, Ctrl + wheel, pinch); a tab with no size of its own uses its
 * Claude Code profile's last size, then the Terminal default (Settings → Terminal → Text size; on a phone the phone
 * text size), and a default of 0 = Auto: the theme's own text size tokens (body text on a desktop, small text on a
 * phone), so the phone default follows the typography / density assets instead of a number in code.
 * The pure part is exported for framework/spec/check-headless-tabs.mts; the store is localStorage, per device.
 */

export type Pane = 'term' | 'chain';
export const TERM_MIN = 7;
export const TERM_MAX = 32;
export const CHAIN_MIN = 60;
export const CHAIN_MAX = 200;
const CHAIN_STEP = 10;

export interface SizeDefaults { fontSize: number; fontSizePhone: number; chainTextSize: number }
export interface SizeMemory { tabs: Record<string, Partial<Record<Pane, number>>>; profiles: Record<string, Partial<Record<Pane, number>>> }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
export const clampPane = (pane: Pane, v: number) => (pane === 'term' ? clamp(v, TERM_MIN, TERM_MAX) : clamp(v, CHAIN_MIN, CHAIN_MAX));

/**
 * A pane's size: the tab's own, else its profile's, else the default for this kind of device (0 = auto from the
 * tokens: `auto` px for the terminal, 100 % for the chain). Pure.
 */
export function resolveSize(pane: Pane, o: { tab?: string; profile?: string; phone: boolean; auto: number; defaults: Partial<SizeDefaults>; memory: SizeMemory }): number {
  const own = o.tab ? o.memory.tabs[o.tab]?.[pane] : undefined;
  const prof = o.profile ? o.memory.profiles[o.profile]?.[pane] : undefined;
  if (typeof own === 'number') return clampPane(pane, own);
  if (typeof prof === 'number') return clampPane(pane, prof);
  if (pane === 'chain') return clampPane(pane, o.defaults.chainTextSize || 100);
  const d = o.phone ? o.defaults.fontSizePhone : o.defaults.fontSize;
  return clampPane(pane, d || o.auto || TERM_MIN);
}

/** One step bigger / smaller (or `reset` = forget the tab's and profile's size). Returns the new memory. Pure. */
export function stepSize(memory: SizeMemory, pane: Pane, by: number | 'reset', cur: number, at: { tab?: string; profile?: string }): SizeMemory {
  const tabs = { ...memory.tabs }; const profiles = { ...memory.profiles };
  const put = (m: Record<string, Partial<Record<Pane, number>>>, k: string | undefined, v: number | undefined) => {
    if (!k) return; const e = { ...(m[k] ?? {}) };
    if (v === undefined) delete e[pane]; else e[pane] = v;
    if (Object.keys(e).length) m[k] = e; else delete m[k];
  };
  if (by === 'reset') { put(tabs, at.tab, undefined); put(profiles, at.profile, undefined); return { tabs, profiles }; }
  const next = clampPane(pane, cur + by * (pane === 'chain' ? CHAIN_STEP : 1));
  put(tabs, at.tab, next); put(profiles, at.profile, next);
  return { tabs, profiles };
}

/** Pinch: how many steps a change in finger distance is (every 15 % = one step, either way). Pure. */
export const pinchSteps = (startDist: number, dist: number) => (startDist > 0 ? Math.trunc(Math.log(dist / startDist) / Math.log(1.15)) : 0);

/** Phone = a touch screen that is narrow (the same test the window host uses for its touch layout). */
export const isPhone = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 760;

// ---- the per-device store
const KEY = 'axp-terminal.text-size';
const MAX_TABS = 200;
const listeners = new Set<() => void>();
let mem: SizeMemory | null = null;
export function sizeMemory(): SizeMemory {
  if (mem) return mem;
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); mem = v && typeof v === 'object' ? { tabs: v.tabs ?? {}, profiles: v.profiles ?? {} } : null; } catch { mem = null; }
  return (mem ??= { tabs: {}, profiles: {} });
}
export function setSizeMemory(next: SizeMemory) {
  const keys = Object.keys(next.tabs); // keep the newest tabs only
  const tabs = keys.length > MAX_TABS ? Object.fromEntries(keys.slice(-MAX_TABS).map((k) => [k, next.tabs[k]!])) : next.tabs;
  mem = { tabs, profiles: next.profiles };
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* private mode: this page only */ }
  for (const f of listeners) f();
}
export function onSizeMemory(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
// another tab of the console changed a size: follow it
if (typeof addEventListener === 'function') addEventListener('storage', (e) => { if (e.key === KEY) { mem = null; for (const f of listeners) f(); } });

/** The px the theme's text tokens give inside `el` (body text on a desktop, small text on a phone). */
export function autoTermSize(el: HTMLElement | null, phone: boolean): number {
  if (!el) return 0;
  const probe = document.createElement('span');
  probe.className = phone ? 'axp-terminal__probe axp-terminal__probe--phone' : 'axp-terminal__probe';
  el.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize) || 0;
  probe.remove();
  return Math.round(px);
}
