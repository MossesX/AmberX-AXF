/**
 * Tab control (tab-control@1; build tabs-api-control, Brett Nov 8 2026): every tab row, sub-tab row and titled section
 * in every app on the framework can be opened by an agent, voice, MCP, the REST API or a link — no tab is reachable
 * only by a finger.
 *
 *  - Every mounted `TabGroup` registers itself here (and hand-drawn strips call `useTabControl`); every titled
 *    `Container` and settings section registers as a section (`useSectionControl`), so it can be expanded and scrolled to.
 *  - `tab.open:<path>` runs a path: `build-orchestrator/pipeline`, `settings/appearance`, `plan-studio/Board`. The first
 *    part may be a screen (id or title); each next part is a tab of a row that mounts (waits for it), a `row:tab`, or a
 *    section title. On Settings, a part that names a settings tab goes through `settings.open`.
 *  - Every tab of every row this device has shown gets its own navigate-only action `tab.<row>.<tab>` (remembered per
 *    device, so a row seen once stays listed after its screen closes): they show in `console_list kind=actions`.
 *  - Deep link: `?axf-open=<path>` opens the path once the app is up (`tabDeepLink(path)` builds one).
 *
 * The pure half (path split, matching, action ids) is `core/engines/tab-control.mjs`; installed by `<AxfProvider>`.
 * This file has no React in it (tests and non-React hosts load it); the hooks are in tabControl.ts.
 */
import type { AxfRuntime } from '../core';
import { pickTabTarget, splitTabPath, tabActionsOf, normalizeTabTarget, TAB_DEEP_LINK_PARAM, TAB_OPEN_ACTION, TAB_WAIT_MS, type TabTarget } from '../core/engines/tab-control.mjs';

export interface LiveTarget extends TabTarget {
  value?: string;
  select?: (value: string) => void;
  expand?: () => void;
  element?: () => HTMLElement | null;
}

interface Control {
  live: Map<string, LiveTarget>;
  seen: Record<string, TabTarget>;
  actions: Map<string, () => void>;
}

const SEEN_KEY = 'axf.tabs.seen';
const SEEN_MAX = 300;
const controls = new WeakMap<AxfRuntime, Control>();

function loadSeen(): Record<string, TabTarget> {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<string, TabTarget> = {};
    for (const [k, v] of Object.entries(raw)) { const t = normalizeTabTarget(v); if (t) out[k] = t; }
    return out;
  } catch { return {}; }
}

function saveSeen(seen: Record<string, TabTarget>) {
  try {
    const keys = Object.keys(seen);
    for (const k of keys.slice(0, Math.max(0, keys.length - SEEN_MAX))) delete seen[k];
    globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch { /* storage unavailable: live rows still register their actions */ }
}

function controlOf(rt: AxfRuntime): Control {
  let c = controls.get(rt);
  if (!c) { c = { live: new Map(), seen: loadSeen(), actions: new Map() }; controls.set(rt, c); }
  return c;
}

const fold = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** The screens (views) this app has, from its search index: { view, label }. */
function screensOf(rt: AxfRuntime): { view: string; label: string }[] {
  return rt.search.entries().filter((e) => e.kind === 'view').map((e) => ({ view: String((e.focus as { view?: string }).view ?? ''), label: e.label })).filter((s) => s.view);
}

/** The screen a word names (view id or title), or null. */
export function tabScreenOf(rt: AxfRuntime, word: string): { view: string; label: string } | null {
  const raw = word.trim().toLowerCase();
  const f = fold(word);
  const all = screensOf(rt);
  return all.find((s) => s.view.toLowerCase() === raw) ?? all.find((s) => fold(s.view) === f) ?? all.find((s) => fold(s.label) === f) ?? null;
}

const screenLabel = (rt: AxfRuntime, view?: string) => (view ? screensOf(rt).find((s) => s.view === view)?.label ?? '' : '');

/** Register the per-tab actions of every row seen or live (once each; they stay for the session). */
function syncActions(rt: AxfRuntime) {
  const c = controlOf(rt);
  const rows = [...Object.values(c.seen), ...[...c.live.values()].filter((t) => t.kind === 'tab-group')];
  for (const row of rows) {
    for (const a of tabActionsOf(row, screenLabel(rt, row.screen))) {
      if (c.actions.has(a.id)) continue;
      c.actions.set(a.id, rt.actions.register(a.id, () => { void openTabPath(rt, a.path); }, { label: a.label, effect: 'navigate', searchable: false, module: 'axf.framework' }));
    }
  }
}

/** Every live target, oldest first. */
export function liveTabTargets(rt: AxfRuntime): TabTarget[] {
  return [...controlOf(rt).live.values()].map(({ kind, id, label, screen, tabs }) => ({ kind, id, label, ...(screen ? { screen } : {}), ...(tabs ? { tabs } : {}) }));
}

/** What the rows on screen show now: "<row>:<tab>" for each live row of the current screen. */
export function activeTabsOf(rt: AxfRuntime): string[] {
  const view = rt.getState().view;
  return [...controlOf(rt).live.values()].filter((t) => t.kind === 'tab-group' && t.value && (!t.screen || t.screen === view)).map((t) => `${t.id}:${t.value}`);
}

/** Add (or refresh) a live target; → the function that takes it away. */
export function registerTabTarget(rt: AxfRuntime, key: string, target: LiveTarget): () => void {
  const c = controlOf(rt);
  const clean = normalizeTabTarget(target);
  if (!clean) return () => undefined;
  c.live.set(key, { ...target, ...clean });
  if (clean.kind === 'tab-group' && clean.tabs?.length) {
    const prev = c.seen[clean.id];
    if (!prev || JSON.stringify(prev) !== JSON.stringify(clean)) { delete c.seen[clean.id]; c.seen[clean.id] = clean; saveSeen(c.seen); }
    syncActions(rt);
  }
  return () => { if (c.live.get(key)?.id === clean.id) c.live.delete(key); };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait (up to `ms`) until `fn` gives something. */
async function waitFor<T>(fn: () => T | null, ms = TAB_WAIT_MS): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(50);
  }
}

export interface TabOpenResult { ok: boolean; message: string; opened: string[] }

/**
 * Open a path: `[screen/]tab[/sub-tab|section…]`. Waits for each row to mount (the screen, or the tab before it, may
 * still be drawing). → what it opened, or what it could not find (with the tabs that are there).
 */
export async function openTabPath(rt: AxfRuntime, path: string, opts: { screen?: string; waitMs?: number } = {}): Promise<TabOpenResult> {
  const parts = splitTabPath(path);
  const opened: string[] = [];
  const waitMs = opts.waitMs ?? TAB_WAIT_MS;
  const c = controlOf(rt);
  if (!parts.length) return { ok: false, message: 'no tab path', opened };
  const go = (view: string, label: string) => {
    if (rt.getState().view !== view) rt.search.focus({ id: `view:${view}`, kind: 'view', label, focus: { kind: 'view', view } });
    opened.push(label || view);
  };
  if (opts.screen) go(opts.screen, screenLabel(rt, opts.screen) || opts.screen);
  else {
    const here0 = rt.getState().view;
    const known = () => tabScreenOf(rt, parts[0]!) ?? (pickTabTarget([...c.live.values(), ...Object.values(c.seen)], parts[0], { screen: here0 }) ? 'tab' : null);
    // a plugin's screen registers once its plugin has loaded (a deep link at start-up comes first): wait for it, when the
    // path has more parts (a lone word may be a tab of a row not drawn yet, waited for below)
    const s = parts.length > 1 ? await waitFor(known, waitMs) : known();
    if (s && s !== 'tab') { go(s.view, s.label); parts.shift(); }
    else {
      // not a screen: a tab of a row this device has seen elsewhere goes to that row's screen first
      const here = rt.getState().view;
      const hit = pickTabTarget(liveTabTargets(rt), parts[0], { screen: here }) ?? pickTabTarget(Object.values(c.seen), parts[0], { screen: here });
      if (hit?.target.screen && hit.target.screen !== here) go(hit.target.screen, screenLabel(rt, hit.target.screen) || hit.target.screen);
    }
  }
  for (const part of parts) {
    const view = rt.getState().view;
    // Settings: a part naming a settings tab or sub-tab goes through settings.open (it opens the parent first)
    if (view === 'settings') {
      const tabs = rt.settings.listTabs();
      const p = part.trim().toLowerCase();
      const t = tabs.find((x) => x.id.toLowerCase() === p) ?? tabs.find((x) => fold(x.label) === fold(part)) ?? tabs.find((x) => fold(x.id) === fold(part));
      if (t) { rt.dispatch(`settings.open:${t.id}`); opened.push(t.label); await sleep(0); continue; }
    }
    const hit = await waitFor(() => {
      const r = pickTabTarget([...c.live.values()], part, { screen: rt.getState().view });
      return r ? { ...r, live: r.target as LiveTarget } : null;
    }, waitMs);
    if (!hit) {
      const rows = [...c.live.values()].filter((t) => t.kind === 'tab-group' && (!t.screen || t.screen === rt.getState().view));
      const there = rows.map((r) => `${r.label}: ${(r.tabs ?? []).map((t) => t.label).join(', ')}`).join('; ');
      return { ok: false, message: `no tab or section "${part}" on ${screenLabel(rt, rt.getState().view) || rt.getState().view}${there ? ` (tabs here: ${there})` : ''}`, opened };
    }
    if (hit.value !== null) {
      if (hit.live.value !== hit.value) hit.live.select?.(hit.value);
      opened.push(hit.live.tabs?.find((t) => t.value === hit.value)?.label ?? hit.value);
    } else {
      hit.live.expand?.();
      hit.live.element?.()?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      opened.push(hit.live.label);
    }
    await sleep(0);
  }
  return { ok: true, message: `opened ${opened.join(' › ')}`, opened };
}

/** A link that opens the app on a screen/tab path. */
export function tabDeepLink(path: string, base = typeof location !== 'undefined' ? location.href : 'https://localhost/'): string {
  const u = new URL(base);
  u.searchParams.set(TAB_DEEP_LINK_PARAM, path);
  return u.toString();
}

/**
 * Install tab control on a runtime (AxfProvider does): the `tab.open` action, the remembered per-tab actions, and the
 * deep link `?axf-open=` (read once, then taken off the address). → cleanup.
 */
export function installTabControl(rt: AxfRuntime): () => void {
  const off = rt.actions.register(TAB_OPEN_ACTION, (args) => { const p = args.join(':'); if (p) void openTabPath(rt, p).then((r) => { if (!r.ok) rt.toast(r.message, 'warning', 'Open tab'); }); }, { label: 'Open a screen / tab / section (path)', params: true, effect: 'navigate', module: 'axf.framework' });
  syncActions(rt);
  let link = '';
  try {
    const u = new URL(location.href);
    link = u.searchParams.get(TAB_DEEP_LINK_PARAM) ?? '';
    if (link) { u.searchParams.delete(TAB_DEEP_LINK_PARAM); history.replaceState(history.state, '', u.toString()); }
  } catch { /* no location (tests, SSR) */ }
  if (link) void sleep(0).then(() => openTabPath(rt, link, { waitMs: TAB_WAIT_MS * 2 })).then((r) => { if (!r.ok) rt.toast(r.message, 'warning', 'Link'); });
  return off;
}

