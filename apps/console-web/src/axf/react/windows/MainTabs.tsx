/*
 * main-tabs@1 (React): the main area as a tab group on the dock engine. Every screen opened in the main area becomes a
 * tab of the main window's dock (icon, title, close, dirty dot), the tabs come back after a reload, and each one can be
 * pinned, duplicated, reopened after closing, dragged out to float, dropped back onto a strip from a floating window's
 * title bar, or dropped on an edge to split the area. The strip sits top, bottom, left or right; on a phone it turns
 * into a compact strip with swipe between tabs and long-press to drag.
 *
 * Rules (which tabs close, pinned order, settings, the saved session) live in core/engines/maintabs.ts. Everything
 * visual reads theme tokens (framework/ui/axf.css, "main-area tab group"); the strip reuses the tab-group asset's
 * classes, so swapping that asset restyles it.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Icon } from '../components/Icon';
import { Button } from '../components/Controls';
import type { AxfRuntime } from '../../core/runtime';
import type { MenuEntry, TabGroup, TabSpec } from '../../core/engines/windows';
import { activeTab, isFloating, paneGroups } from '../../core/engines/windows';
import type { DockSide } from '../../core/engines/dock';
import {
  closeOthersIds, closeRightIds, evictIds, isVerticalStrip, MAIN_TAB_KEYS, MAIN_TABS_SESSION_KEY, normalizeMainTabSettings, normalizeMainTabsSession,
  pinnedFirst, pushClosed, resolveView, stripDropIndex, swipeIndex, swipeOf, tabView, touchOrder, viewTab,
  DEFAULT_MAIN_TAB_SETTINGS, MAIN_TABS_FRAME, MAX_TABS_LIMIT, TAB_STRIP_POSITIONS, TAB_STRIP_SIZES,
  type ClosedTab, type MainTabInfo, type MainTabSettings, type MainTabsApi, type TabStripPosition,
} from '../../core/engines/maintabs';
import { DockHost, DockLeafContext } from './DockHost';
import { useTabRenderers, useWindowManager, useWindowState } from './WindowHost';
import { markStrip, stripAt } from './strips';
import type { ViewMap } from '../AppShell';
import type { AxfWebLibrary } from '../library';

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

/** The tab group settings in force (re-read whenever a setting changes). */
export function useMainTabSettings(): MainTabSettings {
  const rt = useRuntime();
  const rev = useSyncExternalStore(rt.settings.subscribe, rt.settings.getRevision);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readSettings(rt), [rt, rev]);
}
const readSettings = (rt: AxfRuntime) => normalizeMainTabSettings(Object.fromEntries(Object.entries(MAIN_TAB_KEYS).map(([k, key]) => [k, rt.settings.get(key)])));

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const POSITION_LABEL: Record<TabStripPosition, string> = { top: 'Top', bottom: 'Bottom', left: 'Left stack', right: 'Right stack' };

/** Settings → Tab group (also opened from the strip's right-click). Schema-built, so it gets the level toolbar like every settings tab. */
export const mainTabsLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.main-tabs',
  label: 'Main area tabs',
  version: '0.1.0',
  settingsTabs: [{ id: 'tab-group', label: 'Tab group', icon: 'layout', order: 15, description: 'The tabs every screen opens in: where the strip sits, how tabs look, how many stay open, and what comes back after a reload.' }],
  settings: [
    { id: 'axf.mainTabs.strip', label: 'Tab strip', icon: 'layout', tab: 'tab-group', order: 10, settings: [
      { key: MAIN_TAB_KEYS.enabled, label: 'Open screens as tabs', description: 'Off: the main area shows one screen at a time.', kind: 'toggle', default: DEFAULT_MAIN_TAB_SETTINGS.enabled, scope: 'device' },
      { key: MAIN_TAB_KEYS.position, label: 'Position', kind: 'choice', default: DEFAULT_MAIN_TAB_SETTINGS.position, scope: 'device', options: TAB_STRIP_POSITIONS.map((p) => ({ value: p, label: POSITION_LABEL[p] })) },
      { key: MAIN_TAB_KEYS.size, label: 'Size', kind: 'choice', default: DEFAULT_MAIN_TAB_SETTINGS.size, scope: 'device', options: TAB_STRIP_SIZES.map((s) => ({ value: s, label: cap(s) })) },
      { key: MAIN_TAB_KEYS.showIcons, label: 'Show icons', kind: 'toggle', default: DEFAULT_MAIN_TAB_SETTINGS.showIcons, scope: 'device' },
      { key: MAIN_TAB_KEYS.closeButtons, label: 'Close buttons', kind: 'choice', default: DEFAULT_MAIN_TAB_SETTINGS.closeButtons, scope: 'device', options: [
        { value: 'always', label: 'On every tab' }, { value: 'hover', label: 'On hover and the active tab' }, { value: 'active', label: 'Only the active tab' }, { value: 'never', label: 'Never (middle-click or the menu)' },
      ] },
      { key: MAIN_TAB_KEYS.animation, label: 'Animate tabs', kind: 'toggle', default: DEFAULT_MAIN_TAB_SETTINGS.animation, scope: 'device' },
    ] },
    { id: 'axf.mainTabs.behaviour', label: 'Behaviour', icon: 'settings', tab: 'tab-group', order: 20, settings: [
      { key: MAIN_TAB_KEYS.openAs, label: 'A screen opened from the menu', kind: 'choice', default: DEFAULT_MAIN_TAB_SETTINGS.openAs, scope: 'device', options: [{ value: 'tab', label: 'Opens a new tab' }, { value: 'replace', label: 'Replaces the active tab (pinned tabs stay)' }] },
      { key: MAIN_TAB_KEYS.maxTabs, label: 'Most tabs per group (0 = no limit)', description: 'Past it the tab used longest ago closes; pinned and active tabs never do.', kind: 'number', default: DEFAULT_MAIN_TAB_SETTINGS.maxTabs, min: 0, max: MAX_TABS_LIMIT, step: 1, scope: 'device' },
      { key: MAIN_TAB_KEYS.restore, label: 'Reopen my tabs when the app starts', kind: 'toggle', default: DEFAULT_MAIN_TAB_SETTINGS.restore, scope: 'device' },
      { key: MAIN_TAB_KEYS.swipe, label: 'Swipe between tabs (touch)', kind: 'toggle', default: DEFAULT_MAIN_TAB_SETTINGS.swipe, scope: 'device' },
    ] },
  ],
};

/* ------------------------------------------------------------------ */
/* controller                                                          */
/* ------------------------------------------------------------------ */

interface MainTabsCtl {
  settings: MainTabSettings;
  narrow: boolean;
  pinned: ReadonlySet<string>;
  dirty: ReadonlySet<string>;
  activate(groupId: string, tabId: string): void;
  close(tabId: string): void;
  float(tabId: string, x?: number, y?: number): void;
  setDirty(tabId: string, dirty: boolean): void;
  /** the group new screens open in */
  touchGroup(groupId: string): void;
}
const CtlCtx = createContext<MainTabsCtl | null>(null);
const TabIdCtx = createContext<string | null>(null);

/**
 * Mark the tab this screen is in as having unsaved changes (the strip shows a dot). No-op outside the main tab group.
 *   useTabDirty(form.changed)
 */
export function useTabDirty(dirty: boolean) {
  const ctl = useContext(CtlCtx);
  const id = useContext(TabIdCtx);
  useEffect(() => { if (ctl && id) { ctl.setDirty(id, dirty); return () => ctl.setDirty(id, false); } return undefined; }, [ctl, id, dirty]);
}

const sessionStorageKey = (rt: AxfRuntime) => `${rt.manifest?.app?.id ?? 'app'}:${MAIN_TABS_SESSION_KEY}`;
function loadSession(rt: AxfRuntime) {
  try { return normalizeMainTabsSession(JSON.parse(globalThis.localStorage?.getItem(sessionStorageKey(rt)) ?? 'null')); } catch { return normalizeMainTabsSession(null); }
}
function saveSession(rt: AxfRuntime, data: { dock: unknown; pinned: string[]; closed: ClosedTab[] }) {
  try { globalThis.localStorage?.setItem(sessionStorageKey(rt), JSON.stringify({ $axf: MAIN_TABS_FRAME, ...data })); } catch { /* storage unavailable: tabs just won't come back */ }
}

function useNarrow(): boolean {
  const q = '(max-width: 640px)';
  const get = () => typeof matchMedia === 'function' && matchMedia(q).matches;
  const [n, setN] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const m = matchMedia(q); const on = () => setN(m.matches);
    m.addEventListener('change', on); return () => m.removeEventListener('change', on);
  }, []);
  return n;
}

/**
 * The main area as a tab group. AppShell renders it in place of the single screen when `mainTabs` is on and the
 * person hasn't switched tabs off.
 */
export function MainTabsArea({ views }: { views: ViewMap }) {
  const rt = useRuntime();
  const wm = useWindowManager();
  const ws = useWindowState();
  const state = useAxfState();
  const settings = useMainTabSettings();
  const narrow = useNarrow();
  const main = wm.mainWindowId;
  const viewsRef = useRef(views); viewsRef.current = views;
  const settingsRef = useRef(settings); settingsRef.current = settings;

  const [session] = useState(() => loadSession(rt));
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(session.pinned));
  const pinnedRef = useRef(pinned); pinnedRef.current = pinned;
  const closedRef = useRef<ClosedTab[]>(session.closed);
  const [dirty, setDirtySet] = useState<Set<string>>(() => new Set());
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const mru = useRef<string[]>([]);
  const current = useRef<string | null>(null);

  /* ---- helpers over the window manager's state (always the latest) ---- */
  const mainGroups = useCallback((): TabGroup[] => { const t = wm.state.layouts[main]; return t ? paneGroups(t).map((g) => wm.state.groups[g]).filter((g): g is TabGroup => !!g) : []; }, [wm, main]);
  const findTab = useCallback((tabId: string) => { for (const g of Object.values(wm.state.groups)) { const i = g.tabs.findIndex((t) => t.id === tabId); if (i >= 0) return { g, i, tab: g.tabs[i]! }; } return null; }, [wm]);
  const currentGroup = useCallback((): TabGroup | null => {
    const gs = mainGroups();
    return gs.find((g) => g.id === current.current) ?? gs.find((g) => tabView(activeTab(g) ?? { kind: '' }) === rt.getState().view) ?? gs[0] ?? null;
  }, [mainGroups, rt]);
  /** a tab id, a screen id or a screen's title → the tab (main area first, then floating windows) */
  const resolveTab = useCallback((q: string) => {
    const byId = findTab(q); if (byId) return byId;
    const list = Object.entries(viewsRef.current).map(([id, v]) => ({ id, title: v.title }));
    const view = resolveView(list, q) ?? q;
    const order = [...mainGroups(), ...Object.values(wm.state.groups).filter((g) => g.windowId !== main)];
    for (const g of order) { const i = g.tabs.findIndex((t) => tabView(t) === view); if (i >= 0) return { g, i, tab: g.tabs[i]! }; }
    return null;
  }, [findTab, mainGroups, wm, main]);

  const closeTab = useCallback((tabId: string) => {
    const f = findTab(tabId); if (!f) return;
    closedRef.current = pushClosed(closedRef.current, f.tab);
    mru.current = mru.current.filter((x) => x !== tabId);
    if (pinnedRef.current.has(tabId)) setPinned((p) => { const n = new Set(p); n.delete(tabId); return n; });
    setDirtySet((d) => (d.has(tabId) ? new Set([...d].filter((x) => x !== tabId)) : d));
    wm.closeTab(tabId);
  }, [findTab, wm]);

  const enforceLimit = useCallback((groupId: string) => {
    const g = wm.state.groups[groupId]; const max = settingsRef.current.maxTabs; if (!g || !max) return;
    for (const id of evictIds(g.tabs, activeTab(g)?.id ?? null, [...pinnedRef.current], max, mru.current)) closeTab(id);
  }, [wm, closeTab]);

  /** Show a screen: bring up its tab, or open one (a new tab, or in place of the active one when "replace" is set). */
  const ensureView = useCallback((view: string, force = false): boolean => {
    const def = viewsRef.current[view]; if (!def) return false;
    for (const g of mainGroups()) {
      const i = g.tabs.findIndex((t) => tabView(t) === view);
      if (i >= 0) { current.current = g.id; if (g.active !== i) wm.activate(g.id, i); mru.current = touchOrder(mru.current, g.tabs[i]!.id); return true; }
    }
    if (!force) {
      const floating = Object.values(wm.state.groups).find((g) => g.windowId !== main && g.tabs.some((t) => tabView(t) === view));
      if (floating) { wm.activate(floating.id, floating.tabs.findIndex((t) => tabView(t) === view)); const w = wm.state.windows.find((x) => x.id === floating.windowId); if (w?.minimized) wm.restore(w.id); else wm.focus(floating.windowId); return true; }
    }
    const taken = new Set(Object.values(wm.state.groups).flatMap((g) => g.tabs.map((t) => t.id)));
    let seq = 0; let tab = viewTab(view, def.title, def.icon); while (taken.has(tab.id)) tab = viewTab(view, def.title, def.icon, ++seq);
    const g = currentGroup();
    if (!g) { current.current = wm.openGroup([tab], main); mru.current = touchOrder(mru.current, tab.id); return true; }
    const act = activeTab(g);
    const replace = settingsRef.current.openAs === 'replace' && act && !pinnedRef.current.has(act.id) && !dirtyRef.current.has(act.id) && tabView(act);
    wm.addTab(g.id, tab, replace ? g.active + 1 : -1);
    if (replace && act) closeTab(act.id);
    current.current = g.id;
    mru.current = touchOrder(mru.current, tab.id);
    enforceLimit(g.id);
    return true;
  }, [mainGroups, wm, main, currentGroup, closeTab, enforceLimit]);

  const floatTab = useCallback((tabId: string, x?: number, y?: number) => {
    if (pinnedRef.current.has(tabId)) setPinned((p) => { const n = new Set(p); n.delete(tabId); return n; });
    wm.floatTab(tabId, x, y, Math.min(720, Math.round((globalThis.innerWidth ?? 800) * 0.9)), Math.min(560, Math.round((globalThis.innerHeight ?? 600) * 0.8)));
  }, [wm]);

  /** Dock a floating window (its tabs join the group new screens open in, or start the main dock). */
  const dockWindow = useCallback((windowId: string): boolean => {
    const w = wm.state.windows.find((x) => x.id === windowId); if (!w || !isFloating(w)) return false;
    const g = currentGroup();
    return g ? wm.redockInto(windowId, { target: 'group', groupId: g.id, zone: 'centre' }, main) : wm.redockInto(windowId, { target: 'root', zone: 'right' }, main);
  }, [wm, currentGroup, main]);

  const togglePin = useCallback((tabId: string) => {
    const f = findTab(tabId); if (!f) return;
    const on = !pinnedRef.current.has(tabId);
    const next = new Set(pinnedRef.current); if (on) next.add(tabId); else next.delete(tabId);
    setPinned(next); pinnedRef.current = next;
    const order = pinnedFirst(f.g.tabs, [...next]);
    wm.moveTab(tabId, f.g.id, order.findIndex((t) => t.id === tabId));
  }, [findTab, wm]);

  const duplicate = useCallback((tabId: string) => {
    const f = findTab(tabId); if (!f) return;
    const taken = new Set(Object.values(wm.state.groups).flatMap((g) => g.tabs.map((t) => t.id)));
    let n = 1; let id = `${f.tab.id}-copy`; while (taken.has(id)) id = `${f.tab.id}-copy${++n}`;
    wm.addTab(f.g.id, { ...f.tab, id }, f.i + 1);
    enforceLimit(f.g.id);
  }, [findTab, wm, enforceLimit]);

  const splitTab = useCallback((tabId: string, side: DockSide) => {
    const f = findTab(tabId); if (!f) return;
    if (f.g.tabs.length < 2) { rt.toast('Open another tab first: a split needs one tab on each side.', 'info', 'Split'); return; }
    wm.dropTab(tabId, f.g.windowId, { target: 'group', groupId: f.g.id, zone: side });
  }, [findTab, wm, rt]);

  const reopen = useCallback((): boolean => {
    const [last, ...rest] = closedRef.current; if (!last) return false;
    closedRef.current = rest;
    return ensureView(last.view, true);
  }, [ensureView]);

  const openSettingsFor = useCallback((tabId: string) => {
    const view = tabView(findTab(tabId)?.tab ?? { kind: '' });
    const lib = view ? rt.libraries.find((l) => l.ui?.views.some((v) => v.id === view)) : undefined;
    const tab = lib?.ui?.settingsTabs[0]?.id;
    rt.dispatch(`settings.open:${tab ?? 'tab-group'}`);
    if (!tab) rt.toast('This screen has no settings of its own: here are the tab group settings.', 'info');
  }, [findTab, rt]);

  /* ---- restore, then follow navigation ---- */
  useLayoutEffect(() => {
    if (settingsRef.current.restore && session.dock && !wm.state.layouts[main]) {
      wm.restoreLayout(session.dock, main);
      // tabs whose screen isn't in this app any more (a plugin was removed) don't come back
      for (const g of mainGroups()) for (const t of g.tabs) { const v = tabView(t); if (v && !viewsRef.current[v]) wm.closeTab(t.id); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { ensureView(state.view); }, [state.view, ensureView]);
  // the same screen clicked again after its tab was closed: open it again
  useEffect(() => rt.onNavigate((v) => { ensureView(v); }), [rt, ensureView]);
  // the active tab of the group in use is the screen the app shows (nav highlight, page title, console "here")
  useEffect(() => wm.subscribe(() => {
    const g = currentGroup(); const v = g ? tabView(activeTab(g) ?? { kind: '' }) : null;
    if (v && v !== rt.getState().view && viewsRef.current[v]) rt.navigateHere(v);
    const a = g && activeTab(g); if (a) mru.current = touchOrder(mru.current, a.id);
  }), [wm, rt, currentGroup]);
  // save the session (debounced) whenever the dock or the pins change
  useEffect(() => {
    const t = setTimeout(() => saveSession(rt, { dock: wm.snapshot(main), pinned: [...pinned].filter((id) => !!findTab(id)), closed: closedRef.current }), 300);
    return () => clearTimeout(t);
  }, [rt, wm, main, ws, pinned, findTab]);

  /* ---- actions, context menus and the runtime API (console commands, REST, MCP, CLI) ---- */
  useEffect(() => {
    const api: MainTabsApi = {
      list: () => Object.values(wm.state.groups).flatMap((g) => {
        const w = wm.state.windows.find((x) => x.id === g.windowId);
        return g.tabs.map((t, i): MainTabInfo => ({ id: t.id, view: tabView(t), title: t.title, where: w && isFloating(w) ? 'floating' : 'main', window: g.windowId, group: g.id, active: i === g.active, pinned: pinnedRef.current.has(t.id), dirty: dirtyRef.current.has(t.id) }));
      }),
      open: (q) => { const list = Object.entries(viewsRef.current).map(([id, v]) => ({ id, title: v.title })); const v = resolveView(list, q); return v ? ensureView(v) : false; },
      close: (q) => { const f = resolveTab(q); if (!f) return false; closeTab(f.tab.id); return true; },
      float: (q) => { const f = resolveTab(q); if (!f) return false; const w = wm.state.windows.find((x) => x.id === f.g.windowId); if (w && isFloating(w)) { wm.focus(w.id); return true; } floatTab(f.tab.id); return true; },
      dock: (q) => {
        if (wm.state.windows.some((w) => w.id === q)) return dockWindow(q);
        const f = resolveTab(q); if (!f) return false;
        const w = wm.state.windows.find((x) => x.id === f.g.windowId); if (!w || !isFloating(w)) return true;
        const g = currentGroup(); if (!g) return dockWindow(w.id);
        return wm.dropTab(f.tab.id, main, { target: 'group', groupId: g.id, zone: 'centre' });
      },
      reopen,
    };
    rt.mainTabs = api;
    const a = rt.actions;
    const offs = [
      a.register('tabs.open', ([q = '']) => { if (!api.open(q)) rt.toast(`No screen called "${q}"`, 'warning', 'Open tab'); }, { label: 'Open a screen in a tab', params: true }),
      a.register('tabs.activate', ([id = '']) => { const f = findTab(id); if (f) { current.current = f.g.id; wm.activate(f.g.id, f.i); wm.focus(f.g.windowId); } }, { label: 'Show a tab', params: true, searchable: false }),
      a.register('tabs.close', ([q = '']) => { api.close(q); }, { label: 'Close a tab', params: true }),
      a.register('tabs.closeOthers', ([id = '']) => { const f = findTab(id); if (f) closeOthersIds(f.g.tabs, id, [...pinnedRef.current]).forEach(closeTab); }, { label: 'Close the other tabs', params: true }),
      a.register('tabs.closeRight', ([id = '']) => { const f = findTab(id); if (f) closeRightIds(f.g.tabs, id, [...pinnedRef.current]).forEach(closeTab); }, { label: 'Close the tabs to the right', params: true }),
      a.register('tabs.float', ([q = '']) => { api.float(q); }, { label: 'Float a tab in its own window', params: true }),
      a.register('tabs.dock', ([q = '']) => { if (!api.dock(q)) rt.toast('Nothing to dock there.', 'info', 'Dock'); }, { label: 'Dock a window or tab into the tab group', params: true }),
      a.register('tabs.split', ([id = '', side = 'right']) => splitTab(id, (['left', 'right', 'top', 'bottom'].includes(side) ? side : 'right') as DockSide), { label: 'Split a tab off to one side', params: true }),
      a.register('tabs.pin', ([id = '']) => togglePin(id), { label: 'Pin or unpin a tab', params: true }),
      a.register('tabs.duplicate', ([id = '']) => duplicate(id), { label: 'Duplicate a tab', params: true }),
      a.register('tabs.reopen', () => { if (!reopen()) rt.toast('No closed tabs to reopen.', 'info'); }, { label: 'Reopen closed tab' }),
      a.register('tabs.settings', ([id = '']) => openSettingsFor(id), { label: 'Settings of a tab’s screen', params: true }),
      a.register('tabs.position', ([p = 'top']) => rt.settings.set(MAIN_TAB_KEYS.position, (TAB_STRIP_POSITIONS as string[]).includes(p) ? p : 'top'), { label: 'Move the tab strip', params: true }),
      a.register('tabs.size', ([s = 'normal']) => rt.settings.set(MAIN_TAB_KEYS.size, (TAB_STRIP_SIZES as string[]).includes(s) ? s : 'normal'), { label: 'Tab strip size', params: true }),
    ];
    const pos = (): MenuEntry[] => TAB_STRIP_POSITIONS.map((p) => ({ id: `pos-${p}`, label: `${POSITION_LABEL[p]}${settingsRef.current.position === p ? ' ✓' : ''}`, icon: 'layout', action: `tabs.position:${p}` }));
    rt.contextExtras.set('main-tab', (_t, id) => {
      const f = id ? findTab(id) : null; const pin = !!id && pinnedRef.current.has(id);
      return [
        { id: 'tab-settings', label: 'Settings…', icon: 'settings', action: 'tabs.settings:{payload}' },
        { id: 'tab-float', label: 'Float', icon: 'external', action: 'tabs.float:{payload}' },
        { id: 'tab-split', label: 'Split', icon: 'layout', items: [
          { id: 'split-right', label: 'To the right', icon: 'layout', action: 'tabs.split:{payload}:right' },
          { id: 'split-bottom', label: 'Below', icon: 'layout', action: 'tabs.split:{payload}:bottom' },
          { id: 'split-left', label: 'To the left', icon: 'layout', action: 'tabs.split:{payload}:left' },
          { id: 'split-top', label: 'Above', icon: 'layout', action: 'tabs.split:{payload}:top' },
        ] },
        { id: 'tab-pin', label: pin ? 'Unpin' : 'Pin', icon: 'star', action: 'tabs.pin:{payload}' },
        { id: 'tab-dup', label: 'Duplicate', icon: 'copy', action: 'tabs.duplicate:{payload}' },
        { id: 's1', separator: true },
        ...(pin ? [] : [{ id: 'tab-close', label: 'Close', icon: 'x', action: 'tabs.close:{payload}' }]),
        { id: 'tab-close-others', label: 'Close others', icon: 'x', action: 'tabs.closeOthers:{payload}' },
        ...(f && f.i < f.g.tabs.length - 1 ? [{ id: 'tab-close-right', label: isVerticalStrip(settingsRef.current.position) ? 'Close tabs below' : 'Close tabs to the right', icon: 'x', action: 'tabs.closeRight:{payload}' }] : []),
        { id: 's2', separator: true },
        ...(closedRef.current.length ? [{ id: 'tab-reopen', label: `Reopen ${closedRef.current[0]!.title}`, icon: 'undo', action: 'tabs.reopen' }] : []),
        { id: 'tab-group-settings', label: 'Tab group settings…', icon: 'settings', action: 'settings.open:tab-group' },
      ];
    });
    rt.contextExtras.set('main-tab-strip', () => [
      { id: 'strip-pos', label: 'Tab position', icon: 'layout', items: pos() },
      { id: 'strip-size', label: 'Tab size', icon: 'type', items: TAB_STRIP_SIZES.map((s) => ({ id: `size-${s}`, label: `${cap(s)}${settingsRef.current.size === s ? ' ✓' : ''}`, icon: 'type', action: `tabs.size:${s}` })) },
      ...(closedRef.current.length ? [{ id: 'strip-reopen', label: `Reopen ${closedRef.current[0]!.title}`, icon: 'undo', action: 'tabs.reopen' }] : []),
      { id: 's1', separator: true },
      { id: 'strip-settings', label: 'Tab group settings…', icon: 'settings', action: 'settings.open:tab-group' },
    ]);
    rt.contextExtras.set('main-tab-list', (_t, gid) => {
      const g = gid ? wm.state.groups[gid] : null;
      return [
        ...(g?.tabs ?? []).map((t, i): MenuEntry => ({ id: `go-${t.id}`, label: `${i === g!.active ? '● ' : ''}${t.title}`, icon: t.icon ?? 'file', action: `tabs.activate:${t.id}` })),
        ...(closedRef.current.length ? [{ id: 's1', separator: true }, ...closedRef.current.slice(0, 5).map((c, i): MenuEntry => ({ id: `closed-${i}`, label: `Reopen ${c.title}`, icon: 'undo', action: `tabs.open:${c.view}` }))] : []),
      ];
    });
    // a floating window's title menu: dock it back as tabs
    const windowMenu = rt.contextExtras.get('window-title');
    rt.contextExtras.set('window-title', (t, p) => [{ id: 'dock-tabs', label: 'Dock as tabs', icon: 'download', action: 'tabs.dock:{payload}' }, ...(windowMenu?.(t, p) ?? [])]);
    // Ctrl/⌘+Shift+T reopens the last closed tab
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); reopen(); } };
    globalThis.addEventListener?.('keydown', onKey);
    return () => {
      offs.forEach((off) => off());
      ['main-tab', 'main-tab-strip', 'main-tab-list'].forEach((k) => rt.contextExtras.delete(k));
      if (windowMenu) rt.contextExtras.set('window-title', windowMenu); else rt.contextExtras.delete('window-title');
      globalThis.removeEventListener?.('keydown', onKey);
      if (rt.mainTabs === api) rt.mainTabs = null;
    };
  }, [rt, wm, main, ensureView, resolveTab, closeTab, floatTab, dockWindow, currentGroup, findTab, splitTab, togglePin, duplicate, reopen, openSettingsFor]);

  const ctl = useMemo<MainTabsCtl>(() => ({
    settings, narrow, pinned, dirty,
    activate: (gid, tabId) => { const g = wm.state.groups[gid]; if (!g) return; current.current = gid; const i = g.tabs.findIndex((t) => t.id === tabId); if (i >= 0 && i !== g.active) wm.activate(gid, i); },
    close: closeTab,
    float: floatTab,
    setDirty: (id, on) => setDirtySet((d) => (d.has(id) === on ? d : on ? new Set([...d, id]) : new Set([...d].filter((x) => x !== id)))),
    touchGroup: (gid) => { current.current = gid; },
  }), [settings, narrow, pinned, dirty, wm, closeTab, floatTab]);

  const leaf = useCallback((g: TabGroup) => <MainTabGroupView group={g} />, []);
  return (
    <CtlCtx.Provider value={ctl}>
      <DockLeafContext.Provider value={leaf}>
        <DockHost windowId={main} className="fx-maintabs-dock" empty={<MainTabsEmpty canReopen={closedRef.current.length > 0} onReopen={reopen} />} />
      </DockLeafContext.Provider>
    </CtlCtx.Provider>
  );
}

function MainTabsEmpty({ canReopen, onReopen }: { canReopen: boolean; onReopen: () => void }) {
  const rt = useRuntime();
  return (
    <div className="fx-empty fx-maintabs__empty">
      <Icon name="layout" />
      <p>No tabs open. Pick a screen from the menu, or:</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="home" onClick={() => rt.navigate('home')}>Open Home</Button>
        {canReopen && <Button icon="undo" onClick={onReopen}>Reopen closed tab</Button>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* one group: strip + content                                          */
/* ------------------------------------------------------------------ */

/** What a drag over a strip would do: land in `group` at `index`. */
interface StripDrop { group: string; index: number }
function stripDropAt(x: number, y: number): StripDrop | null {
  const s = stripAt(x, y); if (!s) return null;
  const vertical = s.el.getAttribute('aria-orientation') === 'vertical';
  const spans = [...s.el.querySelectorAll<HTMLElement>('[data-fx-tab-id]')].map((t) => { const r = t.getBoundingClientRect(); return (vertical ? [r.top, r.bottom] : [r.left, r.right]) as [number, number]; });
  return { group: s.group, index: stripDropIndex(spans, vertical ? y : x) };
}

function MainTabGroupView({ group }: { group: TabGroup }) {
  const rt = useRuntime();
  const wm = useWindowManager();
  const ctl = useContext(CtlCtx)!;
  const renderers = useTabRenderers();
  const ref = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const { settings, narrow } = ctl;
  // phone: side stacks take too much width, so the strip runs along the top as a compact row
  const position: TabStripPosition = narrow && isVerticalStrip(settings.position) ? 'top' : settings.position;
  const vertical = isVerticalStrip(position);
  const size = narrow ? 'compact' : settings.size;
  const tabs = group.tabs;
  const active = tabs[group.active];

  // bounds for the dock engine's drop zones (pane edges + centre); the strip itself handles drops onto it
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const report = () => {
      const r = el.getBoundingClientRect(); wm.groupBounds.set(group.id, [r.left, r.top, r.right, r.bottom]);
      const bar = stripRef.current;
      wm.groupHeaders.set(group.id, bar && position === 'top' ? bar.getBoundingClientRect().height : 0);
      if (bar && !vertical) wm.tabEdges.set(group.id, [...bar.querySelectorAll<HTMLElement>('[data-fx-tab-id]')].map((t) => t.getBoundingClientRect().right)); else wm.tabEdges.delete(group.id);
    };
    report();
    const ro = new ResizeObserver(report); ro.observe(el);
    globalThis.addEventListener('scroll', report, true);
    return () => { ro.disconnect(); globalThis.removeEventListener('scroll', report, true); wm.groupBounds.delete(group.id); wm.groupHeaders.delete(group.id); wm.tabEdges.delete(group.id); };
  });
  // keep the active tab in view
  useEffect(() => { stripRef.current?.querySelector<HTMLElement>('[data-fx-tab-id].is-active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [active?.id]);
  // a mouse wheel scrolls a top / bottom strip sideways
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => { const s = stripRef.current; if (!s || vertical || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; s.scrollLeft += e.deltaY; };

  // swipe between tabs (touch, content area)
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onBodyDown = (e: React.PointerEvent) => {
    ctl.touchGroup(group.id);
    if (e.pointerType !== 'touch' || !settings.swipe || tabs.length < 2) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable], .fx-scroll-x, [data-fx-noswipe]')) return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onBodyUp = (e: React.PointerEvent) => {
    const s = swipe.current; swipe.current = null; if (!s || s.id !== e.pointerId) return;
    const dir = swipeOf(e.clientX - s.x, e.clientY - s.y); if (!dir) return;
    const i = swipeIndex(group.active, dir, tabs.length);
    if (i !== group.active) ctl.activate(group.id, tabs[i]!.id);
  };

  const render = active ? (renderers[active.kind] ?? renderers.placeholder) : null;
  return (
    <div ref={ref} className={`fx-tabgroup fx-maintabs fx-maintabs--${position} fx-maintabs--${size} ${settings.animation ? '' : 'fx-maintabs--still'} ${narrow ? 'fx-maintabs--narrow' : ''}`.trim()}
      data-fx-tabs={tabs.length} data-fx-close={narrow ? 'active' : settings.closeButtons} data-fx-icons={settings.showIcons ? 'on' : 'off'} onPointerDownCapture={() => ctl.touchGroup(group.id)}>
      <div ref={stripRef} className={`fx-tabgroup__bar fx-maintabs__strip ${drop !== null ? 'is-drop-target' : ''}`.trim()} role="tablist" aria-orientation={vertical ? 'vertical' : 'horizontal'}
        data-fx-tabstrip={group.id} data-fx-ctx-target="main-tab-strip" data-fx-ctx-payload={group.id} onWheel={onWheel}>
        {tabs.map((t, i) => (
          <MainTabChip key={t.id} tab={t} index={i} group={group} active={i === group.active} vertical={vertical} dropBefore={drop === i} onDrop={setDrop} />
        ))}
        {drop !== null && drop >= tabs.length && <span className="fx-maintabs__drop" aria-hidden />}
        <span className="fx-tabgroup__spacer" />
        <button type="button" className="fx-iconbtn fx-maintabs__more" title="All tabs" aria-label="All tabs" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); rt.openContext(r.left, r.bottom, 'main-tab-list', group.id); }}><Icon name="list" /></button>
      </div>
      <div className="fx-tabgroup__body fx-maintabs__body" role="tabpanel" onPointerDown={onBodyDown} onPointerUp={onBodyUp} onPointerCancel={() => { swipe.current = null; }}>
        {active && render && (
          <TabIdCtx.Provider value={active.id}>
            <div className="fx-main__inner fx-maintabs__page" key={active.id} data-axf-view={tabView(active) ?? undefined}>{render(active)}</div>
          </TabIdCtx.Provider>
        )}
      </div>
    </div>
  );
}

function MainTabChip({ tab, index, group, active, vertical, dropBefore, onDrop }: { tab: TabSpec; index: number; group: TabGroup; active: boolean; vertical: boolean; dropBefore: boolean; onDrop: (i: number | null) => void }) {
  const rt = useRuntime();
  const wm = useWindowManager();
  const ctl = useContext(CtlCtx)!;
  const pinned = ctl.pinned.has(tab.id);
  const dirty = ctl.dirty.has(tab.id);
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; touch: boolean; armed: boolean; dragging: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const [lifted, setLifted] = useState(false);

  // touch: once a long-press has armed a drag, the finger must not scroll the strip
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const block = (e: TouchEvent) => { if (press.current?.armed) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const finish = (x: number, y: number) => {
    const p = press.current; press.current = null; setLifted(false); onDrop(null);
    if (!p?.dragging) return;
    const strip = stripDropAt(x, y);
    if (strip) {
      wm.dragCancel();
      const target = wm.state.groups[strip.group]; if (!target) return;
      // pinned tabs stay at the front, the others behind them
      const pins = target.tabs.filter((t) => t.id !== tab.id && ctl.pinned.has(t.id)).length;
      let i = strip.index;
      if (strip.group === group.id) { const from = group.tabs.findIndex((t) => t.id === tab.id); if (from >= 0 && i > from) i -= 1; }
      i = pinned ? Math.min(i, pins) : Math.max(i, pins);
      wm.moveTab(tab.id, strip.group, i);
      return;
    }
    if (wm.state.dockPreview) { wm.dragEnd(); return; }
    wm.dragCancel();
    // let go outside every dock: the tab floats where it was dropped
    const host = wm.hostBounds.get(wm.mainWindowId);
    const inside = host && x >= host.x && x <= host.x + host.width && y >= host.y && y <= host.y + host.height;
    if (!inside) ctl.float(tab.id, x, y);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1) { e.preventDefault(); return; } // middle button: closes on auxclick, no autoscroll
    if (e.button !== 0) return;
    ctl.activate(group.id, tab.id);
    const touch = e.pointerType === 'touch';
    press.current = { x: e.clientX, y: e.clientY, touch, armed: !touch, dragging: false };
    // touch: hold to lift the tab (a quick move is a scroll of the strip)
    if (touch) press.current.timer = setTimeout(() => { if (press.current) { press.current.armed = true; setLifted(true); } }, Math.min(400, Math.max(200, rt.behavior().interaction.longPressMs - 200)));
    const move = (ev: PointerEvent) => {
      const p = press.current; if (!p) return;
      const far = Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > Math.max(4, rt.behavior().interaction.dragThreshold);
      if (!p.dragging) {
        if (!far) return;
        if (!p.armed) { clearTimeout(p.timer); cleanup(); press.current = null; return; } // a scroll, not a drag
        p.dragging = true; rt.closeContext(); wm.dragStart(tab.id, group.id, p.x, p.y);
      }
      const s = stripDropAt(ev.clientX, ev.clientY);
      if (s) { wm.dragGhost(ev.clientX, ev.clientY); onDrop(s.group === group.id ? s.index : null); markStrip(s.group); }
      else { wm.dragMove(ev.clientX, ev.clientY); onDrop(null); markStrip(null); }
    };
    const up = (ev: PointerEvent) => { clearTimeout(press.current?.timer); cleanup(); markStrip(null); finish(ev.clientX, ev.clientY); };
    const cancel = () => { clearTimeout(press.current?.timer); cleanup(); markStrip(null); if (press.current?.dragging) wm.dragCancel(); press.current = null; setLifted(false); onDrop(null); };
    const cleanup = () => { globalThis.removeEventListener('pointermove', move); globalThis.removeEventListener('pointerup', up); globalThis.removeEventListener('pointercancel', cancel); };
    globalThis.addEventListener('pointermove', move); globalThis.addEventListener('pointerup', up); globalThis.addEventListener('pointercancel', cancel);
  };

  const showClose = !pinned && tab.closable !== false;
  return (
    <>
      {dropBefore && <span className="fx-maintabs__drop" aria-hidden />}
      <div ref={ref} role="tab" aria-selected={active} tabIndex={active ? 0 : -1}
        className={`fx-tab fx-maintabs__tab ${active ? 'is-active' : ''} ${pinned ? 'is-pinned' : ''} ${dirty ? 'is-dirty' : ''} ${lifted ? 'is-lifted' : ''}`.trim()}
        data-fx-tab-id={tab.id} data-fx-ctx-target="main-tab" data-fx-ctx-payload={tab.id} title={`${tab.title}${dirty ? ' (unsaved changes)' : ''}${pinned ? ' (pinned)' : ''}`}
        onPointerDown={onPointerDown}
        onAuxClick={(e) => { if (e.button === 1 && showClose) { e.preventDefault(); ctl.close(tab.id); } }}
        onKeyDown={(e) => {
          if (e.key === 'Delete' && showClose) ctl.close(tab.id);
          const step = (vertical ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 })[e.key as 'ArrowUp'];
          if (step) { const n = group.tabs[index + step]; if (n) { e.preventDefault(); ctl.activate(group.id, n.id); (ref.current?.parentElement?.querySelector(`[data-fx-tab-id="${CSS.escape(n.id)}"]`) as HTMLElement | null)?.focus(); } }
        }}>
        {tab.icon && <Icon name={tab.icon} />}
        {pinned && <span className="fx-maintabs__pin" aria-label="Pinned"><Icon name="star" /></span>}
        <span className="fx-tab__label">{tab.title}</span>
        {dirty && <span className="fx-maintabs__dirty" aria-label="Unsaved changes" />}
        {showClose && <button type="button" className="fx-tab__close" tabIndex={-1} onPointerDown={(e) => e.stopPropagation()} onClick={() => ctl.close(tab.id)} aria-label={`Close ${tab.title}`}><Icon name="x" /></button>}
      </div>
    </>
  );
}

/** Is the main-area tab group on for this runtime (AppShell asks before drawing it)? */
export const mainTabsOn = (rt: AxfRuntime) => readSettings(rt).enabled;
