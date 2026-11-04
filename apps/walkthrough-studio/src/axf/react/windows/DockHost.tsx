import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useRuntime } from '../AxfProvider';
import { Icon } from '../components/Icon';
import { Button } from '../components/Controls';
import type { Pane } from '../../core/engines/windows';
import { paneGroups } from '../../core/engines/windows';
import { normalizeDockLayout, presetSvg, type DockDropPreview, type DockLayoutData, type PanePath } from '../../core/engines/dock';
import { TabGroupView, useWindowManager, useWindowState } from './WindowHost';

/*
 * DockHost (dock@1, dock-engine s3): renders one window's pane tree with draggable splitters, reports the host's bounds
 * so a dragged tab knows its drop zones (any tab header, a pane's centre, a pane's edges, the host's outer edges), and
 * shows where the tab would land. Everything visual reads theme tokens (framework/ui/axf.css, dock section).
 */

/** The dock of one window (main by default): its tree with splitters; `empty` shows when nothing is docked. */
export function DockHost({ windowId, empty, className }: { windowId?: string; empty?: ReactNode; className?: string }) {
  const wm = useWindowManager();
  const s = useWindowState();
  const id = windowId ?? wm.mainWindowId;
  const ref = useRef<HTMLDivElement>(null);
  // the host's rect (root coordinates) is what makes its outer edges and its panes drop zones
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const report = () => { const r = el.getBoundingClientRect(); wm.hostBounds.set(id, { x: r.left, y: r.top, width: r.width, height: r.height }); };
    report();
    const ro = new ResizeObserver(report); ro.observe(el);
    window.addEventListener('scroll', report, true);
    return () => { ro.disconnect(); window.removeEventListener('scroll', report, true); wm.hostBounds.delete(id); };
  }, [wm, id]);
  const layout = s.layouts[id];
  return (
    <div ref={ref} className={`fx-dock ${className ?? ''}`.trim()} data-fx-dock={id} data-fx-panes={layout ? paneGroups(layout).length : 0}>
      {layout ? <DockPaneView pane={layout} path={[]} windowId={id} /> : empty ?? <div className="fx-empty">No tabs — open something here, or drag a tab in.</div>}
    </div>
  );
}

/** A node of the tree: a tab group, a split with splitters between its children, or a grid. */
export function DockPaneView({ pane, path, windowId }: { pane: Pane; path: PanePath; windowId: string }) {
  const s = useWindowState();
  if (pane.kind === 'leaf') { const g = s.groups[pane.groupId]; return g ? <TabGroupView group={g} /> : null; }
  if (pane.kind === 'split') {
    const total = pane.weights.reduce((a, b) => a + b, 0) || 1;
    return (
      <div className={`fx-split ${pane.vertical ? 'fx-split--v' : 'fx-split--h'}`} data-fx-split-path={path.join('.')}>
        {pane.children.map((c, i) => (
          <SplitCell key={i} index={i} pane={pane} path={path} windowId={windowId} weight={(pane.weights[i] ?? 1) / total} child={c} />
        ))}
      </div>
    );
  }
  return (
    <div className="fx-grid" style={{ gridTemplateColumns: `repeat(${pane.cols}, 1fr)`, gridTemplateRows: `repeat(${pane.rows}, 1fr)` }}>
      {pane.cells.map((c, i) => <div key={i} className="fx-grid__cell"><DockPaneView pane={c} path={[...path, i]} windowId={windowId} /></div>)}
    </div>
  );
}

function SplitCell({ index, pane, path, windowId, weight, child }: { index: number; pane: Extract<Pane, { kind: 'split' }>; path: PanePath; windowId: string; weight: number; child: Pane }) {
  return (
    <>
      {index > 0 && <Splitter vertical={pane.vertical} path={path} index={index - 1} windowId={windowId} />}
      <div className="fx-split__cell" style={{ flex: `${weight} 1 0` }}><DockPaneView pane={child} path={[...path, index]} windowId={windowId} /></div>
    </>
  );
}

/**
 * The divider after child `index` of a split: dragging it moves the weight between its two neighbours (the engine
 * keeps the floor). Pointer events with capture, so mouse, pen and touch all work; `touch-action: none` in CSS.
 */
function Splitter({ vertical, path, index, windowId }: { vertical: boolean; path: PanePath; index: number; windowId: string }) {
  const wm = useWindowManager();
  const [active, setActive] = useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget; const parent = el.parentElement; if (!parent) return;
    const size = vertical ? parent.getBoundingClientRect().height : parent.getBoundingClientRect().width;
    if (size <= 0) return;
    let last = vertical ? e.clientY : e.clientX;
    el.setPointerCapture(e.pointerId); setActive(true);
    const move = (ev: PointerEvent) => { const now = vertical ? ev.clientY : ev.clientX; const d = (now - last) / size; last = now; if (d) wm.resizeSplit(windowId, path, index, d); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); setActive(false); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  return <div className={`fx-splitter ${active ? 'is-active' : ''}`.trim()} role="separator" aria-orientation={vertical ? 'horizontal' : 'vertical'} onPointerDown={onPointerDown} data-fx-splitter={`${path.join('.')}:${index}`} />;
}

/** Where the dragged tab would land: the pane it joins, the header band, the half it would take, or the host's side. Tokens only. */
export function DockDropOverlay({ preview }: { preview: DockDropPreview }) {
  const d = preview.drop;
  const zone = d.zone;
  const label = preview.limited ? 'Pane limit: joins as a tab' : zone === 'header' ? 'Add the tab here' : zone === 'centre' ? 'Join as a tab' : d.target === 'root' ? `New pane along the ${zone}` : `Split ${zone}`;
  return (
    <div className={`fx-dock-drop fx-dock-drop--${zone} ${preview.limited ? 'is-limited' : ''}`.trim()} style={{ left: preview.rect.x, top: preview.rect.y, width: preview.rect.width, height: preview.rect.height }} aria-hidden>
      <span className="fx-dock-drop__label">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* layout presets (dock-layout@1): pick with a preview, then apply     */
/* ------------------------------------------------------------------ */

/** The preset thumbnail: the engine's SVG (theme tokens only), scaled by the host. */
export function DockPresetThumb({ data, className }: { data: DockLayoutData; className?: string }) {
  // the SVG is the engine's own output (presetSvg), never user text
  return <span className={`fx-dock-thumb ${className ?? ''}`.trim()} dangerouslySetInnerHTML={{ __html: presetSvg(data) }} />;
}

/** Pick one of the app's dock-layout assets for a window's dock, see it before applying. `arg` = a group id or a window id. */
export function DockLayoutDialog({ arg, close }: { arg: string; close: () => void }) {
  const rt = useRuntime();
  const wm = rt.windows;
  const s = wm.state;
  const windowId = s.groups[arg]?.windowId ?? (s.windows.some((w) => w.id === arg) ? arg : wm.mainWindowId);
  const presets = rt.registry.list('dock-layout').map((a) => ({ id: a.id, name: a.name, data: normalizeDockLayout(a.data) })).sort((a, b) => a.data.panes - b.data.panes || a.name.localeCompare(b.name));
  const [pick, setPick] = useState<string | null>(presets[0]?.id ?? null);
  const chosen = presets.find((p) => p.id === pick) ?? null;
  const tabs = (s.layouts[windowId] ? paneGroups(s.layouts[windowId]!) : []).reduce((n, g) => n + (s.groups[g]?.tabs.length ?? 0), 0);
  const limit = wm.dockRules.paneLimit;
  if (!presets.length) return <p className="fx-muted">No pane layouts are installed (dock-layout assets).</p>;
  return (
    <div className="fx-form">
      <div className="fx-dock-presets" role="listbox" aria-label="Pane layouts">
        {presets.map((p) => (
          <button key={p.id} type="button" role="option" aria-selected={p.id === pick} className={`fx-btn fx-dock-preset ${p.id === pick ? 'is-selected' : ''}`.trim()} onClick={() => setPick(p.id)} onDoubleClick={() => { wm.applyPreset(p.data, windowId); close(); }}>
            <DockPresetThumb data={p.data} />
            <span className="fx-dock-preset__name">{p.name}</span>
            <span className="fx-dock-preset__hint">{p.data.panes} pane{p.data.panes === 1 ? '' : 's'}{p.data.panes > limit ? ` · first ${limit} used` : ''}</span>
          </button>
        ))}
      </div>
      {chosen && (
        <div className="fx-dock-preview">
          <DockPresetThumb data={chosen.data} className="fx-dock-preview__thumb" />
          <div>
            <div className="fx-dock-preset__name">{chosen.name}</div>
            {chosen.data.hint && <p className="fx-muted">{chosen.data.hint}</p>}
            <p className="fx-muted">{tabs} open tab{tabs === 1 ? '' : 's'} spread over {Math.min(chosen.data.panes, limit, Math.max(1, tabs))} pane{Math.min(chosen.data.panes, limit, Math.max(1, tabs)) === 1 ? '' : 's'}; the pane limit is {limit}.</p>
          </div>
        </div>
      )}
      <div className="fx-form__actions">
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="layout" disabled={!chosen || tabs === 0} onClick={() => { if (chosen) wm.applyPreset(chosen.data, windowId); close(); }}>Apply layout</Button>
      </div>
      {tabs === 0 && <p className="fx-muted"><Icon name="info" /> Open some tabs first: a layout spreads the open tabs over its panes.</p>}
    </div>
  );
}

/** Register with the shell's dialogs (WindowHost merges it into `windowDialogs`). */
export const dockLayoutDialog = {
  'dock-layout': { title: 'Pane layout', icon: 'layout', searchable: false, render: (p: Record<string, unknown>, close: () => void) => <DockLayoutDialog arg={String(p.arg ?? '')} close={close} /> },
};
