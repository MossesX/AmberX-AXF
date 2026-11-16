/**
 * Plan Studio page layouts: the switcher on the editor's toolbar and the three ways the sections are laid out (nav menu,
 * tab group, IDE panes), plus the per-user fold state behind Collapse all / Expand all. The logic is layout-core.mjs;
 * this file only draws it. Everything is saved per user in the console settings, so the actions in index.tsx (REST,
 * MCP, CLI, voice) and this UI change the same thing.
 */
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon, IconButton, Segmented, TabGroup, useRuntime } from '@console/axf/react';
import * as lc from './layout-core.mjs';
import type { Dock, DockTree, DropZone, Fold, PresetData } from './layout-core.mjs';
import { KEYS } from './api';

type Rt = ReturnType<typeof useRuntime>;
export interface SectionDef { id: string; label: string; icon: string; node: ReactNode }

/** Re-render when a setting changes; returns its current value. */
function useSetting(key: string): unknown {
  const rt = useRuntime();
  const read = () => { try { return rt.settings.get(key); } catch { return undefined; } };
  const [v, setV] = useState<unknown>(read);
  useEffect(() => { setV(read()); return rt.settings.onChange(key, (x) => setV(x)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/* ---------------------------------------------------------------- the page layout + its dock (shared with the actions) */

export const layoutOf = (v: unknown) => lc.resolveLayout(typeof v === 'string' ? v : '') ?? lc.resolveLayout(lc.DEFAULT_LAYOUT)!;
/** Dock-layout assets (the framework's ten starters and any the app adds): the IDE arrangements on offer. */
export function dockPresets(rt: Rt): { id: string; name: string; data: PresetData }[] {
  try { return rt.registry.list('dock-layout').map((a) => ({ id: a.id, name: a.name, data: a.data as unknown as PresetData })).sort((a, b) => a.data.panes - b.data.panes || a.name.localeCompare(b.name)); } catch { return []; }
}
export function readDock(rt: Rt, sections: string[]): Dock {
  const raw = rt.settings.get(KEYS.dock);
  if (raw && typeof raw === 'object') return lc.normalizeDock(raw, sections);
  const preset = dockPresets(rt).find((p) => p.id === (layoutOf(rt.settings.get(KEYS.pageLayout)).preset ?? 'ide'));
  return lc.fromPreset(preset?.data ?? { panes: 2, tree: { kind: 'split', vertical: false, children: [{ kind: 'leaf', pane: 1 }, { kind: 'leaf', pane: 2 }], weights: [2, 1] } }, sections);
}
export const writeDock = (rt: Rt, d: Dock) => rt.settings.set(KEYS.dock, d as never);
/** Switch the page layout; `preset` (a dock-layout asset id) also rearranges the IDE panes. */
export function setLayout(rt: Rt, q: string, sections: string[], preset?: string): string {
  const l = lc.resolveLayout(q);
  if (!l) throw new Error(`No Plan Studio layout called "${q}". Layouts: ${lc.layouts().map((x) => x.id).join(', ')}.`);
  rt.settings.set(KEYS.pageLayout, l.id);
  if (l.kind === 'dock' && preset) {
    const p = dockPresets(rt).find((x) => x.id === preset || x.name.toLowerCase() === preset.toLowerCase());
    if (!p) throw new Error(`No pane layout called "${preset}".`);
    writeDock(rt, lc.fromPreset(p.data, sections));
  }
  return l.id;
}

/* ---------------------------------------------------------------- fold (Collapse all / Expand all) */

let foldCache: Fold | null = null;
export function readFold(rt: Rt): Fold { return lc.normalizeFold(rt.settings.get(KEYS.fold)); }
export function foldAll(rt: Rt, mode: 'collapsed' | 'expanded') { foldCache = lc.foldAll(mode); rt.settings.set(KEYS.fold, foldCache as never); }
/** One collapsible item's open state, remembered per user. */
export function useFold(key: string, dflt: boolean): [boolean, (open: boolean) => void] {
  const rt = useRuntime();
  const raw = useSetting(KEYS.fold);
  const fold = lc.normalizeFold(raw);
  const set = (open: boolean) => { foldCache = lc.setOpen(lc.normalizeFold(rt.settings.get(KEYS.fold)), key, open); rt.settings.set(KEYS.fold, foldCache as never); };
  return [lc.isOpen(fold, key, dflt), set];
}

/** Collapse all / Expand all (every plan, sub-grid, category, section and step on the page). */
export function FoldButtons() {
  const rt = useRuntime();
  const all = lc.normalizeFold(useSetting(KEYS.fold)).all;
  return (
    <>
      <IconButton icon="minimize" label="Collapse all (every plan, section and step)" aria-pressed={all === 'collapsed'} data-axf-target="action:plan-studio.collapse-all" onClick={() => foldAll(rt, 'collapsed')} />
      <IconButton icon="maximize" label="Expand all (every plan, section and step)" aria-pressed={all === 'expanded'} data-axf-target="action:plan-studio.expand-all" onClick={() => foldAll(rt, 'expanded')} />
    </>
  );
}

/* ---------------------------------------------------------------- the switcher (Plan Studio's toolbar) */

export function LayoutSwitcher({ sections }: { sections: SectionDef[] }) {
  const rt = useRuntime();
  const cur = layoutOf(useSetting(KEYS.pageLayout));
  const dockRaw = useSetting(KEYS.dock);
  const ids = sections.map((s) => s.id);
  const dock = cur.kind === 'dock' ? readDock(rt, ids) : null;
  void dockRaw;
  const presets = cur.kind === 'dock' ? dockPresets(rt) : [];
  return (
    <span className="axp-plan-studio__layouts" data-axf-target="setting:plan-studio.pageLayout">
      <Segmented size="sm" label="Page layout" value={cur.id} onChange={(v) => setLayout(rt, v, ids)} options={lc.layouts().map((l) => ({ value: l.id, label: l.label, icon: l.icon, title: l.hint }))} />
      {presets.length > 0 && (
        <label className="fx-search axp-plan-studio__sel"><Icon name="layout" size={12} />
          <select aria-label="Arrange panes" value="" onChange={(e) => e.target.value && setLayout(rt, cur.id, ids, e.target.value)}>
            <option value="">Arrange panes…</option>{presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.data.panes})</option>)}
          </select>
        </label>
      )}
      {dock && dock.closed.length > 0 && (
        <label className="fx-search axp-plan-studio__sel"><Icon name="restore" size={12} />
          <select aria-label="Reopen a closed section" value="" onChange={(e) => e.target.value && writeDock(rt, lc.reopen(dock, e.target.value, ids))}>
            <option value="">Reopen ({dock.closed.length})…</option>{dock.closed.map((id) => <option key={id} value={id}>{sections.find((s) => s.id === id)?.label ?? id}</option>)}
          </select>
        </label>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- the sections, laid out */

/** Shows the editor's sections the way the user's layout says. `nav` is the strip of section chips (the nav layout). */
export function SectionLayout({ sections, nav }: { sections: SectionDef[]; nav: ReactNode }) {
  const cur = layoutOf(useSetting(KEYS.pageLayout));
  if (cur.kind === 'tabs') return <TabsLayout sections={sections} />;
  if (cur.kind === 'dock') return <DockLayout sections={sections} />;
  return <>{nav}{sections.map((s) => <div key={s.id}>{s.node}</div>)}</>;
}

function TabsLayout({ sections }: { sections: SectionDef[] }) {
  const [tab, setTab] = useState(sections[0]?.id ?? '');
  const cur = sections.find((s) => s.id === tab) ?? sections[0];
  return (
    <TabGroup id="plan-studio.sections" label="Plan sections" value={cur?.id ?? ''} onChange={setTab} tabs={sections.map((s) => ({ value: s.id, label: s.label, icon: s.icon }))}>
      <div className="axp-plan-studio__tabpanel">{cur?.node}</div>
    </TabGroup>
  );
}

function DockLayout({ sections }: { sections: SectionDef[] }) {
  const rt = useRuntime();
  void useSetting(KEYS.dock);
  const ids = sections.map((s) => s.id);
  const dock = readDock(rt, ids);
  const put = (d: Dock) => writeDock(rt, d);
  return (
    <div className="axp-plan-studio__dock" data-axf-target="setting:plan-studio.dock">
      {dock.tree ? <DockNode tree={dock.tree} path={[]} dock={dock} sections={sections} put={put} /> : null}
    </div>
  );
}

function DockNode({ tree, path, dock, sections, put }: { tree: DockTree; path: number[]; dock: Dock; sections: SectionDef[]; put: (d: Dock) => void }) {
  if (tree.kind === 'leaf') return <DockPane id={tree.pane} dock={dock} sections={sections} put={put} />;
  return (
    <div className={`axp-plan-studio__split${tree.vertical ? ' is-v' : ''}`}>
      {tree.children.map((c, i) => (
        <SplitCell key={i} first={i === 0} vertical={tree.vertical} weight={tree.weights[i] ?? 1} onResize={(delta) => put(lc.resize(dock, path, i - 1, delta))}>
          <DockNode tree={c} path={[...path, i]} dock={dock} sections={sections} put={put} />
        </SplitCell>
      ))}
    </div>
  );
}

function SplitCell({ first, vertical, weight, onResize, children }: { first: boolean; vertical: boolean; weight: number; onResize: (delta: number) => void; children: ReactNode }) {
  const start = useRef<{ at: number; size: number } | null>(null);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    const parent = e.currentTarget.parentElement?.parentElement; if (!parent) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    const r = parent.getBoundingClientRect();
    start.current = { at: vertical ? e.clientY : e.clientX, size: vertical ? r.height : r.width };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current; if (!s || !s.size) return;
    const now = vertical ? e.clientY : e.clientX;
    const delta = (now - s.at) / s.size;
    if (Math.abs(delta) < 0.005) return;
    s.at = now; onResize(delta);
  };
  return (
    <>
      {!first && <div className="axp-plan-studio__splitter" role="separator" aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-label="Resize panes" tabIndex={0}
        onPointerDown={down} onPointerMove={move} onPointerUp={() => { start.current = null; }}
        onKeyDown={(e) => { const k = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']; const i = k.indexOf(e.key); if (i >= 0) { e.preventDefault(); onResize(i ? 0.05 : -0.05); } }} />}
      <div className="axp-plan-studio__cell" style={{ flexGrow: weight }}>{children}</div>
    </>
  );
}

/** The tab being dragged between panes (HTML drag data is not readable during dragover). */
let dragging: string | null = null;

function DockPane({ id, dock, sections, put }: { id: string; dock: Dock; sections: SectionDef[]; put: (d: Dock) => void }) {
  const ids = sections.map((s) => s.id);
  const pane = dock.panes[id];
  const head = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<DropZone | null>(null);
  if (!pane) return null;
  const tabs = pane.tabs.map((t) => sections.find((s) => s.id === t)).filter((s): s is SectionDef => !!s);
  const active = tabs.find((t) => t.id === pane.active) ?? tabs[0];
  const zoneAt = (e: DragEvent<HTMLDivElement>): DropZone => {
    const r = e.currentTarget.getBoundingClientRect();
    const h = head.current?.getBoundingClientRect();
    const inHeader = !!h && e.clientY <= h.bottom;
    return lc.dropZone((e.clientX - r.left) / (r.width || 1), (e.clientY - r.top) / (r.height || 1), inHeader);
  };
  const over = (e: DragEvent<HTMLDivElement>) => { if (!dragging) return; e.preventDefault(); const z = zoneAt(e); if (z !== zone) setZone(z); };
  const drop = (e: DragEvent<HTMLDivElement>) => {
    const tab = dragging; setZone(null);
    if (!tab) return;
    e.preventDefault(); dragging = null;
    const z = zoneAt(e);
    // a reorder inside this pane's own row is the TabGroup's (onReorder); everything else is a move or a split
    if (z === 'header' && pane.tabs.includes(tab)) return;
    put(lc.applyDrop(dock, tab, id, z, ids));
  };
  return (
    <div className={`axp-plan-studio__dpane${zone ? ` is-drop is-drop-${zone}` : ''}`} data-axp-pane={id}
      onDragStartCapture={(e) => { const v = (e.target as HTMLElement).closest('[data-axf-tab]')?.getAttribute('data-axf-tab') ?? ''; dragging = pane.tabs.includes(v) ? v : null; }}
      onDragEndCapture={() => { dragging = null; setZone(null); }}
      onDragOver={over} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null); }} onDrop={drop}>
      <div ref={head} className="axp-plan-studio__dpanehead">
        <TabGroup id="plan-studio.pane" label={`Pane ${id.replace(/^p/, '')}`} size="sm" asset="sticky-badged" value={active?.id ?? ''}
          onChange={(v) => put(lc.activate(dock, v, ids))}
          onReorder={(order) => put(lc.reorder(dock, id, order, ids))}
          onClose={(v) => put(lc.closeTab(dock, v, ids))}
          tabs={tabs.map((s) => ({ value: s.id, label: s.label, icon: s.icon }))}
          extra={Object.keys(dock.panes).length > 1 ? <IconButton icon="x" label="Close this pane (its sections can be reopened)" onClick={() => put(lc.closePane(dock, id, ids))} /> : undefined} />
      </div>
      <div className="axp-plan-studio__dpanebody">{active?.node}</div>
    </div>
  );
}
