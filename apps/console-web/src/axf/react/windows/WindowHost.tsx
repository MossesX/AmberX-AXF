import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRuntime } from '../AxfProvider';
import { Icon } from '../components/Icon';
import { BrandMark, BrandWatermark, brandHostProps, useBrandPlace } from '../components/Brand';
import { useScopeId } from '../components/InterfaceScope';
import type { Pane, TabGroup, TabSpec, WindowManager, WindowSettings, WindowSpec, WindowState, Corner, DragPreview, ResizeEdge, WindowFrame } from '../../core/engines/windows';
import { effectiveToolbar, forcesToolbar, isFloating, isMaximized, paneGroups, rectOf, resizeCursor, tabPressIntent, windowFrame, CORNERS, RESIZE_EDGES, TAB_HOLD_MS, type TabPressIntent } from '../../core/engines/windows';
import { DockDropOverlay, DockHost, DockPaneView, dockLayoutDialog } from './DockHost';
import { WidgetView } from '../components/Widgets';
import { ensureWindowHost, placeHost, windowHost } from '../../core/engines/widgets';

/* ------------------------------------------------------------------ */
/* registry of tab renderers + locals                                  */
/* ------------------------------------------------------------------ */

export type TabRenderer = (tab: TabSpec) => ReactNode;
export type TabRenderers = Record<string, TabRenderer>;
const RenderersCtx = createContext<TabRenderers>({});
const WindowCtx = createContext<WindowSpec | null>(null);
/** The window a tab is rendered in (null in the main shell) — content reads `mode` from it (tree / grid). */
export const useWindowSpec = () => useContext(WindowCtx);

export function useWindowManager(): WindowManager { return useRuntime().windows; }
export function useWindowState(): WindowState { const wm = useWindowManager(); return useSyncExternalStore(wm.subscribe.bind(wm), () => wm.state, () => wm.state); }

/** Provide tab renderers (kind → component) to every window and dock area below. */
export function TabRenderersProvider({ renderers, children }: { renderers: TabRenderers; children: ReactNode }) {
  return <RenderersCtx.Provider value={{ placeholder: (t) => <div className="fx-empty">{t.title}</div>, ...renderers }}>{children}</RenderersCtx.Provider>;
}

/* ------------------------------------------------------------------ */
/* dock area (groups inside the main window)                           */
/* ------------------------------------------------------------------ */

/** Renders the main window's nested layout (dock@1: splitters, drop zones); `empty` shows when nothing is docked. */
export function DockArea({ windowId, empty, className }: { windowId?: string; empty?: ReactNode; className?: string }) {
  return <DockHost windowId={windowId} empty={empty} className={className} />;
}

/** A pane tree on its own (older callers); the window is the one its first group lives in. Prefer DockHost / DockPaneView. */
export function PaneView({ pane }: { pane: Pane }) {
  const wm = useWindowManager();
  const s = useWindowState();
  const first = paneGroups(pane)[0];
  const windowId = (first && s.groups[first]?.windowId) || wm.mainWindowId;
  return <DockPaneView pane={pane} path={[]} windowId={windowId} />;
}

/* ------------------------------------------------------------------ */
/* tab group                                                           */
/* ------------------------------------------------------------------ */

export function TabGroupView({ group }: { group: TabGroup }) {
  const rt = useRuntime();
  const wm = rt.windows;
  const renderers = useContext(RenderersCtx);
  const ref = useRef<HTMLDivElement>(null);
  const active = group.tabs[group.active];
  // report bounds for drop targeting: the group's rect, its header height and each tab's right edge (dock@1 zones)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect(); wm.groupBounds.set(group.id, [r.left, r.top, r.right, r.bottom]);
      const bar = el.querySelector<HTMLElement>(':scope > .fx-tabgroup__bar');
      if (bar) { wm.groupHeaders.set(group.id, bar.getBoundingClientRect().height); wm.tabEdges.set(group.id, [...bar.querySelectorAll<HTMLElement>(':scope > .fx-tab')].map((t) => t.getBoundingClientRect().right)); }
    };
    report();
    const ro = new ResizeObserver(report); ro.observe(el);
    window.addEventListener('scroll', report, true);
    return () => { ro.disconnect(); window.removeEventListener('scroll', report, true); wm.groupBounds.delete(group.id); wm.groupHeaders.delete(group.id); wm.tabEdges.delete(group.id); };
  });
  const brand = useBrandPlace('tab-group');
  const brandHost = brandHostProps(brand);
  return (
    <div ref={ref} className={`fx-tabgroup ${brandHost.className}`.trim()} data-fx-ctx-target="tab-group" data-fx-ctx-payload={group.id} data-fx-tabs={group.tabs.length} data-fx-brand-mode={brandHost['data-fx-brand-mode']}>
      <div className="fx-tabgroup__bar" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); rt.openContext(e.clientX, e.clientY, 'tab-group', group.id); }}>
        {brand?.svg && <span className="fx-tabgroup__brand"><BrandMark slot="tab-group" height={16} /></span>}
        {group.tabs.map((t, i) => <TabChip key={t.id} tab={t} group={group} active={i === group.active} onActivate={() => wm.activate(group.id, i)} />)}
        <span className="fx-tabgroup__spacer" />
        <button className="fx-iconbtn" title="Undock to floating window" onClick={() => wm.undock(group.id)}><Icon name="external" /></button>
        <button className="fx-iconbtn" title="Split vertical" onClick={() => wm.split(group.id, 'vertical')}><Icon name="layout" /></button>
        <button className="fx-iconbtn" title="Split horizontal" onClick={() => wm.split(group.id, 'horizontal')}><Icon name="layout" /></button>
        <button className="fx-iconbtn" title="Four-way" onClick={() => wm.split(group.id, 'four')}><Icon name="grid" /></button>
      </div>
      <div className="fx-tabgroup__body">{active ? (renderers[active.kind] ?? renderers.placeholder ?? ((t: TabSpec) => <div className="fx-empty">{t.title}</div>))(active) : null}</div>
    </div>
  );
}

function TabChip({ tab, group, active, onActivate }: { tab: TabSpec; group: TabGroup; active: boolean; onActivate: () => void }) {
  const wm = useWindowManager();
  const press = useRef<{ x: number; y: number; timer?: number; dragging: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    onActivate();
    press.current = { x: e.clientX, y: e.clientY, dragging: false };
    const start = () => { if (!press.current) return; press.current.dragging = true; wm.dragStart(tab.id, group.id, press.current.x, press.current.y); };
    press.current.timer = window.setTimeout(start, 180);
    const move = (ev: PointerEvent) => {
      if (!press.current) return;
      if (!press.current.dragging && Math.hypot(ev.clientX - press.current.x, ev.clientY - press.current.y) > 6) { window.clearTimeout(press.current.timer); start(); }
      if (press.current.dragging) wm.dragMove(ev.clientX, ev.clientY);
    };
    const up = () => { window.clearTimeout(press.current?.timer); if (press.current?.dragging) wm.dragEnd(); press.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div className={`fx-tab ${active ? 'is-active' : ''}`} onPointerDown={onPointerDown} title={tab.title}>
      {tab.icon && <Icon name={tab.icon} />}
      <span className="fx-tab__label">{tab.title}</span>
      {tab.closable !== false && <button className="fx-tab__close" onPointerDown={(e) => e.stopPropagation()} onClick={() => wm.closeTab(tab.id)} aria-label="Close tab"><Icon name="x" /></button>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* floating windows host                                               */
/* ------------------------------------------------------------------ */

/** The fixed chrome along the top of the page: the app banner, the frame's menu bar and its banner strip. */
const TOP_CHROME = '.fx-banner[role="banner"], .fx-frame > .fx-frame__menubar, .fx-frame-banners';

/** Where that chrome ends (px from the top); only pieces that start in the top half count, and at most half the screen. */
export function chromeBottom(viewportHeight: number): number {
  let bottom = 0;
  for (const el of document.querySelectorAll(TOP_CHROME)) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top < viewportHeight / 2) bottom = Math.max(bottom, r.bottom);
  }
  return Math.min(bottom, viewportHeight / 2);
}

/** Mount once in the shell: renders every floating window, the drag ghost, minimized corners and floating mini toolbars. */
export function FloatingWindowsHost() {
  const rt = useRuntime();
  const wm = rt.windows;
  const s = useWindowState();
  useEffect(() => {
    const report = () => { wm.viewport = { width: window.innerWidth, height: window.innerHeight }; };
    report(); window.addEventListener('resize', report);
    // new windows open below the top chrome (banner, menu bar, banner strip), so they never sit over what is tapped there
    wm.chromeTop = () => chromeBottom(window.innerHeight);
    return () => { window.removeEventListener('resize', report); wm.chromeTop = () => 0; };
  }, [wm]);
  // one host per interface scope: each draws the windows opened in its scope ('' = the app itself)
  const scope = useScopeId();
  const own = (w: WindowSpec) => (w.scope ?? '') === scope;
  return (
    <>
      {s.windows.filter((w) => isFloating(w) && !w.minimized && own(w)).sort((a, b) => a.z - b.z).map((w) => <FloatingWindow key={w.id} w={w} />)}
      {CORNERS.map((c) => <MinimizedCorner key={c} corner={c} windows={wm.minimizedAt(c).filter(own)} />)}
      {s.windows.filter((w) => w.minimized === 'floating-toolbar' && own(w)).map((w) => <FloatingMiniToolbar key={w.id} w={w} />)}
      {s.preview && <SnapPreview preview={s.preview} />}
      {s.dockPreview && <DockDropOverlay preview={s.dockPreview} />}
      {s.drag && <div className="fx-dragghost" style={{ left: s.drag.x + 8, top: s.drag.y + 8 }}>{Object.values(s.groups).flatMap((g) => g.tabs).find((t) => t.id === s.drag!.tabId)?.title ?? 'tab'}</div>}
    </>
  );
}

/** The translucent outline shown while a drag arms a half / quarter zone or a split onto another window (s18). Tokens only. */
function SnapPreview({ preview }: { preview: DragPreview }) {
  return (
    <>
      <div className={`fx-snap-preview fx-snap-preview--${preview.kind}`} style={{ left: preview.rect.x, top: preview.rect.y, width: preview.rect.width, height: preview.rect.height }} aria-hidden>
        <span className="fx-snap-preview__label">{preview.kind === 'zone' ? preview.zone : `split ${preview.side}`}</span>
      </div>
      {preview.kind === 'split' && preview.targetRect && <div className="fx-snap-preview fx-snap-preview--target" style={{ left: preview.targetRect.x, top: preview.targetRect.y, width: preview.targetRect.width, height: preview.targetRect.height }} aria-hidden />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* window frame hooks (windows-terminal s17)                           */
/* ------------------------------------------------------------------ */

/**
 * What a window's content may drive: move (start a title-bar drag), resize from a handle, minimize, maximize / restore,
 * close. A `frameless` window draws no host title bar, so its content (the Terminal's tab strip) wires these onto its
 * own bar. Null outside a floating window.
 */
export interface WindowFrameHooks {
  w: WindowSpec;
  frame: WindowFrame;
  maximized: boolean;
  /** pointer-down on whatever acts as the title bar: starts the move (restores a maximized window under the pointer first); double-tap = maximize / restore */
  startMove: (e: React.PointerEvent) => void;
  /** start a move from a point (no double-tap check): a tab held then dragged (useTabPress); call `to` per pointer move, `end` once */
  moveFrom: (x: number, y: number) => { to: (x: number, y: number) => void; end: () => void };
  /** a WindowGrip in the content says it is there (returns the release); with none, a frameless window draws its own */
  claimGrip: () => () => void;
  /** pointer-down on a resize handle */
  startResize: (e: React.PointerEvent, edge: ResizeEdge) => void;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  canMinimize: boolean;
}
const FrameCtx = createContext<WindowFrameHooks | null>(null);
/** The frame hooks of the floating window this content is in (null when docked in the main shell). */
export const useWindowFrame = () => useContext(FrameCtx);

/** The 8 resize handles of a window (`frameless` content that draws its own chrome still gets them from the host). */
export function WindowResizeHandles({ onStart }: { onStart: (e: React.PointerEvent, edge: ResizeEdge) => void }) {
  return <>{RESIZE_EDGES.map((edge) => <div key={edge} className={`fx-window__edge fx-window__edge--${edge}`} style={{ cursor: resizeCursor(edge) }} onPointerDown={(e) => onStart(e, edge)} aria-hidden />)}</>;
}

/**
 * The move grip of a frameless window (terminal-drag-chain-tree, Nov 3 2026): an always-present drag area the content's
 * own chrome can never cover (put it first in the tab strip; `column` for a stacked tab list). Drag = move the window,
 * double-tap / double-click = maximize / restore; at least a 44 px target on a touch screen (theme tokens). Renders
 * nothing outside a floating window. While one is mounted the host skips its fallback grip.
 */
export function WindowGrip({ orientation = 'row', className = '', onContextMenu }: { orientation?: 'row' | 'column'; className?: string; onContextMenu?: (e: React.MouseEvent) => void }) {
  const f = useContext(FrameCtx);
  const claim = f?.claimGrip;
  useEffect(() => claim?.(), [claim]);
  if (!f) return null;
  return (
    <div className={`fx-window__grip fx-window__grip--${orientation} ${className}`.trim()} role="button" tabIndex={-1} aria-label="Move window (double-tap to maximize)"
      title="Drag to move · double-click to maximize" onPointerDown={f.startMove} onContextMenu={onContextMenu} data-fx-window-grip={f.w.id}>
      <Icon name="grip" size={14} />
    </div>
  );
}

/** What a tab press turned into, for the strip that owns the tabs (useTabPress). */
export interface TabPressHandlers {
  /** hold released without moving: a long-press menu on touch (a mouse hold is a plain tap) */
  onHold?: (x: number, y: number) => void;
  /** horizontal drag: the pointer's x while it moves, then once more on release (`end`) or `cancel` */
  onReorder?: (x: number, phase: 'move' | 'end' | 'cancel') => void;
  /** the gesture changed (armed = held long enough, the next move drags the window) */
  onIntent?: (intent: TabPressIntent) => void;
}

/**
 * Pointer-down handler for the tabs of a frameless window's strip: tap (the tab's own click still runs), horizontal
 * drag = reorder, press and hold then move = drag the window, vertical pull = drag the window, long-press released =
 * onHold (the browser's own long-press context menu is held back so it doesn't open as well). Docked (no frame), a
 * drag that would move the window does nothing. The click that follows a drag is swallowed.
 */
/** Widgets attached to this window's title bar (host `window:<id>`, widget host engine): Add widgets… puts them here. */
function TitleWidgets({ id }: { id: string }) {
  const rt = useRuntime();
  useSyncExternalStore(rt.subscribe, rt.getState, rt.getState);
  const host = windowHost(id);
  ensureWindowHost(id);
  const placed = placeHost(host, null, rt.hostAttachments(host), (t, i) => rt.registry.has(t as never, i), false, rt.hostArrangement(host));
  const list = placed.end ?? [];
  if (!list.length) return null;
  return <span className="fx-window__widgets" data-fx-host={host} onPointerDown={(e) => e.stopPropagation()}>{list.map((a) => <span key={a.key} className="fx-window__widget" data-axf-host-item={a.key} data-axf-origin={a.origin}><WidgetView type={a.type} id={a.id} host={host} /></span>)}</span>;
}

export function useTabPress() {
  const f = useContext(FrameCtx);
  return (e: React.PointerEvent, h: TabPressHandlers = {}) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, form')) return;
    const x0 = e.clientX, y0 = e.clientY, t0 = Date.now(), touch = e.pointerType !== 'mouse';
    let intent: TabPressIntent = 'pending';
    let mv: ReturnType<WindowFrameHooks['moveFrom']> | null = null;
    const set = (i: TabPressIntent) => { if (i !== intent) { intent = i; h.onIntent?.(i); } };
    const timer = window.setTimeout(() => { if (intent === 'pending') { set('armed'); if (touch) navigator.vibrate?.(8); } }, TAB_HOLD_MS);
    const menu = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); }; // long-press on Android fires contextmenu mid-press
    const swallow = () => { const kill = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); }; window.addEventListener('click', kill, { capture: true, once: true }); window.setTimeout(() => window.removeEventListener('click', kill, { capture: true }), 60); };
    const move = (ev: PointerEvent) => {
      if (intent === 'pending' || intent === 'armed') {
        const next = tabPressIntent({ dx: ev.clientX - x0, dy: ev.clientY - y0, heldMs: Date.now() - t0 });
        if (next === 'window') { set('window'); mv = f ? f.moveFrom(x0, y0) : null; }
        else if (next === 'reorder') set('reorder');
        else return;
      }
      if (intent === 'window') mv?.to(ev.clientX, ev.clientY);
      else if (intent === 'reorder') h.onReorder?.(ev.clientX, 'move');
    };
    const done = (ev: PointerEvent) => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); window.removeEventListener('pointercancel', done);
      window.setTimeout(() => window.removeEventListener('contextmenu', menu, true), 0);
      const cancelled = ev.type === 'pointercancel';
      if (intent === 'window') { mv?.end(); swallow(); }
      else if (intent === 'reorder') { h.onReorder?.(ev.clientX, cancelled ? 'cancel' : 'end'); swallow(); }
      else if (!cancelled && tabPressIntent({ dx: ev.clientX - x0, dy: ev.clientY - y0, heldMs: Date.now() - t0, released: true }) === 'hold' && touch && h.onHold) { h.onHold(x0, y0); swallow(); }
      set('pending');
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', done); window.addEventListener('pointercancel', done);
    window.addEventListener('contextmenu', menu, true);
  };
}

/** Shared pointer plumbing for move + resize (mouse, pen and touch: pointer events with capture, touch-action none in CSS). */
function useWindowDrag(w: WindowSpec) {
  const wm = useWindowManager();
  const lastTap = useRef(0);
  // one move, from the press point: a maximized window restores under the pointer once it really moves; the grab
  // offset is where the pointer sits inside the window, so the engine snaps from pointer minus offset each step (a pull
  // never accumulates); s18: screen / window edges, zones, split preview
  const moveFrom = (x0: number, y0: number) => {
    wm.focus(w.id);
    const cur = wm.state.windows.find((x) => x.id === w.id) ?? w;
    let restored = !isMaximized(cur); const grab = y0 - cur.y;
    let ox = x0 - cur.x, oy = y0 - cur.y;
    return {
      to: (x: number, y: number) => {
        if (!restored) { if (Math.hypot(x - x0, y - y0) < 6) return; const r = wm.dragRestore(w.id, x, y, grab); restored = true; if (r) { ox = x - r.x; oy = y - r.y; } return; }
        wm.dragTo(w.id, x - ox, y - oy, x, y, Date.now());
      },
      end: () => wm.settle(w.id),
    };
  };
  const startMove = (e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); wm.focus(w.id);
    // double-tap / double-click on the title bar = maximize / restore (Windows)
    const now = Date.now();
    if (now - lastTap.current < 320) { lastTap.current = 0; wm.toggleMaximize(w.id); return; }
    lastTap.current = now;
    const m = moveFrom(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => m.to(ev.clientX, ev.clientY);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); m.end(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  const startResize = (e: React.PointerEvent, edge: ResizeEdge) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); wm.focus(w.id);
    const cur = wm.state.windows.find((x) => x.id === w.id) ?? w;
    const start = rectOf(cur); const ox = e.clientX, oy = e.clientY;
    const move = (ev: PointerEvent) => wm.resizeFrom(w.id, edge, start, ev.clientX - ox, ev.clientY - oy);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); wm.settle(w.id); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  return { startMove, moveFrom, startResize };
}

/**
 * Every floating window (and its grips) shares one z-index; the host draws them sorted by `w.z`, so DOM order stacks
 * them. `60 + w.z` used to climb past the dialog backdrop (70), menus and toasts after a few focus taps, so a dialog
 * opened from a window (the Terminal's settings, its tab picker) opened behind it (window-resize-fix, Nov 3 2026).
 */
const WINDOW_LAYER = 60;

function FloatingWindow({ w }: { w: WindowSpec }) {
  const rt = useRuntime();
  const wm = rt.windows;
  const s = useWindowState();
  const layout = s.layouts[w.id];
  const { startMove, moveFrom, startResize } = useWindowDrag(w);
  const frame = windowFrame(w);
  const maximized = isMaximized(w);
  const [grips, setGrips] = useState(0);
  const claimGrip = useRef(() => { setGrips((n) => n + 1); return () => setGrips((n) => n - 1); }).current;
  const hooks: WindowFrameHooks = {
    w, frame, maximized, startMove, moveFrom, claimGrip, startResize, canMinimize: wm.canMinimize,
    minimize: () => wm.minimizeToNextCorner(w.id), toggleMaximize: () => wm.toggleMaximize(w.id), close: () => wm.close(w.id),
  };
  // branding@1: floating windows use the `floating-window` slot, every other window the `window` slot
  const brandSlot = isFloating(w) ? 'floating-window' : 'window';
  const brand = useBrandPlace(brandSlot, 14);
  const brandHost = brandHostProps(brand);
  return (
    <WindowCtx.Provider value={w}>
      <FrameCtx.Provider value={hooks}>
        <div className={`fx-window fx-window--${w.type} fx-window--${frame} ${maximized ? 'is-maximized' : ''} ${s.focused === w.id ? 'is-focused' : ''} ${brandHost.className}`.trim()} style={{ left: w.x, top: w.y, width: w.width, height: w.height, zIndex: WINDOW_LAYER, opacity: w.settings.opacity }} onPointerDown={() => wm.focus(w.id)} data-fx-brand-mode={brandHost['data-fx-brand-mode']} data-fx-window={w.id}>
          {frame === 'standard' && (
            <div className="fx-window__title" onPointerDown={startMove} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); rt.openContext(e.clientX, e.clientY, 'window-title', w.id); }} data-fx-ctx-target="window-title" data-fx-ctx-payload={w.id}>
              {brand?.svg && <BrandMark slot={brandSlot} height={14} className="fx-window__brand" />}
              <span className="fx-window__name">{w.title}</span>
              <span className="fx-window__badge">{w.type}</span>
              <TitleWidgets id={w.id} />
              {w.toolbarsAllowed && !forcesToolbar(w) && <label className="fx-window__switch" onPointerDown={(e) => e.stopPropagation()}><input type="checkbox" checked={w.toolbarEnabled} onChange={(e) => wm.setToolbar(w.id, e.target.checked)} /> toolbar</label>}
              {wm.canMinimize && <button className="fx-iconbtn" title="Minimize to corner" onPointerDown={(e) => e.stopPropagation()} onClick={() => wm.minimizeToNextCorner(w.id)}><Icon name="minimize" /></button>}
              <button className="fx-iconbtn" title={maximized ? 'Restore' : 'Maximize'} onPointerDown={(e) => e.stopPropagation()} onClick={() => wm.toggleMaximize(w.id)}><Icon name={maximized ? 'restore' : 'maximize'} /></button>
              {w.closable && <button className="fx-iconbtn" title="Close" onPointerDown={(e) => e.stopPropagation()} onClick={() => wm.close(w.id)}><Icon name="x" /></button>}
            </div>
          )}
          {frame === 'standard' && effectiveToolbar(w) && <WindowToolbar w={w} />}
          {/* terminal-drag-chain-tree: a frameless window whose content shows no WindowGrip still gets one to move it by */}
          {frame === 'frameless' && grips === 0 && <div className="fx-window__grip fx-window__grip--float" role="button" aria-label="Move window (double-tap to maximize)" title="Drag to move · double-click to maximize" onPointerDown={startMove}><Icon name="grip" size={14} /></div>}
          <div className="fx-window__body">{layout ? <DockHost windowId={w.id} empty={<div className="fx-empty">Empty window</div>} /> : <div className="fx-empty">Empty window</div>}<BrandWatermark slot={brandSlot} /></div>
        </div>
        {/* window-resize-fix (Nov 3 2026): the handles sit in their own layer just above the window (same z, drawn after
            it), so the bands straddle the border instead of being clipped inside it by the window's rounded overflow */}
        {!maximized && <div className={`fx-window__grips fx-window__grips--${frame}`} style={{ left: w.x, top: w.y, width: w.width, height: w.height, zIndex: WINDOW_LAYER }} data-fx-window-grips={w.id}><WindowResizeHandles onStart={startResize} /></div>}
      </FrameCtx.Provider>
    </WindowCtx.Provider>
  );
}

/** The hardcoded default window toolbar: settings, redock, minimize to corner (cycles), minimize to floating toolbar at cursor, view mode. */
export function WindowToolbar({ w }: { w: WindowSpec }) {
  const rt = useRuntime();
  const wm = rt.windows;
  return (
    <div className="fx-window__toolbar" role="toolbar" aria-label="Window">
      <button className="fx-iconbtn" title="Window settings" onClick={() => rt.openDialog('window-settings', { arg: w.id })}><Icon name="settings" /></button>
      <button className="fx-iconbtn" title="Redock" onClick={() => wm.redock(w.id)}><Icon name="download" /></button>
      <button className="fx-iconbtn" title={isMaximized(w) ? 'Restore' : 'Maximize'} onClick={() => wm.toggleMaximize(w.id)}><Icon name={isMaximized(w) ? 'restore' : 'maximize'} /></button>
      {wm.canMinimize && <button className="fx-iconbtn" title="Minimize to corner title bar (cycles corners)" onClick={() => wm.minimizeToNextCorner(w.id)}><Icon name="minus" /></button>}
      {wm.canMinimize && wm.placement.minimize !== 'dock' && <button className="fx-iconbtn" title="Minimize to floating toolbar at cursor" onClick={(e) => wm.minimize(w.id, 'floating-toolbar', e.clientX, e.clientY)}><Icon name="external" /></button>}
      <span className="fx-tabgroup__spacer" />
      <button className={`fx-iconbtn ${w.mode === 'grid' ? 'is-active' : ''}`} title={w.mode === 'grid' ? 'View as tree' : 'View as grid'} onClick={() => wm.setMode(w.id, w.mode === 'grid' ? 'tree' : 'grid')}><Icon name={w.mode === 'grid' ? 'list' : 'grid'} /></button>
    </div>
  );
}

function MinimizedCorner({ corner, windows }: { corner: Corner; windows: WindowSpec[] }) {
  const wm = useWindowManager();
  if (!windows.length) return null;
  const lined = windows[0]?.settings.mode === 'lined';
  return (
    <div className={`fx-corner fx-corner--${corner} ${lined ? 'fx-corner--lined' : 'fx-corner--stacked'}`}>
      {windows.map((w) => <button key={w.id} className="fx-corner__bar" onClick={() => wm.restore(w.id)} title="Restore"><Icon name="external" /><span>{w.title}</span></button>)}
    </div>
  );
}

function FloatingMiniToolbar({ w }: { w: WindowSpec }) {
  const wm = useWindowManager();
  return (
    <div className="fx-minitoolbar" role="toolbar" aria-label="Minimized window" style={{ left: w.minimizedAtX, top: w.minimizedAtY }}>
      <span className="fx-minitoolbar__title">{w.title}</span>
      <button className="fx-iconbtn" title="Restore" onClick={() => wm.restore(w.id)}><Icon name="external" /></button>
      <button className="fx-iconbtn" title="Redock" onClick={() => wm.redock(w.id)}><Icon name="download" /></button>
      <button className="fx-iconbtn" title="Close" onClick={() => wm.close(w.id)}><Icon name="x" /></button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* dialogs                                                             */
/* ------------------------------------------------------------------ */

export function SplitGridDialog({ groupId, close }: { groupId: string; close: () => void }) {
  const wm = useWindowManager();
  const [rows, setRows] = useState(2); const [cols, setCols] = useState(2);
  const n = Math.max(1, rows * cols);
  const count = wm.state.groups[groupId]?.tabs.length ?? 0;
  return (
    <div className="fx-form">
      <label>Rows <input type="number" min={1} max={6} value={rows} onChange={(e) => setRows(Number(e.target.value) || 1)} /></label>
      <label>Columns <input type="number" min={1} max={6} value={cols} onChange={(e) => setCols(Number(e.target.value) || 1)} /></label>
      <p className="fx-muted">{count} tab{count === 1 ? '' : 's'} across {n} cells, distributed evenly (the first {count % n || 0} get one extra).</p>
      <div className="fx-form__actions"><button className="fx-btn" onClick={close}>Cancel</button><button className="fx-btn fx-btn--primary" onClick={() => { wm.split(groupId, 'grid', rows, cols); close(); }}>Split</button></div>
    </div>
  );
}

export function WindowSettingsDialog({ windowId, close }: { windowId: string; close: () => void }) {
  const wm = useWindowManager();
  const w = wm.state.windows.find((x) => x.id === windowId);
  const [st, setSt] = useState<WindowSettings>(w?.settings ?? { corner: 'bottom-right', mode: 'stacked', alwaysOnTop: false, opacity: 1, toolbarAsset: null });
  if (!w) return <p>Window not found.</p>;
  return (
    <div className="fx-form">
      <label>Minimize corner <select value={st.corner} onChange={(e) => setSt({ ...st, corner: e.target.value as Corner })}>{CORNERS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>Minimized title bars <select value={st.mode} onChange={(e) => setSt({ ...st, mode: e.target.value as 'stacked' | 'lined' })}><option value="stacked">Stacked</option><option value="lined">Lined up</option></select></label>
      <label>Opacity <input type="range" min={0.3} max={1} step={0.05} value={st.opacity} onChange={(e) => setSt({ ...st, opacity: Number(e.target.value) })} /></label>
      <label><input type="checkbox" checked={st.alwaysOnTop} onChange={(e) => setSt({ ...st, alwaysOnTop: e.target.checked })} /> Always on top</label>
      <p className="fx-muted">Type {w.type} · toolbars {w.toolbarsAllowed ? (forcesToolbar(w) ? 'forced on' : w.toolbarEnabled ? 'on' : 'off') : 'not allowed'}</p>
      <div className="fx-form__actions"><button className="fx-btn" onClick={close}>Cancel</button><button className="fx-btn fx-btn--primary" onClick={() => { wm.setSettings(windowId, st); close(); }}>Apply</button></div>
    </div>
  );
}

/** Register these with the shell's dialogs: `{ ...windowDialogs }`. */
export const windowDialogs = {
  ...dockLayoutDialog,
  'split-grid': { title: 'Custom grid', icon: 'grid', searchable: false, render: (p: Record<string, unknown>, close: () => void) => <SplitGridDialog groupId={String(p.arg ?? '')} close={close} /> },
  'window-settings': { title: 'Window settings', icon: 'settings', searchable: false, render: (p: Record<string, unknown>, close: () => void) => <WindowSettingsDialog windowId={String(p.arg ?? '')} close={close} /> },
};

/** Keep the floating host's pointer/escape handling simple: Escape closes the focused floating window. */
export function useWindowShortcuts() {
  const wm = useWindowManager();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { const f = wm.state.focused; const w = wm.state.windows.find((x) => x.id === f); if (w && isFloating(w) && w.closable) wm.close(w.id); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [wm]);
}
