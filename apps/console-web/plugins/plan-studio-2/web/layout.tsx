/**
 * Plan Studio 2.0 page layouts: the switcher on the page toolbar and the three ways the sections (Tree, Editor, Say,
 * Trash) are laid out: nav menu, a tab group across the top, or IDE dockable panes with a tab group in each pane (drag
 * tabs between panes, drop into another tab group, split on a pane's edges, resize, close and reopen). The logic is
 * layout-core.mjs; this file only draws it. The pick and the dock are saved per user in the console settings, so the
 * actions in index.tsx (REST, MCP, CLI, voice) and this UI change the same values.
 */
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Button, Icon, IconButton, Segmented, TabGroup, useRuntime } from '@console/axf/react';
import * as lc from './layout-core.mjs';
import type { Dock, DockTree, DropZone, PresetData } from './layout-core.mjs';
import { KEYS } from './api';

type Rt = ReturnType<typeof useRuntime>;
const B = 'axp-plan-studio-2';
export interface SectionDef { id: string; label: string; icon: string; badge?: string; node: ReactNode }

/** Re-render when a setting changes; returns its current value. */
function useSetting(key: string): unknown {
  const rt = useRuntime();
  const read = () => { try { return rt.settings.get(key); } catch { return undefined; } };
  const [v, setV] = useState<unknown>(read);
  useEffect(() => { setV(read()); return rt.settings.onChange(key, (x) => setV(x)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/* ---------------------------------------------------------------- the layout + its dock (shared with the actions) */

export const layoutOf = (v: unknown) => lc.resolveLayout(typeof v === 'string' ? v : '') ?? lc.resolveLayout(lc.DEFAULT_LAYOUT)!;
/** dock-layout@1 assets (the framework's ten starters and any the app adds): the IDE arrangements on offer. */
export function dockPresets(rt: Rt): { id: string; name: string; data: PresetData }[] {
  try { return rt.registry.list('dock-layout').map((a) => ({ id: a.id, name: a.name, data: a.data as unknown as PresetData })).sort((a, b) => a.data.panes - b.data.panes || a.name.localeCompare(b.name)); } catch { return []; }
}
export function readDock(rt: Rt): Dock {
  const raw = rt.settings.get(KEYS.dock);
  if (raw && typeof raw === 'object') return lc.normalizeDock(raw, lc.SECTION_IDS);
  const preset = dockPresets(rt).find((p) => p.id === (layoutOf(rt.settings.get(KEYS.pageLayout)).preset ?? 'ide'));
  return lc.fromPreset(preset?.data ?? lc.FALLBACK_PRESET, lc.SECTION_IDS);
}
export const writeDock = (rt: Rt, d: Dock | null) => rt.settings.set(KEYS.dock, d as never);
/** Switch the page layout; `preset` (a dock-layout asset id or name) also rearranges the IDE panes. Returns the layout id. */
export function setLayout(rt: Rt, q: string, preset?: string): string {
  const l = lc.resolveLayout(q);
  if (!l) throw new Error(`No Plan Studio 2.0 layout called "${q}". Layouts: ${lc.layouts().map((x) => x.id).join(', ')}.`);
  rt.settings.set(KEYS.pageLayout, l.id);
  if (l.kind === 'dock' && preset) {
    const p = dockPresets(rt).find((x) => x.id === preset || x.name.toLowerCase() === preset.toLowerCase());
    if (!p) throw new Error(`No pane layout called "${preset}". Pane layouts: ${dockPresets(rt).map((x) => x.id).join(', ')}.`);
    writeDock(rt, lc.fromPreset(p.data, lc.SECTION_IDS));
  }
  return l.id;
}
/** Bring one section into view whatever the layout (tabs: select it; IDE: show its tab, reopening it if closed). */
export function showSection(rt: Rt, id: string) {
  const l = layoutOf(rt.settings.get(KEYS.pageLayout));
  if (l.kind === 'tabs') rt.settings.set(KEYS.tab, id);
  else if (l.kind === 'dock') writeDock(rt, lc.activate(readDock(rt), id, lc.SECTION_IDS));
  else setTimeout(() => document.getElementById(`${B}-sec-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
}

/* ---------------------------------------------------------------- the switcher (the page toolbar) */

export function LayoutSwitcher() {
  const rt = useRuntime();
  const cur = layoutOf(useSetting(KEYS.pageLayout));
  void useSetting(KEYS.dock);
  const dock = cur.kind === 'dock' ? readDock(rt) : null;
  const presets = cur.kind === 'dock' ? dockPresets(rt) : [];
  const label = (id: string) => lc.SECTIONS.find((s) => s.id === id)?.label ?? id;
  return (
    <span className={`${B}__layouts`} data-axf-target="setting:plan-studio-2.pageLayout">
      <Segmented size="sm" label="Page layout" value={cur.id} onChange={(v) => setLayout(rt, v)} options={lc.layouts().map((l) => ({ value: l.id, label: l.label, icon: l.icon, title: l.hint }))} />
      {presets.length > 0 && (
        <label className={`fx-search ${B}__sel`}><Icon name="layout" size={12} />
          <select aria-label="Arrange panes" value="" onChange={(e) => e.target.value && setLayout(rt, cur.id, e.target.value)}>
            <option value="">Arrange panes…</option>{presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.data.panes})</option>)}
          </select>
        </label>
      )}
      {dock && dock.closed.length > 0 && (
        <label className={`fx-search ${B}__sel`}><Icon name="restore" size={12} />
          <select aria-label="Reopen a closed section" value="" onChange={(e) => e.target.value && writeDock(rt, lc.reopen(dock, e.target.value, lc.SECTION_IDS))}>
            <option value="">Reopen ({dock.closed.length})…</option>{dock.closed.map((id) => <option key={id} value={id}>{label(id)}</option>)}
          </select>
        </label>
      )}
      {dock && <IconButton icon="restore" label="Reset the panes to the pane layout" onClick={() => writeDock(rt, null)} />}
    </span>
  );
}

/* ---------------------------------------------------------------- the sections, laid out */

export function SectionLayout({ sections }: { sections: SectionDef[] }) {
  const cur = layoutOf(useSetting(KEYS.pageLayout));
  if (cur.kind === 'tabs') return <TabsLayout sections={sections} />;
  if (cur.kind === 'dock') return <DockLayout sections={sections} />;
  return <NavLayout sections={sections} />;
}

function NavLayout({ sections }: { sections: SectionDef[] }) {
  const rt = useRuntime();
  return (
    <div className={`${B}__navlayout fx-stack fx-stack--lg`}>
      <nav className={`${B}__jump`} aria-label="Plan Studio 2.0 sections" data-axf-nav="plan-studio-2.sections" data-fx-ctx-target="nav" data-fx-ctx-payload="plan-studio-2.sections">
        {sections.map((s) => <Button key={s.id} size="sm" tone="quiet" icon={s.icon} onClick={() => showSection(rt, s.id)}>{s.label}{s.badge ? ` (${s.badge})` : ''}</Button>)}
      </nav>
      <div className={`${B}__navbody`}>
        {sections.map((s) => <section key={s.id} id={`${B}-sec-${s.id}`} className={`${B}__sec ${B}__sec--${s.id}`} aria-label={s.label}>{s.node}</section>)}
      </div>
    </div>
  );
}

function TabsLayout({ sections }: { sections: SectionDef[] }) {
  const rt = useRuntime();
  const saved = useSetting(KEYS.tab);
  const cur = sections.find((s) => s.id === saved) ?? sections[0];
  return (
    <TabGroup id="plan-studio-2.sections" label="Plan Studio 2.0 sections" value={cur?.id ?? ''} onChange={(v) => rt.settings.set(KEYS.tab, v)}
      tabs={sections.map((s) => ({ value: s.id, label: s.label, icon: s.icon, badge: s.badge }))}>
      <div className={`${B}__tabpanel`}>{cur?.node}</div>
    </TabGroup>
  );
}

function DockLayout({ sections }: { sections: SectionDef[] }) {
  const rt = useRuntime();
  void useSetting(KEYS.dock);
  const dock = readDock(rt);
  const put = (d: Dock) => writeDock(rt, d);
  return (
    <div className={`${B}__dock`} data-axf-target="setting:plan-studio-2.dock">
      {dock.tree ? <DockNode tree={dock.tree} path={[]} dock={dock} sections={sections} put={put} /> : null}
    </div>
  );
}

function DockNode({ tree, path, dock, sections, put }: { tree: DockTree; path: number[]; dock: Dock; sections: SectionDef[]; put: (d: Dock) => void }) {
  if (tree.kind === 'leaf') return <DockPane id={tree.pane} dock={dock} sections={sections} put={put} />;
  return (
    <div className={`${B}__split${tree.vertical ? ' is-v' : ''}`}>
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
    const parent = e.currentTarget.parentElement; if (!parent) return;
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
      {!first && <div className={`${B}__splitter`} role="separator" aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-label="Resize panes" tabIndex={0}
        onPointerDown={down} onPointerMove={move} onPointerUp={() => { start.current = null; }}
        onKeyDown={(e) => { const k = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']; const i = k.indexOf(e.key); if (i >= 0) { e.preventDefault(); onResize(i ? 0.05 : -0.05); } }} />}
      <div className={`${B}__cell`} style={{ flexGrow: weight }}>{children}</div>
    </>
  );
}

/** The tab being dragged between panes (HTML drag data is not readable during dragover). */
let dragging: string | null = null;

function DockPane({ id, dock, sections, put }: { id: string; dock: Dock; sections: SectionDef[]; put: (d: Dock) => void }) {
  const ids = lc.SECTION_IDS;
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
    <div className={`${B}__dpane${zone ? ` is-drop is-drop-${zone}` : ''}`} data-axp-pane={id}
      onDragStartCapture={(e) => { const v = (e.target as HTMLElement).closest('[data-axf-tab]')?.getAttribute('data-axf-tab') ?? ''; dragging = pane.tabs.includes(v) ? v : null; }}
      onDragEndCapture={() => { dragging = null; setZone(null); }}
      onDragOver={over} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null); }} onDrop={drop}>
      <div ref={head} className={`${B}__dpanehead`}>
        <TabGroup id="plan-studio-2.pane" label={`Pane ${id.replace(/^p/, '')}`} size="sm" asset="sticky-badged" value={active?.id ?? ''}
          onChange={(v) => put(lc.activate(dock, v, ids))}
          onReorder={(order) => put(lc.reorder(dock, id, order, ids))}
          onClose={(v) => put(lc.closeTab(dock, v, ids))}
          tabs={tabs.map((s) => ({ value: s.id, label: s.label, icon: s.icon, badge: s.badge }))}
          extra={Object.keys(dock.panes).length > 1 ? <IconButton icon="x" label="Close this pane (its sections can be reopened)" onClick={() => put(lc.closePane(dock, id, ids))} /> : undefined} />
      </div>
      <div className={`${B}__dpanebody`}>{active?.node}</div>
    </div>
  );
}
