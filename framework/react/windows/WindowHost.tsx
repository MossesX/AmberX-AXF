import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRuntime } from '../AxfProvider';
import { Icon } from '../components/Icon';
import { BrandMark, BrandWatermark, brandHostProps, useBrandPlace } from '../components/Brand';
import type { Pane, TabGroup, TabSpec, WindowManager, WindowSettings, WindowSpec, WindowState, Corner } from '../../core/engines/windows';
import { effectiveToolbar, forcesToolbar, isFloating, CORNERS } from '../../core/engines/windows';

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

/** Renders the main window's nested layout; `empty` shows when nothing is docked. */
export function DockArea({ windowId, empty, className }: { windowId?: string; empty?: ReactNode; className?: string }) {
  const wm = useWindowManager();
  const s = useWindowState();
  const id = windowId ?? wm.mainWindowId;
  const layout = s.layouts[id];
  return <div className={`fx-dock ${className ?? ''}`}>{layout ? <PaneView pane={layout} /> : empty ?? <div className="fx-empty">No tabs — open something here, or drag a tab in.</div>}</div>;
}

export function PaneView({ pane }: { pane: Pane }) {
  const s = useWindowState();
  if (pane.kind === 'leaf') { const g = s.groups[pane.groupId]; return g ? <TabGroupView group={g} /> : null; }
  if (pane.kind === 'split') {
    const total = pane.weights.reduce((a, b) => a + b, 0) || 1;
    return <div className={`fx-split ${pane.vertical ? 'fx-split--v' : 'fx-split--h'}`}>{pane.children.map((c, i) => <div key={i} className="fx-split__cell" style={{ flex: `${(pane.weights[i] ?? 1) / total} 1 0` }}><PaneView pane={c} /></div>)}</div>;
  }
  return <div className="fx-grid" style={{ gridTemplateColumns: `repeat(${pane.cols}, 1fr)`, gridTemplateRows: `repeat(${pane.rows}, 1fr)` }}>{pane.cells.map((c, i) => <div key={i} className="fx-grid__cell"><PaneView pane={c} /></div>)}</div>;
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
  // report bounds for drop targeting
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const report = () => { const r = el.getBoundingClientRect(); wm.groupBounds.set(group.id, [r.left, r.top, r.right, r.bottom]); };
    report();
    const ro = new ResizeObserver(report); ro.observe(el);
    window.addEventListener('scroll', report, true);
    return () => { ro.disconnect(); window.removeEventListener('scroll', report, true); wm.groupBounds.delete(group.id); };
  });
  const brand = useBrandPlace('tab-group');
  const brandHost = brandHostProps(brand);
  return (
    <div ref={ref} className={`fx-tabgroup ${brandHost.className}`.trim()} data-fx-ctx-target="tab-group" data-fx-ctx-payload={group.id} data-fx-brand-mode={brandHost['data-fx-brand-mode']}>
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

/** Mount once in the shell: renders every floating window, the drag ghost, minimized corners and floating mini toolbars. */
export function FloatingWindowsHost() {
  const rt = useRuntime();
  const wm = rt.windows;
  const s = useWindowState();
  useEffect(() => {
    const report = () => { wm.viewport = { width: window.innerWidth, height: window.innerHeight }; };
    report(); window.addEventListener('resize', report);
    return () => window.removeEventListener('resize', report);
  }, [wm]);
  return (
    <>
      {s.windows.filter((w) => isFloating(w) && !w.minimized).sort((a, b) => a.z - b.z).map((w) => <FloatingWindow key={w.id} w={w} />)}
      {CORNERS.map((c) => <MinimizedCorner key={c} corner={c} windows={wm.minimizedAt(c)} />)}
      {s.windows.filter((w) => w.minimized === 'floating-toolbar').map((w) => <FloatingMiniToolbar key={w.id} w={w} />)}
      {s.drag && <div className="fx-dragghost" style={{ left: s.drag.x + 8, top: s.drag.y + 8 }}>{Object.values(s.groups).flatMap((g) => g.tabs).find((t) => t.id === s.drag!.tabId)?.title ?? 'tab'}</div>}
    </>
  );
}

function FloatingWindow({ w }: { w: WindowSpec }) {
  const rt = useRuntime();
  const wm = rt.windows;
  const s = useWindowState();
  const layout = s.layouts[w.id];
  const drag = (e: React.PointerEvent, kind: 'move' | 'resize') => {
    e.preventDefault(); wm.focus(w.id);
    let lx = e.clientX, ly = e.clientY;
    const move = (ev: PointerEvent) => { const dx = ev.clientX - lx, dy = ev.clientY - ly; lx = ev.clientX; ly = ev.clientY; if (kind === 'move') wm.move(w.id, dx, dy); else wm.resize(w.id, w.width + (ev.clientX - e.clientX), w.height + (ev.clientY - e.clientY)); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); wm.settle(w.id); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  // branding@1: floating windows use the `floating-window` slot, every other window the `window` slot
  const brandSlot = isFloating(w) ? 'floating-window' : 'window';
  const brand = useBrandPlace(brandSlot, 14);
  const brandHost = brandHostProps(brand);
  return (
    <WindowCtx.Provider value={w}>
      <div className={`fx-window fx-window--${w.type} ${s.focused === w.id ? 'is-focused' : ''} ${brandHost.className}`.trim()} style={{ left: w.x, top: w.y, width: w.width, height: w.height, zIndex: 60 + w.z, opacity: w.settings.opacity }} onPointerDown={() => wm.focus(w.id)} data-fx-brand-mode={brandHost['data-fx-brand-mode']}>
        <div className="fx-window__title" onPointerDown={(e) => drag(e, 'move')} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); rt.openContext(e.clientX, e.clientY, 'window-title', w.id); }} data-fx-ctx-target="window-title" data-fx-ctx-payload={w.id}>
          {brand?.svg && <BrandMark slot={brandSlot} height={14} className="fx-window__brand" />}
          <span className="fx-window__name">{w.title}</span>
          <span className="fx-window__badge">{w.type}</span>
          {w.toolbarsAllowed && !forcesToolbar(w) && <label className="fx-window__switch" onPointerDown={(e) => e.stopPropagation()}><input type="checkbox" checked={w.toolbarEnabled} onChange={(e) => wm.setToolbar(w.id, e.target.checked)} /> toolbar</label>}
          {wm.canMinimize && <button className="fx-iconbtn" title="Minimize to corner" onPointerDown={(e) => e.stopPropagation()} onClick={() => wm.minimizeToNextCorner(w.id)}><Icon name="minus" /></button>}
          {w.closable && <button className="fx-iconbtn" title="Close" onPointerDown={(e) => e.stopPropagation()} onClick={() => wm.close(w.id)}><Icon name="x" /></button>}
        </div>
        {effectiveToolbar(w) && <WindowToolbar w={w} />}
        <div className="fx-window__body">{layout ? <PaneView pane={layout} /> : <div className="fx-empty">Empty window</div>}<BrandWatermark slot={brandSlot} /></div>
        <div className="fx-window__resize" onPointerDown={(e) => drag(e, 'resize')} />
      </div>
    </WindowCtx.Provider>
  );
}

/** The hardcoded default window toolbar: settings, redock, minimize to corner (cycles), minimize to floating toolbar at cursor, view mode. */
export function WindowToolbar({ w }: { w: WindowSpec }) {
  const rt = useRuntime();
  const wm = rt.windows;
  return (
    <div className="fx-window__toolbar">
      <button className="fx-iconbtn" title="Window settings" onClick={() => rt.openDialog('window-settings', { arg: w.id })}><Icon name="settings" /></button>
      <button className="fx-iconbtn" title="Redock" onClick={() => wm.redock(w.id)}><Icon name="download" /></button>
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
    <div className="fx-minitoolbar" style={{ left: w.minimizedAtX, top: w.minimizedAtY }}>
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
